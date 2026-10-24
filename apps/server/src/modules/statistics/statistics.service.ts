import { Injectable } from '@nestjs/common'
import { Prisma } from '@prisma/client'
import { ErrorCode } from '@lunar/shared'
import { BusinessException } from '../../common/exceptions/business.exception'
import { PrismaService } from '../../database/prisma.service'

export const TRAFFIC_SOURCES = ['node', 'cloudflare', 'ali'] as const
export type TrafficSource = typeof TRAFFIC_SOURCES[number]
const UINT64_MAX = 18446744073709551615n
const HOUR_MS = 60 * 60 * 1000
const DAY_MS = 24 * HOUR_MS

function invalid(message: string): never {
  throw new BusinessException(ErrorCode.PARAM_INVALID, message)
}

function parseId(value: unknown, label: string): bigint {
  if (typeof value !== 'string' || value.length > 20 || !/^[0-9]+$/.test(value)) return invalid(`${label} 格式無效`)
  let id: bigint
  try { id = BigInt(value) } catch { return invalid(`${label} 格式無效`) }
  if (id < 1n || id > UINT64_MAX) return invalid(`${label} 格式無效`)
  return id
}

function parseIsoDate(value: unknown, label: string): Date {
  if (typeof value !== 'string') return invalid(`${label} 必須是含時區的 ISO 日期`)
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(\.\d{1,9})?(Z|[+-]\d{2}:\d{2})$/.exec(value)
  if (!match) return invalid(`${label} 必須是含時區的 ISO 日期`)
  const [, year, month, day, hour, minute, second, fraction, zone] = match
  if (Number(year) < 1000 || Number(year) > 9999) return invalid(`${label} 日期超出 MySQL DATETIME 範圍`)
  const calendar = new Date(0)
  calendar.setUTCFullYear(Number(year), Number(month) - 1, Number(day))
  calendar.setUTCHours(0, 0, 0, 0)
  if (calendar.getUTCFullYear() !== Number(year) || calendar.getUTCMonth() + 1 !== Number(month) || calendar.getUTCDate() !== Number(day) || Number(hour) > 23 || Number(minute) > 59 || Number(second) > 59) return invalid(`${label} 日期無效`)
  if (fraction && /[1-9]/.test(fraction)) return invalid(`${label} 不可包含非零子秒精度`)
  if (zone !== 'Z') {
    const offsetHour = Number(zone.slice(1, 3))
    const offsetMinute = Number(zone.slice(4, 6))
    if (offsetHour > 23 || offsetMinute > 59) return invalid(`${label} 時區無效`)
  }
  const date = new Date(value)
  if (!Number.isFinite(date.getTime()) || date.getUTCFullYear() < 1000 || date.getUTCFullYear() > 9999) return invalid(`${label} 日期超出 MySQL DATETIME 範圍`)
  return date
}

function utcFloor(date: Date, granularity: 'hour' | 'day'): Date {
  const result = new Date(date)
  result.setUTCMinutes(0, 0, 0)
  if (granularity === 'day') result.setUTCHours(0)
  return result
}

export interface TrafficStatisticsQuery {
  granularity?: unknown
  startTime?: unknown
  endTime?: unknown
  domainId?: unknown
  source?: unknown
}

export interface TrafficStatisticsResponse {
  granularity: 'hour' | 'day'
  startTime: string
  endTime: string
  unit: 'bytes'
  source: 'persisted_hourly'
  coverage: 'observed_only'
  availability: 'available' | 'no_data'
  series: Array<{ time: string; bytes: string }>
  totalBytes: string | null
}

@Injectable()
export class StatisticsService {
  constructor(private readonly prisma: PrismaService) {}

  async traffic(userIdInput: string, query: TrafficStatisticsQuery): Promise<TrafficStatisticsResponse> {
    // Validate every caller-controlled value before issuing any database query.
    const userId = parseId(userIdInput, '使用者 ID')
    const granularity = query.granularity === undefined ? 'hour' : query.granularity
    if (granularity !== 'hour' && granularity !== 'day') return invalid('granularity 僅支援 hour 或 day')
    const hasStart = query.startTime !== undefined
    const hasEnd = query.endTime !== undefined
    if (hasStart !== hasEnd) return invalid('startTime 與 endTime 必須同時提供')
    let start: Date
    let end: Date
    if (hasStart) {
      start = parseIsoDate(query.startTime, 'startTime')
      end = parseIsoDate(query.endTime, 'endTime')
    } else {
      const now = new Date()
      end = utcFloor(now, granularity)
      start = new Date(end.getTime() - (granularity === 'hour' ? 24 * HOUR_MS : 30 * DAY_MS))
    }
    const unitMs = granularity === 'hour' ? HOUR_MS : DAY_MS
    if (start.getTime() % unitMs !== 0 || end.getTime() % unitMs !== 0) return invalid(`${granularity} 範圍必須對齊 UTC ${granularity === 'hour' ? '整點' : '午夜'}`)
    if (start.getTime() >= end.getTime()) return invalid('startTime 必須早於 endTime')
    const maxDuration = granularity === 'hour' ? 31 * DAY_MS : 366 * DAY_MS
    if (end.getTime() - start.getTime() > maxDuration) return invalid('查詢範圍超出上限')
    let domainId: bigint | undefined
    if (query.domainId !== undefined) domainId = parseId(query.domainId, 'domainId')
    let source: TrafficSource | undefined
    if (query.source !== undefined) {
      if (typeof query.source !== 'string' || !TRAFFIC_SOURCES.includes(query.source as TrafficSource)) return invalid('source 不支援')
      source = query.source as TrafficSource
    }

    if (domainId !== undefined) {
      const owned = await this.prisma.$queryRaw<Array<{ id: string }>>(Prisma.sql`
        SELECT CAST(id AS CHAR) AS id
        FROM domains
        WHERE id = CAST(${domainId.toString()} AS UNSIGNED)
          AND user_id = CAST(${userId.toString()} AS UNSIGNED)
          AND deleted_at IS NULL
        LIMIT 1
      `)
      if (owned.length === 0) throw new BusinessException(ErrorCode.DOMAIN_NOT_FOUND)
    }

    const sourceFilter = source === undefined
      ? Prisma.sql`t.source IN (${Prisma.join([...TRAFFIC_SOURCES])})`
      : Prisma.sql`t.source = ${source}`
    const domainFilter = domainId === undefined
      ? Prisma.empty
      : Prisma.sql`AND t.domain_id = CAST(${domainId.toString()} AS UNSIGNED)`
    // MySQL returns SUM as DECIMAL text so totals above uint64 remain exact.
    const grouped = await this.prisma.$queryRaw<Array<{ statTime: Date; bytes: string | null }>>(Prisma.sql`
      SELECT t.stat_time AS statTime, CAST(SUM(t.traffic) AS CHAR) AS bytes
      FROM traffic_stats_hourly AS t
      INNER JOIN domains AS d ON d.id = t.domain_id
      WHERE t.user_id = CAST(${userId.toString()} AS UNSIGNED)
        AND d.user_id = CAST(${userId.toString()} AS UNSIGNED)
        AND d.deleted_at IS NULL
        AND t.stat_time >= ${start.toISOString().slice(0, 19).replace('T', ' ')}
        AND t.stat_time < ${end.toISOString().slice(0, 19).replace('T', ' ')}
        AND ${sourceFilter}
        ${domainFilter}
      GROUP BY t.stat_time
      ORDER BY t.stat_time ASC
    `)

    const totals = new Map<number, bigint>()
    for (const row of grouped) {
      if (row.bytes === null) continue
      const keyTime = new Date(row.statTime)
      if (granularity === 'day') keyTime.setUTCHours(0, 0, 0, 0)
      const key = keyTime.getTime()
      totals.set(key, (totals.get(key) ?? 0n) + BigInt(row.bytes))
    }
    const series = [...totals.entries()]
      .sort(([a], [b]) => a - b)
      .map(([time, bytes]) => ({ time: new Date(time).toISOString(), bytes: bytes.toString() }))
    const totalBytes = series.length === 0 ? null : series.reduce((sum, row) => sum + BigInt(row.bytes), 0n).toString()
    return {
      granularity,
      startTime: start.toISOString(),
      endTime: end.toISOString(),
      unit: 'bytes',
      source: 'persisted_hourly',
      coverage: 'observed_only',
      availability: totalBytes === null ? 'no_data' : 'available',
      series,
      totalBytes,
    }
  }

  async recordHourly(input: { userId: string; domainId: string; source: TrafficSource; statTime: string; traffic: string }): Promise<void> {
    const userId = parseId(input?.userId, '使用者 ID')
    const domainId = parseId(input?.domainId, 'domainId')
    if (!TRAFFIC_SOURCES.includes(input?.source)) return invalid('source 不支援')
    const statTime = parseIsoDate(input?.statTime, 'statTime')
    if (statTime.getTime() % HOUR_MS !== 0) return invalid('statTime 必須對齊 UTC 整點')
    if (typeof input?.traffic !== 'string' || input.traffic.length > 20 || !/^[0-9]+$/.test(input.traffic)) return invalid('traffic 必須是 unsigned 64-bit bytes 字串')
    const traffic = BigInt(input.traffic)
    if (traffic > UINT64_MAX) return invalid('traffic 超出 unsigned 64-bit 範圍')

    const statTimeSql = statTime.toISOString().slice(0, 19).replace('T', ' ')
    await this.prisma.$transaction(async (tx) => {
      const owned = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
        SELECT CAST(id AS CHAR) AS id
        FROM domains
        WHERE id = CAST(${domainId.toString()} AS UNSIGNED)
          AND user_id = CAST(${userId.toString()} AS UNSIGNED)
          AND deleted_at IS NULL
        LIMIT 1
        FOR UPDATE
      `)
      if (owned.length === 0) throw new BusinessException(ErrorCode.DOMAIN_NOT_FOUND)
      // DECIMAL preserves all uint64 digits when MySQL infers prepared INSERT parameter types.
      await tx.$executeRaw(Prisma.sql`
        INSERT INTO traffic_stats_hourly (user_id, domain_id, stat_time, source, traffic)
        VALUES (
          CAST(${userId.toString()} AS DECIMAL(20,0)),
          CAST(${domainId.toString()} AS DECIMAL(20,0)),
          ${statTimeSql}, ${input.source}, CAST(${traffic.toString()} AS DECIMAL(20,0))
        )
        ON DUPLICATE KEY UPDATE user_id = VALUES(user_id), traffic = VALUES(traffic)
      `)
    })
  }
}

import { HttpStatus, Injectable } from '@nestjs/common'
import { Prisma, type Domain } from '@prisma/client'
import { domainToASCII } from 'node:url'
import { isIP } from 'node:net'
import { randomUUID } from 'node:crypto'
import { resolveCname } from 'node:dns/promises'
import { ErrorCode, DomainAuditStatus, DomainStatus, RoleType } from '@lunar/shared'
import { BusinessException } from '../../common/exceptions/business.exception'
import { PrismaService } from '../../database/prisma.service'

const MAX_UNSIGNED_BIGINT = 18446744073709551615n
const DOMAIN_BUSINESS_TYPES = ['网站', '下载', '视频', '直播', 'static', 'download', 'video', 'live'] as const
const ORIGIN_FIELDS = ['address', 'port', 'weight', 'protocol', 'host', 'isBackup'] as const
const GROUP_FIELDS = ['name', 'lbPolicy', 'healthCheck', 'origins'] as const
const DOMAIN_SORT_FIELDS = ['createdAt', 'updatedAt', 'domain', 'status', 'businessType'] as const

function invalid(message: string): never { throw new BusinessException(ErrorCode.PARAM_INVALID, message) }

function isRecord(value: unknown): value is Record<string, any> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function assertAllowedKeys(value: Record<string, unknown>, allowed: readonly string[]): void {
  const unknown = Object.keys(value).find((key) => !allowed.includes(key))
  if (unknown) invalid(`不支持字段: ${unknown}`)
}

function validateTags(value: unknown): unknown[] {
  if (!Array.isArray(value) || value.length > 20 || value.some((tag) => typeof tag !== 'string' || tag.trim().length < 1 || tag.trim().length > 32)) {
    return invalid('tags 必须是最多20项、每项1至32字符的字符串数组')
  }
  return value.map((tag) => (tag as string).trim())
}

function normalizeOriginHostname(value: unknown, field: string, allowEmpty = false): string {
  if (typeof value !== 'string' || /[\r\n]/.test(value) || value.trim() !== value) return invalid(`${field} 格式无效`)
  const hostname = value.toLowerCase().replace(/\.$/, '')
  if (hostname.length < (allowEmpty ? 0 : 1) || hostname.length > 253 || hostname.includes('://') || /[^a-z0-9.-]/.test(hostname)) return invalid(`${field} 必须是合法hostname，不能含端口或路径`)
  if (hostname && hostname.split('.').some((label) => label.length < 1 || label.length > 63 || !/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(label))) return invalid(`${field} 必须是合法hostname`)
  return hostname
}

function normalizeOriginAddress(value: unknown, field: 'address' | 'host'): string | null {
  if (field === 'host' && value === null) return null
  if (typeof value !== 'string' || (field === 'address' && (value.length === 0 || value.length > 253)) || /[\r\n]/.test(value) || value.trim() !== value) return invalid(`${field} 必须是IP或hostname，且不可包含URL、端口或路径`)
  if (isIP(value)) return value.toLowerCase()
  return normalizeOriginHostname(value, field)
}

function validateOriginGroup(value: unknown): { name: string; lbPolicy: string; healthCheck?: Prisma.InputJsonValue | null; origins: Array<Record<string, unknown>> } {
  if (!isRecord(value)) return invalid('originGroup 参数无效')
  assertAllowedKeys(value, GROUP_FIELDS)
  if (!Array.isArray(value.origins) || value.origins.length < 1 || value.origins.length > 20) return invalid('originGroup.origins 必须包含1至20个源站')
  const origins = value.origins.map((origin: unknown) => {
    if (!isRecord(origin)) return invalid('源站参数无效')
    assertAllowedKeys(origin, ORIGIN_FIELDS)
    if (!['address', 'port', 'weight', 'protocol'].every((key) => key in origin)) return invalid('源站缺少必填字段')
    if (!Number.isInteger(origin.port) || origin.port < 1 || origin.port > 65535) return invalid('port 必须为1至65535的整数')
    if (!Number.isInteger(origin.weight) || origin.weight < 1 || origin.weight > 1000) return invalid('weight 必须为1至1000的整数')
    if (origin.protocol !== 'http' && origin.protocol !== 'https') return invalid('protocol 仅支持 http 或 https')
    if ('host' in origin && origin.host !== null && typeof origin.host !== 'string') return invalid('host 格式无效')
    if ('isBackup' in origin && typeof origin.isBackup !== 'boolean') return invalid('isBackup 必须为布尔值')
    return {
      address: normalizeOriginAddress(origin.address, 'address'), port: origin.port, weight: origin.weight,
      protocol: origin.protocol, ...(origin.host !== undefined ? { host: normalizeOriginAddress(origin.host, 'host') } : {}),
      isBackup: origin.isBackup ?? false, status: 1,
    }
  })
  if (value.name !== undefined && (typeof value.name !== 'string' || !value.name.trim() || value.name.trim().length > 64)) return invalid('name 长度必须为1至64个字符')
  let lbPolicy = value.lbPolicy ?? 'round_robin'
  // The API sample uses numeric 1; existing resource APIs persist named policy values.
  if (lbPolicy === 1) lbPolicy = 'round_robin'
  else if (lbPolicy === 2) lbPolicy = 'weighted'
  else if (lbPolicy === 3) lbPolicy = 'least_conn'
  if (!['round_robin', 'weighted', 'least_conn', 'ip_hash', 'primary_backup'].includes(lbPolicy)) return invalid('lbPolicy 无效')
  const backupCount = origins.filter((origin) => origin.isBackup === true).length
  if (lbPolicy === 'primary_backup') {
    if (origins.length < 2 || backupCount < 1 || origins.length - backupCount !== 1) return invalid('primary_backup 策略要求且仅要求一个主源站，并至少一个备源站')
  } else if (backupCount > 0) return invalid('仅 primary_backup 策略允许 isBackup=true')
  let healthCheck: Prisma.InputJsonValue | null | undefined
  if ('healthCheck' in value) {
    const check = value.healthCheck
    if (check === null) healthCheck = null
    else {
      if (!isRecord(check)) return invalid('healthCheck 必须为受限结构对象')
      assertAllowedKeys(check, ['enabled', 'path', 'interval', 'timeout', 'expectedStatus'])
      const normalized = { enabled: check.enabled ?? false, path: check.path ?? '/', interval: check.interval ?? 30, timeout: check.timeout ?? 5, expectedStatus: check.expectedStatus ?? 200 }
      if (typeof normalized.enabled !== 'boolean' || typeof normalized.path !== 'string' || !/^\//.test(normalized.path) || /[\r\n]/.test(normalized.path) || normalized.path.length > 2048 || !Number.isInteger(normalized.interval) || normalized.interval < 5 || normalized.interval > 3600 || !Number.isInteger(normalized.timeout) || normalized.timeout < 1 || normalized.timeout > 5 || !Number.isInteger(normalized.expectedStatus) || normalized.expectedStatus < 100 || normalized.expectedStatus > 599) return invalid('healthCheck 字段或范围无效（timeout 最大5秒）')
      healthCheck = normalized
    }
  }
  return { name: value.name === undefined ? '默认源站组' : value.name.trim(), lbPolicy, ...(healthCheck !== undefined ? { healthCheck } : {}), origins }
}

export function parseBigIntId(raw: string): bigint {
  if (typeof raw !== 'string' || !/^[1-9][0-9]{0,19}$/.test(raw)) throw new BusinessException(ErrorCode.PARAM_INVALID, 'ID 格式错误')
  const value = BigInt(raw)
  if (value > MAX_UNSIGNED_BIGINT) throw new BusinessException(ErrorCode.PARAM_INVALID, 'ID 超出范围')
  return value
}

export function normalizeDomain(input: string): string {
  if (typeof input !== 'string' || input.length > 1024 || /[\s/:?#@]/.test(input) || input.endsWith('.')) {
    throw new BusinessException(ErrorCode.DOMAIN_FORMAT_INVALID)
  }
  if (input.includes('*')) throw new BusinessException(ErrorCode.DOMAIN_FORMAT_INVALID, '本轮暂不支持通配符域名')
  const ascii = domainToASCII(input).toLowerCase()
  if (!ascii || ascii.length > 253 || isIP(ascii)) throw new BusinessException(ErrorCode.DOMAIN_FORMAT_INVALID)
  const labels = ascii.split('.')
  if (labels.length < 2 || labels.some((label) => label.length < 1 || label.length > 63 || !/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(label))) {
    throw new BusinessException(ErrorCode.DOMAIN_FORMAT_INVALID)
  }
  return ascii
}

@Injectable()
export class DomainService {
  constructor(private readonly prisma: PrismaService) {}

  async requireOwned(userId: string, domainId: string, tx: any = this.prisma): Promise<Domain> {
    const uid = parseBigIntId(userId)
    const id = parseBigIntId(domainId)
    const domain = await tx.domain.findFirst({ where: { id, userId: uid, deletedAt: null } })
    if (!domain) throw new BusinessException(ErrorCode.DOMAIN_NOT_FOUND)
    return domain
  }

  async create(userId: string, input: { domain: string; businessType?: string; tags?: unknown; remark?: string; originGroup?: unknown }) {
    const uid = parseBigIntId(userId)
    const name = normalizeDomain(input.domain)
    const suffix = normalizeDomain(process.env.CNAME_SUFFIX || 'example.invalid')
    const originGroup = input.originGroup === undefined ? undefined : validateOriginGroup(input.originGroup)
    const tags = input.tags === undefined ? undefined : validateTags(input.tags)
    if (input.businessType !== undefined && !DOMAIN_BUSINESS_TYPES.includes(input.businessType as never)) invalid('businessType 无效')
    try {
      return await this.prisma.$transaction(async (tx) => {
        await tx.$queryRaw(Prisma.sql`SELECT id FROM users WHERE id = ${uid} FOR UPDATE`)
        const now = new Date()
        const entitlement = await tx.userPackage.findFirst({
          where: { userId: uid, status: 1, startAt: { lte: now }, expireAt: { gt: now }, package: { status: 1 } },
          orderBy: { expireAt: 'desc' }, include: { package: true },
        })
        if (!entitlement) throw new BusinessException(ErrorCode.PACKAGE_EXPIRED, '需要有效套餐才能添加域名')
        const pkg = entitlement.package
        const count = await tx.domain.count({ where: { userId: uid, deletedAt: null } })
        if (pkg.domainLimit <= 0 || count >= pkg.domainLimit) throw new BusinessException(ErrorCode.QUOTA_EXCEEDED, '套餐域名数已达上限')
        const created = await tx.domain.create({ data: {
          userId: uid, domain: name, cname: `pending.${suffix}`, accessType: pkg.accessType,
          status: DomainStatus.PENDING_REVIEW, auditStatus: DomainAuditStatus.PENDING,
          businessType: input.businessType || 'static', tags: tags as Prisma.InputJsonValue | undefined,
          remark: input.remark,
        } })
        const token = `${created.id.toString()}-${randomUUID()}`
        const cname = `${token}.${suffix}`
        if (cname.length > 253) throw new BusinessException(ErrorCode.PARAM_INVALID, 'CNAME_SUFFIX 过长')
        const row = await tx.domain.update({ where: { id: created.id }, data: { cname } })
        await tx.domainConfig.create({ data: { domainId: row.id } })
        if (originGroup) await tx.originGroup.create({ data: {
          name: originGroup.name, lbPolicy: originGroup.lbPolicy,
          ...(originGroup.healthCheck !== undefined ? { healthCheck: originGroup.healthCheck === null ? Prisma.DbNull : originGroup.healthCheck } : {}),
          domainId: row.id, origins: { create: originGroup.origins as any },
        } })
        return this.toVo(row)
      })
    } catch (error) {
      if ((error as { code?: string })?.code === 'P2002') throw new BusinessException(ErrorCode.DOMAIN_EXISTS)
      throw error
    }
  }

  async list(userId: string, query: { page: number; pageSize: number; keyword?: string; status?: number }) {
    const uid = parseBigIntId(userId)
    const where: Prisma.DomainWhereInput = { userId: uid, deletedAt: null }
    if (query.keyword) where.domain = { contains: query.keyword }
    if (query.status !== undefined) where.status = query.status
    const sort = DOMAIN_SORT_FIELDS.includes((query as any).sort) ? (query as any).sort : 'createdAt'
    const order = (query as any).order === 'asc' ? 'asc' : 'desc'
    const [total, rows] = await this.prisma.$transaction([
      this.prisma.domain.count({ where }),
      this.prisma.domain.findMany({ where, orderBy: { [sort]: order }, skip: (query.page - 1) * query.pageSize, take: query.pageSize, include: { config: true } }),
    ])
    return { total, list: rows.map((r) => this.toVo(r)) }
  }

  async get(userId: string, id: string) {
    await this.requireOwned(userId, id)
    const row = await this.prisma.domain.findFirst({ where: { id: parseBigIntId(id), userId: parseBigIntId(userId), deletedAt: null }, include: { config: true, cacheRules: { orderBy: { priority: 'asc' } }, originGroups: { include: { origins: true } } } })
    return this.toVo(row!)
  }

  async update(userId: string, id: string, input: { remark?: string; tags?: unknown; businessType?: string }) {
    await this.requireOwned(userId, id)
    if (input.businessType !== undefined && !DOMAIN_BUSINESS_TYPES.includes(input.businessType as never)) invalid('businessType 无效')
    const tags = input.tags === undefined ? undefined : validateTags(input.tags)
    const row = await this.prisma.domain.update({ where: { id: parseBigIntId(id) }, data: { remark: input.remark, businessType: input.businessType, tags: tags === undefined ? undefined : tags as Prisma.InputJsonValue } })
    return this.toVo(row)
  }

  async remove(userId: string, id: string) {
    const uid = parseBigIntId(userId), domainId = parseBigIntId(id)
    await this.prisma.$transaction(async (tx) => {
      const domain = await this.lockOwnedDomain(tx, uid, domainId)
      // Soft-deleted domains must not retain HTTPS/certificate bindings, which would block cert deletion.
      await tx.domainConfig.updateMany({ where: { domainId: domain.id }, data: { httpsEnabled: false, forceHttps: false, hstsEnabled: false, certId: null } })
      await tx.domain.update({ where: { id: domain.id }, data: { status: DomainStatus.DELETED, deletedAt: new Date() } })
    })
    return { id }
  }

  async setEnabled(userId: string, id: string, enabled: boolean) {
    if (enabled) throw new BusinessException(ErrorCode.PACKAGE_FEATURE_UNSUPPORTED, '真实部署尚未实现，域名启用不可用', HttpStatus.NOT_IMPLEMENTED)
    const uid = parseBigIntId(userId), domainId = parseBigIntId(id)
    await this.prisma.$transaction(async (tx) => {
      const domain = await this.lockOwnedDomain(tx, uid, domainId)
      await tx.domain.update({ where: { id: domain.id }, data: { status: DomainStatus.DISABLED } })
    })
    return { id, status: DomainStatus.DISABLED }
  }

  /**
   * Batch contract: every ID is parsed and ownership-locked before any item is acted on.
   * A missing/cross-tenant ID rejects the entire request with the same 404, preventing partial changes and enumeration.
   * Legacy domain status 1..6 and audit status 1..3 are stored unchanged (older API prose used audit 0..2).
   */
  async batch(userId: string, input: { action: string; ids: string[] }, permissions: string[], roleType: number) {
    if (!input || !['delete', 'disable', 'check'].includes(input.action) || !Array.isArray(input.ids) || input.ids.length < 1 || input.ids.length > 100) invalid('batch 参数无效：action 和1至100个ids为必填')
    const ids = input.ids.map(parseBigIntId)
    if (new Set(ids.map(String)).size !== ids.length) invalid('ids 不可重复')
    const uid = parseBigIntId(userId)
    const needed = input.action === 'delete' ? 'domain:delete' : input.action === 'disable' ? 'domain:update' : 'domain:read'
    const authorized = roleType === RoleType.SUPER_ADMIN || new Set(permissions || []).has(needed)

    // Lock and verify the complete set before permission results or mutations can reveal item-level information.
    const domains = await this.prisma.$transaction(async (tx) => {
      const locked = await tx.$queryRaw(Prisma.sql`SELECT id FROM domains WHERE user_id = ${uid} AND deleted_at IS NULL AND id IN (${Prisma.join(ids)}) ORDER BY id FOR UPDATE`)
      if (!Array.isArray(locked) || locked.length !== ids.length) throw new BusinessException(ErrorCode.DOMAIN_NOT_FOUND)
      return tx.domain.findMany({ where: { id: { in: ids }, userId: uid, deletedAt: null } })
    })
    const byId = new Map(domains.map((row) => [row.id.toString(), row]))
    if (byId.size !== ids.length) throw new BusinessException(ErrorCode.DOMAIN_NOT_FOUND)
    if (!authorized) return ids.map((id) => ({ id: id.toString(), status: 'failed', code: ErrorCode.FORBIDDEN, message: '无权执行该批量操作' }))

    if (input.action === 'check') {
      const results: any[] = new Array(ids.length)
      let next = 0
      const workers = Array.from({ length: Math.min(4, ids.length) }, async () => {
        while (true) {
          const index = next++
          if (index >= ids.length) return
          const id = ids[index]
          try {
            const result = await this.checkDns(userId, id.toString())
            results[index] = result.error
              ? { id: id.toString(), status: 'failed', code: ErrorCode.PARAM_INVALID, message: result.error, result }
              : { id: id.toString(), status: 'successful', result }
          }
          catch (error) { results[index] = this.batchFailure(id, error) }
        }
      })
      await Promise.all(workers)
      return results
    }

    const results: any[] = []
    for (const id of ids) {
      try {
        const result = input.action === 'delete' ? await this.remove(userId, id.toString()) : await this.setEnabled(userId, id.toString(), false)
        results.push({ id: id.toString(), status: 'successful', result })
      } catch (error) { results.push(this.batchFailure(id, error)) }
    }
    return results
  }

  private batchFailure(id: bigint, error: unknown) {
    const code = error instanceof BusinessException ? error.code : 50001
    const message = error instanceof Error ? error.message : '操作失败'
    return { id: id.toString(), status: 'failed', code, message }
  }

  private async lockOwnedDomain(tx: any, userId: bigint, domainId: bigint): Promise<Domain> {
    const rows = await tx.$queryRaw(Prisma.sql`SELECT id FROM domains WHERE id = ${domainId} AND user_id = ${userId} AND deleted_at IS NULL FOR UPDATE`)
    if (!Array.isArray(rows) || rows.length === 0) throw new BusinessException(ErrorCode.DOMAIN_NOT_FOUND)
    const domain = await tx.domain.findFirst({ where: { id: domainId, userId, deletedAt: null } })
    if (!domain) throw new BusinessException(ErrorCode.DOMAIN_NOT_FOUND)
    return domain
  }

  async audit(id: string, approve: boolean, remark?: string) {
    const domainId = parseBigIntId(id)
    const row = await this.prisma.domain.findFirst({ where: { id: domainId, deletedAt: null } })
    if (!row) throw new BusinessException(ErrorCode.DOMAIN_NOT_FOUND)
    const updated = await this.prisma.domain.update({ where: { id: domainId }, data: {
      auditStatus: approve ? DomainAuditStatus.APPROVED : DomainAuditStatus.REJECTED,
      status: approve ? DomainStatus.DISABLED : DomainStatus.REJECTED,
      auditRemark: remark ?? null,
    } })
    return this.toVo(updated)
  }

  async adminList(query: { page: number; pageSize: number; keyword?: string; status?: number; auditStatus?: number }) {
    const where: Prisma.DomainWhereInput = { deletedAt: null }
    if (query.keyword) where.domain = { contains: query.keyword }
    if (query.status !== undefined) where.status = query.status
    if (query.auditStatus !== undefined) where.auditStatus = query.auditStatus
    const sort = DOMAIN_SORT_FIELDS.includes((query as any).sort) ? (query as any).sort : 'createdAt'
    const order = (query as any).order === 'asc' ? 'asc' : 'desc'
    const [total, rows] = await this.prisma.$transaction([
      this.prisma.domain.count({ where }),
      this.prisma.domain.findMany({ where, orderBy: { [sort]: order }, skip: (query.page - 1) * query.pageSize, take: query.pageSize }),
    ])
    return { total, list: rows.map((r) => this.toVo(r)) }
  }

  async checkDns(userId: string, id: string) {
    const domain = await this.requireOwned(userId, id)
    let answers: string[] = [], error: string | null = null
    let timer: ReturnType<typeof setTimeout> | undefined
    try {
      answers = await Promise.race([
        resolveCname(domain.domain),
        new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error('DNS lookup timeout')), 4000) }),
      ])
    } catch (e) { error = e instanceof Error ? e.message : 'DNS lookup failed' }
    finally { if (timer) clearTimeout(timer) }
    const observedAt = new Date()
    const matched = answers.some((a) => a.toLowerCase().replace(/\.$/, '') === domain.cname.toLowerCase())
    const record = { domain: domain.domain, expectedCname: domain.cname, observedCnames: answers, matched, checkedAt: observedAt.toISOString(), answers, error, observedAt: observedAt.toISOString(), deploymentEnabled: false }
    await this.prisma.auditLog.create({ data: { userId: parseBigIntId(userId), module: 'domain', action: 'dns_check', targetType: 'domain', targetId: domain.id, after: record as unknown as Prisma.InputJsonValue } })
    return record
  }

  private toVo(row: any): any {
    if (typeof row === 'bigint') return row.toString()
    if (row instanceof Date || row === null || typeof row !== 'object') return row
    if (Array.isArray(row)) return row.map((item) => this.toVo(item))
    return Object.fromEntries(Object.entries(row).map(([key, value]) => [key, this.toVo(value)]))
  }
}

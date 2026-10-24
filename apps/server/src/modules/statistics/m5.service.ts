/* eslint-disable @typescript-eslint/no-explicit-any, no-control-regex, no-useless-escape */
import { Injectable } from '@nestjs/common'
import { Cron, CronExpression } from '@nestjs/schedule'
import { ConfigService } from '@nestjs/config'
import { Prisma } from '@prisma/client'
import { ErrorCode } from '@lunar/shared'
import { isIP } from 'node:net'
import { createHash, timingSafeEqual } from 'node:crypto'
import { BusinessException } from '../../common/exceptions/business.exception'
import { PrismaService } from '../../database/prisma.service'
import { M5RealtimeGateway } from './m5-realtime.gateway'

const U64 = 18446744073709551615n
const HOUR = 3600000
const MAX_BATCH = 200
const MAX_PAGE = 100
const MAX_BODY_BYTES = 256 * 1024
const invalid = (message: string): never => { throw new BusinessException(ErrorCode.PARAM_INVALID, message) }
const parseId = (v: unknown, key: string): bigint => {
  if (typeof v !== 'string' || v.length > 20 || !/^[1-9]\d*$/.test(v)) return invalid(`${key} invalid`)
  const n = BigInt(v); if (n > U64) return invalid(`${key} invalid`); return n
}
const uint = (v: unknown, key: string): bigint => {
  if ((typeof v !== 'string' && typeof v !== 'number') || String(v).length > 20 || !/^\d+$/.test(String(v))) return invalid(`${key} must be uint64`)
  const n = BigInt(String(v)); if (n > U64) return invalid(`${key} exceeds uint64`); return n
}
const date = (v: unknown, key: string): Date => {
  if (typeof v !== 'string') return invalid(`${key} must be ISO timestamp with timezone`)
  const match = /^(\d{4})-(\d\d)-(\d\d)T(\d\d):(\d\d):(\d\d)(?:\.(\d+))?(Z|([+-])(\d\d):(\d\d))$/.exec(v)
  if (!match) return invalid(`${key} must be ISO timestamp with timezone`)
  const [, y, mo, day, hour, minute, second, fraction = '', zone, , offHour = '0', offMinute = '0'] = match
  const year = Number(y), month = Number(mo), dateOfMonth = Number(day), h = Number(hour), min = Number(minute), sec = Number(second)
  const calendar = new Date(Date.UTC(year, month - 1, dateOfMonth, h, min, sec))
  if (year < 1000 || year > 9999 || calendar.getUTCFullYear() !== year || calendar.getUTCMonth() !== month - 1 || calendar.getUTCDate() !== dateOfMonth || h > 23 || min > 59 || sec > 59 || Number(offHour) > 23 || Number(offMinute) > 59) return invalid(`${key} invalid`)
  // JavaScript accepts more than three fractional digits but truncates them; all accepted variants resolve consistently to milliseconds.
  const normalized = `${y}-${mo}-${day}T${hour}:${minute}:${second}${fraction ? `.${fraction.slice(0, 3).padEnd(3, '0')}` : ''}${zone}`
  const d = new Date(normalized)
  if (!Number.isFinite(d.getTime())) return invalid(`${key} invalid`)
  return d
}
const sqlDate = (d: Date) => d.toISOString().slice(0, 19).replace('T', ' ')
const str = (v: unknown, key: string, max: number) => {
  if (typeof v !== 'string' || v.length > max || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(v)) return invalid(`${key} invalid`)
  return v
}
const csvCell = (input: unknown): string => {
  let s = String(input ?? '')
  if (/^[\s\u0000-\u001f]*[=+@\-]/.test(s)) s = `'${s}`
  return `"${s.replace(/"/g, '""')}"`
}

@Injectable()
export class M5Service {
  private readonly reportSecret: string
  private reportWindows = new Map<string, { start: number; count: number }>()
  constructor(private readonly db: PrismaService, config: ConfigService, private readonly realtime?: M5RealtimeGateway) { this.reportSecret = config.get<string>('nodeReportToken') ?? '' }

  private async ownedDomains(ids: string[]) {
    if (!ids.length) return []
    return this.db.$queryRaw<{ id: string; user_id?: string }[]>(Prisma.sql`SELECT CAST(id AS CHAR) AS id, CAST(user_id AS CHAR) AS user_id FROM domains WHERE id IN (${Prisma.join(ids.map(id => Prisma.sql`CAST(${id} AS UNSIGNED)`))}) AND deleted_at IS NULL`)
  }

  private authenticateNode(headers: Record<string, unknown>, ip = '') {
    const token = headers['x-node-token']; const timestamp = headers['x-timestamp']
    if (typeof token !== 'string' || typeof timestamp !== 'string' || !/^\d{10}$/.test(timestamp)) throw new BusinessException(ErrorCode.UNAUTHORIZED)
    const secret = this.reportSecret
    // Hash both inputs to fixed-size buffers; timingSafeEqual never leaks token length.
    const supplied = createHash('sha256').update(token).digest()
    const expected = createHash('sha256').update(secret || 'reporting-disabled').digest()
    const equal = timingSafeEqual(supplied, expected)
    if (!secret || secret.length < 32 || !equal || Math.abs(Date.now() - Number(timestamp) * 1000) > 300000) throw new BusinessException(ErrorCode.UNAUTHORIZED)
    const now = Date.now(), window = this.reportWindows.get(ip)
    if (!window || now - window.start >= 60000) this.reportWindows.set(ip, { start: now, count: 1 })
    else if (++window.count > 30) throw new BusinessException(ErrorCode.FORBIDDEN, 'Reporting rate limit exceeded')
    if (this.reportWindows.size > 5000) this.reportWindows.clear()
  }
  async reportTraffic(headers: Record<string, unknown>, ip: string, body: any) {
    this.authenticateNode(headers, ip)
    if (!body || typeof body !== 'object' || Buffer.byteLength(JSON.stringify(body)) > MAX_BODY_BYTES || !Array.isArray(body.stats) || body.stats.length < 1 || body.stats.length > MAX_BATCH) return invalid('invalid report batch')
    if (Object.hasOwn(body, 'nodeId')) return invalid('M5 accepts one platform collector snapshot only; nodeId is unsupported')
    const records = body.stats.map((x: any) => {
      const domainId = parseId(String(x?.domainId), 'domainId')
      const time = date(x?.time, 'time'); if (time.getTime() % HOUR !== 0 || time.getTime() > Date.now() + 300000) return invalid('time must be a current or past UTC hour')
      const traffic = uint(x?.traffic, 'traffic'), requests = uint(x?.requests ?? '0', 'requests')
      const bandwidthPeak = uint(x?.bandwidthPeak ?? '0', 'bandwidthPeak')
      const cacheHit = uint(x?.cacheHit ?? '0', 'cacheHit'), cacheMiss = uint(x?.cacheMiss ?? '0', 'cacheMiss')
      if (cacheHit + cacheMiss > requests) return invalid('cache counters exceed requests')
      const statuses = x?.statusCodes ?? {}
      if (!statuses || typeof statuses !== 'object' || Array.isArray(statuses) || Object.keys(statuses).length > 100) return invalid('invalid statusCodes')
      const statusRows = Object.entries(statuses).map(([code, count]) => {
        if (!/^[1-5]\d\d$/.test(code)) return invalid('status code invalid')
        return { code: Number(code), requests: uint(count, 'status requests') }
      })
      if (statusRows.reduce((a, b) => a + b.requests, 0n) > requests) return invalid('status counters exceed requests')
      return { domainId, time, traffic, requests, bandwidthPeak, cacheHit, cacheMiss, statusRows }
    })
    const domains: string[] = [...new Set<string>(records.map((x: any) => x.domainId.toString()))]
    const owned = await this.ownedDomains(domains)
    if (owned.length !== domains.length) throw new BusinessException(ErrorCode.DOMAIN_NOT_FOUND)
    await this.db.$transaction(async tx => {
      for (const r of records) {
        const time = sqlDate(r.time)
        await tx.$executeRaw(Prisma.sql`INSERT INTO traffic_stats_hourly (user_id,domain_id,stat_time,source,traffic,requests,bandwidth_peak,cache_hit,cache_miss) SELECT d.user_id,d.id,${time},'node',CAST(${r.traffic.toString()} AS DECIMAL(20,0)),CAST(${r.requests.toString()} AS DECIMAL(40,0)),CAST(${r.bandwidthPeak.toString()} AS DECIMAL(40,0)),CAST(${r.cacheHit.toString()} AS DECIMAL(40,0)),CAST(${r.cacheMiss.toString()} AS DECIMAL(40,0)) FROM domains d WHERE d.id=CAST(${r.domainId.toString()} AS UNSIGNED) AND d.deleted_at IS NULL ON DUPLICATE KEY UPDATE traffic=VALUES(traffic),requests=VALUES(requests),bandwidth_peak=VALUES(bandwidth_peak),cache_hit=VALUES(cache_hit),cache_miss=VALUES(cache_miss)`)
        await tx.$executeRaw(Prisma.sql`DELETE FROM traffic_status_hourly WHERE domain_id=CAST(${r.domainId.toString()} AS UNSIGNED) AND source='node' AND stat_time=${time}`)
        for (const s of r.statusRows) await tx.$executeRaw(Prisma.sql`INSERT INTO traffic_status_hourly(user_id,domain_id,stat_time,source,status_code,requests) SELECT d.user_id,d.id,${time},'node',${s.code},CAST(${s.requests.toString()} AS DECIMAL(40,0)) FROM domains d WHERE d.id=CAST(${r.domainId.toString()} AS UNSIGNED) AND d.deleted_at IS NULL ON DUPLICATE KEY UPDATE requests=VALUES(requests)`)
      }
    })
    return { accepted: records.length }
  }
  async reportLogs(headers: Record<string, unknown>, ip: string, body: any) {
    this.authenticateNode(headers, ip)
    if (!body || typeof body !== 'object' || Buffer.byteLength(JSON.stringify(body)) > MAX_BODY_BYTES || !Array.isArray(body.logs) || body.logs.length < 1 || body.logs.length > MAX_BATCH) return invalid('invalid log batch')
    if (Object.hasOwn(body, 'nodeId')) return invalid('M5 accepts one platform collector snapshot only; nodeId is unsupported')
    const logs = body.logs.map((x: any) => {
      const eventTime = date(x?.time, 'time'); if (eventTime.getTime() > Date.now() + 300000) return invalid('event time is in the future')
      const domainId = parseId(String(x?.domainId), 'domainId'); const address = str(x?.ip, 'ip', 45)
      if (!isIP(address)) return invalid('ip invalid')
      const url = str(x?.url, 'url', 2048); if (!url.startsWith('/') || url.startsWith('//') || /[\r\n\\]/.test(url)) return invalid('url must be a relative path')
      const status = Number(x?.status); if (!Number.isInteger(status) || status < 100 || status > 599) return invalid('status invalid')
      return { domainId, eventTime, ip: address, url, status, bytes: uint(x?.bytes ?? '0', 'bytes'), userAgent: x?.ua == null ? null : str(x.ua, 'ua', 512), region: x?.region == null ? null : str(x.region, 'region', 96), isp: x?.isp == null ? null : str(x.isp, 'isp', 96) }
    })
    const ids: string[] = [...new Set<string>(logs.map((x: any) => x.domainId.toString()))]
    const owned = await this.ownedDomains(ids)
    if (owned.length !== ids.length) throw new BusinessException(ErrorCode.DOMAIN_NOT_FOUND)
    const byId = new Map(owned.map(x => [String(x.id), String(x.user_id)]))
    const retention = await this.db.$queryRaw<{ domain_id: string; retention_days: number }[]>(Prisma.sql`SELECT CAST(domain_id AS CHAR) AS domain_id,retention_days FROM log_delivery_configs WHERE domain_id IN (${Prisma.join(ids.map(id => Prisma.sql`CAST(${id} AS UNSIGNED)`))})`)
    const retentionDays = new Map(retention.map(x => [String(x.domain_id), Number(x.retention_days)]))
    await this.db.$transaction(async tx => {
      for (const x of logs) {
        const domainId = x.domainId.toString(), userId = byId.get(domainId)!
        const expiresAt = new Date(Date.now() + (retentionDays.get(domainId) ?? 30) * 86400000)
        await tx.$executeRaw(Prisma.sql`INSERT INTO access_logs(user_id,domain_id,event_time,ip,url,status_code,bytes,user_agent,region,isp,source,expires_at) VALUES (CAST(${userId} AS UNSIGNED),CAST(${domainId} AS UNSIGNED),${sqlDate(x.eventTime)},${x.ip},${x.url},${x.status},CAST(${x.bytes.toString()} AS UNSIGNED),${x.userAgent},${x.region},${x.isp},'node',${sqlDate(expiresAt)})`)
      }
    })
    for (const x of logs) this.realtime?.publish({ domainId: x.domainId.toString(), eventTime: x.eventTime, ip: x.ip, url: x.url, statusCode: x.status, bytes: x.bytes.toString(), userAgent: x.userAgent, region: x.region, isp: x.isp })
    return { accepted: logs.length }
  }

  private async range(userId: string, q: any, granularity = true) {
    const user = parseId(userId, 'userId'); const domainId = q.domainId == null ? undefined : parseId(q.domainId, 'domainId')
    const g = q.granularity ?? 'hour'; if (granularity && !['hour','day','week','month'].includes(g)) return invalid('granularity unsupported')
    let end: Date
    if (q.endTime === undefined) {
      end = new Date()
      if (!granularity) { /* access logs accept arbitrary second boundaries */ }
      else if (g === 'hour') end.setUTCMinutes(0,0,0)
      else if (g === 'day') end.setUTCHours(0,0,0,0)
      else if (g === 'week') { end.setUTCHours(0,0,0,0); end.setUTCDate(end.getUTCDate()-((end.getUTCDay()+6)%7)) }
      else { end.setUTCHours(0,0,0,0); end.setUTCDate(1) }
    } else end = date(q.endTime,'endTime')
    let start: Date
    if (q.startTime !== undefined) start = date(q.startTime,'startTime')
    else { start = new Date(end); if (!granularity || g === 'hour') start.setTime(end.getTime()-24*HOUR); else if (g === 'day') start.setUTCDate(start.getUTCDate()-30); else if (g === 'week') start.setUTCDate(start.getUTCDate()-28); else start.setUTCMonth(start.getUTCMonth()-12) }
    const max = !granularity || g === 'hour' ? 31*86400000 : 366*86400000
    const aligned = (d: Date) => g === 'hour' ? d.getTime() % HOUR === 0
      : g === 'day' ? d.getUTCHours() === 0 && d.getUTCMinutes() === 0 && d.getUTCSeconds() === 0
      : g === 'week' ? d.getUTCHours() === 0 && d.getUTCMinutes() === 0 && d.getUTCSeconds() === 0 && d.getUTCDay() === 1
      : d.getUTCHours() === 0 && d.getUTCMinutes() === 0 && d.getUTCSeconds() === 0 && d.getUTCDate() === 1
    if (start >= end || end.getTime()-start.getTime()>max || (granularity && (!aligned(start) || !aligned(end)))) return invalid('range invalid, too large, or not aligned to UTC bucket boundaries')
    if (domainId) { const rows=await this.ownedDomains([domainId.toString()]); if(!rows.length || rows[0].user_id !== user.toString()) throw new BusinessException(ErrorCode.DOMAIN_NOT_FOUND) }
    return { user, domainId, start, end, g }
  }
  async stat(userId: string, kind: string, q: any) {
    const r=await this.range(userId,q); const filter = r.domainId ? Prisma.sql`AND t.domain_id=${r.domainId}` : Prisma.empty
    if (['traffic','bandwidth','requests','hitrate'].includes(kind)) {
      const col = kind==='traffic' ? 'traffic' : kind==='requests' ? 'requests' : kind==='bandwidth' ? 'bandwidth_peak' : 'requests'
      const rows=await this.db.$queryRaw<any[]>(Prisma.sql`SELECT t.stat_time AS at, CAST(SUM(t.${Prisma.raw(col)}) AS CHAR) AS value, CAST(SUM(t.cache_hit) AS CHAR) AS hit, CAST(SUM(t.cache_miss) AS CHAR) AS miss FROM traffic_stats_hourly t JOIN domains d ON d.id=t.domain_id WHERE t.user_id=${r.user} AND d.user_id=${r.user} AND d.deleted_at IS NULL AND t.stat_time>=${sqlDate(r.start)} AND t.stat_time<${sqlDate(r.end)} ${filter} GROUP BY t.stat_time ORDER BY t.stat_time ASC LIMIT 9000`)
      const grouped=new Map<string,{value:bigint,hit:bigint,miss:bigint}>(); const bucket=(d:Date)=>{const x=new Date(d); if(r.g==='day')x.setUTCHours(0,0,0,0); else if(r.g==='week'){x.setUTCHours(0,0,0,0);x.setUTCDate(x.getUTCDate()-((x.getUTCDay()+6)%7))} else if(r.g==='month'){x.setUTCHours(0,0,0,0);x.setUTCDate(1)} return x.toISOString()}
      for(const x of rows){const k=bucket(new Date(x.at)),o=grouped.get(k)||{value:0n,hit:0n,miss:0n};o.value+=BigInt(x.value??0);o.hit+=BigInt(x.hit??0);o.miss+=BigInt(x.miss??0);grouped.set(k,o)}
      const series=[...grouped].sort(([a],[b])=>a.localeCompare(b)).map(([time,x])=>({time,value:x.value.toString(),...(kind==='hitrate'?{hit:x.hit.toString(),miss:x.miss.toString(),percent:(x.hit+x.miss?Number(x.hit*10000n/(x.hit+x.miss))/100:0)}:{})}))
      return {granularity:r.g,startTime:r.start.toISOString(),endTime:r.end.toISOString(),unit:kind==='traffic'?'bytes':kind==='bandwidth'?'bytes_per_second':'requests',series,total:series.reduce((s,x)=>s+BigInt(x.value),0n).toString()}
    }
    const groupCol:Record<string,string>={region:'region',isp:'isp','status-code':'status_code','top-url':'url','top-ip':'ip'}; const col=groupCol[kind]; if(!col)return invalid('report unsupported')
    const isStatus=kind==='status-code'
    const rows= isStatus ? await this.db.$queryRaw<any[]>(Prisma.sql`SELECT s.status_code AS key, CAST(SUM(s.requests) AS CHAR) AS requests FROM traffic_status_hourly s JOIN domains d ON d.id=s.domain_id WHERE s.user_id=${r.user} AND d.user_id=${r.user} AND d.deleted_at IS NULL AND s.stat_time>=${sqlDate(r.start)} AND s.stat_time<${sqlDate(r.end)} ${r.domainId?Prisma.sql`AND s.domain_id=${r.domainId}`:Prisma.empty} GROUP BY s.status_code ORDER BY SUM(s.requests) DESC,s.status_code ASC LIMIT 100`)
    : await this.db.$queryRaw<any[]>(Prisma.sql`SELECT l.${Prisma.raw(col)} AS key, CAST(COUNT(*) AS CHAR) AS requests, CAST(SUM(l.bytes) AS CHAR) AS bytes FROM access_logs l JOIN domains d ON d.id=l.domain_id WHERE l.user_id=${r.user} AND d.user_id=${r.user} AND d.deleted_at IS NULL AND l.expires_at>UTC_TIMESTAMP() AND l.event_time>=${sqlDate(r.start)} AND l.event_time<${sqlDate(r.end)} ${r.domainId?Prisma.sql`AND l.domain_id=${r.domainId}`:Prisma.empty} GROUP BY l.${Prisma.raw(col)} ORDER BY COUNT(*) DESC,l.${Prisma.raw(col)} ASC LIMIT 100`)
    return {items:rows.map(x=>({key:x.key,requests:String(x.requests),...(x.bytes!==undefined?{bytes:String(x.bytes)}:{})}))}
  }
  async accessLogs(userId: string,q:any) {
    const r=await this.range(userId,q,false); const page=Number(q.page??1), pageSize=Number(q.pageSize??50)
    if(!Number.isInteger(page)||page<1||page>1000000||!Number.isInteger(pageSize)||pageSize<1||pageSize>MAX_PAGE)return invalid('page/pageSize invalid')
    const clauses: Prisma.Sql[]=[Prisma.sql`l.user_id=CAST(${r.user.toString()} AS UNSIGNED)`,Prisma.sql`d.user_id=CAST(${r.user.toString()} AS UNSIGNED)`,Prisma.sql`d.deleted_at IS NULL`,Prisma.sql`l.expires_at>UTC_TIMESTAMP()`,Prisma.sql`l.event_time>=${sqlDate(r.start)}`,Prisma.sql`l.event_time<${sqlDate(r.end)}`]
    if(r.domainId)clauses.push(Prisma.sql`l.domain_id=CAST(${r.domainId.toString()} AS UNSIGNED)`)
    if(q.statusCode!==undefined){const s=Number(q.statusCode);if(!Number.isInteger(s)||s<100||s>599)return invalid('statusCode invalid');clauses.push(Prisma.sql`l.status_code=${s}`)}
    if(q.ip!==undefined){const ip=str(q.ip,'ip',45);if(!isIP(ip))return invalid('ip invalid');clauses.push(Prisma.sql`l.ip=${ip}`)}
    if(q.url!==undefined)clauses.push(Prisma.sql`LOCATE(${str(q.url,'url',128)},l.url)>0`)
    if(q.userAgent!==undefined)clauses.push(Prisma.sql`LOCATE(${str(q.userAgent,'userAgent',128)},l.user_agent)>0`)
    const rows=await this.db.$queryRaw<any[]>(Prisma.sql`SELECT CAST(l.id AS CHAR) AS id,CAST(l.domain_id AS CHAR) AS domainId,l.event_time AS eventTime,l.ip,l.url,l.status_code AS statusCode,CAST(l.bytes AS CHAR) AS bytes,l.user_agent AS userAgent,l.region,l.isp FROM access_logs l JOIN domains d ON d.id=l.domain_id WHERE ${Prisma.join(clauses,' AND ')} ORDER BY l.event_time DESC,l.id DESC LIMIT ${pageSize} OFFSET ${(page-1)*pageSize}`)
    return {page,pageSize,list:rows.map(x=>({...x,id:String(x.id),domainId:String(x.domainId),bytes:String(x.bytes)}))}
  }
  async exportLogs(userId:string,q:any) {
    const MAX_EXPORT=5000, MAX_CSV_BYTES=5*1024*1024
    const csv=['time,domainId,ip,url,statusCode,bytes,userAgent,region,isp']
    for(let page=1;page<=Math.ceil(MAX_EXPORT/MAX_PAGE);page++){
      const rows=await this.accessLogs(userId,{...q,page,pageSize:MAX_PAGE})
      for(const row of rows.list){csv.push([row.eventTime.toISOString(),row.domainId,row.ip,row.url,row.statusCode,row.bytes,row.userAgent,row.region,row.isp].map(csvCell).join(','));if(csv.length>MAX_EXPORT+1)return invalid(`export exceeds ${MAX_EXPORT} rows; narrow filters`)}
      if(rows.list.length<MAX_PAGE)break
      if(page===Math.ceil(MAX_EXPORT/MAX_PAGE)){
        const next=await this.accessLogs(userId,{...q,page:page+1,pageSize:1})
        if(next.list.length)return invalid(`export exceeds ${MAX_EXPORT} rows; narrow filters`)
      }
    }
    const text=csv.join('\r\n'); if(Buffer.byteLength(text)>MAX_CSV_BYTES)return invalid('export exceeds 5 MiB; narrow filters')
    return text
  }
  @Cron(CronExpression.EVERY_DAY_AT_3AM)
  async pruneExpiredLogs() { return this.db.accessLog.deleteMany({ where: { expiresAt: { lt: new Date() } } }) }

  async delivery(userId:string,domainInput:string,body?:any) {
    const user=parseId(userId,'userId'),domain=parseId(domainInput,'domainId')
    const owned=await this.db.domain.findFirst({where:{id:domain,userId:user,deletedAt:null},select:{id:true}});if(!owned)throw new BusinessException(ErrorCode.DOMAIN_NOT_FOUND)
    if(body===undefined){const x=await this.db.logDeliveryConfig.findUnique({where:{domainId:domain}});return {domainId:String(domain),enabled:false,retentionDays:x?.retentionDays??30,webhookDeliverySupported:false,deliveryStatus:'unsupported'}}
    if(!body||typeof body!=='object'||Object.keys(body).some(k=>!['enabled','retentionDays'].includes(k))||body.enabled===true||(body.enabled!==undefined&&body.enabled!==false)||!Number.isInteger(body.retentionDays)||body.retentionDays<1||body.retentionDays>30)return invalid('webhook delivery is unsupported; only retentionDays (1..30) can be configured')
    const x=await this.db.logDeliveryConfig.upsert({where:{domainId:domain},create:{domainId:domain,userId:user,enabled:false,retentionDays:body.retentionDays},update:{userId:user,enabled:false,retentionDays:body.retentionDays}})
    return {domainId:String(domain),enabled:false,retentionDays:x.retentionDays,webhookDeliverySupported:false,deliveryStatus:'unsupported'}
  }
  statisticsCsv(userId:string,q:any){return this.stat(userId,String(q.report??'traffic'),q).then(x=>{const lines=['time,value'];for(const row of (x.series??[]))lines.push(`${csvCell(row.time)},${csvCell(row.value)}`);const out=lines.join('\r\n');if(Buffer.byteLength(out)>1024*1024)invalid('export exceeds 1 MiB');return out})}
}

import { Injectable } from '@nestjs/common'
import { ErrorCode } from '@lunar/shared'
import { isIP } from 'node:net'
import { BusinessException } from '../../common/exceptions/business.exception'
import { PrismaService } from '../../database/prisma.service'
import { safeHttpProbe } from '../../shared/http/safe-http'

const MAX_RULES = 100
const MAX_ORIGINS = 20
const MAX_UNSIGNED_BIGINT = 18446744073709551615n
const CACHE_FIELDS = ['name', 'matchType', 'matchValue', 'matchMode', 'action', 'ttl', 'ignoreParams', 'cacheKey', 'status'] as const
const ORIGIN_FIELDS = ['address', 'port', 'weight', 'protocol', 'host', 'status', 'isBackup'] as const
const GROUP_FIELDS = ['name', 'lbPolicy', 'healthCheck'] as const
const CACHE_ENUMS = {
  matchType: ['path', 'extension', 'file_type', 'status', 'header', 'query', 'all'],
  matchMode: ['exact', 'prefix', 'suffix', 'contains', 'regex'],
  action: ['cache', 'bypass', 'force_cache'],
} as const

@Injectable()
export class DomainResourceService {
  constructor(private readonly prisma: PrismaService) {}

  async listCacheRules(userId: string, domainId: string): Promise<unknown[]> {
    const id = this.parseId(domainId, 'domainId')
    await this.ownedDomain(this.prisma as any, this.parseId(userId, 'userId'), id)
    const rows = await (this.prisma as any).cacheRule.findMany({ where: { domainId: id }, orderBy: [{ priority: 'asc' }, { id: 'asc' }] })
    return rows.map((row: unknown) => this.serialize(row))
  }

  async createCacheRule(userId: string, domainId: string, body: unknown): Promise<unknown> {
    const user = this.parseId(userId, 'userId')
    const domain = this.parseId(domainId, 'domainId')
    const data = this.cacheRuleInput(body, true)
    return this.prisma.$transaction(async (tx) => {
      const db = tx as any
      await this.lockOwnedDomain(db, user, domain)
      const count = await db.cacheRule.count({ where: { domainId: domain } })
      if (count >= MAX_RULES) return this.invalid('每个域名最多配置100条缓存规则')
      const max = await db.cacheRule.aggregate({ where: { domainId: domain }, _max: { priority: true } })
      const row = await db.cacheRule.create({ data: { ...data, domainId: domain, priority: (max._max.priority ?? -1) + 1, status: data.status ?? 1 } })
      return this.serialize(row)
    })
  }

  async updateCacheRule(userId: string, domainId: string, ruleId: string, body: unknown): Promise<unknown> {
    const user = this.parseId(userId, 'userId')
    const domain = this.parseId(domainId, 'domainId')
    const rule = this.parseId(ruleId, 'ruleId')
    if (!this.isRecord(body)) return this.invalid('缓存规则参数无效')
    this.assertKeys(body, CACHE_FIELDS)
    await this.ownedDomain(this.prisma as any, user, domain)
    const db = this.prisma as any
    const existing = await db.cacheRule.findFirst({ where: { id: rule, domainId: domain } })
    if (!existing) return this.notFound()
    const current = Object.fromEntries(CACHE_FIELDS.filter((key) => key in existing).map((key) => [key, existing[key]]))
    const effective = { ...current, ...body }
    if (body.matchType === 'all' && !('matchValue' in body)) effective.matchValue = ''
    const validated = this.cacheRuleInput(effective, false)
    const data = Object.fromEntries(Object.keys(body).map((key) => [key, validated[key]]))
    if (validated.matchType === 'all' && ('matchType' in body || 'matchValue' in body)) data.matchValue = ''
    const row = await db.cacheRule.update({ where: { id: rule }, data })
    return this.serialize(row)
  }

  async deleteCacheRule(userId: string, domainId: string, ruleId: string): Promise<{ deleted: true }> {
    const user = this.parseId(userId, 'userId')
    const domain = this.parseId(domainId, 'domainId')
    const rule = this.parseId(ruleId, 'ruleId')
    await this.ownedDomain(this.prisma as any, user, domain)
    const db = this.prisma as any
    const existing = await db.cacheRule.findFirst({ where: { id: rule, domainId: domain }, select: { id: true } })
    if (!existing) return this.notFound()
    await db.cacheRule.delete({ where: { id: rule } })
    return { deleted: true }
  }

  async sortCacheRules(userId: string, domainId: string, body: unknown): Promise<unknown[]> {
    const user = this.parseId(userId, 'userId')
    const domain = this.parseId(domainId, 'domainId')
    if (!this.isRecord(body) || Object.keys(body).length !== 1 || !Array.isArray(body.ruleIds) || body.ruleIds.some((id) => typeof id !== 'string')) {
      return this.invalid('ruleIds 必须是缓存规则ID数组')
    }
    const ids = (body.ruleIds as string[]).map((id) => this.parseId(id, 'ruleIds'))
    if (new Set(ids.map(String)).size !== ids.length) return this.invalid('ruleIds 不可重复')
    return this.prisma.$transaction(async (tx) => {
      const db = tx as any
      await this.lockOwnedDomain(db, user, domain)
      const rows = await db.cacheRule.findMany({ where: { domainId: domain }, select: { id: true } })
      if (rows.length !== ids.length || ids.some((id) => !rows.some((row: any) => row.id === id))) return this.invalid('ruleIds 必须完整匹配该域名的缓存规则')
      for (let priority = 0; priority < ids.length; priority++) {
        await db.cacheRule.updateMany({ where: { id: ids[priority], domainId: domain }, data: { priority } })
      }
      const sorted = await db.cacheRule.findMany({ where: { domainId: domain }, orderBy: [{ priority: 'asc' }, { id: 'asc' }] })
      return sorted.map((row: unknown) => this.serialize(row))
    })
  }

  async listOrigins(userId: string, domainId: string): Promise<{ groups: unknown[] }> {
    const user = this.parseId(userId, 'userId')
    const domain = this.parseId(domainId, 'domainId')
    await this.ownedDomain(this.prisma as any, user, domain)
    const groups = await (this.prisma as any).originGroup.findMany({ where: { domainId: domain }, include: { origins: { orderBy: { id: 'asc' } } }, orderBy: { id: 'asc' } })
    return { groups: groups.map((group: unknown) => this.serialize(group)) }
  }

  async createOriginGroup(userId: string, domainId: string, body: unknown): Promise<unknown> {
    const user = this.parseId(userId, 'userId')
    const domain = this.parseId(domainId, 'domainId')
    if (!this.isRecord(body)) return this.invalid('源站组参数无效')
    this.assertKeys(body, ['name', 'lbPolicy', 'healthCheck', 'origins'])
    if (!Array.isArray(body.origins) || body.origins.length < 1) return this.invalid('origins 至少包含一个源站')
    const originInputs = body.origins.map((origin) => this.originInput(origin, true))
    const groupRequest = Object.fromEntries(GROUP_FIELDS.filter((key) => key in body).map((key) => [key, body[key]]))
    const fields = this.groupInput(groupRequest, false)
    if (body.name === undefined) fields.name = '默认源站组'
    const policy = String(fields.lbPolicy ?? 'round_robin')
    this.assertOriginRoles(policy, originInputs)
    const originGroupData = { ...fields, ...(body.healthCheck !== undefined ? { healthCheck: this.healthCheckConfig(body.healthCheck) } : {}) }
    return this.prisma.$transaction(async (tx) => {
      const db = tx as any
      await this.lockOwnedDomain(db, user, domain)
      const count = await db.origin.count({ where: { group: { domainId: domain } } })
      if (count + originInputs.length > MAX_ORIGINS) return this.invalid('每个域名最多配置20个源站')
      const group = await db.originGroup.create({
        data: {
          ...originGroupData,
          domainId: domain,
          origins: { create: originInputs.map((origin) => ({ ...origin, status: origin.status ?? 1 })) },
        },
        include: { origins: { orderBy: { id: 'asc' } } },
      })
      return this.serialize(group)
    })
  }

  async updateOrigin(userId: string, domainId: string, originId: string, body: unknown): Promise<unknown> {
    const user = this.parseId(userId, 'userId')
    const domain = this.parseId(domainId, 'domainId')
    const origin = this.parseId(originId, 'originId')
    const data = this.originInput(body, false)
    return this.prisma.$transaction(async (tx) => {
      const db = tx as any
      await this.lockOwnedDomain(db, user, domain)
      const { existing, group: originGroup } = await this.originAndGroup(db, domain, origin)
      if (!existing) return this.notFound()
      const policy = originGroup.lbPolicy
      const origins = originGroup.origins as any[]
      if (policy !== 'primary_backup' && data.isBackup === true) return this.invalid('仅 primary_backup 策略允许 isBackup=true')
      const effective = origins.map((row) => ({ ...row }))
      const selected = effective.find((row) => row.id === origin)!
      if (policy === 'primary_backup' && 'isBackup' in data && data.isBackup !== selected.isBackup) {
        if (data.isBackup === true) {
          const replacement = effective.find((row) => row.id !== origin && row.isBackup === true)
          if (!replacement) return this.invalid('不能移除唯一主源站')
          replacement.isBackup = false
          selected.isBackup = true
        } else {
          const previousPrimary = effective.find((row) => row.id !== origin && row.isBackup !== true)
          if (!previousPrimary) return this.invalid('源站组必须保留一个主源站')
          previousPrimary.isBackup = true
          selected.isBackup = false
        }
      } else Object.assign(selected, data)
      // Validate the final role set before persisting any part of the change.
      this.assertOriginRoles(policy, effective)
      for (const row of effective) {
        const changedRole = row.id !== origin && row.isBackup !== origins.find((item) => item.id === row.id)?.isBackup
        if (row.id === origin || changedRole) {
          const roleData = { ...(row.id === origin ? data : {}), isBackup: row.isBackup }
          await db.origin.update({ where: { id: row.id }, data: roleData })
        }
      }
      return this.serialize(effective.find((row) => row.id === origin))
    })
  }

  async deleteOrigin(userId: string, domainId: string, originId: string): Promise<{ deleted: true }> {
    const user = this.parseId(userId, 'userId')
    const domain = this.parseId(domainId, 'domainId')
    const origin = this.parseId(originId, 'originId')
    return this.prisma.$transaction(async (tx) => {
      const db = tx as any
      await this.lockOwnedDomain(db, user, domain)
      const { existing, group: originGroup } = await this.originAndGroup(db, domain, origin)
      if (!existing) return this.notFound()
      const policy = originGroup.lbPolicy
      const remaining = (originGroup.origins as any[]).filter((row) => row.id !== origin).map((row) => ({ ...row }))
      if (policy === 'primary_backup' && existing.isBackup !== true) {
        const backups = remaining.filter((row) => row.isBackup === true && row.status !== 0)
        if (backups.length < 2) return this.invalid('删除主源站前至少需要保留一个备源站；请先增加备源站')
        backups[0].isBackup = false
        await db.origin.update({ where: { id: backups[0].id }, data: { isBackup: false } })
      }
      this.assertOriginRoles(policy, remaining)
      await db.origin.delete({ where: { id: origin } })
      return { deleted: true }
    })
  }

  async updateOriginGroup(userId: string, domainId: string, groupId: string, body: unknown): Promise<unknown> {
    const user = this.parseId(userId, 'userId')
    const domain = this.parseId(domainId, 'domainId')
    const group = this.parseId(groupId, 'groupId')
    const data = this.groupInput(this.isRecord(body) ? body : this.invalid('请求数据必须为对象'), true)
    return this.prisma.$transaction(async (tx) => {
      const db = tx as any
      await this.lockOwnedDomain(db, user, domain)
      const existing = await db.originGroup.findFirst({ where: { id: group, domainId: domain }, include: { origins: { orderBy: { id: 'asc' } } } })
      if (!existing) return this.notFound()
      const previousPolicy = existing.lbPolicy
      const nextPolicy = String(data.lbPolicy ?? previousPolicy)
      const origins = (existing.origins as any[]).map((row) => ({ ...row }))
      if (nextPolicy === 'primary_backup' && previousPolicy !== 'primary_backup') {
        // Explicit, deterministic conversion: lowest-ID active source becomes primary; all others become backups.
        if (origins.filter((row) => row.status !== 0).length < 2) return this.invalid('转换为 primary_backup 前至少要有两个启用的源站；系统将按ID升序将首个启用源站设为主站，其余设为备站')
        let primaryChosen = false
        origins.forEach((row) => { row.isBackup = primaryChosen || row.status === 0; if (row.status !== 0 && !primaryChosen) primaryChosen = true })
      } else if (nextPolicy !== 'primary_backup') {
        // Leaving primary_backup normalizes all role markers back to legacy non-backup values.
        origins.forEach((row) => { row.isBackup = false })
      }
      this.assertOriginRoles(nextPolicy, origins)
      for (const row of origins) {
        if (row.isBackup !== (existing.origins.find((item: any) => item.id === row.id)?.isBackup ?? false)) {
          await db.origin.update({ where: { id: row.id }, data: { isBackup: row.isBackup } })
        }
      }
      const updated = await db.originGroup.update({ where: { id: group }, data, include: { origins: { orderBy: { id: 'asc' } } } })
      return this.serialize(updated)
    })
  }

  /** @deprecated Kept only for direct callers from pre-M3 integrations; HTTP route now probes safely. */
  healthCheckUnavailable(): never { throw Object.assign(new Error('健康检查探测接口已更新'), { status: 501 }) }

  async healthCheck(userId: string, domainId: string, body: unknown): Promise<{ results: unknown[] }> {
    const user = this.parseId(userId, 'userId')
    const domain = this.parseId(domainId, 'domainId')
    if (!this.isRecord(body) || Object.keys(body).length !== 1 || !Array.isArray(body.originIds) || body.originIds.length < 1 || body.originIds.length > MAX_ORIGINS || body.originIds.some(id => typeof id !== 'string')) return this.invalid('originIds 必须是1至20个已保存源站ID')
    const ids = body.originIds.map((id: string) => this.parseId(id, 'originIds'))
    if (new Set(ids.map(String)).size !== ids.length) return this.invalid('originIds 不可重复')
    await this.ownedDomain(this.prisma as any, user, domain)
    const rows = await (this.prisma as any).origin.findMany({ where: { id: { in: ids }, group: { domainId: domain } }, include: { group: true } })
    if (rows.length !== ids.length) return this.notFound()
    const results: unknown[] = new Array(rows.length)
    let next = 0
    const worker = async () => { while (true) {
      const index = next++
      if (index >= rows.length) return
      const row = rows[index]
      const group = row.group
      const hc = group?.healthCheck
      const path = hc?.path ?? '/'
      const hostHeader = row.host ?? row.address
      const result = await safeHttpProbe({ address: row.address, port: row.port, protocol: row.protocol, hostHeader, path }, { timeoutMs: Math.min(5000, Math.max(1, Number(hc?.timeout ?? 3) * 1000)) })
      results[index] = { originId: String(row.id), statusCode: result.statusCode, latencyMs: result.latencyMs, ...(result.errorCode ? { errorCode: result.errorCode } : {}) }
    } }
    await Promise.all(Array.from({ length: Math.min(4, rows.length) }, worker))
    return { results }
  }

  async deleteOriginGroup(userId: string, domainId: string, groupId: string): Promise<{ deleted: true }> {
    const user = this.parseId(userId, 'userId')
    const domain = this.parseId(domainId, 'domainId')
    const group = this.parseId(groupId, 'groupId')
    return this.prisma.$transaction(async (tx) => {
      const db = tx as any
      await this.lockOwnedDomain(db, user, domain)
      const existing = await db.originGroup.findFirst({ where: { id: group, domainId: domain }, select: { id: true } })
      if (!existing) return this.notFound()
      await db.originGroup.delete({ where: { id: group } })
      return { deleted: true }
    })
  }

  async addOriginsToGroup(userId: string, domainId: string, groupId: string, body: unknown): Promise<unknown> {
    const user = this.parseId(userId, 'userId')
    const domain = this.parseId(domainId, 'domainId')
    const group = this.parseId(groupId, 'groupId')
    if (!this.isRecord(body)) return this.invalid('源站参数无效')
    this.assertKeys(body, ['origins'])
    if (!Array.isArray(body.origins) || body.origins.length < 1 || body.origins.length > MAX_ORIGINS) return this.invalid('origins 必须为1至20个源站')
    const inputs = body.origins.map((origin: unknown) => this.originInput(origin, true))
    return this.prisma.$transaction(async tx => {
      const db = tx as any
      await this.lockOwnedDomain(db, user, domain)
      const existing = await db.originGroup.findFirst({ where: { id: group, domainId: domain }, include: { origins: { orderBy: { id: 'asc' } } } })
      if (!existing) return this.notFound()
      const count = await db.origin.count({ where: { group: { domainId: domain } } })
      if (count + inputs.length > MAX_ORIGINS) return this.invalid('每个域名最多配置20个源站')
      const effective = [...existing.origins, ...inputs.map((input, index) => ({ ...input, id: `new-${index}`, status: input.status ?? 1 }))]
      this.assertOriginRoles(existing.lbPolicy, effective)
      for (const input of inputs) await db.origin.create({ data: { ...input, originGroupId: group, status: input.status ?? 1 } })
      return this.serialize(await db.originGroup.findFirst({ where: { id: group }, include: { origins: { orderBy: { id: 'asc' } } } }))
    })
  }

  private async originAndGroup(db: any, domainId: bigint, originId: bigint): Promise<{ existing: any; group: any }> {
    const existing = await db.origin.findFirst({ where: { id: originId, group: { domainId } } })
    if (!existing) return { existing: null, group: null }
    const groups = await db.originGroup.findMany({ where: { domainId }, include: { origins: { orderBy: { id: 'asc' } } } })
    const group = groups.find((row: any) => row.id === existing.originGroupId)
    return { existing, group }
  }

  private assertOriginRoles(policy: string, origins: Array<Record<string, any>>): void {
    const enabled = origins.filter((origin) => origin.status !== 0)
    const backupCount = enabled.filter((origin) => origin.isBackup === true).length
    if (policy !== 'primary_backup') {
      if (backupCount > 0) this.invalid('仅 primary_backup 策略允许 isBackup=true')
      return
    }
    if (enabled.filter((origin) => origin.isBackup !== true).length !== 1 || backupCount < 1) {
      this.invalid('primary_backup 策略要求且仅要求一个主源站，并至少一个备源站')
    }
  }

  private async ownedDomain(db: any, userId: bigint, domainId: bigint): Promise<any> {
    const domain = await db.domain.findFirst({ where: { id: domainId, userId, deletedAt: null }, select: { id: true } })
    if (!domain) return this.notFound()
    return domain
  }

  private async lockOwnedDomain(db: any, userId: bigint, domainId: bigint): Promise<void> {
    // Domain row lock serializes quota checks and ordering changes across concurrent requests.
    const rows = await db.$queryRawUnsafe(
      'SELECT id FROM domains WHERE id = ? AND user_id = ? AND deleted_at IS NULL FOR UPDATE',
      domainId,
      userId,
    )
    if (!rows || rows.length === 0) return this.notFound()
  }

  private cacheRuleInput(value: unknown, creating: boolean): Record<string, unknown> {
    if (!this.isRecord(value)) return this.invalid('缓存规则参数无效')
    this.assertKeys(value, CACHE_FIELDS)
    if (creating && !['name', 'matchType', 'matchMode', 'action', 'ttl', 'ignoreParams'].every((key) => key in value)) {
      return this.invalid('缓存规则缺少必填字段')
    }
    if (creating && value.matchType !== 'all' && !('matchValue' in value)) return this.invalid('缓存规则缺少 matchValue')
    if (!creating && Object.keys(value).length === 0) return this.invalid('至少提供一个待更新字段')
    const data: Record<string, unknown> = { ...value }
    if ('name' in value && (typeof value.name !== 'string' || value.name.trim().length < 1 || value.name.trim().length > 64)) return this.invalid('name 长度必须为1至64个字符')
    for (const [field, allowed] of Object.entries(CACHE_ENUMS)) {
      const candidate = field === 'matchType' ? data.matchType : value[field]
      if (field in value && (typeof candidate !== 'string' || !allowed.includes(candidate as never))) return this.invalid(`${field} 无效`)
    }
    if ('matchValue' in value && typeof value.matchValue !== 'string') return this.invalid('matchValue 必须为字符串')
    const matchType = (data.matchType ?? (creating ? 'path' : undefined)) as string | undefined
    if ('matchType' in value || 'matchValue' in value || creating) {
      const matchValue = value.matchValue
      if (matchType === 'all') {
        if (matchValue !== '' && matchValue !== undefined) return this.invalid('matchType=all 时 matchValue 必须为空')
        data.matchValue = ''
      } else if (typeof matchValue === 'string') {
        if (matchValue.length === 0 || matchValue.length > 1024) return this.invalid('matchValue 长度无效')
        if (matchType === 'path' && !matchValue.startsWith('/')) return this.invalid('path 类型 matchValue 必须以/开头')
        if ((matchType === 'extension' || matchType === 'file_type') && !/^\.?[A-Za-z0-9][A-Za-z0-9_-]{0,31}$/.test(matchValue)) return this.invalid('extension 类型须为合法扩展名')
        if (matchType === 'status' && !/^(?:[1-5]\d\d)(?:\s*,\s*[1-5]\d\d)*$/.test(matchValue)) return this.invalid('status 类型须为HTTP状态码或逗号分隔状态码')
        if (matchType === 'header' && !/^[!#$%&'*+.^_`|~0-9A-Za-z-]{1,128}:[^\r\n]{1,895}$/.test(matchValue)) return this.invalid('header 类型须为 Header-Name:Value')
        if (matchType === 'query' && !/^[A-Za-z0-9_.~-]{1,128}(?:=[^&#\r\n]{0,895})?$/.test(matchValue)) return this.invalid('query 类型须为参数名或 name=value')
        if (value.matchMode === 'regex' && !isSafeRegexSubset(matchValue)) return this.invalid('regex 仅接受安全子集且仅保存，需由支持该子集的驱动执行')
        if (matchType === 'path' && value.matchMode === 'regex' && !matchValue.startsWith('/')) return this.invalid('path regex 必须以/开头')
      } else if (creating) return this.invalid('matchValue 必须为字符串')
    }
    if ('ttl' in value && (!Number.isInteger(value.ttl) || (value.ttl as number) < 0 || (value.ttl as number) > 31536000)) return this.invalid('ttl 必须为0至31536000的整数')
    if ('ignoreParams' in value && typeof value.ignoreParams !== 'boolean') return this.invalid('ignoreParams 必须为布尔值')
    if ('status' in value && value.status !== 0 && value.status !== 1) return this.invalid('status 必须为0或1')
    if ('cacheKey' in value && value.cacheKey !== null && (typeof value.cacheKey !== 'string' || value.cacheKey.length < 1 || value.cacheKey.length > 512 || !isValidCacheKey(value.cacheKey))) return this.invalid('cacheKey 语法或长度无效（1至512字符）')
    if (typeof data.name === 'string') data.name = data.name.trim()
    return data
  }

  private originInput(value: unknown, creating: boolean): Record<string, unknown> {
    if (!this.isRecord(value)) return this.invalid('源站参数无效')
    this.assertKeys(value, ORIGIN_FIELDS)
    if (creating && !['address', 'port', 'weight', 'protocol'].every((key) => key in value)) return this.invalid('源站缺少必填字段')
    if (!creating && Object.keys(value).length === 0) return this.invalid('至少提供一个待更新字段')
    const data: Record<string, unknown> = { ...value }
    if ('address' in value) data.address = this.normalizeAddress(value.address)
    if ('port' in value && (!Number.isInteger(value.port) || (value.port as number) < 1 || (value.port as number) > 65535)) return this.invalid('port 必须为1至65535的整数')
    if ('weight' in value && (!Number.isInteger(value.weight) || (value.weight as number) < 1 || (value.weight as number) > 1000)) return this.invalid('weight 必须为1至1000的整数')
    if ('protocol' in value && value.protocol !== 'http' && value.protocol !== 'https') return this.invalid('protocol 仅支持 http 或 https')
    if ('status' in value && value.status !== 0 && value.status !== 1) return this.invalid('status 必须为0或1')
    if ('isBackup' in value && typeof value.isBackup !== 'boolean') return this.invalid('isBackup 必须为布尔值')
    if (creating && !('isBackup' in data)) data.isBackup = false
    if ('host' in value) data.host = value.host === null || value.host === '' ? null : this.normalizeHost(value.host)
    return data
  }

  private groupInput(value: Record<string, unknown>, allowEmpty: boolean): Record<string, unknown> {
    this.assertKeys(value, GROUP_FIELDS)
    if (!allowEmpty && value.name !== undefined && (typeof value.name !== 'string' || !value.name.trim() || value.name.trim().length > 64)) return this.invalid('name 长度必须为1至64个字符')
    if (value.name !== undefined) value.name = (value.name as string).trim()
    if (value.lbPolicy !== undefined) {
      const policies: Record<string, string> = { '1': 'round_robin', '2': 'weighted', '3': 'least_conn', weighted_round_robin: 'weighted', ip_hash: 'weighted', round_robin: 'round_robin', weighted: 'weighted', least_conn: 'least_conn', primary_backup: 'primary_backup' }
      if (typeof value.lbPolicy !== 'string' && typeof value.lbPolicy !== 'number') return this.invalid('lbPolicy 无效')
      const canonical = policies[String(value.lbPolicy)]
      if (!canonical) return this.invalid('lbPolicy 无效')
      value.lbPolicy = canonical
    }
    const data: Record<string, unknown> = {}
    for (const key of ['name', 'lbPolicy'] as const) if (key in value) data[key] = value[key]
    if ('healthCheck' in value) data.healthCheck = this.healthCheckConfig(value.healthCheck)
    if (allowEmpty && Object.keys(data).length === 0) return this.invalid('至少提供一个待更新字段')
    return data
  }

  private healthCheckConfig(value: unknown): unknown {
    if (value === null) return null
    if (!this.isRecord(value)) return this.invalid('healthCheck 必须为受限结构对象')
    this.assertKeys(value, ['enabled', 'path', 'interval', 'timeout', 'expectedStatus'])
    if (Object.keys(value).length !== 5 || typeof value.enabled !== 'boolean' || typeof value.path !== 'string' || !/^\//.test(value.path) || value.path.startsWith('//') || /[\r\n\x00#]/.test(value.path) || value.path.includes('://') || value.path.length > 2048 || !Number.isInteger(value.interval) || (value.interval as number) < 5 || (value.interval as number) > 3600 || !Number.isInteger(value.timeout) || (value.timeout as number) < 1 || (value.timeout as number) > 5 || !Number.isInteger(value.expectedStatus) || (value.expectedStatus as number) < 100 || (value.expectedStatus as number) > 599) {
      return this.invalid('healthCheck 字段或范围无效（timeout最大5秒，path不得包含//、fragment或控制字符）')
    }
    return { enabled: value.enabled, path: value.path, interval: value.interval, timeout: value.timeout, expectedStatus: value.expectedStatus }
  }

  private normalizeAddress(value: unknown): string {
    if (typeof value !== 'string' || value.length === 0 || value.length > 253 || value.trim() !== value) return this.invalid('address 必须是IP或hostname，且不可包含URL、端口或路径')
    if (isIP(value)) return value.toLowerCase()
    return this.normalizeHostname(value, 'address')
  }

  private normalizeHost(value: unknown): string {
    if (typeof value !== 'string' || /[\r\n]/.test(value) || value.trim() !== value) return this.invalid('host 格式无效')
    if (isIP(value)) return value.toLowerCase()
    return this.normalizeHostname(value, 'host')
  }

  private normalizeHostname(value: string, field: string): string {
    const hostname = value.toLowerCase().replace(/\.$/, '')
    if (hostname.length < 1 || hostname.length > 253 || hostname.includes('://') || /[^a-z0-9.-]/.test(hostname)) return this.invalid(`${field} 必须是合法hostname，不能含端口或路径`)
    const labels = hostname.split('.')
    if (labels.some((label) => label.length < 1 || label.length > 63 || !/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(label))) return this.invalid(`${field} 必须是合法hostname`)
    return hostname
  }

  private parseId(value: string, field: string): bigint {
    if (typeof value !== 'string' || !/^[1-9]\d*$/.test(value)) return this.invalid(`${field} 无效`)
    try {
      const id = BigInt(value)
      if (id > MAX_UNSIGNED_BIGINT) return this.invalid(`${field} 无效`)
      return id
    } catch {
      return this.invalid(`${field} 无效`)
    }
  }

  private assertKeys(value: Record<string, unknown>, allowed: readonly string[]): void {
    const unknown = Object.keys(value).find((key) => !allowed.includes(key))
    if (unknown) this.invalid(`不支持字段: ${unknown}`)
  }

  private isRecord(value: unknown): value is Record<string, any> {
    return typeof value === 'object' && value !== null && !Array.isArray(value)
  }

  private serialize(value: unknown): any {
    if (typeof value === 'bigint') return value.toString()
    if (value instanceof Date || value === null || typeof value !== 'object') return value
    if (Array.isArray(value)) return value.map((item) => this.serialize(item))
    return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([key, item]) => [key, this.serialize(item)]))
  }

  private invalid(message: string): never {
    throw new BusinessException(ErrorCode.PARAM_INVALID, message)
  }

  private notFound(): never {
    throw new BusinessException(ErrorCode.RECORD_NOT_FOUND)
  }
}


// Deliberately conservative non-backtracking regex subset: no groups, alternation,
// lookarounds, backreferences or executable JS RegExp. The stored expression must be
// interpreted by a downstream engine implementing this subset (preferably RE2).
function isSafeRegexSubset(pattern: string): boolean {
  if (pattern.length < 1 || pattern.length > 1024) return false
  let inClass = false, escaped = false, lastQuantifier = false
  for (let i = 0; i < pattern.length; i++) {
    const ch = pattern[i]
    if (escaped) { if (/[1-9k]/.test(ch)) return false; escaped = false; lastQuantifier = false; continue }
    if (ch === '\\') { escaped = true; continue }
    if (ch === '[') { if (inClass) return false; inClass = true; lastQuantifier = false; continue }
    if (ch === ']') { if (!inClass) return false; inClass = false; lastQuantifier = false; continue }
    if (!inClass && '()|'.includes(ch)) return false
    if (!inClass && (ch === '*' || ch === '+' || ch === '?')) { if (lastQuantifier || i === 0 || '^$'.includes(pattern[i - 1])) return false; lastQuantifier = true; continue }
    if (!inClass && ch === '{') {
      const match = /^\{([0-9]{1,4})(?:,([0-9]{0,4}))?\}/.exec(pattern.slice(i))
      if (!match || lastQuantifier || i === 0 || '^$'.includes(pattern[i - 1])) return false
      const min = Number(match[1]), max = match[2] === undefined ? min : (match[2] === '' ? min + 1000 : Number(match[2]))
      if (min > 1000 || max > 1000 || max < min) return false
      i += match[0].length - 1; lastQuantifier = true; continue
    }
    lastQuantifier = false
  }
  return !escaped && !inClass
}

function isValidCacheKey(value: string): boolean {
  // Literals plus explicit variable tokens ($name or ${name}); no whitespace,
  // control characters, percent escapes, or arbitrary template/evaluation syntax.
  return /^(?:[A-Za-z0-9._:/-]|\$[A-Za-z_][A-Za-z0-9_.-]*|\$\{[A-Za-z_][A-Za-z0-9_.-]*\})+$/.test(value)
}

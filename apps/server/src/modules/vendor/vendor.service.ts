import { Injectable } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { randomUUID } from 'node:crypto'
import { domainToASCII } from 'node:url'
import { ErrorCode } from '@lunar/shared'
import { PrismaService } from '../../database/prisma.service'
import { ActionableBadRequestException } from '../../common/exceptions/actionable.exception'
import { BusinessException } from '../../common/exceptions/business.exception'
import { decrypt, encrypt } from '../../common/utils/crypto.util'
import { VendorCode, VendorConnectionResult, VendorDomain, VendorDriverError } from './drivers/vendor-driver'
import { DriverFactory } from './drivers/driver.factory'

const MASK = '********'
const MAX_ID = 18446744073709551615n
const LEASE_MS = 5 * 60 * 1000
const PAGE_LIMIT = 20
const ITEM_LIMIT = 1000
const CONFIG_KEYS: Record<string, string[]> = { cloudflare: ['zoneId'], ali: [] }
const PROD_DEFAULT_KEYS = new Set(['change-me-in-production', 'your-encryption-key', 'changeme', 'default', '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef'])

type AnyRecord = Record<string, any>

@Injectable()
export class VendorService {
  private readonly db: any
  constructor(private readonly prisma: PrismaService, private readonly config: ConfigService, private readonly factory: DriverFactory) { this.db = prisma as any }

  async listVendors(q: { page: number; pageSize: number }) {
    const [list, total] = await Promise.all([this.db.vendor.findMany({ orderBy: [{ sort: 'asc' }, { id: 'asc' }], skip: (q.page - 1) * q.pageSize, take: q.pageSize, select: { id: true, name: true, code: true, driver: true, logo: true, description: true, status: true, sort: true, createdAt: true, updatedAt: true } }), this.db.vendor.count()])
    return { list: list.map((v: AnyRecord) => ({ ...v, id: String(v.id) })), total }
  }
  async createVendor(input: AnyRecord) {
    this.validateVendor(input)
    const row = await this.db.vendor.create({ data: { name: input.name.trim(), code: input.code, driver: input.code === 'cloudflare' ? 'CloudflareDriver' : 'AliDriver', description: input.description?.trim() ?? null, status: input.status ?? 1, sort: input.sort ?? 0 } })
    return this.vendorView(row)
  }
  async updateVendor(idInput: string, input: AnyRecord) {
    const id = this.id(idInput)
    const data: AnyRecord = {}
    if (input.name !== undefined) { this.text(input.name, 1, 64, '厂商名称'); data.name = input.name.trim() }
    if (input.description !== undefined) { if (input.description !== null) this.text(input.description, 0, 512, '描述'); data.description = input.description?.trim() || null }
    if (input.status !== undefined) { this.status(input.status); data.status = input.status }
    if (input.sort !== undefined) { this.int(input.sort, 0, 2147483647, '排序'); data.sort = input.sort }
    if (!Object.keys(data).length) throw new ActionableBadRequestException('请提供允许更新的厂商字段（name、description、status、sort）')
    return this.vendorView(await this.db.vendor.update({ where: { id }, data }))
  }
  async deleteVendor(idInput: string) {
    const id = this.id(idInput)
    const row = await this.db.vendor.findUnique({ where: { id }, include: { _count: { select: { accounts: true } } } })
    if (!row) throw new ActionableBadRequestException('未找到该厂商')
    const packageCount = await this.db.package.count({ where: { vendorId: id } })
    if (row._count?.accounts > 0 || packageCount > 0) throw new ActionableBadRequestException('该厂商仍被账号或套餐引用，无法删除')
    await this.db.vendor.delete({ where: { id } })
    return { success: true }
  }

  async listAccounts(q: { page: number; pageSize: number; vendorId?: string }) {
    const where: AnyRecord = {}
    if (q.vendorId) where.vendorId = this.id(q.vendorId)
    const [rows, total] = await Promise.all([this.db.vendorAccount.findMany({ where, include: { vendor: { select: { id: true, name: true, code: true } } }, orderBy: { id: 'desc' }, skip: (q.page - 1) * q.pageSize, take: q.pageSize }), this.db.vendorAccount.count({ where })])
    return { list: rows.map((r: AnyRecord) => this.accountView(r)), total }
  }
  async createAccount(input: AnyRecord) {
    const vendorId = this.id(input.vendorId)
    const vendor = await this.db.vendor.findUnique({ where: { id: vendorId } })
    if (!vendor || vendor.status !== 1) throw new ActionableBadRequestException('请选择一个已启用的厂商')
    this.text(input.name, 1, 64, '账号名称')
    const secrets = this.credentialsForCreate(vendor.code, input.accessKey, input.secretKey, input.config)
    this.status(input.status ?? 1)
    const key = this.encryptionKey()
    const row = await this.db.vendorAccount.create({ data: { vendorId, name: input.name.trim(), accessKey: `enc:v1:${encrypt(secrets.accessKey, key)}`, secretKey: secrets.secretKey ? `enc:v1:${encrypt(secrets.secretKey, key)}` : '', config: secrets.config, status: input.status ?? 1 } , include: { vendor: { select: { id: true, name: true, code: true } } } })
    return this.accountView(row)
  }
  async updateAccount(idInput: string, input: AnyRecord) {
    const id = this.id(idInput)
    return this.db.$transaction(async (tx: any) => {
      await this.lockAccount(tx, id)
      const row = await tx.vendorAccount.findUnique({ where: { id }, include: { vendor: { select: { id: true, name: true, code: true, status: true } } } })
      if (!row) throw new ActionableBadRequestException('未找到该厂商账号')
      this.ensureInactive(row)
      const data: AnyRecord = {}
      if (input.name !== undefined) { this.text(input.name, 1, 64, '账号名称'); data.name = input.name.trim() }
      if (input.status !== undefined) { this.status(input.status); data.status = input.status }
      if (input.config !== undefined) data.config = this.cleanConfig(row.vendor.code, input.config)
      if (input.vendorId !== undefined && this.id(input.vendorId) !== row.vendorId) throw new ActionableBadRequestException('厂商账号不能更换所属厂商')
      const current = this.readCredentials(row)
      const accessKey = this.replacement(input.accessKey) ?? current.accessKey
      const secretKey = this.replacement(input.secretKey) ?? current.secretKey
      this.validateCredentialValues(row.vendor.code, accessKey, secretKey, data.config ?? current.config)
      if (this.replacement(input.accessKey) !== undefined) data.accessKey = `enc:v1:${encrypt(accessKey, this.encryptionKey())}`
      if (this.replacement(input.secretKey) !== undefined) data.secretKey = secretKey ? `enc:v1:${encrypt(secretKey, this.encryptionKey())}` : ''
      if (!Object.keys(data).length) throw new ActionableBadRequestException('请提供允许更新的账号字段')
      // Any edit invalidates in-flight or expired responses, including status/config changes.
      data.credentialVersion = row.credentialVersion + 1
      const updated = await tx.vendorAccount.update({ where: { id }, data, include: { vendor: { select: { id: true, name: true, code: true } } } })
      return this.accountView(updated)
    })
  }
  async deleteAccount(idInput: string) {
    const id = this.id(idInput)
    await this.db.$transaction(async (tx: any) => {
      await this.lockAccount(tx, id)
      const row = await tx.vendorAccount.findUnique({ where: { id } })
      if (!row) throw new ActionableBadRequestException('未找到该厂商账号')
      this.ensureInactive(row)
      const managedCount = await tx.vendorResource.count({ where: { vendorAccountId: id, managedByPanel: true } })
      const activeJob = await tx.vendorWriteJob.findFirst({ where: { vendorAccountId: id, status: { in: ['queued', 'running', 'retry_wait', 'needs_review'] } }, select: { id: true } })
      if (managedCount || activeJob) throw new ActionableBadRequestException('该账号仍有面板管理的云资源或未解决的写入任务，不能删除凭据；请先完成云资源清理及人工核查')
      await tx.vendorWriteJob.deleteMany({ where: { vendorAccountId: id } })
      await tx.vendorAccount.delete({ where: { id } })
    })
    return { success: true, message: '仅删除本地凭据、映射和日志；未向远端执行删除' }
  }
  async listLogs(idInput: string, q: { page: number; pageSize: number }) {
    const id = this.id(idInput); await this.requireAccount(id)
    const [list, total] = await Promise.all([this.db.vendorSyncLog.findMany({ where: { vendorAccountId: id }, orderBy: { createdAt: 'desc' }, skip: (q.page - 1) * q.pageSize, take: q.pageSize }), this.db.vendorSyncLog.count({ where: { vendorAccountId: id } })])
    return { list: list.map((l: AnyRecord) => ({ id: String(l.id), vendorAccountId: String(l.vendorAccountId), action: l.action, status: l.status, message: l.message, createdAt: l.createdAt })), total }
  }
  async listResources(idInput: string, q: { page: number; pageSize: number }) {
    const id = this.id(idInput); await this.requireAccount(id)
    const where = { vendorAccountId: id }
    const [rows, total] = await Promise.all([this.db.vendorResource.findMany({ where, include: { domain: { select: { id: true, domain: true } } }, orderBy: { syncedAt: 'desc' }, skip: (q.page - 1) * q.pageSize, take: q.pageSize }), this.db.vendorResource.count({ where })])
    return { list: rows.map((r: AnyRecord) => ({ id: String(r.id), vendorAccountId: String(r.vendorAccountId), domainId: String(r.domainId), vendorDomainId: r.vendorDomainId, vendorCertId: r.vendorCertId, managedByPanel: r.managedByPanel === true, resourceData: this.cleanResourceData(r.resourceData), syncedAt: r.syncedAt, domain: r.domain ? { id: String(r.domain.id), domain: r.domain.domain } : null })), total }
  }

  async testAccount(idInput: string): Promise<VendorConnectionResult> {
    return this.runOperation(this.id(idInput), 'test', async (driver, lease) => {
      const result = await driver.testConnection()
      if (!result || result.connected !== true || result.provider !== lease.code || typeof result.checkedAt !== 'string' || !Number.isFinite(Date.parse(result.checkedAt))) throw new VendorDriverError('INVALID_RESPONSE')
      const safeLabel = typeof result.accountLabel === 'string' && /^[\p{L}\p{N} ._()'&-]{1,128}$/u.test(result.accountLabel) ? result.accountLabel : undefined
      const safeStatus = typeof result.providerStatus === 'string' && /^[A-Za-z0-9_.-]{1,64}$/.test(result.providerStatus) ? result.providerStatus : undefined
      return { connected: true, provider: result.provider, checkedAt: new Date(result.checkedAt).toISOString(), ...(safeLabel ? { accountLabel: safeLabel } : {}), ...(safeStatus ? { providerStatus: safeStatus } : {}) }
    })
  }
  async syncAccount(idInput: string) {
    return this.runOperation(this.id(idInput), 'sync', async (driver, lease) => {
      const gathered: VendorDomain[] = []
      let cursor: string | undefined
      const seen = new Set<string>()
      for (let page = 0; page < PAGE_LIMIT; page++) {
        const result = await driver.listDomains(cursor)
        if (!result || !Array.isArray(result.items) || result.items.length > 50 || !(result.nextCursor === null || typeof result.nextCursor === 'string')) throw new VendorDriverError('INVALID_RESPONSE')
        if (gathered.length + result.items.length > ITEM_LIMIT) throw new VendorDriverError('INVALID_RESPONSE')
        gathered.push(...result.items)
        if (result.nextCursor === null) break
        if (result.nextCursor.length === 0 || seen.has(result.nextCursor) || result.nextCursor === cursor || page === PAGE_LIMIT - 1) throw new VendorDriverError('INVALID_RESPONSE')
        seen.add(result.nextCursor); cursor = result.nextCursor
      }
      const mapped = gathered.map(v => this.cleanDriverDomain(v))
      if (mapped.some(item => item === null)) throw new VendorDriverError('INVALID_RESPONSE')
      const normalized = new Map<string, AnyRecord>()
      for (const item of mapped) {
        if (!item || normalized.has(item.hostname)) throw new VendorDriverError('INVALID_RESPONSE')
        normalized.set(item.hostname, item)
      }
      const result = await this.db.$transaction(async (tx: any) => {
        await this.lockAccount(tx, lease.id)
        const current = await tx.vendorAccount.findUnique({ where: { id: lease.id }, include: { vendor: true } })
        if (!current || current.operationToken !== lease.token || current.credentialVersion !== lease.version || current.status !== 1 || current.vendor.status !== 1 || !current.operationExpiresAt || new Date(current.operationExpiresAt).getTime() <= Date.now()) throw new ActionableBadRequestException('账号状态或凭据已变化，或操作租约已过期；已放弃本次同步，请重新尝试')
        const domains = await tx.domain.findMany({ where: { deletedAt: null, domain: { in: [...normalized.keys()] } }, select: { id: true, domain: true } })
        const byName = new Map<string, AnyRecord>()
        for (const d of domains) { const host = this.normalizeHostname(d.domain); if (host) byName.set(host, d) }
        const ownedRows = await tx.vendorResource.findMany({ where: { vendorAccountId: lease.id, managedByPanel: true }, select: { domainId: true, vendorDomainId: true } })
        const ownedIds = new Set(ownedRows.map((row: AnyRecord) => String(row.domainId)))
        let synced = 0, ignored = 0
        const now = new Date()
        for (const [hostname, item] of normalized) {
          const domain = byName.get(hostname)
          if (!domain) { ignored++; continue }
          const owned = ownedIds.has(String(domain.id))
          const observation = { hostname, cname: item.cname, providerStatus: item.providerStatus, ...(item.sslStatus ? { sslStatus: item.sslStatus } : {}), observedOnly: !owned, ...(owned ? { registrationOnly: true } : {}) }
          await tx.vendorResource.upsert({ where: { vendorAccountId_domainId: { vendorAccountId: lease.id, domainId: domain.id } }, create: { vendorAccountId: lease.id, domainId: domain.id, vendorDomainId: item.externalId, resourceData: observation, syncedAt: now }, update: { ...(!owned ? { vendorDomainId: item.externalId } : {}), resourceData: observation, syncedAt: now } })
          synced++
        }
        if (new Date(current.operationExpiresAt).getTime() <= Date.now()) throw new ActionableBadRequestException('操作租约已过期；已放弃本次同步，请重新尝试')
        await tx.vendorAccount.update({ where: { id: lease.id }, data: { operationToken: null, operationExpiresAt: null, lastSyncAt: now } })
        await tx.vendorSyncLog.create({ data: { vendorAccountId: lease.id, action: 'sync', status: 1, message: '只读清单同步成功' } })
        return { synced, ignored, total: gathered.length }
      })
      return { ...result, readonly: true as const, message: '只读清单同步完成；未部署或修改域名状态' }
    })
  }

  private async runOperation<T>(id: bigint, action: 'test' | 'sync', fn: (driver: ReturnType<DriverFactory['create']>, lease: { id: bigint; token: string; version: number; code: string; credentials: { accessKey: string; secretKey: string; config: { zoneId?: string } } }) => Promise<T>): Promise<T> {
    let lease: Awaited<ReturnType<VendorService['beginOperation']>>
    try { lease = await this.beginOperation(id) } catch (error) {
      try {
        const account = await this.db.vendorAccount.findUnique({ where: { id }, select: { id: true } })
        if (account) await this.db.vendorSyncLog.create({ data: { vendorAccountId: id, action, status: 2, message: '无法启动操作；请确认厂商和账号已启用，且账号没有其他运行中的操作' } })
      } catch { /* do not expose or replace internal storage errors */ }
      throw error
    }
    try {
      const driver = this.factory.create(lease.code as VendorCode, lease.credentials)
      const result = await fn(driver, lease)
      if (action === 'test') await this.db.$transaction(async (tx: any) => {
        await this.lockAccount(tx, id)
        const row = await tx.vendorAccount.findUnique({ where: { id }, include: { vendor: { select: { status: true } } } })
        if (!row || row.status !== 1 || row.vendor.status !== 1 || row.operationToken !== lease.token || row.credentialVersion !== lease.version || !row.operationExpiresAt || new Date(row.operationExpiresAt).getTime() <= Date.now()) throw new ActionableBadRequestException('账号状态或凭据已变化，或操作租约已过期；已放弃本次操作，请重新尝试')
        await tx.vendorAccount.update({ where: { id }, data: { operationToken: null, operationExpiresAt: null } })
        await tx.vendorSyncLog.create({ data: { vendorAccountId: id, action, status: 1, message: '连接测试成功' } })
      })
      return result
    } catch (error) {
      const message = error instanceof VendorDriverError ? error.safeCode : '操作失败；请检查厂商账号配置后重试'
      await this.failOperation(id, lease.token, lease.version, action, message)
      if (error instanceof VendorDriverError) throw new ActionableBadRequestException(`厂商操作失败（${error.safeCode}）`)
      if (error instanceof ActionableBadRequestException) throw error
      // Unknown SDK/transport errors may embed request headers or credentials in their stack.
      // Do not forward them to the global exception logger or the API response.
      throw new BusinessException(ErrorCode.VENDOR_API_ERROR)
    }
  }
  private async beginOperation(id: bigint) {
    return this.db.$transaction(async (tx: any) => {
      await this.lockAccount(tx, id)
      const row = await tx.vendorAccount.findUnique({ where: { id }, include: { vendor: true } })
      if (!row || row.status !== 1 || row.vendor.status !== 1) throw new ActionableBadRequestException('厂商或账号未启用，无法执行连接测试或同步')
      if (row.operationToken && row.operationExpiresAt && new Date(row.operationExpiresAt).getTime() > Date.now()) throw new ActionableBadRequestException('该账号正在执行连接测试或同步，请稍后重试')
      const token = randomUUID(), expires = new Date(Date.now() + LEASE_MS)
      const changed = await tx.vendorAccount.updateMany({ where: { id, credentialVersion: row.credentialVersion, OR: [{ operationToken: null }, { operationExpiresAt: { lte: new Date() } }] }, data: { operationToken: token, operationExpiresAt: expires } })
      if (changed.count !== 1) throw new ActionableBadRequestException('该账号正在执行其他操作，请稍后重试')
      const credentials = this.readCredentials(row)
      return { id, token, version: row.credentialVersion, code: row.vendor.code, credentials }
    })
  }
  private async failOperation(id: bigint, token: string, version: number, action: string, message: string) {
    try { await this.db.$transaction(async (tx: any) => {
      await this.lockAccount(tx, id)
      const row = await tx.vendorAccount.findUnique({ where: { id } })
      if (!row || row.operationToken !== token || row.credentialVersion !== version) return
      await tx.vendorAccount.update({ where: { id }, data: { operationToken: null, operationExpiresAt: null } })
      await tx.vendorSyncLog.create({ data: { vendorAccountId: id, action, status: 2, message } })
    }) } catch { /* do not replace a safe upstream/operation error with database diagnostics */ }
  }
  private async lockAccount(tx: any, id: bigint) { await tx.$queryRaw`SELECT a.id FROM vendor_accounts a INNER JOIN vendors v ON v.id = a.vendor_id WHERE a.id = ${id} FOR UPDATE` }
  private async requireAccount(id: bigint) { const row = await this.db.vendorAccount.findUnique({ where: { id } }); if (!row) throw new ActionableBadRequestException('未找到该厂商账号'); return row }
  private ensureInactive(row: AnyRecord) { if (row.operationToken && row.operationExpiresAt && new Date(row.operationExpiresAt).getTime() > Date.now()) throw new ActionableBadRequestException('该账号正在执行操作，暂不能编辑或删除；请稍后重试') }

  private credentialsForCreate(code: string, accessKey: unknown, secretKey: unknown, config: unknown) {
    this.text(accessKey, 1, 4096, 'Access Key')
    const secret = secretKey ?? ''
    if (typeof secret !== 'string' || secret.length > 4096) throw new ActionableBadRequestException('Secret Key 必须为不超过 4096 字符的文本')
    const clean = this.cleanConfig(code, config)
    this.validateCredentialValues(code, accessKey, secret, clean)
    return { accessKey: accessKey.trim(), secretKey: secret, config: clean }
  }
  private validateCredentialValues(code: string, accessKey: string, secretKey: string, config: any) {
    this.text(accessKey, 1, 4096, 'Access Key')
    if (code === 'cloudflare') { if (secretKey !== '') throw new ActionableBadRequestException('Cloudflare 仅使用 API Token，secretKey 必须为空'); if (!/^[a-fA-F0-9]{32}$/.test(config?.zoneId ?? '')) throw new ActionableBadRequestException('Cloudflare zoneId 必须为 32 位十六进制值') }
    else if (code === 'ali') { this.text(secretKey, 1, 4096, 'Secret Key'); if (Object.keys(config ?? {}).length) throw new ActionableBadRequestException('阿里云配置当前必须为空对象') }
    else throw new ActionableBadRequestException('不支持的厂商驱动')
  }
  private cleanConfig(code: string, value: unknown): AnyRecord {
    if (value === undefined || value === null) value = {}
    if (typeof value !== 'object' || Array.isArray(value)) throw new ActionableBadRequestException('config 必须是对象')
    const obj = value as AnyRecord, allowed = CONFIG_KEYS[code]
    if (!allowed || Object.keys(obj).some(key => !allowed.includes(key))) throw new ActionableBadRequestException('config 包含不允许的字段；仅支持 Cloudflare zoneId，禁止 endpoint/token 等字段')
    if (code === 'cloudflare') { if (typeof obj.zoneId !== 'string' || !/^[a-fA-F0-9]{32}$/.test(obj.zoneId)) throw new ActionableBadRequestException('Cloudflare zoneId 必须为 32 位十六进制值'); return { zoneId: obj.zoneId.toLowerCase() } }
    return {}
  }
  private readCredentials(row: AnyRecord) {
    const key = this.encryptionKey()
    try {
      if (typeof row.accessKey !== 'string' || !row.accessKey.startsWith('enc:v1:')) throw new Error()
      const accessKey = decrypt(row.accessKey.slice(7), key)
      const secretKey = row.secretKey ? (typeof row.secretKey === 'string' && row.secretKey.startsWith('enc:v1:') ? decrypt(row.secretKey.slice(7), key) : (() => { throw new Error() })()) : ''
      return { accessKey, secretKey, config: row.config ?? {} }
    } catch { throw new ActionableBadRequestException('保存的厂商凭据无法解密；请重新录入凭据') }
  }
  private encryptionKey(): string {
    const security = this.config.get<any>('security')
    const key = security?.encryptionKey || process.env.SECURITY_ENCRYPTION_KEY || process.env.ENCRYPTION_KEY
    if (typeof key !== 'string' || !key.trim()) throw new ActionableBadRequestException('系统尚未配置 security.encryptionKey，无法安全保存或读取厂商凭据')
    const mode = this.config.get<string>('app.env') || process.env.NODE_ENV
    if (mode === 'production' && (key.trim().length < 32 || PROD_DEFAULT_KEYS.has(key.toLowerCase().trim()))) throw new ActionableBadRequestException('生产环境必须配置至少 32 字符且非默认的 security.encryptionKey')
    return key
  }
  private accountView(row: AnyRecord) {
    return { id: String(row.id), vendorId: String(row.vendorId), name: row.name, accessKey: row.accessKey ? MASK : '', secretKey: row.secretKey ? MASK : '', hasAccessKey: Boolean(row.accessKey), hasSecretKey: Boolean(row.secretKey), config: row.config?.zoneId ? { zoneId: row.config.zoneId } : {}, status: row.status, lastSyncAt: row.lastSyncAt, credentialVersion: row.credentialVersion, createdAt: row.createdAt, updatedAt: row.updatedAt, vendor: row.vendor ? { id: String(row.vendor.id), name: row.vendor.name, code: row.vendor.code } : undefined }
  }
  private vendorView(row: AnyRecord) { return { ...row, id: String(row.id) } }
  private replacement(value: unknown): string | undefined { if (value === undefined || value === null || value === '' || value === MASK) return undefined; this.text(value, 1, 4096, '凭据'); return value.trim() }
  private cleanDriverDomain(value: VendorDomain): AnyRecord | null {
    if (!value || typeof value !== 'object' || typeof value.externalId !== 'string' || !value.externalId || value.externalId.length > 128 || typeof value.hostname !== 'string' || typeof value.providerStatus !== 'string') return null
    const hostname = this.normalizeHostname(value.hostname), status = /^[A-Za-z0-9_.-]{1,64}$/.test(value.providerStatus) ? value.providerStatus : null
    if (!hostname || !status) return null
    const cname = value.cname === null ? null : (typeof value.cname === 'string' ? this.normalizeHostname(value.cname) : null)
    const ssl = typeof value.sslStatus === 'string' && /^[A-Za-z0-9_.-]{1,64}$/.test(value.sslStatus) ? value.sslStatus : undefined
    return { externalId: value.externalId, hostname, cname, providerStatus: status, ...(ssl ? { sslStatus: ssl } : {}) }
  }
  private cleanResourceData(value: any) { if (!value || typeof value !== 'object') return {}; const d: AnyRecord = {}; for (const key of ['hostname', 'cname', 'providerStatus', 'sslStatus', 'observedOnly', 'registrationOnly']) if (key in value) d[key] = value[key]; return d }
  private normalizeHostname(value: string): string | null { if (typeof value !== 'string' || !value || value !== value.trim() || /[\s/:?#@*\\]/.test(value) || value.endsWith('.')) return null; const host = domainToASCII(value).toLowerCase(); if (!host || host.length > 253 || host.split('.').length < 2 || host.split('.').some(x => !x || x.length > 63 || !/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(x))) return null; return host }
  private validateVendor(input: AnyRecord) { this.text(input.name, 1, 64, '厂商名称'); if (!['cloudflare', 'ali'].includes(input.code)) throw new ActionableBadRequestException('厂商 code 仅支持 cloudflare 或 ali'); this.status(input.status ?? 1); this.int(input.sort ?? 0, 0, 2147483647, '排序'); if (input.description !== undefined && input.description !== null) this.text(input.description, 0, 512, '描述') }
  private text(value: unknown, min: number, max: number, label: string): asserts value is string { if (typeof value !== 'string' || value.trim().length < min || value.length > max) throw new ActionableBadRequestException(`${label}长度必须为 ${min} 至 ${max} 个字符`) }
  private status(value: unknown) { this.int(value, 0, 1, 'status') }
  private int(value: unknown, min: number, max: number, label: string) { if (!Number.isInteger(value) || (value as number) < min || (value as number) > max) throw new ActionableBadRequestException(`${label}必须为 ${min} 至 ${max} 的整数`) }
  private id(value: unknown): bigint { if (typeof value !== 'string' || !/^[1-9][0-9]{0,19}$/.test(value)) throw new ActionableBadRequestException('ID 必须为 1 至 18446744073709551615 的无符号整数'); try { const id = BigInt(value); if (id > MAX_ID) throw new Error(); return id } catch { throw new ActionableBadRequestException('ID 必须为 1 至 18446744073709551615 的无符号整数') } }
}

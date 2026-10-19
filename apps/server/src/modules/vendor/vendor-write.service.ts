import { Injectable, Logger } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { createHash, randomUUID } from 'node:crypto'
import { X509Certificate, createPrivateKey, createPublicKey, timingSafeEqual } from 'node:crypto'
import { lookup } from 'node:dns/promises'
import { isIP } from 'node:net'
import { domainToASCII } from 'node:url'
import { decrypt } from '../../common/utils/crypto.util'
import { ActionableBadRequestException } from '../../common/exceptions/actionable.exception'
import { PrismaService } from '../../database/prisma.service'
import { isPublicAddress } from '../../shared/http/safe-http'
import { DriverFactory } from './drivers/driver.factory'
import { VendorDeploymentConfig } from './drivers/vendor-driver'

const LEASE_MS = 5 * 60 * 1000
const RETRY_LIMIT = 3
const SAFE_RETRY_CODES = new Set(['AUTH_FAILED', 'ORIGIN_PROTOCOL_MISMATCH', 'HOSTNAME_TOO_LONG', 'RATE_LIMITED', 'PRECONDITION_FAILED', 'INVALID_CONFIG', 'UNSUPPORTED_OPERATION', 'RESOURCE_CONFLICT', 'CACHE_RULES_UNSUPPORTED', 'TLS_OR_DOMAIN_CONFIG_UNSUPPORTED', 'ORIGIN_GROUP_UNSUPPORTED', 'ORIGIN_UNSUPPORTED', 'ORIGIN_UNSAFE', 'MANAGED_RESOURCE_REQUIRED', 'PACKAGE_REQUIRED', 'PACKAGE_VENDOR_MISMATCH', 'PACKAGE_UNAVAILABLE', 'AUDIT_NOT_APPROVED', 'ACCESS_TYPE_UNSUPPORTED', 'DOMAIN_UNAVAILABLE', 'CERTIFICATE_INVALID'])
const RETRY_BACKOFF_MS = [5_000, 30_000, 120_000]
const SAFE_PORTS = new Set([80, 443])
const MAX_ID = 18446744073709551615n
const PROD_DEFAULT_KEYS = new Set(['change-me-in-production', 'your-encryption-key', 'changeme', 'default', '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef'])
const MSG = {
  queued: '已进入受控云端写入队列；未表示缓存、TLS或域名状态已生效',
  done: '云端基础操作已完成；未表示缓存、TLS或域名状态已生效',
  rejected: '前置条件不满足；未执行云端写入',
  rateLimited: '厂商请求被限流；确认未执行写入，系统将在安全退避后重试',
  failed: '云端操作未完成；请检查配置或前置条件后重试',
  review: '远端结果或本地持久化状态不明确；需要人工核对，系统不会自动重试',
  disabled: '云端写入功能当前未启用',
}

type AnyRow = Record<string, any>
type WriteAction = 'register' | 'deploy' | 'delete'

@Injectable()
export class VendorWriteService {
  private readonly db: any
  private tickBusy = false
  private readonly logger = new Logger(VendorWriteService.name)
  private lastTickWarningAt = 0

  constructor(private readonly prisma: PrismaService, private readonly config: ConfigService, private readonly factory: DriverFactory) { this.db = prisma as any }

  capabilities() {
    return {
      writesEnabled: this.writesEnabled(),
      workerEnabled: this.workerEnabled(),
      supportedActions: ['register', 'deploy', 'delete'],
      providers: {
        ali: 'register/delete; deploy single origin, uploaded HTTPS certificate, and default cache TTL only when provider supports exact readback; custom cache rules, HSTS, forced HTTPS and TLS tuning are rejected.',
        cloudflare: 'register/delete; deploy single origin, cache TTL and custom hostname certificate when zone/API supports it; HSTS/forced HTTPS/TLS tuning and custom cache rules are rejected.',
      },
      scope: 'M4 provides queued register/deploy/delete for panel-managed resources only. Deploy snapshots are revalidated at execution; results are reported successful only after provider readback. No scheduler, load balancing/failover (M7), WAF, purge/prewarm (M8), or unsupported TLS/cache settings are implied.',
    }
  }

  async list(accountIdInput: string, pageInput: unknown, pageSizeInput: unknown) {
    const accountId = this.parseId(accountIdInput, '账号ID')
    const page = this.pageNumber(pageInput, 1, 100000)
    const pageSize = this.pageNumber(pageSizeInput, 1, 100)
    await this.requireAccount(accountId)
    const where = { vendorAccountId: accountId }
    const [rows, total] = await Promise.all([
      this.db.vendorWriteJob.findMany({ where, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], skip: (page - 1) * pageSize, take: pageSize }),
      this.db.vendorWriteJob.count({ where }),
    ])
    return { list: rows.map((row: AnyRow) => this.view(row)), total }
  }

  async create(accountIdInput: string, body: { action: unknown; domainId: unknown; idempotencyKey: unknown }, actorIdInput: unknown) {
    if (!this.writesEnabled()) throw new ActionableBadRequestException(MSG.disabled)
    const accountId = this.parseId(accountIdInput, '账号ID')
    const domainId = this.parseId(body?.domainId, '域名ID')
    const actorId = this.parseId(actorIdInput, '用户ID')
    const action = body?.action
    if (action !== 'register' && action !== 'deploy' && action !== 'delete') throw new ActionableBadRequestException('action 仅支持 register、deploy 或 delete')
    const rawKey = body?.idempotencyKey
    if (typeof rawKey !== 'string' || !/^[A-Za-z0-9._:-]{1,64}$/.test(rawKey)) throw new ActionableBadRequestException('idempotencyKey 必须为1至64位安全字符')
    const idempotencyKey = this.hash(`actor:${actorId}:key:${rawKey}`)

    const prior = await this.db.vendorWriteJob.findUnique({ where: { idempotencyKey } })
    if (prior) {
      if (prior.vendorAccountId !== accountId || prior.domainId !== domainId || prior.action !== action || prior.requestedBy !== actorId) throw new ActionableBadRequestException('相同幂等键已用于不同请求')
      return this.view(prior)
    }

    let eligibility: AnyRow
    try { eligibility = await this.assertEligible(this.db, accountId, domainId, action, undefined, true) }
    catch (error) { if (error instanceof SafeJobError) throw new ActionableBadRequestException(this.explain(error.safeCode)); throw error }
    const activeKey = this.hash(`domain:${domainId}`)
    const data = {
      vendorAccountId: accountId, domainId, requestedBy: actorId, action,
      status: 'queued', idempotencyKey, activeKey,
      credentialVersion: eligibility.account.credentialVersion,
      originSnapshot: action === 'register' ? eligibility.origin : action === 'deploy' ? eligibility.deployment : undefined,
      nextAttemptAt: new Date(), attempts: 0,
      message: MSG.queued,
    }
    try {
      const row = await this.db.vendorWriteJob.create({ data })
      return this.view(row)
    } catch {
      // Unique activeKey/idempotency conflicts are intentionally opaque; never include raw DB diagnostics.
      const duplicate = await this.db.vendorWriteJob.findUnique({ where: { idempotencyKey } }).catch(() => null)
      if (duplicate) {
        if (duplicate.vendorAccountId === accountId && duplicate.domainId === domainId && duplicate.action === action && duplicate.requestedBy === actorId) return this.view(duplicate)
        throw new ActionableBadRequestException('相同幂等键已用于不同请求')
      }
      throw new ActionableBadRequestException('该域名已有受控云端操作或队列暂不可用；请稍后核对任务状态')
    }
  }

  async retry(jobIdInput: string) {
    if (!this.writesEnabled()) throw new ActionableBadRequestException(MSG.disabled)
    const id = this.parseId(jobIdInput, '任务ID')
    const row = await this.db.vendorWriteJob.findUnique({ where: { id } })
    if (!row) throw new ActionableBadRequestException('未找到该写入任务')
    if (row.status !== 'failed' || !SAFE_RETRY_CODES.has(row.errorCode ?? '')) throw new ActionableBadRequestException('该任务不是可安全重试的确定性失败；未知结果不得重试')
    let eligibility: AnyRow
    try { eligibility = await this.assertEligible(this.db, row.vendorAccountId, row.domainId, row.action, undefined, true) }
    catch (error) { if (error instanceof SafeJobError) throw new ActionableBadRequestException(this.explain(error.safeCode)); throw error }
    const activeKey = this.hash(`domain:${row.domainId}`)
    try {
      const changed = await this.db.vendorWriteJob.updateMany({ where: { id, status: 'failed', errorCode: row.errorCode, activeKey: null }, data: { status: 'queued', activeKey, credentialVersion: eligibility.account.credentialVersion, originSnapshot: row.action === 'register' ? eligibility.origin : row.action === 'deploy' ? eligibility.deployment : undefined, attempts: 0, nextAttemptAt: new Date(), leaseToken: null, leaseExpiresAt: null, errorCode: null, message: MSG.queued } })
      if (changed.count !== 1) throw new ActionableBadRequestException('任务状态已变化，请刷新后重试')
    } catch (error) {
      if (error instanceof ActionableBadRequestException) throw error
      throw new ActionableBadRequestException('任务无法重新入队；请确认该域名没有其他活动操作')
    }
    return this.view(await this.db.vendorWriteJob.findUnique({ where: { id } }))
  }

  /** Called by the application-owned interval; durable DB state is the queue. */
  async tick() {
    if (!this.workerEnabled() || !this.writesEnabled() || this.tickBusy) return
    this.tickBusy = true
    try {
      const staleBefore = new Date()
      // A lease expiry is ambiguous: keep activeKey to prevent duplicate writes.
      await this.db.$executeRaw`UPDATE vendor_write_jobs SET active_key = active_key, status = 'needs_review', error_code = 'LEASE_EXPIRED', message = ${MSG.review}, lease_token = NULL, lease_expires_at = NULL, updated_at = ${staleBefore} WHERE status = 'running' AND lease_expires_at <= ${staleBefore}`
      const job = await this.claim()
      if (job) await this.execute(job)
    } catch {
      // Never log raw DB/provider exceptions; keep outages visible without flooding logs.
      if (Date.now() - this.lastTickWarningAt >= 60_000) {
        this.lastTickWarningAt = Date.now()
        this.logger.warn('云端写入工作器本轮失败；持久任务保留，请检查数据库及队列状态')
      }
    }
    finally { this.tickBusy = false }
  }

  private async claim(): Promise<AnyRow | null> {
    return this.db.$transaction(async (tx: any) => {
      const dueAt = new Date()
      const selected = await tx.$queryRaw`SELECT id FROM vendor_write_jobs WHERE status IN ('queued','retry_wait') AND next_attempt_at <= ${dueAt} ORDER BY next_attempt_at ASC, id ASC LIMIT 1 FOR UPDATE`
      if (!selected?.length) return null
      const id = BigInt(selected[0].id)
      const token = randomUUID(), expires = new Date(Date.now() + LEASE_MS)
      const changed = await tx.vendorWriteJob.updateMany({ where: { id, status: { in: ['queued', 'retry_wait'] }, nextAttemptAt: { lte: new Date() } }, data: { status: 'running', leaseToken: token, leaseExpiresAt: expires, attempts: { increment: 1 }, errorCode: null, message: '受控工作进程正在校验任务' } })
      if (changed.count !== 1) return null
      return tx.vendorWriteJob.findUnique({ where: { id } })
    })
  }

  private async execute(job: AnyRow) {
    if (!this.writesEnabled()) return this.setNeedsReview(job, 'WRITES_DISABLED')
    let lease: AnyRow | null = null
    let deploymentStarted = false
    try {
      lease = await this.beginAccountOperation(job)
      if (!lease) return
      const eligibility = await this.assertEligible(this.db, job.vendorAccountId, job.domainId, job.action, job.credentialVersion, true)
      if (!lease || eligibility.account.credentialVersion !== job.credentialVersion) throw new SafeJobError('PRECONDITION_FAILED', MSG.rejected)
      const driver: any = this.factory.create(lease.code, lease.credentials)
      if (job.action === 'register') {
        const origin = job.originSnapshot as AnyRow | null
        if (!origin || !eligibility.origin || origin.address !== eligibility.origin.address || origin.port !== eligibility.origin.port || origin.protocol !== eligibility.origin.protocol || !await this.isSafeOrigin(origin)) throw new SafeJobError('PRECONDITION_FAILED', MSG.rejected)
        if (typeof driver.registerDomain !== 'function') throw new SafeJobError('UNSUPPORTED_OPERATION', MSG.rejected)
        const created = await driver.registerDomain({ hostname: eligibility.hostname, origin: { address: origin.address, port: origin.port, protocol: origin.protocol } })
        if (!created || typeof created.externalId !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(created.externalId)) throw new SafeJobError('AMBIGUOUS_RESULT', MSG.review)
        const registeredExternalId = created.externalId
        if (!await this.recordExternalReceipt(job, registeredExternalId)) { await this.setNeedsReview(job, 'LEASE_LOST_AFTER_WRITE', lease); return }
        if (created.hostname && this.normalizeHostname(created.hostname) !== eligibility.hostname) throw new SafeJobError('AMBIGUOUS_RESULT', MSG.review)
        await this.persistRegistration(job, lease, eligibility.hostname, registeredExternalId)
      } else if (job.action === 'deploy') {
        const resource = eligibility.resource
        const snapshot = job.originSnapshot as AnyRow | null
        if (!resource?.vendorDomainId || !snapshot || !eligibility.deployment || this.snapshotHash(snapshot) !== this.snapshotHash(eligibility.deployment)) throw new SafeJobError('PRECONDITION_FAILED', MSG.rejected)
        if (typeof driver.deployManagedConfig !== 'function' || typeof driver.verifyManagedConfig !== 'function') throw new SafeJobError('UNSUPPORTED_OPERATION', MSG.rejected)
        const material = snapshot.tls.enabled ? await this.readCertificate(eligibility.domain.userId, snapshot.hostname, snapshot.tls.certId, snapshot.certificateFingerprint) : undefined
        const deployment = { ...snapshot, ...(material ? { certificate: material } : {}) } as VendorDeploymentConfig
        // A deployment spans several writes. Even a later 429/auth error cannot prove zero side effects.
        deploymentStarted = true
        await driver.deployManagedConfig(resource.vendorDomainId, deployment)
        const verified = await driver.verifyManagedConfig(resource.vendorDomainId, deployment)
        if (verified?.verified !== true || typeof verified.providerStatus !== 'string' || !/^[A-Za-z0-9_.-]{1,64}$/.test(verified.providerStatus) || typeof verified.verifiedAt !== 'string' || !Number.isFinite(Date.parse(verified.verifiedAt)) || !Array.isArray(verified.applied) || !verified.applied.every((feature: string) => ['origin', 'cache', 'certificate'].includes(feature)) || !verified.applied.includes('origin') || !verified.applied.includes('cache') || (snapshot.tls?.enabled && !verified.applied.includes('certificate'))) throw new SafeJobError('AMBIGUOUS_RESULT', MSG.review)
        await this.persistDeployment(job, lease, resource.id, resource.vendorDomainId, verified)
      } else {
        const resource = eligibility.resource
        if (!resource || !resource.vendorDomainId) throw new SafeJobError('PRECONDITION_FAILED', MSG.rejected)
        if (typeof driver.deleteManagedDomain !== 'function') throw new SafeJobError('UNSUPPORTED_OPERATION', MSG.rejected)
        const deletedExternalId = resource.vendorDomainId
        await driver.deleteManagedDomain(deletedExternalId, eligibility.hostname)
        // Durable receipt is committed before removing the managed local mapping.
        if (!await this.recordExternalReceipt(job, deletedExternalId)) { await this.setNeedsReview(job, 'LEASE_LOST_AFTER_WRITE', lease); return }
        await this.persistDeletion(job, lease, resource.id, deletedExternalId)
      }
    } catch (error) {
      const safeCode = error instanceof SafeJobError ? error.safeCode : (typeof (error as any)?.safeCode === 'string' ? (error as any).safeCode : undefined)
      if (deploymentStarted) await this.setNeedsReview(job, 'DEPLOYMENT_OUTCOME_UNKNOWN', lease)
      else if (safeCode === 'RATE_LIMITED') await this.safeRetryOrFail(job, lease, 'RATE_LIMITED')
      else if (safeCode && SAFE_RETRY_CODES.has(safeCode)) await this.failKnown(job, lease, safeCode, this.explain(safeCode))
      else await this.setNeedsReview(job, safeCode === 'AMBIGUOUS_RESULT' ? 'AMBIGUOUS_RESULT' : 'OUTCOME_UNKNOWN', lease)
    }
  }

  private async beginAccountOperation(job: AnyRow): Promise<AnyRow> {
    return this.db.$transaction(async (tx: any) => {
      await this.lockAccount(tx, job.vendorAccountId)
      const row = await tx.vendorAccount.findUnique({ where: { id: job.vendorAccountId }, include: { vendor: true } })
      if (!row || row.status !== 1 || row.vendor?.status !== 1 || row.credentialVersion !== job.credentialVersion) throw new SafeJobError('PRECONDITION_FAILED', MSG.rejected)
      const now = new Date()
      if (row.operationToken && row.operationExpiresAt && row.operationExpiresAt > now) {
        await tx.vendorWriteJob.updateMany({ where: { id: job.id, status: 'running', leaseToken: job.leaseToken }, data: { status: 'retry_wait', leaseToken: null, leaseExpiresAt: null, attempts: { decrement: 1 }, nextAttemptAt: new Date(Date.now() + 5000), message: MSG.queued } })
        return null
      }
      const token = randomUUID(), expires = new Date(Date.now() + LEASE_MS)
      const changed = await tx.vendorAccount.updateMany({ where: { id: row.id, credentialVersion: job.credentialVersion, OR: [{ operationToken: null }, { operationExpiresAt: { lte: now } }] }, data: { operationToken: token, operationExpiresAt: expires } })
      if (changed.count !== 1) throw new SafeJobError('PRECONDITION_FAILED', MSG.rejected)
      const credentials = this.readCredentials(row)
      return { id: row.id, token, version: row.credentialVersion, code: row.vendor.code, credentials }
    })
  }

  private async persistRegistration(job: AnyRow, lease: AnyRow, hostname: string, externalId: string) {
    try {
      await this.db.$transaction(async (tx: any) => {
        await this.lockAccount(tx, job.vendorAccountId)
        const current = await tx.vendorAccount.findUnique({ where: { id: job.vendorAccountId } })
        const currentJob = await tx.vendorWriteJob.findUnique({ where: { id: job.id } })
        if (!current || current.operationToken !== lease.token || current.operationExpiresAt <= new Date() || current.credentialVersion !== job.credentialVersion || currentJob?.status !== 'running' || currentJob.leaseToken !== job.leaseToken || !currentJob.leaseExpiresAt || currentJob.leaseExpiresAt <= new Date() || currentJob.externalId !== externalId) throw new Error('unsafe persistence state')
        const fresh = await this.assertEligible(tx, job.vendorAccountId, job.domainId, 'register', job.credentialVersion, false)
        await tx.vendorResource.create({ data: { vendorAccountId: job.vendorAccountId, domainId: job.domainId, vendorDomainId: externalId, managedByPanel: true, resourceData: { hostname, observedOnly: false } } })
        const completed = await tx.vendorWriteJob.updateMany({ where: { id: job.id, status: 'running', leaseToken: job.leaseToken }, data: { status: 'succeeded', externalId, activeKey: null, leaseToken: null, leaseExpiresAt: null, errorCode: null, message: MSG.done } })
        if (completed.count !== 1 || fresh.account.credentialVersion !== job.credentialVersion) throw new Error('unsafe job transition')
        await tx.vendorAccount.update({ where: { id: job.vendorAccountId }, data: { operationToken: null, operationExpiresAt: null } })
      })
    } catch {
      await this.setNeedsReview(job, 'PERSISTENCE_UNKNOWN', lease)
    }
  }

  private async recordExternalReceipt(job: AnyRow, externalId: string): Promise<boolean> {
    // Keep the provider identifier even if a lease expired during an external call.
    const result = await this.db.vendorWriteJob.updateMany({
      where: { id: job.id, OR: [{ status: 'running', leaseToken: job.leaseToken }, { status: 'needs_review', errorCode: 'LEASE_EXPIRED' }] },
      data: { externalId, message: '远端操作已确认；外部标识回执已保存' },
    }).catch(() => ({ count: 0 }))
    return result.count === 1
  }

  private async persistDeletion(job: AnyRow, lease: AnyRow, resourceId: bigint, externalId: string) {
    try {
      await this.db.$transaction(async (tx: any) => {
        await this.lockAccount(tx, job.vendorAccountId)
        const current = await tx.vendorAccount.findUnique({ where: { id: job.vendorAccountId } })
        const currentJob = await tx.vendorWriteJob.findUnique({ where: { id: job.id } })
        const resource = await tx.vendorResource.findUnique({ where: { id: resourceId } })
        if (!current || current.operationToken !== lease.token || !current.operationExpiresAt || current.operationExpiresAt <= new Date() || current.credentialVersion !== job.credentialVersion || currentJob?.status !== 'running' || currentJob.leaseToken !== job.leaseToken || !currentJob.leaseExpiresAt || currentJob.leaseExpiresAt <= new Date() || currentJob.externalId !== externalId || !resource?.managedByPanel || resource.vendorDomainId !== externalId || resource.vendorAccountId !== job.vendorAccountId || resource.domainId !== job.domainId) throw new Error('unsafe persistence state')
        await tx.vendorResource.delete({ where: { id: resourceId } })
        const completed = await tx.vendorWriteJob.updateMany({ where: { id: job.id, status: 'running', leaseToken: job.leaseToken }, data: { status: 'succeeded', activeKey: null, leaseToken: null, leaseExpiresAt: null, errorCode: null, message: MSG.done } })
        if (completed.count !== 1) throw new Error('unsafe job transition')
        await tx.vendorAccount.update({ where: { id: job.vendorAccountId }, data: { operationToken: null, operationExpiresAt: null } })
      })
    } catch { await this.setNeedsReview(job, 'PERSISTENCE_UNKNOWN', lease) }
  }

  private async failKnown(job: AnyRow, lease: AnyRow | null, code: string, message: string) {
    await this.finish(job, lease, { status: 'failed', activeKey: null, errorCode: code, message })
  }
  private async safeRetryOrFail(job: AnyRow, lease: AnyRow | null, code: string) {
    if (job.attempts < RETRY_LIMIT) {
      await this.finish(job, lease, { status: 'retry_wait', errorCode: code, message: MSG.rateLimited, nextAttemptAt: new Date(Date.now() + (RETRY_BACKOFF_MS[job.attempts - 1] ?? RETRY_BACKOFF_MS[0])), leaseToken: null, leaseExpiresAt: null, attempts: job.attempts })
    } else await this.failKnown(job, lease, code, MSG.failed)
  }
  private async setNeedsReview(job: AnyRow, code: string, lease?: AnyRow | null) {
    await this.finish(job, lease ?? null, { status: 'needs_review', errorCode: code, message: MSG.review, leaseToken: null, leaseExpiresAt: null })
  }
  private async finish(job: AnyRow, lease: AnyRow | null, data: AnyRow) {
    try {
      await this.db.$transaction(async (tx: any) => {
        if (lease) {
          await this.lockAccount(tx, job.vendorAccountId)
          const account = await tx.vendorAccount.findUnique({ where: { id: job.vendorAccountId } })
          if (account?.operationToken === lease.token) await tx.vendorAccount.update({ where: { id: job.vendorAccountId }, data: { operationToken: null, operationExpiresAt: null } })
        }
        await tx.vendorWriteJob.updateMany({ where: { id: job.id, status: 'running', leaseToken: job.leaseToken }, data })
      })
    } catch {
      // Preserve the activeKey and quarantine with a fixed note if any outcome transaction is uncertain.
      await this.db.vendorWriteJob.updateMany({ where: { id: job.id, status: 'running', leaseToken: job.leaseToken }, data: { status: 'needs_review', errorCode: 'PERSISTENCE_UNKNOWN', message: MSG.review, leaseToken: null, leaseExpiresAt: null } }).catch(() => undefined)
    }
  }

  private async assertEligible(tx: any, accountId: bigint, domainId: bigint, action: WriteAction, expectedVersion?: number, checkDns = false): Promise<AnyRow> {
    const account = await tx.vendorAccount.findUnique({ where: { id: accountId }, include: { vendor: true } })
    const domain = await tx.domain.findUnique({ where: { id: domainId }, include: { config: true, cacheRules: true, originGroups: { include: { origins: true } } } })
    if (!account || account.status !== 1 || account.vendor?.status !== 1) throw new SafeJobError('PRECONDITION_FAILED', MSG.rejected)
    if (expectedVersion !== undefined && account.credentialVersion !== expectedVersion) throw new SafeJobError('PRECONDITION_FAILED', MSG.rejected)
    if (!domain) throw new SafeJobError('DOMAIN_UNAVAILABLE', MSG.rejected)
    const hostname = this.normalizeHostname(domain.domain)
    if (!hostname || isIP(hostname)) throw new SafeJobError('PRECONDITION_FAILED', MSG.rejected)

    let origin: AnyRow | undefined
    let resource: AnyRow | undefined
    let certificateFingerprint: string | null = null
    if (action === 'register' || action === 'deploy') {
      if (domain.deletedAt) throw new SafeJobError('DOMAIN_UNAVAILABLE', MSG.rejected)
      if (domain.auditStatus !== 2) throw new SafeJobError('AUDIT_NOT_APPROVED', MSG.rejected)
      if (![2, 3].includes(domain.accessType)) throw new SafeJobError('ACCESS_TYPE_UNSUPPORTED', MSG.rejected)
      const user = await tx.user.findUnique({ where: { id: domain.userId }, select: { id: true, status: true, packageId: true, packageExpireAt: true } })
      if (!user || user.status !== 1) throw new SafeJobError('DOMAIN_UNAVAILABLE', MSG.rejected)
      if (!user.packageId || !user.packageExpireAt || user.packageExpireAt <= new Date()) throw new SafeJobError('PACKAGE_REQUIRED', MSG.rejected)
      const currentPackage = await tx.package.findUnique({ where: { id: user.packageId } })
      if (!currentPackage || currentPackage.status !== 1 || ![2, 3].includes(currentPackage.accessType)) throw new SafeJobError('PACKAGE_UNAVAILABLE', MSG.rejected)
      if (currentPackage.vendorId !== account.vendorId) throw new SafeJobError('PACKAGE_VENDOR_MISMATCH', MSG.rejected)
      if (action === 'register' && domain.cacheRules?.some((r: AnyRow) => r.status === 1)) throw new SafeJobError('CACHE_RULES_UNSUPPORTED', MSG.rejected)
      const config = domain.config
      if (action === 'register' && config && (config.httpsEnabled || config.forceHttps || config.hstsEnabled || config.certId || config.tlsVersion !== 'TLSv1.2' || config.originHost || config.defaultTtl !== 3600)) throw new SafeJobError('TLS_OR_DOMAIN_CONFIG_UNSUPPORTED', MSG.rejected)
      if (action === 'deploy' && (domain.cacheRules?.some((r: AnyRow) => r.status === 1) || config?.originHost || config?.forceHttps || config?.hstsEnabled || (config?.tlsVersion && config.tlsVersion !== 'TLSv1.2'))) throw new SafeJobError('TLS_OR_DOMAIN_CONFIG_UNSUPPORTED', MSG.rejected)
      const groups = domain.originGroups ?? []
      if (groups.length !== 1 || groups[0].lbPolicy !== 'round_robin' || groups[0].healthCheck) throw new SafeJobError('ORIGIN_GROUP_UNSUPPORTED', MSG.rejected)
      const origins = (groups[0].origins ?? []).filter((o: AnyRow) => o.status === 1)
      if (origins.length !== 1 || origins[0].isBackup || !['http', 'https'].includes(origins[0].protocol) || origins[0].weight !== 1 || origins[0].host) throw new SafeJobError('ORIGIN_UNSUPPORTED', MSG.rejected)
      origin = { address: origins[0].address, port: origins[0].port, protocol: origins[0].protocol }
      const configuredOriginProtocol = config?.originProtocol ?? 'http'
      if (configuredOriginProtocol !== origin.protocol) throw new SafeJobError('ORIGIN_PROTOCOL_MISMATCH', MSG.rejected)
      if (account.vendor.code === 'cloudflare') {
        if (origin.protocol !== 'https' || origin.port !== 443 || isIP(origin.address)) throw new SafeJobError('ORIGIN_UNSUPPORTED', MSG.rejected)
      } else if (account.vendor.code === 'ali') {
        if (hostname.length > 128) throw new SafeJobError('HOSTNAME_TOO_LONG', MSG.rejected)
        if ((origin.protocol === 'http' && origin.port !== 80) || (origin.protocol === 'https' && origin.port !== 443)) throw new SafeJobError('ORIGIN_UNSUPPORTED', MSG.rejected)
      } else throw new SafeJobError('UNSUPPORTED_OPERATION', MSG.rejected)
      if (!await this.isSafeOrigin(origin, checkDns)) throw new SafeJobError('ORIGIN_UNSAFE', MSG.rejected)
      if (action === 'register') {
        const mapped = await tx.vendorResource.findMany({ where: { domainId }, select: { id: true } })
        if (mapped.length) throw new SafeJobError('RESOURCE_CONFLICT', MSG.rejected)
      } else {
        resource = await tx.vendorResource.findFirst({ where: { vendorAccountId: accountId, domainId }, select: { id: true, vendorDomainId: true, managedByPanel: true, vendorAccountId: true, domainId: true } })
        if (!resource?.managedByPanel || !resource.vendorDomainId) throw new SafeJobError('MANAGED_RESOURCE_REQUIRED', MSG.rejected)
      }
      if (action === 'deploy') {
        const ttl = config?.defaultTtl ?? 3600
        if (!Number.isInteger(ttl) || ttl < 1 || ttl > 31536000) throw new SafeJobError('CACHE_RULES_UNSUPPORTED', MSG.rejected)
        if (config?.httpsEnabled) {
          certificateFingerprint = config.certId ? await this.certificateIdentity(domain.userId, hostname, config.certId, tx) : null
          if (!certificateFingerprint) throw new SafeJobError('CERTIFICATE_INVALID', MSG.rejected)
        } else if (config?.certId) throw new SafeJobError('TLS_OR_DOMAIN_CONFIG_UNSUPPORTED', MSG.rejected)
        origin = { address: origins[0].address, port: origins[0].port, protocol: origins[0].protocol, host: origins[0].host ?? null }
      }
    } else {
      resource = await tx.vendorResource.findFirst({ where: { vendorAccountId: accountId, domainId }, select: { id: true, vendorDomainId: true, managedByPanel: true, vendorAccountId: true, domainId: true } })
      if (!resource?.managedByPanel || !resource.vendorDomainId) throw new SafeJobError('MANAGED_RESOURCE_REQUIRED', MSG.rejected)
    }
    const deployment: AnyRow | undefined = action === 'deploy' ? {
      hostname,
      origin: { address: origin!.address, port: origin!.port, protocol: origin!.protocol, host: origin!.host ?? null },
      defaultTtl: domain.config?.defaultTtl ?? 3600,
      tls: { enabled: Boolean(domain.config?.httpsEnabled), certId: domain.config?.certId == null ? null : String(domain.config.certId), forceHttps: Boolean(domain.config?.forceHttps), hstsEnabled: Boolean(domain.config?.hstsEnabled), tlsVersion: domain.config?.tlsVersion ?? 'TLSv1.2' },
      certificateFingerprint,
      managedExternalId: resource!.vendorDomainId,
    } : undefined
    return { account, domain, hostname, origin, resource, deployment }
  }

  private async persistDeployment(job: AnyRow, lease: AnyRow, resourceId: bigint, externalId: string, result: AnyRow) {
    try {
      await this.db.$transaction(async (tx: any) => {
        await this.lockAccount(tx, job.vendorAccountId)
        const account = await tx.vendorAccount.findUnique({ where: { id: job.vendorAccountId } })
        const currentJob = await tx.vendorWriteJob.findUnique({ where: { id: job.id } })
        const resource = await tx.vendorResource.findUnique({ where: { id: resourceId } })
        if (!account || account.operationToken !== lease.token || !account.operationExpiresAt || account.operationExpiresAt <= new Date() || account.credentialVersion !== job.credentialVersion || currentJob?.status !== 'running' || currentJob.leaseToken !== job.leaseToken || !currentJob.leaseExpiresAt || currentJob.leaseExpiresAt <= new Date() || !resource?.managedByPanel || resource.vendorDomainId !== externalId || resource.vendorAccountId !== job.vendorAccountId || resource.domainId !== job.domainId) throw new Error('unsafe persistence state')
        const fresh = await this.assertEligible(tx, job.vendorAccountId, job.domainId, 'deploy', job.credentialVersion, false)
        if (this.snapshotHash(fresh.deployment) !== this.snapshotHash(job.originSnapshot)) throw new Error('configuration changed during deployment')
        const completed = await tx.vendorWriteJob.updateMany({ where: { id: job.id, status: 'running', leaseToken: job.leaseToken }, data: { status: 'succeeded', externalId, activeKey: null, leaseToken: null, leaseExpiresAt: null, errorCode: null, message: '対応設定を配信して読み戻し検証済み。実通信・DNS・TLS の疎通や公開状態は別途確認してください。' } })
        if (completed.count !== 1) throw new Error('unsafe job transition')
        await tx.vendorResource.update({ where: { id: resourceId }, data: { syncedAt: new Date(), resourceData: { hostname: fresh.hostname, observedOnly: false, deploymentVerifiedAt: new Date().toISOString(), deploymentSnapshotHash: this.snapshotHash(job.originSnapshot), verifiedFeatures: result.applied, providerStatus: result.providerStatus } } })
        await tx.vendorAccount.update({ where: { id: job.vendorAccountId }, data: { operationToken: null, operationExpiresAt: null } })
      })
    } catch { await this.setNeedsReview(job, 'PERSISTENCE_UNKNOWN', lease) }
  }

  private async certificateIdentity(userId: bigint, hostname: string, certId: bigint, db: any = this.db): Promise<string | null> {
    try {
      const cert = await db.certificate.findFirst({ where: { id: certId, userId, status: 1 } })
      if (!cert || !cert.certPem || !cert.keyPem?.startsWith('enc:v1:') || cert.notBefore > new Date() || cert.notAfter <= new Date()) return null
      const leaf = new X509Certificate(cert.certPem)
      if (!leaf.checkHost(hostname, { subject: 'never' }) || Date.parse(leaf.validFrom) > Date.now() || Date.parse(leaf.validTo) <= Date.now()) return null
      return leaf.fingerprint256
    } catch { return null }
  }

  private async readCertificate(userId: bigint, hostname: string, certId: string | null, expectedFingerprint: string) {
    if (!certId || !/^[1-9][0-9]{0,19}$/.test(certId) || typeof expectedFingerprint !== 'string' || !/^(?:[A-F0-9]{2}:){31}[A-F0-9]{2}$/.test(expectedFingerprint)) throw new SafeJobError('CERTIFICATE_INVALID', MSG.rejected)
    const row = await this.db.certificate.findFirst({ where: { id: BigInt(certId), userId, status: 1 } })
    if (!row || await this.certificateIdentity(userId, hostname, BigInt(certId)) !== expectedFingerprint) throw new SafeJobError('CERTIFICATE_INVALID', MSG.rejected)
    const key = this.config.get<any>('security')?.encryptionKey || process.env.SECURITY_ENCRYPTION_KEY || process.env.ENCRYPTION_KEY
    if (typeof key !== 'string' || !key.trim()) throw new SafeJobError('PRECONDITION_FAILED', MSG.rejected)
    try {
      const privateKeyPem = decrypt(row.keyPem.slice(7), key)
      const leaf = new X509Certificate(row.certPem)
      if (leaf.fingerprint256 !== expectedFingerprint) throw new Error()
      const certKey = leaf.publicKey.export({ type: 'spki', format: 'der' }) as Buffer
      const privatePublic = createPublicKey(createPrivateKey(privateKeyPem)).export({ type: 'spki', format: 'der' }) as Buffer
      if (certKey.length !== privatePublic.length || !timingSafeEqual(certKey, privatePublic)) throw new Error()
      const certificatePem = [row.certPem, row.chainPem].filter(Boolean).join('\n')
      if (Buffer.byteLength(certificatePem) + Buffer.byteLength(privateKeyPem) > 64 * 1024) throw new Error()
      return { certificatePem, privateKeyPem }
    } catch { throw new SafeJobError('CERTIFICATE_INVALID', MSG.rejected) }
  }

  private async isSafeOrigin(origin: AnyRow, resolveDns = true): Promise<boolean> {
    if (!origin || typeof origin.address !== 'string' || !Number.isInteger(origin.port) || !SAFE_PORTS.has(origin.port) || (origin.protocol !== 'http' && origin.protocol !== 'https')) return false
    if ((origin.protocol === 'http' && origin.port !== 80) || (origin.protocol === 'https' && origin.port !== 443)) return false
    const address = origin.address.trim()
    if (!address || address !== origin.address) return false
    if (isIP(address)) return isPublicAddress(address)
    if (/[\s/:?#@\\]/.test(address) || address.endsWith('.')) return false
    const hostname = this.normalizeHostname(address)
    if (!hostname) return false
    if (!resolveDns) return true
    let timer: ReturnType<typeof setTimeout> | undefined
    try {
      const resolved = await Promise.race([
        lookup(hostname, { all: true, verbatim: true }),
        new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error('DNS timeout')), 2000) }),
      ])
      return resolved.length > 0 && resolved.every((item) => isPublicAddress(item.address))
    } catch { return false }
    finally { if (timer) clearTimeout(timer) }
  }

  private async lockAccount(tx: any, id: bigint) { await tx.$queryRaw`SELECT a.id FROM vendor_accounts a INNER JOIN vendors v ON v.id = a.vendor_id WHERE a.id = ${id} FOR UPDATE` }
  private async requireAccount(id: bigint) { const row = await this.db.vendorAccount.findUnique({ where: { id }, select: { id: true } }); if (!row) throw new ActionableBadRequestException('未找到该厂商账号') }
  private readCredentials(row: AnyRow) {
    const key = this.config.get<any>('security')?.encryptionKey || process.env.SECURITY_ENCRYPTION_KEY || process.env.ENCRYPTION_KEY
    if (typeof key !== 'string' || !key.trim()) throw new SafeJobError('PRECONDITION_FAILED', MSG.rejected)
    const mode = this.config.get<string>('app.env') || process.env.NODE_ENV
    if (mode === 'production' && (key.trim().length < 32 || PROD_DEFAULT_KEYS.has(key.toLowerCase().trim()))) throw new SafeJobError('PRECONDITION_FAILED', MSG.rejected)
    try {
      if (typeof row.accessKey !== 'string' || !row.accessKey.startsWith('enc:v1:')) throw new Error()
      const accessKey = decrypt(row.accessKey.slice(7), key)
      const secretKey = row.secretKey ? (row.secretKey.startsWith('enc:v1:') ? decrypt(row.secretKey.slice(7), key) : (() => { throw new Error() })()) : ''
      return { accessKey, secretKey, config: row.config ?? {} }
    } catch { throw new SafeJobError('PRECONDITION_FAILED', MSG.rejected) }
  }
  private normalizeHostname(value: unknown): string | null {
    if (typeof value !== 'string' || !value || value !== value.trim() || /[\s/:?#@*\\]/.test(value) || value.endsWith('.')) return null
    const host = domainToASCII(value).toLowerCase()
    if (!host || host.length > 253 || host.split('.').length < 2 || host.split('.').some((label) => !label || label.length > 63 || !/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(label))) return null
    return host
  }
  private parseId(value: unknown, label: string): bigint {
    if (typeof value !== 'string' && typeof value !== 'bigint') throw new ActionableBadRequestException(`${label}格式无效`)
    const text = String(value)
    if (!/^[1-9][0-9]{0,19}$/.test(text)) throw new ActionableBadRequestException(`${label}格式无效`)
    try { const id = BigInt(text); if (id > MAX_ID) throw new Error(); return id } catch { throw new ActionableBadRequestException(`${label}格式无效`) }
  }
  private pageNumber(value: unknown, min: number, max: number) { const n = typeof value === 'number' ? value : Number(value); if (!Number.isInteger(n) || n < min || n > max) throw new ActionableBadRequestException('分页参数超出允许范围'); return n }
  private hash(value: string) { return createHash('sha256').update(value).digest('hex') }
  private snapshotHash(value: unknown): string {
    const canonical = (input: unknown): unknown => {
      if (Array.isArray(input)) return input.map(canonical)
      if (input && typeof input === 'object') return Object.fromEntries(Object.entries(input).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => [key, canonical(item)]))
      return input
    }
    return this.hash(JSON.stringify(canonical(value)))
  }
  private explain(code: string) {
    const messages: Record<string, string> = {
      AUTH_FAILED: '厂商凭据被拒绝；未执行云端写入，请更新凭据后显式重试', ORIGIN_PROTOCOL_MISMATCH: '域名回源协议必须与唯一源站一致；未执行云端写入', HOSTNAME_TOO_LONG: '当前阿里云基础注册仅支持不超过128字符的域名；未执行云端写入',
      CERTIFICATE_INVALID: '証明書の所有者・有効期限・SAN・鍵、または配信時の証明書識別が一致しません。クラウド書き込みは実行していません。',
      RATE_LIMITED: '厂商限流且确认未执行写入；可在安全条件下人工重试', PRECONDITION_FAILED: '厂商账号状态或凭据版本已变化；未执行云端写入', DOMAIN_UNAVAILABLE: '域名或域名用户不可用；未执行云端写入', AUDIT_NOT_APPROVED: '域名尚未审核通过；未执行云端写入', ACCESS_TYPE_UNSUPPORTED: '域名接入类型不支持基础云注册；未执行云端写入', PACKAGE_REQUIRED: '域名用户没有有效套餐；未执行云端写入', PACKAGE_UNAVAILABLE: '域名用户套餐未启用或类型不支持；未执行云端写入', PACKAGE_VENDOR_MISMATCH: '套餐厂商与选定账号不匹配；未执行云端写入', CACHE_RULES_UNSUPPORTED: '存在未支持的自定义缓存规则；未执行云端写入', TLS_OR_DOMAIN_CONFIG_UNSUPPORTED: '存在未支持的HTTPS、HSTS、TLS或域名配置；未执行云端写入', ORIGIN_GROUP_UNSUPPORTED: '仅支持单一默认轮询源站组，且不支持自定义健康检查；未执行云端写入', ORIGIN_UNSUPPORTED: '仅支持单个默认源站（阿里云HTTP:80或HTTPS:443；Cloudflare仅HTTPS:443域名源站），不支持备用、权重或Host定制；未执行云端写入', ORIGIN_UNSAFE: '源站地址、端口或公网DNS校验不通过；未执行云端写入', RESOURCE_CONFLICT: '域名已存在厂商资源映射；禁止认领或覆盖；未执行云端写入', MANAGED_RESOURCE_REQUIRED: '仅能删除此账号由控制面创建且带远端ID的资源；未执行云端写入', UNSUPPORTED_OPERATION: '厂商驱动不支持该写操作；未执行云端写入', INVALID_CONFIG: '厂商账号配置无效；未执行云端写入',
    }
    return messages[code] ?? MSG.rejected
  }
  private view(row: AnyRow) { return { id: String(row.id), vendorAccountId: String(row.vendorAccountId), domainId: String(row.domainId), requestedBy: String(row.requestedBy), action: row.action, status: row.status, attempts: row.attempts, nextAttemptAt: row.nextAttemptAt, retryable: row.status === 'failed' && SAFE_RETRY_CODES.has(row.errorCode ?? ''), externalId: row.externalId ?? null, errorCode: row.errorCode, message: row.message, createdAt: row.createdAt, updatedAt: row.updatedAt } }
  private writesEnabled() { return process.env.VENDOR_WRITES_ENABLED === 'true' }
  private workerEnabled() { return process.env.VENDOR_WRITE_WORKER_ENABLED === 'true' }
}

class SafeJobError extends Error {
  constructor(readonly safeCode: string, message: string) { super(message); this.name = 'SafeJobError' }
}

import { ForbiddenException, Injectable, NotFoundException, Optional, Inject } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { createHash, createPrivateKey, X509Certificate } from 'node:crypto'
import { Resolver } from 'node:dns/promises'
import { domainToASCII } from 'node:url'
import * as acme from 'acme-client'
import { encrypt, decrypt } from '../../common/utils/crypto.util'
import { ActionableBadRequestException as BadRequestException } from '../../common/exceptions/actionable.exception'
import { PrismaService } from '../../database/prisma.service'
import { CertificateService } from './certificate.service'

export const ACME_CLIENT_FACTORY = Symbol('ACME_CLIENT_FACTORY')
export const ACME_DNS_RESOLVER = Symbol('ACME_DNS_RESOLVER')
export type AcmeClientLike = Record<string, (...args: any[]) => Promise<any>>
export type AcmeClientFactory = (settings: AcmeSettings) => AcmeClientLike
export type AcmeDnsResolver = (name: string, signal?: AbortSignal) => Promise<string[][]>
export type AcmeSettings = { directory: string; email: string; accountKey: string; acceptTos: boolean }

const DIRECTORY_ALLOWLIST = new Set([
  'https://acme-staging-v02.api.letsencrypt.org/directory',
  'https://acme-v02.api.letsencrypt.org/directory',
])
const STAGING_DIRECTORY = 'https://acme-staging-v02.api.letsencrypt.org/directory'
const PRODUCTION_DIRECTORY = 'https://acme-v02.api.letsencrypt.org/directory'
const JOB_TTL_MS = 24 * 60 * 60 * 1000
const MAX_SAN = 10
const DNS_LOOKUP_TIMEOUT_MS = 5_000
const DNS_PROPAGATION_TIMEOUT_MS = 60_000
const STUCK_PROCESSING_MS = 10 * 60 * 1000
const MAX_CLOUDFLARE_RESPONSE_BYTES = 64 * 1024

function cancellableTxtResolver(name: string, signal?: AbortSignal): Promise<string[][]> {
  const resolver = new Resolver()
  return new Promise((resolve, reject) => {
    const abort = () => { resolver.cancel(); reject(new Error('DNS lookup aborted')) }
    if (signal?.aborted) return abort()
    signal?.addEventListener('abort', abort, { once: true })
    resolver.resolveTxt(name).then(resolve, reject).finally(() => signal?.removeEventListener('abort', abort))
  })
}

function defaultClient(settings: AcmeSettings): AcmeClientLike {
  const defaults = acme.axios.defaults as typeof acme.axios.defaults & { acmeSettings: { retryMaxAttempts: number; retryDefaultDelay: number } }
  defaults.timeout = 10_000
  defaults.maxRedirects = 0
  defaults.maxContentLength = 256 * 1024
  defaults.maxBodyLength = 256 * 1024
  defaults.acmeSettings.retryMaxAttempts = 0
  return new acme.Client({ directoryUrl: settings.directory, accountKey: settings.accountKey, backoffAttempts: 6, backoffMin: 1_000, backoffMax: 5_000 }) as unknown as AcmeClientLike
}
function unsignedId(value: string): bigint {
  if (typeof value !== 'string' || !/^[1-9]\d{0,19}$/.test(value)) throw new BadRequestException('Invalid ID')
  const id = BigInt(value)
  if (id > 18446744073709551615n) throw new BadRequestException('Invalid ID')
  return id
}
function normalizeName(value: unknown): string {
  if (typeof value !== 'string' || value.length > 1024 || /[\s/:?#@*]/.test(value) || value.endsWith('.')) throw new BadRequestException('Invalid domain name')
  const ascii = domainToASCII(value).toLowerCase()
  if (!ascii || ascii.length > 253 || ascii.split('.').length < 2 || ascii.split('.').some((label) => !label || label.length > 63 || !/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(label))) throw new BadRequestException('Invalid domain name')
  return ascii
}

@Injectable()
export class AcmeService {
  private readonly db: Record<string, any>
  private readonly clientFactory: AcmeClientFactory
  private readonly dnsResolver: AcmeDnsResolver

  constructor(
    prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly certificates: CertificateService,
    @Optional() @Inject(ACME_CLIENT_FACTORY) clientFactory?: AcmeClientFactory,
    @Optional() @Inject(ACME_DNS_RESOLVER) dnsResolver?: AcmeDnsResolver,
  ) {
    this.db = prisma as unknown as Record<string, any>
    this.clientFactory = clientFactory ?? defaultClient
    this.dnsResolver = dnsResolver ?? cancellableTxtResolver
  }

  private settings(): AcmeSettings {
    const accountKey = (process.env.ACME_ACCOUNT_KEY || '').replace(/\\n/g, '\n')
    const email = process.env.ACME_EMAIL || ''
    const selected = process.env.ACME_DIRECTORY || process.env.ACME_PROFILE || 'staging'
    const directory = selected === 'staging' ? STAGING_DIRECTORY : selected === 'production' ? PRODUCTION_DIRECTORY : selected
    if (!accountKey || !email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      throw new BadRequestException('ACME is not configured: set ACME_ACCOUNT_KEY (PEM private key) and ACME_EMAIL; no CA was contacted.')
    }
    if (!DIRECTORY_ALLOWLIST.has(directory)) throw new BadRequestException('ACME_DIRECTORY must be the exact Let’s Encrypt staging or production directory URL (or ACME_PROFILE=staging|production).')
    try { createPrivateKey(accountKey) } catch { throw new BadRequestException('ACME_ACCOUNT_KEY must contain a valid PEM private key.') }
    const acceptTos = process.env.ACME_ACCEPT_TOS === 'true'
    if (directory === PRODUCTION_DIRECTORY && !acceptTos) throw new BadRequestException('Production ACME requires explicit ACME_ACCEPT_TOS=true after reviewing Let’s Encrypt terms; no CA was contacted.')
    if (!acceptTos) throw new BadRequestException('ACME_ACCEPT_TOS=true is required to explicitly record acceptance of the selected CA terms; no CA was contacted.')
    return { directory, email, accountKey, acceptTos }
  }

  private accountThumbprint(settings: AcmeSettings): string {
    // acme-client 5.4 computes key authorization from SHA256(JSON.stringify(getJwk(accountKey))).
    return createHash('sha256').update(JSON.stringify(acme.crypto.getJwk(settings.accountKey))).digest('base64url')
  }

  private async dnsAnswer(name: string, deadline = Date.now() + DNS_LOOKUP_TIMEOUT_MS): Promise<string[][]> {
    const remaining = Math.min(DNS_LOOKUP_TIMEOUT_MS, deadline - Date.now())
    if (remaining <= 0) throw new Error('DNS deadline exceeded')
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), remaining)
    let abortLookup: (() => void) | undefined
    try {
      return await Promise.race([
        this.dnsResolver(name, controller.signal),
        new Promise<string[][]>((_resolve, reject) => {
          abortLookup = () => reject(new Error('DNS lookup timed out'))
          controller.signal.addEventListener('abort', abortLookup, { once: true })
        }),
      ])
    } finally {
      clearTimeout(timer)
      if (abortLookup) controller.signal.removeEventListener('abort', abortLookup)
    }
  }

  private hasTxtValue(answer: string[][], expected: string): boolean {
    return answer.some((chunks) => Array.isArray(chunks) && chunks.join('') === expected)
  }

  private encryptionSecret(): string {
    const security = this.config.get<{ encryptionKey?: string }>('security')
    const secret = security?.encryptionKey
    const env = this.config.get<string>('app.env') ?? process.env.NODE_ENV ?? 'development'
    if (!secret || (env === 'production' && secret === '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef')) throw new ForbiddenException('Certificate encryption is not securely configured')
    return secret
  }

  private async approvedDomains(userId: bigint, ids: bigint[]) {
    const unique = [...new Set(ids.map(String))].map(BigInt)
    if (!unique.length || unique.length > MAX_SAN) throw new BadRequestException(`Request between 1 and ${MAX_SAN} approved domains.`)
    const now = new Date()
    const [domains, entitlement] = await Promise.all([
      this.db.domain.findMany({ where: { id: { in: unique }, userId, deletedAt: null } }),
      this.db.userPackage.findFirst({ where: { userId, status: 1, startAt: { lte: now }, expireAt: { gt: now }, package: { status: 1 } }, select: { id: true } }),
    ])
    if (!entitlement) throw new ForbiddenException('An active package is required to request an ACME certificate.')
    if (domains.length !== unique.length) throw new NotFoundException('One or more owned domains were not found.')
    const approved = domains.filter((domain: any) => domain.auditStatus === 2)
    if (approved.length !== domains.length) throw new ForbiddenException('Every requested domain must be approved before ACME issuance.')
    const byId = new Map(domains.map((domain: any) => [String(domain.id), domain]))
    const ordered = unique.map((id) => byId.get(String(id))!)
    const names = ordered.map((domain: any) => normalizeName(domain.domain))
    if (new Set(names).size !== names.length) throw new BadRequestException('Duplicate domains are not allowed.')
    return { domains: ordered, names }
  }

  private toPublicJob(row: any) {
    const challenge = row.challenge && typeof row.challenge === 'object' ? row.challenge : null
    const domains = Array.isArray(row.domains) ? row.domains.filter((domain: any) => domain && typeof domain === 'object').map((domain: any) => ({
      id: String(domain.id ?? ''), domain: String(domain.domain ?? ''), autoRenew: domain.autoRenew === true,
    })) : []
    const records = Array.isArray(challenge?.records) ? challenge.records.filter((record: any) => record && typeof record === 'object' && typeof record.name === 'string' && typeof record.value === 'string').map((record: any) => ({
      name: record.name, value: record.value, domain: typeof record.domain === 'string' ? record.domain : '',
    })) : []
    return {
      id: String(row.id), status: row.status, domains,
      challenge: challenge ? { type: 'dns-01', records } : null,
      certificateId: row.certificateId == null ? null : String(row.certificateId),
      expiresAt: row.expiresAt, error: row.error ?? null, createdAt: row.createdAt, updatedAt: row.updatedAt,
    }
  }

  async apply(userIdRaw: string, input: { domainIds?: string[]; domainId?: string; autoRenew?: boolean }) {
    const settings = this.settings()
    const secret = this.encryptionSecret()
    if (input.autoRenew !== undefined && typeof input.autoRenew !== 'boolean') throw new BadRequestException('autoRenew must be a boolean.')
    if (input.autoRenew === true) this.requireCloudflare()
    const rawIds = input.domainIds ?? (input.domainId ? [input.domainId] : [])
    if (!Array.isArray(rawIds) || !rawIds.length || rawIds.length > MAX_SAN || rawIds.some((id) => typeof id !== 'string' || !/^[1-9]\d{0,19}$/.test(id))) throw new BadRequestException(`Provide 1–${MAX_SAN} domainIds owned by your account.`)
    const userId = unsignedId(userIdRaw)
    const { domains, names } = await this.approvedDomains(userId, rawIds.map(unsignedId))
    return this.startOrder({ userId, domains, names, certificateId: null, autoRenew: input.autoRenew === true, settings, secret })
  }

  async renew(userIdRaw: string, rawCertificateId: string) {
    const settings = this.settings()
    const secret = this.encryptionSecret()
    const userId = unsignedId(userIdRaw)
    const certId = unsignedId(rawCertificateId)
    const cert = await this.db.certificate.findFirst({ where: { id: certId, userId } })
    if (!cert) throw new NotFoundException('Certificate not found')
    if (cert.autoRenew === true) this.requireCloudflare()
    const bindings = await this.db.domainConfig.findMany({ where: { certId }, include: { domain: true } })
    const domainRows: any[] = bindings.map((row: any) => row.domain).filter((domain: any) => domain && domain.deletedAt === null)
    if (!domainRows.length && Array.isArray(cert.acmeDomains)) {
      for (const name of cert.acmeDomains) {
        const domain = await this.db.domain.findFirst({ where: { userId, domain: name, deletedAt: null } })
        if (domain) domainRows.push(domain)
      }
    }
    if (!domainRows.length) throw new BadRequestException('Renewal requires at least one active domain owned by this account.')
    const { domains, names } = await this.approvedDomains(userId, domainRows.map((domain) => BigInt(domain.id)))
    // An existing certificate may be renewed only for the exact current binding set.
    const currentBound = new Set(domainRows.map((domain) => normalizeName(domain.domain)))
    if ([...currentBound].some((name) => !names.includes(name))) throw new BadRequestException('Renewal must cover every active domain binding.')
    return this.startOrder({ userId, domains, names, certificateId: certId, autoRenew: cert.autoRenew === true, settings, secret })
  }

  private async createAccount(client: AcmeClientLike, settings: AcmeSettings) {
    if (typeof client.createAccount === 'function') await client.createAccount({ termsOfServiceAgreed: settings.acceptTos, contact: [`mailto:${settings.email}`] })
  }

  private async createOrReuseJob(data: Record<string, any>, names: string[]) {
    return this.db.$transaction(async (tx: Record<string, any>) => {
      if (typeof tx.$queryRawUnsafe === 'function') {
        await tx.$queryRawUnsafe('SELECT `id` FROM `users` WHERE `id` = ? FOR UPDATE', data.userId)
      }
      const active = await tx.certificateJob.findMany({ where: { userId: data.userId, status: { in: ['pending', 'needs_dns', 'processing'] }, expiresAt: { gt: new Date() } } })
      const requested = [...names].sort().join('\0')
      const existing = active.find((row: any) => {
        if ((row.certificateId == null ? null : String(row.certificateId)) !== (data.certificateId == null ? null : String(data.certificateId))) return false
        const existingNames = (Array.isArray(row.domains) ? row.domains : []).map((entry: any) => normalizeName(entry.domain ?? entry)).sort().join('\0')
        return existingNames === requested
      })
      if (existing) return { job: existing, created: false }
      return { job: await tx.certificateJob.create({ data }), created: true }
    }, { isolationLevel: 'Serializable' })
  }

  private async startOrder(args: { userId: bigint; domains: any[]; names: string[]; certificateId: bigint | null; autoRenew: boolean; settings: AcmeSettings; secret: string }) {
    const { userId, domains, names, certificateId, autoRenew, settings, secret } = args
    if (names.length > MAX_SAN) throw new BadRequestException(`ACME supports at most ${MAX_SAN} names per certificate.`)
    const [privateKey, csr] = await acme.crypto.createCsr({ commonName: names[0], altNames: names })
    const created = await this.createOrReuseJob({
      userId, domainId: domains[0].id, certificateId, status: 'processing',
      domains: domains.map((domain: any) => ({ id: String(domain.id), domain: normalizeName(domain.domain), autoRenew })),
      privateKey: `enc:v1:${encrypt(privateKey.toString('utf8'), secret)}`, csr: csr.toString('utf8'), expiresAt: new Date(Date.now() + JOB_TTL_MS),
    }, names)
    if (!created.created) return this.toPublicJob(created.job)
    const job = created.job
    const createdCloudflare: { id: string }[] = []
    try {
      const client = this.clientFactory(settings)
      await this.createAccount(client, settings)
      const order = await client.createOrder({ identifiers: names.map((value) => ({ type: 'dns', value })) })
      const authorizations = await client.getAuthorizations(order)
      const records: { name: string; value: string; domain: string }[] = []
      const pending: any[] = []
      for (const authorization of authorizations) {
        const domain = normalizeName(authorization.identifier?.value)
        const challenge = authorization.challenges?.find((candidate: any) => candidate.type === 'dns-01')
        if (!challenge) throw new Error('dns challenge unavailable')
        // In acme-client 5.4 dns-01 returns the already-hashed base64url TXT value.
        const value = await client.getChallengeKeyAuthorization(challenge)
        const name = `_acme-challenge.${domain}`
        records.push({ name, value, domain })
        pending.push({ authorization, challenge })
      }
      const accountThumbprint = this.accountThumbprint(settings)
      const orderState: any = { order, pending, directory: settings.directory, accountThumbprint }
      let updated = await this.db.certificateJob.update({ where: { id: job.id }, data: {
        status: 'needs_dns', challenge: { records }, orderData: { encrypted: encrypt(JSON.stringify(orderState), secret), directory: settings.directory, accountThumbprint }, error: null,
      } })
      if (process.env.ACME_DNS_PROVIDER === 'cloudflare') {
        const cf = this.requireCloudflare()
        for (const record of records) createdCloudflare.push(await this.createCloudflareTxt(cf, record))
        orderState.cloudflare = { zoneId: cf.zoneId, recordIds: createdCloudflare.map((item) => item.id) }
        updated = await this.db.certificateJob.update({ where: { id: job.id }, data: { orderData: { encrypted: encrypt(JSON.stringify(orderState), secret), directory: settings.directory, accountThumbprint } } })
        await this.waitForTxt(records)
        return this.complete(String(userId), String(job.id))
      }
      return { ...this.toPublicJob(updated), instructions: 'Create each TXT record exactly as shown. Wait for DNS propagation, then POST /user/certificate-jobs/{id}/complete. DNS records are never changed by this service.' }
    } catch {
      const cf = this.cloudflareCredentials(false)
      if (cf) await this.deleteCloudflareRecords(cf, createdCloudflare).catch(() => undefined)
      await this.db.certificateJob.update({ where: { id: job.id }, data: { status: 'failed', privateKey: null, csr: null, challenge: null, orderData: null, error: 'ACME order setup failed; check ACME configuration/provider availability. Sensitive details are omitted.' } }).catch(() => undefined)
      throw new BadRequestException('ACME order setup failed; check ACME configuration/provider availability. Sensitive details are omitted.')
    }
  }

  async getJob(userIdRaw: string, rawJobId: string) {
    let row = await this.db.certificateJob.findFirst({ where: { id: unsignedId(rawJobId), userId: unsignedId(userIdRaw) } })
    if (!row) throw new NotFoundException('Certificate job not found')
    const now = Date.now()
    const expired = ['pending', 'needs_dns', 'processing'].includes(row.status) && (!row.expiresAt || new Date(row.expiresAt).getTime() <= now)
    const stuck = row.status === 'processing' && row.updatedAt && new Date(row.updatedAt).getTime() <= now - STUCK_PROCESSING_MS
    if (expired || stuck) row = await this.db.certificateJob.update({ where: { id: row.id }, data: {
      status: 'failed', privateKey: null, csr: null, orderData: null, challenge: null,
      error: expired ? 'ACME job expired; create a new request.' : 'ACME processing timed out; create a new request.',
    } })
    return this.toPublicJob(row)
  }
  async listJobs(userIdRaw: string, page: number, pageSize: number) {
    const userId = unsignedId(userIdRaw)
    const now = new Date()
    const activeStatuses = ['pending', 'needs_dns', 'processing']
    await Promise.all([
      this.db.certificateJob.updateMany({
        where: { userId, status: { in: activeStatuses }, OR: [{ expiresAt: null }, { expiresAt: { lte: now } }] },
        data: { status: 'failed', privateKey: null, csr: null, orderData: null, challenge: null, error: 'ACME job expired; create a new request.' },
      }),
      this.db.certificateJob.updateMany({
        where: { userId, status: 'processing', updatedAt: { lte: new Date(now.getTime() - STUCK_PROCESSING_MS) }, expiresAt: { gt: now } },
        data: { status: 'failed', privateKey: null, csr: null, orderData: null, challenge: null, error: 'ACME processing timed out; create a new request.' },
      }),
    ])
    const where = { userId, OR: [{ status: { in: activeStatuses } }, { createdAt: { gte: new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000) } }] }
    const [rows, total] = await Promise.all([
      this.db.certificateJob.findMany({
        where, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], skip: (page - 1) * pageSize, take: pageSize,
        select: { id: true, status: true, domains: true, challenge: true, certificateId: true, expiresAt: true, error: true, createdAt: true, updatedAt: true },
      }),
      this.db.certificateJob.count({ where }),
    ])
    return { list: rows.map((row: any) => this.toPublicJob(row)), pagination: { page, pageSize, total, totalPages: Math.ceil(total / pageSize) } }
  }

  async complete(userIdRaw: string, rawJobId: string) {
    const userId = unsignedId(userIdRaw)
    const jobId = unsignedId(rawJobId)
    const job = await this.db.certificateJob.findFirst({ where: { id: jobId, userId } })
    if (!job) throw new NotFoundException('Certificate job not found')
    if (job.status !== 'needs_dns') throw new BadRequestException(`Job is ${job.status}; only jobs waiting for DNS can be completed.`)
    if (!job.expiresAt || new Date(job.expiresAt).getTime() <= Date.now()) {
      await this.db.certificateJob.update({ where: { id: jobId }, data: { status: 'failed', privateKey: null, csr: null, orderData: null, challenge: null, error: 'ACME job expired; create a new request.' } })
      throw new BadRequestException('ACME job expired; create a new request.')
    }
    const records = Array.isArray(job.challenge?.records) ? job.challenge.records : []
    if (!records.length) throw new BadRequestException('DNS challenge state is unavailable; create a new request.')
    for (const record of records) {
      let txt: string[][]
      try { txt = await this.dnsAnswer(record.name) } catch { throw new BadRequestException(`TXT record not visible at ${record.name}; wait for DNS propagation and retry.`) }
      if (!this.hasTxtValue(txt, record.value)) throw new BadRequestException(`Expected TXT value is not visible at ${record.name}; wait for DNS propagation and retry.`)
    }
    const claimed = await this.db.certificateJob.updateMany({ where: { id: jobId, userId, status: 'needs_dns', expiresAt: { gt: new Date() } }, data: { status: 'processing', error: null } })
    if (claimed.count !== 1) throw new BadRequestException('Certificate job is already processing, expired, or no longer completable.')
    let cloudflareState: { zoneId: string; recordIds: string[] } | undefined
    try {
      const secret = this.encryptionSecret()
      const settings = this.settings()
      const privateKey = decrypt(String(job.privateKey).replace(/^enc:v1:/, ''), secret)
      const csr = String(job.csr ?? '')
      const orderData = job.orderData as any
      const encrypted = typeof orderData?.encrypted === 'string' ? orderData.encrypted : ''
      if (!encrypted || !csr || !String(job.privateKey).startsWith('enc:v1:')) throw new Error('missing state')
      const { order, pending, cloudflare } = JSON.parse(decrypt(encrypted, secret))
      if (orderData.directory !== settings.directory || orderData.accountThumbprint !== this.accountThumbprint(settings)) throw new Error('ACME configuration changed since order creation')
      if (cloudflare && typeof cloudflare.zoneId === 'string' && Array.isArray(cloudflare.recordIds)) cloudflareState = cloudflare
      const domainEntries = Array.isArray(job.domains) ? job.domains as any[] : []
      const expectedNames = domainEntries.map((entry: any) => normalizeName(entry.domain ?? entry))
      const freshDomains = await this.approvedDomains(userId, domainEntries.map((entry: any) => BigInt(entry.id)))
      if (freshDomains.names.length !== expectedNames.length || freshDomains.names.some((name) => !expectedNames.includes(name))) throw new Error('domain eligibility changed')
      const client = this.clientFactory(settings)
      await this.createAccount(client, settings)
      let currentOrder = await client.getOrder(order)
      if (currentOrder.status !== 'valid') {
        for (const item of pending) {
          if (item.challenge?.status === 'valid') continue
          await client.completeChallenge(item.challenge)
          await client.waitForValidStatus(item.challenge)
        }
        currentOrder = await client.getOrder(order)
      }
      if (currentOrder.status !== 'valid') {
        currentOrder = await client.waitForValidStatus(currentOrder)
      }
      if (currentOrder.status !== 'valid') {
        currentOrder = await client.finalizeOrder(currentOrder, csr)
        currentOrder = await client.waitForValidStatus(currentOrder)
      }
      const chainPem = await client.getCertificate(currentOrder)
      const certBlocks = acme.crypto.splitPemChain(chainPem)
      const leafPem = typeof certBlocks[0] === 'string' ? certBlocks[0] : String(chainPem)
      const names = domainEntries.map((entry: any) => normalizeName(entry.domain ?? entry))
      const autoRenew = domainEntries.some((entry: any) => entry.autoRenew === true)
      const row = await this.certificates.persistAcmeJob(String(userId), String(jobId), {
        certPem: leafPem, keyPem: privateKey, chainPem: certBlocks.slice(1).join('\n') || null,
        domains: names, directory: settings.directory, autoRenew,
      })
      return this.toPublicJob(row)
    } catch {
      await this.db.certificateJob.update({ where: { id: jobId }, data: { status: 'failed', privateKey: null, csr: null, orderData: null, challenge: null, error: 'ACME validation or issuance failed; check provider status and DNS. Sensitive details are omitted.' } }).catch(() => undefined)
      throw new BadRequestException('ACME validation or issuance failed; check provider status and DNS. Sensitive details are omitted.')
    } finally {
      if (cloudflareState) {
        const credentials = this.cloudflareCredentials(false)
        if (credentials) await this.deleteCloudflareRecords({ ...credentials, zoneId: cloudflareState.zoneId }, cloudflareState.recordIds.map((id) => ({ id }))).catch(() => undefined)
      }
    }
  }

  private requireCloudflare() {
    if (process.env.ACME_DNS_PROVIDER !== 'cloudflare') throw new BadRequestException('autoRenew requires explicit DNS automation: set ACME_DNS_PROVIDER=cloudflare with ACME_CF_API_TOKEN and ACME_CF_ZONE_ID; manual DNS alone cannot renew unattended.')
    const settings = this.cloudflareCredentials(true)
    if (!settings) throw new BadRequestException('Cloudflare DNS automation requires ACME_CF_API_TOKEN and ACME_CF_ZONE_ID.')
    return settings
  }

  private cloudflareCredentials(required: boolean): { token: string; zoneId: string } | undefined {
    const token = process.env.ACME_CF_API_TOKEN || ''
    const zoneId = process.env.ACME_CF_ZONE_ID || ''
    if (!token || !zoneId) {
      if (required) throw new BadRequestException('Cloudflare DNS automation requires ACME_CF_API_TOKEN and ACME_CF_ZONE_ID.')
      return undefined
    }
    if (!/^[a-f0-9]{32}$/i.test(zoneId)) {
      if (required) throw new BadRequestException('ACME_CF_ZONE_ID must be a 32-character Cloudflare zone ID.')
      return undefined
    }
    return { token, zoneId }
  }

  private async cloudflareRequest<T>(settings: { token: string; zoneId: string }, path: string, method: string, body?: unknown): Promise<T> {
    const response = await fetch(`https://api.cloudflare.com/client/v4/zones/${settings.zoneId}/dns_records${path}`, {
      method, headers: { Authorization: `Bearer ${settings.token}`, 'Content-Type': 'application/json' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      redirect: 'error', signal: AbortSignal.timeout(10_000),
    })
    const length = Number(response.headers?.get?.('content-length') ?? 0)
    if (length > MAX_CLOUDFLARE_RESPONSE_BYTES) throw new Error('Cloudflare DNS operation failed')
    let text: string
    if (response.body?.getReader) {
      const reader = response.body.getReader()
      const chunks: Uint8Array[] = []
      let size = 0
      try {
        while (true) {
          const { done, value } = await reader.read()
          if (done) break
          size += value.byteLength
          if (size > MAX_CLOUDFLARE_RESPONSE_BYTES) { await reader.cancel(); throw new Error('Cloudflare DNS operation failed') }
          chunks.push(value)
        }
      } finally { reader.releaseLock?.() }
      const merged = new Uint8Array(size)
      let offset = 0
      for (const chunk of chunks) { merged.set(chunk, offset); offset += chunk.byteLength }
      text = new TextDecoder().decode(merged)
    } else if (typeof response.text === 'function') {
      text = await response.text()
      if (Buffer.byteLength(text, 'utf8') > MAX_CLOUDFLARE_RESPONSE_BYTES) throw new Error('Cloudflare DNS operation failed')
    } else if (typeof response.json === 'function') {
      const payload = await response.json() as any
      text = JSON.stringify(payload)
    } else throw new Error('Cloudflare DNS operation failed')
    let payload: any
    try { payload = JSON.parse(text) } catch { throw new Error('Cloudflare DNS operation failed') }
    if (!response.ok || payload?.success !== true || payload?.result == null) throw new Error('Cloudflare DNS operation failed')
    return payload.result as T
  }

  private async createCloudflareTxt(settings: { token: string; zoneId: string }, record: { name: string; value: string }) {
    const result = await this.cloudflareRequest<{ id?: string }>(settings, '', 'POST', { type: 'TXT', name: record.name, content: record.value, ttl: 120 })
    if (typeof result?.id !== 'string' || !/^[a-f0-9]{32}$/i.test(result.id)) throw new Error('Cloudflare did not return a DNS record ID')
    return { id: result.id }
  }

  private async deleteCloudflareRecords(settings: { token: string; zoneId: string }, records: { id: string }[]) {
    for (const record of records) {
      if (!/^[a-f0-9]{32}$/i.test(record.id)) throw new Error('Invalid Cloudflare DNS record ID')
      await this.cloudflareRequest(settings, `/${record.id}`, 'DELETE')
    }
  }

  private async waitForTxt(records: { name: string; value: string }[]) {
    const until = Date.now() + DNS_PROPAGATION_TIMEOUT_MS
    while (Date.now() < until) {
      let allFound = true
      for (const record of records) {
        try {
          const answer = await this.dnsAnswer(record.name, until)
          if (!this.hasTxtValue(answer, record.value)) allFound = false
        } catch { allFound = false }
      }
      if (allFound) return
      if (Date.now() < until) await new Promise((resolve) => setTimeout(resolve, Math.min(5_000, until - Date.now())))
    }
    throw new Error('Cloudflare TXT propagation timed out')
  }

  async prepareAutoRenewals() {
    const now = new Date()
    const staleBefore = new Date(now.getTime() - STUCK_PROCESSING_MS)
    await this.db.certificateJob.updateMany({
      where: { status: { in: ['pending', 'needs_dns', 'processing'] }, OR: [{ expiresAt: { lte: now } }, { status: 'processing', updatedAt: { lte: staleBefore } }] },
      data: { status: 'failed', privateKey: null, csr: null, orderData: null, challenge: null, error: 'ACME job expired or processing timed out; create a new request.' },
    })
    const cutoff = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)
    const candidates = await this.db.certificate.findMany({ where: { certType: 'acme', autoRenew: true, status: 1, notAfter: { lte: cutoff } }, select: { id: true, userId: true } })
    for (const cert of candidates) {
      const existing = await this.db.certificateJob.findFirst({ where: { certificateId: cert.id, status: { in: ['pending', 'needs_dns', 'processing'] }, expiresAt: { gt: new Date() } }, select: { id: true } })
      if (existing) continue
      try { await this.renew(String(cert.userId), String(cert.id)) } catch {
        const when = new Date().toISOString()
        await this.db.certificate.update({ where: { id: cert.id }, data: { renewalError: `Automatic renewal could not start at ${when}; verify ACME and Cloudflare DNS configuration.` } }).catch(() => undefined)
      }
    }
    return candidates.length
  }

  static readonly directoryAllowlist = DIRECTORY_ALLOWLIST
}

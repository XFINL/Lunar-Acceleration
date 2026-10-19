import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { createPrivateKey, createPublicKey, X509Certificate } from 'node:crypto'
import { domainToASCII } from 'node:url'
import { encrypt } from '../../common/utils/crypto.util'
import { PrismaService } from '../../database/prisma.service'

const DEFAULT_ENCRYPTION_KEY = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef'
const MAX_PEM_BYTES = 64 * 1024
const MAX_HSTS_AGE = 31_536_000
const SELECT_METADATA = {
  id: true, userId: true, name: true, certType: true, issuer: true, notBefore: true,
  notAfter: true, autoRenew: true, status: true, createdAt: true, acmeDomains: true,
  acmeDirectory: true, lastRenewedAt: true, renewalError: true,
}

type CertificateInput = { name: string; certPem: string; keyPem: string }
type HttpsInput = { httpsEnabled?: boolean; forceHttps?: boolean; hstsEnabled?: boolean; hstsMaxAge?: number; tlsVersion?: string }

@Injectable()
export class CertificateService {
  constructor(private readonly prisma: PrismaService, private readonly config: ConfigService) {}

  private get db(): Record<string, any> { return this.prisma as unknown as Record<string, any> }

  private id(value: string): bigint {
    if (typeof value !== 'string' || !/^[1-9]\d{0,19}$/.test(value)) throw new BadRequestException('Invalid ID')
    const id = BigInt(value)
    if (id > 18446744073709551615n) throw new BadRequestException('Invalid ID')
    return id
  }

  private userId(value: string): bigint { return this.id(value) }

  private metadata(row: any) {
    return {
      id: String(row.id), name: row.name, certType: row.certType, issuer: row.issuer,
      notBefore: row.notBefore, notAfter: row.notAfter, autoRenew: row.autoRenew,
      status: row.status, createdAt: row.createdAt, hasPrivateKey: true,
      acmeDomains: row.acmeDomains ?? null, acmeDirectory: row.acmeDirectory ?? null,
      lastRenewedAt: row.lastRenewedAt ?? null, renewalError: row.renewalError ?? null,
    }
  }

  async list(userId: string, page: number, pageSize: number) {
    const where = { userId: this.userId(userId) }
    const [total, rows] = await Promise.all([
      this.db.certificate.count({ where }),
      this.db.certificate.findMany({ where, select: SELECT_METADATA, orderBy: { createdAt: 'desc' }, skip: (page - 1) * pageSize, take: pageSize }),
    ])
    return { list: rows.map((row: any) => this.metadata(row)), pagination: { page, pageSize, total, totalPages: Math.ceil(total / pageSize) } }
  }

  async get(userId: string, rawId: string) {
    const row = await this.db.certificate.findFirst({ where: { id: this.id(rawId), userId: this.userId(userId) }, select: SELECT_METADATA })
    if (!row) throw new NotFoundException('Certificate not found')
    return this.metadata(row)
  }

  private validateCertificate(certPem: string, keyPem: string) {
    if (typeof certPem !== 'string' || typeof keyPem !== 'string' || !certPem.trim() || !keyPem.trim()) throw new BadRequestException('Certificate and private key PEM are required')
    if (Buffer.byteLength(certPem, 'utf8') + Buffer.byteLength(keyPem, 'utf8') > MAX_PEM_BYTES) throw new BadRequestException('Certificate material exceeds 64 KiB')
    try {
      if (!/-----BEGIN CERTIFICATE-----/.test(certPem)) throw new Error()
      const cert = new X509Certificate(certPem)
      const now = Date.now()
      const notBefore = Date.parse(cert.validFrom)
      const notAfter = Date.parse(cert.validTo)
      if (!Number.isFinite(notBefore) || !Number.isFinite(notAfter) || now < notBefore || now > notAfter) throw new BadRequestException('Certificate is not currently valid')
      if (cert.ca) throw new BadRequestException('CA certificates cannot be uploaded')
      const privateKey = createPrivateKey(keyPem)
      const publicKey = cert.publicKey
      const asymmetricKeyType = publicKey.asymmetricKeyType
      const details = publicKey.asymmetricKeyDetails
      if (asymmetricKeyType === 'rsa' || asymmetricKeyType === 'rsa-pss') {
        if (!details?.modulusLength || details.modulusLength < 2048) throw new BadRequestException('RSA keys must be at least 2048 bits')
      } else if (asymmetricKeyType === 'ec') {
        if (!['prime256v1', 'secp384r1', 'secp521r1'].includes(details?.namedCurve ?? '')) throw new BadRequestException('Unsupported or weak elliptic-curve key')
      } else if (!['ed25519', 'ed448'].includes(asymmetricKeyType ?? '')) {
        throw new BadRequestException('Unsupported public-key algorithm')
      }
      const sigalg = String((cert as any).signatureAlgorithm ?? (cert as any).toLegacyObject?.().sigalg ?? '')
      if (/md5|sha1/i.test(sigalg)) throw new BadRequestException('Certificate signature algorithm is not secure')
      const privatePublic = createPublicKey(privateKey).export({ type: 'spki', format: 'der' })
      const certPublic = publicKey.export({ type: 'spki', format: 'der' })
      if (!Buffer.from(privatePublic).equals(Buffer.from(certPublic)) || !cert.checkPrivateKey(privateKey)) throw new BadRequestException('Private key does not match certificate')
      const sans = [...cert.subjectAltName?.matchAll(/(?:^|,\s*)DNS:((?:"[^"]+")|[^,]+)/g) ?? []]
        .map((match) => match[1].replace(/^"|"$/g, '').trim().toLowerCase())
        .filter(Boolean)
      const issuer = cert.issuer.replace(/\n/g, ', ')
      if (!issuer || issuer.length > 512) throw new BadRequestException('Certificate issuer is invalid')
      const blocks = certPem.match(/-----BEGIN CERTIFICATE-----[\s\S]*?-----END CERTIFICATE-----/g) ?? []
      if (!blocks.length || certPem.replace(/-----BEGIN CERTIFICATE-----[\s\S]*?-----END CERTIFICATE-----/g, '').trim()) throw new BadRequestException('Certificate chain contains invalid PEM material')
      let child = cert
      for (const block of blocks.slice(1)) {
        const parent = new X509Certificate(block)
        if (!parent.ca || now < Date.parse(parent.validFrom) || now > Date.parse(parent.validTo) || !child.checkIssued(parent) || !child.verify(parent.publicKey)) throw new BadRequestException('Certificate chain is invalid or out of order')
        child = parent
      }
      return { cert, sans, issuer, notBefore: new Date(notBefore), notAfter: new Date(notAfter), leafPem: cert.toString(), chainPem: blocks.slice(1).join('\n') || null }
    } catch (error) {
      if (error instanceof BadRequestException) throw error
      // Avoid propagating parser/OpenSSL messages, which can contain user-supplied PEM fragments.
      throw new BadRequestException('Invalid certificate or private key PEM')
    }
  }

  async create(userId: string, input: CertificateInput) {
    if (typeof input.name !== 'string' || input.name.trim().length < 1 || input.name.length > 128) throw new BadRequestException('Name must be 1–128 characters')
    const validated = this.validateCertificate(input.certPem, input.keyPem)
    const security = this.config.get<{ encryptionKey?: string }>('security')
    const secret = security?.encryptionKey
    const env = this.config.get<string>('app.env') ?? process.env.NODE_ENV ?? 'development'
    if (!secret || (env === 'production' && secret === DEFAULT_ENCRYPTION_KEY)) throw new ForbiddenException('Certificate encryption is not securely configured')
    const row = await this.db.certificate.create({
      data: {
        userId: this.userId(userId), name: input.name.trim(), certType: 'manual',
        certPem: validated.leafPem, chainPem: validated.chainPem, keyPem: `enc:v1:${encrypt(input.keyPem, secret)}`,
        issuer: validated.issuer, notBefore: validated.notBefore, notAfter: validated.notAfter,
        autoRenew: false, status: 1,
      },
      select: SELECT_METADATA,
    })
    return this.metadata(row)
  }

  /** CA 调用在事务外完成；最终资格、证书与任务状态在同一事务内提交。 */
  async persistAcmeJob(userId: string, rawJobId: string, input: { certPem: string; keyPem: string; chainPem: string | null; domains: string[]; directory: string; autoRenew: boolean }) {
    const owner = this.userId(userId)
    const jobId = this.id(rawJobId)
    const fullChain = [input.certPem, input.chainPem].filter(Boolean).join('\n')
    const validated = this.validateCertificate(fullChain, input.keyPem)
    const names = input.domains.map(name => domainToASCII(name).toLowerCase())
    if (!names.length || names.length > 10 || names.some(name => !name) || new Set(names).size !== names.length || names.some(name => !this.matchesDomain({ certPem: validated.leafPem }, name))) throw new BadRequestException('Issued certificate does not cover the requested names')
    const secret = this.config.get<{ encryptionKey?: string }>('security')?.encryptionKey
    const env = this.config.get<string>('app.env') ?? process.env.NODE_ENV ?? 'development'
    if (!secret || (env === 'production' && secret === DEFAULT_ENCRYPTION_KEY)) throw new ForbiddenException('Certificate encryption is not securely configured')
    const keyPem = `enc:v1:${encrypt(input.keyPem, secret)}`
    for (let attempt = 0; ; attempt++) {
      try {
        return await this.db.$transaction(async (tx: Record<string, any>) => {
          await tx.$queryRawUnsafe('SELECT `id` FROM `users` WHERE `id` = ? FOR UPDATE', owner)
          const user = await tx.user.findFirst({ where: { id: owner, deletedAt: null, status: 1 } })
          if (!user) throw new ForbiddenException('Certificate owner is no longer active')
          await tx.$queryRawUnsafe('SELECT `id` FROM `certificate_jobs` WHERE `id` = ? AND `user_id` = ? FOR UPDATE', jobId, owner)
          const job = await tx.certificateJob.findFirst({ where: { id: jobId, userId: owner } })
          if (!job || job.status !== 'processing' || !job.expiresAt || job.expiresAt <= new Date()) throw new BadRequestException('Certificate job is no longer eligible for issuance')
          const entries = Array.isArray(job.domains) ? job.domains : []
          if (entries.length !== names.length || entries.some((entry: any) => !names.includes(entry.domain) || typeof entry.id !== 'string' || !/^[1-9]\d{0,19}$/.test(entry.id))) throw new BadRequestException('Certificate job names changed')
          const ids = entries.map((entry: any) => this.id(entry.id)).sort((a: bigint, b: bigint) => a < b ? -1 : a > b ? 1 : 0)
          for (const id of ids) {
            const domain = await this.lockDomain(tx, owner, id)
            if (domain.auditStatus !== 2 || !names.includes(domainToASCII(domain.domain).toLowerCase())) throw new ForbiddenException('Certificate domain eligibility changed')
          }
          await tx.$queryRawUnsafe('SELECT `id` FROM `user_packages` WHERE `user_id` = ? AND `status` = 1 FOR UPDATE', owner)
          const now = new Date()
          const entitlement = await tx.userPackage.findFirst({ where: { userId: owner, status: 1, startAt: { lte: now }, expireAt: { gt: now }, package: { status: 1 } }, select: { id: true } })
          if (!entitlement) throw new ForbiddenException('An active package is required to finish certificate issuance')
          const data = {
            certType: 'acme', certPem: validated.leafPem, chainPem: validated.chainPem, keyPem,
            issuer: validated.issuer, notBefore: validated.notBefore, notAfter: validated.notAfter,
            acmeDomains: names, acmeDirectory: input.directory, lastRenewedAt: now, renewalError: null, status: 1,
          }
          let certificate: any
          if (job.certificateId != null) {
            const existing = await this.lockCertificate(tx, owner, job.certificateId)
            const bindings = await tx.domainConfig.findMany({ where: { certId: existing.id }, include: { domain: true } })
            for (const binding of bindings) {
              const domain = binding.domain
              if (!domain || domain.deletedAt !== null || domain.userId !== owner || domain.auditStatus !== 2 || !names.includes(domainToASCII(domain.domain).toLowerCase())) throw new ForbiddenException('Certificate binding eligibility changed')
              this.assertValidBinding({ ...existing, ...data }, domain)
            }
            certificate = await tx.certificate.update({ where: { id: existing.id }, data, select: { id: true } })
          } else {
            certificate = await tx.certificate.create({ data: { ...data, userId: owner, name: names.join(', ').slice(0, 128), autoRenew: input.autoRenew }, select: { id: true } })
          }
          return tx.certificateJob.update({ where: { id: jobId }, data: { status: 'issued', certificateId: certificate.id, privateKey: null, csr: null, orderData: null, challenge: null, error: null } })
        }, { isolationLevel: 'Serializable', maxWait: 5000, timeout: 15000 })
      } catch (error) {
        if ((error as { code?: string })?.code !== 'P2034' || attempt >= 2) throw error
      }
    }
  }

  async createAcmeCertificate(userId: string, input: { name: string; certPem: string; keyPem: string; chainPem: string | null; domains: string[]; directory: string; autoRenew: boolean }) {
    const validated = this.validateCertificate(input.certPem, input.keyPem)
    if (input.domains.some((name) => !this.matchesDomain({ certPem: input.certPem }, name))) throw new BadRequestException('Issued certificate SAN does not cover every requested domain')
    const secret = this.config.get<{ encryptionKey?: string }>('security')?.encryptionKey
    const env = this.config.get<string>('app.env') ?? process.env.NODE_ENV ?? 'development'
    if (!secret || (env === 'production' && secret === DEFAULT_ENCRYPTION_KEY)) throw new ForbiddenException('Certificate encryption is not securely configured')
    const row = await this.db.certificate.create({ data: {
      userId: this.userId(userId), name: input.name, certType: 'acme', certPem: validated.leafPem,
      chainPem: input.chainPem, keyPem: `enc:v1:${encrypt(input.keyPem, secret)}`, issuer: validated.issuer,
      notBefore: validated.notBefore, notAfter: validated.notAfter, autoRenew: input.autoRenew,
      acmeDomains: input.domains, acmeDirectory: input.directory, lastRenewedAt: new Date(), status: 1,
    }, select: SELECT_METADATA })
    return this.metadata(row)
  }

  async replaceAcmeCertificate(userId: string, rawCertificateId: string, input: { certPem: string; keyPem: string; chainPem: string | null; domains: string[]; directory: string }) {
    const owner = this.userId(userId)
    const certId = this.id(rawCertificateId)
    const validated = this.validateCertificate(input.certPem, input.keyPem)
    if (input.domains.some((name) => !this.matchesDomain({ certPem: input.certPem }, name))) throw new BadRequestException('Issued certificate SAN does not cover every requested domain')
    const secret = this.config.get<{ encryptionKey?: string }>('security')?.encryptionKey
    const env = this.config.get<string>('app.env') ?? process.env.NODE_ENV ?? 'development'
    if (!secret || (env === 'production' && secret === DEFAULT_ENCRYPTION_KEY)) throw new ForbiddenException('Certificate encryption is not securely configured')
    const updated = await this.db.$transaction(async (tx: Record<string, any>) => {
      const certificate = await this.lockCertificate(tx, owner, certId)
      const bindings = await tx.domainConfig.findMany({ where: { certId }, include: { domain: true } })
      for (const binding of bindings) {
        if (!binding.domain) continue
        if (binding.domain.userId !== owner) throw new ForbiddenException('Certificate binding owner mismatch')
        this.assertValidBinding({ ...certificate, certPem: validated.leafPem, notBefore: validated.notBefore, notAfter: validated.notAfter, status: 1 }, binding.domain)
      }
      return tx.certificate.update({ where: { id: certId }, data: {
        certType: 'acme', certPem: validated.leafPem, chainPem: input.chainPem,
        keyPem: `enc:v1:${encrypt(input.keyPem, secret)}`, issuer: validated.issuer,
        notBefore: validated.notBefore, notAfter: validated.notAfter, acmeDomains: input.domains,
        acmeDirectory: input.directory, lastRenewedAt: new Date(), renewalError: null, status: 1,
      }, select: SELECT_METADATA })
    }, { isolationLevel: 'Serializable' })
    return this.metadata(updated)
  }

  private async lockDomain(tx: Record<string, any>, userId: bigint, domainId: bigint) {
    if (typeof tx.$queryRawUnsafe === 'function') {
      const rows = await tx.$queryRawUnsafe('SELECT `id` FROM `domains` WHERE `id` = ? AND `user_id` = ? AND `deleted_at` IS NULL FOR UPDATE', domainId, userId)
      if (!rows?.length) throw new NotFoundException('Domain not found')
    }
    const domain = await tx.domain.findFirst({ where: { id: domainId, userId, deletedAt: null } })
    if (!domain) throw new NotFoundException('Domain not found')
    return domain
  }

  private async lockCertificate(tx: Record<string, any>, ownerId: bigint, certificateId: bigint) {
    if (typeof tx.$queryRawUnsafe === 'function') {
      const rows = await tx.$queryRawUnsafe('SELECT `id` FROM `certificates` WHERE `id` = ? AND `user_id` = ? FOR UPDATE', certificateId, ownerId)
      if (!rows?.length) throw new NotFoundException('Certificate not found')
    }
    const certificate = await tx.certificate.findFirst({ where: { id: certificateId, userId: ownerId } })
    if (!certificate) throw new NotFoundException('Certificate not found')
    return certificate
  }

  private matchesDomain(certificate: any, domainName: string): boolean {
    const normalized = domainToASCII(domainName.replace(/\.$/, '').toLowerCase())
    if (!normalized) return false
    let x509: X509Certificate
    try { x509 = new X509Certificate(certificate.certPem) } catch { return false }
    const names = [...x509.subjectAltName?.matchAll(/(?:^|,\s*)DNS:((?:"[^"]+")|[^,]+)/g) ?? []].map((m) => domainToASCII(m[1].replace(/^"|"$/g, '').trim().toLowerCase())).filter(Boolean)
    return names.some((san) => {
      if (!san) return false
      if (san.startsWith('*.')) return normalized.endsWith(san.slice(1)) && normalized.split('.').length === san.split('.').length
      return normalized === san
    })
  }

  private assertValidBinding(certificate: any, domain: any) {
    const now = Date.now()
    const starts = new Date(certificate.notBefore).getTime()
    const ends = new Date(certificate.notAfter).getTime()
    if (certificate.status !== 1 || !Number.isFinite(starts) || !Number.isFinite(ends) || now < starts || now > ends) throw new BadRequestException('Certificate is not currently valid')
    if (!this.matchesDomain(certificate, domain.domain)) throw new BadRequestException('Certificate SAN does not cover this domain')
  }

  async bindDomainCertificate(userId: string, rawDomainId: string, rawCertificateId: string | null) {
    const owner = this.userId(userId)
    const domainId = this.id(rawDomainId)
    const certificateId = rawCertificateId === null ? null : this.id(rawCertificateId)
    return this.db.$transaction(async (tx: Record<string, any>) => {
      const domain = await this.lockDomain(tx, owner, domainId)
      if (certificateId === null) {
        const unbound = { certId: null, httpsEnabled: false, forceHttps: false, hstsEnabled: false }
        await tx.domainConfig.upsert({ where: { domainId }, create: { domainId, ...unbound }, update: unbound })
        return { domainId: String(domainId), certId: null }
      }
      const certificate = await this.lockCertificate(tx, owner, certificateId)
      this.assertValidBinding(certificate, domain)
      await tx.domainConfig.upsert({ where: { domainId }, create: { domainId, certId: certificateId }, update: { certId: certificateId } })
      return { domainId: String(domainId), certId: String(certificateId) }
    }, { isolationLevel: 'Serializable' })
  }

  async remove(userId: string, rawCertificateId: string) {
    const owner = this.userId(userId)
    const certId = this.id(rawCertificateId)
    return this.db.$transaction(async (tx: Record<string, any>) => {
      const certificate = await this.lockCertificate(tx, owner, certId)
      const activeBindings = await tx.domainConfig.count({ where: { certId, domain: { deletedAt: null } } })
      if (activeBindings > 0) throw new ConflictException('Certificate is bound to an active domain')
      await tx.certificate.delete({ where: { id: certificate.id } })
      return { success: true }
    }, { isolationLevel: 'Serializable' })
  }

  async getHttps(userId: string, rawDomainId: string) {
    const domain = await this.db.domain.findFirst({ where: { id: this.id(rawDomainId), userId: this.userId(userId), deletedAt: null }, include: { config: true } })
    if (!domain) throw new NotFoundException('Domain not found')
    const config = domain.config ?? null
    return { domainId: String(domain.id), httpsEnabled: config?.httpsEnabled ?? false, certId: config?.certId == null ? null : String(config.certId), forceHttps: config?.forceHttps ?? false, hstsEnabled: config?.hstsEnabled ?? false, hstsMaxAge: config?.hstsMaxAge ?? MAX_HSTS_AGE, tlsVersion: config?.tlsVersion ?? 'TLSv1.2' }
  }

  async updateHttps(userId: string, rawDomainId: string, input: HttpsInput) {
    const owner = this.userId(userId)
    const domainId = this.id(rawDomainId)
    for (const field of ['httpsEnabled', 'forceHttps', 'hstsEnabled'] as const) if (input[field] !== undefined && typeof input[field] !== 'boolean') throw new BadRequestException(`${field} must be boolean`)
    if (input.hstsMaxAge !== undefined && (!Number.isInteger(input.hstsMaxAge) || input.hstsMaxAge < 0 || input.hstsMaxAge > MAX_HSTS_AGE)) throw new BadRequestException('hstsMaxAge must be between 0 and 31536000')
    if (input.tlsVersion !== undefined && !['TLSv1.2', 'TLSv1.3'].includes(input.tlsVersion)) throw new BadRequestException('tlsVersion must be TLSv1.2 or TLSv1.3')
    return this.db.$transaction(async (tx: Record<string, any>) => {
      const domain = await this.lockDomain(tx, owner, domainId)
      const old = await tx.domainConfig.findUnique({ where: { domainId } })
      const nextHttps = input.httpsEnabled ?? old?.httpsEnabled ?? false
      const nextForce = input.forceHttps ?? old?.forceHttps ?? false
      const nextHsts = input.hstsEnabled ?? old?.hstsEnabled ?? false
      if (!nextHttps && (nextForce || nextHsts)) throw new BadRequestException('forceHttps and HSTS require HTTPS to be enabled')
      const certId = old?.certId ?? null
      if (nextHttps) {
        if (certId == null) throw new BadRequestException('A matching valid certificate must be bound before enabling HTTPS')
        const certificate = await this.lockCertificate(tx, owner, BigInt(certId))
        this.assertValidBinding(certificate, domain)
      }
      const data = { httpsEnabled: nextHttps, forceHttps: nextHttps && nextForce, hstsEnabled: nextHttps && nextHsts, hstsMaxAge: input.hstsMaxAge ?? old?.hstsMaxAge ?? MAX_HSTS_AGE, tlsVersion: input.tlsVersion ?? old?.tlsVersion ?? 'TLSv1.2' }
      const config = await tx.domainConfig.upsert({ where: { domainId }, create: { domainId, ...data }, update: data })
      return { domainId: String(domainId), httpsEnabled: config.httpsEnabled, certId: config.certId == null ? null : String(config.certId), forceHttps: config.forceHttps, hstsEnabled: config.hstsEnabled, hstsMaxAge: config.hstsMaxAge, tlsVersion: config.tlsVersion, message: 'Control-plane configuration saved; TLS has not been deployed.' }
    }, { isolationLevel: 'Serializable' })
  }
}

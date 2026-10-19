import { isIP } from 'node:net'
import { X509Certificate, createHash } from 'node:crypto'
import { domainToASCII } from 'node:url'
import CdnClient, { AddCdnDomainRequest, BatchSetCdnDomainConfigRequest, DeleteCdnDomainRequest, DescribeCdnDomainConfigsRequest, DescribeCdnDomainDetailRequest, DescribeDomainCertificateInfoRequest, DescribeUserDomainsRequest, ModifyCdnDomainRequest, SetCdnDomainSSLCertificateRequest } from '@alicloud/cdn20180510'
import { Config as OpenApiConfig } from '@alicloud/openapi-client'
import {
  VendorConnectionResult,
  VendorCredentials,
  VendorDomain,
  VendorDomainPage,
  VendorDriver,
  VendorDriverError,
  VendorDeploymentConfig,
  VendorDeploymentResult,
  VendorRegistrationInput,
} from './vendor-driver'

const CDN_ENDPOINT = 'cdn.aliyuncs.com'
const PAGE_SIZE = 50
const MAX_PAGE_NUMBER = 100_000
const REQUEST_TIMEOUT_MS = 10_000
const MAX_RESPONSE_BYTES = 256 * 1024
const DOMAIN_STATUSES = new Set([
  'online',
  'offline',
  'configuring',
  'configure_failed',
  'checking',
  'check_failed',
  'stopping',
  'deleting',
])

const RUNTIME_OPTIONS = {
  connectTimeout: REQUEST_TIMEOUT_MS,
  readTimeout: REQUEST_TIMEOUT_MS,
  autoretry: false,
  maxAttempts: 1,
}

type AliClient = Pick<CdnClient, 'describeUserDomainsWithOptions' | 'addCdnDomainWithOptions' | 'deleteCdnDomainWithOptions' | 'modifyCdnDomainWithOptions' | 'batchSetCdnDomainConfigWithOptions' | 'describeCdnDomainConfigsWithOptions' | 'describeCdnDomainDetailWithOptions' | 'setCdnDomainSSLCertificateWithOptions' | 'describeDomainCertificateInfoWithOptions'>
type ClientFactory = (config: any) => any

/** Alibaba Cloud CDN integration with explicit keys, endpoint, and bounded SDK responses. */
export class AliDriver implements VendorDriver {
  private readonly client: AliClient

  constructor(credentials: VendorCredentials, clientFactory?: ClientFactory) {
    this.validateCredentials(credentials)
    const sdkConfig = new OpenApiConfig({
      accessKeyId: credentials.accessKey,
      accessKeySecret: credentials.secretKey,
      endpoint: CDN_ENDPOINT,
    })
    const factory = clientFactory ?? ((config: any) => new CdnClient(config))
    this.client = factory(sdkConfig) as AliClient
    if (!this.client || typeof this.client.describeUserDomainsWithOptions !== 'function') {
      throw new VendorDriverError('INVALID_CONFIG')
    }
  }

  async testConnection(): Promise<VendorConnectionResult> {
    const body = await this.describePage(1, 1)
    this.validateListResponse(body)
    return {
      connected: true,
      provider: 'ali',
      checkedAt: new Date().toISOString(),
    }
  }

  async listDomains(cursor?: string): Promise<VendorDomainPage> {
    const pageNumber = this.parseCursor(cursor)
    const body = await this.describePage(pageNumber, PAGE_SIZE)
    const { pageData, totalCount } = this.validateListResponse(body)
    const items = pageData.map((domain) => this.mapDomain(domain))
    return {
      items,
      nextCursor: totalCount > pageNumber * PAGE_SIZE && pageNumber < MAX_PAGE_NUMBER
        ? String(pageNumber + 1)
        : null,
    }
  }

  async registerDomain(input: VendorRegistrationInput): Promise<VendorDomain> {
    const hostname = this.normalizeInputHostname(input?.hostname)
    const origin = this.validateOrigin(input?.origin)
    const existing = await this.describeExactDomain(hostname)
    if (existing.length > 0) throw new VendorDriverError('RESOURCE_CONFLICT')

    if (typeof this.client.addCdnDomainWithOptions !== 'function') throw new VendorDriverError('UNSUPPORTED_OPERATION')
    try {
      const response = await this.client.addCdnDomainWithOptions(
        new AddCdnDomainRequest({
          cdnType: 'web',
          domainName: hostname,
          sources: JSON.stringify([{
            content: origin.address,
            type: origin.type,
            priority: '20',
            port: origin.port,
            weight: '10',
          }]),
        }),
        { ...RUNTIME_OPTIONS } as Parameters<CdnClient['addCdnDomainWithOptions']>[1],
      )
      this.assertBoundedResponse(response)
      const body = response && typeof response === 'object' && 'body' in response
        ? (response as { body?: unknown }).body
        : undefined
      if (!body || typeof body !== 'object' || Array.isArray(body)
        || typeof (body as Record<string, unknown>).requestId !== 'string'
        || ((body as Record<string, unknown>).requestId as string).length < 1
        || ((body as Record<string, unknown>).requestId as string).length > 128) {
        throw new VendorDriverError('INVALID_RESPONSE')
      }
      // AddCdnDomain returns RequestId, not a numeric domain ID; DomainName is
      // the API's natural identifier for DeleteCdnDomain.
      return { externalId: hostname, hostname, cname: null, providerStatus: 'configuring' }
    } catch (error) {
      if (error instanceof VendorDriverError) throw error
      throw new VendorDriverError(this.safeCodeFor(error))
    }
  }

  async deleteManagedDomain(externalId: string, hostnameInput: string): Promise<void> {
    const hostname = this.normalizeInputHostname(hostnameInput)
    let normalizedExternalId: string
    try {
      if (typeof externalId !== 'string') throw new VendorDriverError('INVALID_CONFIG')
      normalizedExternalId = this.normalizeInputHostname(externalId)
    } catch {
      throw new VendorDriverError('RESOURCE_CONFLICT')
    }
    if (normalizedExternalId !== hostname) {
      throw new VendorDriverError('RESOURCE_CONFLICT')
    }
    const matches = await this.describeExactDomain(hostname)
    if (matches.length === 0) return
    if (matches.length !== 1 || this.normalizeHostname(matches[0].domainName) !== hostname) {
      throw new VendorDriverError('RESOURCE_CONFLICT')
    }
    if (typeof this.client.deleteCdnDomainWithOptions !== 'function') throw new VendorDriverError('UNSUPPORTED_OPERATION')
    try {
      const response = await this.client.deleteCdnDomainWithOptions(
        new DeleteCdnDomainRequest({ domainName: hostname }),
        { ...RUNTIME_OPTIONS } as Parameters<CdnClient['deleteCdnDomainWithOptions']>[1],
      )
      this.assertBoundedResponse(response)
      const body = response && typeof response === 'object' && 'body' in response
        ? (response as { body?: unknown }).body
        : undefined
      if (!body || typeof body !== 'object' || Array.isArray(body)
        || typeof (body as Record<string, unknown>).requestId !== 'string'
        || ((body as Record<string, unknown>).requestId as string).length < 1
        || ((body as Record<string, unknown>).requestId as string).length > 128) {
        throw new VendorDriverError('INVALID_RESPONSE')
      }
    } catch (error) {
      if (error instanceof VendorDriverError) throw error
      if (this.isNotFound(error)) return
      throw new VendorDriverError(this.safeCodeFor(error))
    }
  }

  async deployManagedConfig(externalId: string, config: VendorDeploymentConfig): Promise<void> {
    const hostname = this.normalizeInputHostname(config?.hostname)
    if (externalId !== hostname || !config.origin || config.origin.host || !['http', 'https'].includes(config.origin.protocol)
      || config.origin.port !== (config.origin.protocol === 'https' ? 443 : 80)
      || !Number.isInteger(config.defaultTtl) || config.defaultTtl < 1 || config.defaultTtl > 31_536_000
      || config.tls.forceHttps || config.tls.hstsEnabled || config.tls.tlsVersion !== 'TLSv1.2') throw new VendorDriverError('UNSUPPORTED_OPERATION')
    if (typeof config.origin.address !== 'string' || (isIP(config.origin.address) === 0 && this.normalizeInputHostname(config.origin.address) !== config.origin.address.toLowerCase())) throw new VendorDriverError('INVALID_CONFIG')
    if (config.tls.enabled) this.certificateFingerprint(config.certificate?.certificatePem)
    if (config.tls.enabled && !config.certificate?.privateKeyPem) throw new VendorDriverError('INVALID_CONFIG')
    const detail = await this.domainDetail(hostname)
    if (detail.domainName !== hostname || !['online', 'configuring'].includes(String(detail.domainStatus).toLowerCase())) throw new VendorDriverError('RESOURCE_CONFLICT')
    const type = isIP(config.origin.address) ? 'ipaddr' : 'domain'
    const source = { content: config.origin.address, type, priority: '20', port: config.origin.port, weight: '10' }
    try {
      // Read and validate all existing configuration before the first write. Never silently replace a different root TTL.
      const preflight = await this.readCacheConfig(hostname, config.defaultTtl)
      if (preflight.present && !preflight.matches) throw new VendorDriverError('RESOURCE_CONFLICT')
      const changed = await this.client.modifyCdnDomainWithOptions(new ModifyCdnDomainRequest({ domainName: hostname, sources: JSON.stringify([source]) }), { ...RUNTIME_OPTIONS } as any)
      this.assertBoundedResponse(changed)
      if (!this.hasRequestId(changed)) throw new VendorDriverError('INVALID_RESPONSE')
      if (!preflight.present) {
        const functions = [{ functionName: 'path_based_ttl_set', functionArgs: [
        { argName: 'path', argValue: '/' }, { argName: 'ttl', argValue: String(config.defaultTtl) },
        { argName: 'weight', argValue: '99' }, { argName: 'swift_origin_cache_high', argValue: 'off' },
        { argName: 'swift_no_cache_low', argValue: 'off' }, { argName: 'swift_follow_cachetime', argValue: 'off' },
        { argName: 'force_revalidate', argValue: 'off' },
        ] }]
        const configured = await this.client.batchSetCdnDomainConfigWithOptions(new BatchSetCdnDomainConfigRequest({ domainNames: hostname, functions: JSON.stringify(functions) }), { ...RUNTIME_OPTIONS } as any)
        this.assertBoundedResponse(configured)
        const entries = (configured as any)?.body?.domainConfigList?.domainConfigModel
        if (!this.hasRequestId(configured) || !Array.isArray(entries) || entries.length !== 1 || entries[0]?.configId === 0 || entries[0]?.configId === '0') throw new VendorDriverError('INVALID_RESPONSE')
      }
      if (config.tls.enabled) {
        const certificate = config.certificate!
        const tls = await this.client.setCdnDomainSSLCertificateWithOptions(new SetCdnDomainSSLCertificateRequest({ domainName: hostname, certType: 'upload', certName: `lunar-${hostname}`.slice(0, 128), SSLProtocol: 'on', SSLPub: certificate.certificatePem, SSLPri: certificate.privateKeyPem }), { ...RUNTIME_OPTIONS } as any)
        this.assertBoundedResponse(tls)
        if (!this.hasRequestId(tls)) throw new VendorDriverError('INVALID_RESPONSE')
      }
    } catch (error) {
      if (error instanceof VendorDriverError) throw error
      throw new VendorDriverError(this.safeCodeFor(error))
    }
    return
  }

  async verifyManagedConfig(externalId: string, config: VendorDeploymentConfig): Promise<VendorDeploymentResult> {
    const hostname = this.normalizeInputHostname(config?.hostname)
    if (externalId !== hostname) throw new VendorDriverError('RESOURCE_CONFLICT')
    const expectedCert = config.tls.enabled ? this.certificateFingerprint(config.certificate?.certificatePem) : undefined
    const detail = await this.domainDetail(hostname)
    const sources = detail.sourceModels?.sourceModel
    const sourceType = isIP(config.origin.address) ? 'ipaddr' : 'domain'
    if (!Array.isArray(sources) || sources.length !== 1 || sources[0].content !== config.origin.address || sources[0].type !== sourceType || Number(sources[0].port) !== config.origin.port) throw new VendorDriverError('INVALID_RESPONSE')
    if (config.tls.enabled) {
      let certificateResponse: unknown
      try {
        certificateResponse = await this.client.describeDomainCertificateInfoWithOptions(new DescribeDomainCertificateInfoRequest({ domainName: hostname }), { ...RUNTIME_OPTIONS } as any)
        this.assertBoundedResponse(certificateResponse)
      } catch (error) { if (error instanceof VendorDriverError) throw error; throw new VendorDriverError(this.safeCodeFor(error)) }
      const certs = (certificateResponse as any)?.body?.certInfos?.certInfo
      const cert = Array.isArray(certs) ? certs.find((entry: any) => entry?.domainName === hostname || entry?.certDomainName === hostname) : undefined
      let actualFingerprint: string | undefined
      try { if (typeof cert?.serverCertificate === 'string') actualFingerprint = this.certificateFingerprint(cert.serverCertificate) }
      catch { throw new VendorDriverError('UPSTREAM_ERROR') }
      if (!cert || cert.serverCertificateStatus !== 'on' || actualFingerprint !== expectedCert) throw new VendorDriverError('UPSTREAM_ERROR')
    }
    const cache = await this.readCacheConfig(hostname, config.defaultTtl)
    if (!cache.present || !cache.matches) throw new VendorDriverError('UPSTREAM_ERROR')
    return { verified: true, providerStatus: typeof detail.domainStatus === 'string' ? detail.domainStatus : 'unknown', applied: config.tls.enabled ? ['origin', 'cache', 'certificate'] : ['origin', 'cache'], verifiedAt: new Date().toISOString() }
  }

  private async readCacheConfig(hostname: string, desiredTtl: number): Promise<{ present: boolean; matches: boolean }> {
    try {
      const response = await this.client.describeCdnDomainConfigsWithOptions(new DescribeCdnDomainConfigsRequest({ domainName: hostname, functionNames: 'path_based_ttl_set,forward_scheme' }), { ...RUNTIME_OPTIONS } as any)
      this.assertBoundedResponse(response)
      const records = (response as any)?.body?.domainConfigs?.domainConfig
      if (!Array.isArray(records)) throw new VendorDriverError('INVALID_RESPONSE')
      // An enabled origin protocol policy overrides the source port. Do not imply port-based verification in that case.
      for (const policy of records.filter((item: any) => item?.functionName === 'forward_scheme')) {
        const args = policy.functionArgs?.functionArg
        if (policy.status !== 'success' || !Array.isArray(args) || args.some((arg: any) => arg?.argName === 'enable' && arg?.argValue !== 'off')) throw new VendorDriverError('RESOURCE_CONFLICT')
        if (!args.some((arg: any) => arg?.argName === 'enable' && arg?.argValue === 'off')) throw new VendorDriverError('RESOURCE_CONFLICT')
      }
      const roots = records.filter((item: any) => item?.functionName === 'path_based_ttl_set'
        && Array.isArray(item?.functionArgs?.functionArg)
        && item.functionArgs.functionArg.some((arg: any) => arg?.argName === 'path' && arg?.argValue === '/'))
      if (roots.length > 1) throw new VendorDriverError('RESOURCE_CONFLICT')
      if (!roots.length) return { present: false, matches: false }
      const args = roots[0].functionArgs.functionArg
      const ttl = args.find((arg: any) => arg?.argName === 'ttl')?.argValue
      const weight = args.find((arg: any) => arg?.argName === 'weight')?.argValue
      const flagsMatch = ['swift_origin_cache_high', 'swift_no_cache_low', 'swift_follow_cachetime', 'force_revalidate'].every(name => args.find((arg: any) => arg?.argName === name)?.argValue === 'off')
      return { present: true, matches: roots[0].status === 'success' && String(ttl) === String(desiredTtl) && String(weight) === '99' && flagsMatch }
    } catch (error) { if (error instanceof VendorDriverError) throw error; throw new VendorDriverError(this.safeCodeFor(error)) }
  }

  private certificateFingerprint(pem: unknown): string {
    if (typeof pem !== 'string' || pem.length < 32 || pem.length > 64 * 1024) throw new VendorDriverError('INVALID_CONFIG')
    try {
      const cert = new X509Certificate(pem)
      return createHash('sha256').update(cert.raw).digest('hex')
    } catch { throw new VendorDriverError('INVALID_CONFIG') }
  }

  private async domainDetail(hostname: string): Promise<Record<string, any>> {
    try {
      const response = await this.client.describeCdnDomainDetailWithOptions(new DescribeCdnDomainDetailRequest({ domainName: hostname }), { ...RUNTIME_OPTIONS } as any)
      this.assertBoundedResponse(response)
      const body = (response as any)?.body?.getDomainDetailModel
      if (!body || typeof body !== 'object' || Array.isArray(body)) throw new VendorDriverError('INVALID_RESPONSE')
      return body
    } catch (error) { if (error instanceof VendorDriverError) throw error; throw new VendorDriverError(this.safeCodeFor(error)) }
  }

  private hasRequestId(response: unknown): boolean {
    const id = (response as any)?.body?.requestId
    return typeof id === 'string' && id.length > 0 && id.length <= 128
  }

  private normalizeInputHostname(value: unknown): string {
    if (typeof value !== 'string' || value.length === 0 || value.length > 253 || value !== value.trim()
      || /[\s/:?#@*\\]/.test(value) || value.endsWith('.')) {
      throw new VendorDriverError('INVALID_CONFIG')
    }
    const ascii = domainToASCII(value).toLowerCase()
    if (!ascii || ascii.length > 253 || isIP(ascii) !== 0
      || ascii.split('.').length < 2
      || ascii.split('.').some((label) => label.length < 1 || label.length > 63 || !/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(label))) {
      throw new VendorDriverError('INVALID_CONFIG')
    }
    return ascii
  }

  private validateOrigin(value: VendorRegistrationInput['origin']): { address: string; type: 'domain' | 'ipaddr'; port: number } {
    if (!value || typeof value !== 'object') throw new VendorDriverError('INVALID_CONFIG')
    const address = typeof value.address === 'string' && value.address === value.address.trim() ? value.address : ''
    const ipVersion = isIP(address)
    let normalizedAddress = address
    let type: 'domain' | 'ipaddr'
    if (ipVersion !== 0) {
      if (address.length > 253) throw new VendorDriverError('INVALID_CONFIG')
      type = 'ipaddr'
    } else {
      normalizedAddress = this.normalizeInputHostname(address)
      type = 'domain'
    }
    if (!Number.isInteger(value.port) || value.port < 1 || value.port > 65535) throw new VendorDriverError('INVALID_CONFIG')
    if ((value.protocol === 'http' && value.port !== 80) || (value.protocol === 'https' && value.port !== 443)) {
      throw new VendorDriverError('UNSUPPORTED_OPERATION')
    }
    if (value.protocol !== 'http' && value.protocol !== 'https') throw new VendorDriverError('UNSUPPORTED_OPERATION')
    return { address: normalizedAddress, type, port: value.port }
  }

  private async describeExactDomain(hostname: string): Promise<Record<string, unknown>[]> {
    try {
      const response = await this.client.describeUserDomainsWithOptions(
        new DescribeUserDomainsRequest({ domainName: hostname, domainSearchType: 'full_match', pageNumber: 1, pageSize: 50 }),
        { ...RUNTIME_OPTIONS } as Parameters<CdnClient['describeUserDomainsWithOptions']>[1],
      )
      this.assertBoundedResponse(response)
      if (!response || typeof response !== 'object' || !('body' in response)) throw new VendorDriverError('INVALID_RESPONSE')
      const body = (response as { body?: unknown }).body
      if (!body || typeof body !== 'object' || !('domains' in body)) throw new VendorDriverError('INVALID_RESPONSE')
      const domains = (body as { domains?: unknown }).domains
      if (!domains || typeof domains !== 'object' || !('pageData' in domains)
        || !Array.isArray((domains as { pageData?: unknown }).pageData)
        || (domains as { pageData: unknown[] }).pageData.length > 50
        || (domains as { pageData: unknown[] }).pageData.some((item) => !item || typeof item !== 'object' || Array.isArray(item))) {
        throw new VendorDriverError('INVALID_RESPONSE')
      }
      return (domains as { pageData: Record<string, unknown>[] }).pageData
    } catch (error) {
      if (error instanceof VendorDriverError) throw error
      throw new VendorDriverError(this.safeCodeFor(error))
    }
  }

  private validateCredentials(credentials: VendorCredentials): void {
    if (!credentials || typeof credentials !== 'object'
      || typeof credentials.accessKey !== 'string' || credentials.accessKey.trim().length === 0
      || typeof credentials.secretKey !== 'string' || credentials.secretKey.trim().length === 0
      || !credentials.config || typeof credentials.config !== 'object'
      || Array.isArray(credentials.config) || Object.keys(credentials.config).length !== 0) {
      throw new VendorDriverError('INVALID_CONFIG')
    }
  }

  private parseCursor(cursor?: string): number {
    if (cursor === undefined) return 1
    if (typeof cursor !== 'string' || !/^[1-9][0-9]{0,5}$/.test(cursor)) {
      throw new VendorDriverError('INVALID_CONFIG')
    }
    const pageNumber = Number(cursor)
    if (!Number.isSafeInteger(pageNumber) || pageNumber < 1 || pageNumber > MAX_PAGE_NUMBER) {
      throw new VendorDriverError('INVALID_CONFIG')
    }
    return pageNumber
  }

  private async describePage(pageNumber: number, pageSize: number): Promise<unknown> {
    try {
      const response = await this.client.describeUserDomainsWithOptions(
        new DescribeUserDomainsRequest({ pageNumber, pageSize }),
        { ...RUNTIME_OPTIONS } as Parameters<CdnClient['describeUserDomainsWithOptions']>[1],
      )
      this.assertBoundedResponse(response)
      if (!response || typeof response !== 'object' || !('body' in response)) {
        throw new VendorDriverError('INVALID_RESPONSE')
      }
      return (response as { body?: unknown }).body
    } catch (error) {
      if (error instanceof VendorDriverError) throw error
      throw new VendorDriverError(this.safeCodeFor(error))
    }
  }

  private safeCodeFor(error: unknown): ConstructorParameters<typeof VendorDriverError>[0] {
    const meta = error as Record<string, unknown> | null
    if (!meta || typeof meta !== 'object') return 'UPSTREAM_ERROR'
    const status = meta.statusCode ?? meta.status
    const statusNumber = typeof status === 'number' ? status : Number(status)
    if (statusNumber === 401 || statusNumber === 403) return 'AUTH_FAILED'
    if (statusNumber === 429) return 'RATE_LIMITED'

    const code = typeof meta.code === 'string' ? meta.code.toLowerCase() : ''
    const name = typeof meta.name === 'string' ? meta.name.toLowerCase() : ''
    if (statusNumber === 409 || /domain.*(already.?exist|exist)/.test(`${code} ${name}`)) return 'RESOURCE_CONFLICT'
    if (/throttl|too.?many.?requests|request.?limit/.test(code)) return 'RATE_LIMITED'
    if (/timeout|timed.?out|etimedout|econnaborted|socket.?hang.?up/.test(`${code} ${name}`)) {
      return 'UPSTREAM_TIMEOUT'
    }
    if (/access.?denied|unauthorized|invalidaccesskey|forbidden|auth/.test(code)) return 'AUTH_FAILED'
    return 'UPSTREAM_ERROR'
  }

  private isNotFound(error: unknown): boolean {
    if (!error || typeof error !== 'object') return false
    const meta = error as Record<string, unknown>
    const status = meta.statusCode ?? meta.status
    if ((typeof status === 'number' ? status : Number(status)) === 404) return true
    const code = typeof meta.code === 'string' ? meta.code.toLowerCase() : ''
    return code === 'domainnotexist' || code === 'domain.notfound' || code === 'entitynotexist.domain'
  }

  private assertBoundedResponse(value: unknown): void {
    let serialized: string | undefined
    try { serialized = JSON.stringify(value) } catch { throw new VendorDriverError('INVALID_RESPONSE') }
    if (typeof serialized !== 'string' || Buffer.byteLength(serialized, 'utf8') > MAX_RESPONSE_BYTES) {
      throw new VendorDriverError('INVALID_RESPONSE')
    }
  }

  private validateListResponse(body: unknown): { pageData: Record<string, unknown>[]; totalCount: number } {
    if (!body || typeof body !== 'object') throw new VendorDriverError('INVALID_RESPONSE')
    const domains = (body as Record<string, unknown>).domains
    const totalCount = (body as Record<string, unknown>).totalCount
    if (!domains || typeof domains !== 'object'
      || !Array.isArray((domains as Record<string, unknown>).pageData)
      || typeof totalCount !== 'number' || !Number.isSafeInteger(totalCount) || totalCount < 0) {
      throw new VendorDriverError('INVALID_RESPONSE')
    }
    const pageData = (domains as { pageData: unknown[] }).pageData
    if (pageData.length > PAGE_SIZE || pageData.some((item) => !item || typeof item !== 'object' || Array.isArray(item))) {
      throw new VendorDriverError('INVALID_RESPONSE')
    }
    return { pageData: pageData as Record<string, unknown>[], totalCount }
  }

  private mapDomain(record: Record<string, unknown>): VendorDomain {
    const hostname = this.normalizeHostname(record.domainName)
    const externalId = this.normalizeId(record.domainId)
    const providerStatus = record.domainStatus
    if (typeof providerStatus !== 'string' || !DOMAIN_STATUSES.has(providerStatus)) {
      throw new VendorDriverError('INVALID_RESPONSE')
    }

    let cname: string | null = null
    if (record.cname !== undefined && record.cname !== null) {
      cname = this.normalizeHostname(record.cname)
    }

    const result: VendorDomain = { externalId, hostname, cname, providerStatus }
    if (record.sslProtocol !== undefined && record.sslProtocol !== null) {
      if (record.sslProtocol !== 'on' && record.sslProtocol !== 'off') {
        throw new VendorDriverError('INVALID_RESPONSE')
      }
      result.sslStatus = record.sslProtocol
    }
    return result
  }

  private normalizeId(value: unknown): string {
    if (typeof value === 'number') {
      if (!Number.isSafeInteger(value) || value < 0) throw new VendorDriverError('INVALID_RESPONSE')
      value = String(value)
    }
    if (typeof value !== 'string' || value.length < 1 || value.length > 128 || !/^[0-9]+$/.test(value)) {
      throw new VendorDriverError('INVALID_RESPONSE')
    }
    return value
  }

  private normalizeHostname(value: unknown): string {
    if (typeof value !== 'string' || value.length === 0 || value.length > 1024 || value !== value.trim()) {
      throw new VendorDriverError('INVALID_RESPONSE')
    }
    const ascii = domainToASCII(value).toLowerCase()
    if (!ascii || ascii.length > 253 || isIP(ascii) !== 0 || ascii.includes('*') || ascii.includes('://')) {
      throw new VendorDriverError('INVALID_RESPONSE')
    }
    const labels = ascii.split('.')
    if (labels.length < 2 || labels.some((label) => label.length < 1 || label.length > 63
      || !/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(label))) {
      throw new VendorDriverError('INVALID_RESPONSE')
    }
    return ascii
  }
}

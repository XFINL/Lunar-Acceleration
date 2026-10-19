import { isIP } from 'node:net'
import { domainToASCII } from 'node:url'
import CdnClient, { AddCdnDomainRequest, DeleteCdnDomainRequest, DescribeUserDomainsRequest } from '@alicloud/cdn20180510'
import { Config as OpenApiConfig } from '@alicloud/openapi-client'
import {
  VendorConnectionResult,
  VendorCredentials,
  VendorDomain,
  VendorDomainPage,
  VendorDriver,
  VendorDriverError,
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

type AliClient = Pick<CdnClient, 'describeUserDomainsWithOptions' | 'addCdnDomainWithOptions' | 'deleteCdnDomainWithOptions'>
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

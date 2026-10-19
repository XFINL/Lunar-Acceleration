import { isIP } from 'node:net'
import { domainToASCII } from 'node:url'
import {
  VendorConnectionResult,
  VendorCredentials,
  VendorDomain,
  VendorDomainPage,
  VendorDriver,
  VendorDriverError,
  VendorRegistrationInput,
} from './vendor-driver'

const API_ROOT = 'https://api.cloudflare.com/client/v4'
const MAX_RESPONSE_BYTES = 256 * 1024
const MAX_TOKEN_LENGTH = 4096
const MAX_PAGE = 2_147_483_647
const MAX_HOSTNAME_LOOKUP_PAGES = 100
const HOSTNAME_STATUSES = new Set([
  'active',
  'blocked',
  'deleted',
  'error',
  'moved',
  'pending',
  'pending_blocked',
  'pending_deletion',
  'pending_issuance',
  'pending_migration',
  'pending_provisioned',
  'pending_revalidation',
  'pending_validation',
])
const SSL_STATUSES = new Set([
  'active',
  'deleted',
  'expired',
  'pending_deployment',
  'pending_issuance',
  'pending_revalidation',
  'pending_validation',
])

type JsonObject = Record<string, unknown>

function fail(code: ConstructorParameters<typeof VendorDriverError>[0]): never {
  throw new VendorDriverError(code)
}

function isObject(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function cleanStatus(value: unknown, maxLength = 64): string | undefined {
  if (typeof value !== 'string' || value.length === 0 || value.length > maxLength) return undefined
  return /^[A-Za-z0-9_.-]+$/.test(value) ? value : undefined
}

function cleanLabel(value: unknown, maxLength = 128): string | undefined {
  if (typeof value !== 'string' || value.length === 0 || value.length > maxLength) return undefined
  return /^[\p{L}\p{N} ._()'&-]+$/u.test(value) ? value : undefined
}

/** Strict DNS hostname normalization: no URLs, wildcards, IP literals, ports, or trailing dot. */
function cleanHostname(value: unknown): string | undefined {
  if (typeof value !== 'string' || value.length === 0 || value.length > 253) return undefined
  if (value !== value.trim() || /[\s/:?#@*\\]/.test(value) || value.endsWith('.')) return undefined
  const ascii = domainToASCII(value).toLowerCase()
  if (!ascii || ascii.length > 253 || isIP(ascii)) return undefined
  const labels = ascii.split('.')
  if (labels.length < 2 || labels.some(label => label.length < 1 || label.length > 63 || !/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(label))) return undefined
  return ascii
}

function validPageCursor(cursor?: string): number {
  if (cursor === undefined) return 1
  if (typeof cursor !== 'string' || !/^[1-9][0-9]{0,9}$/.test(cursor)) fail('INVALID_CONFIG')
  const page = Number(cursor)
  if (!Number.isSafeInteger(page) || page > MAX_PAGE) fail('INVALID_CONFIG')
  return page
}

export class CloudflareDriver implements VendorDriver {
  private readonly zoneId: string
  private readonly token: string
  private readonly transport: typeof fetch

  constructor(credentials: VendorCredentials, transport: typeof fetch = fetch) {
    const token = credentials?.accessKey
    const zoneId = credentials?.config?.zoneId
    if (typeof token !== 'string' || token.trim().length === 0 || token.length > MAX_TOKEN_LENGTH) fail('INVALID_CONFIG')
    if (typeof zoneId !== 'string' || !/^[a-fA-F0-9]{32}$/.test(zoneId)) fail('INVALID_CONFIG')
    if (typeof transport !== 'function') fail('INVALID_CONFIG')
    this.token = token
    this.zoneId = zoneId.toLowerCase()
    this.transport = transport
  }

  async testConnection(): Promise<VendorConnectionResult> {
    const payload = await this.getJson(`${API_ROOT}/zones/${this.zoneId}`)
    const zone = payload.result
    if (!isObject(zone)) fail('INVALID_RESPONSE')
    const hostname = cleanHostname(zone.name)
    if (!hostname) fail('INVALID_RESPONSE')
    const account = isObject(zone.account) ? cleanLabel(zone.account.name) : undefined
    const status = cleanStatus(zone.status)
    return {
      connected: true,
      provider: 'cloudflare',
      checkedAt: new Date().toISOString(),
      ...(account ? { accountLabel: account } : {}),
      ...(status ? { providerStatus: status } : {}),
      // The contract currently has no zoneName field; the zone's name is validated above.
    }
  }

  async listDomains(cursor?: string): Promise<VendorDomainPage> {
    const page = validPageCursor(cursor)
    const url = new URL(`${API_ROOT}/zones/${this.zoneId}/custom_hostnames`)
    url.searchParams.set('per_page', '50')
    url.searchParams.set('page', String(page))
    const payload = await this.getJson(url.toString())
    if (!Array.isArray(payload.result)) fail('INVALID_RESPONSE')

    const items: VendorDomain[] = []
    for (const item of payload.result) {
      if (!isObject(item)) continue
      const externalId = typeof item.id === 'string' && item.id.length > 0 && item.id.length <= 128 ? item.id : undefined
      const hostname = cleanHostname(item.hostname)
      const providerStatus = cleanStatus(item.status)
      if (!externalId || !hostname || !providerStatus || !HOSTNAME_STATUSES.has(providerStatus)) continue

      const candidateCname = typeof item.cname === 'string' ? item.cname : item.cname_target
      const cname = candidateCname === null || candidateCname === undefined ? null : cleanHostname(candidateCname) ?? null
      const ssl = isObject(item.ssl) ? cleanStatus(item.ssl.status) : undefined
      items.push({
        externalId,
        hostname,
        cname,
        providerStatus,
        ...(ssl && SSL_STATUSES.has(ssl) ? { sslStatus: ssl } : {}),
      })
    }

    let nextCursor: string | null = null
    if (payload.result_info !== undefined) {
      if (!isObject(payload.result_info)) fail('INVALID_RESPONSE')
      const totalPages = payload.result_info.total_pages
      const currentPage = payload.result_info.page
      if (typeof totalPages !== 'number' || !Number.isSafeInteger(totalPages) || totalPages < 0 || totalPages > MAX_PAGE) fail('INVALID_RESPONSE')
      if (currentPage !== undefined && (typeof currentPage !== 'number' || !Number.isSafeInteger(currentPage) || currentPage !== page)) fail('INVALID_RESPONSE')
      if (totalPages >= page && page < totalPages) nextCursor = String(page + 1)
    }
    return { items, nextCursor }
  }

  async registerDomain(input: VendorRegistrationInput): Promise<VendorDomain> {
    const hostname = cleanHostname(input?.hostname)
    if (!hostname) fail('INVALID_CONFIG')
    const originAddress = cleanHostname(input?.origin?.address)
    if (!originAddress) fail('INVALID_CONFIG')
    if (input.origin.protocol !== 'https' || input.origin.port !== 443) fail('UNSUPPORTED_OPERATION')

    // Cloudflare's custom-hostname endpoint has no origin protocol/port fields; do not
    // imply support for anything beyond an HTTPS origin on its standard port.
    if (await this.hasExistingHostname(hostname)) fail('RESOURCE_CONFLICT')

    const payload = await this.getJson(`${API_ROOT}/zones/${this.zoneId}/custom_hostnames`, {
      method: 'POST',
      body: { hostname, custom_origin_server: originAddress },
    })
    if (!isObject(payload.result)) fail('INVALID_RESPONSE')
    const result = payload.result
    const externalId = typeof result.id === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(result.id) ? result.id : undefined
    const returnedHostname = cleanHostname(result.hostname)
    const providerStatus = cleanStatus(result.status)
    if (!externalId || returnedHostname !== hostname || !providerStatus || !HOSTNAME_STATUSES.has(providerStatus)) fail('INVALID_RESPONSE')
    return { externalId, hostname, cname: null, providerStatus }
  }

  private async hasExistingHostname(hostname: string): Promise<boolean> {
    for (let page = 1; page <= MAX_HOSTNAME_LOOKUP_PAGES; page++) {
      const url = new URL(`${API_ROOT}/zones/${this.zoneId}/custom_hostnames`)
      // Cloudflare documents hostname as a substring filter, not an exact match.
      url.searchParams.set('hostname', hostname)
      url.searchParams.set('per_page', '50')
      url.searchParams.set('page', String(page))
      const payload = await this.getJson(url.toString())
      if (!Array.isArray(payload.result)) fail('INVALID_RESPONSE')
      if (payload.result.some((item) => isObject(item) && cleanHostname(item.hostname) === hostname)) return true

      if (payload.result_info === undefined) {
        if (payload.result.length < 50) return false
        fail('INVALID_RESPONSE')
      }
      if (!isObject(payload.result_info)) fail('INVALID_RESPONSE')
      const totalPages = payload.result_info.total_pages
      const currentPage = payload.result_info.page
      if (typeof totalPages !== 'number' || !Number.isSafeInteger(totalPages) || totalPages < 0
        || totalPages > MAX_HOSTNAME_LOOKUP_PAGES
        || (currentPage !== undefined && (typeof currentPage !== 'number' || currentPage !== page))) fail('INVALID_RESPONSE')
      if (page >= totalPages) return false
    }
    fail('INVALID_RESPONSE')
  }

  async deleteManagedDomain(externalId: string, hostnameInput: string): Promise<void> {
    const hostname = cleanHostname(hostnameInput)
    if (!hostname || typeof externalId !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(externalId)) fail('INVALID_CONFIG')
    const itemUrl = `${API_ROOT}/zones/${this.zoneId}/custom_hostnames/${encodeURIComponent(externalId)}`
    const existing = await this.getJson(itemUrl, { allowNotFound: true })
    if (existing === null) return
    if (!isObject(existing.result) || existing.result.id !== externalId || cleanHostname(existing.result.hostname) !== hostname) {
      fail('RESOURCE_CONFLICT')
    }
    await this.getJson(itemUrl, { method: 'DELETE', allowNotFound: true })
  }

  private async getJson(url: string): Promise<JsonObject>
  private async getJson(url: string, options: { method?: 'GET' | 'POST' | 'DELETE'; body?: JsonObject }): Promise<JsonObject>
  private async getJson(url: string, options: { allowNotFound: true; method?: 'GET' | 'POST' | 'DELETE'; body?: JsonObject }): Promise<JsonObject | null>
  private async getJson(
    url: string,
    options: { method?: 'GET' | 'POST' | 'DELETE'; body?: JsonObject; allowNotFound?: boolean } = {},
  ): Promise<JsonObject | null> {
    let response: Response
    try {
      response = await this.transport(url, {
        method: options.method ?? 'GET',
        headers: {
          Authorization: `Bearer ${this.token}`,
          Accept: 'application/json',
          ...(options.body ? { 'Content-Type': 'application/json' } : {}),
        },
        ...(options.body ? { body: JSON.stringify(options.body) } : {}),
        redirect: 'error',
        signal: AbortSignal.timeout(10_000),
      })
    } catch (error) {
      if (isTimeout(error)) fail('UPSTREAM_TIMEOUT')
      fail('UPSTREAM_ERROR')
    }

    if (response.status === 404 && options.allowNotFound) {
      await cancelBody(response)
      return null
    }
    if (response.status === 401 || response.status === 403) fail('AUTH_FAILED')
    if (response.status === 429) fail('RATE_LIMITED')
    if (response.status === 409) fail('RESOURCE_CONFLICT')
    if (response.status < 200 || response.status >= 300) fail('UPSTREAM_ERROR')

    const declaredLength = response.headers.get('content-length')
    if (declaredLength !== null) {
      if (!/^[0-9]+$/.test(declaredLength)) fail('INVALID_RESPONSE')
      if (Number(declaredLength) > MAX_RESPONSE_BYTES) {
        await cancelBody(response)
        fail('INVALID_RESPONSE')
      }
    }
    if (!response.body) fail('INVALID_RESPONSE')

    let text: string
    try {
      const reader = response.body.getReader()
      const chunks: Uint8Array[] = []
      let total = 0
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        total += value.byteLength
        if (total > MAX_RESPONSE_BYTES) {
          try { await reader.cancel() } catch { /* deliberately discard transport details */ }
          fail('INVALID_RESPONSE')
        }
        chunks.push(value)
      }
      const bytes = new Uint8Array(total)
      let offset = 0
      for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength }
      text = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
    } catch (error) {
      if (error instanceof VendorDriverError) throw error
      if (isTimeout(error)) fail('UPSTREAM_TIMEOUT')
      fail('INVALID_RESPONSE')
    }

    let payload: unknown
    try { payload = JSON.parse(text) } catch { fail('INVALID_RESPONSE') }
    if (!isObject(payload) || payload.success !== true) fail('INVALID_RESPONSE')
    return payload
  }
}

function isTimeout(error: unknown): boolean {
  if (!isObject(error)) return false
  return error.name === 'TimeoutError' || error.name === 'AbortError'
}

async function cancelBody(response: Response): Promise<void> {
  try { await response.body?.cancel() } catch { /* deliberately discard transport details */ }
}

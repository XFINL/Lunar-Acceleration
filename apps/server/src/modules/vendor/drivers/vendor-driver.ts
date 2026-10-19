export type VendorCode = 'cloudflare' | 'ali'

export interface VendorCredentials {
  accessKey: string
  secretKey: string
  config: { zoneId?: string }
}

export interface VendorConnectionResult {
  connected: true
  provider: VendorCode
  checkedAt: string
  accountLabel?: string
  providerStatus?: string
}

/** 远端清单只读快照，不包含证书、私钥、认证令牌或原始厂商响应。 */
export interface VendorDomain {
  externalId: string
  hostname: string
  cname: string | null
  providerStatus: string
  sslStatus?: string
}

export interface VendorDomainPage {
  items: VendorDomain[]
  nextCursor: string | null
}

export interface VendorRegistrationInput {
  hostname: string
  origin: { address: string; port: number; protocol: 'http' | 'https' }
}

/** M4 writes only register a domain and its single origin; they do not mean cache/TLS is deployed. */
export interface VendorDriver {
  testConnection(): Promise<VendorConnectionResult>
  listDomains(cursor?: string): Promise<VendorDomainPage>
  registerDomain?(input: VendorRegistrationInput): Promise<VendorDomain>
  deleteManagedDomain?(externalId: string, hostname: string): Promise<void>
}

export class VendorDriverError extends Error {
  constructor(readonly safeCode: 'INVALID_CONFIG' | 'AUTH_FAILED' | 'RATE_LIMITED' | 'UPSTREAM_TIMEOUT' | 'UPSTREAM_ERROR' | 'INVALID_RESPONSE' | 'UNSUPPORTED_OPERATION' | 'RESOURCE_CONFLICT') {
    super(safeCode)
    this.name = 'VendorDriverError'
  }
}

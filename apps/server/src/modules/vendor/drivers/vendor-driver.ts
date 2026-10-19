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

/** Narrow M4 deployment contract. Unsupported settings must fail before provider writes. */
export interface VendorDeploymentConfig {
  hostname: string
  origin: { address: string; port: number; protocol: 'http' | 'https'; host?: string | null }
  defaultTtl: number
  tls: { enabled: boolean; certId: string | null; forceHttps: boolean; hstsEnabled: boolean; tlsVersion: string }
  /** Supplied at execution only. Never serialize this value to a job or API response. */
  certificate?: { certificatePem: string; privateKeyPem: string }
}

export interface VendorDeploymentResult {
  verified: true
  providerStatus: string
  applied: Array<'origin' | 'cache' | 'certificate'>
  verifiedAt: string
}

/** M4 can deploy only explicitly supported configuration, never implying unsupported settings. */
export interface VendorDriver {
  testConnection(): Promise<VendorConnectionResult>
  listDomains(cursor?: string): Promise<VendorDomainPage>
  registerDomain?(input: VendorRegistrationInput): Promise<VendorDomain>
  deleteManagedDomain?(externalId: string, hostname: string): Promise<void>
  deployManagedConfig?(externalId: string, config: VendorDeploymentConfig): Promise<void>
  verifyManagedConfig?(externalId: string, config: VendorDeploymentConfig): Promise<VendorDeploymentResult>
}

export class VendorDriverError extends Error {
  constructor(readonly safeCode: 'INVALID_CONFIG' | 'AUTH_FAILED' | 'RATE_LIMITED' | 'UPSTREAM_TIMEOUT' | 'UPSTREAM_ERROR' | 'INVALID_RESPONSE' | 'UNSUPPORTED_OPERATION' | 'RESOURCE_CONFLICT') {
    super(safeCode)
    this.name = 'VendorDriverError'
  }
}

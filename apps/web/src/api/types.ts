import type { PaginatedData, RoleType } from '@lunar/shared'

export interface TokenPair {
  accessToken: string
  refreshToken: string
  expiresIn: number
}

export interface UserProfile {
  id: string
  username: string
  email: string | null
  nickname: string | null
  avatar: string | null
  roleType: RoleType
  roles: string[]
  permissions: string[]
  balance: string
  packageId: string | null
  packageExpireAt: string | null
}

export interface LoginResult extends TokenPair {
  user: UserProfile
}

export interface CaptchaResult {
  captchaId: string
  image: string
}

export interface AdminUserItem {
  id: string
  username: string
  email: string | null
  phone: string | null
  nickname: string | null
  avatar: string | null
  status: number
  roleType: number
  balance: string
  roles: string[]
  lastLoginAt: string | null
  lastLoginIp: string | null
  createdAt: string
}

export interface AdminUserDetail extends AdminUserItem {
  permissions: string[]
  packageId: string | null
  packageExpireAt: string | null
  inviteCode: string | null
}

export interface RoleItem {
  id: string
  name: string
  code: string
  description: string | null
  isSystem: number
  permissionCount: number
  userCount: number
  createdAt: string
}

export interface RoleDetail {
  id: string
  name: string
  code: string
  description: string | null
  isSystem: number
  permissionCodes: string[]
}

export interface PermissionItem {
  id: string
  name: string
  code: string
  resource: string
  action: string
}

export interface ApiKeyItem {
  id: string
  name: string
  accessKey: string
  status: number
  expireAt: string | null
  lastUsedAt: string | null
  createdAt: string
}

export interface CreatedApiKey {
  id: string
  name: string
  accessKey: string
  secretKey: string
}

export interface LoginLogItem {
  id: string
  ip: string
  region: string | null
  ua: string | null
  status: number
  message: string | null
  createdAt: string
}

export interface AuditLogItem {
  id: string
  userId: string | null
  roleType: number | null
  module: string
  action: string
  targetType: string | null
  targetId: string | null
  after: Record<string, unknown> | null
  ip: string | null
  ua: string | null
  createdAt: string
}

export type Paginated<T> = PaginatedData<T>

// ============================================================
// M2 套餐与订单
// ============================================================

export interface PackageVo {
  id: string
  name: string
  code: string
  description: string | null
  accessType: number
  vendorId: string | null
  trafficQuota: string
  bandwidthLimit: number
  domainLimit: number
  requestQuota: string
  /** 后端以 JSON 形式返回（对象 / 数组 / 字符串均可能出现） */
  featureFlags: unknown
  overQuotaPolicy: number
  price: string
  period: number
  status: number
  sort: number
  createdAt: string
  updatedAt: string
}

export interface MyPackageVo {
  id: string
  packageId: string
  name: string
  code: string
  startAt: string
  expireAt: string
  trafficUsed: string
  trafficQuota: string
  requestUsed: string
  requestQuota: string
  domainLimit: number
  bandwidthLimit: number
  status: number
  /** 后端以 JSON 形式返回（对象 / 数组 / 字符串均可能出现） */
  featureFlags: unknown
}

export interface OrderVo {
  id: string
  orderNo: string
  userId: string
  packageId: string | null
  packageName: string | null
  amount: string
  discount: string
  finalAmount: string
  status: number
  payChannel: string | null
  payAt: string | null
  createdAt: string
}

export interface OrderItemVo {
  id: string
  itemType: string
  itemId: string
  name: string
  price: string
  quantity: number
  subtotal: string
}

export interface OrderPaymentVo {
  id: string
  channel: string
  amount: string
  status: number
  tradeNo: string | null
  createdAt: string
}

export interface OrderDetailVo extends OrderVo {
  items: OrderItemVo[]
  payments: OrderPaymentVo[]
}

export interface TransactionVo {
  id: string
  userId: string
  username: string
  type: number
  amount: string
  balanceAfter: string
  refType: string | null
  refId: string | null
  remark: string | null
  createdAt: string
}

export interface SiteConfigVo {
  groupKey: string
  configKey: string
  configValue: unknown
  description: string | null
  updatedAt: string
}

/** 管理端订单列表项（附带下单用户） */
export interface AdminOrderVo extends OrderVo {
  username: string
}

/** 管理端订单详情（附带下单用户） */
export interface AdminOrderDetailVo extends OrderDetailVo {
  user: { id: string; username: string }
}

export interface PayOrderResult {
  id: string
  orderNo: string
  status: number
  payChannel: string
  payAt: string
  mock: boolean
}

export interface OrderActionResult {
  id: string
  status: number
}

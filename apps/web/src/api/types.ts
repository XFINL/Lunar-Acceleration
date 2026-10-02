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

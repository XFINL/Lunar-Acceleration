import type { RoleType } from '@lunar/shared'

export interface AuthUser {
  id: string
  username: string
  email: string | null
  nickname: string | null
  avatar: string | null
  roleType: RoleType
  status: number
  balance: string
  packageId: string | null
  packageExpireAt: string | null
  /** 权限点集合（由角色聚合） */
  permissions: string[]
  /** 角色标识集合 */
  roles: string[]
}

export interface JwtPayload {
  sub: string
  username: string
  roleType: RoleType
  iat?: number
  exp?: number
}

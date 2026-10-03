import { SetMetadata } from '@nestjs/common'
import type { PermissionCode } from '@lunar/shared'

export const PERMISSIONS_KEY = 'permissions'

/** 权限点校验（多个为 AND 关系） */
export const RequirePermissions = (...permissions: PermissionCode[]) =>
  SetMetadata(PERMISSIONS_KEY, permissions)

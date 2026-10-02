import { SetMetadata } from '@nestjs/common'
import type { RoleType } from '@lunar/shared'

export const ROLES_KEY = 'roles'

/** 角色校验 */
export const Roles = (...roles: RoleType[]) => SetMetadata(ROLES_KEY, roles)

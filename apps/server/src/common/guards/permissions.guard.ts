import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common'
import { Reflector } from '@nestjs/core'
import { ErrorCode, RoleType } from '@lunar/shared'
import type { Request } from 'express'
import { PERMISSIONS_KEY } from '../decorators/permissions.decorator'
import { BusinessException } from '../exceptions/business.exception'
import type { AuthUser } from '../interfaces/auth-user.interface'

@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<string[]>(PERMISSIONS_KEY, [
      context.getHandler(),
      context.getClass(),
    ])
    if (!required || required.length === 0) return true

    const request = context.switchToHttp().getRequest<Request & { user?: AuthUser }>()
    const user = request.user
    if (!user) {
      throw new BusinessException(ErrorCode.UNAUTHORIZED)
    }
    // 超管放行
    if (user.roleType === RoleType.SUPER_ADMIN) return true

    const granted = new Set(user.permissions)
    const missing = required.filter((permission) => !granted.has(permission))
    if (missing.length > 0) {
      throw new BusinessException(ErrorCode.FORBIDDEN)
    }
    return true
  }
}

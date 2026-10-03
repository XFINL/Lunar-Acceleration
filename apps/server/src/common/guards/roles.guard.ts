import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common'
import { Reflector } from '@nestjs/core'
import { ErrorCode, RoleType, type RoleType as RoleTypeValue } from '@lunar/shared'
import type { Request } from 'express'
import { ROLES_KEY } from '../decorators/roles.decorator'
import { BusinessException } from '../exceptions/business.exception'
import type { AuthUser } from '../interfaces/auth-user.interface'

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const requiredRoles = this.reflector.getAllAndOverride<RoleTypeValue[]>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ])
    if (!requiredRoles || requiredRoles.length === 0) return true

    const request = context.switchToHttp().getRequest<Request & { user?: AuthUser }>()
    const user = request.user
    if (!user) {
      throw new BusinessException(ErrorCode.UNAUTHORIZED)
    }
    // 超管拥有全部权限
    if (user.roleType === RoleType.SUPER_ADMIN) return true

    if (!requiredRoles.includes(user.roleType)) {
      throw new BusinessException(ErrorCode.FORBIDDEN)
    }
    return true
  }
}

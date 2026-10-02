import { createParamDecorator, ExecutionContext } from '@nestjs/common'
import type { Request } from 'express'
import type { AuthUser } from '../interfaces/auth-user.interface'

/** 注入当前登录用户 */
export const CurrentUser = createParamDecorator(
  (data: keyof AuthUser | undefined, ctx: ExecutionContext) => {
    const request = ctx.switchToHttp().getRequest<Request & { user?: AuthUser }>()
    const user = request.user
    if (!user) return undefined
    return data ? user[data] : user
  },
)

import { ExecutionContext, Injectable, ServiceUnavailableException } from '@nestjs/common'
import { Reflector } from '@nestjs/core'
import { AuthGuard } from '@nestjs/passport'
import { RoleType } from '@lunar/shared'
import type { Request } from 'express'
import { IS_PUBLIC_KEY } from '../decorators/public.decorator'
import { PrismaService } from '../../database/prisma.service'

@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {
  constructor(private readonly reflector: Reflector, private readonly prisma: PrismaService) {
    super()
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [context.getHandler(), context.getClass()])
    if (!isPublic && !(await super.canActivate(context))) return false
    await this.enforceMaintenance(context)
    return true
  }

  private async enforceMaintenance(context: ExecutionContext): Promise<void> {
    const request = context.switchToHttp().getRequest<Request & { user?: { roleType?: number } }>()
    // Keep the operational auth surface reachable so an administrator can log in and disable maintenance.
    if (/(?:^|\/)auth\/(?:captcha|login|refresh|logout)\/?$/.test(request.path)) return
    const [enabledRow, ipsRow, messageRow] = await Promise.all([
      this.prisma.siteConfig.findUnique({ where: { uk_group_key: { groupKey: 'maintenance', configKey: 'enabled' } }, select: { configValue: true } }),
      this.prisma.siteConfig.findUnique({ where: { uk_group_key: { groupKey: 'maintenance', configKey: 'whitelistIps' } }, select: { configValue: true } }),
      this.prisma.siteConfig.findUnique({ where: { uk_group_key: { groupKey: 'maintenance', configKey: 'message' } }, select: { configValue: true } }),
    ])
    if (enabledRow?.configValue !== true) return
    const user = request.user
    if (user?.roleType === RoleType.ADMIN || user?.roleType === RoleType.SUPER_ADMIN) return
    const remoteIp = request.ip?.replace(/^::ffff:/, '')
    const whitelist = Array.isArray(ipsRow?.configValue) ? ipsRow.configValue : []
    if (remoteIp && whitelist.some((ip) => typeof ip === 'string' && ip.replace(/^::ffff:/, '') === remoteIp)) return
    const message = typeof messageRow?.configValue === 'string' ? messageRow.configValue : '系统维护中，请稍后访问。'
    throw new ServiceUnavailableException(message)
  }
}

import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common'
import { Reflector } from '@nestjs/core'
import type { Request } from 'express'
import { Observable, tap } from 'rxjs'
import { AUDIT_KEY, type AuditMeta } from '../decorators/audit.decorator'
import type { AuthUser } from '../interfaces/auth-user.interface'
import { getClientIp, getUserAgent } from '../utils/ip.util'
import { AuditService } from '../../modules/audit/audit.service'

/**
 * 操作审计：对标记 @Auditable 的接口记录 audit_logs（见 05-backend.md §12.10）
 */
@Injectable()
export class AuditInterceptor implements NestInterceptor {
  constructor(
    private readonly reflector: Reflector,
    private readonly auditService: AuditService,
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const meta = this.reflector.getAllAndOverride<AuditMeta>(AUDIT_KEY, [
      context.getHandler(),
      context.getClass(),
    ])
    if (!meta) return next.handle()

    const request = context.switchToHttp().getRequest<Request & { user?: AuthUser }>()

    return next.handle().pipe(
      tap((data) => {
        void this.auditService.record({
          userId: request.user?.id ?? null,
          roleType: request.user?.roleType ?? null,
          module: meta.module,
          action: meta.action,
          targetType: meta.targetType ?? null,
          targetId: this.resolveTargetId(request, data),
          after: this.sanitize(data),
          ip: getClientIp(request),
          ua: getUserAgent(request),
        })
      }),
    )
  }

  private resolveTargetId(request: Request, data: unknown): string | null {
    const fromParams = request.params?.id
    if (fromParams) return fromParams
    if (data && typeof data === 'object' && 'id' in data) {
      const id = (data as { id?: unknown }).id
      if (typeof id === 'string' || typeof id === 'number') return String(id)
    }
    return null
  }

  /** 移除敏感字段，避免写入审计 */
  private sanitize(data: unknown): Record<string, unknown> | null {
    if (!data || typeof data !== 'object') return null
    const clone: Record<string, unknown> = { ...(data as Record<string, unknown>) }
    for (const key of ['password', 'passwordHash', 'secretKey', 'accessKey', 'token']) {
      if (key in clone) clone[key] = '***'
    }
    return clone
  }
}

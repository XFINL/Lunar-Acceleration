import { SetMetadata } from '@nestjs/common'

export interface AuditMeta {
  module: string
  action: string
  targetType?: string
}

export const AUDIT_KEY = 'audit'

/** 标记需要写入操作审计的接口 */
export const Auditable = (meta: AuditMeta) => SetMetadata(AUDIT_KEY, meta)

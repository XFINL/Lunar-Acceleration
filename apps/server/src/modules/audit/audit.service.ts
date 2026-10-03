import { Injectable, Logger } from '@nestjs/common'
import { Prisma } from '@prisma/client'
import { PrismaService } from '../../database/prisma.service'

export interface AuditRecordInput {
  userId: string | null
  roleType: number | null
  module: string
  action: string
  targetType: string | null
  targetId: string | null
  before?: Record<string, unknown> | null
  after?: Record<string, unknown> | null
  ip: string
  ua: string
}

export interface AuditQuery {
  page: number
  pageSize: number
  module?: string
  userId?: string
  startTime?: string
  endTime?: string
}

@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name)

  constructor(private readonly prisma: PrismaService) {}

  /** 记录操作审计（失败不影响主流程） */
  async record(input: AuditRecordInput): Promise<void> {
    try {
      await this.prisma.auditLog.create({
        data: {
          userId: input.userId ? BigInt(input.userId) : null,
          roleType: input.roleType,
          module: input.module,
          action: input.action,
          targetType: input.targetType,
          targetId: input.targetId ? this.toBigInt(input.targetId) : null,
          before: (input.before ?? undefined) as Prisma.InputJsonValue | undefined,
          after: (input.after ?? undefined) as Prisma.InputJsonValue | undefined,
          ip: input.ip,
          ua: input.ua,
        },
      })
    } catch (error) {
      this.logger.warn(`写入审计日志失败: ${(error as Error).message}`)
    }
  }

  async findByPage(query: AuditQuery) {
    const where: Prisma.AuditLogWhereInput = {}
    if (query.module) where.module = query.module
    if (query.userId) where.userId = this.toBigInt(query.userId)
    if (query.startTime || query.endTime) {
      where.createdAt = {}
      if (query.startTime) where.createdAt.gte = new Date(query.startTime)
      if (query.endTime) where.createdAt.lte = new Date(query.endTime)
    }

    const [total, rows] = await this.prisma.$transaction([
      this.prisma.auditLog.count({ where }),
      this.prisma.auditLog.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
    ])

    return { total, rows }
  }

  private toBigInt(value: string): bigint {
    return BigInt(value)
  }
}

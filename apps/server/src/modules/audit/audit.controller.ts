import { Controller, Get, Query, UseGuards } from '@nestjs/common'
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger'
import { Type } from 'class-transformer'
import { IsISO8601, IsOptional, IsString } from 'class-validator'
import { ApiPropertyOptional } from '@nestjs/swagger'
import { PermissionCode, RoleType } from '@lunar/shared'
import { Roles } from '../../common/decorators/roles.decorator'
import { RequirePermissions } from '../../common/decorators/permissions.decorator'
import { PermissionsGuard } from '../../common/guards/permissions.guard'
import { RolesGuard } from '../../common/guards/roles.guard'
import { PaginationQueryDto } from '../../common/dto/pagination.dto'
import { paginate } from '../../common/dto/response.dto'
import { AuditService } from './audit.service'

class AuditLogQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ description: '模块' })
  @IsString()
  @IsOptional()
  module?: string

  @ApiPropertyOptional({ description: '操作用户 ID' })
  @IsString()
  @IsOptional()
  userId?: string

  @ApiPropertyOptional({ description: '开始时间 ISO8601' })
  @Type(() => String)
  @IsISO8601()
  @IsOptional()
  startTime?: string

  @ApiPropertyOptional({ description: '结束时间 ISO8601' })
  @Type(() => String)
  @IsISO8601()
  @IsOptional()
  endTime?: string
}

@ApiTags('管理员端 - 审计')
@ApiBearerAuth()
@Controller('admin/audit-logs')
@UseGuards(RolesGuard, PermissionsGuard)
@Roles(RoleType.ADMIN, RoleType.SUPER_ADMIN)
export class AuditController {
  constructor(private readonly auditService: AuditService) {}

  @Get()
  @RequirePermissions('audit:read' as PermissionCode)
  @ApiOperation({ summary: '操作日志列表' })
  async list(@Query() query: AuditLogQueryDto) {
    const { total, rows } = await this.auditService.findByPage({
      page: query.page,
      pageSize: query.pageSize,
      module: query.module,
      userId: query.userId,
      startTime: query.startTime,
      endTime: query.endTime,
    })
    return paginate(
      rows.map((row) => ({
        id: row.id.toString(),
        userId: row.userId?.toString() ?? null,
        roleType: row.roleType,
        module: row.module,
        action: row.action,
        targetType: row.targetType,
        targetId: row.targetId?.toString() ?? null,
        after: row.after,
        ip: row.ip,
        ua: row.ua,
        createdAt: row.createdAt,
      })),
      query.page,
      query.pageSize,
      total,
    )
  }
}

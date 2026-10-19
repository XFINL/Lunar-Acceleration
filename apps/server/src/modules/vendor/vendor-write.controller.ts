import { Body, Controller, Get, Param, Post, Query, UseGuards } from '@nestjs/common'
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger'
import { IsIn, IsString, Length } from 'class-validator'
import { RoleType } from '@lunar/shared'
import { CurrentUser } from '../../common/decorators/current-user.decorator'
import { RequirePermissions } from '../../common/decorators/permissions.decorator'
import { Roles } from '../../common/decorators/roles.decorator'
import { PermissionsGuard } from '../../common/guards/permissions.guard'
import { RolesGuard } from '../../common/guards/roles.guard'
import { PaginationQueryDto } from '../../common/dto/pagination.dto'
import { paginate } from '../../common/dto/response.dto'
import type { AuthUser } from '../../common/interfaces/auth-user.interface'
import { VendorWriteService } from './vendor-write.service'

class WriteJobQuery extends PaginationQueryDto {}
class CreateWriteJobDto {
  @IsIn(['register', 'delete']) action!: 'register' | 'delete'
  @IsString() @Length(1, 20) domainId!: string
  @IsString() @Length(1, 64) idempotencyKey!: string
}

@ApiTags('管理员端 - 受控云端写入')
@ApiBearerAuth()
@Controller('admin')
@UseGuards(RolesGuard, PermissionsGuard)
@Roles(RoleType.ADMIN, RoleType.SUPER_ADMIN)
export class VendorWriteController {
  constructor(private readonly service: VendorWriteService) {}

  @Get('vendor-write-capabilities')
  @RequirePermissions('vendor:read')
  capabilities() { return this.service.capabilities() }

  @Get('vendor-accounts/:id/write-jobs')
  @RequirePermissions('vendor:read')
  async list(@Param('id') id: string, @Query() q: WriteJobQuery) { const result = await this.service.list(id, q.page, q.pageSize); return paginate(result.list, q.page, q.pageSize, result.total) }

  @Post('vendor-accounts/:id/write-jobs')
  @RequirePermissions('vendor:deploy')
  create(@Param('id') id: string, @Body() dto: CreateWriteJobDto, @CurrentUser() user: AuthUser) {
    return this.service.create(id, dto, user?.id)
  }

  @Post('vendor-write-jobs/:id/retry')
  @RequirePermissions('vendor:deploy')
  retry(@Param('id') id: string) { return this.service.retry(id) }
}

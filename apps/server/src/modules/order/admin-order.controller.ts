import { Controller, Get, Param, Post, Query, UseGuards } from '@nestjs/common'
import { ApiBearerAuth, ApiOperation, ApiPropertyOptional, ApiTags } from '@nestjs/swagger'
import { RoleType } from '@lunar/shared'
import { IsOptional, IsString } from 'class-validator'
import { Auditable } from '../../common/decorators/audit.decorator'
import { RequirePermissions } from '../../common/decorators/permissions.decorator'
import { Roles } from '../../common/decorators/roles.decorator'
import { PaginationQueryDto } from '../../common/dto/pagination.dto'
import { paginate } from '../../common/dto/response.dto'
import { PermissionsGuard } from '../../common/guards/permissions.guard'
import { RolesGuard } from '../../common/guards/roles.guard'
import { OrderService } from './order.service'

class AdminOrderQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ description: '用户 ID' })
  @IsString()
  @IsOptional()
  userId?: string
}

@ApiTags('管理员端 - 订单')
@ApiBearerAuth()
@Controller('admin')
@UseGuards(RolesGuard, PermissionsGuard)
@Roles(RoleType.ADMIN, RoleType.SUPER_ADMIN)
export class AdminOrderController {
  constructor(private readonly orderService: OrderService) {}

  @Get('orders')
  @RequirePermissions('order:read')
  @ApiOperation({ summary: '订单列表' })
  async list(@Query() query: AdminOrderQueryDto) {
    const { total, list } = await this.orderService.adminListOrders({
      page: query.page,
      pageSize: query.pageSize,
      status: query.status,
      keyword: query.keyword,
      userId: query.userId,
    })
    return paginate(list, query.page, query.pageSize, total)
  }

  @Get('orders/:id')
  @RequirePermissions('order:read')
  @ApiOperation({ summary: '订单详情' })
  async detail(@Param('id') id: string) {
    return this.orderService.adminGetOrder(id)
  }

  @Post('orders/:id/refund')
  @RequirePermissions('order:refund')
  @Auditable({ module: 'order', action: 'refund_order', targetType: 'order' })
  @ApiOperation({ summary: '订单退款' })
  async refund(@Param('id') id: string) {
    return this.orderService.adminRefundOrder(id)
  }

  @Get('transactions')
  @RequirePermissions('order:read')
  @ApiOperation({ summary: '资金流水列表' })
  async transactions(@Query() query: AdminOrderQueryDto) {
    const { total, list } = await this.orderService.adminListTransactions({
      page: query.page,
      pageSize: query.pageSize,
      userId: query.userId,
    })
    return paginate(list, query.page, query.pageSize, total)
  }
}

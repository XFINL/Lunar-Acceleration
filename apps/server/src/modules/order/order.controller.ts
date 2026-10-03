import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common'
import { ApiBearerAuth, ApiOperation, ApiPropertyOptional, ApiTags } from '@nestjs/swagger'
import { PAY_CHANNELS, type PayChannel } from '@lunar/shared'
import { Type } from 'class-transformer'
import { IsIn, IsInt, IsOptional, IsString, Min } from 'class-validator'
import { CurrentUser } from '../../common/decorators/current-user.decorator'
import { PaginationQueryDto } from '../../common/dto/pagination.dto'
import { paginate } from '../../common/dto/response.dto'
import type { AuthUser } from '../../common/interfaces/auth-user.interface'
import { OrderService } from './order.service'

class CreateOrderDto {
  @ApiPropertyOptional({ description: '套餐 ID' })
  @IsString()
  packageId!: string

  @ApiPropertyOptional({ description: '数量' })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @IsOptional()
  quantity?: number
}

class PayOrderDto {
  @ApiPropertyOptional({ enum: PAY_CHANNELS })
  @IsIn(PAY_CHANNELS)
  channel!: PayChannel
}

@ApiTags('用户端 - 订单')
@ApiBearerAuth()
@Controller('user/orders')
export class OrderController {
  constructor(private readonly orderService: OrderService) {}

  @Get()
  @ApiOperation({ summary: '订单列表' })
  async list(@CurrentUser() user: AuthUser, @Query() query: PaginationQueryDto) {
    const { total, list } = await this.orderService.listUserOrders(user.id, {
      page: query.page,
      pageSize: query.pageSize,
      status: query.status,
    })
    return paginate(list, query.page, query.pageSize, total)
  }

  @Post()
  @ApiOperation({ summary: '创建订单' })
  async create(@CurrentUser() user: AuthUser, @Body() dto: CreateOrderDto) {
    return this.orderService.createOrder(user.id, dto.packageId, dto.quantity ?? 1)
  }

  @Get(':id')
  @ApiOperation({ summary: '订单详情' })
  async detail(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.orderService.getUserOrderDetail(user.id, id)
  }

  @Post(':id/pay')
  @ApiOperation({ summary: '支付订单（占位支付）' })
  async pay(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: PayOrderDto) {
    return this.orderService.payOrder(user.id, id, dto.channel)
  }

  @Post(':id/cancel')
  @ApiOperation({ summary: '取消订单' })
  async cancel(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.orderService.cancelOrder(user.id, id)
  }
}

import { Module } from '@nestjs/common'
import { AdminOrderController } from './admin-order.controller'
import { OrderController } from './order.controller'
import { OrderService } from './order.service'

@Module({
  controllers: [OrderController, AdminOrderController],
  providers: [OrderService],
  exports: [OrderService],
})
export class OrderModule {}

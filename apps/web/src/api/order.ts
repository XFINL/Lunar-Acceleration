import type { PayChannel } from '@lunar/shared'
import { request } from './client'
import type { OrderActionResult, OrderDetailVo, OrderVo, Paginated, PayOrderResult } from './types'

export interface OrderQuery {
  page?: number
  pageSize?: number
  status?: number
}

export interface CreateOrderPayload {
  packageId: string
  quantity?: number
}

export const orderApi = {
  /** 我的订单列表 */
  listOrders: (params: OrderQuery) => request.get<Paginated<OrderVo>>('/user/orders', { params }),
  /** 创建订单 */
  createOrder: (data: CreateOrderPayload) =>
    request.post<OrderDetailVo>('/user/orders', data),
  /** 订单详情 */
  getOrder: (id: string) => request.get<OrderDetailVo>(`/user/orders/${id}`),
  /** 支付订单（模拟支付） */
  payOrder: (id: string, channel: PayChannel) =>
    request.post<PayOrderResult>(`/user/orders/${id}/pay`, { channel }),
  /** 取消订单 */
  cancelOrder: (id: string) => request.post<OrderActionResult>(`/user/orders/${id}/cancel`),
}

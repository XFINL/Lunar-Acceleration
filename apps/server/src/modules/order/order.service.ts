import { Injectable } from '@nestjs/common'
import { Prisma } from '@prisma/client'
import {
  ErrorCode,
  OrderStatus,
  PackagePeriod,
  PackageStatus,
  PaymentStatus,
  UserPackageStatus,
} from '@lunar/shared'
import { BusinessException } from '../../common/exceptions/business.exception'
import { PrismaService } from '../../database/prisma.service'

export interface OrderQuery {
  page: number
  pageSize: number
  status?: number
  keyword?: string
  userId?: string
}

type OrderWithPackage = Prisma.OrderGetPayload<{ include: { package: true } }>
type OrderWithDetail = Prisma.OrderGetPayload<{
  include: { package: true; items: true; payments: true }
}>
type OrderWithUser = Prisma.OrderGetPayload<{
  include: { user: true; package: true; items: true; payments: true }
}>
type TransactionWithUser = Prisma.TransactionGetPayload<{ include: { user: true } }>

@Injectable()
export class OrderService {
  constructor(private readonly prisma: PrismaService) {}

  // ============ 用户端 ============

  async listUserOrders(userId: string, query: OrderQuery) {
    const where: Prisma.OrderWhereInput = { userId: BigInt(userId) }
    if (query.status !== undefined) where.status = query.status

    const [total, rows] = await this.prisma.$transaction([
      this.prisma.order.count({ where }),
      this.prisma.order.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
        include: { package: true },
      }),
    ])
    return { total, list: rows.map((row) => this.toOrderVo(row)) }
  }

  async getUserOrderDetail(userId: string, id: string) {
    const order = await this.prisma.order.findFirst({
      where: { id: BigInt(id), userId: BigInt(userId) },
      include: { package: true, items: true, payments: true },
    })
    if (!order) throw new BusinessException(ErrorCode.RECORD_NOT_FOUND)
    return this.toOrderDetailVo(order)
  }

  async createOrder(userId: string, packageId: string, quantity = 1) {
    const pkg = await this.prisma.package.findFirst({
      where: { id: BigInt(packageId), status: PackageStatus.ONLINE },
    })
    if (!pkg) throw new BusinessException(ErrorCode.RECORD_NOT_FOUND, '套餐不存在或已下架')

    const orderNo = await this.generateUniqueOrderNo()
    const amount = pkg.price.mul(quantity)
    const discount = new Prisma.Decimal(0)
    const finalAmount = amount

    const order = await this.prisma.order.create({
      data: {
        orderNo,
        userId: BigInt(userId),
        packageId: pkg.id,
        amount,
        discount,
        finalAmount,
        status: OrderStatus.PENDING,
        items: {
          create: [
            {
              itemType: 'package',
              itemId: pkg.id,
              name: pkg.name,
              price: pkg.price,
              quantity,
              subtotal: amount,
            },
          ],
        },
      },
      include: { package: true, items: true, payments: true },
    })
    return this.toOrderDetailVo(order)
  }

  async payOrder(userId: string, id: string, channel: string) {
    const order = await this.prisma.order.findFirst({
      where: { id: BigInt(id), userId: BigInt(userId) },
      include: { package: true },
    })
    if (!order) throw new BusinessException(ErrorCode.RECORD_NOT_FOUND)
    if (order.status !== OrderStatus.PENDING) {
      throw new BusinessException(ErrorCode.PARAM_INVALID, '订单状态不允许支付')
    }

    const now = new Date()
    const tradeNo = `MOCK${now.getTime()}${Math.floor(Math.random() * 900000 + 100000)}`
    const pkg = order.package
    const expireAt = pkg ? this.computeExpireAt(now, pkg.period) : null

    await this.prisma.$transaction(async (tx) => {
      await tx.payment.create({
        data: {
          orderId: order.id,
          userId: order.userId,
          channel,
          tradeNo,
          amount: order.finalAmount,
          status: PaymentStatus.SUCCESS,
        },
      })
      await tx.order.update({
        where: { id: order.id },
        data: { status: OrderStatus.PAID, payAt: now, payChannel: channel },
      })
      if (pkg && expireAt) {
        await tx.userPackage.create({
          data: {
            userId: order.userId,
            packageId: pkg.id,
            startAt: now,
            expireAt,
            status: UserPackageStatus.ACTIVE,
          },
        })
        await tx.user.update({
          where: { id: order.userId },
          data: { packageId: pkg.id, packageExpireAt: expireAt },
        })
      }
    })

    return {
      id: order.id.toString(),
      orderNo: order.orderNo,
      status: OrderStatus.PAID,
      payChannel: channel,
      payAt: now,
      mock: true,
    }
  }

  async cancelOrder(userId: string, id: string) {
    const order = await this.prisma.order.findFirst({
      where: { id: BigInt(id), userId: BigInt(userId) },
    })
    if (!order) throw new BusinessException(ErrorCode.RECORD_NOT_FOUND)
    if (order.status !== OrderStatus.PENDING) {
      throw new BusinessException(ErrorCode.PARAM_INVALID, '订单状态不允许取消')
    }

    const updated = await this.prisma.order.update({
      where: { id: order.id },
      data: { status: OrderStatus.CANCELLED },
    })
    return { id: updated.id.toString(), status: updated.status }
  }

  // ============ 管理员端 ============

  async adminListOrders(query: OrderQuery) {
    const where: Prisma.OrderWhereInput = {}
    if (query.status !== undefined) where.status = query.status
    if (query.userId) where.userId = BigInt(query.userId)
    if (query.keyword) where.orderNo = { contains: query.keyword }

    const [total, rows] = await this.prisma.$transaction([
      this.prisma.order.count({ where }),
      this.prisma.order.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
        include: { package: true, user: { select: { id: true, username: true } } },
      }),
    ])
    return {
      total,
      list: rows.map((row) => ({
        ...this.toOrderVo(row),
        username: row.user.username,
      })),
    }
  }

  async adminGetOrder(id: string) {
    const order = await this.prisma.order.findFirst({
      where: { id: BigInt(id) },
      include: { package: true, items: true, payments: true, user: true },
    })
    if (!order) throw new BusinessException(ErrorCode.RECORD_NOT_FOUND)
    return {
      ...this.toOrderDetailVo(order),
      user: { id: order.user.id.toString(), username: order.user.username },
    }
  }

  async adminRefundOrder(id: string) {
    const order = await this.prisma.order.findUnique({ where: { id: BigInt(id) } })
    if (!order) throw new BusinessException(ErrorCode.RECORD_NOT_FOUND)
    if (order.status !== OrderStatus.PAID) {
      throw new BusinessException(ErrorCode.PARAM_INVALID, '订单状态不允许退款')
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      await tx.payment.updateMany({
        where: { orderId: order.id, status: PaymentStatus.SUCCESS },
        data: { status: PaymentStatus.REFUNDED },
      })
      return tx.order.update({
        where: { id: order.id },
        data: { status: OrderStatus.REFUNDED },
      })
    })
    return { id: updated.id.toString(), status: updated.status }
  }

  async adminListTransactions(query: OrderQuery) {
    const where: Prisma.TransactionWhereInput = {}
    if (query.userId) where.userId = BigInt(query.userId)

    const [total, rows] = await this.prisma.$transaction([
      this.prisma.transaction.count({ where }),
      this.prisma.transaction.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
        include: { user: true },
      }),
    ])
    return { total, list: rows.map((row) => this.toTransactionVo(row)) }
  }

  // ============ 内部 ============

  private async generateUniqueOrderNo(): Promise<string> {
    const now = new Date()
    const pad = (value: number): string => value.toString().padStart(2, '0')
    const stamp = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}${pad(
      now.getHours(),
    )}${pad(now.getMinutes())}${pad(now.getSeconds())}`
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'

    for (let i = 0; i < 5; i++) {
      let rand = ''
      for (let j = 0; j < 6; j++) {
        rand += chars.charAt(Math.floor(Math.random() * chars.length))
      }
      const candidate = `ORD${stamp}${rand}`
      const exists = await this.prisma.order.findUnique({ where: { orderNo: candidate } })
      if (!exists) return candidate
    }
    throw new BusinessException(ErrorCode.PARAM_INVALID, '订单号生成失败，请重试')
  }

  private computeExpireAt(start: Date, period: number): Date {
    const date = new Date(start)
    if (period === PackagePeriod.QUARTER) date.setMonth(date.getMonth() + 3)
    else if (period === PackagePeriod.YEAR) date.setFullYear(date.getFullYear() + 1)
    else date.setMonth(date.getMonth() + 1)
    return date
  }

  private toOrderVo(order: OrderWithPackage) {
    return {
      id: order.id.toString(),
      orderNo: order.orderNo,
      userId: order.userId.toString(),
      packageId: order.packageId?.toString() ?? null,
      packageName: order.package?.name ?? null,
      amount: order.amount.toFixed(2),
      discount: order.discount.toFixed(2),
      finalAmount: order.finalAmount.toFixed(2),
      status: order.status,
      payChannel: order.payChannel,
      payAt: order.payAt,
      createdAt: order.createdAt,
    }
  }

  private toOrderDetailVo(order: OrderWithDetail | OrderWithUser) {
    return {
      ...this.toOrderVo(order),
      items: order.items.map((item) => ({
        id: item.id.toString(),
        itemType: item.itemType,
        itemId: item.itemId.toString(),
        name: item.name,
        price: item.price.toFixed(2),
        quantity: item.quantity,
        subtotal: item.subtotal.toFixed(2),
      })),
      payments: order.payments.map((payment) => ({
        id: payment.id.toString(),
        channel: payment.channel,
        amount: payment.amount.toFixed(2),
        status: payment.status,
        tradeNo: payment.tradeNo,
        createdAt: payment.createdAt,
      })),
    }
  }

  private toTransactionVo(row: TransactionWithUser) {
    return {
      id: row.id.toString(),
      userId: row.userId.toString(),
      username: row.user.username,
      type: row.type,
      amount: row.amount.toFixed(2),
      balanceAfter: row.balanceAfter.toFixed(2),
      refType: row.refType,
      refId: row.refId?.toString() ?? null,
      remark: row.remark,
      createdAt: row.createdAt,
    }
  }
}

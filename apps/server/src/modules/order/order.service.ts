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
    if (!Number.isInteger(quantity) || quantity < 1 || quantity > 120) {
      throw new BusinessException(ErrorCode.PARAM_INVALID, '购买数量必须为 1 到 120 的整数')
    }
    const pkg = await this.prisma.package.findFirst({
      where: { id: BigInt(packageId), status: PackageStatus.ONLINE },
    })
    if (!pkg) throw new BusinessException(ErrorCode.RECORD_NOT_FOUND, '套餐不存在或已下架')

    const orderNo = await this.generateUniqueOrderNo()
    const amount = pkg.price.mul(quantity)
    const snapshot = {
      packageName: pkg.name,
      packageCode: pkg.code,
      period: pkg.period,
      quantity,
      trafficQuota: pkg.trafficQuota.toString(),
      requestQuota: pkg.requestQuota.toString(),
      bandwidthLimit: pkg.bandwidthLimit,
      domainLimit: pkg.domainLimit,
      featureFlags: pkg.featureFlags,
      overQuotaPolicy: pkg.overQuotaPolicy,
    }
    const order = await this.prisma.order.create({
      data: {
        orderNo,
        userId: BigInt(userId),
        packageId: pkg.id,
        amount,
        discount: new Prisma.Decimal(0),
        finalAmount: amount,
        status: OrderStatus.PENDING,
        packageSnapshot: snapshot,
        items: {
          create: [{
            itemType: 'package', itemId: pkg.id, name: pkg.name,
            price: pkg.price, quantity, subtotal: amount,
          }],
        },
      },
      include: { package: true, items: true, payments: true },
    })
    return this.toOrderDetailVo(order)
  }

  async payOrder(userId: string, id: string, channel: string) {
    const uid = BigInt(userId)
    const orderId = BigInt(id)
    const now = new Date()
    const tradeNo = `MOCK${now.getTime()}${Math.floor(Math.random() * 900000 + 100000)}`
    const result = await this.prisma.$transaction(async (tx) => {
      await this.lockUser(tx, uid)
      const order = await tx.order.findFirst({
        where: { id: orderId, userId: uid }, include: { package: true },
      })
      if (!order) throw new BusinessException(ErrorCode.RECORD_NOT_FOUND)
      if (order.status === OrderStatus.PAID) {
        return { id: order.id.toString(), orderNo: order.orderNo, status: order.status,
          payChannel: order.payChannel, payAt: order.payAt, mock: true }
      }
      if (order.status !== OrderStatus.PENDING) {
        throw new BusinessException(ErrorCode.PARAM_INVALID, '订单状态不允许支付')
      }
      const claimed = await tx.order.updateMany({
        where: { id: order.id, userId: uid, status: OrderStatus.PENDING },
        data: { status: OrderStatus.PAID, payAt: now, payChannel: channel },
      })
      if (claimed.count !== 1) throw new BusinessException(ErrorCode.PARAM_INVALID, '订单状态已变更')

      // This is a mock-only payment record. No card, wallet, or user balance is charged.
      await tx.payment.create({ data: {
        orderId: order.id, userId: uid, channel: 'mock', tradeNo,
        amount: order.finalAmount, status: PaymentStatus.SUCCESS,
        callbackData: { mock: true, charged: false },
      } })
      if (order.packageId) {
        const terms = this.readPackageSnapshot(order.packageSnapshot, order.package)
        if (terms.legacy) {
          throw new BusinessException(ErrorCode.PARAM_INVALID, '历史订单缺少周期快照，不能安全发放套餐')
        }
        const months = this.periodMonths(terms.period) * terms.quantity
        const trafficGrant = BigInt(terms.trafficQuota) * BigInt(terms.quantity)
        const requestGrant = BigInt(terms.requestQuota) * BigInt(terms.quantity)
        const current = await tx.userPackage.findFirst({
          where: { userId: uid, status: UserPackageStatus.ACTIVE, expireAt: { gt: now } },
          orderBy: { expireAt: 'desc' },
        })
        let rollback: Record<string, unknown>
        if (current?.packageId === order.packageId) {
          rollback = {
            mode: 'renew', entitlementId: current.id.toString(),
            previousExpireAt: current.expireAt.toISOString(),
            previousTrafficQuota: current.trafficQuota.toString(),
            previousRequestQuota: current.requestQuota.toString(),
            previousOrderId: current.orderId?.toString() ?? null,
          }
          const expireAt = this.addUtcMonths(current.expireAt, months)
          await tx.userPackage.update({ where: { id: current.id }, data: {
            expireAt, trafficQuota: current.trafficQuota + trafficGrant,
            requestQuota: current.requestQuota + requestGrant, orderId: order.id,
          } })
          await tx.user.update({ where: { id: uid }, data: { packageId: current.packageId, packageExpireAt: expireAt } })
        } else {
          const oldActive = await tx.userPackage.findMany({
            where: { userId: uid, status: UserPackageStatus.ACTIVE },
            orderBy: { expireAt: 'desc' },
          })
          const user = await tx.user.findUniqueOrThrow({ where: { id: uid } })
          rollback = {
            mode: 'switch', previousActiveIds: oldActive.map((r) => r.id.toString()),
            previousPackageId: user.packageId?.toString() ?? null,
            previousUserExpireAt: user.packageExpireAt?.toISOString() ?? null,
          }
          await tx.userPackage.updateMany({
            where: { userId: uid, status: UserPackageStatus.ACTIVE },
            data: { status: UserPackageStatus.CANCELLED },
          })
          const expireAt = this.addUtcMonths(now, months)
          await tx.userPackage.create({ data: {
            userId: uid, packageId: order.packageId, startAt: now, expireAt,
            trafficQuota: trafficGrant, requestQuota: requestGrant, orderId: order.id,
            status: UserPackageStatus.ACTIVE,
          } })
          await tx.user.update({ where: { id: uid }, data: { packageId: order.packageId, packageExpireAt: expireAt } })
        }
        await tx.order.update({ where: { id: order.id }, data: {
          packageSnapshot: { ...terms, entitlement: rollback } as Prisma.InputJsonValue,
        } })
      }
      return { id: order.id.toString(), orderNo: order.orderNo, status: OrderStatus.PAID,
        payChannel: channel, payAt: now, mock: true }
    })
    return result
  }

  async cancelOrder(userId: string, id: string) {
    const uid = BigInt(userId)
    const orderId = BigInt(id)
    return this.prisma.$transaction(async (tx) => {
      await this.lockUser(tx, uid)
      const order = await tx.order.findFirst({ where: { id: orderId, userId: uid } })
      if (!order) throw new BusinessException(ErrorCode.RECORD_NOT_FOUND)
      if (order.status === OrderStatus.CANCELLED) return { id: id, status: order.status }
      if (order.status !== OrderStatus.PENDING) {
        throw new BusinessException(ErrorCode.PARAM_INVALID, '订单状态不允许取消')
      }
      const changed = await tx.order.updateMany({
        where: { id: orderId, userId: uid, status: OrderStatus.PENDING },
        data: { status: OrderStatus.CANCELLED },
      })
      if (changed.count !== 1) throw new BusinessException(ErrorCode.PARAM_INVALID, '订单状态已变更')
      return { id, status: OrderStatus.CANCELLED }
    })
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
    const orderId = BigInt(id)
    const seed = await this.prisma.order.findUnique({ where: { id: orderId } })
    if (!seed) throw new BusinessException(ErrorCode.RECORD_NOT_FOUND)
    const result = await this.prisma.$transaction(async (tx) => {
      await this.lockUser(tx, seed.userId)
      const order = await tx.order.findUnique({ where: { id: orderId } })
      if (order?.status === OrderStatus.REFUNDED) return { id, status: order.status }
      if (!order || order.status !== OrderStatus.PAID) {
        throw new BusinessException(ErrorCode.PARAM_INVALID, '订单状态不允许退款')
      }
      const snapshot = this.asRecord(order.packageSnapshot)
      const entitlement = this.asRecord(snapshot?.entitlement)
      if (order.packageId && !entitlement) {
        throw new BusinessException(ErrorCode.PARAM_INVALID, '该订单缺少可验证的权益记录，不能安全退款')
      }
      if (order.packageId && entitlement) {
        const userPackage = await tx.userPackage.findUnique({ where: { orderId } })
        if (!userPackage || userPackage.orderId !== orderId) {
          throw new BusinessException(ErrorCode.PARAM_INVALID, '权益已被后续订单覆盖，不能安全退款')
        }
        if (entitlement.mode === 'renew') {
          if (userPackage.trafficUsed > BigInt(String(entitlement.previousTrafficQuota)) ||
              userPackage.requestUsed > BigInt(String(entitlement.previousRequestQuota))) {
            throw new BusinessException(ErrorCode.PARAM_INVALID, '续费额度已使用，不能安全退款')
          }
          await tx.userPackage.update({ where: { id: userPackage.id }, data: {
            expireAt: new Date(String(entitlement.previousExpireAt)),
            trafficQuota: BigInt(String(entitlement.previousTrafficQuota)),
            requestQuota: BigInt(String(entitlement.previousRequestQuota)),
            orderId: entitlement.previousOrderId == null ? null : BigInt(String(entitlement.previousOrderId)),
          } })
          await tx.user.update({ where: { id: order.userId }, data: {
            packageId: userPackage.packageId,
            packageExpireAt: new Date(String(entitlement.previousExpireAt)),
          } })
        } else if (entitlement.mode === 'switch') {
          if (userPackage.trafficUsed > 0n || userPackage.requestUsed > 0n) {
            throw new BusinessException(ErrorCode.PARAM_INVALID, '切换套餐权益已使用，不能安全退款')
          }
          await tx.userPackage.update({ where: { id: userPackage.id }, data: { status: UserPackageStatus.CANCELLED } })
          const previousIds = Array.isArray(entitlement.previousActiveIds)
            ? entitlement.previousActiveIds.map((x) => BigInt(String(x))) : []
          if (previousIds.length) {
            await tx.userPackage.updateMany({
              where: { id: { in: previousIds }, userId: order.userId, expireAt: { gt: new Date() } },
              data: { status: UserPackageStatus.ACTIVE },
            })
          }
          const previousExpireAt = entitlement.previousUserExpireAt == null
            ? null : new Date(String(entitlement.previousUserExpireAt))
          const restorePrevious = previousExpireAt !== null && previousExpireAt > new Date()
          await tx.user.update({ where: { id: order.userId }, data: {
            packageId: restorePrevious && entitlement.previousPackageId != null
              ? BigInt(String(entitlement.previousPackageId)) : null,
            packageExpireAt: restorePrevious ? previousExpireAt : null,
          } })
        } else {
          if (userPackage.trafficUsed > 0n || userPackage.requestUsed > 0n) {
            throw new BusinessException(ErrorCode.PARAM_INVALID, '套餐权益已使用，不能安全退款')
          }
          await tx.userPackage.update({ where: { id: userPackage.id }, data: { status: UserPackageStatus.CANCELLED } })
          await tx.user.update({ where: { id: order.userId }, data: { packageId: null, packageExpireAt: null } })
        }
      }
      const changed = await tx.order.updateMany({
        where: { id: orderId, status: OrderStatus.PAID }, data: { status: OrderStatus.REFUNDED },
      })
      if (changed.count !== 1) throw new BusinessException(ErrorCode.PARAM_INVALID, '订单状态已变更')
      await tx.payment.updateMany({
        where: { orderId, status: PaymentStatus.SUCCESS }, data: { status: PaymentStatus.REFUNDED },
      })
      // Mock payments have no cash settlement; never manufacture a balance credit.
      return { id, status: OrderStatus.REFUNDED }
    })
    return result
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

  private periodMonths(period: number): number {
    if (period === PackagePeriod.QUARTER) return 3
    if (period === PackagePeriod.YEAR) return 12
    return 1
  }

  /** Calendar arithmetic in UTC, clipping (not rolling) dates at month ends. */
  private addUtcMonths(start: Date, months: number): Date {
    const date = new Date(start)
    const day = date.getUTCDate()
    date.setUTCDate(1)
    date.setUTCMonth(date.getUTCMonth() + months)
    const lastDay = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0)).getUTCDate()
    date.setUTCDate(Math.min(day, lastDay))
    return date
  }

  private async lockUser(tx: Prisma.TransactionClient, userId: bigint): Promise<void> {
    await tx.$queryRaw(Prisma.sql`SELECT id FROM users WHERE id = ${userId} FOR UPDATE`)
  }

  private asRecord(value: unknown): Record<string, unknown> | null {
    return value !== null && typeof value === 'object' && !Array.isArray(value)
      ? value as Record<string, unknown> : null
  }

  private readPackageSnapshot(value: unknown, pkg: OrderWithPackage['package']) {
    const saved = this.asRecord(value)
    return {
      period: Number(saved?.period ?? pkg?.period ?? PackagePeriod.MONTH),
      quantity: Number(saved?.quantity ?? 1),
      trafficQuota: String(saved?.trafficQuota ?? pkg?.trafficQuota ?? 0),
      requestQuota: String(saved?.requestQuota ?? pkg?.requestQuota ?? 0),
      packageName: String(saved?.packageName ?? pkg?.name ?? ''),
      legacy: saved?.legacy === true,
    }
  }

  private toOrderVo(order: OrderWithPackage) {
    return {
      id: order.id.toString(),
      orderNo: order.orderNo,
      userId: order.userId.toString(),
      packageId: order.packageId?.toString() ?? null,
      packageName: this.asRecord(order.packageSnapshot)?.packageName as string ?? order.package?.name ?? null,
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

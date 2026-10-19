const { test } = require('node:test')
const assert = require('node:assert/strict')
const { Prisma } = require('@prisma/client')
const { OrderService } = require('../dist/modules/order/order.service.js')
const { UserService } = require('../dist/modules/user/user.service.js')

const STATUS = { PENDING: 1, PAID: 2, CANCELLED: 3, REFUNDED: 4, ACTIVE: 1, INACTIVE: 2 }

function makeOrderDb(overrides = {}) {
  const pkg = {
    id: 7n, name: 'starter', code: 'starter', period: 1, price: new Prisma.Decimal('10.00'),
    trafficQuota: 1000n, requestQuota: 2000n, bandwidthLimit: 50, domainLimit: 3,
    featureFlags: null, overQuotaPolicy: 1, status: 1,
  }
  const state = {
    order: {
      id: 9n, orderNo: 'ORD-9', userId: 1n, packageId: 7n,
      amount: new Prisma.Decimal('20.00'), discount: new Prisma.Decimal('0'),
      finalAmount: new Prisma.Decimal('20.00'), status: STATUS.PENDING,
      payChannel: null, payAt: null, package: pkg,
      packageSnapshot: { packageName: 'starter', period: 1, quantity: 2,
        trafficQuota: '1000', requestQuota: '2000' }, items: [], payments: [],
      ...overrides.order,
    },
    package: pkg,
    payments: [],
    userPackage: overrides.userPackage ?? null,
    user: { id: 1n, packageId: null, packageExpireAt: null, balance: new Prisma.Decimal('0.00') },
    balance: new Prisma.Decimal('0.00'),
  }
  const tx = {
    $queryRaw: async () => [],
    order: {
      findFirst: async () => state.order,
      findUnique: async () => state.order,
      updateMany: async ({ where, data }) => {
        if (state.order.status !== where.status) return { count: 0 }
        Object.assign(state.order, data); return { count: 1 }
      },
      update: async ({ data }) => { Object.assign(state.order, data); return state.order },
    },
    payment: {
      create: async ({ data }) => { state.payments.push({ ...data }); return data },
      updateMany: async ({ data }) => {
        state.payments.forEach((p) => { if (p.status === 2) p.status = data.status })
        return { count: state.payments.length }
      },
    },
    userPackage: {
      findFirst: async ({ where }) => state.userPackage && state.userPackage.status === where.status &&
        state.userPackage.expireAt > new Date() ? state.userPackage : null,
      findMany: async () => state.userPackage ? [state.userPackage] : [],
      findUnique: async () => state.userPackage,
      create: async ({ data }) => {
        state.userPackage = { id: 55n, trafficUsed: 0n, requestUsed: 0n, ...data }
        return state.userPackage
      },
      update: async ({ data }) => { Object.assign(state.userPackage, data); return state.userPackage },
      updateMany: async ({ data }) => {
        if (state.userPackage) Object.assign(state.userPackage, data)
        return { count: state.userPackage ? 1 : 0 }
      },
    },
    user: {
      findUniqueOrThrow: async () => state.user,
      update: async ({ data }) => { Object.assign(state.user, data); return state.user },
    },
  }
  const prisma = {
    ...tx,
    package: { findFirst: async () => pkg },
    order: {
      ...tx.order,
      findUnique: async ({ where }) => where.orderNo ? null : state.order,
      create: async ({ data }) => ({
        ...data, id: 10n, createdAt: new Date(), package: pkg,
        items: [{ id: 1n, ...data.items.create[0] }], payments: [],
      }),
    },
    $transaction: async (arg) => typeof arg === 'function' ? arg(tx) : arg,
  }
  return { prisma, state }
}

test('UTC expiry clips month ends while preserving UTC time', () => {
  const service = new OrderService({})
  assert.equal(service.addUtcMonths(new Date('2025-01-31T23:30:00.000Z'), 1).toISOString(),
    '2025-02-28T23:30:00.000Z')
  assert.equal(service.addUtcMonths(new Date('2024-01-31T23:30:00.000Z'), 1).toISOString(),
    '2024-02-29T23:30:00.000Z')
  assert.equal(service.addUtcMonths(new Date('2025-01-31T23:30:00.000Z'), 3).toISOString(),
    '2025-04-30T23:30:00.000Z')
})

test('order creation snapshots package terms and validates 1..120 quantity', async () => {
  const { prisma } = makeOrderDb()
  const service = new OrderService(prisma)
  const order = await service.createOrder('1', '7', 2)
  assert.equal(order.items[0].quantity, 2)
  assert.equal(order.items[0].subtotal, '20.00')
  assert.equal(order.packageName, 'starter')
  await assert.rejects(() => service.createOrder('1', '7', 121))
  await assert.rejects(() => service.createOrder('1', '7', 0))
})

test('mock pay is idempotent and quantity two grants two cycles without charging balance', async () => {
  const { prisma, state } = makeOrderDb()
  const service = new OrderService(prisma)
  const once = await service.payOrder('1', '9', 'sandbox')
  const twice = await service.payOrder('1', '9', 'sandbox')
  assert.equal(once.status, STATUS.PAID)
  assert.equal(twice.status, STATUS.PAID)
  assert.equal(once.mock, true)
  assert.equal(state.payments.length, 1)
  assert.equal(state.payments[0].channel, 'mock')
  assert.deepEqual(state.payments[0].callbackData, { mock: true, charged: false })
  assert.equal(state.userPackage.trafficQuota, 2000n)
  assert.equal(state.userPackage.requestQuota, 4000n)
  assert.equal(state.userPackage.expireAt.toISOString(), service.addUtcMonths(state.userPackage.startAt, 2).toISOString())
  assert.equal(state.user.balance.toFixed(2), '0.00')
})

test('cancel repeats idempotently and cancelled order cannot be paid', async () => {
  const { prisma, state } = makeOrderDb()
  const service = new OrderService(prisma)
  assert.deepEqual(await service.cancelOrder('1', '9'), { id: '9', status: STATUS.CANCELLED })
  assert.deepEqual(await service.cancelOrder('1', '9'), { id: '9', status: STATUS.CANCELLED })
  await assert.rejects(() => service.payOrder('1', '9', 'sandbox'))
  assert.equal(state.payments.length, 0)
})

test('same-package renewal extends from existing expiry and preserves consumed usage', async () => {
  const oldExpire = new Date(Date.now() + 30 * 86400000)
  const record = { id: 55n, userId: 1n, packageId: 7n, status: STATUS.ACTIVE, startAt: new Date(),
    expireAt: oldExpire, trafficUsed: 400n, requestUsed: 77n, trafficQuota: 1000n,
    requestQuota: 2000n, orderId: 8n }
  const { prisma, state } = makeOrderDb({ userPackage: record })
  state.userPackage = record
  const service = new OrderService(prisma)
  await service.payOrder('1', '9', 'sandbox')
  assert.equal(state.userPackage.expireAt.toISOString(), service.addUtcMonths(oldExpire, 2).toISOString())
  assert.equal(state.userPackage.trafficUsed, 400n)
  assert.equal(state.userPackage.requestUsed, 77n)
  assert.equal(state.userPackage.trafficQuota, 3000n)
  assert.equal(state.userPackage.requestQuota, 6000n)
})

test('renewal keeps usage, extends the prior expiry, and refuses unsafe refund after added quota use', async () => {
  const expiry = new Date(Date.now() + 30 * 86400000)
  const record = { id: 55n, userId: 1n, packageId: 7n, status: STATUS.ACTIVE, startAt: new Date(),
    expireAt: expiry, trafficUsed: 1500n, requestUsed: 50n, trafficQuota: 2000n, requestQuota: 500n,
    orderId: 9n }
  const { prisma, state } = makeOrderDb({ userPackage: record,
    order: { status: STATUS.PAID, packageSnapshot: { period: 1, quantity: 1,
      entitlement: { mode: 'renew', previousExpireAt: expiry.toISOString(), previousTrafficQuota: '1000',
        previousRequestQuota: '500', previousOrderId: '8' } } } })
  state.userPackage = record
  state.order.packageSnapshot.entitlement.previousExpireAt = expiry.toISOString()
  const service = new OrderService(prisma)
  await assert.rejects(() => service.adminRefundOrder('9'), /额度已使用/)
  assert.equal(state.order.status, STATUS.PAID)
})

test('safe renewal refund restores prior quota/order and repeated refund is idempotent', async () => {
  const expiry = new Date(Date.now() + 30 * 86400000)
  const record = { id: 55n, userId: 1n, packageId: 7n, status: STATUS.ACTIVE, startAt: new Date(),
    expireAt: new Date(Date.now() + 60 * 86400000), trafficUsed: 100n, requestUsed: 20n,
    trafficQuota: 2000n, requestQuota: 1000n, orderId: 9n }
  const { prisma, state } = makeOrderDb({ userPackage: record,
    order: { status: STATUS.PAID, packageSnapshot: { period: 1, quantity: 1,
      entitlement: { mode: 'renew', previousExpireAt: expiry.toISOString(), previousTrafficQuota: '1000',
        previousRequestQuota: '500', previousOrderId: '8' } } } })
  state.userPackage = record
  const service = new OrderService(prisma)
  assert.deepEqual(await service.adminRefundOrder('9'), { id: '9', status: STATUS.REFUNDED })
  assert.equal(state.userPackage.trafficQuota, 1000n)
  assert.equal(state.userPackage.orderId, 8n)
  assert.equal(state.userPackage.expireAt.toISOString(), expiry.toISOString())
  assert.equal((await service.adminRefundOrder('9')).status, STATUS.REFUNDED)
})

test('balance adjustments use exact decimal arithmetic and write both ledgers', async () => {
  const state = { user: { id: 1n, balance: new Prisma.Decimal('1.00'), deletedAt: null },
    balances: [], transactions: [] }
  const tx = {
    $queryRaw: async () => [],
    user: {
      findFirst: async () => state.user,
      update: async ({ data }) => { Object.assign(state.user, data); return state.user },
    },
    userBalance: { create: async ({ data }) => { state.balances.push(data); return data } },
    transaction: { create: async ({ data }) => { state.transactions.push(data); return data } },
  }
  const prisma = { $transaction: async (fn) => fn(tx) }
  const service = new UserService(prisma, null, null)
  for (let i = 0; i < 10; i += 1) await service.adminAdjustBalance('1', '2', 0.01)
  for (let i = 0; i < 3; i += 1) await service.adminAdjustBalance('1', '2', -0.06)
  assert.equal(state.user.balance.toFixed(2), '0.92')
  assert.equal(state.balances.length, 13)
  assert.equal(state.transactions.length, 13)
  assert.equal(state.transactions.at(-1).type, 2)
  assert.equal(state.transactions.at(-1).amount.toFixed(2), '0.06')
})

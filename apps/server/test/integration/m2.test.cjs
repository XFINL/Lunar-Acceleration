const { test, before, after } = require('node:test')
const assert = require('node:assert/strict')
const { PrismaClient, Prisma } = require('@prisma/client')
const { OrderService } = require('../../dist/modules/order/order.service')
const { PackageService } = require('../../dist/modules/package/package.service')
const { UserService } = require('../../dist/modules/user/user.service')
const { SettingService } = require('../../dist/modules/setting/setting.service')

// Refuse to mutate any database not explicitly named as a disposable test database.
const enabled = process.env.DATABASE_URL && new URL(process.env.DATABASE_URL).pathname.endsWith('_test')
const integration = enabled ? test : test.skip
let db, billing, packages, users, settings, user, other, pkg
const suffix = `${Date.now()}_${process.pid}`
before(async () => {
  if (!enabled) return
  db = new PrismaClient()
  await db.$connect()
  billing = new OrderService(db)
  packages = new PackageService(db)
  users = new UserService(db, { invalidateUserPermissions: async () => {} })
  settings = new SettingService(db)
  user = await db.user.create({ data: { username: `it_${suffix}`, passwordHash: 'fixture-not-login' } })
  other = await db.user.create({ data: { username: `other_${suffix}`, passwordHash: 'fixture-not-login' } })
  pkg = await db.package.create({ data: {
    name: 'Integration plan', code: `it_${suffix}`, accessType: 1, price: new Prisma.Decimal('10.01'),
    period: 1, domainLimit: 2, trafficQuota: 1000000n,
  } })
})
after(async () => {
  if (!db) return
  // Keep fixtures for diagnosis in this disposable database; never reset or truncate user data.
  await db.$disconnect()
})

integration('M2: anonymous configuration denies private groups and excludes private keys', async () => {
  for (const group of ['email', 'sms', 'oauth', 'payment', 'security', 'api', 'unknown']) {
    await assert.rejects(() => settings.getPublicSiteConfig(group))
  }
  const publicConfig = await settings.getPublicSiteConfig('maintenance')
  assert.ok(!('whitelistIps' in publicConfig))
  const groups = new Set((await settings.getSiteConfigs()).map(x => x.groupKey))
  for (const group of ['basic','seo','theme','nav','home','auth','email','sms','oauth','payment','service','notice','i18n','agreement','maintenance','api','security','analytics']) {
    assert.ok(groups.has(group), `missing group: ${group}`)
  }
})

integration('M2: configuration updates validate all inputs before committing', async () => {
  const original = await settings.getPublicSiteConfig('basic')
  await assert.rejects(() => settings.updateSiteConfigGroup('basic', [
    { configKey: 'siteName', configValue: 'MUST NOT COMMIT' },
    { configKey: 'unknownKey', configValue: 'invalid' },
  ]))
  assert.equal((await settings.getPublicSiteConfig('basic')).siteName, original.siteName)
  await assert.rejects(() => settings.updateSiteConfigGroup('email', [{configKey:'port',configValue:-1}]))
})

integration('M2: simultaneous payment of one order creates one payment and entitlement', async () => {
  const order = await billing.createOrder(user.id.toString(), pkg.id.toString(), 2)
  assert.equal(order.finalAmount, '20.02')
  const outcomes = await Promise.allSettled(Array.from({length: 8}, () => billing.payOrder(user.id.toString(), order.id, 'stripe')))
  assert.ok(outcomes.some(x => x.status === 'fulfilled'))
  assert.equal(await db.payment.count({where:{orderId:BigInt(order.id)}}), 1)
  assert.equal(await db.userPackage.count({where:{userId:user.id,status:1}}), 1)
  const current = await packages.getMyPackage(user.id.toString())
  const start = new Date(current.startAt), end = new Date(current.expireAt)
  assert.ok(end.getTime() - start.getTime() > 50 * 86400000, 'two periods must provide two months')
  await assert.rejects(() => billing.getUserOrderDetail(other.id.toString(), order.id))
})

integration('M2: same-plan renewal extends expiry and preserves usage', async () => {
  const before = await packages.getMyPackage(user.id.toString())
  await db.userPackage.update({where:{id:BigInt(before.id)},data:{trafficUsed:123n,requestUsed:7n}})
  const order = await billing.createOrder(user.id.toString(), pkg.id.toString(), 1)
  await billing.payOrder(user.id.toString(), order.id, 'stripe')
  const current = await packages.getMyPackage(user.id.toString())
  assert.ok(new Date(current.expireAt) > new Date(before.expireAt))
  assert.equal(current.trafficUsed, '123')
  assert.equal(current.requestUsed, '7')
  const u = await db.user.findUnique({where:{id:user.id}})
  assert.equal(u.packageExpireAt.toISOString(), new Date(current.expireAt).toISOString())
  assert.equal(await db.userPackage.count({where:{userId:user.id,status:1}}), 1)
})

integration('M2: payment versus cancellation never leaves a cancelled order with a payment', async () => {
  const order = await billing.createOrder(other.id.toString(), pkg.id.toString(), 1)
  await Promise.allSettled([
    billing.payOrder(other.id.toString(), order.id, 'wechat'),
    billing.cancelOrder(other.id.toString(), order.id),
  ])
  const state = await db.order.findUnique({where:{id:BigInt(order.id)}})
  const payments = await db.payment.count({where:{orderId:state.id}})
  assert.ok((state.status === 2 && payments === 1) || (state.status === 3 && payments === 0))
})

integration('M2: concurrent decimal balance adjustments do not lose writes or overdraft', async () => {
  await Promise.all(Array.from({length:10}, () => users.adminAdjustBalance(other.id.toString(), user.id.toString(), 0.01, 'integration credit')))
  let row = await db.user.findUnique({where:{id:other.id}})
  assert.equal(row.balance.toFixed(2), '0.10')
  const outcomes = await Promise.allSettled(Array.from({length:3}, () => users.adminAdjustBalance(other.id.toString(), user.id.toString(), -0.06, 'integration debit')))
  assert.equal(outcomes.filter(x => x.status === 'fulfilled').length, 1)
  row = await db.user.findUnique({where:{id:other.id}})
  assert.equal(row.balance.toFixed(2), '0.04')
  assert.equal(await db.userBalance.count({where:{userId:other.id}}),11)
  assert.equal(await db.transaction.count({where:{userId:other.id,refType:'admin_adjust'}}),11)
})

integration('M2: secrets are encrypted at rest, masked for admins and recoverable only internally', async () => {
  const secureSettings = new SettingService(db, {get:()=>({encryptionKey:'integration-only-settings-encryption-key'})})
  const where = {uk_group_key:{groupKey:'oauth',configKey:'clientSecret'}}
  const original = await db.siteConfig.findUnique({where})
  const secret = `private-fixture-${suffix}`
  try {
    await secureSettings.updateSiteConfigGroup('oauth',[{configKey:'clientSecret',configValue:secret}])
    const stored = await db.siteConfig.findUnique({where})
    assert.ok(stored.configValue.startsWith('enc:v1:'))
    assert.notEqual(stored.configValue,secret)
    const admin = await secureSettings.getSiteConfigGroup('oauth')
    assert.equal(admin.find(x=>x.configKey==='clientSecret').configValue,'********')
    assert.equal((await secureSettings.getInternalSiteConfigGroup('oauth')).clientSecret,secret)
    await secureSettings.updateSiteConfigGroup('oauth',[{configKey:'clientSecret',configValue:'********'}])
    await secureSettings.updateSiteConfigGroup('oauth',[{configKey:'clientSecret',configValue:''}])
    assert.equal((await db.siteConfig.findUnique({where})).configValue,stored.configValue)
  } finally {
    if (original) await db.siteConfig.update({where,data:{configValue:original.configValue,updatedAt:original.updatedAt}})
    else await db.siteConfig.deleteMany({where:{groupKey:'oauth',configKey:'clientSecret'}})
  }
})

integration('M2: concurrent refunds restore the exact prior renewal entitlement without creating money', async () => {
  // The earlier renewal test deliberately writes request usage despite this fixture's zero request allowance.
  await db.userPackage.updateMany({where:{userId:user.id,status:1},data:{requestUsed:0n}})
  const previous = await packages.getMyPackage(user.id.toString())
  const order = await billing.createOrder(user.id.toString(),pkg.id.toString(),1)
  await billing.payOrder(user.id.toString(),order.id,'stripe')
  const balanceBefore = (await db.user.findUnique({where:{id:user.id}})).balance.toFixed(2)
  const results = await Promise.allSettled(Array.from({length:4},()=>billing.adminRefundOrder(order.id)))
  assert.ok(results.every(x=>x.status==='fulfilled'), results.filter(x=>x.status==='rejected').map(x=>x.reason?.message).join('; '))
  const restored = await packages.getMyPackage(user.id.toString())
  assert.equal(new Date(restored.expireAt).toISOString(),new Date(previous.expireAt).toISOString())
  assert.equal(restored.trafficQuota,previous.trafficQuota)
  assert.equal(restored.trafficUsed,previous.trafficUsed)
  assert.equal((await db.order.findUnique({where:{id:BigInt(order.id)}})).status,4)
  assert.equal((await db.user.findUnique({where:{id:user.id}})).balance.toFixed(2),balanceBefore)
  assert.equal(await db.transaction.count({where:{userId:user.id,refId:BigInt(order.id)}}),0)
})

integration('M2: refund refuses to remove already-consumed additional quota', async () => {
  const previous = await packages.getMyPackage(user.id.toString())
  const order = await billing.createOrder(user.id.toString(),pkg.id.toString(),1)
  await billing.payOrder(user.id.toString(),order.id,'stripe')
  await db.userPackage.update({where:{id:BigInt(previous.id)},data:{trafficUsed:BigInt(previous.trafficQuota)+1n}})
  await assert.rejects(()=>billing.adminRefundOrder(order.id))
  assert.equal((await db.order.findUnique({where:{id:BigInt(order.id)}})).status,2)
})

const { test, before, after } = require('node:test')
const assert = require('node:assert/strict')
require('reflect-metadata')
const dns = require('node:dns/promises')
const originalResolveCname = dns.resolveCname
const dnsAnswers = new Map()
dns.resolveCname = async (hostname) => dnsAnswers.get(hostname) || []
const { NestFactory } = require('@nestjs/core')
const { ValidationPipe } = require('@nestjs/common')
const { JwtService } = require('@nestjs/jwt')
const { AppModule } = require('../../dist/app.module')
const { PrismaService } = require('../../dist/database/prisma.service')
const { PackageService } = require('../../dist/modules/package/package.service')

const enabled = process.env.DATABASE_URL && new URL(process.env.DATABASE_URL).pathname.endsWith('_test')
const integration = enabled ? test : test.skip
const suffix = `${Date.now()}${process.pid}`
let app, base, db, token, otherToken, limitedToken, user, otherUser, packageRow, limitedUser, limitedRole
const jwt = new JwtService()
const sign = (u) => jwt.sign({ sub: u.id.toString(), username: u.username, roleType: u.roleType }, { secret: process.env.JWT_SECRET || 'dev_access_secret', expiresIn: '10m' })
async function call(path, method = 'GET', body, auth = token) {
  const response = await fetch(`${base}${path}`, { method, headers: { 'Content-Type': 'application/json', ...(auth ? { Authorization: `Bearer ${auth}` } : {}) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) })
  const payload = await response.json()
  return { status: response.status, ...payload }
}
function ok(payload) { assert.equal(payload.code, 0, JSON.stringify(payload)); return payload.data }
function rejected(payload) { assert.notEqual(payload.code, 0, JSON.stringify(payload)); assert.notEqual(payload.code, 50001, 'invalid input or isolation must not become internal errors'); return payload }

before(async () => {
  if (!enabled) return
  process.env.CNAME_SUFFIX = `edge${suffix}.example.test`
  app = await NestFactory.create(AppModule, { logger: false })
  app.setGlobalPrefix('api/v1')
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true, transformOptions: { enableImplicitConversion: true } }))
  await app.listen(0, '127.0.0.1')
  base = `${await app.getUrl()}/api/v1`
  db = app.get(PrismaService)
  user = await db.user.create({ data: { username: `m3dc_${suffix}`, passwordHash: 'fixture', roleType: 1 } })
  otherUser = await db.user.create({ data: { username: `m3dco_${suffix}`, passwordHash: 'fixture', roleType: 1 } })
  const userRole = await db.role.findUniqueOrThrow({ where: { code: 'user' } })
  await db.userRole.createMany({ data: [{ userId: user.id, roleId: userRole.id }, { userId: otherUser.id, roleId: userRole.id }] })
  token = sign(user); otherToken = sign(otherUser)
  packageRow = await db.package.create({ data: { name: 'M3 domain-complete test', code: `m3dc_${suffix}`, accessType: 1, period: 1, price: '1.00', domainLimit: 30, trafficQuota: 1000000n } })
  await new PackageService(db).assignPackage(user.id.toString(), packageRow.id.toString())

  limitedUser = await db.user.create({ data: { username: `m3dcl_${suffix}`, passwordHash: 'fixture', roleType: 1 } })
  limitedRole = await db.role.create({ data: { name: `M3 update only ${suffix}`, code: `m3dc_update_${suffix}`, isSystem: 0 } })
  const updatePermission = await db.permission.findUniqueOrThrow({ where: { code: 'domain:update' } })
  await db.userRole.create({ data: { userId: limitedUser.id, roleId: limitedRole.id } })
  await db.rolePermission.create({ data: { roleId: limitedRole.id, permissionId: updatePermission.id } })
  limitedToken = sign(limitedUser)
})
after(async () => {
  if (app) {
    if (db) {
      await db.domain.deleteMany({ where: { userId: { in: [user?.id, otherUser?.id, limitedUser?.id].filter(Boolean) } } }).catch(() => {})
      await db.certificate.deleteMany({ where: { userId: { in: [user?.id, otherUser?.id, limitedUser?.id].filter(Boolean) } } }).catch(() => {})
      await db.userPackage.deleteMany({ where: { userId: { in: [user?.id, otherUser?.id, limitedUser?.id].filter(Boolean) } } }).catch(() => {})
      await db.userRole.deleteMany({ where: { userId: { in: [user?.id, otherUser?.id, limitedUser?.id].filter(Boolean) } } }).catch(() => {})
      if (limitedRole) await db.role.delete({ where: { id: limitedRole.id } }).catch(() => {})
      if (packageRow) await db.package.delete({ where: { id: packageRow.id } }).catch(() => {})
      await db.user.deleteMany({ where: { id: { in: [user?.id, otherUser?.id, limitedUser?.id].filter(Boolean) } } }).catch(() => {})
    }
    await app.close()
  }
  dns.resolveCname = originalResolveCname
})

integration('M3 domain completion: documented originGroup/tags and safe filters work over HTTP', async () => {
  const hostname = `create${suffix}.example.com`
  const created = ok(await call('/user/domains', 'POST', {
    domain: hostname, businessType: '网站', tags: ['fixture', 'web'], remark: 'creation fixture',
    originGroup: { name: 'primary', lbPolicy: 2, origins: [{ address: 'Origin.Example.com.', port: 8080, weight: 3, protocol: 'https', host: 'cdn.example.com' }] },
  }))
  assert.equal(created.businessType, '网站')
  assert.deepEqual(created.tags, ['fixture', 'web'])
  const group = await db.originGroup.findFirstOrThrow({ where: { domainId: BigInt(created.id) }, include: { origins: true } })
  assert.equal(group.lbPolicy, 'weighted')
  assert.equal(group.origins.length, 1)
  assert.equal(group.origins[0].address, 'origin.example.com')
  assert.equal(group.origins[0].weight, 3)
  ok(await call(`/user/domains/${created.id}`, 'PUT', { tags: ['updated'], businessType: 'download' }))
  const detail = ok(await call(`/user/domains/${created.id}`))
  assert.deepEqual(detail.tags, ['updated'])
  const listed = ok(await call(`/user/domains?keyword=${hostname}&status=1&sort=domain&order=asc`))
  assert.equal(listed.list.length, 1)
  assert.equal(listed.list[0].id, created.id)
  rejected(await call('/user/domains', 'POST', { domain: `unsafe${suffix}.example.com`, originGroup: { name: 'bad', origins: [{ address: 'http://127.0.0.1/private', port: 80, weight: 1, protocol: 'http' }] } }))
})

integration('M3 domain completion: check aliases expose stable fields and batch checks stay network-free', async () => {
  const hostname = `check${suffix}.example.com`
  const created = ok(await call('/user/domains', 'POST', { domain: hostname }))
  dnsAnswers.set(hostname, [created.cname])
  const check = ok(await call(`/user/domains/${created.id}/check`, 'POST', {}))
  assert.equal(check.expectedCname, created.cname)
  assert.deepEqual(check.observedCnames, [created.cname])
  assert.equal(check.matched, true)
  assert.ok(check.checkedAt)
  assert.deepEqual(check.answers, check.observedCnames)
  assert.ok(check.observedAt)
  const alias = ok(await call(`/user/domains/${created.id}/dns-check`, 'POST', {}))
  assert.equal(alias.matched, true)
  const batch = ok(await call('/user/domains/batch', 'POST', { action: 'check', ids: [created.id] }))
  assert.equal(batch.length, 1)
  assert.equal(batch[0].status, 'successful')
  assert.equal(batch[0].result.matched, true)
  rejected(await call('/user/domains/batch', 'POST', { action: 'check', ids: [created.id, created.id] }))
})

integration('M3 domain completion: batch preflight prevents cross-tenant partial updates and action permissions are distinct', async () => {
  const owned = await db.domain.create({ data: { userId: user.id, domain: `owned${suffix}.example.com`, cname: `owned.${suffix}.edge.test`, accessType: 1, status: 1, auditStatus: 1, config: { create: {} } } })
  const foreign = await db.domain.create({ data: { userId: otherUser.id, domain: `foreign${suffix}.example.com`, cname: `foreign.${suffix}.edge.test`, accessType: 1, status: 1, auditStatus: 1, config: { create: {} } } })
  rejected(await call('/user/domains/batch', 'POST', { action: 'disable', ids: [owned.id.toString(), foreign.id.toString()] }))
  assert.equal((await db.domain.findUniqueOrThrow({ where: { id: owned.id } })).status, 1, 'a cross-tenant preflight failure must not partially disable the owned item')

  const limitedDomain = await db.domain.create({ data: { userId: limitedUser.id, domain: `limited${suffix}.example.com`, cname: `limited.${suffix}.edge.test`, accessType: 1, status: 1, auditStatus: 1, config: { create: {} } } })
  const denied = ok(await call('/user/domains/batch', 'POST', { action: 'delete', ids: [limitedDomain.id.toString()] }, limitedToken))
  assert.equal(denied[0].status, 'failed')
  assert.equal(denied[0].code, 40301)
  assert.equal((await db.domain.findUniqueOrThrow({ where: { id: limitedDomain.id } })).deletedAt, null)
  const allowed = ok(await call('/user/domains/batch', 'POST', { action: 'disable', ids: [limitedDomain.id.toString()] }, limitedToken))
  assert.equal(allowed[0].status, 'successful')
  assert.equal((await db.domain.findUniqueOrThrow({ where: { id: limitedDomain.id } })).status, 4)
})

integration('M3 domain completion: delete clears HTTPS/certificate bindings and batch results are explicit', async () => {
  const domain = await db.domain.create({ data: { userId: user.id, domain: `delete${suffix}.example.com`, cname: `delete.${suffix}.edge.test`, accessType: 1, status: 1, auditStatus: 1, config: { create: {} } } })
  const certificate = await db.certificate.create({ data: { userId: user.id, name: `fixture ${suffix}`, certPem: 'fixture certificate', keyPem: 'fixture private key', issuer: 'fixture', notBefore: new Date(Date.now() - 1000), notAfter: new Date(Date.now() + 86400000) } })
  await db.domainConfig.update({ where: { domainId: domain.id }, data: { certId: certificate.id, httpsEnabled: true, forceHttps: true, hstsEnabled: true } })
  const rows = ok(await call('/user/domains/batch', 'POST', { action: 'delete', ids: [domain.id.toString()] }))
  assert.deepEqual(rows.map((row) => row.status), ['successful'])
  const deleted = await db.domain.findUniqueOrThrow({ where: { id: domain.id }, include: { config: true } })
  assert.equal(deleted.status, 6)
  assert.ok(deleted.deletedAt)
  assert.equal(deleted.config.httpsEnabled, false)
  assert.equal(deleted.config.forceHttps, false)
  assert.equal(deleted.config.hstsEnabled, false)
  assert.equal(deleted.config.certId, null)
  assert.equal(await db.domainConfig.count({ where: { certId: certificate.id } }), 0)
  const invalidAction = rejected(await call('/user/domains/batch', 'POST', { action: 'enable', ids: [domain.id.toString()] }))
  assert.notEqual(invalidAction.code, 0)
})

const { test, before, after } = require('node:test')
const assert = require('node:assert/strict')
require('reflect-metadata')
const { NestFactory } = require('@nestjs/core')
const { ValidationPipe } = require('@nestjs/common')
const { ConfigService } = require('@nestjs/config')
const { JwtService } = require('@nestjs/jwt')
const { AppModule } = require('../../dist/app.module')
const { PrismaService } = require('../../dist/database/prisma.service')
const { DriverFactory } = require('../../dist/modules/vendor/drivers/driver.factory')
const { VendorWriteService } = require('../../dist/modules/vendor/vendor-write.service')
const { VendorDriverError } = require('../../dist/modules/vendor/drivers/vendor-driver')
const enabled = !!process.env.DATABASE_URL && new URL(process.env.DATABASE_URL).pathname.endsWith('_test')
const integration = enabled ? test : test.skip
const suffix = `${Date.now()}${process.pid}`
const fixtureToken = `m4w-fake-token-${suffix}`
const fixtureSecret = `m4w-fake-secret-${suffix}`
const oldFlags = { writes: process.env.VENDOR_WRITES_ENABLED, worker: process.env.VENDOR_WRITE_WORKER_ENABLED }
let app, db, base, service, factory, admin, owner, reader, readerRole, plan, account, tokens = {}, domains = []
const remote = new Map()
const state = { registerCalls: 0, deleteCalls: 0, deployCalls: 0, verifyCalls: 0, mode: 'normal', deployMode: 'normal', lastDeployment: null, deploymentHook: null }

async function call(path, method = 'GET', body, token = tokens.admin) {
  const response = await fetch(`${base}${path}`, { method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) })
  const payload = await response.json()
  assert.notEqual(payload.code, 50001, JSON.stringify(payload))
  for (const secret of [fixtureToken, fixtureSecret]) assert.equal(JSON.stringify(payload).includes(secret), false, 'API must never return provider credentials')
  return { status: response.status, ...payload }
}
const ok = response => { assert.equal(response.code, 0, JSON.stringify(response)); return response.data }
const denied = response => { assert.notEqual(response.code, 0, JSON.stringify(response)); return response }
const path = () => `/admin/vendor-accounts/${account.id}/write-jobs`
const payload = (index, key, action = 'register') => ({ action, domainId: String(domains[index].id), idempotencyKey: `${suffix}-${key}` })
async function addManagedResource(index, externalId = `managed-${index}-${suffix}`) {
  return db.vendorResource.create({ data: { vendorAccountId: BigInt(account.id), domainId: domains[index].id, vendorDomainId: externalId, managedByPanel: true } })
}
async function updateOriginAddress(index, address) {
  const group = await db.originGroup.findFirstOrThrow({ where: { domainId: domains[index].id } })
  const origin = await db.origin.findFirstOrThrow({ where: { originGroupId: group.id } })
  await db.origin.update({ where: { id: origin.id }, data: { address } })
}
async function tick(instance = service) {
  // DATETIME(0) can round newly queued timestamps up; make only fresh fixture work due.
  await db.vendorWriteJob.updateMany({ where: { vendorAccountId: BigInt(account.id), status: 'queued' }, data: { nextAttemptAt: new Date(Date.now() - 2000) } })
  process.env.VENDOR_WRITE_WORKER_ENABLED = 'true'
  try { await instance.tick() } finally { process.env.VENDOR_WRITE_WORKER_ENABLED = 'false' }
}

before(async () => {
  if (!enabled) return
  process.env.ACME_WORKER_ENABLED = 'false'
  process.env.VENDOR_WRITES_ENABLED = 'false'
  process.env.VENDOR_WRITE_WORKER_ENABLED = 'false'
  app = await NestFactory.create(AppModule, { logger: false })
  app.setGlobalPrefix('api/v1')
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true, transformOptions: { enableImplicitConversion: true } }))
  db = app.get(PrismaService)
  factory = app.get(DriverFactory)
  factory.create = code => {
    assert.equal(code, 'ali', 'all upstream work is replaced by this local fake')
    return {
      async registerDomain(input) {
        state.registerCalls++
        if (state.mode === 'timeout') throw new VendorDriverError('UPSTREAM_TIMEOUT')
        if (state.mode === 'rate') throw new VendorDriverError('RATE_LIMITED')
        const externalId = `registered-${input.hostname}`
        remote.set(input.hostname, externalId)
        return { externalId, hostname: input.hostname, cname: null, providerStatus: 'configuring' }
      },
      async deployManagedConfig(externalId, config) {
        state.deployCalls++
        state.lastDeployment = structuredClone(config)
        if (state.deployMode === 'partial-rate') {
          remote.set(`partial:${externalId}`, 'origin-write-confirmed')
          throw new VendorDriverError('RATE_LIMITED')
        }
        if (state.deployMode === 'safe-failure') throw new VendorDriverError('INVALID_CONFIG')
        if (state.deploymentHook) await state.deploymentHook(config)
        remote.set(`deploy:${externalId}`, structuredClone(config))
      },
      async verifyManagedConfig(externalId, config) {
        state.verifyCalls++
        return { verified: true, providerStatus: 'online', applied: ['origin', 'cache', ...(config.tls.enabled ? ['certificate'] : [])], verifiedAt: new Date().toISOString() }
      },
      async deleteManagedDomain(externalId, hostname) {
        state.deleteCalls++
        assert.equal(remote.get(hostname), externalId)
        remote.delete(hostname)
      },
      async listDomains() { return { items: [...remote.keys()].map(hostname => ({ externalId: 'observed-new-id', hostname, cname: 'edge.example.com', providerStatus: 'online' })), nextCursor: null } },
    }
  }
  await app.listen(0, '127.0.0.1')
  base = `${await app.getUrl()}/api/v1`
  service = app.get(VendorWriteService)
  const provider = await db.vendor.findUniqueOrThrow({ where: { code: 'ali' } })
  plan = await db.package.create({ data: { name: 'Write queue fixture', code: `m4write_${suffix}`, accessType: 2, vendorId: provider.id, price: '1', period: 1 } })
  const expires = new Date(Date.now() + 86400000)
  admin = await db.user.create({ data: { username: `m4wa_${suffix}`, passwordHash: 'fixture', roleType: 3 } })
  owner = await db.user.create({ data: { username: `m4wu_${suffix}`, passwordHash: 'fixture', roleType: 1, packageId: plan.id, packageExpireAt: expires } })
  reader = await db.user.create({ data: { username: `m4wr_${suffix}`, passwordHash: 'fixture', roleType: 2 } })
  await db.userPackage.create({ data: { userId: owner.id, packageId: plan.id, startAt: new Date(Date.now() - 60000), expireAt: expires, status: 1 } })
  const superRole = await db.role.findUniqueOrThrow({ where: { code: 'super_admin' } })
  readerRole = await db.role.create({ data: { name: 'Write queue read-only fixture', code: `m4write_read_${suffix}` } })
  const readPermission = await db.permission.findUniqueOrThrow({ where: { code: 'vendor:read' } })
  await db.rolePermission.create({ data: { roleId: readerRole.id, permissionId: readPermission.id } })
  const certPermission = await db.permission.findUniqueOrThrow({ where: { code: 'cert:read' } })
  await db.rolePermission.create({ data: { roleId: readerRole.id, permissionId: certPermission.id } })
  const userRole = await db.role.findUniqueOrThrow({ where: { code: require('@lunar/shared').RoleCode.USER } })
  await db.userRole.createMany({ data: [{ userId: admin.id, roleId: superRole.id }, { userId: reader.id, roleId: readerRole.id }, { userId: owner.id, roleId: userRole.id }] })
  const jwt = new JwtService()
  const sign = user => jwt.sign({ sub: String(user.id), username: user.username, roleType: user.roleType }, { secret: process.env.JWT_SECRET || 'dev_access_secret', expiresIn: '10m' })
  tokens = { admin: sign(admin), owner: sign(owner), reader: sign(reader) }
  for (let i = 0; i < 13; i++) domains.push(await db.domain.create({ data: {
    userId: owner.id, domain: `m4w-${i}-${suffix}.example.com`, cname: `m4w-${i}-${suffix}.example.invalid`, accessType: 2, status: 4, auditStatus: 2,
    config: { create: {} }, originGroups: { create: { name: 'Default origin', lbPolicy: 'round_robin', origins: { create: { address: '8.8.8.8', port: 80, protocol: 'http', weight: 1 } } } },
  } }))
  account = ok(await call('/admin/vendor-accounts', 'POST', { vendorId: String(provider.id), name: `M4 write fake ${suffix}`, accessKey: fixtureToken, secretKey: fixtureSecret, config: {} }))
})

after(async () => {
  try {
    if (db) {
      if (account) {
        await db.vendorWriteJob.deleteMany({ where: { vendorAccountId: BigInt(account.id) } })
        await db.vendorResource.deleteMany({ where: { vendorAccountId: BigInt(account.id) } })
        await db.vendorAccount.deleteMany({ where: { id: BigInt(account.id) } })
      }
      if (admin && owner && reader) await db.user.deleteMany({ where: { id: { in: [admin.id, owner.id, reader.id] } } })
      if (readerRole) await db.role.deleteMany({ where: { id: readerRole.id } })
      if (plan) await db.package.deleteMany({ where: { id: plan.id } })
    }
  } finally {
    if (app) await app.close()
    for (const [name, value] of [['VENDOR_WRITES_ENABLED', oldFlags.writes], ['VENDOR_WRITE_WORKER_ENABLED', oldFlags.worker]]) {
      if (value === undefined) delete process.env[name]; else process.env[name] = value
    }
  }
})

integration('M4 write HTTP: disabled by default; anonymous, ordinary and read-only admins cannot submit', async () => {
  const capabilities = ok(await call('/admin/vendor-write-capabilities'))
  assert.equal(capabilities.writesEnabled, false)
  denied(await call(path(), 'POST', payload(0, 'disabled')))
  denied(await call(path(), 'POST', payload(7, 'deploy-disabled', 'deploy')))
  process.env.VENDOR_WRITES_ENABLED = 'true'
  denied(await call(path(), 'POST', payload(0, 'anonymous'), null))
  denied(await call(path(), 'POST', payload(0, 'owner'), tokens.owner))
  denied(await call(path(), 'POST', payload(0, 'reader'), tokens.reader))
  denied(await call(path(), 'POST', payload(7, 'deploy-anonymous', 'deploy'), null))
  denied(await call(path(), 'POST', payload(7, 'deploy-owner', 'deploy'), tokens.owner))
  denied(await call(path(), 'POST', payload(7, 'deploy-reader', 'deploy'), tokens.reader))
  assert.equal(state.registerCalls, 0)
  assert.equal(state.deployCalls, 0)
  assert.equal(await db.vendorWriteJob.count({ where: { vendorAccountId: BigInt(account.id) } }), 0)
  const listed = ok(await call(`${path()}?page=1&pageSize=10`, 'GET', undefined, tokens.reader))
  assert.deepEqual(listed.list, [])
  assert.equal(listed.pagination.total, 0)
})

integration('M4 write MySQL: simultaneous identical POSTs create one durable job; workers execute it once', async () => {
  const results = await Promise.all(Array.from({ length: 5 }, () => call(path(), 'POST', payload(0, 'concurrent'))))
  const ids = results.map(result => ok(result).id)
  assert.equal(new Set(ids).size, 1)
  await db.vendorWriteJob.update({ where: { id: BigInt(ids[0]) }, data: { nextAttemptAt: new Date(Date.now() - 2000) } })
  const secondWorker = new VendorWriteService(db, app.get(ConfigService), factory)
  process.env.VENDOR_WRITE_WORKER_ENABLED = 'true'
  try { await Promise.all([service.tick(), secondWorker.tick()]) } finally { process.env.VENDOR_WRITE_WORKER_ENABLED = 'false' }
  assert.equal(state.registerCalls, 1)
  const row = await db.vendorWriteJob.findUniqueOrThrow({ where: { id: BigInt(ids[0]) } })
  assert.equal(row.status, 'succeeded')
  assert.ok(row.externalId)
  const resource = await db.vendorResource.findUniqueOrThrow({ where: { vendorAccountId_domainId: { vendorAccountId: BigInt(account.id), domainId: domains[0].id } } })
  assert.equal(resource.managedByPanel, true)
  assert.equal(resource.vendorDomainId, row.externalId)
  const domain = await db.domain.findUniqueOrThrow({ where: { id: domains[0].id } })
  assert.equal(domain.status, 4, 'registration must not falsely enable acceleration')
  assert.equal(domain.cname, domains[0].cname)
  const page = ok(await call(`${path()}?page=1&pageSize=10`))
  assert.equal(page.pagination.total, 1)
  assert.equal(page.list[0].externalId, row.externalId)
})

integration('M4 write HTTP: read-only sync preserves registration identity and managed resources block credential deletion', async () => {
  const before = await db.vendorResource.findFirstOrThrow({ where: { vendorAccountId: BigInt(account.id), domainId: domains[0].id } })
  ok(await call(`/admin/vendor-accounts/${account.id}/sync`, 'POST'))
  const afterSync = await db.vendorResource.findUniqueOrThrow({ where: { id: before.id } })
  assert.equal(afterSync.vendorDomainId, before.vendorDomainId)
  assert.equal(afterSync.managedByPanel, true)
  denied(await call(`/admin/vendor-accounts/${account.id}`, 'DELETE'))
})

integration('M4 deploy HTTP: only panel-managed resources can be deployed; queued snapshot is private and key-order independent', async () => {
  const beforeJobs = await db.vendorWriteJob.count({ where: { vendorAccountId: BigInt(account.id) } })
  denied(await call(path(), 'POST', payload(7, 'deploy-unmanaged', 'deploy')))
  assert.equal(await db.vendorWriteJob.count({ where: { vendorAccountId: BigInt(account.id) } }), beforeJobs)

  await addManagedResource(8)
  const originalDomain = await db.domain.findUniqueOrThrow({ where: { id: domains[8].id } })
  const job = ok(await call(path(), 'POST', payload(8, 'deploy-private', 'deploy')))
  let stored = await db.vendorWriteJob.findUniqueOrThrow({ where: { id: BigInt(job.id) } })
  assert.equal(stored.status, 'queued')
  assert.ok(stored.originSnapshot)
  const snapshotText = JSON.stringify(stored.originSnapshot)
  const publicJobText = JSON.stringify(job)
  for (const secret of [fixtureToken, fixtureSecret, 'fixture-certificate-pem', 'fixture-private-key-pem', 'fixture-certificate-token']) {
    assert.equal(snapshotText.includes(secret), false, `snapshot must not contain ${secret}`)
    assert.equal(publicJobText.includes(secret), false, `HTTP response must not contain ${secret}`)
  }
  assert.equal(/"(?:certificate|privateKey|token|accessKey|secretKey)"\s*:/.test(snapshotText), false, 'credential and certificate material fields must never be snapshotted')

  // MySQL JSON stores object keys independently of their insertion order.
  const reverseKeys = value => Array.isArray(value) ? value.map(reverseKeys) : value && typeof value === 'object' ? Object.fromEntries(Object.entries(value).reverse().map(([key, item]) => [key, reverseKeys(item)])) : value
  await db.vendorWriteJob.update({ where: { id: BigInt(job.id) }, data: { originSnapshot: reverseKeys(stored.originSnapshot) } })
  const deployCalls = state.deployCalls, verifyCalls = state.verifyCalls
  await tick()
  stored = await db.vendorWriteJob.findUniqueOrThrow({ where: { id: BigInt(job.id) } })
  assert.equal(stored.status, 'succeeded')
  assert.equal(state.deployCalls - deployCalls, 1)
  assert.equal(state.verifyCalls - verifyCalls, 1)
  assert.equal(state.lastDeployment.hostname, domains[8].domain)
  assert.equal(Object.hasOwn(state.lastDeployment, 'certificate'), false)
  const afterDomain = await db.domain.findUniqueOrThrow({ where: { id: domains[8].id } })
  assert.equal(afterDomain.status, originalDomain.status, 'deploy must not change local acceleration status')
  assert.equal(afterDomain.cname, originalDomain.cname, 'deploy must not change the local CNAME')
})

integration('M4 deploy MySQL: queued configuration changes are rejected before any provider write', async () => {
  await addManagedResource(9)
  const job = ok(await call(path(), 'POST', payload(9, 'deploy-queued-change', 'deploy')))
  const before = state.deployCalls
  await updateOriginAddress(9, '1.1.1.1')
  await tick()
  const stored = await db.vendorWriteJob.findUniqueOrThrow({ where: { id: BigInt(job.id) } })
  assert.equal(stored.status, 'failed')
  assert.equal(stored.errorCode, 'PRECONDITION_FAILED')
  assert.equal(state.deployCalls, before, 'stale queued configuration must not reach the provider')
})

integration('M4 deploy MySQL: configuration changed during an upstream deployment is quarantined for review', async () => {
  await addManagedResource(10)
  const job = ok(await call(path(), 'POST', payload(10, 'deploy-running-change', 'deploy')))
  const before = state.deployCalls
  state.deploymentHook = async () => updateOriginAddress(10, '9.9.9.9')
  try { await tick() } finally { state.deploymentHook = null }
  const stored = await db.vendorWriteJob.findUniqueOrThrow({ where: { id: BigInt(job.id) } })
  assert.equal(state.deployCalls, before + 1)
  assert.equal(stored.status, 'needs_review')
  assert.equal(stored.errorCode, 'PERSISTENCE_UNKNOWN')
  assert.ok(stored.activeKey, 'uncertain deployment must retain the domain lock')
})

integration('M4 deploy MySQL: a rate limit after a partial provider write is never automatically retried', async () => {
  await addManagedResource(11)
  const job = ok(await call(path(), 'POST', payload(11, 'deploy-partial-rate', 'deploy')))
  const before = state.deployCalls
  state.deployMode = 'partial-rate'
  try { await tick() } finally { state.deployMode = 'normal' }
  let stored = await db.vendorWriteJob.findUniqueOrThrow({ where: { id: BigInt(job.id) } })
  assert.equal(stored.status, 'needs_review')
  assert.equal(stored.errorCode, 'DEPLOYMENT_OUTCOME_UNKNOWN')
  assert.ok(stored.activeKey)
  assert.equal(state.deployCalls, before + 1)
  await tick()
  stored = await db.vendorWriteJob.findUniqueOrThrow({ where: { id: BigInt(job.id) } })
  assert.equal(stored.status, 'needs_review')
  assert.equal(state.deployCalls, before + 1, 'ambiguous partial writes must not be retried by another worker tick')
})

integration('M4 deploy MySQL: retry after a confirmed precondition failure snapshots the current configuration', async () => {
  await addManagedResource(12)
  const job = ok(await call(path(), 'POST', payload(12, 'deploy-fresh-retry', 'deploy')))
  const originalSnapshot = (await db.vendorWriteJob.findUniqueOrThrow({ where: { id: BigInt(job.id) } })).originSnapshot
  await updateOriginAddress(12, '1.1.1.1')
  const before = state.deployCalls
  await tick()
  let stored = await db.vendorWriteJob.findUniqueOrThrow({ where: { id: BigInt(job.id) } })
  assert.equal(stored.status, 'failed')
  assert.equal(stored.errorCode, 'PRECONDITION_FAILED')
  assert.equal(state.deployCalls, before)

  await updateOriginAddress(12, '9.9.9.9')
  ok(await call(`/admin/vendor-write-jobs/${job.id}/retry`, 'POST'))
  stored = await db.vendorWriteJob.findUniqueOrThrow({ where: { id: BigInt(job.id) } })
  assert.notDeepEqual(stored.originSnapshot, originalSnapshot, 'manual safe retry must use a fresh deployment snapshot')
  assert.equal(stored.originSnapshot.origin.address, '9.9.9.9')
  await tick()
  stored = await db.vendorWriteJob.findUniqueOrThrow({ where: { id: BigInt(job.id) } })
  assert.equal(stored.status, 'succeeded')
  assert.equal(state.deployCalls, before + 1)
  assert.equal(state.lastDeployment.origin.address, '9.9.9.9')
})

integration('M4 write MySQL: credential rotation invalidates queued work and explicit retry rechecks the current version', async () => {
  const job = ok(await call(path(), 'POST', payload(1, 'credential-version')))
  ok(await call(`/admin/vendor-accounts/${account.id}`, 'PUT', { name: `Rotated fixture ${suffix}` }))
  const count = state.registerCalls
  await tick()
  let stored = await db.vendorWriteJob.findUniqueOrThrow({ where: { id: BigInt(job.id) } })
  assert.equal(stored.status, 'failed')
  assert.equal(stored.errorCode, 'PRECONDITION_FAILED')
  assert.equal(state.registerCalls, count)
  ok(await call(`/admin/vendor-write-jobs/${job.id}/retry`, 'POST'))
  await tick()
  stored = await db.vendorWriteJob.findUniqueOrThrow({ where: { id: BigInt(job.id) } })
  assert.equal(stored.status, 'succeeded')
})

integration('M4 write HTTP: cleanup remains available after domain revocation, soft deletion and owner disablement', async () => {
  await db.domain.update({ where: { id: domains[0].id }, data: { auditStatus: 3, deletedAt: new Date() } })
  await db.user.update({ where: { id: owner.id }, data: { status: 0 } })
  try {
    const job = ok(await call(path(), 'POST', payload(0, 'delete-owned', 'delete')))
    await tick()
    assert.equal((await db.vendorWriteJob.findUniqueOrThrow({ where: { id: BigInt(job.id) } })).status, 'succeeded')
    assert.equal(await db.vendorResource.count({ where: { vendorAccountId: BigInt(account.id), domainId: domains[0].id } }), 0)
  } finally { await db.user.update({ where: { id: owner.id }, data: { status: 1 } }) }
  await db.vendorResource.create({ data: { vendorAccountId: BigInt(account.id), domainId: domains[2].id, vendorDomainId: 'observed-not-owned', managedByPanel: false } })
  const count = state.deleteCalls
  denied(await call(path(), 'POST', payload(2, 'delete-observed', 'delete')))
  assert.equal(state.deleteCalls, count)
})

integration('M4 write MySQL: unknown outcomes are quarantined; a new idempotency key cannot bypass the active domain lock', async () => {
  const job = ok(await call(path(), 'POST', payload(3, 'timeout')))
  state.mode = 'timeout'
  try { await tick() } finally { state.mode = 'normal' }
  const stored = await db.vendorWriteJob.findUniqueOrThrow({ where: { id: BigInt(job.id) } })
  assert.equal(stored.status, 'needs_review')
  assert.ok(stored.activeKey)
  denied(await call(`/admin/vendor-write-jobs/${job.id}/retry`, 'POST'))
  denied(await call(path(), 'POST', payload(3, 'timeout-bypass')))
})

integration('M4 write MySQL: only confirmed rate limits are retried, with a bounded attempt count', async () => {
  const job = ok(await call(path(), 'POST', payload(4, 'rate-limit')))
  state.mode = 'rate'
  const before = state.registerCalls
  try {
    for (let attempt = 1; attempt <= 3; attempt++) {
      await db.vendorWriteJob.update({ where: { id: BigInt(job.id) }, data: { nextAttemptAt: new Date(Date.now() - 2000) } })
      await tick()
      const stored = await db.vendorWriteJob.findUniqueOrThrow({ where: { id: BigInt(job.id) } })
      assert.equal(stored.attempts, attempt)
      assert.equal(stored.status, attempt < 3 ? 'retry_wait' : 'failed')
    }
  } finally { state.mode = 'normal' }
  assert.equal(state.registerCalls - before, 3)
})

integration('M4 write MySQL: stale running leases become needs_review without another upstream write', async () => {
  const job = ok(await call(path(), 'POST', payload(5, 'stale-lease')))
  await db.vendorWriteJob.update({ where: { id: BigInt(job.id) }, data: { status: 'running', leaseToken: '00000000-0000-4000-8000-000000000000', leaseExpiresAt: new Date(Date.now() - 5000) } })
  const before = state.registerCalls
  await tick()
  const stored = await db.vendorWriteJob.findUniqueOrThrow({ where: { id: BigInt(job.id) } })
  assert.equal(stored.status, 'needs_review')
  assert.equal(stored.errorCode, 'LEASE_EXPIRED')
  assert.ok(stored.activeKey)
  assert.equal(state.registerCalls, before)
})

integration('M3 recovery HTTP: a fresh list restores only the current user job and whitelists public TXT fields', async () => {
  const hostname = domains[6].domain
  const job = await db.certificateJob.create({ data: {
    userId: owner.id, domainId: domains[6].id, status: 'needs_dns', domains: [{ id: String(domains[6].id), domain: hostname, autoRenew: false }], expiresAt: new Date(Date.now() + 3600000),
    privateKey: 'enc:v1:private-fixture-state', csr: 'private-fixture-csr', orderData: { token: fixtureToken },
    challenge: { providerSecret: fixtureSecret, records: [{ name: `_acme-challenge.${hostname}`, value: 'public-txt-fixture', domain: hostname, providerSecret: fixtureSecret }] },
  } })
  const page = ok(await call('/user/certificate-jobs?page=1&pageSize=1', 'GET', undefined, tokens.owner))
  assert.equal(page.pagination.total, 1)
  assert.equal(page.list[0].id, String(job.id))
  assert.equal(page.list[0].status, 'needs_dns')
  assert.deepEqual(page.list[0].domains, [{ id: String(domains[6].id), domain: hostname, autoRenew: false }])
  assert.deepEqual(page.list[0].challenge.records, [{ name: `_acme-challenge.${hostname}`, value: 'public-txt-fixture', domain: hostname }])
  for (const field of ['privateKey', 'csr', 'orderData']) assert.equal(Object.hasOwn(page.list[0], field), false)
  const detail = ok(await call(`/user/certificate-jobs/${job.id}`, 'GET', undefined, tokens.owner))
  assert.equal(detail.challenge.records[0].value, 'public-txt-fixture')
  const unrelated = ok(await call('/user/certificate-jobs', 'GET', undefined, tokens.reader))
  assert.equal(unrelated.pagination.total, 0)
  denied(await call(`/user/certificate-jobs/${job.id}`, 'GET', undefined, tokens.reader))
})

integration('M3 recovery HTTP: expired DNS jobs become terminal and erase private resumable state', async () => {
  const job = await db.certificateJob.create({ data: {
    userId: owner.id, domainId: domains[6].id, status: 'needs_dns', domains: [{ id: String(domains[6].id), domain: domains[6].domain, autoRenew: false }], expiresAt: new Date(Date.now() - 5000),
    privateKey: 'enc:v1:expired-fixture', csr: 'expired-fixture-csr', orderData: { token: fixtureToken }, challenge: { records: [] },
  } })
  const page = ok(await call('/user/certificate-jobs?page=1&pageSize=1', 'GET', undefined, tokens.owner))
  assert.equal(page.pagination.total, 2)
  assert.equal(page.list.length, 1)
  const stored = await db.certificateJob.findUniqueOrThrow({ where: { id: job.id } })
  assert.equal(stored.status, 'failed')
  for (const field of ['privateKey', 'csr', 'orderData', 'challenge']) assert.equal(stored[field], null)
})

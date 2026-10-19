const test = require('node:test')
const assert = require('node:assert/strict')
const { encrypt } = require('../dist/common/utils/crypto.util.js')
const { VendorWriteService } = require('../dist/modules/vendor/vendor-write.service.js')

function fixture(overrides = {}) {
  const key = 'vendor-write-test-encryption-key-32-bytes'
  const account = {
    id: 3n, vendorId: 8n, accessKey: `enc:v1:${encrypt('secret-test-token', key)}`,
    secretKey: '', config: {}, status: 1, credentialVersion: 4,
    operationToken: null, operationExpiresAt: null,
    vendor: { id: 8n, code: 'ali', status: 1 },
  }
  const domain = {
    id: 12n, userId: 5n, domain: 'cdn.example.test', deletedAt: null,
    auditStatus: 2, accessType: 2,
    config: { defaultTtl: 3600, originProtocol: 'http', originHost: null, httpsEnabled: false, forceHttps: false, hstsEnabled: false, tlsVersion: 'TLSv1.2' },
    cacheRules: [],
    originGroups: [{ id: 1n, lbPolicy: 'round_robin', healthCheck: null, origins: [{ id: 2n, address: '8.8.8.8', port: 80, protocol: 'http', status: 1, weight: 1, isBackup: false, host: null }] }],
    ...overrides.domain,
  }
  const user = { id: 5n, status: 1, packageId: 20n, packageExpireAt: new Date(Date.now() + 86400000) }
  const pkg = { id: 20n, status: 1, accessType: 2, vendorId: 8n }
  const jobs = [], resources = []
  let nextJob = 1n, nextResource = 1n
  const eq = (actual, expected) => {
    if (expected && typeof expected === 'object' && !(expected instanceof Date) && !Array.isArray(expected)) {
      if ('in' in expected) return expected.in.includes(actual)
      if ('lte' in expected) return actual == null || actual <= expected.lte
      if ('gt' in expected) return actual > expected.gt
      return Object.entries(expected).every(([k, v]) => eq(actual?.[k], v))
    }
    return actual === expected
  }
  const matches = (row, where = {}) => {
    if (where.OR) return where.OR.some(clause => matches(row, clause)) && Object.entries(where).filter(([k]) => k !== 'OR').every(([k, v]) => matches(row, { [k]: v }))
    return Object.entries(where).every(([key, value]) => eq(row[key], value))
  }
  const apply = (row, data) => {
    for (const [key, value] of Object.entries(data)) {
      if (value && typeof value === 'object' && 'increment' in value) row[key] += value.increment
      else if (value && typeof value === 'object' && 'decrement' in value) row[key] -= value.decrement
      else row[key] = value
    }
    return row
  }
  const db = {
    $transaction: async fn => fn(db),
    $queryRaw: async strings => String(strings.join('')).includes('SELECT id FROM vendor_write_jobs') ? jobs.filter(j => ['queued', 'retry_wait'].includes(j.status) && j.nextAttemptAt <= new Date()).sort((a, b) => a.id < b.id ? -1 : 1).slice(0, 1).map(j => ({ id: j.id })) : [],
    $executeRaw: async () => 0,
    vendorAccount: {
      findUnique: async () => account,
      updateMany: async ({ where, data }) => { if (!matches(account, where)) return { count: 0 }; apply(account, data); return { count: 1 } },
      update: async ({ data }) => apply(account, data),
    },
    vendorWriteJob: {
      findUnique: async ({ where }) => jobs.find(j => matches(j, where)) || null,
      findMany: async ({ where, skip, take }) => jobs.filter(j => matches(j, where)).slice(skip, skip + take),
      count: async ({ where }) => jobs.filter(j => matches(j, where)).length,
      create: async ({ data }) => { const row = { id: nextJob++, ...data, createdAt: new Date(), updatedAt: new Date(), externalId: null, leaseToken: null, leaseExpiresAt: null, errorCode: null }; jobs.push(row); return row },
      updateMany: async ({ where, data }) => { const row = jobs.find(j => matches(j, where)); if (!row) return { count: 0 }; apply(row, data); row.updatedAt = new Date(); return { count: 1 } },
    },
    domain: { findUnique: async ({ where }) => where.id === domain.id ? domain : null },
    user: { findUnique: async () => user },
    package: { findUnique: async () => pkg },
    vendorResource: {
      findMany: async ({ where }) => resources.filter(r => matches(r, where)),
      findFirst: async ({ where }) => resources.find(r => matches(r, where)) || null,
      findUnique: async ({ where }) => resources.find(r => r.id === where.id) || null,
      create: async ({ data }) => { const row = { id: nextResource++, ...data }; resources.push(row); return row },
      delete: async ({ where }) => { const i = resources.findIndex(r => r.id === where.id); if (i >= 0) resources.splice(i, 1); return {} },
    },
  }
  const calls = []
  const fakeDriver = {
    registerDomain: async input => { calls.push(['register', input]); return { externalId: 'provider-domain-123', hostname: input.hostname } },
    deleteManagedDomain: async (externalId, hostname) => { calls.push(['delete', externalId, hostname]) },
  }
  const config = { get: name => name === 'security' ? { encryptionKey: key } : name === 'app.env' ? 'test' : undefined }
  const service = new VendorWriteService(db, config, { create: () => fakeDriver })
  return { service, db, jobs, resources, account, domain, user, calls }
}

function env(t, name, value) {
  const before = process.env[name]
  if (value == null) delete process.env[name]; else process.env[name] = value
  t.after(() => { if (before == null) delete process.env[name]; else process.env[name] = before })
}

test('writes are disabled by default and queued responses contain no credentials', async t => {
  env(t, 'VENDOR_WRITES_ENABLED', undefined)
  env(t, 'VENDOR_WRITE_WORKER_ENABLED', undefined)
  const h = fixture()
  assert.equal(h.service.capabilities().writesEnabled, false)
  await assert.rejects(h.service.create('3', { action: 'register', domainId: '12', idempotencyKey: 'request-1' }, '6'), /未启用/)
  assert.equal(h.jobs.length, 0)
})

test('register validates one default origin, deduplicates actor key, saves provider receipt and marks only its own mapping managed', async t => {
  env(t, 'VENDOR_WRITES_ENABLED', 'true')
  env(t, 'VENDOR_WRITE_WORKER_ENABLED', 'true')
  const h = fixture()
  const first = await h.service.create('3', { action: 'register', domainId: '12', idempotencyKey: 'request-2' }, '6')
  const again = await h.service.create('3', { action: 'register', domainId: '12', idempotencyKey: 'request-2' }, '6')
  assert.equal(first.id, again.id)
  assert.equal(JSON.stringify(first).includes('secret-test-token'), false)
  await h.service.tick()
  assert.equal(h.calls.filter(c => c[0] === 'register').length, 1)
  assert.equal(h.jobs[0].status, 'succeeded')
  assert.equal(h.jobs[0].externalId, 'provider-domain-123')
  assert.equal(h.resources.length, 1)
  assert.equal(h.resources[0].managedByPanel, true)
  assert.equal(h.resources[0].vendorDomainId, 'provider-domain-123')
})

test('custom load balancing and observed resources are rejected rather than silently claimed or deleted', async t => {
  env(t, 'VENDOR_WRITES_ENABLED', 'true')
  const badGroup = fixture({ domain: { originGroups: [{ lbPolicy: 'primary_backup', healthCheck: null, origins: [{ address: '8.8.8.8', port: 80, protocol: 'http', status: 1, weight: 1, isBackup: false }] }] } })
  await assert.rejects(badGroup.service.create('3', { action: 'register', domainId: '12', idempotencyKey: 'request-3' }, '6'), /默认轮询源站组/)
  const h = fixture()
  h.resources.push({ id: 42n, vendorAccountId: 3n, domainId: 12n, vendorDomainId: 'observed-id', managedByPanel: false })
  await assert.rejects(h.service.create('3', { action: 'delete', domainId: '12', idempotencyKey: 'request-4' }, '6'), /控制面创建/)
  assert.equal(h.calls.length, 0)
})

test('delete of an owned managed mapping remains available after revocation, soft deletion and owner disablement', async t => {
  env(t, 'VENDOR_WRITES_ENABLED', 'true')
  env(t, 'VENDOR_WRITE_WORKER_ENABLED', 'true')
  const h = fixture({ domain: { deletedAt: new Date(), auditStatus: 3, accessType: 1 } })
  h.user.status = 0
  h.resources.push({ id: 45n, vendorAccountId: 3n, domainId: 12n, vendorDomainId: 'managed-45', managedByPanel: true })
  const job = await h.service.create('3', { action: 'delete', domainId: '12', idempotencyKey: 'request-5' }, '6')
  await h.service.tick()
  assert.deepEqual(h.calls[0], ['delete', 'managed-45', 'cdn.example.test'])
  assert.equal(h.jobs.find(j => String(j.id) === job.id).status, 'succeeded')
  assert.equal(h.jobs.find(j => String(j.id) === job.id).externalId, 'managed-45')
  assert.equal(h.resources.length, 0)
})

test('ambiguous returned hostname keeps the valid external receipt for manual review without claiming a mapping', async t => {
  env(t, 'VENDOR_WRITES_ENABLED', 'true')
  env(t, 'VENDOR_WRITE_WORKER_ENABLED', 'true')
  const h = fixture()
  h.service.factory.create = () => ({ registerDomain: async () => ({ externalId: 'review-receipt-17', hostname: 'different.example.test' }) })
  await h.service.create('3', { action: 'register', domainId: '12', idempotencyKey: 'receipt-mismatch' }, '6')
  await h.service.tick()
  assert.equal(h.jobs[0].status, 'needs_review')
  assert.equal(h.jobs[0].externalId, 'review-receipt-17')
  assert.ok(h.jobs[0].activeKey)
  assert.equal(h.resources.length, 0)
})

test('Alibaba natural resource IDs exceeding local capacity are rejected before upstream work', async t => {
  env(t, 'VENDOR_WRITES_ENABLED', 'true')
  const h = fixture({ domain: { domain: `${'a'.repeat(63)}.${'b'.repeat(63)}.example.com` } })
  await assert.rejects(h.service.create('3', { action: 'register', domainId: '12', idempotencyKey: 'too-long-id' }, '6'), /不超过128字符/)
  assert.equal(h.jobs.length, 0)
  assert.equal(h.calls.length, 0)
})

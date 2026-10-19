const test = require('node:test')
const assert = require('node:assert/strict')
const { encrypt } = require('../dist/common/utils/crypto.util.js')
const { VendorWriteService } = require('../dist/modules/vendor/vendor-write.service.js')

// A deliberately small Prisma-shaped fake: all vendor calls are injected, and origin
// validation is stubbed on the service instance so these tests never need DNS/network.
function fixture({ driver = {}, resourceCreateError, domainOverrides = {} } = {}) {
  const encryptionKey = 'vendor-write-test-encryption-key-32-bytes'
  const account = {
    id: 3n, vendorId: 8n, accessKey: `enc:v1:${encrypt('test-access-key', encryptionKey)}`,
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
    ...domainOverrides,
  }
  const user = { id: 5n, status: 1, packageId: 20n, packageExpireAt: new Date(Date.now() + 86400000) }
  const pkg = { id: 20n, status: 1, accessType: 2, vendorId: 8n }
  const jobs = []
  const resources = []
  const calls = []
  let nextJobId = 1n
  let nextResourceId = 1n

  function equal(actual, expected) {
    if (expected && typeof expected === 'object' && !(expected instanceof Date) && !Array.isArray(expected)) {
      if ('in' in expected) return expected.in.includes(actual)
      if ('lte' in expected) return actual == null || actual <= expected.lte
      if ('gt' in expected) return actual > expected.gt
      return Object.entries(expected).every(([key, value]) => equal(actual?.[key], value))
    }
    return actual === expected
  }
  function matches(row, where = {}) {
    if (where.OR) {
      return where.OR.some(clause => matches(row, clause)) &&
        Object.entries(where).filter(([key]) => key !== 'OR').every(([key, value]) => matches(row, { [key]: value }))
    }
    return Object.entries(where).every(([key, value]) => equal(row[key], value))
  }
  function apply(row, data) {
    for (const [key, value] of Object.entries(data)) {
      if (value && typeof value === 'object' && 'increment' in value) row[key] += value.increment
      else if (value && typeof value === 'object' && 'decrement' in value) row[key] -= value.decrement
      else row[key] = value
    }
    return row
  }

  const db = {
    $transaction: async callback => callback(db),
    $queryRaw: async strings => String(strings.join('')).includes('SELECT id FROM vendor_write_jobs')
      ? jobs.filter(job => ['queued', 'retry_wait'].includes(job.status) && job.nextAttemptAt <= new Date())
        .sort((a, b) => a.id < b.id ? -1 : 1).slice(0, 1).map(job => ({ id: job.id }))
      : [],
    $executeRaw: async strings => {
      // Model the lease-expiry quarantine query without emulating a SQL engine.
      if (String(strings.join('')).includes("status = 'running'")) {
        for (const job of jobs) {
          if (job.status === 'running' && job.leaseExpiresAt && job.leaseExpiresAt <= new Date()) {
            Object.assign(job, { status: 'needs_review', errorCode: 'LEASE_EXPIRED', message: 'review', leaseToken: null, leaseExpiresAt: null })
          }
        }
      }
      return 0
    },
    vendorAccount: {
      findUnique: async () => account,
      updateMany: async ({ where, data }) => {
        if (!matches(account, where)) return { count: 0 }
        apply(account, data)
        return { count: 1 }
      },
      update: async ({ data }) => apply(account, data),
    },
    vendorWriteJob: {
      findUnique: async ({ where }) => jobs.find(job => matches(job, where)) || null,
      findMany: async ({ where, skip, take }) => jobs.filter(job => matches(job, where)).slice(skip, skip + take),
      count: async ({ where }) => jobs.filter(job => matches(job, where)).length,
      create: async ({ data }) => {
        if (jobs.some(job => job.activeKey === data.activeKey && job.activeKey != null && ['queued', 'running', 'retry_wait', 'needs_review'].includes(job.status))) {
          throw new Error('unique active key')
        }
        const row = { id: nextJobId++, ...data, createdAt: new Date(), updatedAt: new Date(), externalId: null, leaseToken: null, leaseExpiresAt: null, errorCode: null }
        jobs.push(row)
        return row
      },
      updateMany: async ({ where, data }) => {
        const row = jobs.find(job => matches(job, where))
        if (!row) return { count: 0 }
        apply(row, data)
        row.updatedAt = new Date()
        return { count: 1 }
      },
    },
    domain: { findUnique: async ({ where }) => where.id === domain.id ? domain : null },
    user: { findUnique: async () => user },
    package: { findUnique: async () => pkg },
    vendorResource: {
      findMany: async ({ where }) => resources.filter(resource => matches(resource, where)),
      findFirst: async ({ where }) => resources.find(resource => matches(resource, where)) || null,
      findUnique: async ({ where }) => resources.find(resource => resource.id === where.id) || null,
      create: async ({ data }) => {
        if (resourceCreateError) throw resourceCreateError
        const row = { id: nextResourceId++, ...data }
        resources.push(row)
        return row
      },
      delete: async ({ where }) => {
        const index = resources.findIndex(resource => resource.id === where.id)
        if (index >= 0) resources.splice(index, 1)
        return {}
      },
    },
  }
  const driverStub = {
    registerDomain: async input => { calls.push(['register', input]); return { externalId: 'provider-domain-123', hostname: input.hostname } },
    deleteManagedDomain: async (externalId, hostname) => { calls.push(['delete', externalId, hostname]) },
    ...driver,
  }
  const config = { get: name => name === 'security' ? { encryptionKey } : name === 'app.env' ? 'test' : undefined }
  const service = new VendorWriteService(db, config, { create: () => driverStub })
  service.isSafeOrigin = async () => true
  return { service, db, jobs, resources, account, domain, calls }
}

function enableWrites(t, worker = true) {
  const priorWrites = process.env.VENDOR_WRITES_ENABLED
  const priorWorker = process.env.VENDOR_WRITE_WORKER_ENABLED
  process.env.VENDOR_WRITES_ENABLED = 'true'
  if (worker) process.env.VENDOR_WRITE_WORKER_ENABLED = 'true'
  else delete process.env.VENDOR_WRITE_WORKER_ENABLED
  t.after(() => {
    if (priorWrites === undefined) delete process.env.VENDOR_WRITES_ENABLED
    else process.env.VENDOR_WRITES_ENABLED = priorWrites
    if (priorWorker === undefined) delete process.env.VENDOR_WRITE_WORKER_ENABLED
    else process.env.VENDOR_WRITE_WORKER_ENABLED = priorWorker
  })
}

async function enqueue(h, action = 'register', key = 'boundary-test') {
  return h.service.create('3', { action, domainId: '12', idempotencyKey: key }, '6')
}

async function runDueAgain(h, job) {
  job.nextAttemptAt = new Date(Date.now() - 1)
  await h.service.tick()
}

test('writes default to disabled and create has no persistence or driver side effects', async t => {
  const beforeWrites = process.env.VENDOR_WRITES_ENABLED
  const beforeWorker = process.env.VENDOR_WRITE_WORKER_ENABLED
  delete process.env.VENDOR_WRITES_ENABLED
  delete process.env.VENDOR_WRITE_WORKER_ENABLED
  t.after(() => {
    if (beforeWrites === undefined) delete process.env.VENDOR_WRITES_ENABLED
    else process.env.VENDOR_WRITES_ENABLED = beforeWrites
    if (beforeWorker === undefined) delete process.env.VENDOR_WRITE_WORKER_ENABLED
    else process.env.VENDOR_WRITE_WORKER_ENABLED = beforeWorker
  })
  const h = fixture()
  assert.equal(h.service.capabilities().writesEnabled, false)
  await assert.rejects(enqueue(h), /未启用/)
  assert.equal(h.jobs.length, 0)
  assert.equal(h.calls.length, 0)
})

test('deterministic non-rate-limit safe failure is terminal and is not automatically retried', async t => {
  enableWrites(t)
  const h = fixture({ driver: { registerDomain: async () => { h.calls.push(['register']); throw Object.assign(new Error('private detail'), { safeCode: 'INVALID_CONFIG' }) } } })
  await enqueue(h)
  await h.service.tick()
  assert.equal(h.jobs[0].status, 'failed')
  assert.equal(h.jobs[0].errorCode, 'INVALID_CONFIG')
  assert.equal(h.jobs[0].activeKey, null)
  await h.service.tick()
  assert.equal(h.calls.length, 1)
  assert.equal(h.jobs[0].attempts, 1)
})

test('needs_review keeps activeKey and prevents a second active job for the domain', async t => {
  enableWrites(t)
  const h = fixture({ driver: { registerDomain: async () => { throw new Error('remote outcome unknown') } } })
  await enqueue(h)
  await h.service.tick()
  assert.equal(h.jobs[0].status, 'needs_review')
  assert.ok(h.jobs[0].activeKey)
  await assert.rejects(enqueue(h, 'register', 'second-request'), /已有受控云端操作/)
  assert.equal(h.jobs.length, 1)
  assert.equal(h.calls.length, 0)
})

test('timeouts and other unknown driver exceptions are quarantined without retry', async t => {
  enableWrites(t)
  for (const [key, error] of [
    ['timeout', Object.assign(new Error('private timeout detail'), { safeCode: 'UPSTREAM_TIMEOUT' })],
    ['unknown', new Error('private unexpected detail')],
  ]) {
    const h = fixture({ driver: { registerDomain: async () => { throw error } } })
    await enqueue(h, 'register', `unknown-${key}`)
    await h.service.tick()
    const job = h.jobs[0]
    assert.equal(job.status, 'needs_review')
    assert.equal(job.activeKey !== null, true)
    assert.equal(job.attempts, 1)
    await h.service.tick()
    assert.equal(job.attempts, 1)
    assert.equal(job.errorCode, 'OUTCOME_UNKNOWN')
  }
})

test('rate-limited writes use bounded 5s/30s backoff and fail after three attempts', async t => {
  enableWrites(t)
  const h = fixture({ driver: { registerDomain: async () => { h.calls.push(['register']); throw Object.assign(new Error('rate limited'), { safeCode: 'RATE_LIMITED' }) } } })
  await enqueue(h)
  for (let attempt = 1; attempt <= 3; attempt++) {
    const started = Date.now()
    await h.service.tick()
    const job = h.jobs[0]
    assert.equal(job.attempts, attempt)
    assert.equal(h.calls.length, attempt)
    if (attempt < 3) {
      assert.equal(job.status, 'retry_wait')
      assert.ok(job.nextAttemptAt.getTime() - started >= (attempt === 1 ? 5000 : 30000) - 100)
      assert.ok(job.nextAttemptAt.getTime() - started <= (attempt === 1 ? 5000 : 30000) + 100)
      await runDueAgain(h, job)
    } else {
      assert.equal(job.status, 'failed')
      assert.equal(job.errorCode, 'RATE_LIMITED')
      assert.equal(job.activeKey, null)
    }
  }
  await h.service.tick()
  assert.equal(h.calls.length, 3)
})

test('credential version changed after enqueue is rejected before the driver is invoked', async t => {
  enableWrites(t)
  const h = fixture()
  await enqueue(h)
  h.account.credentialVersion++
  await h.service.tick()
  assert.equal(h.calls.length, 0)
  assert.equal(h.jobs[0].status, 'failed')
  assert.equal(h.jobs[0].errorCode, 'PRECONDITION_FAILED')
  assert.equal(h.jobs[0].activeKey, null)
})

test('busy account returns the job to retry_wait without marking it failed', async t => {
  enableWrites(t)
  const h = fixture()
  h.account.operationToken = 'another-operation'
  h.account.operationExpiresAt = new Date(Date.now() + 60000)
  await enqueue(h)
  await h.service.tick()
  assert.equal(h.jobs[0].status, 'retry_wait')
  assert.equal(h.jobs[0].errorCode, null)
  assert.equal(h.jobs[0].attempts, 0)
  assert.equal(h.jobs[0].activeKey !== null, true)
  assert.equal(h.calls.length, 0)
})

test('provider receipt survives local resource persistence failure and is quarantined for review', async t => {
  enableWrites(t)
  const h = fixture({ resourceCreateError: new Error('local database write failed') })
  await enqueue(h)
  await h.service.tick()
  assert.equal(h.jobs[0].externalId, 'provider-domain-123')
  assert.equal(h.jobs[0].status, 'needs_review')
  assert.equal(h.jobs[0].errorCode, 'PERSISTENCE_UNKNOWN')
  assert.ok(h.jobs[0].activeKey)
  assert.equal(h.resources.length, 0)
})

test('expired deletion lease is not reported as success and preserves receipt and local mapping', async t => {
  enableWrites(t)
  let h
  h = fixture({ driver: { deleteManagedDomain: async (externalId, hostname) => {
    h.calls.push(['delete', externalId, hostname])
    // Simulate another worker quarantining this job after its lease expires mid-request.
    Object.assign(h.jobs[0], { status: 'needs_review', errorCode: 'LEASE_EXPIRED', activeKey: h.jobs[0].activeKey, leaseToken: null, leaseExpiresAt: null })
  } } })
  h.resources.push({ id: 45n, vendorAccountId: 3n, domainId: 12n, vendorDomainId: 'managed-45', managedByPanel: true })
  await enqueue(h, 'delete', 'expired-delete')
  await h.service.tick()
  assert.deepEqual(h.calls[0], ['delete', 'managed-45', 'cdn.example.test'])
  assert.equal(h.jobs[0].status, 'needs_review')
  assert.equal(h.jobs[0].errorCode, 'LEASE_EXPIRED')
  assert.equal(h.jobs[0].externalId, 'managed-45')
  assert.ok(h.jobs[0].activeKey)
  assert.equal(h.resources.length, 1)
})

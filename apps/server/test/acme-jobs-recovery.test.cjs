const { test } = require('node:test')
const assert = require('node:assert/strict')
const { AcmeService } = require('../dist/modules/certificate/acme.service.js')

function makeService(rows) {
  const calls = { findMany: null, count: null, updates: [] }
  const db = {
    certificateJob: {
      updateMany: async (query) => { calls.updates.push(query); return { count: 0 } },
      findMany: async (query) => {
        calls.findMany = query
        return rows.filter((row) => row.userId === query.where.userId)
          .sort((a, b) => b.createdAt - a.createdAt)
          .slice(query.skip, query.skip + query.take)
      },
      count: async (query) => {
        calls.count = query
        return rows.filter((row) => row.userId === query.where.userId).length
      },
    },
  }
  const service = new AcmeService(db, { get: () => undefined }, {})
  return { service, calls }
}

test('recent job listing is tenant-scoped, paginated, and returns only safe public fields', async () => {
  const now = new Date()
  const row = {
    id: 41n, userId: 7n, status: 'needs_dns', domains: [{ id: 22n, domain: 'example.test', autoRenew: false, apiToken: 'domain-secret' }],
    challenge: { type: 'dns-01', records: [{ name: '_acme-challenge.example.test', value: 'public-txt', domain: 'example.test', privateKey: 'challenge-secret' }], accountKey: 'account-secret' },
    certificateId: null, expiresAt: new Date(now.getTime() + 60_000), error: null, createdAt: now, updatedAt: now,
    privateKey: 'private-key-secret', csr: 'csr-secret', orderData: { encrypted: 'order-secret' },
  }
  const otherTenant = { ...row, id: 42n, userId: 8n }
  const { service, calls } = makeService([row, otherTenant])
  const result = await service.listJobs('7', 1, 10)

  assert.deepEqual(result.pagination, { page: 1, pageSize: 10, total: 1, totalPages: 1 })
  assert.equal(result.list.length, 1)
  assert.equal(result.list[0].id, '41')
  assert.deepEqual(result.list[0].domains, [{ id: '22', domain: 'example.test', autoRenew: false }])
  assert.deepEqual(result.list[0].challenge, { type: 'dns-01', records: [{ name: '_acme-challenge.example.test', value: 'public-txt', domain: 'example.test' }] })
  assert.equal(calls.findMany.where.userId, 7n)
  assert.equal(calls.count.where.userId, 7n)
  assert.deepEqual(Object.keys(calls.findMany.select).sort(), ['certificateId', 'challenge', 'createdAt', 'domains', 'error', 'expiresAt', 'id', 'status', 'updatedAt'].sort())
  const serialized = JSON.stringify(result, (_key, value) => typeof value === 'bigint' ? value.toString() : value)
  for (const secret of ['private-key-secret', 'csr-secret', 'order-secret', 'account-secret', 'domain-secret', 'challenge-secret']) assert.equal(serialized.includes(secret), false)
  assert.ok(calls.updates.every((query) => query.where.userId === 7n))
})

test('the second page uses the requested offset and invalid tenant IDs are rejected before querying', async () => {
  const now = new Date()
  const rows = Array.from({ length: 12 }, (_, index) => ({
    id: BigInt(index + 1), userId: 7n, status: 'failed', domains: [], challenge: null,
    certificateId: null, expiresAt: null, error: null, createdAt: new Date(now.getTime() - index), updatedAt: now,
  }))
  const { service, calls } = makeService(rows)
  const page = await service.listJobs('7', 2, 10)
  assert.equal(page.list.length, 2)
  assert.equal(page.pagination.total, 12)
  assert.equal(calls.findMany.skip, 10)
  assert.equal(calls.findMany.take, 10)

  const invalidTenant = makeService([])
  await assert.rejects(() => invalidTenant.service.listJobs('invalid', 1, 10))
  assert.equal(invalidTenant.calls.findMany, null)
})

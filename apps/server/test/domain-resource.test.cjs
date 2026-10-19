const test = require('node:test')
const assert = require('node:assert/strict')
const { DomainResourceService } = require('../dist/modules/domain-resource/domain-resource.service.js')

function makeDb() {
  const domains = [{ id: 4n, userId: 2n, deletedAt: null }]
  const cacheRules = []
  const groups = []
  const origins = []
  let nextRule = 1n
  let nextGroup = 1n
  let nextOrigin = 1n
  const db = {
    domain: { findFirst: async ({ where }) => domains.find((d) => d.id === where.id && d.userId === where.userId && d.deletedAt === where.deletedAt) ?? null },
    cacheRule: {
      findMany: async ({ where, orderBy } = {}) => {
        let rows = cacheRules.filter((row) => !where || row.domainId === where.domainId)
        if (orderBy) rows = rows.slice().sort((a, b) => a.priority - b.priority || Number(a.id - b.id))
        return rows.map((row) => ({ ...row }))
      },
      findFirst: async ({ where }) => cacheRules.find((row) => row.id === where.id && row.domainId === where.domainId) ?? null,
      count: async ({ where }) => cacheRules.filter((row) => row.domainId === where.domainId).length,
      aggregate: async ({ where }) => ({ _max: { priority: Math.max(-1, ...cacheRules.filter((row) => row.domainId === where.domainId).map((row) => row.priority)) } }),
      create: async ({ data }) => { const row = { id: nextRule++, createdAt: new Date(), ...data }; cacheRules.push(row); return { ...row } },
      update: async ({ where, data }) => { const row = cacheRules.find((r) => r.id === where.id); Object.assign(row, data); return { ...row } },
      updateMany: async ({ where, data }) => { const row = cacheRules.find((r) => r.id === where.id && r.domainId === where.domainId); if (row) Object.assign(row, data); return { count: row ? 1 : 0 } },
      delete: async ({ where }) => { const index = cacheRules.findIndex((r) => r.id === where.id); return cacheRules.splice(index, 1)[0] },
    },
    originGroup: {
      findMany: async ({ where }) => groups.filter((g) => g.domainId === where.domainId).map((g) => ({ ...g, origins: origins.filter((o) => o.originGroupId === g.id).map((o) => ({ ...o })) })),
      findFirst: async ({ where }) => groups.find((g) => g.id === where.id && g.domainId === where.domainId) ?? null,
      create: async ({ data }) => {
        const { origins: nested, ...groupData } = data
        const group = { id: nextGroup++, createdAt: new Date(), ...groupData }
        groups.push(group)
        for (const item of nested.create) origins.push({ id: nextOrigin++, createdAt: new Date(), originGroupId: group.id, ...item })
        return { ...group, origins: origins.filter((o) => o.originGroupId === group.id) }
      },
      update: async ({ where, data }) => { const row = groups.find((g) => g.id === where.id); Object.assign(row, data); return { ...row } },
    },
    origin: {
      count: async ({ where }) => origins.filter((o) => groups.some((g) => g.id === o.originGroupId && g.domainId === where.group.domainId)).length,
      findFirst: async ({ where }) => origins.find((o) => o.id === where.id && groups.some((g) => g.id === o.originGroupId && g.domainId === where.group.domainId)) ?? null,
      update: async ({ where, data }) => { const row = origins.find((o) => o.id === where.id); Object.assign(row, data); return { ...row } },
      delete: async ({ where }) => origins.splice(origins.findIndex((o) => o.id === where.id), 1)[0],
    },
    $queryRawUnsafe: async (_sql, domainId, userId) => domains.some((d) => d.id === domainId && d.userId === userId && d.deletedAt === null) ? [{ id: domainId }] : [],
    $transaction: async (callback) => callback(db),
  }
  return { db, service: new DomainResourceService(db), cacheRules, groups, origins }
}
const validRule = (overrides = {}) => ({ name: 'images', matchType: 'extension', matchValue: 'png', matchMode: 'suffix', action: 'cache', ttl: 300, ignoreParams: true, ...overrides })
const validOrigin = (overrides = {}) => ({ address: 'ORIGIN.EXAMPLE.TEST.', port: 443, weight: 10, protocol: 'https', ...overrides })

test('cache-rule creation appends priority, serializes bigint IDs and locks owned domain', async () => {
  const { service, db } = makeDb()
  const result = await service.createCacheRule('2', '4', validRule())
  assert.equal(result.id, '1')
  assert.equal(result.priority, 0)
  assert.equal(result.domainId, '4')
  assert.equal(result.status, 1)
  const second = await service.createCacheRule('2', '4', validRule({ name: 'html', matchType: 'path', matchValue: '/index.html' }))
  assert.equal(second.priority, 1)
  assert.equal((await service.listCacheRules('2', '4')).length, 2)
  await assert.rejects(service.listCacheRules('9', '4'), /记录不存在/)
  await assert.rejects(service.listCacheRules('2', '999'), /记录不存在/)
  assert.equal(typeof db.$queryRawUnsafe, 'function')
})

test('cache rules reject unknown properties, malformed matchers and invalid IDs as business errors', async () => {
  const { service } = makeDb()
  await assert.rejects(service.createCacheRule('2', '4', { ...validRule(), regex: '.*' }), /不支持字段/)
  await assert.rejects(service.createCacheRule('2', '4', validRule({ matchValue: 'png', matchType: 'path' })), /以\//)
  await assert.rejects(service.createCacheRule('2', '4', validRule({ ttl: 31536001 })), /ttl/)
  await assert.rejects(service.createCacheRule('2', '4', validRule({ matchType: 'all', matchValue: '/ignored' })), /必须为空/)
  await assert.rejects(service.createCacheRule('2', '4', validRule({ matchType: 'extension', matchValue: '.*' })), /扩展名/)
  await assert.rejects(service.listCacheRules('2', '4x'), /domainId/)
})

test('cache-rule sorting requires the complete unique rule set and assigns ascending priorities', async () => {
  const { service } = makeDb()
  await service.createCacheRule('2', '4', validRule({ name: 'first' }))
  await service.createCacheRule('2', '4', validRule({ name: 'second' }))
  await assert.rejects(service.sortCacheRules('2', '4', { ruleIds: ['1'] }), /完整匹配/)
  await assert.rejects(service.sortCacheRules('2', '4', { ruleIds: ['1', '1'] }), /重复/)
  const sorted = await service.sortCacheRules('2', '4', { ruleIds: ['2', '1'] })
  assert.deepEqual(sorted.map((row) => [row.id, row.priority]), [['2', 0], ['1', 1]])
})

test('origin-group creation atomically normalizes valid hostnames and accepts internal IP configuration', async () => {
  const { service } = makeDb()
  const group = await service.createOriginGroup('2', '4', {
    lbPolicy: 'ip_hash',
    healthCheck: { enabled: true, path: '/health', interval: 30, timeout: 5, expectedStatus: 204 },
    origins: [validOrigin(), validOrigin({ address: '10.0.0.8', protocol: 'http', port: 80 })],
  })
  assert.equal(group.id, '1')
  assert.equal(group.name, '默认源站组')
  assert.deepEqual(group.origins.map((origin) => origin.address), ['origin.example.test', '10.0.0.8'])
  assert.equal((await service.listOrigins('2', '4')).groups.length, 1)
  assert.equal(group.healthCheck.expectedStatus, 204)
})

test('origins reject URL-like destinations, malformed health checks and untrusted keys', async () => {
  const { service } = makeDb()
  await assert.rejects(service.createOriginGroup('2', '4', { origins: [validOrigin({ address: 'https://evil.test/x' })] }), /hostname/)
  await assert.rejects(service.createOriginGroup('2', '4', { origins: [validOrigin({ address: 'evil.test:443' })] }), /hostname/)
  await assert.rejects(service.createOriginGroup('2', '4', { healthCheck: { enabled: true, path: '/health', interval: 30, timeout: 3, expectedStatus: 200, url: 'http://127.0.0.1' }, origins: [validOrigin()] }), /不支持字段/)
  await assert.rejects(service.createOriginGroup('2', '4', { healthCheck: { enabled: true, path: 'health', interval: 30, timeout: 3, expectedStatus: 200 }, origins: [validOrigin()] }), /healthCheck/)
  await assert.rejects(service.createOriginGroup('2', '4', { origins: [validOrigin({ host: 'good.test\r\nX-Evil: yes' })] }), /host/)
})

test('origin updates are constrained to this domain and health-check endpoint refuses probing with 501', async () => {
  const { service } = makeDb()
  await service.createOriginGroup('2', '4', { origins: [validOrigin()] })
  const updated = await service.updateOrigin('2', '4', '1', { weight: 1000 })
  assert.equal(updated.weight, 1000)
  await assert.rejects(service.updateOrigin('2', '4', '999', { weight: 1 }), /记录不存在/)
  assert.throws(() => service.healthCheckUnavailable(), (error) => error.status === 501)
  await assert.rejects(service.updateOriginGroup('2', '4', '999', { name: 'x' }), /记录不存在/)
})

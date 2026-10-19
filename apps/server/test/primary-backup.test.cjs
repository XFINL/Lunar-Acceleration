const { test } = require('node:test')
const assert = require('node:assert/strict')
const { DomainResourceService } = require('../dist/modules/domain-resource/domain-resource.service.js')
const { DomainService } = require('../dist/modules/domain/domain.service.js')

function fixture() {
  const domain = { id: 4n, userId: 2n, deletedAt: null }
  const groups = [], origins = []
  let gid = 1n, oid = 1n, locks = 0
  const withOrigins = group => ({ ...group, origins: origins.filter(origin => origin.originGroupId === group.id).sort((a, b) => Number(a.id - b.id)) })
  const db = {
    domain: { findFirst: async ({ where }) => where.id === domain.id && where.userId === domain.userId ? domain : null },
    $queryRawUnsafe: async () => { locks++; return [{ id: domain.id }] },
    $transaction: async fn => fn(db),
    originGroup: {
      create: async ({ data }) => {
        const { origins: nested, ...fields } = data
        const group = { id: gid++, ...fields }
        groups.push(group)
        for (const item of nested.create) origins.push({ id: oid++, originGroupId: group.id, ...item })
        return withOrigins(group)
      },
      findFirst: async ({ where, include }) => {
        const group = groups.find(row => row.id === where.id && (where.domainId === undefined || row.domainId === where.domainId))
        return group ? (include?.origins ? withOrigins(group) : group) : null
      },
      findMany: async () => groups.map(withOrigins),
      update: async ({ where, data, include }) => {
        const group = groups.find(row => row.id === where.id)
        Object.assign(group, data)
        return include?.origins ? withOrigins(group) : group
      },
      delete: async ({ where }) => {
        const index = groups.findIndex(row => row.id === where.id)
        const group = groups[index]
        groups.splice(index, 1)
        for (let i = origins.length - 1; i >= 0; i--) if (origins[i].originGroupId === group.id) origins.splice(i, 1)
        return {}
      },
    },
    origin: {
      count: async () => origins.length,
      findFirst: async ({ where, include }) => {
        const row = origins.find(item => item.id === where.id && (!where.group || groups.find(g => g.id === item.originGroupId)?.domainId === where.group.domainId))
        if (!row) return null
        if (include?.group) return { ...row, group: { ...groups.find(g => g.id === row.originGroupId), origins: withOrigins(groups.find(g => g.id === row.originGroupId)).origins } }
        return row
      },
      findMany: async ({ where }) => origins.filter(row => where.group?.domainId === undefined || groups.find(g => g.id === row.originGroupId)?.domainId === where.group.domainId),
      create: async ({ data }) => { const row = { id: oid++, ...data }; origins.push(row); return row },
      update: async ({ where, data }) => Object.assign(origins.find(row => row.id === where.id), data),
      delete: async ({ where }) => { const index = origins.findIndex(row => row.id === where.id); origins.splice(index, 1); return {} },
    },
  }
  return { service: new DomainResourceService(db), groups, origins, get locks() { return locks } }
}
const origin = (address, isBackup = false, extra = {}) => ({ address: `${address}.example.test`, port: 443, weight: 1, protocol: 'https', isBackup, ...extra })
const errorIncludes = text => error => error instanceof Error && error.message.includes(text)

test('domain creation validates initial primary_backup roles and rejects backups in legacy policies', async () => {
  const service = new DomainService({})
  const source = (address, isBackup = false) => ({ address: `${address}.example.test`, port: 443, weight: 1, protocol: 'https', isBackup })
  await assert.rejects(service.create('2', { domain: 'roles.example.test', originGroup: { lbPolicy: 'primary_backup', origins: [source('main')] } }), errorIncludes('至少一个备源站'))
  await assert.rejects(service.create('2', { domain: 'roles.example.test', originGroup: { lbPolicy: 'weighted', origins: [source('backup', true)] } }), errorIncludes('仅 primary_backup'))
})

test('primary_backup creation requires exactly one primary and at least one backup; legacy policies reject backups', async () => {
  const { service, origins } = fixture()
  await assert.rejects(service.createOriginGroup('2', '4', { lbPolicy: 'primary_backup', origins: [origin('only')] }), errorIncludes('至少一个备源站'))
  await assert.rejects(service.createOriginGroup('2', '4', { lbPolicy: 'primary_backup', origins: [origin('a'), origin('b')] }), errorIncludes('主源站'))
  await assert.rejects(service.createOriginGroup('2', '4', { lbPolicy: 'weighted', origins: [origin('a', true)] }), errorIncludes('仅 primary_backup'))
  const group = await service.createOriginGroup('2', '4', { lbPolicy: 'primary_backup', origins: [origin('main'), origin('backup', true)] })
  assert.equal(group.lbPolicy, 'primary_backup')
  assert.deepEqual(group.origins.map(row => row.isBackup), [false, true])
  assert.equal(origins.length, 2)
})

test('adding, editing, disabling, and deleting sources preserve primary/backup role invariants under the domain lock', async () => {
  const f = fixture(), { service } = f
  const group = await service.createOriginGroup('2', '4', { lbPolicy: 'primary_backup', origins: [origin('main'), origin('backup', true)] })
  const [primary, backup] = group.origins
  await assert.rejects(service.addOriginsToGroup('2', '4', group.id, { origins: [origin('new')] }), errorIncludes('主源站'))
  const extended = await service.addOriginsToGroup('2', '4', group.id, { origins: [origin('new', true)] })
  assert.equal(extended.origins.filter(row => row.isBackup).length, 2)
  const third = extended.origins.find(row => row.address.startsWith('new.'))
  // Promoting a backup automatically demotes the former primary in the same transaction.
  await service.updateOrigin('2', '4', backup.id, { isBackup: false })
  assert.equal(f.origins.filter(row => row.originGroupId === BigInt(group.id) && !row.isBackup).length, 1)
  assert.equal(f.origins.find(row => row.id === BigInt(backup.id)).isBackup, false)
  assert.equal(f.origins.find(row => row.id === BigInt(primary.id)).isBackup, true)
  // Status changes do not erase the stored role; role counts remain valid.
  await service.updateOrigin('2', '4', third.id, { status: 0 })
  assert.equal(f.origins.find(row => row.id === BigInt(third.id)).status, 0)
  await assert.rejects(service.updateOrigin('2', '4', backup.id, { status: 0 }), errorIncludes('主源站'))
  await assert.rejects(service.updateOrigin('2', '4', primary.id, { status: 0 }), errorIncludes('备源站'))
  await service.deleteOrigin('2', '4', third.id)
  assert.equal(f.origins.filter(row => row.originGroupId === BigInt(group.id) && row.isBackup).length, 1)
  await assert.rejects(service.deleteOrigin('2', '4', backup.id), errorIncludes('至少需要保留一个备源站'))
  assert.ok(f.locks >= 5, 'each source mutation should acquire the locked tenant domain row')
})

test('legacy policy conversion is deterministic and conversion out normalizes all isBackup flags', async () => {
  const { service, origins } = fixture()
  const group = await service.createOriginGroup('2', '4', { lbPolicy: 'weighted', origins: [origin('first'), origin('second'), origin('third')] })
  const converted = await service.updateOriginGroup('2', '4', group.id, { lbPolicy: 'primary_backup' })
  assert.equal(converted.lbPolicy, 'primary_backup')
  assert.deepEqual(converted.origins.map(row => row.isBackup), [false, true, true])
  const legacy = await service.updateOriginGroup('2', '4', group.id, { lbPolicy: 'round_robin' })
  assert.deepEqual(legacy.origins.map(row => row.isBackup), [false, false, false])
  assert.ok(origins.every(row => row.isBackup === false))
})

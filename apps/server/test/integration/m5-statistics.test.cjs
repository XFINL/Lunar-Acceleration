const { test, before, after } = require('node:test')
const assert = require('node:assert/strict')
require('reflect-metadata')
const { NestFactory } = require('@nestjs/core')
const { ValidationPipe } = require('@nestjs/common')
const { JwtService } = require('@nestjs/jwt')
const { AppModule } = require('../../dist/app.module')
const { PrismaService } = require('../../dist/database/prisma.service')
const enabled = !!process.env.DATABASE_URL && new URL(process.env.DATABASE_URL).pathname.endsWith('_test')
const integration = enabled ? test : test.skip
const suffix = `${Date.now()}${process.pid}`
const big = 9007199254740993n
let app, db, base, users = [], domains = [], tokens = {}

async function call(query = '', token = tokens.owner, method = 'GET') {
  const response = await fetch(`${base}/user/statistics/traffic${query ? `?${query}` : ''}`, {
    method,
    headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}) },
  })
  const result = await response.json()
  assert.notEqual(result.code, 50001, JSON.stringify(result))
  return { status: response.status, ...result }
}
const ok = result => { assert.equal(result.code, 0, JSON.stringify(result)); return result.data }
const denied = result => { assert.notEqual(result.code, 0, JSON.stringify(result)); return result }
const range = (extra = {}) => new URLSearchParams({ startTime: '2026-10-01T00:00:00Z', endTime: '2026-10-03T00:00:00Z', granularity: 'hour', ...extra }).toString()

before(async () => {
  if (!enabled) return
  process.env.ACME_WORKER_ENABLED = 'false'
  process.env.VENDOR_WRITES_ENABLED = 'false'
  process.env.VENDOR_WRITE_WORKER_ENABLED = 'false'
  app = await NestFactory.create(AppModule, { logger: false })
  app.setGlobalPrefix('api/v1')
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true, transformOptions: { enableImplicitConversion: true } }))
  db = app.get(PrismaService)
  await app.listen(0, '127.0.0.1')
  base = `${await app.getUrl()}/api/v1`
  for (const name of ['owner', 'other', 'noPermission']) users.push(await db.user.create({ data: { username: `m5_${name}_${suffix}`, passwordHash: 'fixture', roleType: 1 } }))
  const role = await db.role.findUniqueOrThrow({ where: { code: 'user' } })
  await db.userRole.createMany({ data: users.slice(0, 2).map(user => ({ userId: user.id, roleId: role.id })) })
  const jwt = new JwtService()
  for (const [index, name] of ['owner', 'other', 'noPermission'].entries()) tokens[name] = jwt.sign({ sub: String(users[index].id), username: users[index].username, roleType: 1 }, { secret: process.env.JWT_SECRET || 'dev_access_secret', expiresIn: '10m' })
  for (const [index, ownerIndex, deleted] of [[0, 0, false], [1, 0, false], [2, 1, false], [3, 0, true], [4, 0, false], [5, 0, false]]) {
    domains[index] = await db.domain.create({ data: { userId: users[ownerIndex].id, domain: `m5-${index}-${suffix}.example.com`, cname: `m5-${index}-${suffix}.invalid`, accessType: 1, status: 4, auditStatus: 2, deletedAt: deleted ? new Date() : null } })
  }
  const row = (index, time, traffic, source = 'node', userId) => ({ userId: userId ?? domains[index].userId, domainId: domains[index].id, statTime: new Date(time), traffic, source })
  await db.trafficStatHourly.createMany({ data: [
    row(0, '2026-10-01T00:00:00Z', big),
    row(0, '2026-10-01T02:00:00Z', 0n),
    row(0, '2026-10-02T03:00:00Z', 11n),
    row(1, '2026-10-01T00:00:00Z', 7n, 'ali'),
    row(2, '2026-10-01T00:00:00Z', 999999n),
    row(2, '2026-10-01T03:00:00Z', 888888n, 'ali', users[0].id),
    row(3, '2026-10-01T00:00:00Z', 777777n),
    row(4, '2026-10-01T00:00:00Z', 0n),
    row(0, '2026-10-01T00:00:00Z', 666666n, 'untrusted'),
  ] })
})

after(async () => {
  try { if (db && users.length) await db.user.deleteMany({ where: { id: { in: users.map(user => user.id) } } }) }
  finally { if (app) await app.close() }
})

integration('M5 traffic HTTP: requires authentication and statistics:read; collectors have no public write route', async () => {
  denied(await call(range(), null))
  denied(await call(range(), tokens.noPermission))
  const before = await db.trafficStatHourly.count({ where: { userId: users[0].id } })
  denied(await call('', tokens.owner, 'POST'))
  assert.equal(await db.trafficStatHourly.count({ where: { userId: users[0].id } }), before)
})

integration('M5 traffic MySQL: scopes both row and domain owner, omits deleted/unknown-source data and preserves unsigned integer precision', async () => {
  const result = ok(await call(range()))
  assert.equal(result.unit, 'bytes')
  assert.equal(result.source, 'persisted_hourly')
  assert.equal(result.coverage, 'observed_only')
  assert.equal(result.availability, 'available')
  assert.equal(result.totalBytes, String(big + 7n + 11n))
  assert.deepEqual(result.series, [
    { time: '2026-10-01T00:00:00.000Z', bytes: String(big + 7n) },
    { time: '2026-10-01T02:00:00.000Z', bytes: '0' },
    { time: '2026-10-02T03:00:00.000Z', bytes: '11' },
  ])
  assert.equal(result.series.some(item => item.time === '2026-10-01T01:00:00.000Z'), false, 'unobserved buckets are not invented as zeroes')
  const filtered = ok(await call(range({ domainId: String(domains[0].id) })))
  assert.equal(filtered.totalBytes, String(big + 11n))
  const other = ok(await call(range(), tokens.other))
  assert.equal(other.totalBytes, '999999')
})

integration('M5 traffic HTTP: another tenant, a missing domain and a deleted domain are indistinguishable', async () => {
  const other = denied(await call(range({ domainId: String(domains[2].id) })))
  const absent = denied(await call(range({ domainId: '18446744073709551615' })))
  const deleted = denied(await call(range({ domainId: String(domains[3].id) })))
  assert.equal(other.code, absent.code)
  assert.equal(other.code, deleted.code)
  assert.equal(other.message, absent.message)
  assert.equal(other.message, deleted.message)
})

integration('M5 traffic HTTP: no observations are distinct from an observed zero-byte bucket', async () => {
  const empty = ok(await call(range({ domainId: String(domains[5].id) })))
  assert.equal(empty.availability, 'no_data')
  assert.equal(empty.totalBytes, null)
  assert.deepEqual(empty.series, [])
  const zero = ok(await call(range({ domainId: String(domains[4].id) })))
  assert.equal(zero.availability, 'available')
  assert.equal(zero.totalBytes, '0')
  assert.deepEqual(zero.series, [{ time: '2026-10-01T00:00:00.000Z', bytes: '0' }])
})

integration('M5 traffic HTTP: daily aggregation uses UTC, supports timezone offsets and keeps end boundaries exclusive', async () => {
  const daily = ok(await call(range({ granularity: 'day' })))
  assert.deepEqual(daily.series, [
    { time: '2026-10-01T00:00:00.000Z', bytes: String(big + 7n) },
    { time: '2026-10-02T00:00:00.000Z', bytes: '11' },
  ])
  const offset = ok(await call(range({ startTime: '2026-10-01T08:00:00+08:00', endTime: '2026-10-02T08:00:00+08:00' })))
  assert.equal(offset.startTime, '2026-10-01T00:00:00.000Z')
  assert.equal(offset.endTime, '2026-10-02T00:00:00.000Z')
  assert.equal(offset.totalBytes, String(big + 7n))
  const exclusive = ok(await call(range({ endTime: '2026-10-02T03:00:00Z' })))
  assert.equal(exclusive.totalBytes, String(big + 7n))
})

integration('M5 traffic HTTP: invalid identifiers, calendar dates, unaligned times and oversized ranges are rejected', async () => {
  for (const extra of [
    { domainId: '0' }, { domainId: '-1' }, { domainId: 'x' }, { domainId: '18446744073709551616' },
    { granularity: 'month' }, { startTime: '2026-02-30T00:00:00Z' },
    { startTime: '2026-10-01T00:01:00Z' }, { endTime: '2026-10-01T00:00:00Z' },
    { startTime: '2026-10-01T00:00:00' },
    { granularity: 'day', startTime: '2026-10-01T01:00:00Z' },
    { startTime: '2026-01-01T00:00:00Z', endTime: '2026-03-01T00:00:00Z' },
    { granularity: 'day', startTime: '2025-01-01T00:00:00Z', endTime: '2026-03-01T00:00:00Z' },
  ]) denied(await call(range(extra)))
  denied(await call('startTime=2026-10-01T00%3A00%3A00Z'))
})

integration('M5 traffic HTTP: default range contains only completed UTC hours and records no fabricated observations', async () => {
  const result = ok(await call())
  assert.equal(result.granularity, 'hour')
  assert.equal(new Date(result.startTime).getUTCMinutes(), 0)
  assert.equal(new Date(result.endTime).getUTCMinutes(), 0)
  assert.equal(new Date(result.endTime).getTime() - new Date(result.startTime).getTime(), 24 * 60 * 60 * 1000)
  assert.ok(new Date(result.endTime).getTime() <= Date.now())
})

integration('M5 traffic MySQL: internal hourly snapshots support full uint64, replace duplicates and aggregate beyond a single uint64', async () => {
  const { StatisticsService } = require('../../dist/modules/statistics/statistics.service')
  const service = app.get(StatisticsService)
  const maximum = 18446744073709551615n
  const snapshot = { userId: String(users[0].id), domainId: String(domains[5].id), source: 'node', statTime: '2026-10-01T04:00:00Z', traffic: String(maximum) }
  await service.recordHourly(snapshot)
  await service.recordHourly(snapshot)
  assert.equal(await db.trafficStatHourly.count({ where: { domainId: domains[5].id } }), 1)
  let result = ok(await call(range({ domainId: snapshot.domainId })))
  assert.equal(result.totalBytes, String(maximum))
  await service.recordHourly({ ...snapshot, traffic: '1' })
  result = ok(await call(range({ domainId: snapshot.domainId })))
  assert.equal(result.totalBytes, '1', 'a retry replaces the whole hour rather than accumulating previous attempts')
  assert.equal(await db.trafficStatHourly.count({ where: { domainId: domains[5].id } }), 1)
  await service.recordHourly(snapshot)
  await service.recordHourly({ ...snapshot, statTime: '2026-10-01T05:00:00Z' })
  result = ok(await call(range({ domainId: snapshot.domainId })))
  assert.equal(result.totalBytes, String(maximum * 2n))
  assert.deepEqual(result.series.map(point => point.bytes), [String(maximum), String(maximum)])
  for (const override of [
    { traffic: String(maximum + 1n) },
    { traffic: '-1' }, { traffic: '1.1' }, { source: 'untrusted' },
    { domainId: String(domains[2].id) },
    { domainId: String(maximum) },
    { userId: String(maximum) },
    { statTime: '0000-01-01T00:00:00Z' },
    { statTime: '0999-01-01T00:00:00Z' },
    { statTime: '2026-10-01T04:01:00Z' },
  ]) await assert.rejects(service.recordHourly({ ...snapshot, ...override }), error => typeof error.code === 'number', 'invalid internal reports must fail as safe business errors')
  assert.equal(await db.trafficStatHourly.count({ where: { domainId: domains[5].id } }), 2)
})

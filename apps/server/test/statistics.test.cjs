const { test } = require('node:test')
const assert = require('node:assert/strict')
const { StatisticsService } = require('../dist/modules/statistics/statistics.service')
const { BusinessException } = require('../dist/common/exceptions/business.exception')

function fixture({ domains = [], grouped = [] } = {}) {
  const calls = { queryRaw: [], executeRaw: [], transactions: 0 }
  const prisma = {
    $queryRaw: async (query) => {
      calls.queryRaw.push(query)
      return query.strings.join('').includes('FROM domains')
        ? (domains.shift() ? [{ id: '9' }] : [])
        : grouped
    },
    $executeRaw: async (query) => { calls.executeRaw.push(query); return 1 },
    $transaction: async (callback) => { calls.transactions += 1; return callback(prisma) },
  }
  return { service: new StatisticsService(prisma), calls }
}
const hourQuery = { startTime: '2026-10-01T00:00:00Z', endTime: '2026-10-01T03:00:00Z', domainId: '9' }
const group = (time, bytes) => ({ statTime: new Date(time), bytes: String(bytes) })
const sqlText = (query) => query.strings.join('?')

function findStatsQuery(calls) {
  return calls.queryRaw.find((query) => sqlText(query).includes('traffic_stats_hourly'))
}

test('statistics raw SQL enforces user/domain ownership, soft deletes, source allowlist, and optional filters', async () => {
  const { service, calls } = fixture({ domains: [true], grouped: [] })
  await service.traffic('7', hourQuery)
  const ownership = calls.queryRaw[0]
  assert.match(sqlText(ownership), /id = CAST\(\? AS UNSIGNED\)/)
  assert.match(sqlText(ownership), /user_id = CAST\(\? AS UNSIGNED\)/)
  assert.match(sqlText(ownership), /deleted_at IS NULL/)
  assert.deepEqual(ownership.values, ['9', '7'])

  const stats = findStatsQuery(calls)
  assert.match(sqlText(stats), /INNER JOIN domains AS d ON d\.id = t\.domain_id/)
  assert.match(sqlText(stats), /d\.user_id = CAST\(\? AS UNSIGNED\)/)
  assert.match(sqlText(stats), /d\.deleted_at IS NULL/)
  assert.match(sqlText(stats), /t\.source IN \(\?,\?,\?\)/)
  assert.match(sqlText(stats), /t\.domain_id = CAST\(\? AS UNSIGNED\)/)
  assert.deepEqual(stats.values, ['7', '7', '2026-10-01 00:00:00', '2026-10-01 03:00:00', 'node', 'cloudflare', 'ali', '9'])
})

test('foreign or missing domain returns same not-found business error', async () => {
  const { service, calls } = fixture()
  await assert.rejects(service.traffic('7', { ...hourQuery, domainId: '8' }), (e) => e instanceof BusinessException && e.code === 40401)
  assert.equal(calls.queryRaw.length, 1)
})

test('IDs safely reject malformed, oversized, and unsigned bigint overflow before database access', async () => {
  const { service, calls } = fixture()
  for (const id of ['', '0', '-1', '1e3', '18446744073709551616', '1'.repeat(21)]) {
    await assert.rejects(service.traffic('7', { ...hourQuery, domainId: id }), BusinessException)
  }
  await assert.rejects(service.traffic('18446744073709551616', hourQuery), BusinessException)
  await assert.rejects(service.traffic('1'.repeat(21), hourQuery), BusinessException)
  assert.equal(calls.queryRaw.length, 0)
})

test('date and range validation rejects missing pairs, bad timezone, unsupported DATETIME years, unaligned and excessive ranges before DB', async () => {
  const { service, calls } = fixture()
  const invalid = [
    { startTime: hourQuery.startTime },
    { startTime: '2026-10-01T00:00:00', endTime: hourQuery.endTime },
    { startTime: '2026-10-01T00:00:00.0001Z', endTime: hourQuery.endTime },
    { startTime: '2026-10-01T00:30:00Z', endTime: hourQuery.endTime },
    { startTime: hourQuery.endTime, endTime: hourQuery.startTime },
    { startTime: '2026-01-01T00:00:00Z', endTime: '2026-02-02T00:00:00Z' },
    { startTime: '0000-01-01T00:00:00Z', endTime: '0000-01-02T00:00:00Z' },
    { startTime: '9999-12-31T23:00:00-23:00', endTime: '9999-12-31T23:00:00Z' },
    { granularity: 'week', startTime: hourQuery.startTime, endTime: hourQuery.endTime },
    { ...hourQuery, source: 'untrusted' },
  ]
  for (const query of invalid) await assert.rejects(service.traffic('7', query), BusinessException)
  assert.equal(calls.queryRaw.length, 0)
})

test('default hourly query requests the 24 most recent complete UTC hours', async () => {
  const { service, calls } = fixture()
  const before = Date.now()
  const result = await service.traffic('7', {})
  const after = Date.now()
  const start = Date.parse(result.startTime)
  const end = Date.parse(result.endTime)
  assert.equal(end % 3600000, 0)
  assert.equal(start % 3600000, 0)
  assert.equal(end - start, 24 * 3600000)
  assert.ok(end <= before && end >= before - 3600000)
  assert.ok(end <= after)
  const stats = findStatsQuery(calls)
  assert.ok(stats.values.includes(result.startTime.slice(0, 19).replace('T', ' ')))
  assert.ok(stats.values.includes(result.endTime.slice(0, 19).replace('T', ' ')))
  assert.match(sqlText(stats), /t\.source IN \(\?,\?,\?\)/)
  assert.doesNotMatch(sqlText(stats), /t\.domain_id = CAST/)
})

test('default daily query requests the 30 most recent complete UTC days', async () => {
  const { service, calls } = fixture()
  const before = Date.now()
  const result = await service.traffic('7', { granularity: 'day' })
  const end = Date.parse(result.endTime)
  assert.equal(end % 86400000, 0)
  assert.equal(end - Date.parse(result.startTime), 30 * 86400000)
  assert.ok(end <= before && end >= before - 86400000)
  const stats = findStatsQuery(calls)
  assert.ok(stats.values.includes(result.startTime.slice(0, 19).replace('T', ' ')))
  assert.ok(stats.values.includes(result.endTime.slice(0, 19).replace('T', ' ')))
})

test('no rows differ from an observed zero, and arbitrarily large aggregate totals stay exact decimal strings', async () => {
  const none = fixture({ domains: [true] })
  const empty = await none.service.traffic('7', hourQuery)
  assert.equal(empty.availability, 'no_data')
  assert.deepEqual(empty.series, [])
  assert.equal(empty.totalBytes, null)

  const zero = fixture({ domains: [true], grouped: [group('2026-10-01T00:00:00Z', '0')] })
  const zeroResult = await zero.service.traffic('7', hourQuery)
  assert.equal(zeroResult.availability, 'available')
  assert.equal(zeroResult.totalBytes, '0')

  const huge = fixture({ domains: [true], grouped: [group('2026-10-01T00:00:00Z', '184467440737095516150000000000000000000')] })
  const hugeResult = await huge.service.traffic('7', hourQuery)
  assert.equal(hugeResult.totalBytes, '184467440737095516150000000000000000000')
  assert.equal(hugeResult.series[0].bytes, '184467440737095516150000000000000000000')
})

test('daily aggregation sums hourly rows into UTC day buckets without filling gaps', async () => {
  const { service, calls } = fixture({ grouped: [
    group('2026-10-01T00:00:00Z', '2'), group('2026-10-01T12:00:00Z', '3'),
    group('2026-10-03T00:00:00Z', '7'),
  ] })
  const result = await service.traffic('7', {
    granularity: 'day', startTime: '2026-10-01T00:00:00Z', endTime: '2026-10-04T00:00:00Z',
  })
  assert.deepEqual(result.series, [
    { time: '2026-10-01T00:00:00.000Z', bytes: '5' },
    { time: '2026-10-03T00:00:00.000Z', bytes: '7' },
  ])
  assert.equal(result.totalBytes, '12')
  assert.match(sqlText(findStatsQuery(calls)), /GROUP BY t\.stat_time/)
  assert.match(sqlText(findStatsQuery(calls)), /ORDER BY t\.stat_time ASC/)
})

test('recordHourly validates ownership and performs a transactionally guarded idempotent unsigned SQL upsert', async () => {
  const { service, calls } = fixture({ domains: [true, true] })
  const input = { userId: '18446744073709551615', domainId: '18446744073709551615', source: 'node', statTime: '2026-10-01T00:00:00Z', traffic: '18446744073709551615' }
  await service.recordHourly(input)
  await service.recordHourly({ ...input, traffic: '5' })
  assert.equal(calls.transactions, 2)
  assert.equal(calls.queryRaw.length, 2)
  assert.equal(calls.executeRaw.length, 2)
  const ownerQuery = calls.queryRaw[0]
  assert.match(sqlText(ownerQuery), /FOR UPDATE/)
  assert.deepEqual(ownerQuery.values, ['18446744073709551615', '18446744073709551615'])
  const firstWrite = calls.executeRaw[0]
  assert.match(sqlText(firstWrite), /INSERT INTO traffic_stats_hourly/)
  assert.match(sqlText(firstWrite), /CAST\(\? AS DECIMAL\(20,0\)\)/)
  assert.match(sqlText(firstWrite), /ON DUPLICATE KEY UPDATE user_id = VALUES\(user_id\), traffic = VALUES\(traffic\)/)
  assert.deepEqual(firstWrite.values, ['18446744073709551615', '18446744073709551615', '2026-10-01 00:00:00', 'node', '18446744073709551615'])
  assert.equal(calls.executeRaw[1].values[4], '5')
})

test('recordHourly rejects unauthorized owners and validates source, date and bounded unsigned traffic before writing', async () => {
  const { service, calls } = fixture()
  const input = { userId: '7', domainId: '9', source: 'node', statTime: '2026-10-01T00:00:00Z', traffic: '5' }
  await assert.rejects(service.recordHourly(input), (e) => e instanceof BusinessException && e.code === 40401)
  assert.equal(calls.executeRaw.length, 0)

  for (const bad of [
    { ...input, source: 'untrusted' },
    { ...input, statTime: '2026-10-01T00:01:00Z' },
    { ...input, statTime: '0000-10-01T00:00:00Z' },
    { ...input, traffic: '-1' },
    { ...input, traffic: '18446744073709551616' },
    { ...input, traffic: '1'.repeat(21) },
  ]) await assert.rejects(service.recordHourly(bad), BusinessException)
  assert.equal(calls.transactions, 1)
  assert.equal(calls.executeRaw.length, 0)
})

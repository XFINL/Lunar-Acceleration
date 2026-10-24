const { test, before, after } = require('node:test')
const assert = require('node:assert/strict')
const { createHash, randomBytes } = require('node:crypto')
require('reflect-metadata')
const { NestFactory } = require('@nestjs/core')
const { ValidationPipe } = require('@nestjs/common')
const { JwtService } = require('@nestjs/jwt')
const { AppModule } = require('../../dist/app.module')
const { PrismaService } = require('../../dist/database/prisma.service')
const { createNodeSignature } = require('../../dist/modules/node/node-hmac.util')
const enabled = !!process.env.DATABASE_URL && new URL(process.env.DATABASE_URL).pathname.endsWith('_test')
const integration = enabled ? test : test.skip
const suffix = `${Date.now()}${process.pid}`
let app, db, base, admin, ordinary, adminToken, ordinaryToken, nodeId, groupId
const rawTokens = []
const authSecret = process.env.JWT_SECRET || 'dev_access_secret'

function makeHeaders(id, rawToken, rawBody, options = {}) {
  const timestamp = options.timestamp ?? String(Math.floor(Date.now() / 1000))
  const nonce = options.nonce ?? randomBytes(18).toString('base64url')
  const tokenHash = createHash('sha256').update(rawToken).digest('hex')
  const path = options.path ?? '/api/v1/node/heartbeat'
  const method = options.method ?? 'POST'
  return {
    'Content-Type': 'application/json',
    'X-Node-Id': String(id),
    'X-Node-Timestamp': timestamp,
    'X-Node-Nonce': nonce,
    'X-Node-Signature': createNodeSignature(tokenHash, timestamp, nonce, method, path, Buffer.from(rawBody)),
  }
}
async function call(path, { method = 'GET', body, token = adminToken, headers = {} } = {}) {
  const response = await fetch(`${base}${path}`, {
    method,
    headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...headers },
    ...(body === undefined ? {} : { body: typeof body === 'string' ? body : JSON.stringify(body) }),
  })
  const result = await response.json()
  return { status: response.status, ...result }
}
const ok = result => { assert.equal(result.code, 0, JSON.stringify(result)); return result.data }
const denied = result => { assert.notEqual(result.code, 0, JSON.stringify(result)); return result }
async function signedNodeCall(route, rawToken, payload, options = {}) {
  const rawBody = typeof payload === 'string' ? payload : JSON.stringify(payload)
  const path = `/api/v1/node/${route}`
  return call(`/node/${route}`, {
    method: 'POST', token: null, body: rawBody,
    headers: makeHeaders(nodeId, rawToken, rawBody, { ...options, path, method: 'POST' }),
  })
}

before(async () => {
  if (!enabled) return
  process.env.ACME_WORKER_ENABLED = 'false'
  process.env.VENDOR_WRITES_ENABLED = 'false'
  process.env.VENDOR_WRITE_WORKER_ENABLED = 'false'
  app = await NestFactory.create(AppModule, { logger: false, rawBody: true })
  app.setGlobalPrefix('api/v1')
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true, transformOptions: { enableImplicitConversion: true } }))
  await app.listen(0, '127.0.0.1')
  base = `${await app.getUrl()}/api/v1`
  db = app.get(PrismaService)
  admin = await db.user.create({ data: { username: `m6admin_${suffix}`, passwordHash: 'fixture', roleType: 3 } })
  ordinary = await db.user.create({ data: { username: `m6ordinary_${suffix}`, passwordHash: 'fixture', roleType: 1 } })
  const jwt = new JwtService()
  adminToken = jwt.sign({ sub: String(admin.id), username: admin.username, roleType: 3 }, { secret: authSecret, expiresIn: '10m' })
  ordinaryToken = jwt.sign({ sub: String(ordinary.id), username: ordinary.username, roleType: 1 }, { secret: authSecret, expiresIn: '10m' })
})

after(async () => {
  try {
    if (db) {
      if (nodeId) await db.node.deleteMany({ where: { id: BigInt(nodeId) } })
      if (groupId) await db.nodeGroup.deleteMany({ where: { id: BigInt(groupId) } })
      if (admin && ordinary) await db.user.deleteMany({ where: { id: { in: [admin.id, ordinary.id] } } })
    }
  } finally { if (app) await app.close() }
})

integration('M6 MySQL HTTP: creates a node with a 32-byte one-time token and never exposes hashes', async () => {
  denied(await call('/admin/nodes', { token: null }))
  denied(await call('/admin/nodes', { token: ordinaryToken }))
  const group = ok(await call('/admin/node-groups', { method: 'POST', body: { name: `group-${suffix}`, region: 'HK' } }))
  groupId = group.id
  const created = ok(await call('/admin/nodes', { method: 'POST', body: { name: `node-${suffix}`, ip: '192.0.2.20', nodeGroupId: groupId, region: 'HK', cpuCores: 4 } }))
  nodeId = created.id
  assert.equal(Buffer.from(created.token, 'base64url').length, 32)
  rawTokens.push(created.token)
  assert.equal(Object.keys(created).includes('tokenHash'), false)
  const stored = await db.nodeToken.findUniqueOrThrow({ where: { nodeId: BigInt(nodeId) } })
  assert.equal(stored.tokenHash, createHash('sha256').update(created.token).digest('hex'))
  assert.notEqual(stored.tokenHash, created.token)
  const list = ok(await call('/admin/nodes'))
  const detail = ok(await call(`/admin/nodes/${nodeId}`))
  assert.ok(list.list.some(item => item.id === nodeId))
  for (const object of [list, detail]) {
    const text = JSON.stringify(object)
    assert.equal(text.includes(stored.tokenHash), false)
    assert.equal(text.includes(created.token), false)
  }
  const updated = ok(await call(`/admin/nodes/${nodeId}`, { method: 'PUT', body: { name: `renamed-${suffix}`, status: 3 } }))
  assert.equal(updated.status, 3)
  const rotated = ok(await call(`/admin/nodes/${nodeId}/rotate-token`, { method: 'POST' }))
  assert.equal(Buffer.from(rotated.token, 'base64url').length, 32)
  rawTokens.push(rotated.token)
  assert.notEqual(rotated.token, created.token)
  assert.equal((await db.nodeToken.findUniqueOrThrow({ where: { nodeId: BigInt(nodeId) } })).tokenHash, createHash('sha256').update(rotated.token).digest('hex'))
})

integration('M6 HMAC HTTP: rejects invalid signature, altered raw body, stale timestamp, invalid headers and expired token', async () => {
  const token = rawTokens.at(-1)
  const validBody = JSON.stringify({ version: '1.22.0' })
  const badSignature = makeHeaders(nodeId, token, validBody, { path: '/api/v1/node/heartbeat' })
  badSignature['X-Node-Signature'] = '0'.repeat(64)
  denied(await call('/node/heartbeat', { method: 'POST', token: null, body: validBody, headers: badSignature }))
  const signedForBody = makeHeaders(nodeId, token, validBody, { path: '/api/v1/node/heartbeat' })
  denied(await call('/node/heartbeat', { method: 'POST', token: null, body: JSON.stringify({ version: '9.99.9' }), headers: signedForBody }))
  const staleBody = JSON.stringify({ version: '1.22.0' })
  denied(await signedNodeCall('heartbeat', token, staleBody, { timestamp: String(Math.floor(Date.now() / 1000) - 301) }))
  const invalidNonceHeaders = makeHeaders(nodeId, token, validBody, { path: '/api/v1/node/heartbeat', nonce: 'short' })
  denied(await call('/node/heartbeat', { method: 'POST', token: null, body: validBody, headers: invalidNonceHeaders }))
  await db.nodeToken.update({ where: { nodeId: BigInt(nodeId) }, data: { expireAt: new Date(Date.now() - 1000) } })
  denied(await signedNodeCall('heartbeat', token, validBody))
  await db.nodeToken.update({ where: { nodeId: BigInt(nodeId) }, data: { expireAt: null } })
})

integration('M6 HMAC HTTP: nonce replay is durably rejected and heartbeat identity comes only from X-Node-Id', async () => {
  const token = rawTokens.at(-1)
  const nonce = randomBytes(18).toString('base64url')
  const body = JSON.stringify({ version: '1.22.1', nodeId: '18446744073709551615', cpuCores: 8, memoryMb: 16384 })
  await db.node.update({ where: { id: BigInt(nodeId) }, data: { status: 2 } })
  const first = ok(await signedNodeCall('heartbeat', token, body, { nonce }))
  assert.equal(first.nodeId, nodeId)
  assert.equal(first.status, 1)
  assert.ok(first.lastHeartbeat)
  const node = await db.node.findUniqueOrThrow({ where: { id: BigInt(nodeId) } })
  assert.equal(node.version, '1.22.1')
  assert.equal(node.cpuCores, 8)
  assert.equal(node.status, 1)
  assert.ok(await db.nodeRequestNonce.findUnique({ where: { nodeId_nonce: { nodeId: BigInt(nodeId), nonce } } }))
  denied(await signedNodeCall('heartbeat', token, body, { nonce }))
})

integration('M6 HMAC HTTP: validation rejects invalid load and metric fields; metrics preserve exact uint64 counts and admin reads stay permission-gated', async () => {
  const token = rawTokens.at(-1)
  denied(await signedNodeCall('heartbeat', token, { version: 'v', load: { cpu: 101 } }))
  const maximum = '18446744073709551615'
  const report = { metrics: [{ time: new Date().toISOString(), cpu: 12.5, mem: 45.25, disk: 31, bandwidthIn: maximum, bandwidthOut: '9007199254740993', connections: 23, qps: 567, cacheHitRate: 99.5 }] }
  const accepted = ok(await signedNodeCall('report-metrics', token, report, { path: '/api/v1/node/report-metrics' }))
  assert.equal(accepted.accepted, 1)
  const [saved] = await db.$queryRaw`SELECT CAST(bandwidth_in AS CHAR) AS bandwidthIn,CAST(bandwidth_out AS CHAR) AS bandwidthOut FROM node_metrics WHERE node_id=${BigInt(nodeId)} ORDER BY stat_time DESC LIMIT 1`
  assert.equal(saved.bandwidthIn, maximum)
  assert.equal(saved.bandwidthOut, '9007199254740993')
  const metrics = ok(await call(`/admin/nodes/${nodeId}/metrics`))
  assert.ok(metrics.list.some(item => item.bandwidthIn === maximum && item.bandwidthOut === '9007199254740993'))
  assert.equal(metrics.list[0].connections, '23')
  assert.equal(metrics.list[0].qps, '567')
  denied(await call(`/admin/nodes/${nodeId}/metrics`, { token: ordinaryToken }))
  denied(await call(`/admin/nodes/${nodeId}/rotate-token`, { method: 'POST', token: ordinaryToken }))
  await db.node.update({ where: { id: BigInt(nodeId) }, data: { status: 3 } })
  const maintenance = ok(await signedNodeCall('heartbeat', token, { version: '1.22.2' }))
  assert.equal(maintenance.status, 3)
  assert.equal((await db.node.findUniqueOrThrow({ where: { id: BigInt(nodeId) } })).status, 3)
  const service = app.get(require('../../dist/modules/node/node.service').NodeService)
  const stale = await db.node.update({ where: { id: BigInt(nodeId) }, data: { status: 1, lastHeartbeat: new Date('2020-01-01T00:00:00Z') } })
  assert.equal(await service.markStaleNodesOffline(new Date('2020-01-02T00:00:00Z')), 1)
  assert.equal((await db.node.findUniqueOrThrow({ where: { id: BigInt(stale.id) } })).status, 2)
  await db.node.update({ where: { id: BigInt(nodeId) }, data: { status: 3, lastHeartbeat: new Date('2020-01-01T00:00:00Z') } })
  assert.equal(await service.markStaleNodesOffline(new Date('2020-01-02T00:00:00Z')), 0, 'maintenance nodes are excluded')
  assert.equal((await db.node.findUniqueOrThrow({ where: { id: BigInt(nodeId) } })).status, 3)
})

const test = require('node:test')
const assert = require('node:assert/strict')
const { execFileSync } = require('node:child_process')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { CertificateService } = require('../dist/modules/certificate/certificate.service.js')

function makeFixture({ ca = false, sans = 'DNS:example.test,DNS:*.wild.example.test' } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'certificate-test-'))
  const keyFile = path.join(dir, 'key.pem')
  const certFile = path.join(dir, 'cert.pem')
  execFileSync('openssl', [
    'req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', keyFile,
    '-out', certFile, '-days', '2', '-subj', '/CN=example.test',
    '-addext', `subjectAltName=${sans}`,
    '-addext', `basicConstraints=critical,CA:${ca ? 'TRUE' : 'FALSE'}`,
  ], { stdio: 'ignore' })
  return { dir, certPem: fs.readFileSync(certFile, 'utf8'), keyPem: fs.readFileSync(keyFile, 'utf8') }
}

function fakeService(domainName = 'example.test') {
  const rows = []
  const configs = new Map()
  const domain = { id: 21n, userId: 7n, domain: domainName, deletedAt: null }
  let sequence = 0n
  const certificate = {
    create: async ({ data }) => {
      const row = { id: ++sequence, ...data, createdAt: new Date() }
      rows.push(row)
      return row
    },
    count: async ({ where }) => rows.filter((row) => row.userId === where.userId).length,
    findMany: async ({ where, skip, take }) => rows.filter((row) => row.userId === where.userId).slice(skip, skip + take),
    findFirst: async ({ where }) => rows.find((row) => row.id === where.id && row.userId === where.userId) ?? null,
    delete: async ({ where }) => { const i = rows.findIndex((row) => row.id === where.id); if (i >= 0) rows.splice(i, 1) },
  }
  const domainConfig = {
    findUnique: async ({ where }) => configs.get(where.domainId) ?? null,
    count: async ({ where }) => [...configs.values()].filter((config) => config.certId === where.certId).length,
    upsert: async ({ where, create, update }) => {
      const old = configs.get(where.domainId)
      const config = { domainId: where.domainId, ...old, ...(old ? update : create) }
      configs.set(where.domainId, config)
      return config
    },
  }
  const db = {
    certificate,
    domain: { findFirst: async ({ where }) => where.id === domain.id && where.userId === domain.userId && where.deletedAt === null ? domain : null },
    domainConfig,
    $transaction: async (callback) => callback({ certificate, domain: db.domain, domainConfig }),
  }
  const config = { get: (key) => key === 'security' ? { encryptionKey: 'test-encryption-key-not-production' } : 'test' }
  return { service: new CertificateService(db, config), rows, configs }
}

test('uploads validate a matching RSA leaf, encrypt the key, and expose metadata only', async (t) => {
  const fixture = makeFixture()
  t.after(() => fs.rmSync(fixture.dir, { recursive: true, force: true }))
  const { service, rows } = fakeService()
  const result = await service.create('7', { name: 'production', ...fixture })
  assert.equal(result.hasPrivateKey, true)
  assert.equal(result.name, 'production')
  assert.equal('keyPem' in result, false)
  assert.equal('certPem' in result, false)
  assert.equal(rows[0].keyPem.startsWith('enc:v1:'), true)
  assert.equal(rows[0].keyPem.includes('PRIVATE KEY'), false)
  assert.equal(rows[0].certPem.includes('BEGIN CERTIFICATE'), true)
  const listed = await service.list('7', 1, 20)
  assert.equal(listed.list[0].hasPrivateKey, true)
  assert.equal('keyPem' in listed.list[0], false)
  assert.equal('certPem' in listed.list[0], false)
  const detail = await service.get('7', String(result.id))
  assert.equal('keyPem' in detail, false)
  assert.equal('certPem' in detail, false)
})

test('rejects mismatched private key and CA certificate without leaking PEM into errors', async (t) => {
  const good = makeFixture()
  const other = makeFixture()
  const ca = makeFixture({ ca: true })
  t.after(() => [good, other, ca].forEach((f) => fs.rmSync(f.dir, { recursive: true, force: true })))
  const { service } = fakeService()
  await assert.rejects(service.create('7', { name: 'bad', certPem: good.certPem, keyPem: other.keyPem }), (error) => {
    assert.match(error.message, /match certificate/)
    assert.equal(error.message.includes(other.keyPem), false)
    return true
  })
  await assert.rejects(service.create('7', { name: 'ca', ...ca }), /CA certificates/)
})

test('rejects expired certificates', async (t) => {
  const fixture = makeFixture()
  t.after(() => fs.rmSync(fixture.dir, { recursive: true, force: true }))
  const { service } = fakeService()
  const x509 = new (require('node:crypto').X509Certificate)(fixture.certPem)
  const originalNow = Date.now
  Date.now = () => Date.parse(x509.validTo) + 1000
  try {
    await assert.rejects(service.create('7', { name: 'expired', ...fixture }), /not currently valid/)
  } finally {
    Date.now = originalNow
  }
})

test('binding validates SAN coverage including one-label wildcard matching', async (t) => {
  const fixture = makeFixture()
  t.after(() => fs.rmSync(fixture.dir, { recursive: true, force: true }))
  const { service } = fakeService()
  const cert = await service.create('7', { name: 'leaf', ...fixture })
  assert.deepEqual(await service.bindDomainCertificate('7', '21', String(cert.id)), { domainId: '21', certId: String(cert.id) })
  const wildcardDomain = { id: 21n, userId: 7n, domain: 'host.wild.example.test', deletedAt: null }
  // A separate fake service fixture exercises the exact-depth wildcard rule via a domain row.
  const internals = service
  assert.equal(internals.matchesDomain({ certPem: fixture.certPem }, wildcardDomain.domain), true)
  assert.equal(internals.matchesDomain({ certPem: fixture.certPem }, 'nested.host.wild.example.test'), false)
  assert.equal(internals.matchesDomain({ certPem: fixture.certPem }, 'other.test'), false)
  const mismatched = fakeService('other.test').service
  const direct = await mismatched.create('7', { name: 'leaf', ...fixture })
  await assert.rejects(mismatched.bindDomainCertificate('7', '21', String(direct.id)), /SAN does not cover/)
})

test('TLS options reject unsupported versions and HTTPS cannot enable without a bound certificate', async () => {
  const { service } = fakeService()
  await assert.rejects(service.updateHttps('7', '21', { tlsVersion: 'SSLv3' }), /TLSv1.2 or TLSv1.3/)
  await assert.rejects(service.updateHttps('7', '21', { httpsEnabled: true }), /certificate must be bound/)
})

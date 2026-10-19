const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { execFileSync } = require('node:child_process')
const { generateKeyPairSync, createHash } = require('node:crypto')
const acme = require('acme-client')
const { AcmeService } = require('../dist/modules/certificate/acme.service.js')

function fixture(domain = 'example.test') {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'acme-test-'))
  const keyFile = path.join(dir, 'key.pem')
  const certFile = path.join(dir, 'cert.pem')
  execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', keyFile, '-out', certFile, '-days', '2', '-subj', `/CN=${domain}`, '-addext', `subjectAltName=DNS:${domain}`, '-addext', 'basicConstraints=critical,CA:FALSE'], { stdio: 'ignore' })
  const accountKey = generateKeyPairSync('rsa', { modulusLength: 2048, privateKeyEncoding: { type: 'pkcs8', format: 'pem' }, publicKeyEncoding: { type: 'spki', format: 'pem' } }).privateKey
  return { dir, accountKey, certPem: fs.readFileSync(certFile, 'utf8') }
}

function env(t, values) {
  const keys = ['ACME_ACCOUNT_KEY', 'ACME_EMAIL', 'ACME_DIRECTORY', 'ACME_PROFILE', 'ACME_ACCEPT_TOS', 'ACME_DNS_PROVIDER', 'ACME_CF_API_TOKEN', 'ACME_CF_ZONE_ID']
  const old = Object.fromEntries(keys.map((key) => [key, process.env[key]]))
  for (const key of keys) delete process.env[key]
  Object.assign(process.env, values)
  t.after(() => { for (const key of keys) { if (old[key] === undefined) delete process.env[key]; else process.env[key] = old[key] } })
}

function harness({ active = true, approved = true, dns, challengeStatus = 'pending', orderStatus = 'pending' } = {}) {
  const domain = { id: 21n, userId: 7n, domain: 'example.test', deletedAt: null, auditStatus: approved ? 2 : 1 }
  const jobRows = []
  let nextId = 0n
  let expectedTxt = null
  let serialized = Promise.resolve()
  const calls = []
  const jobDelegate = {
    create: async ({ data }) => { const row = { id: ++nextId, createdAt: new Date(), updatedAt: new Date(), ...data }; jobRows.push(row); return row },
    update: async ({ where, data }) => { const row = jobRows.find((item) => item.id === where.id); Object.assign(row, data, { updatedAt: new Date() }); return row },
    updateMany: async ({ where, data }) => {
      const rows = jobRows.filter((item) => {
        if (where.id !== undefined && item.id !== where.id) return false
        if (where.userId !== undefined && item.userId !== where.userId) return false
        if (typeof where.status === 'string' && item.status !== where.status) return false
        if (where.status?.in && !where.status.in.includes(item.status)) return false
        if (where.expiresAt?.gt && !(item.expiresAt > where.expiresAt.gt)) return false
        if (where.expiresAt?.lte && !(item.expiresAt <= where.expiresAt.lte)) return false
        if (where.OR && !where.OR.some((condition) => (condition.expiresAt?.lte && item.expiresAt <= condition.expiresAt.lte) || (condition.updatedAt?.lte && item.status === condition.status && item.updatedAt <= condition.updatedAt.lte))) return false
        return true
      })
      for (const row of rows) Object.assign(row, data, { updatedAt: new Date() })
      return { count: rows.length }
    },
    findMany: async ({ where } = {}) => jobRows.filter((row) => !where || (row.userId === where.userId && where.status.in.includes(row.status) && row.expiresAt > where.expiresAt.gt)),
    findFirst: async ({ where }) => jobRows.find((item) => item.id === where.id && item.userId === where.userId) ?? null,
  }
  const db = {
    certificateJob: jobDelegate,
    domain: {
      findMany: async ({ where }) => where.id.in.includes(domain.id) && where.userId === domain.userId && domain.deletedAt === null ? [domain] : [],
      findFirst: async () => domain,
    },
    userPackage: { findFirst: async () => active ? { id: 3n } : null },
    certificate: { findFirst: async () => null, findMany: async () => [] },
    domainConfig: { findMany: async () => [] },
    $transaction: async (fn) => {
      const previous = serialized
      let release
      serialized = new Promise((resolve) => { release = resolve })
      await previous
      try { return await fn(db) } finally { release() }
    },
  }
  const config = { get: (key) => key === 'security' ? { encryptionKey: 'acme-test-encryption-key' } : key === 'app.env' ? 'test' : undefined }
  const client = {
    createAccount: async (data) => { calls.push(['createAccount', data]) },
    createOrder: async (data) => { calls.push(['createOrder', data]); return { url: 'https://ca.test/order/1', finalize: 'https://ca.test/order/1/finalize', status: 'pending' } },
    getAuthorizations: async () => [{ identifier: { value: 'example.test' }, challenges: [{ type: 'dns-01', status: challengeStatus, url: 'https://ca.test/challenge/1', token: 'token' }] }],
    getChallengeKeyAuthorization: async () => createHash('sha256').update('token.thumbprint').digest('base64url'),
    completeChallenge: async () => { calls.push(['completeChallenge']) },
    waitForValidStatus: async (item) => ({ ...item, status: item.status === 'valid' ? 'valid' : item.url.includes('/order/') ? 'ready' : 'valid' }),
    getOrder: async (order) => ({ ...order, status: orderStatus }),
    finalizeOrder: async (order, csr) => { assert.equal(order.status,'ready','CSR submission requires a ready order'); calls.push(['finalizeOrder', csr]); return { ...order, status: 'valid' } },
    getCertificate: async () => fixtureCert,
  }
  const clientFactory = (settings) => { calls.push(['client', settings.directory]); return client }
  const dnsResolver = async (name, signal) => {
    if (dns) return dns(name, expectedTxt, signal)
    return expectedTxt ? [[expectedTxt]] : []
  }
  const certificates = {
    persistAcmeJob: async (_userId, jobId, input) => {
      calls.push(['persistAcmeJob', jobId, input])
      const row = jobRows.find((item) => String(item.id) === jobId)
      Object.assign(row, { status: 'issued', certificateId: 91n, privateKey: null, csr: null, orderData: null, challenge: null, error: null })
      return row
    },
  }
  const service = new AcmeService(db, config, certificates, clientFactory, dnsResolver)
  return { service, db, domain, jobRows, calls, setTxt: (value) => { expectedTxt = value }, getTxt: () => expectedTxt }
}

let fixtureCert

test('installed acme-client 5.4 returns the final dns-01 TXT digest without any CA request', async (t) => {
  const f = fixture()
  t.after(() => fs.rmSync(f.dir, { recursive: true, force: true }))
  const client = new acme.Client({ directoryUrl: 'https://127.0.0.1:1/directory', accountKey: f.accountKey })
  const keyAuthorization = `token.${createHash('sha256').update(JSON.stringify(acme.crypto.getJwk(f.accountKey))).digest('base64url')}`
  const expectedTxt = createHash('sha256').update(keyAuthorization).digest('base64url')
  assert.equal(await client.getChallengeKeyAuthorization({ type: 'dns-01', token: 'token' }), expectedTxt)
})

test('ACME_ACCOUNT_KEY accepts environment PEM values with literal escaped newlines', async (t) => {
  const f = fixture()
  fixtureCert = f.certPem
  t.after(() => fs.rmSync(f.dir, { recursive: true, force: true }))
  env(t, { ACME_ACCOUNT_KEY: f.accountKey.replace(/\n/g, '\\n'), ACME_EMAIL: 'admin@example.test', ACME_PROFILE: 'staging', ACME_ACCEPT_TOS: 'true' })
  const h = harness()
  assert.equal((await h.service.apply('7', { domainId: '21' })).status, 'needs_dns')
  assert.equal(h.calls.some((call) => call[0] === 'createOrder'), true)
})

test('missing ACME account configuration is actionable and never constructs an ACME client', async (t) => {
  const f = fixture()
  fixtureCert = f.certPem
  t.after(() => fs.rmSync(f.dir, { recursive: true, force: true }))
  env(t, {})
  const h = harness()
  await assert.rejects(h.service.apply('7', { domainId: '21' }), /ACME is not configured.*no CA was contacted/)
  assert.equal(h.calls.length, 0)
  assert.equal(h.jobRows.length, 0)
})

test('manual DNS-01 persists an encrypted job, exposes only TXT proof, verifies DNS before ACME finalize, and issues', async (t) => {
  const f = fixture()
  fixtureCert = f.certPem
  t.after(() => fs.rmSync(f.dir, { recursive: true, force: true }))
  env(t, { ACME_ACCOUNT_KEY: f.accountKey, ACME_EMAIL: 'admin@example.test', ACME_PROFILE: 'staging', ACME_ACCEPT_TOS: 'true' })
  const h = harness()
  const created = await h.service.apply('7', { domainIds: ['21'], autoRenew: false })
  assert.equal(created.status, 'needs_dns')
  assert.equal(created.challenge.records[0].name, '_acme-challenge.example.test')
  const expected = createHash('sha256').update('token.thumbprint').digest('base64url')
  assert.equal(created.challenge.records[0].value, expected)
  const saved = h.jobRows[0]
  assert.match(saved.privateKey, /^enc:v1:/)
  assert.equal(saved.privateKey.includes('PRIVATE KEY'), false)
  assert.equal(JSON.stringify(created).includes('privateKey'), false)
  assert.equal(JSON.stringify(created).includes('orderData'), false)
  await assert.rejects(h.service.complete('7', String(created.id)), /Expected TXT value is not visible/)
  assert.equal(h.calls.some((call) => call[0] === 'completeChallenge'), false, 'CA challenge must not be completed before DNS proof exists')
  h.setTxt(expected)
  const issued = await h.service.complete('7', String(created.id))
  assert.equal(issued.status, 'issued')
  assert.equal(issued.certificateId, '91')
  assert.equal(h.calls.some((call) => call[0] === 'finalizeOrder'), true)
  assert.equal(h.jobRows[0].privateKey, null)
  assert.equal(h.jobRows[0].orderData, null)
  assert.equal(h.calls.find((call) => call[0] === 'persistAcmeJob')[2].autoRenew, false)
  assert.equal(h.calls.some((call) => call[0] === 'createAcmeCertificate' || call[0] === 'replaceAcmeCertificate'), false)
})

test('DNS TXT chunks must be joined within one answer record, never flattened across records', async (t) => {
  const f = fixture()
  fixtureCert = f.certPem
  t.after(() => fs.rmSync(f.dir, { recursive: true, force: true }))
  env(t, { ACME_ACCOUNT_KEY: f.accountKey, ACME_EMAIL: 'admin@example.test', ACME_PROFILE: 'staging', ACME_ACCEPT_TOS: 'true' })
  const expected = createHash('sha256').update('token.thumbprint').digest('base64url')
  const h = harness({ dns: async () => [[expected.slice(0,20)], [expected.slice(20)]] })
  const created = await h.service.apply('7', { domainId: '21' })
  await assert.rejects(h.service.complete('7', String(created.id)), /Expected TXT value is not visible/)
  assert.equal(h.jobRows[0].status, 'needs_dns')
  const joined=harness({dns:async()=>[[expected.slice(0,20),expected.slice(20)]]})
  const valid=await joined.service.apply('7',{domainId:'21'})
  assert.equal((await joined.service.complete('7',valid.id)).status,'issued')
})

test('hung DNS resolution is aborted at the bounded lookup timeout', async (t) => {
  const f = fixture()
  fixtureCert = f.certPem
  t.after(() => fs.rmSync(f.dir, { recursive: true, force: true }))
  env(t, { ACME_ACCOUNT_KEY: f.accountKey, ACME_EMAIL: 'admin@example.test', ACME_PROFILE: 'staging', ACME_ACCEPT_TOS: 'true' })
  let aborted = false
  const h = harness({ dns: async (_name, _expected, signal) => new Promise((_resolve, _reject) => signal.addEventListener('abort', () => { aborted = true }, { once: true })) })
  const created = await h.service.apply('7', { domainId: '21' })
  await assert.rejects(h.service.complete('7', String(created.id)), /TXT record not visible/)
  assert.equal(aborted, true)
  assert.equal(h.jobRows[0].status, 'needs_dns')
})

test('concurrent equivalent applications reuse one active job while the per-user transaction is serialized', async (t) => {
  const f = fixture()
  fixtureCert = f.certPem
  t.after(() => fs.rmSync(f.dir, { recursive: true, force: true }))
  env(t, { ACME_ACCOUNT_KEY: f.accountKey, ACME_EMAIL: 'admin@example.test', ACME_PROFILE: 'staging', ACME_ACCEPT_TOS: 'true' })
  const h = harness()
  const [first, second] = await Promise.all([h.service.apply('7', { domainId: '21' }), h.service.apply('7', { domainId: '21' })])
  assert.equal(first.id, second.id)
  assert.equal(h.jobRows.length, 1)
  assert.equal(h.calls.filter((call) => call[0] === 'createOrder').length, 1)
})

test('already-valid CA order/challenge is never completed again', async (t) => {
  const f = fixture()
  fixtureCert = f.certPem
  t.after(() => fs.rmSync(f.dir, { recursive: true, force: true }))
  env(t, { ACME_ACCOUNT_KEY: f.accountKey, ACME_EMAIL: 'admin@example.test', ACME_PROFILE: 'staging', ACME_ACCEPT_TOS: 'true' })
  const h = harness({ challengeStatus: 'valid', orderStatus: 'valid' })
  const created = await h.service.apply('7', { domainId: '21' })
  h.setTxt(created.challenge.records[0].value)
  const issued = await h.service.complete('7', String(created.id))
  assert.equal(issued.status, 'issued')
  assert.equal(h.calls.some((call) => call[0] === 'completeChallenge'), false)
  assert.equal(h.calls.some((call) => call[0] === 'finalizeOrder'), false)
})

test('getJob clears expired and stuck-processing job secrets and order state', async (t) => {
  const f = fixture()
  fixtureCert = f.certPem
  t.after(() => fs.rmSync(f.dir, { recursive: true, force: true }))
  env(t, { ACME_ACCOUNT_KEY: f.accountKey, ACME_EMAIL: 'admin@example.test', ACME_PROFILE: 'staging', ACME_ACCEPT_TOS: 'true' })
  const h = harness()
  const expired = await h.service.apply('7', { domainId: '21' })
  Object.assign(h.jobRows[0], { expiresAt: new Date(Date.now() - 1), privateKey: 'sensitive', csr: 'sensitive', orderData: { encrypted: 'sensitive' } })
  assert.equal((await h.service.getJob('7', expired.id)).status, 'failed')
  assert.equal(h.jobRows[0].privateKey, null)
  assert.equal(h.jobRows[0].csr, null)
  assert.equal(h.jobRows[0].orderData, null)

  h.jobRows[0].status = 'processing'
  h.jobRows[0].expiresAt = new Date(Date.now() + 60_000)
  h.jobRows[0].updatedAt = new Date(Date.now() - 11 * 60_000)
  h.jobRows[0].privateKey = 'sensitive'
  h.jobRows[0].csr = 'sensitive'
  h.jobRows[0].orderData = { encrypted: 'sensitive' }
  assert.equal((await h.service.getJob('7', expired.id)).status, 'failed')
  assert.equal(h.jobRows[0].privateKey, null)
  assert.equal(h.jobRows[0].csr, null)
  assert.equal(h.jobRows[0].orderData, null)
})

test('completion refuses an order if ACME directory or account thumbprint changed after creation', async (t) => {
  const f = fixture()
  const other = fixture()
  fixtureCert = f.certPem
  t.after(() => { fs.rmSync(f.dir, { recursive: true, force: true }); fs.rmSync(other.dir, { recursive: true, force: true }) })
  env(t, { ACME_ACCOUNT_KEY: f.accountKey, ACME_EMAIL: 'admin@example.test', ACME_PROFILE: 'staging', ACME_ACCEPT_TOS: 'true' })
  const h = harness()
  const directoryJob = await h.service.apply('7', { domainId: '21' })
  h.setTxt(directoryJob.challenge.records[0].value)
  process.env.ACME_PROFILE = 'production'
  await assert.rejects(h.service.complete('7', directoryJob.id), /issuance failed/)
  assert.equal(h.jobRows[0].privateKey, null)
  assert.equal(h.calls.some((call) => call[0] === 'completeChallenge'), false)

  process.env.ACME_PROFILE = 'staging'
  const accountJob = await h.service.apply('7', { domainId: '21' })
  h.setTxt(accountJob.challenge.records[0].value)
  process.env.ACME_ACCOUNT_KEY = other.accountKey
  await assert.rejects(h.service.complete('7', accountJob.id), /issuance failed/)
  assert.equal(h.jobRows[1].privateKey, null)
  assert.equal(h.calls.some((call) => call[0] === 'completeChallenge'), false)
})

test('completion rechecks approval, ownership and package and does not finalize when a domain is no longer eligible', async (t) => {
  const f = fixture()
  fixtureCert = f.certPem
  t.after(() => fs.rmSync(f.dir, { recursive: true, force: true }))
  env(t, { ACME_ACCOUNT_KEY: f.accountKey, ACME_EMAIL: 'admin@example.test', ACME_PROFILE: 'staging', ACME_ACCEPT_TOS: 'true' })
  const h = harness()
  const created = await h.service.apply('7', { domainId: '21' })
  h.setTxt(createHash('sha256').update('token.thumbprint').digest('base64url'))
  h.domain.auditStatus = 1
  await assert.rejects(h.service.complete('7', String(created.id)), /issuance failed.*Sensitive details are omitted/)
  assert.equal(h.calls.some((call) => call[0] === 'completeChallenge'), false)
  assert.equal(h.jobRows[0].status, 'failed')
  assert.equal(h.jobRows[0].privateKey, null)
})

test('application refuses unapproved domains and accounts without a current package before creating ACME orders', async (t) => {
  const f = fixture()
  fixtureCert = f.certPem
  t.after(() => fs.rmSync(f.dir, { recursive: true, force: true }))
  env(t, { ACME_ACCOUNT_KEY: f.accountKey, ACME_EMAIL: 'admin@example.test', ACME_PROFILE: 'staging', ACME_ACCEPT_TOS: 'true' })
  const unapproved = harness({ approved: false })
  await assert.rejects(unapproved.service.apply('7', { domainId: '21' }), /Every requested domain must be approved/)
  assert.equal(unapproved.calls.length, 0)
  const noEntitlement = harness({ active: false })
  await assert.rejects(noEntitlement.service.apply('7', { domainId: '21' }), /active package is required/)
  assert.equal(noEntitlement.calls.length, 0)
  assert.equal(noEntitlement.jobRows.length, 0)
})

test('autoRenew is rejected unless explicit Cloudflare credentials are configured; Cloudflare manages only created record IDs', async (t) => {
  const f = fixture()
  fixtureCert = f.certPem
  t.after(() => fs.rmSync(f.dir, { recursive: true, force: true }))
  env(t, { ACME_ACCOUNT_KEY: f.accountKey, ACME_EMAIL: 'admin@example.test', ACME_PROFILE: 'staging', ACME_ACCEPT_TOS: 'true' })
  const h = harness()
  await assert.rejects(h.service.apply('7', { domainId: '21', autoRenew: true }), /autoRenew requires explicit DNS automation/)

  process.env.ACME_DNS_PROVIDER = 'cloudflare'
  process.env.ACME_CF_API_TOKEN = 'fake-token'
  process.env.ACME_CF_ZONE_ID = '0123456789abcdef0123456789abcdef'
  const seen = []
  const originalFetch = global.fetch
  global.fetch = async (url, init) => {
    seen.push({ url, init })
    if (init.method === 'POST') {
      h.setTxt(JSON.parse(init.body).content)
      return { ok: true, json: async () => ({ success: true, result: { id: 'abcdef0123456789abcdef0123456789' } }) }
    }
    return { ok: true, json: async () => ({ success: true, result: { id: 'abcdef0123456789abcdef0123456789' } }) }
  }
  t.after(() => { global.fetch = originalFetch })
  const done = await h.service.apply('7', { domainId: '21', autoRenew: true })
  assert.equal(done.status, 'issued')
  assert.equal(h.calls.find((call) => call[0] === 'persistAcmeJob')[2].autoRenew, true)
  assert.equal(seen.filter((call) => call.init.method === 'POST').length, 1)
  assert.equal(seen.filter((call) => call.init.method === 'DELETE').length, 1)
  assert.equal(seen.every((call) => call.init.redirect === 'error' && call.init.signal instanceof AbortSignal), true)
  assert.match(seen.find((call) => call.init.method === 'POST').url, /\/zones\/0123456789abcdef0123456789abcdef\/dns_records$/)
  assert.match(seen.find((call) => call.init.method === 'DELETE').url, /\/dns_records\/abcdef0123456789abcdef0123456789$/)
  assert.equal(JSON.stringify(done).includes('fake-token'), false)
})

const test = require('node:test')
const assert = require('node:assert/strict')
const { encrypt } = require('../dist/common/utils/crypto.util.js')
const { VendorService } = require('../dist/modules/vendor/vendor.service.js')

function harness(driver) {
  const key = 'vendor-test-encryption-key'
  const account = { id: 9n, vendorId: 3n, name: 'test account', accessKey: `enc:v1:${encrypt('test-token', key)}`, secretKey: null, config: { zoneId: '0123456789abcdef0123456789abcdef' }, status: 1, credentialVersion: 1, operationToken: null, operationExpiresAt: null, lastSyncAt: null, vendor: { id: 3n, name: 'Cloudflare', code: 'cloudflare', status: 1 } }
  const logs = [], resources = [], calls = []
  const db = {
    $transaction: async fn => fn(db),
    $queryRaw: async () => [],
    vendorAccount: {
      findUnique: async () => account,
      updateMany: async ({ where, data }) => {
        const eligible = where.OR.some(x => x.operationToken === null ? account.operationToken === null : account.operationExpiresAt && account.operationExpiresAt <= x.operationExpiresAt.lte)
        if (!eligible || account.credentialVersion !== where.credentialVersion) return { count: 0 }
        Object.assign(account, data); return { count: 1 }
      },
      update: async ({ data }) => { Object.assign(account, data); return account },
    },
    vendorSyncLog: { create: async ({ data }) => { logs.push(data); return data } },
    domain: { findMany: async () => [{ id: 71n, domain: 'www.example.test', deletedAt: null }] },
    vendorResource: { upsert: async ({ where, create, update }) => { calls.push(where); const row = { ...create, ...update }; resources.push(row); return row },
      findMany: async () => [], count: async () => 0 },
  }
  const config = { get: name => name === 'security' ? { encryptionKey: key } : 'test' }
  const factory = { create: (code, credentials) => { assert.equal(code, 'cloudflare'); assert.equal(credentials.accessKey, 'test-token'); return driver } }
  const service = new VendorService(db, config, factory)
  return { service, db, logs, resources, calls, account }
}

test('vendor connection test uses only the injected fake driver and records a safe success log', async () => {
  let calls = 0
  const fake = { testConnection: async () => { calls++; return { connected: true, provider: 'cloudflare', checkedAt: new Date(0).toISOString() } }, listDomains: async () => ({ items: [], nextCursor: null }) }
  const h = harness(fake)
  assert.equal((await h.service.testAccount('9')).connected, true)
  assert.equal(calls, 1)
  assert.equal(h.logs[0].status, 1)
  assert.equal(h.logs[0].message, '连接测试成功')
  assert.equal(h.account.operationToken, null)
})

test('vendor sync reads pages from fake driver, only upserts matched live domains, and marks observation-only', async () => {
  const pages = [
    { items: [{ externalId: 'remote-1', hostname: 'WWW.Example.Test', cname: 'edge.example.test', providerStatus: 'active', sslStatus: 'active', unexpectedSecret: 'must-not-persist' }], nextCursor: 'page-2' },
    { items: [{ externalId: 'unknown', hostname: 'unmatched.example.test', cname: null, providerStatus: 'pending' }], nextCursor: null },
  ]
  const received = []
  const fake = { testConnection: async () => ({ connected: true, provider: 'cloudflare', checkedAt: new Date(0).toISOString() }), listDomains: async cursor => { received.push(cursor); return pages.shift() } }
  const h = harness(fake)
  const result = await h.service.syncAccount('9')
  assert.deepEqual(received, [undefined, 'page-2'])
  assert.deepEqual({ synced: result.synced, ignored: result.ignored, total: result.total, readonly: result.readonly }, { synced: 1, ignored: 1, total: 2, readonly: true })
  assert.match(result.message, /未部署或修改域名状态/)
  assert.equal(h.resources.length, 1)
  assert.deepEqual(h.resources[0].resourceData, { hostname: 'www.example.test', cname: 'edge.example.test', providerStatus: 'active', sslStatus: 'active', observedOnly: true })
  assert.equal(h.resources[0].resourceData.unexpectedSecret, undefined)
  assert.equal(h.logs[0].status, 1)
  assert.equal(h.account.lastSyncAt instanceof Date, true)
})

test('vendor sync rejects repeated cursors before any resource is written', async () => {
  const fake = { testConnection: async () => ({ connected: true, provider: 'cloudflare', checkedAt: new Date(0).toISOString() }), listDomains: async () => ({ items: [], nextCursor: 'repeat' }) }
  const h = harness(fake)
  await assert.rejects(h.service.syncAccount('9'), /INVALID_RESPONSE/)
  assert.equal(h.resources.length, 0)
  assert.equal(h.logs[0].status, 2)
  assert.equal(h.account.operationToken, null)
})

test('unknown vendor errors are replaced before reaching the global exception logger',async()=>{
 const secret='fixture-raw-provider-secret'
 const h=harness({testConnection:async()=>{throw new Error(`request Authorization ${secret}`)}})
 await assert.rejects(h.service.testAccount('9'),error=>{
  assert.equal(error.code,70001)
  assert.equal(String(error.stack).includes(secret),false)
  return true
 })
 assert.equal(JSON.stringify(h.logs,(_key,value)=>typeof value==='bigint'?String(value):value).includes(secret),false)
 assert.equal(h.account.operationToken,null)
})

test('production vendor credentials reject placeholder and weak encryption keys',()=>{
 for(const key of ['short','0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef']){
  const service=new VendorService({}, {get:name=>name==='security'?{encryptionKey:key}:name==='app.env'?'production':undefined}, {})
  assert.throws(()=>service.encryptionKey(),/至少 32 字符且非默认/)
 }
})

test('read-only sync preserves the external identity of panel-managed registrations', async () => {
  const h = harness({ listDomains: async () => ({ items: [{ externalId: 'observed-different-id', hostname: 'www.example.test', cname: null, providerStatus: 'active' }], nextCursor: null }) })
  h.db.vendorResource.findMany = async () => [{ domainId: 71n, vendorDomainId: 'created-by-panel' }]
  let update
  h.db.vendorResource.upsert = async args => { update = args.update; return args.create }
  await h.service.syncAccount('9')
  assert.equal(Object.hasOwn(update, 'vendorDomainId'), false)
  assert.equal(Object.hasOwn(update, 'managedByPanel'), false)
  assert.equal(update.resourceData.observedOnly, false)
  assert.equal(update.resourceData.registrationOnly, true)
})

test('managed resources and unresolved write jobs block deletion of cloud credentials', async () => {
  for (const kind of ['managed', 'pending']) {
    const h = harness({})
    let deleted = false
    h.db.vendorResource.count = async () => kind === 'managed' ? 1 : 0
    h.db.vendorWriteJob = { findFirst: async () => kind === 'pending' ? { id: 1n } : null, deleteMany: async () => { throw new Error('must not erase audit jobs') } }
    h.db.vendorAccount.delete = async () => { deleted = true }
    await assert.rejects(h.service.deleteAccount('9'), /不能删除凭据/)
    assert.equal(deleted, false)
  }
})

test('an account with no managed resources can remove terminal history before local credentials', async () => {
  const h = harness({})
  const steps = []
  h.db.vendorWriteJob = { findFirst: async () => null, deleteMany: async () => { steps.push('terminal-jobs') } }
  h.db.vendorAccount.delete = async () => { steps.push('credentials') }
  await h.service.deleteAccount('9')
  assert.deepEqual(steps, ['terminal-jobs', 'credentials'])
})

const test = require('node:test')
const assert = require('node:assert/strict')
const { CloudflareDriver } = require('../dist/modules/vendor/drivers/cloudflare.driver.js')
const { VendorDriverError } = require('../dist/modules/vendor/drivers/vendor-driver.js')

const zoneId = '0123456789abcdef0123456789abcdef'
const credentials = { accessKey: 'test-token-not-secret', secretKey: 'unused-secret', config: { zoneId } }
const jsonResponse = (body, init = {}) => new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json', ...init.headers }, ...init })
const errorCode = async (promise, code) => {
  await assert.rejects(promise, error => {
    assert.ok(error instanceof VendorDriverError)
    assert.equal(error.safeCode, code)
    assert.equal(error.message, code)
    assert.equal(JSON.stringify(error).includes(credentials.accessKey), false)
    assert.equal(JSON.stringify(error).includes('private'), false)
    return true
  })
}

const zoneResponse = () => ({
  success: true,
  result: { id: zoneId, name: 'Exämple.COM', status: 'active', account: { name: 'Acme Example Account' }, verification_key: 'private-field-must-not-escape' },
})

test('testConnection performs only fixed zone GET and emits bounded contract metadata', async () => {
  let request
  const driver = new CloudflareDriver(credentials, async (url, init) => { request = { url, init }; return jsonResponse(zoneResponse()) })
  const result = await driver.testConnection()
  assert.equal(request.url, `https://api.cloudflare.com/client/v4/zones/${zoneId}`)
  assert.equal(request.init.method, 'GET')
  assert.equal(request.init.redirect, 'error')
  assert.equal(request.init.headers.Authorization, `Bearer ${credentials.accessKey}`)
  assert.ok(request.init.signal instanceof AbortSignal)
  assert.deepEqual(Object.keys(result).sort(), ['accountLabel', 'checkedAt', 'connected', 'provider', 'providerStatus'])
  assert.equal(result.connected, true)
  assert.equal(result.provider, 'cloudflare')
  assert.equal(result.providerStatus, 'active')
  assert.equal(result.accountLabel, 'Acme Example Account')
  assert.equal(JSON.stringify(result).includes('verification_key'), false)
  assert.equal(JSON.stringify(result).includes('private-field-must-not-escape'), false)
})

test('listDomains uses fixed custom-hostname GET route, per_page=50 and numeric page cursor', async () => {
  const seen = []
  const driver = new CloudflareDriver(credentials, async (url, init) => {
    seen.push({ url: new URL(url), init })
    return jsonResponse({
      success: true,
      result: [{ id: 'cf-id-1', hostname: 'Exämple.COM', status: 'pending_validation', cname: 'Origin.Example.NET', ssl: { status: 'active', custom_key: 'PRIVATE_KEY_FIXTURE', custom_certificate: 'PRIVATE_CERT_FIXTURE' }, custom_origin_server: 'hidden.example.net' }],
      result_info: { page: seen.length, per_page: 50, total_pages: 2 },
    })
  })
  const first = await driver.listDomains()
  assert.equal(seen[0].url.origin, 'https://api.cloudflare.com')
  assert.equal(seen[0].url.pathname, `/client/v4/zones/${zoneId}/custom_hostnames`)
  assert.equal(seen[0].url.searchParams.get('per_page'), '50')
  assert.equal(seen[0].url.searchParams.get('page'), '1')
  assert.equal(seen[0].init.method, 'GET')
  assert.equal(seen[0].init.redirect, 'error')
  assert.equal(first.nextCursor, '2')
  assert.deepEqual(first.items, [{ externalId: 'cf-id-1', hostname: 'xn--exmple-cua.com', cname: 'origin.example.net', providerStatus: 'pending_validation', sslStatus: 'active' }])
  assert.equal(JSON.stringify(first).includes('PRIVATE_KEY_FIXTURE'), false)
  assert.equal(JSON.stringify(first).includes('PRIVATE_CERT_FIXTURE'), false)
  assert.equal(JSON.stringify(first).includes('hidden.example.net'), false)
  const second = await driver.listDomains(first.nextCursor)
  assert.equal(seen[1].url.searchParams.get('page'), '2')
  assert.equal(second.nextCursor, null)
  assert.equal(seen.every(x => x.init.method === 'GET'), true)
})

test('rejects malformed cursors and invalid credentials before any transport call', async () => {
  let calls = 0
  const transport = async () => { calls++; return jsonResponse({ success: true, result: [] }) }
  const driver = new CloudflareDriver(credentials, transport)
  for (const cursor of ['0', '-1', '1.5', '01', '1&x=2', '2147483648']) await errorCode(driver.listDomains(cursor), 'INVALID_CONFIG')
  for (const bad of [
    { ...credentials, accessKey: '' },
    { ...credentials, accessKey: ' '.repeat(4097) },
    { ...credentials, config: { zoneId: 'not-a-zone-id' } },
  ]) assert.throws(() => new CloudflareDriver(bad, transport), error => error.safeCode === 'INVALID_CONFIG')
  assert.equal(calls, 0)
})

test('HTTP authentication and rate failures map to safe contract codes', async () => {
  for (const status of [401, 403]) await errorCode(new CloudflareDriver(credentials, async () => new Response('private-token body', { status })).testConnection(), 'AUTH_FAILED')
  await errorCode(new CloudflareDriver(credentials, async () => new Response('private-token body', { status: 429 })).testConnection(), 'RATE_LIMITED')
  await errorCode(new CloudflareDriver(credentials, async () => { throw new Error('private-token transport detail') }).testConnection(), 'UPSTREAM_ERROR')
  await errorCode(new CloudflareDriver(credentials, async (_url, init) => { assert.equal(init.redirect, 'error'); throw new TypeError('redirect private body') }).testConnection(), 'UPSTREAM_ERROR')
  await errorCode(new CloudflareDriver(credentials, async () => { throw Object.assign(new Error('secret timeout'), { name: 'TimeoutError' }) }).testConnection(), 'UPSTREAM_TIMEOUT')
})

test('rejects oversized declared and streamed bodies, and malformed provider payloads', async () => {
  const tooLargeDeclared = new Response('{}', { status: 200, headers: { 'content-length': String(256 * 1024 + 1) } })
  await errorCode(new CloudflareDriver(credentials, async () => tooLargeDeclared).testConnection(), 'INVALID_RESPONSE')
  const oversized = new ReadableStream({ start(controller) { controller.enqueue(new Uint8Array(200 * 1024)); controller.enqueue(new Uint8Array(70 * 1024)); controller.close() } })
  await errorCode(new CloudflareDriver(credentials, async () => new Response(oversized, { status: 200 })).testConnection(), 'INVALID_RESPONSE')
  await errorCode(new CloudflareDriver(credentials, async () => jsonResponse({ success: false, errors: [{ message: 'secret body' }] })).testConnection(), 'INVALID_RESPONSE')
  await errorCode(new CloudflareDriver(credentials, async () => jsonResponse({ success: true, result: { name: 'https://evil.test', status: 'active' } })).testConnection(), 'INVALID_RESPONSE')
})

test('domain projection drops unsafe names, unknown statuses, and all non-whitelisted fields', async () => {
  const secret = 'fixture-secret-must-never-appear'
  const driver = new CloudflareDriver(credentials, async () => jsonResponse({
    success: true,
    result: [
      { id: 'ok', hostname: 'valid.example', status: 'pending_validation', ssl: { status: 'pending_validation', custom_key: secret }, cname_target: 'origin.example.net', ownership_verification: secret },
      { id: 'wild', hostname: '*.wild.example', status: 'active' },
      { id: 'url', hostname: 'https://evil.example', status: 'active' },
      { id: 'ip', hostname: '127.0.0.1', status: 'active' },
      { id: 'bad-status', hostname: 'badstatus.example', status: secret },
      { id: 'long-id', hostname: 'longid.example', status: 'active', id: 'x'.repeat(129) },
      { id: 'ssl-extra', hostname: 'sslextra.example', status: 'active', ssl: { status: 'made_up', custom_certificate: secret } },
    ],
    result_info: { page: 1, total_pages: 1 },
  }))
  const result = await driver.listDomains()
  assert.deepEqual(result.items, [
    { externalId: 'ok', hostname: 'valid.example', cname: 'origin.example.net', providerStatus: 'pending_validation', sslStatus: 'pending_validation' },
    { externalId: 'ssl-extra', hostname: 'sslextra.example', cname: null, providerStatus: 'active' },
  ])
  assert.equal(JSON.stringify(result).includes(secret), false)
})

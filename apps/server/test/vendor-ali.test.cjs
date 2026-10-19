const test = require('node:test')
const assert = require('node:assert/strict')
const { AliDriver } = require('../dist/modules/vendor/drivers/ali.driver.js')
const { VendorDriverError } = require('../dist/modules/vendor/drivers/vendor-driver.js')

const credentials = { accessKey: 'test-access-key', secretKey: 'test-secret-key', config: {} }
const domain = (overrides = {}) => ({
  domainId: 12345,
  domainName: 'WWW.Example.COM',
  cname: 'edge.example-cdn.test',
  domainStatus: 'online',
  sslProtocol: 'on',
  ...overrides,
})
const response = (pageData = [], totalCount = pageData.length) => ({
  body: { domains: { pageData }, totalCount },
})
const requestShape = (request) => ({ pageNumber: request.pageNumber, pageSize: request.pageSize })

function mockDriver(handler) {
  const calls = []
  let configSeen
  const driver = new AliDriver(credentials, (config) => {
    configSeen = config
    return {
      describeUserDomainsWithOptions: async (request, runtime) => {
        calls.push({ request, runtime })
        return handler(request, runtime, calls.length)
      },
    }
  })
  return { driver, calls, getConfig: () => configSeen }
}

test('testConnection uses the SDK WithOptions read-only query and explicit fixed endpoint/credentials', async () => {
  const { driver, calls, getConfig } = mockDriver(() => response([domain()], 1))
  const result = await driver.testConnection()
  assert.equal(result.connected, true)
  assert.equal(result.provider, 'ali')
  assert.match(result.checkedAt, /^\d{4}-\d\d-\d\dT/)
  assert.deepEqual(requestShape(calls[0].request), { pageNumber: 1, pageSize: 1 })
  assert.deepEqual(calls[0].runtime, {
    connectTimeout: 10_000,
    readTimeout: 10_000,
    autoretry: false,
    maxAttempts: 1,
  })
  const config = getConfig()
  assert.equal(config.accessKeyId, credentials.accessKey)
  assert.equal(config.accessKeySecret, credentials.secretKey)
  assert.equal(config.endpoint, 'cdn.aliyuncs.com')
  assert.equal(config.regionId, undefined)
  assert.equal(config.httpProxy, undefined)
  assert.equal(config.httpsProxy, undefined)
})

test('listDomains maps only safe fields, preserves real status and advances a decimal page cursor', async () => {
  const { driver, calls } = mockDriver((request) => request.pageNumber === 1
    ? response([domain({
      privateKey: 'PRIVATE_KEY_FIXTURE',
      token: 'TOKEN_FIXTURE',
      accessKeySecret: 'SECRET_FIXTURE',
      certificate: 'CERTIFICATE_FIXTURE',
      arbitraryVendorField: 'MUST_NOT_ESCAPE',
    })], 51)
    : response([domain({ domainId: 678, domainStatus: 'configuring', sslProtocol: 'off' })], 51))

  const first = await driver.listDomains()
  assert.deepEqual(first, {
    items: [{
      externalId: '12345',
      hostname: 'www.example.com',
      cname: 'edge.example-cdn.test',
      providerStatus: 'online',
      sslStatus: 'on',
    }],
    nextCursor: '2',
  })
  assert.deepEqual(requestShape(calls[0].request), { pageNumber: 1, pageSize: 50 })

  const second = await driver.listDomains(first.nextCursor)
  assert.equal(second.nextCursor, null)
  assert.equal(second.items[0].providerStatus, 'configuring')
  assert.equal(second.items[0].sslStatus, 'off')
  assert.deepEqual(requestShape(calls[1].request), { pageNumber: 2, pageSize: 50 })
  assert.equal(JSON.stringify(first).includes('FIXTURE'), false)
})

test('preserves offline state and normalizes internationalized domain names', async () => {
  const { driver } = mockDriver(() => response([domain({
    domainName: '例え.テスト',
    domainStatus: 'offline',
    cname: null,
    sslProtocol: undefined,
  })], 1))
  const page = await driver.listDomains()
  assert.equal(page.items[0].hostname, 'xn--r8jz45g.xn--zckzah')
  assert.equal(page.items[0].providerStatus, 'offline')
  assert.equal(page.items[0].cname, null)
  assert.equal('sslStatus' in page.items[0], false)
})

test('invalid provider payloads reject unsafe IDs, hostnames and unbounded states', async () => {
  for (const unsafeDomain of [
    domain({ domainId: Number.MAX_SAFE_INTEGER + 1 }),
    domain({ domainId: '1'.repeat(129) }),
    domain({ domainName: 'https://example.com/path' }),
    domain({ domainName: '*.example.com' }),
    domain({ domainName: '127.0.0.1' }),
    domain({ domainStatus: 'online; leaked-secret' }),
    domain({ sslProtocol: 'private-key-value' }),
  ]) {
    const { driver } = mockDriver(() => response([unsafeDomain], 1))
    await assert.rejects(driver.listDomains(), (error) => error instanceof VendorDriverError && error.safeCode === 'INVALID_RESPONSE')
  }
})

test('authentication errors map to a safe code without exposing SDK error details', async () => {
  const { driver } = mockDriver(() => {
    const error = new Error('AK_SECRET_SHOULD_NEVER_ESCAPE')
    error.statusCode = 403
    error.code = 'Forbidden.AccessDenied'
    error.request = { secret: 'REQUEST_SECRET_FIXTURE' }
    throw error
  })
  await assert.rejects(driver.testConnection(), (error) => {
    assert.equal(error.safeCode, 'AUTH_FAILED')
    assert.equal(error.message, 'AUTH_FAILED')
    assert.equal(error.request, undefined)
    assert.equal(error.message.includes('SECRET'), false)
    return true
  })

  const unauthorized = mockDriver(() => { throw Object.assign(new Error('secret'), { statusCode: 401 }) }).driver
  await assert.rejects(unauthorized.testConnection(), (error) => error.safeCode === 'AUTH_FAILED' && error.message === 'AUTH_FAILED')
})

test('throttling and timeouts map to stable safe codes', async () => {
  const throttled = mockDriver(() => { throw Object.assign(new Error('raw'), { code: 'Throttling.User' }) }).driver
  await assert.rejects(throttled.testConnection(), (error) => error.safeCode === 'RATE_LIMITED' && error.message === 'RATE_LIMITED')

  const timeout = mockDriver(() => { throw Object.assign(new Error('raw'), { name: 'TimeoutError' }) }).driver
  await assert.rejects(timeout.testConnection(), (error) => error.safeCode === 'UPSTREAM_TIMEOUT' && error.message === 'UPSTREAM_TIMEOUT')
})

test('rejects custom config, missing explicit keys, and cursors outside the documented page range', async () => {
  assert.throws(() => new AliDriver({ ...credentials, config: { zoneId: 'not-supported' } }), (error) => error.safeCode === 'INVALID_CONFIG')
  assert.throws(() => new AliDriver({ ...credentials, accessKey: '' }), (error) => error.safeCode === 'INVALID_CONFIG')
  assert.throws(() => new AliDriver({ ...credentials, secretKey: '  ' }), (error) => error.safeCode === 'INVALID_CONFIG')

  const { driver } = mockDriver(() => response([], 0))
  for (const cursor of ['', '0', '01', '+1', '1.0', '100001', '999999999999999999999']) {
    await assert.rejects(driver.listDomains(cursor), (error) => error.safeCode === 'INVALID_CONFIG')
  }
  assert.equal((await driver.listDomains('100000')).nextCursor, null)
})

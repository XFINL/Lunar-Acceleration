const test = require('node:test')
const assert = require('node:assert/strict')
const { CloudflareDriver } = require('../dist/modules/vendor/drivers/cloudflare.driver.js')
const { AliDriver } = require('../dist/modules/vendor/drivers/ali.driver.js')
const { VendorDriverError } = require('../dist/modules/vendor/drivers/vendor-driver.js')
const CdnSdkClient = require('@alicloud/cdn20180510').default

const zoneId = '0123456789abcdef0123456789abcdef'
const cfCredentials = { accessKey: 'fake-cf-token', secretKey: 'unused', config: { zoneId } }
const aliCredentials = { accessKey: 'fake-ali-ak', secretKey: 'fake-ali-sk', config: {} }
const cfJson = (body, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { 'content-type': 'application/json' },
})
const cfOk = (result, extra = {}) => ({ success: true, result, ...extra })
const input = { hostname: 'Example.COM', origin: { address: 'origin.example.net', port: 443, protocol: 'https' } }
const safeError = async (promise, code) => assert.rejects(promise, (error) => {
  assert.ok(error instanceof VendorDriverError)
  assert.equal(error.safeCode, code)
  assert.equal(error.message, code)
  return true
})

function mockAli({ domains = [], onAdd, onDelete } = {}) {
  const calls = []
  let config
  const driver = new AliDriver(aliCredentials, (sdkConfig) => {
    config = sdkConfig
    return {
      describeUserDomainsWithOptions: async (request, runtime) => {
        calls.push({ action: 'DescribeUserDomains', request, runtime })
        return { body: { domains: { pageData: domains }, totalCount: domains.length } }
      },
      addCdnDomainWithOptions: async (request, runtime) => {
        calls.push({ action: 'AddCdnDomain', request, runtime })
        return onAdd ? onAdd(request, runtime) : { body: { requestId: 'fake-request-id' } }
      },
      deleteCdnDomainWithOptions: async (request, runtime) => {
        calls.push({ action: 'DeleteCdnDomain', request, runtime })
        return onDelete ? onDelete(request, runtime) : { body: { requestId: 'fake-delete-id' } }
      },
    }
  })
  return { driver, calls, getConfig: () => config }
}

test('Cloudflare sends exact fixed-zone create custom-hostname HTTP request after exact conflict preflight', async () => {
  const seen = []
  const driver = new CloudflareDriver(cfCredentials, async (url, init) => {
    seen.push({ url: new URL(url), init })
    if (init.method === 'GET' && new URL(url).pathname.endsWith('/custom_hostnames')) {
      assert.equal(new URL(url).searchParams.get('hostname'), 'example.com')
      return cfJson(cfOk([], { result_info: { page: 1, total_pages: 1 } }))
    }
    assert.equal(init.method, 'POST')
    assert.equal(new URL(url).pathname, `/client/v4/zones/${zoneId}/custom_hostnames`)
    assert.equal(init.headers['Content-Type'], 'application/json')
    assert.deepEqual(JSON.parse(init.body), {
      hostname: 'example.com',
      custom_origin_server: 'origin.example.net',
    })
    return cfJson(cfOk({ id: 'cf-custom-host-id', hostname: 'example.com', status: 'pending_validation' }))
  })
  const result = await driver.registerDomain(input)
  assert.deepEqual(result, {
    externalId: 'cf-custom-host-id', hostname: 'example.com', cname: null, providerStatus: 'pending_validation',
  })
  assert.equal(seen.length, 2)
  assert.equal(seen[0].init.method, 'GET')
  assert.equal(seen[1].init.method, 'POST')
  assert.equal(seen.every(({ init }) => init.redirect === 'error' && init.signal instanceof AbortSignal), true)
})

test('Cloudflare refuses unsupported origin settings and existing hostnames without writing', async () => {
  let calls = 0
  const driver = new CloudflareDriver(cfCredentials, async () => { calls++; return cfJson(cfOk([])) })
  await safeError(driver.registerDomain({ ...input, origin: { ...input.origin, protocol: 'http' } }), 'UNSUPPORTED_OPERATION')
  await safeError(driver.registerDomain({ ...input, origin: { ...input.origin, port: 8443 } }), 'UNSUPPORTED_OPERATION')
  await safeError(driver.registerDomain({ ...input, origin: { address: '192.0.2.1', port: 443, protocol: 'https' } }), 'INVALID_CONFIG')
  assert.equal(calls, 0)

  const existing = new CloudflareDriver(cfCredentials, async () => cfJson(cfOk([
    { id: 'already-there', hostname: 'example.com', status: 'active' },
  ])))
  await safeError(existing.registerDomain(input), 'RESOURCE_CONFLICT')

  let creates = 0
  const paginated = new CloudflareDriver(cfCredentials, async (url, init) => {
    if (init.method === 'POST') creates++
    const page = Number(new URL(url).searchParams.get('page'))
    return cfJson(cfOk(page === 1 ? [] : [{ id: 'later', hostname: 'example.com', status: 'active' }], {
      result_info: { page, total_pages: 2 },
    }))
  })
  await safeError(paginated.registerDomain(input), 'RESOURCE_CONFLICT')
  assert.equal(creates, 0)
})

test('Cloudflare deletion GET-verifies ID/hostname, uses DELETE, and treats only 404 as already absent', async () => {
  const seen = []
  const driver = new CloudflareDriver(cfCredentials, async (url, init) => {
    seen.push({ url: new URL(url), init })
    if (init.method === 'GET') return cfJson(cfOk({ id: 'cf-managed-id', hostname: 'example.com' }))
    assert.equal(init.method, 'DELETE')
    assert.equal(new URL(url).pathname, `/client/v4/zones/${zoneId}/custom_hostnames/cf-managed-id`)
    return cfJson(cfOk({ id: 'cf-managed-id' }))
  })
  await driver.deleteManagedDomain('cf-managed-id', 'example.com')
  assert.deepEqual(seen.map(x => x.init.method), ['GET', 'DELETE'])

  let deletes = 0
  const mismatch = new CloudflareDriver(cfCredentials, async (_url, init) => {
    if (init.method === 'DELETE') deletes++
    return cfJson(cfOk({ id: 'id', hostname: 'other.example' }))
  })
  await safeError(mismatch.deleteManagedDomain('id', 'example.com'), 'RESOURCE_CONFLICT')
  assert.equal(deletes, 0)

  const gone = new CloudflareDriver(cfCredentials, async () => new Response('', { status: 404 }))
  await gone.deleteManagedDomain('gone-id', 'example.com')
})

test('Alibaba AddCdnDomain uses official SDK request fields and accurate natural external ID', async () => {
  const { driver, calls, getConfig } = mockAli()
  const result = await driver.registerDomain({ hostname: 'EXAMPLE.com', origin: { address: '192.0.2.20', port: 80, protocol: 'http' } })
  assert.deepEqual(result, { externalId: 'example.com', hostname: 'example.com', cname: null, providerStatus: 'configuring' })
  assert.equal(calls.map(c => c.action).join(','), 'DescribeUserDomains,AddCdnDomain')
  const preflight = calls[0].request
  assert.equal(preflight.domainName, 'example.com')
  assert.equal(preflight.domainSearchType, 'full_match')
  assert.equal(preflight.pageNumber, 1)
  const add = calls[1].request
  assert.equal(add.domainName, 'example.com')
  assert.equal(add.cdnType, 'web')
  assert.deepEqual(JSON.parse(add.sources), [{ content: '192.0.2.20', type: 'ipaddr', priority: '20', port: 80, weight: '10' }])
  assert.deepEqual(calls[1].runtime, { connectTimeout: 10_000, readTimeout: 10_000, autoretry: false, maxAttempts: 1 })
  assert.equal(getConfig().endpoint, 'cdn.aliyuncs.com')
  assert.equal(getConfig().accessKeyId, aliCredentials.accessKey)
  assert.equal(getConfig().accessKeySecret, aliCredentials.secretKey)
})

test('Alibaba generated SDK emits the documented RPC POST / Add and Delete actions using fake callApi only', async () => {
  const calls = []
  let added = false
  const driver = new AliDriver(aliCredentials, config => {
    const sdk = new CdnSdkClient(config)
    sdk.describeUserDomainsWithOptions = async () => ({ body: {
      domains: { pageData: added ? [{ domainName: 'example.com' }] : [] }, totalCount: added ? 1 : 0,
    } })
    sdk.callApi = async (params, request, runtime) => {
      calls.push({ params, request, runtime })
      if (params.action === 'AddCdnDomain') added = true
      if (params.action === 'DeleteCdnDomain') added = false
      return { body: { RequestId: 'fake-request-id' } }
    }
    return sdk
  })
  await driver.registerDomain(input)
  await driver.deleteManagedDomain('example.com', 'example.com')
  assert.deepEqual(calls.map(({ params }) => ({
    action: params.action, version: params.version, protocol: params.protocol,
    pathname: params.pathname, method: params.method, authType: params.authType,
    style: params.style, reqBodyType: params.reqBodyType,
  })), [
    { action: 'AddCdnDomain', version: '2018-05-10', protocol: 'HTTPS', pathname: '/', method: 'POST', authType: 'AK', style: 'RPC', reqBodyType: 'formData' },
    { action: 'DeleteCdnDomain', version: '2018-05-10', protocol: 'HTTPS', pathname: '/', method: 'POST', authType: 'AK', style: 'RPC', reqBodyType: 'formData' },
  ])
  assert.deepEqual(calls[0].request.query, {
    CdnType: 'web', DomainName: 'example.com',
    Sources: JSON.stringify([{ content: 'origin.example.net', type: 'domain', priority: '20', port: 443, weight: '10' }]),
  })
  assert.deepEqual(calls[1].request.query, { DomainName: 'example.com' })
  assert.equal(calls.every(call => call.runtime.autoretry === false && call.runtime.maxAttempts === 1), true)
})

test('Alibaba rejects unsupported origin protocol/ports and does not claim an existing hostname', async () => {
  const { driver, calls } = mockAli()
  await safeError(driver.registerDomain({ ...input, origin: { ...input.origin, protocol: 'http', port: 443 } }), 'UNSUPPORTED_OPERATION')
  await safeError(driver.registerDomain({ ...input, origin: { ...input.origin, port: 8080 } }), 'UNSUPPORTED_OPERATION')
  await safeError(driver.registerDomain({ ...input, origin: { ...input.origin, address: 'https://origin.example.net' } }), 'INVALID_CONFIG')
  assert.equal(calls.length, 0)

  const conflict = mockAli({ domains: [{ domainName: 'example.com', domainStatus: 'online' }] })
  await safeError(conflict.driver.registerDomain(input), 'RESOURCE_CONFLICT')
  assert.deepEqual(conflict.calls.map(c => c.action), ['DescribeUserDomains'])
})

test('Alibaba delete requires external ID to equal hostname, verifies existence, uses DomainName, and is idempotent if gone', async () => {
  const { driver, calls } = mockAli({ domains: [{ domainName: 'example.com' }] })
  await driver.deleteManagedDomain('example.com', 'EXAMPLE.com')
  assert.deepEqual(calls.map(c => c.action), ['DescribeUserDomains', 'DeleteCdnDomain'])
  assert.equal(calls[0].request.domainSearchType, 'full_match')
  assert.equal(calls[1].request.domainName, 'example.com')
  assert.deepEqual(calls[1].runtime, { connectTimeout: 10_000, readTimeout: 10_000, autoretry: false, maxAttempts: 1 })

  const mismatch = mockAli({ domains: [{ domainName: 'example.com' }] })
  await safeError(mismatch.driver.deleteManagedDomain('different.example', 'example.com'), 'RESOURCE_CONFLICT')
  assert.equal(mismatch.calls.length, 0)
  const alreadyGone = mockAli()
  await alreadyGone.driver.deleteManagedDomain('example.com', 'example.com')
  assert.deepEqual(alreadyGone.calls.map(c => c.action), ['DescribeUserDomains'])
})

test('write timeouts are safe and are never retried or followed by a second create', async () => {
  let creates = 0
  const cloudflare = new CloudflareDriver(cfCredentials, async (url, init) => {
    if (init.method === 'GET') return cfJson(cfOk([]))
    creates++
    throw Object.assign(new Error('leaked fake bearer token'), { name: 'TimeoutError' })
  })
  await safeError(cloudflare.registerDomain(input), 'UPSTREAM_TIMEOUT')
  assert.equal(creates, 1)

  let adds = 0
  const ali = mockAli({ onAdd: async () => {
    adds++
    throw Object.assign(new Error('fake-secret must not escape'), { name: 'TimeoutError' })
  } })
  await safeError(ali.driver.registerDomain(input), 'UPSTREAM_TIMEOUT')
  assert.equal(adds, 1)
  assert.equal(JSON.stringify(ali.calls).includes('fake-secret'), false)
})

test('Alibaba rejects oversized SDK responses before exposing projected write results', async () => {
  const oversized = mockAli({ onAdd: async () => ({ body: { requestId: 'fake-id', detail: 'x'.repeat(300 * 1024) } }) })
  await safeError(oversized.driver.registerDomain(input), 'INVALID_RESPONSE')
})

test('unknown upstream failures are not swallowed and all vendor details stay redacted', async () => {
  const cloudflare = new CloudflareDriver(cfCredentials, async (url, init) => {
    if (init.method === 'GET') return cfJson(cfOk([]))
    return new Response('TOKEN_PRIVATE_RESPONSE', { status: 503 })
  })
  await safeError(cloudflare.registerDomain(input), 'UPSTREAM_ERROR')

  const secretMessage = 'AK_SECRET_PRIVATE_DETAIL'
  const failedDelete = mockAli({ domains: [{ domainName: 'example.com' }], onDelete: async () => {
    throw Object.assign(new Error(secretMessage), { statusCode: 500, request: { secret: 'another-secret' } })
  } })
  await assert.rejects(failedDelete.driver.deleteManagedDomain('example.com', 'example.com'), error => {
    assert.equal(error.safeCode, 'UPSTREAM_ERROR')
    assert.equal(error.message, 'UPSTREAM_ERROR')
    assert.equal(error.request, undefined)
    assert.equal(JSON.stringify(error).includes(secretMessage), false)
    return true
  })
})

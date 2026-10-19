const test = require('node:test')
const assert = require('node:assert/strict')
const { readFileSync } = require('node:fs')
const { createHash, X509Certificate } = require('node:crypto')
const { CloudflareDriver } = require('../dist/modules/vendor/drivers/cloudflare.driver.js')
const { AliDriver } = require('../dist/modules/vendor/drivers/ali.driver.js')
const { VendorDriverError } = require('../dist/modules/vendor/drivers/vendor-driver.js')

const zoneId = '0123456789abcdef0123456789abcdef'
const certPem = readFileSync(`${__dirname}/fixtures/driver-test-cert.pem`, 'utf8')
const otherCertPem = readFileSync(`${__dirname}/fixtures/driver-other-cert.pem`, 'utf8')
const privateKeyPem = readFileSync(`${__dirname}/fixtures/driver-test-key.pem`, 'utf8')
const certFingerprint = createHash('sha256').update(new X509Certificate(certPem).raw).digest('hex')
const config = (overrides = {}) => ({
  hostname: 'example.com',
  origin: { address: 'origin.example.net', protocol: 'https', port: 443 },
  defaultTtl: 3600,
  tls: { enabled: true, certId: 'test-cert', forceHttps: false, hstsEnabled: false, tlsVersion: 'TLSv1.2' },
  certificate: { certificatePem: certPem, privateKeyPem },
  ...overrides,
})
const cfCredentials = { accessKey: 'fake-token', secretKey: '', config: { zoneId } }
const cfJson = value => new Response(JSON.stringify({ success: true, result: value }), { status: 200, headers: { 'content-type': 'application/json' } })
const safeError = async (promise, code) => assert.rejects(promise, error => {
  assert.ok(error instanceof VendorDriverError)
  assert.equal(error.safeCode, code)
  assert.equal(error.message, code)
  assert.equal(JSON.stringify(error).includes(privateKeyPem), false)
  return true
})

test('Cloudflare deploy serializes source/cache/TLS, preserves unrelated rules, and verifies the uploaded certificate fingerprint', async () => {
  const calls = []
  const unrelated = { id: 'existing-rule', action: 'skip', expression: '(http.host eq "unrelated.example")', enabled: true, version: '3', ref: 'keep-me' }
  const rules = [unrelated]
  const host = { id: 'managed-host-id', hostname: 'example.com', custom_origin_server: 'origin.example.net', status: 'active', ssl: {
    status: 'active', custom_certificates: [{ fingerprint: certFingerprint }],
  } }
  const driver = new CloudflareDriver(cfCredentials, async (url, init) => {
    const parsed = new URL(url)
    const path = parsed.pathname
    calls.push({ path, method: init.method, body: init.body ? JSON.parse(init.body) : undefined })
    if (path.endsWith('/custom_hostnames/managed-host-id')) {
      if (init.method === 'PATCH') {
        const body = JSON.parse(init.body)
        assert.deepEqual(body, { custom_origin_server: 'origin.example.net', ssl: { custom_certificate: certPem, custom_key: privateKeyPem } })
        host.custom_origin_server = body.custom_origin_server
        return cfJson({ id: host.id })
      }
      return cfJson(host)
    }
    if (path.endsWith('/rulesets/phases/http_request_cache_settings/entrypoint')) return cfJson({ id: 'cache-ruleset-id', rules })
    if (path.endsWith('/rulesets/cache-ruleset-id/rules') && init.method === 'POST') {
      rules.push({ ...JSON.parse(init.body), id: 'lunar-rule-id' })
      return cfJson({ id: 'cache-ruleset-id', rules })
    }
    throw new Error(`Unexpected local mock request ${init.method} ${path}`)
  })

  assert.equal(await driver.deployManagedConfig('managed-host-id', config()), undefined)
  assert.deepEqual(rules[0], unrelated)
  assert.equal(rules.length, 2)
  assert.equal(rules[1].expression, '(http.host eq "example.com")')
  assert.equal(rules[1].action_parameters.edge_ttl.default, 3600)
  assert.deepEqual(calls.map(call => call.method), ['GET', 'GET', 'PATCH', 'POST'])
  assert.ok(calls.every(call => !call.path.includes('undefined')))

  const verified = await driver.verifyManagedConfig('managed-host-id', config())
  assert.equal(verified.verified, true)
  assert.deepEqual(verified.applied, ['origin', 'cache', 'certificate'])
})

test('Cloudflare rejects unsupported TTL before writes and blocks a conflicting managed rule before source mutation', async () => {
  let writes = 0
  const noRequests = new CloudflareDriver(cfCredentials, async (_url, init) => { if (init.method !== 'GET') writes++; return cfJson({}) })
  await safeError(noRequests.deployManagedConfig('managed-host-id', config({ defaultTtl: 0 })), 'UNSUPPORTED_OPERATION')
  assert.equal(writes, 0)

  const calls = []
  const conflictDriver = new CloudflareDriver(cfCredentials, async (url, init) => {
    calls.push(init.method)
    if (new URL(url).pathname.endsWith('/custom_hostnames/managed-host-id')) return cfJson({ id: 'managed-host-id', hostname: 'example.com' })
    return cfJson({ id: 'cache-ruleset-id', rules: [{ description: 'Lunar managed cache TTL: example.com', expression: 'different', action: 'set_cache_settings' }] })
  })
  await safeError(conflictDriver.deployManagedConfig('managed-host-id', config()), 'RESOURCE_CONFLICT')
  assert.deepEqual(calls, ['GET', 'GET'])
})

test('Cloudflare refuses certificate readback with the wrong fingerprint and redacts transport details', async () => {
  const wrong = new CloudflareDriver(cfCredentials, async () => cfJson({ id: 'managed-host-id', hostname: 'example.com', custom_origin_server: 'origin.example.net', status: 'active', ssl: { status: 'active', custom_certificates: [{ fingerprint: '00'.repeat(32) }] } }))
  await safeError(wrong.verifyManagedConfig('managed-host-id', config()), 'UPSTREAM_ERROR')

  const leaking = new CloudflareDriver(cfCredentials, async () => { throw new Error(`upstream echoed ${privateKeyPem}`) })
  await safeError(leaking.verifyManagedConfig('managed-host-id', config()), 'UPSTREAM_ERROR')
})

function mockAli(options = {}) {
  const calls = []
  const state = {
    source: { content: 'origin.example.net', type: 'domain', port: 443 },
    certificate: certPem,
    ttl: '3600',
    cachePresent: false,
  }
  const client = {
    describeUserDomainsWithOptions: async () => ({ body: { domains: { pageData: [] }, totalCount: 0 } }),
    describeCdnDomainDetailWithOptions: async (request) => {
      calls.push({ action: 'DescribeCdnDomainDetail', request })
      return { body: { getDomainDetailModel: { domainName: 'example.com', domainStatus: 'online', sourceModels: { sourceModel: [state.source] } } } }
    },
    describeCdnDomainConfigsWithOptions: async (request) => {
      calls.push({ action: 'DescribeCdnDomainConfigs', request })
      const records = state.cachePresent ? [
        { functionName: 'path_based_ttl_set', status: 'success', functionArgs: { functionArg: [
          { argName: 'path', argValue: '/' }, { argName: 'ttl', argValue: state.ttl },
          { argName: 'weight', argValue: '99' },
          ...['swift_origin_cache_high', 'swift_no_cache_low', 'swift_follow_cachetime', 'force_revalidate'].map(argName => ({ argName, argValue: options.cacheFlag === argName ? 'on' : 'off' })),
        ] } },
      ] : []
      if (options.originPolicy) records.push({ functionName: 'forward_scheme', status: 'success', functionArgs: { functionArg: [{ argName: 'enable', argValue: 'on' }, { argName: 'scheme_origin', argValue: options.originPolicy }] } })
      return { body: { domainConfigs: { domainConfig: records } } }
    },
    modifyCdnDomainWithOptions: async (request) => {
      calls.push({ action: 'ModifyCdnDomain', request })
      state.source = JSON.parse(request.sources)[0]
      return { body: { requestId: 'modify-id' } }
    },
    batchSetCdnDomainConfigWithOptions: async (request) => {
      calls.push({ action: 'BatchSetCdnDomainConfig', request })
      const funcs = JSON.parse(request.functions)
      state.ttl = funcs[0].functionArgs.find(arg => arg.argName === 'ttl').argValue
      state.cachePresent = true
      return { body: { requestId: 'cache-id', domainConfigList: { domainConfigModel: [{ configId: 'new-config' }] } } }
    },
    setCdnDomainSSLCertificateWithOptions: async request => {
      calls.push({ action: 'SetCdnDomainSSLCertificate', request })
      state.certificate = request.SSLPub
      return { body: { requestId: 'tls-id' } }
    },
    describeDomainCertificateInfoWithOptions: async request => {
      calls.push({ action: 'DescribeDomainCertificateInfo', request })
      const cert = options.readbackCert ?? state.certificate
      return { body: { certInfos: { certInfo: [{ domainName: 'example.com', serverCertificateStatus: 'on', serverCertificate: cert }] } } }
    },
  }
  const driver = new AliDriver({ accessKey: 'fake-ak', secretKey: 'fake-sk', config: {} }, () => client)
  return { driver, calls, state }
}

test('Alibaba deploy serializes origin/cache/TLS, then explicit readback verifies certificate content fingerprint', async () => {
  const { driver, calls } = mockAli()
  assert.equal(await driver.deployManagedConfig('example.com', config()), undefined)
  const actions = calls.map(call => call.action)
  assert.deepEqual(actions, ['DescribeCdnDomainDetail', 'DescribeCdnDomainConfigs', 'ModifyCdnDomain', 'BatchSetCdnDomainConfig', 'SetCdnDomainSSLCertificate'])
  assert.deepEqual(JSON.parse(calls.find(call => call.action === 'ModifyCdnDomain').request.sources), [
    { content: 'origin.example.net', type: 'domain', priority: '20', port: 443, weight: '10' },
  ])
  const ttlWrite = JSON.parse(calls.find(call => call.action === 'BatchSetCdnDomainConfig').request.functions)[0]
  assert.equal(ttlWrite.functionName, 'path_based_ttl_set')
  assert.deepEqual(ttlWrite.functionArgs.slice(0, 3), [
    { argName: 'path', argValue: '/' }, { argName: 'ttl', argValue: '3600' }, { argName: 'weight', argValue: '99' },
  ])
  const result = await driver.verifyManagedConfig('example.com', config())
  assert.equal(result.verified, true)
  assert.deepEqual(result.applied, ['origin', 'cache', 'certificate'])
  assert.equal(calls.find(call => call.action === 'DescribeDomainCertificateInfo').request.domainName, 'example.com')
})

test('Alibaba rejects conflicting root cache TTL and unsupported TTL before any write', async () => {
  const conflict = mockAli()
  conflict.state.ttl = '900'
  conflict.state.cachePresent = true
  await safeError(conflict.driver.deployManagedConfig('example.com', config()), 'RESOURCE_CONFLICT')
  assert.deepEqual(conflict.calls.map(call => call.action), ['DescribeCdnDomainDetail', 'DescribeCdnDomainConfigs'])

  const unsupported = mockAli()
  await safeError(unsupported.driver.deployManagedConfig('example.com', config({ defaultTtl: 0 })), 'UNSUPPORTED_OPERATION')
  assert.equal(unsupported.calls.length, 0)
})

test('Alibaba refuses wrong certificate readback and never leaks upstream secret details', async () => {
  const mismatch = mockAli({ readbackCert: otherCertPem })
  await safeError(mismatch.driver.verifyManagedConfig('example.com', config()), 'UPSTREAM_ERROR')

  const leaking = mockAli()
  leaking.driver.client.describeCdnDomainDetailWithOptions = async () => { throw new Error(`provider echoed ${privateKeyPem}`) }
  await safeError(leaking.driver.deployManagedConfig('example.com', config()), 'UPSTREAM_ERROR')

  const failedReadback = mockAli()
  failedReadback.driver.client.describeDomainCertificateInfoWithOptions = async () => { throw new Error(`provider echoed ${privateKeyPem}`) }
  await safeError(failedReadback.driver.verifyManagedConfig('example.com', config()), 'UPSTREAM_ERROR')
})

test('Cloudflare never verifies a disabled cache rule or one that respects origin TTL instead of overriding it', async () => {
  for (const [enabled, mode] of [[false, 'override_origin'], [true, 'respect_origin']]) {
    const driver = new CloudflareDriver(cfCredentials, async url => {
      if (new URL(url).pathname.includes('/custom_hostnames/')) return cfJson({ id: 'managed-host-id', hostname: 'example.com', custom_origin_server: 'origin.example.net', status: 'active' })
      return cfJson({ id: 'cache-ruleset-id', rules: [{ description: 'Lunar managed cache TTL: example.com', expression: '(http.host eq "example.com")', action: 'set_cache_settings', enabled, action_parameters: { cache: true, edge_ttl: { mode, default: 3600 } } }] })
    })
    await safeError(driver.verifyManagedConfig('managed-host-id', config({ tls: { enabled: false } })), 'UPSTREAM_ERROR')
  }
})

test('Alibaba rejects origin protocol overrides before writes and refuses cache readback with conflicting origin-header flags', async () => {
  const policy = mockAli({ originPolicy: 'http' })
  await safeError(policy.driver.deployManagedConfig('example.com', config()), 'RESOURCE_CONFLICT')
  assert.equal(policy.calls.some(call => ['ModifyCdnDomain', 'BatchSetCdnDomainConfig', 'SetCdnDomainSSLCertificate'].includes(call.action)), false)
  assert.match(policy.calls.find(call => call.action === 'DescribeCdnDomainConfigs').request.functionNames, /forward_scheme/)
  const flags = mockAli({ cacheFlag: 'swift_origin_cache_high' })
  flags.state.cachePresent = true
  await safeError(flags.driver.verifyManagedConfig('example.com', config()), 'UPSTREAM_ERROR')
})

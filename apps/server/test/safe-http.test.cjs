const test = require('node:test')
const assert = require('node:assert/strict')
const { safeHttpProbe, isPublicAddress } = require('../dist/shared/http/safe-http.js')

const publicDns = async () => [{ address: '8.8.8.8', family: 4 }]

test('safe HTTP probe rejects every non-public DNS answer and never opens transport', async () => {
  for (const address of ['127.0.0.1', '10.0.0.1', '169.254.1.2', '224.0.0.1', '::1', '::ffff:8.8.8.8']) {
    let called = false
    const result = await safeHttpProbe({ address: 'origin.example.com', port: 443, protocol: 'https', path: '/' }, {
      resolver: async () => [{ address, family: address.includes(':') ? 6 : 4 }],
      transport: async () => { called = true; return 200 },
    })
    assert.equal(result.errorCode, 'BLOCKED_ADDRESS', address)
    assert.equal(called, false)
  }
})

test('safe HTTP probe validates all records and pins approved addresses into transport', async () => {
  let request
  const result = await safeHttpProbe({ address: 'origin.example.com', port: 443, protocol: 'https', hostHeader: 'www.example.com', path: '/health' }, {
    resolver: async host => { assert.equal(host, 'origin.example.com'); return [{ address: '8.8.8.8', family: 4 }, { address: '2606:4700:4700::1111', family: 6 }] },
    transport: async options => { request = options; return 204 },
  })
  assert.equal(result.statusCode, 204)
  assert.equal(request.addresses.length, 2)
  assert.equal(request.hostname, 'origin.example.com')
  assert.equal(request.servername, 'www.example.com')
  assert.equal(request.hostHeader, 'www.example.com')
  assert.ok(request.timeoutMs > 0 && request.timeoutMs <= 3000)
})

test('redirects are returned as status codes and not followed; errors are sanitized', async () => {
  const redirect = await safeHttpProbe({ address: 'origin.example.com', port: 80, protocol: 'http', path: '/' }, { resolver: publicDns, transport: async () => 302 })
  assert.deepEqual(Object.keys(redirect).sort(), ['latencyMs', 'statusCode'])
  assert.equal(redirect.statusCode, 302)
  const timeout = await safeHttpProbe({ address: 'origin.example.com', port: 80, protocol: 'http', path: '/' }, { resolver: publicDns, transport: async () => { throw Object.assign(new Error('contains private IP/token'), { code: 'ETIMEDOUT' }) } })
  assert.equal(timeout.errorCode, 'TIMEOUT')
  assert.equal(timeout.statusCode, null)
  const bounded = await safeHttpProbe({ address:'origin.example.com', port:80, protocol:'http', path:'/' }, { timeoutMs:15, resolver:publicDns, transport:() => new Promise(() => {}) })
  assert.equal(bounded.errorCode, 'TIMEOUT')
  assert.ok(bounded.latencyMs < 100)
  assert.equal('message' in timeout, false)
})

test('unsafe targets, ports and DNS stalls fail closed with bounded safe codes', async () => {
  assert.equal((await safeHttpProbe({ address: '127.0.0.1', port: 8080, protocol: 'http', path: '/' })).errorCode, 'BLOCKED_ADDRESS')
  assert.equal((await safeHttpProbe({ address: 'origin.example.com', port: 22, protocol: 'http', path: '/' })).errorCode, 'UNSAFE_PORT')
  for (const path of ['//evil.test', '/health#fragment', '/health\r\nHost:evil']) {
    assert.equal((await safeHttpProbe({ address: 'origin.example.com', port: 80, protocol: 'http', path }, { resolver: publicDns, transport: async () => 200 })).errorCode, 'INVALID_TARGET')
  }
  assert.equal((await safeHttpProbe({ address: 'origin.example.com', port: 80, protocol: 'http', path: '/' }, { timeoutMs: 5, resolver: () => new Promise(() => {}) })).errorCode, 'TIMEOUT')
  assert.equal(isPublicAddress('8.8.8.8'), true)
  assert.equal(isPublicAddress('192.168.0.1'), false)
})

test('reserved IPv6 space is rejected even when the address parser falls back to unicast', () => {
  for (const address of ['::2', '4000::1', '8000::1', '2001:db8::1', 'fc00::1', 'fe80::1', '64:ff9b::a9fe:a9fe']) assert.equal(isPublicAddress(address), false, address)
  assert.equal(isPublicAddress('2606:4700:4700::1111'), true)
})

test('the native transport destroys its socket at the absolute deadline even with no idle timeout', async () => {
  const http = require('node:http')
  const { EventEmitter } = require('node:events')
  const original = http.request
  let destroyed = false
  http.request = () => {
    const request = new EventEmitter()
    request.setTimeout = () => request
    request.end = () => request
    request.destroy = error => { destroyed = true; request.emit('error', error); request.emit('close'); return request }
    return request
  }
  try {
    const result = await safeHttpProbe({ address:'8.8.8.8', port:80, protocol:'http', path:'/' }, {timeoutMs:15})
    assert.equal(result.errorCode,'TIMEOUT')
    assert.equal(destroyed,true)
  } finally { http.request=original }
})

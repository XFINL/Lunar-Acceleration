const { test } = require('node:test')
const assert = require('node:assert/strict')
const { AuditInterceptor } = require('../dist/common/interceptors/audit.interceptor')

test('audit recursively removes credentials, certificate private keys and KV secret values', () => {
  const interceptor = new AuditInterceptor({}, {})
  const input = { id: '1', nested: { passwordHash: 'hidden', keyPem: 'PRIVATE KEY', name: 'safe' }, items: [
    { configKey: 'accessKeySecret', configValue: 'do-not-log' },
    { configKey: 'siteName', configValue: 'Lunar' },
  ] }
  const output = interceptor.sanitize(input)
  assert.equal(output.nested.passwordHash, '***')
  assert.equal(output.nested.keyPem, '***')
  assert.equal(output.nested.name, 'safe')
  assert.equal(output.items[0].configValue, '***')
  assert.equal(output.items[1].configValue, 'Lunar')
  assert.equal(input.nested.keyPem, 'PRIVATE KEY', 'original response must not be mutated')
})

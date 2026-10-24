const test = require('node:test')
const assert = require('node:assert/strict')
const { createHash, createHmac } = require('node:crypto')
const { createNodeSignature, safeHexEqual } = require('../dist/modules/node/node-hmac.util')

test('M6 node signature uses the fixed timestamp/nonce/method/path/body-hash message', () => {
  const rawToken = Buffer.from('node-token-fixture')
  const tokenHash = createHash('sha256').update(rawToken).digest('hex')
  const timestamp = '1792821900'
  const nonce = '0123456789abcdef'
  const method = 'post'
  const path = '/api/v1/node/heartbeat'
  const body = Buffer.from('{"version":"1.0.0","nodeId":7}')
  const message = `${timestamp}\n${nonce}\nPOST\n${path}\n${createHash('sha256').update(body).digest('hex')}`
  const expected = createHmac('sha256', Buffer.from(tokenHash, 'hex')).update(message, 'utf8').digest('hex')
  const signature = createNodeSignature(tokenHash, timestamp, nonce, method, path, body)
  assert.equal(signature, expected)
  assert.equal(safeHexEqual(signature, expected), true)
  assert.equal(safeHexEqual(signature, createNodeSignature(tokenHash, timestamp, nonce, method, path, Buffer.from('{"version":"1.0.0","nodeId":8}'))), false)
  assert.equal(safeHexEqual(signature, 'abc'), false)
})

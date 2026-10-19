const { test } = require('node:test')
const assert = require('node:assert/strict')
const { DomainService, normalizeDomain, parseBigIntId } = require('../dist/modules/domain/domain.service')
const { BusinessException } = require('../dist/common/exceptions/business.exception')

test('domain normalization uses IDNA ASCII, lowercase and strict hostname validation', () => {
  assert.equal(normalizeDomain('WWW.BÜCHER.de'), 'www.xn--bcher-kva.de')
  for (const bad of ['https://example.com', '127.0.0.1', 'example.com.', '*.example.com', 'bad..example.com', '-bad.example.com']) {
    assert.throws(() => normalizeDomain(bad), BusinessException)
  }
})

test('BigInt route IDs reject malformed, zero and unsigned overflow without native BigInt errors', () => {
  assert.equal(parseBigIntId('18446744073709551615'), 18446744073709551615n)
  for (const bad of ['', '0', '-1', '1.1', '1e3', '18446744073709551616']) {
    assert.throws(() => parseBigIntId(bad), BusinessException)
  }
})

test('requireOwned applies userId isolation and returns a business 404 for another tenant', async () => {
  let where
  const service = new DomainService({ domain: { findFirst: async (args) => { where = args.where; return null } } })
  await assert.rejects(service.requireOwned('1', '22'), (err) => err instanceof BusinessException && err.code === 40401)
  assert.equal(where.userId, 1n)
  assert.equal(where.id, 22n)
  assert.equal(where.deletedAt, null)
})

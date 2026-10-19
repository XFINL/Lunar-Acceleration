const test = require('node:test')
const assert = require('node:assert/strict')
const { SettingService } = require('../dist/modules/setting/setting.service.js')

function makeService() {
  const now = new Date()
  const siteRows = [
    { groupKey: 'basic', configKey: 'siteName', configValue: 'Test site', description: null, updatedAt: now },
    { groupKey: 'maintenance', configKey: 'enabled', configValue: true, description: null, updatedAt: now },
    { groupKey: 'maintenance', configKey: 'whitelistIps', configValue: ['127.0.0.1'], description: null, updatedAt: now },
    { groupKey: 'email', configKey: 'pass', configValue: 'legacy-clear-secret', description: null, updatedAt: now },
    { groupKey: 'sms', configKey: 'accessKeySecret', configValue: 'legacy-sms-secret', description: null, updatedAt: now },
    { groupKey: 'oauth', configKey: 'clientSecret', configValue: 'oauth-secret', description: null, updatedAt: now },
    { groupKey: 'payment', configKey: 'apiKey', configValue: 'payment-secret', description: null, updatedAt: now },
    { groupKey: 'security', configKey: 'token', configValue: 'security-secret', description: null, updatedAt: now },
    { groupKey: 'api', configKey: 'secret', configValue: 'api-secret', description: null, updatedAt: now },
    { groupKey: 'rogue', configKey: 'secret', configValue: 'rogue-secret', description: null, updatedAt: now },
  ]
  const systemRows = []
  const writes = []
  const modelFor = (rows) => ({
    findMany: async ({ where } = {}) => rows.filter((row) => !where || Object.entries(where).every(([key, value]) => row[key] === value)),
    findUnique: async ({ where }) => rows.find((row) => row.groupKey === where.uk_group_key.groupKey && row.configKey === where.uk_group_key.configKey) ?? null,
    upsert: async ({ where, create, update }) => {
      writes.push({ where, create, update })
      const found = rows.find((row) => row.groupKey === where.uk_group_key.groupKey && row.configKey === where.uk_group_key.configKey)
      if (found) Object.assign(found, update)
      else rows.push({ ...create, updatedAt: now })
    },
  })
  const db = {
    siteConfig: modelFor(siteRows),
    systemConfig: modelFor(systemRows),
    $transaction: (callback) => callback({ siteConfig: modelFor(siteRows), systemConfig: modelFor(systemRows) }),
  }
  return { service: new SettingService(db), siteRows, writes }
}

test('public config returns allowlisted entries and rejects all private or unknown groups', async () => {
  const { service } = makeService()
  assert.deepEqual(await service.getPublicSiteConfig('basic'), { siteName: 'Test site' })
  for (const group of ['email', 'sms', 'oauth', 'payment', 'security', 'api', 'unknown']) {
    await assert.rejects(service.getPublicSiteConfig(group), /不公开或不存在/)
  }
  assert.deepEqual(await service.getPublicSiteConfig('maintenance'), { enabled: true })
})

test('administrator reads mask credentials and exclude unrecognized stored groups', async () => {
  const { service } = makeService()
  const items = await service.getSiteConfigs()
  assert.equal(items.find((item) => item.configKey === 'pass').configValue, '********')
  assert.equal(items.find((item) => item.configKey === 'accessKeySecret').configValue, '********')
  assert.equal(items.some((item) => item.groupKey === 'rogue'), false)
  assert.equal(items.some((item) => item.configKey === 'whitelistIps'), true)
})

test('unknown keys and out-of-range values reject the complete batch before writing', async () => {
  const { service, writes } = makeService()
  await assert.rejects(service.updateSiteConfigGroup('basic', [
    { configKey: 'siteName', configValue: 'new' },
    { configKey: 'injected', configValue: 'secret' },
  ]), /未知配置键/)
  await assert.rejects(service.updateSiteConfigGroup('email', [{ configKey: 'port', configValue: -1 }]), /范围/)
  await assert.rejects(service.updateSiteConfigGroup('does-not-exist', []), /未知配置分组/)
  assert.equal(writes.length, 0)
})

test('valid group updates use a transaction and preserve masked secrets', async () => {
  const { service, writes, siteRows } = makeService()
  const result = await service.updateSiteConfigGroup('email', [
    { configKey: 'pass', configValue: '********' },
    { configKey: 'host', configValue: 'mail.example.test' },
  ])
  assert.deepEqual(result, { count: 2 })
  assert.equal(writes.length, 1)
  assert.equal(siteRows.find((row) => row.configKey === 'pass').configValue, 'legacy-clear-secret')
  assert.equal(siteRows.find((row) => row.configKey === 'host').configValue, 'mail.example.test')
})

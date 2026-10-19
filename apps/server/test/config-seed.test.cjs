const { test } = require('node:test')
const assert = require('node:assert/strict')
const { join } = require('node:path')
require('ts-node').register({ project: join(__dirname,'../tsconfig.json'), transpileOnly: true })
const { seedSiteConfigs } = require('../prisma/seeds/site-configs.seed.ts')
const { seedSystemConfigs } = require('../prisma/seeds/system-configs.seed.ts')

test('config seeds preserve existing values and timestamps; new auth aliases inherit legacy policy', async () => {
  const rows = new Map([['register.open',{ configValue:false, updatedAt:new Date('2020-01-01') }]])
  const updates = []
  const siteConfig = {
    findUnique: async ({where}) => rows.get(`${where.uk_group_key.groupKey}.${where.uk_group_key.configKey}`) || null,
    upsert: async ({where,create,update}) => {
      const key = `${where.uk_group_key.groupKey}.${where.uk_group_key.configKey}`
      updates.push(update)
      if (!rows.has(key)) rows.set(key,{...create,updatedAt:new Date()})
      return rows.get(key)
    },
  }
  await seedSiteConfigs({siteConfig})
  assert.equal(rows.get('auth.registerOpen').configValue,false)
  assert.equal(rows.get('register.open').updatedAt.toISOString(),'2020-01-01T00:00:00.000Z')
  await seedSiteConfigs({siteConfig})
  assert.ok(updates.every(update=>Object.keys(update).length===0), 'updating metadata would change alias precedence timestamps')
})

test('system seeds do not modify operator-owned configuration records', async () => {
  const updates = []
  await seedSystemConfigs({systemConfig:{upsert:async ({update})=>updates.push(update)}})
  assert.ok(updates.length>0)
  assert.ok(updates.every(update=>Object.keys(update).length===0))
})

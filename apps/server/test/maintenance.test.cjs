const { test } = require('node:test')
const assert = require('node:assert/strict')
const { JwtAuthGuard } = require('../dist/common/guards/jwt-auth.guard')
const guard = new JwtAuthGuard({}, {siteConfig:{findUnique:async ({where})=>({configValue:{enabled:true,whitelistIps:['192.0.2.10'],message:'Maintenance'}[where.uk_group_key.configKey]})}})
const context = (path,user,ip='192.0.2.99') => ({switchToHttp:()=>({getRequest:()=>({path,user,ip})})})

test('maintenance blocks registration and ordinary API calls', async () => {
  await assert.rejects(()=>guard.enforceMaintenance(context('/api/v1/auth/register')),/Maintenance/)
  await assert.rejects(()=>guard.enforceMaintenance(context('/api/v1/user/domains',{roleType:1})),/Maintenance/)
})
test('maintenance preserves login recovery, administrator access and exact IP whitelist', async () => {
  await guard.enforceMaintenance(context('/api/v1/auth/login'))
  await guard.enforceMaintenance(context('/api/v1/user/domains',{roleType:3}))
  await guard.enforceMaintenance(context('/api/v1/user/domains',{roleType:1},'::ffff:192.0.2.10'))
})

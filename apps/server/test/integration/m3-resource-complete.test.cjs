const { test, before, after } = require('node:test')
const assert = require('node:assert/strict')
require('reflect-metadata')
const { NestFactory } = require('@nestjs/core')
const { JwtService } = require('@nestjs/jwt')
const { AppModule } = require('../../dist/app.module')
const { PrismaService } = require('../../dist/database/prisma.service')

const enabled = process.env.DATABASE_URL && new URL(process.env.DATABASE_URL).pathname.endsWith('_test')
const integration = enabled ? test : test.skip
const suffix = `${Date.now()}${process.pid}`
let app, base, db, user, domain, token
const jwt = new JwtService()
async function call(path, method='GET', body) {
  const response = await fetch(`${base}${path}`, { method, headers: { 'Content-Type':'application/json', Authorization:`Bearer ${token}` }, ...(body === undefined ? {} : { body:JSON.stringify(body) }) })
  const payload = await response.json()
  return { status:response.status, ...payload }
}
function ok(value) { assert.equal(value.code, 0, JSON.stringify(value)); return value.data }

before(async () => {
  if (!enabled) return
  app = await NestFactory.create(AppModule, { logger:false })
  app.setGlobalPrefix('api/v1')
  await app.listen(0, '127.0.0.1')
  base = `${await app.getUrl()}/api/v1`
  db = app.get(PrismaService)
  user = await db.user.create({ data:{ username:`m3resource_${suffix}`, passwordHash:'fixture', roleType:1 } })
  const role = await db.role.findUniqueOrThrow({ where:{ code:'user' } })
  await db.userRole.create({ data:{ userId:user.id, roleId:role.id } })
  token = jwt.sign({ sub:user.id.toString(), username:user.username, roleType:user.roleType }, { secret:process.env.JWT_SECRET || 'dev_access_secret', expiresIn:'10m' })
  domain = await db.domain.create({ data:{ userId:user.id, domain:`resource${suffix}.example.com`, cname:`resource${suffix}.example.net`, accessType:1 } })
})
after(async () => {
  if (domain) await db.domain.deleteMany({ where:{ id:domain.id } }).catch(()=>{})
  if (user) await db.user.deleteMany({ where:{ id:user.id } }).catch(()=>{})
  if (app) await app.close()
})

integration('M3 resource HTTP contract: expanded cache fields, group additions/deletion and private probe blocking', async () => {
  const root = `/user/domains/${domain.id}`
  const rule = ok(await call(`${root}/cache-rules`, 'POST', { name:'frontend', matchType:'path', matchValue:'/assets', matchMode:'contains', action:'force_cache', ttl:120, ignoreParams:false, cacheKey:'$host$uri', status:1 }))
  assert.equal(rule.action, 'force_cache')
  assert.equal(rule.status, 1)
  const updated = ok(await call(`${root}/cache-rules/${rule.id}`, 'PUT', { status:0, cacheKey:'$host$uri' }))
  assert.equal(updated.status, 0)

  const group = ok(await call(`${root}/origins`, 'POST', { lbPolicy:'weighted', healthCheck:{ enabled:true, path:'/health', interval:30, timeout:3, expectedStatus:200 }, origins:[{ address:'127.0.0.1', port:8080, weight:2, protocol:'http', host:'', status:1 }] }))
  assert.equal(group.lbPolicy, 'weighted')
  assert.equal(group.origins[0].host, null)
  assert.equal(group.origins[0].status, 1)
  const added = ok(await call(`${root}/origin-groups/${group.id}/origins`, 'POST', { origins:[{ address:'192.168.1.9', port:8080, weight:1, protocol:'http', host:null, status:1 }] }))
  assert.equal(added.origins.length, 2)

  const probe = ok(await call(`${root}/origins/health-check`, 'POST', { originIds:[group.origins[0].id] }))
  assert.deepEqual(Object.keys(probe), ['results'])
  assert.equal(probe.results.length, 1)
  assert.equal(probe.results[0].errorCode, 'BLOCKED_ADDRESS')
  assert.equal(probe.results[0].statusCode, null)
  assert.equal('address' in probe.results[0], false)
  assert.equal('message' in probe.results[0], false)
  ok(await call(`${root}/origin-groups/${group.id}`, 'DELETE'))
})

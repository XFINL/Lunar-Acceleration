const { test, before, after } = require('node:test')
const assert = require('node:assert/strict')
const { mkdtempSync, readFileSync, rmSync } = require('node:fs')
const { tmpdir } = require('node:os')
const { join } = require('node:path')
const { execFileSync } = require('node:child_process')
require('reflect-metadata')
const { NestFactory } = require('@nestjs/core')
const { ValidationPipe } = require('@nestjs/common')
const { JwtService } = require('@nestjs/jwt')
const { AppModule } = require('../../dist/app.module')
const { PrismaService } = require('../../dist/database/prisma.service')
const { PackageService } = require('../../dist/modules/package/package.service')

const enabled = process.env.DATABASE_URL && new URL(process.env.DATABASE_URL).pathname.endsWith('_test')
const integration = enabled ? test : test.skip
const suffix = `${Date.now()}${process.pid}`
let app, base, db, token, otherToken, adminToken, user, plan, domain, extraDomain, certificate, certPem, keyPem, temp
const hostname = `it${suffix}.example.com`
process.env.ACME_WORKER_ENABLED = 'false'
delete process.env.ACME_ACCOUNT_KEY
delete process.env.ACME_EMAIL
const jwt = new JwtService()
const sign = u => jwt.sign({ sub: u.id.toString(), username: u.username, roleType: u.roleType }, { secret: process.env.JWT_SECRET || 'dev_access_secret', expiresIn: '10m' })
async function call(path, method = 'GET', body, auth = token) {
  const response = await fetch(`${base}${path}`, { method, headers: { 'Content-Type': 'application/json', ...(auth ? { Authorization: `Bearer ${auth}` } : {}) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) })
  const payload = await response.json()
  return { status: response.status, ...payload }
}
function ok(payload) { assert.equal(payload.code, 0, JSON.stringify(payload)); return payload.data }
function rejected(payload) { assert.notEqual(payload.code, 0, JSON.stringify(payload)); assert.notEqual(payload.code, 50001, 'invalid input or isolation must not become internal errors'); return payload }

before(async () => {
  if (!enabled) return
  app = await NestFactory.create(AppModule, { logger: false })
  app.setGlobalPrefix('api/v1')
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true, transformOptions: { enableImplicitConversion: true } }))
  await app.listen(0, '127.0.0.1')
  base = `${await app.getUrl()}/api/v1`
  db = app.get(PrismaService)
  user = await db.user.create({ data: { username: `m3_${suffix}`, passwordHash: 'fixture', roleType: 1 } })
  const other = await db.user.create({ data: { username: `m3other_${suffix}`, passwordHash: 'fixture', roleType: 1 } })
  const role = await db.role.findUniqueOrThrow({ where: { code: 'user' } })
  await db.userRole.createMany({ data: [{ userId: user.id, roleId: role.id }, { userId: other.id, roleId: role.id }] })
  token = sign(user); otherToken = sign(other)
  const admin = await db.user.findFirstOrThrow({ where: { roleType: 3, deletedAt: null } })
  adminToken = sign(admin)
  plan = await db.package.create({ data: { name: 'M3 test plan', code: `m3_${suffix}`, accessType: 1, period: 1, price: '1.00', domainLimit: 2, trafficQuota: 1000000n } })
  temp = mkdtempSync(join(tmpdir(), 'lunar-cert-'))
  execFileSync('openssl', ['req','-x509','-newkey','rsa:2048','-nodes','-keyout',join(temp,'key.pem'),'-out',join(temp,'cert.pem'),'-days','30','-subj',`/CN=${hostname}`,'-addext',`subjectAltName=DNS:${hostname}`,'-addext','basicConstraints=critical,CA:FALSE'], { stdio: 'ignore' })
  certPem = readFileSync(join(temp,'cert.pem'),'utf8'); keyPem = readFileSync(join(temp,'key.pem'),'utf8')
})
after(async () => {
  if (app) await app.close()
  if (temp) rmSync(temp, {recursive:true,force:true})
})

integration('M3: active package is required and concurrent domain creation enforces quota', async () => {
  rejected(await call('/user/domains','POST',{domain:hostname}))
  await new PackageService(db).assignPackage(user.id.toString(), plan.id.toString())
  ok(await call('/user/domains','POST',{domain:hostname}))
  const results = await Promise.all([`second${suffix}.example.com`,`third${suffix}.example.com`].map(domain => call('/user/domains','POST',{domain})))
  assert.equal(results.filter(r => r.code === 0).length,1)
  assert.equal(await db.domain.count({where:{userId:user.id,deletedAt:null}}),2)
  const rows = await db.domain.findMany({where:{userId:user.id,deletedAt:null}})
  domain = rows.find(x=>x.domain===hostname) || rows[0]
  extraDomain = rows.find(x=>x.id!==domain.id)
  // Ensure the certificate hostname is attached to the selected domain even if scheduling changed insertion order.
  assert.equal(domain.domain, hostname)
  assert.equal(domain.status,1)
  assert.equal(domain.accessType,1)
})
integration('M3: tenant isolation and invalid IDs fail safely', async () => {
  rejected(await call(`/user/domains/${domain.id}`,'GET',undefined,otherToken))
  rejected(await call('/user/domains/not-a-number'))
  rejected(await call(`/user/domains/${domain.id}/cache-rules`,'GET',undefined,otherToken))
  const result = ok(await call('/user/domains'))
  assert.ok(Array.isArray(result.list)); assert.ok(result.pagination)
  rejected(await call(`/admin/domains/${domain.id}/approve`,'POST',{},token))
})
integration('M3: approval and saved configuration never fake a deployed domain', async () => {
  ok(await call(`/admin/domains/${domain.id}/approve`,'POST',{},adminToken))
  let row = await db.domain.findUnique({where:{id:domain.id}})
  assert.equal(row.auditStatus,2); assert.notEqual(row.status,3)
  rejected(await call(`/user/domains/${domain.id}/enable`,'POST',{}))
  row = await db.domain.findUnique({where:{id:domain.id}})
  assert.notEqual(row.status,3)
  ok(await call(`/user/domains/${domain.id}/config`,'PUT',{defaultTtl:120,originProtocol:'https'}))
  assert.equal((await db.domainConfig.findUnique({where:{domainId:domain.id}})).defaultTtl,120)
  await call(`/user/domains/${domain.id}/config`,'PUT',{httpsEnabled:true,forceHttps:true,certId:'999999999'})
  assert.equal((await db.domainConfig.findUnique({where:{domainId:domain.id}})).httpsEnabled,false, 'generic config cannot bypass certificate validation')
})
integration('M3: cache sorting is scoped, exact and deterministic', async () => {
  const a = ok(await call(`/user/domains/${domain.id}/cache-rules`,'POST',{name:'images',matchType:'extension',matchValue:'png',matchMode:'suffix',action:'cache',ttl:600,ignoreParams:true}))
  const b = ok(await call(`/user/domains/${domain.id}/cache-rules`,'POST',{name:'root',matchType:'path',matchValue:'/',matchMode:'prefix',action:'bypass',ttl:0,ignoreParams:false}))
  rejected(await call(`/user/domains/${domain.id}/cache-rules`,'POST',{name:'invalid',matchType:'path',matchValue:'/',ttl:-1}))
  rejected(await call(`/user/domains/${domain.id}/cache-rules/sort`,'PUT',{ruleIds:[a.id]}))
  ok(await call(`/user/domains/${domain.id}/cache-rules/sort`,'PUT',{ruleIds:[b.id,a.id]}))
  const rows = await db.cacheRule.findMany({where:{domainId:domain.id},orderBy:[{priority:'asc'},{id:'asc'}]})
  assert.deepEqual(rows.map(x=>x.id.toString()),[b.id,a.id])
  rejected(await call(`/user/domains/${extraDomain.id}/cache-rules/${a.id}`,'DELETE'))
})
integration('M3: origin groups persist atomically without performing unsafe health probes', async () => {
  ok(await call(`/user/domains/${domain.id}/origins`,'POST',{name:'primary',lbPolicy:'round_robin',origins:[{address:'127.0.0.1',port:8080,weight:1,protocol:'http'}]}))
  const data = ok(await call(`/user/domains/${domain.id}/origins`))
  assert.equal(data.groups.length,1)
  assert.equal(data.groups[0].origins[0].address,'127.0.0.1')
  rejected(await call(`/user/domains/${domain.id}/origins`,'POST',{name:'bad',lbPolicy:'round_robin',origins:[{address:'http://127.0.0.1/private',port:80,weight:1,protocol:'http'}]}))
  const result = await call(`/user/domains/${domain.id}/origins/health-check`,'POST',{originIds:[data.groups[0].origins[0].id]})
  const probe = ok(result)
  assert.equal(probe.results[0].statusCode,null)
  assert.equal(probe.results[0].errorCode,'BLOCKED_ADDRESS')
})
integration('M3: certificate private key is encrypted and HTTPS binding checks tenant and host', async () => {
  certificate = ok(await call('/user/certificates','POST',{name:'integration TLS',certPem,keyPem}))
  const detail = ok(await call(`/user/certificates/${certificate.id}`))
  assert.ok(!('keyPem' in detail)); assert.ok(!('certPem' in detail)); assert.equal(detail.hasPrivateKey,true)
  const stored = await db.certificate.findUnique({where:{id:BigInt(certificate.id)}})
  assert.notEqual(stored.keyPem,keyPem); assert.ok(!stored.keyPem.includes('PRIVATE KEY'))
  rejected(await call(`/user/domains/${domain.id}/cert`,'PUT',{certId:certificate.id},otherToken))
  rejected(await call(`/user/domains/${extraDomain.id}/cert`,'PUT',{certId:certificate.id}))
  ok(await call(`/user/domains/${domain.id}/cert`,'PUT',{certId:certificate.id}))
  ok(await call(`/user/domains/${domain.id}/https`,'PUT',{httpsEnabled:true,forceHttps:true,hstsEnabled:true,hstsMaxAge:300,tlsVersion:'TLSv1.2'}))
  const config = ok(await call(`/user/domains/${domain.id}/https`))
  assert.equal(config.httpsEnabled,true)
  rejected(await call(`/user/certificates/${certificate.id}`,'DELETE'))
  rejected(await call(`/user/domains/${domain.id}/https`,'PUT',{tlsVersion:'SSLv3'}))
  rejected(await call(`/user/domains/${domain.id}/https`,'PUT',{httpsEnabled:'false'}))
  rejected(await call(`/user/domains/${domain.id}/https`,'PUT',{httpsEnabled:1}))
  assert.notEqual((await db.domain.findUnique({where:{id:domain.id}})).status,3)
  const acme = await call('/user/certificates/apply-acme','POST',{domainId:String(domain.id)})
  rejected(acme)
  assert.match(acme.message,/ACME is not configured/)
})
integration('M3: disabling HTTPS, unbinding and deleting certificates preserves integrity', async () => {
  ok(await call(`/user/domains/${domain.id}/https`,'PUT',{httpsEnabled:false,forceHttps:false,hstsEnabled:false}))
  ok(await call(`/user/domains/${domain.id}/cert`,'PUT',{certId:null}))
  ok(await call(`/user/certificates/${certificate.id}`,'DELETE'))
  ok(await call(`/user/domains/${extraDomain.id}`,'DELETE'))
  rejected(await call(`/user/domains/${extraDomain.id}`))
  assert.ok((await db.domain.findUnique({where:{id:extraDomain.id}})).deletedAt)
})

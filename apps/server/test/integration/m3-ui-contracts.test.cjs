const { test, before, after } = require('node:test')
const assert = require('node:assert/strict')
require('reflect-metadata')
const dns = require('node:dns/promises')
const { NestFactory } = require('@nestjs/core')
const { ValidationPipe } = require('@nestjs/common')
const { JwtService } = require('@nestjs/jwt')
const { AppModule } = require('../../dist/app.module')
const { PrismaService } = require('../../dist/database/prisma.service')
const { PackageService } = require('../../dist/modules/package/package.service')
const enabled = !!process.env.DATABASE_URL && new URL(process.env.DATABASE_URL).pathname.endsWith('_test')
const integration = enabled ? test : test.skip
const suffix = `${Date.now()}${process.pid}`
let app, db, base, token, user, domain, plan
const originalResolveCname = dns.resolveCname
async function call(path, method='GET', body) {
  const response = await fetch(`${base}${path}`, {method, headers:{'Content-Type':'application/json',Authorization:`Bearer ${token}`}, ...(body===undefined?{}:{body:JSON.stringify(body)})})
  const result = await response.json()
  assert.notEqual(result.code,50001,JSON.stringify(result))
  return {status:response.status,...result}
}
const ok = response => {assert.equal(response.code,0,JSON.stringify(response));return response.data}
before(async()=>{
  if(!enabled)return
  process.env.ACME_WORKER_ENABLED='false'
  app=await NestFactory.create(AppModule,{logger:false})
  app.setGlobalPrefix('api/v1')
  app.useGlobalPipes(new ValidationPipe({whitelist:true,transform:true,transformOptions:{enableImplicitConversion:true}}))
  await app.listen(0,'127.0.0.1')
  base=`${await app.getUrl()}/api/v1`
  db=app.get(PrismaService)
  user=await db.user.create({data:{username:`m3ui_${suffix}`,passwordHash:'fixture',roleType:1}})
  const role=await db.role.findUniqueOrThrow({where:{code:'user'}})
  await db.userRole.create({data:{userId:user.id,roleId:role.id}})
  token=new JwtService().sign({sub:String(user.id),username:user.username,roleType:1},{secret:process.env.JWT_SECRET||'dev_access_secret',expiresIn:'10m'})
  plan=await db.package.create({data:{name:'UI contract plan',code:`m3ui_${suffix}`,accessType:1,period:1,price:'1',domainLimit:5,trafficQuota:1000000n}})
  await new PackageService(db).assignPackage(String(user.id),String(plan.id))
  domain=ok(await call('/user/domains','POST',{domain:`m3ui${suffix}.example.com`,businessType:'static'}))
  dns.resolveCname=async hostname=>{assert.equal(hostname,domain.domain);return [domain.cname]}
})
after(async()=>{dns.resolveCname=originalResolveCname;if(app)await app.close()})

integration('M3 UI contract: DNS check route and response match the browser API',async()=>{
  const checked=ok(await call(`/user/domains/${domain.id}/check`,'POST'))
  assert.equal(checked.expectedCname,domain.cname)
  assert.deepEqual(checked.observedCnames,[domain.cname])
  assert.equal(checked.matched,true)
  assert.ok(Number.isFinite(Date.parse(checked.checkedAt)))
  assert.notEqual((await db.domain.findUnique({where:{id:BigInt(domain.id)}})).status,3)
})
integration('M3 UI contract: cache form status and custom key survive create/edit',async()=>{
  const payload={name:'UI images',matchType:'extension',matchValue:'png',matchMode:'suffix',action:'cache',ttl:600,ignoreParams:true,status:1,cacheKey:'$host$uri'}
  const rule=ok(await call(`/user/domains/${domain.id}/cache-rules`,'POST',payload))
  assert.ok(rule.id)
  ok(await call(`/user/domains/${domain.id}/cache-rules/${rule.id}`,'PUT',{...payload,name:'UI edited',ttl:900}))
  const stored=await db.cacheRule.findUnique({where:{id:BigInt(rule.id)}})
  assert.equal(stored.ttl,900)
  assert.equal(stored.status,1)
  assert.equal(stored.cacheKey,'$host$uri')
})
integration('M3 UI contract: weighted origin forms accept optional empty Host and explicit status',async()=>{
  const group=ok(await call(`/user/domains/${domain.id}/origins`,'POST',{name:'UI weighted',lbPolicy:'weighted',origins:[{address:'origin.example.com',port:443,weight:2,protocol:'https',host:'',status:1}]}))
  const origin=group.origins?.[0] || (await db.origin.findFirstOrThrow({where:{originGroupId:BigInt(group.id)}}))
  ok(await call(`/user/domains/${domain.id}/origins/${origin.id}`,'PUT',{address:'origin2.example.com',port:443,weight:3,protocol:'https',host:'',status:1}))
  const stored=await db.origin.findUnique({where:{id:BigInt(origin.id)}})
  assert.equal(stored.weight,3)
  assert.equal(stored.host,null)
  assert.equal((await db.originGroup.findUnique({where:{id:BigInt(group.id)}})).lbPolicy,'weighted')
})

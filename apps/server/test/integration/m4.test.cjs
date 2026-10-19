const {test,before,after}=require('node:test')
const assert=require('node:assert/strict')
require('reflect-metadata')
const {NestFactory}=require('@nestjs/core')
const {ValidationPipe}=require('@nestjs/common')
const {JwtService}=require('@nestjs/jwt')
const {AppModule}=require('../../dist/app.module')
const {PrismaService}=require('../../dist/database/prisma.service')
const {DriverFactory}=require('../../dist/modules/vendor/drivers/driver.factory')
const {VendorDriverError}=require('../../dist/modules/vendor/drivers/vendor-driver')
const enabled=!!process.env.DATABASE_URL && new URL(process.env.DATABASE_URL).pathname.endsWith('_test')
const integration=enabled?test:test.skip
const suffix=`${Date.now()}${process.pid}`
const fixtureToken=`fixture-not-a-real-token-${suffix}`
const fixtureSecret=`fixture-must-never-be-returned-${suffix}`
const state={mode:'normal',networkCalls:0,credentials:null,entered:null,release:null}
let app,db,base,adminToken,userToken,readerToken,admin,user,reader,readRole,vendor,ali,account,domains=[]
async function call(path,method='GET',body,token=adminToken){
 const response=await fetch(`${base}${path}`,{method,headers:{'Content-Type':'application/json',...(token?{Authorization:`Bearer ${token}`}:{})},...(body===undefined?{}:{body:JSON.stringify(body)})})
 const result=await response.json()
 assert.notEqual(result.code,50001,JSON.stringify(result))
 const serialized=JSON.stringify(result)
 assert.equal(serialized.includes(fixtureToken),false,'API must not disclose an access token')
 assert.equal(serialized.includes(fixtureSecret),false,'API must not disclose a provider secret')
 return {status:response.status,...result}
}
const ok=r=>{assert.equal(r.code,0,JSON.stringify(r));return r.data}
const denied=r=>{assert.notEqual(r.code,0,JSON.stringify(r));return r}
function item(domain,index=0){return {externalId:`remote-${index}`,hostname:domain.domain,cname:'provider.example.com',providerStatus:index?'active':'pending_validation',sslStatus:'pending_validation',custom_key:fixtureSecret,raw:{accessToken:fixtureToken}}}
function rows(data){assert.ok(Array.isArray(data.list));return data.list}
before(async()=>{
 if(!enabled)return
 process.env.ACME_WORKER_ENABLED='false'
 app=await NestFactory.create(AppModule,{logger:false})
 app.setGlobalPrefix('api/v1')
 app.useGlobalPipes(new ValidationPipe({whitelist:true,transform:true,transformOptions:{enableImplicitConversion:true}}))
 await app.listen(0,'127.0.0.1')
 base=`${await app.getUrl()}/api/v1`;db=app.get(PrismaService)
 const factory=app.get(DriverFactory)
 factory.create=(code,credentials)=>{
  state.credentials={...credentials}
  return {
   async testConnection(){
    state.networkCalls++
    if(state.mode==='hold'){state.entered?.();await new Promise(resolve=>{state.release=resolve})}
    if(state.mode==='error')throw new Error(`upstream error with ${fixtureSecret} and ${fixtureToken}`)
    if(state.mode==='auth')throw new VendorDriverError('AUTH_FAILED')
    return {connected:true,provider:code,checkedAt:new Date().toISOString(),accountLabel:'safe-zone.example.com',providerStatus:'active',custom_key:fixtureSecret}
   },
   async listDomains(cursor){
    state.networkCalls++
    if(state.mode==='empty')return {items:[],nextCursor:null}
    if(state.mode==='cycle')return {items:[],nextCursor:'2'}
    if(state.mode==='partialError' && cursor)throw new Error(`partial upstream failure ${fixtureSecret}`)
    if(!cursor)return {items:[item(domains[0]),{...item(domains[0],2),hostname:`unknown${suffix}.example.com`}],nextCursor:'2'}
    assert.equal(cursor,'2')
    return {items:[item(domains[1],1)],nextCursor:null}
   },
  }
 }
 const superRole=await db.role.findUniqueOrThrow({where:{code:'super_admin'}})
 admin=await db.user.create({data:{username:`m4admin_${suffix}`,passwordHash:'fixture',roleType:3}})
 user=await db.user.create({data:{username:`m4user_${suffix}`,passwordHash:'fixture',roleType:1}})
 reader=await db.user.create({data:{username:`m4reader_${suffix}`,passwordHash:'fixture',roleType:2}})
 readRole=await db.role.create({data:{name:'M4 read-only fixture',code:`m4read_${suffix}`}})
 const permission=await db.permission.findUniqueOrThrow({where:{code:'vendor:read'}})
 await db.rolePermission.create({data:{roleId:readRole.id,permissionId:permission.id}})
 await db.userRole.createMany({data:[{userId:admin.id,roleId:superRole.id},{userId:user.id,roleId:readRole.id},{userId:reader.id,roleId:readRole.id}]})
 const jwt=new JwtService(),sign=u=>jwt.sign({sub:String(u.id),username:u.username,roleType:u.roleType},{secret:process.env.JWT_SECRET||'dev_access_secret',expiresIn:'10m'})
 adminToken=sign(admin);userToken=sign(user);readerToken=sign(reader)
 vendor=await db.vendor.findUniqueOrThrow({where:{code:'cloudflare'}})
 ali=await db.vendor.findUniqueOrThrow({where:{code:'ali'}})
 for(let i=0;i<2;i++)domains.push(await db.domain.create({data:{userId:user.id,domain:`m4-${i}-${suffix}.example.com`,cname:`m4-${i}-${suffix}.example.invalid`,accessType:1,status:1,auditStatus:1}}))
})
after(async()=>{
 try{
  if(db){
   if(account)await db.vendorAccount.deleteMany({where:{id:BigInt(account.id)}})
   if(vendor)await db.vendor.updateMany({where:{id:vendor.id},data:{status:1}})
   if(admin&&user&&reader)await db.user.deleteMany({where:{id:{in:[admin.id,user.id,reader.id]}}})
   if(readRole)await db.role.deleteMany({where:{id:readRole.id}})
  }
 }finally{if(app)await app.close()}
})

integration('M4 HTTP: anonymous and ordinary users cannot read vendor accounts even with vendor:read permission',async()=>{
 denied(await call('/admin/vendor-accounts','GET',undefined,null))
 const blocked=denied(await call('/admin/vendor-accounts','GET',undefined,userToken))
 assert.equal(blocked.code,40301)
 assert.equal(blocked.data,undefined)
 ok(await call('/admin/vendors','GET',undefined,readerToken))
})
integration('M4 HTTP: account credentials are encrypted, masked and preserved when omitted on edit',async()=>{
 account=ok(await call('/admin/vendor-accounts','POST',{vendorId:String(vendor.id),name:`M4 fixture ${suffix}`,accessKey:fixtureToken,config:{zoneId:'a'.repeat(32)},status:1}))
 assert.equal(account.hasAccessKey,true)
 const stored=await db.vendorAccount.findUniqueOrThrow({where:{id:BigInt(account.id)}})
 assert.match(stored.accessKey,/^enc:v1:/)
 assert.equal(stored.accessKey.includes(fixtureToken),false)
 const list=rows(ok(await call('/admin/vendor-accounts')))
 assert.ok(list.some(row=>String(row.id)===String(account.id)))
 ok(await call(`/admin/vendor-accounts/${account.id}`,'PUT',{name:`M4 renamed ${suffix}`}))
 const edited=await db.vendorAccount.findUniqueOrThrow({where:{id:BigInt(account.id)}})
 assert.equal(edited.accessKey,stored.accessKey)
 assert.ok(edited.credentialVersion>stored.credentialVersion)
 denied(await call('/admin/vendor-accounts','POST',{vendorId:String(vendor.id),name:'bad config',accessKey:fixtureToken,config:{zoneId:'a'.repeat(32),endpoint:'http://169.254.169.254/'}}))
 denied(await call(`/admin/vendor-accounts/${account.id}`,'PUT',{config:{zoneId:'bad'}}))
 denied(await call('/admin/vendor-accounts/18446744073709551616','DELETE'))
})
integration('M4 HTTP: read-only admins cannot test or sync, while authorized test projects safe connection metadata',async()=>{
 const before=state.networkCalls
 denied(await call(`/admin/vendor-accounts/${account.id}/test`,'POST',undefined,readerToken))
 denied(await call(`/admin/vendor-accounts/${account.id}/sync`,'POST',undefined,readerToken))
 assert.equal(state.networkCalls,before)
 const connected=ok(await call(`/admin/vendor-accounts/${account.id}/test`,'POST'))
 assert.equal(connected.connected,true)
 assert.equal(connected.provider,'cloudflare')
 assert.equal(state.credentials.accessKey,fixtureToken)
 assert.equal(connected.custom_key,undefined)
})
integration('M4 HTTP: paginated inventory only maps existing local domains and never enables or reroutes them',async()=>{
 const before=await db.domain.findMany({where:{id:{in:domains.map(d=>d.id)}},orderBy:{id:'asc'}})
 const synced=ok(await call(`/admin/vendor-accounts/${account.id}/sync`,'POST'))
 assert.equal(synced.synced,2);assert.equal(synced.ignored,1);assert.equal(synced.total,3);assert.equal(synced.readonly,true)
 const resources=rows(ok(await call(`/admin/vendor-accounts/${account.id}/resources`)))
 assert.equal(resources.length,2)
 for(const resource of resources){
  assert.equal(resource.resourceData.observedOnly,true)
  assert.equal(resource.resourceData.custom_key,undefined)
  assert.equal(resource.resourceData.raw,undefined)
 }
 const after=await db.domain.findMany({where:{id:{in:domains.map(d=>d.id)}},orderBy:{id:'asc'}})
 assert.deepEqual(after.map(d=>({id:d.id,status:d.status,cname:d.cname,auditStatus:d.auditStatus})),before.map(d=>({id:d.id,status:d.status,cname:d.cname,auditStatus:d.auditStatus})))
 state.mode='empty'
 const empty=ok(await call(`/admin/vendor-accounts/${account.id}/sync`,'POST'))
 assert.equal(empty.total,0)
 assert.equal(await db.vendorResource.count({where:{vendorAccountId:BigInt(account.id)}}),2,'an empty remote snapshot must not delete prior mappings')
 state.mode='normal'
})
integration('M4 HTTP: upstream failures and pagination cycles do not partially persist or disclose provider errors',async()=>{
 const before=await db.vendorResource.findMany({where:{vendorAccountId:BigInt(account.id)},orderBy:{id:'asc'}})
 state.mode='partialError'
 denied(await call(`/admin/vendor-accounts/${account.id}/sync`,'POST'))
 const after=await db.vendorResource.findMany({where:{vendorAccountId:BigInt(account.id)},orderBy:{id:'asc'}})
 assert.deepEqual(after,before)
 state.mode='cycle';denied(await call(`/admin/vendor-accounts/${account.id}/sync`,'POST'))
 state.mode='error';denied(await call(`/admin/vendor-accounts/${account.id}/test`,'POST'))
 const logs=rows(ok(await call(`/admin/vendor-accounts/${account.id}/logs`)))
 assert.ok(logs.some(log=>log.status===2))
 assert.ok(logs.some(log=>log.status===1))
 const stored=await db.vendorAccount.findUniqueOrThrow({where:{id:BigInt(account.id)}})
 assert.equal(stored.operationToken,null)
 state.mode='normal';ok(await call(`/admin/vendor-accounts/${account.id}/test`,'POST'))
})
integration('M4 HTTP: one account operation holds a lease and prevents concurrent test, edit or deletion',async()=>{
 state.mode='hold'
 const entered=new Promise(resolve=>{state.entered=resolve})
 const pending=call(`/admin/vendor-accounts/${account.id}/test`,'POST')
 let timeout
 try{
  await Promise.race([entered,new Promise((_,reject)=>{timeout=setTimeout(()=>reject(Error('fake driver was not entered')),5000)})])
  denied(await call(`/admin/vendor-accounts/${account.id}/test`,'POST'))
  denied(await call(`/admin/vendor-accounts/${account.id}`,'PUT',{name:'must not race'}))
  denied(await call(`/admin/vendor-accounts/${account.id}`,'DELETE'))
 }finally{clearTimeout(timeout);state.release?.();state.mode='normal';state.entered=null}
 ok(await pending)
 const stored=await db.vendorAccount.findUniqueOrThrow({where:{id:BigInt(account.id)}})
 assert.equal(stored.operationToken,null)
})
integration('M4 HTTP: disabling a provider during upstream work discards the stale connection result',async()=>{
 state.mode='hold'
 const entered=new Promise(resolve=>{state.entered=resolve})
 const pending=call(`/admin/vendor-accounts/${account.id}/test`,'POST')
 let timeout
 try{
  await Promise.race([entered,new Promise((_,reject)=>{timeout=setTimeout(()=>reject(Error('fake driver was not entered')),5000)})])
  ok(await call(`/admin/vendors/${vendor.id}`,'PUT',{status:0}))
 }finally{clearTimeout(timeout);state.release?.();state.mode='normal';state.entered=null}
 try{denied(await pending)}finally{ok(await call(`/admin/vendors/${vendor.id}`,'PUT',{status:1}))}
 assert.equal((await db.vendorAccount.findUniqueOrThrow({where:{id:BigInt(account.id)}})).operationToken,null)
})
integration('M4 HTTP: expired leases recover and disabled accounts or providers perform no network work',async()=>{
 await db.vendorAccount.update({where:{id:BigInt(account.id)},data:{operationToken:'00000000-0000-4000-8000-000000000000',operationExpiresAt:new Date(Date.now()-1000)}})
 ok(await call(`/admin/vendor-accounts/${account.id}/test`,'POST'))
 ok(await call(`/admin/vendor-accounts/${account.id}`,'PUT',{status:0}))
 const before=state.networkCalls
 denied(await call(`/admin/vendor-accounts/${account.id}/test`,'POST'))
 assert.equal(state.networkCalls,before)
 ok(await call(`/admin/vendor-accounts/${account.id}`,'PUT',{status:1}))
 ok(await call(`/admin/vendors/${vendor.id}`,'PUT',{status:0}))
 denied(await call(`/admin/vendor-accounts/${account.id}/sync`,'POST'))
 assert.equal(state.networkCalls,before)
 ok(await call(`/admin/vendors/${vendor.id}`,'PUT',{status:1}))
})
integration('M4 HTTP: referenced providers cannot be removed and account deletion only removes local inventory',async()=>{
 denied(await call(`/admin/vendors/${vendor.id}`,'DELETE'))
 const plan=await db.package.create({data:{name:'M4 reference fixture',code:`m4plan_${suffix}`,vendorId:vendor.id,accessType:2,period:1,price:'1'}})
 try{
  ok(await call(`/admin/vendor-accounts/${account.id}`,'DELETE'))
  assert.equal(await db.vendorResource.count({where:{vendorAccountId:BigInt(account.id)}}),0)
  assert.equal(await db.vendorSyncLog.count({where:{vendorAccountId:BigInt(account.id)}}),0)
  denied(await call(`/admin/vendors/${vendor.id}`,'DELETE'))
 }finally{await db.package.delete({where:{id:plan.id}})}
 assert.equal(await db.domain.count({where:{id:{in:domains.map(d=>d.id)}}}),2)
})

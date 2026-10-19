const {test,before,after}=require('node:test')
const assert=require('node:assert/strict')
const {PrismaClient}=require('@prisma/client')
const {CertificateService}=require('../../dist/modules/certificate/certificate.service')
const {PackageService}=require('../../dist/modules/package/package.service')
const {execFileSync}=require('node:child_process')
const {mkdtempSync,readFileSync,rmSync}=require('node:fs')
const {tmpdir}=require('node:os')
const {join}=require('node:path')
const enabled=!!process.env.DATABASE_URL && new URL(process.env.DATABASE_URL).pathname.endsWith('_test')
const integration=enabled?test:test.skip
const suffix=`${Date.now()}${process.pid}`
let db,service,user,domain,plan,temp,input,certificateId
const config={get:key=>key==='security'?{encryptionKey:'integration-acme-atomic-secret'}:key==='app.env'?'test':undefined}
before(async()=>{
  if(!enabled)return
  db=new PrismaClient();service=new CertificateService(db,config)
  user=await db.user.create({data:{username:`m3atomic_${suffix}`,passwordHash:'fixture',roleType:1}})
  plan=await db.package.create({data:{name:'Atomic certificate fixture',code:`m3atomic_${suffix}`,accessType:1,period:1,price:'1',domainLimit:3,trafficQuota:1000000n}})
  await new PackageService(db).assignPackage(String(user.id),String(plan.id))
  const hostname=`m3atomic${suffix}.example.com`
  domain=await db.domain.create({data:{userId:user.id,domain:hostname,cname:`atomic${suffix}.example.invalid`,accessType:1,auditStatus:2,status:4,config:{create:{}}}})
  temp=mkdtempSync(join(tmpdir(),'lunar-atomic-'))
  execFileSync('openssl',['req','-x509','-newkey','rsa:2048','-nodes','-keyout',join(temp,'key.pem'),'-out',join(temp,'cert.pem'),'-days','2','-subj',`/CN=${hostname}`,'-addext',`subjectAltName=DNS:${hostname}`,'-addext','basicConstraints=critical,CA:FALSE'],{stdio:'ignore'})
  input={certPem:readFileSync(join(temp,'cert.pem'),'utf8'),keyPem:readFileSync(join(temp,'key.pem'),'utf8'),chainPem:null,domains:[hostname],directory:'https://acme-staging-v02.api.letsencrypt.org/directory',autoRenew:false}
})
after(async()=>{
  if(db){
    if(user){await db.certificateJob.deleteMany({where:{userId:user.id}});await db.user.delete({where:{id:user.id}})}
    if(plan)await db.package.delete({where:{id:plan.id}})
    await db.$disconnect()
  }
  if(temp)rmSync(temp,{recursive:true,force:true})
})
const job=async(certId=null)=>db.certificateJob.create({data:{userId:user.id,domainId:domain.id,certificateId:certId,status:'processing',domains:[{id:String(domain.id),domain:domain.domain,autoRenew:false}],privateKey:'encrypted-fixture',csr:'fixture',orderData:{encrypted:'fixture'},expiresAt:new Date(Date.now()+3600_000)}})

integration('M3 atomic issuance: certificate and job commit together and ephemeral key material is cleared',async()=>{
  const pending=await job()
  const issued=await service.persistAcmeJob(String(user.id),String(pending.id),input)
  assert.equal(issued.status,'issued');assert.equal(issued.privateKey,null);assert.equal(issued.orderData,null);assert.equal(issued.csr,null)
  certificateId=issued.certificateId
  const cert=await db.certificate.findUniqueOrThrow({where:{id:certificateId}})
  assert.match(cert.keyPem,/^enc:v1:/);assert.ok(!cert.keyPem.includes('PRIVATE KEY'));assert.equal(cert.certType,'acme')
})
integration('M3 atomic issuance: revoked domain approval prevents final certificate persistence',async()=>{
  const pending=await job();const count=await db.certificate.count({where:{userId:user.id}})
  await db.domain.update({where:{id:domain.id},data:{auditStatus:1}})
  try{await assert.rejects(service.persistAcmeJob(String(user.id),String(pending.id),input),/eligibility changed/)}
  finally{await db.domain.update({where:{id:domain.id},data:{auditStatus:2}})}
  assert.equal(await db.certificate.count({where:{userId:user.id}}),count)
  assert.equal((await db.certificateJob.findUnique({where:{id:pending.id}})).status,'processing')
})
integration('M3 atomic issuance: a revoked package cannot be used after CA work completes',async()=>{
  const pending=await job();const count=await db.certificate.count({where:{userId:user.id}})
  await db.userPackage.updateMany({where:{userId:user.id},data:{status:2}})
  try{await assert.rejects(service.persistAcmeJob(String(user.id),String(pending.id),input),/active package/)}
  finally{await db.userPackage.updateMany({where:{userId:user.id},data:{status:1}})}
  assert.equal(await db.certificate.count({where:{userId:user.id}}),count)
})
integration('M3 atomic issuance: failure marking the job rolls back the new certificate',async()=>{
  const pending=await job();const count=await db.certificate.count({where:{userId:user.id}})
  const failingDb={$transaction:(fn,options)=>db.$transaction(tx=>fn({
    $queryRawUnsafe:(...args)=>tx.$queryRawUnsafe(...args),user:tx.user,domain:tx.domain,userPackage:tx.userPackage,certificate:tx.certificate,domainConfig:tx.domainConfig,
    certificateJob:{findFirst:args=>tx.certificateJob.findFirst(args),update:async()=>{throw new Error('Injected completion failure')}},
  }),options)}
  await assert.rejects(new CertificateService(failingDb,config).persistAcmeJob(String(user.id),String(pending.id),input),/Injected completion failure/)
  assert.equal(await db.certificate.count({where:{userId:user.id}}),count)
  assert.equal((await db.certificateJob.findUnique({where:{id:pending.id}})).status,'processing')
})
integration('M3 atomic renewal: the original certificate ID and bindings remain, and unbinding disables dependent HTTPS',async()=>{
  await service.bindDomainCertificate(String(user.id),String(domain.id),String(certificateId))
  await service.updateHttps(String(user.id),String(domain.id),{httpsEnabled:true,forceHttps:true,hstsEnabled:true})
  const pending=await job(certificateId);const count=await db.certificate.count({where:{userId:user.id}})
  const renewed=await service.persistAcmeJob(String(user.id),String(pending.id),input)
  assert.equal(renewed.certificateId,certificateId);assert.equal(await db.certificate.count({where:{userId:user.id}}),count)
  assert.equal((await db.domainConfig.findUnique({where:{domainId:domain.id}})).certId,certificateId)
  await service.bindDomainCertificate(String(user.id),String(domain.id),null)
  const https=await service.getHttps(String(user.id),String(domain.id))
  assert.equal(https.httpsEnabled,false);assert.equal(https.forceHttps,false);assert.equal(https.hstsEnabled,false)
})
integration('M3 certificates: unsigned BIGINT overflow and malformed chains fail before database writes',async()=>{
  await assert.rejects(service.get(String(user.id),'18446744073709551616'),/Invalid ID/)
  await assert.rejects(service.create(String(user.id),{name:'Invalid chain',certPem:input.certPem+'\n'+input.certPem,keyPem:input.keyPem}),/Certificate chain is invalid/)
})

const { test, before, after } = require('node:test')
const assert = require('node:assert/strict')
const { PrismaService } = require('../../dist/database/prisma.service')
const { M5Service } = require('../../dist/modules/statistics/m5.service')

const enabled=!!process.env.DATABASE_URL && new URL(process.env.DATABASE_URL).pathname.endsWith('_test')
const integration=enabled?test:test.skip
const suffix=`${Date.now()}${process.pid}`
const secret='m5-test-node-report-secret-long-enough'
let db,user,domain

before(async()=>{
  if(!enabled)return
  db=new PrismaService()
  await db.$connect()
  user=await db.user.create({data:{username:`m5_logs_${suffix}`,passwordHash:'integration-fixture',roleType:1}})
  domain=await db.domain.create({data:{userId:user.id,domain:`m5-log-${suffix}.example.com`,cname:`m5-log-${suffix}.invalid`,accessType:1,status:4,auditStatus:2}})
  await db.logDeliveryConfig.create({data:{domainId:domain.id,userId:user.id,enabled:false,retentionDays:2}})
})

after(async()=>{
  try{if(user)await db.user.delete({where:{id:user.id}})}finally{if(db)await db.$disconnect()}
})

integration('M5 MySQL log report stores uint64 bytes and expires at the configured domain retention',async()=>{
  const service=new M5Service(db,{get:key=>key==='nodeReportToken'?secret:undefined})
  const timestamp=String(Math.floor(Date.now()/1000))
  const time=new Date(Date.now()-60000).toISOString().replace('.000Z','Z')
  const maximum='18446744073709551615'
  const result=await service.reportLogs({'x-node-token':secret,'x-timestamp':timestamp},'127.0.0.1',{logs:[{domainId:String(domain.id),time,ip:'2001:db8::1',url:'/m5/retention-check',status:200,bytes:maximum,ua:'m5 integration fixture'}]})
  assert.deepEqual(result,{accepted:1})
  const rows=await service.accessLogs(String(user.id),{domainId:String(domain.id),startTime:'2026-10-24T00:00:00Z',endTime:'2026-10-25T00:00:00Z',url:'retention-check',userAgent:'integration fixture',page:1,pageSize:10})
  const stored=rows.list.find(row=>row.url==='/m5/retention-check')
  assert.ok(stored)
  assert.equal(stored.bytes,maximum)
  const expiryRows=await db.$queryRaw`SELECT expires_at AS expiresAt FROM access_logs WHERE domain_id=${domain.id} AND url='/m5/retention-check' ORDER BY id DESC LIMIT 1`
  const duration=expiryRows[0].expiresAt.getTime()-Date.now()
  assert.ok(duration>1.9*86400000 && duration<2.1*86400000,`expected configured 2 day retention, got ${duration} ms`)
})

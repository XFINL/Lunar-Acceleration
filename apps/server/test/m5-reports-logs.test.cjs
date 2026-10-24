const { test } = require('node:test')
const assert = require('node:assert/strict')
const { M5Service } = require('../dist/modules/statistics/m5.service')
const { BusinessException } = require('../dist/common/exceptions/business.exception')
const secret = 'test-only-node-report-token-that-is-long-enough'
const headers = token => ({ 'x-node-token': token, 'x-timestamp': String(Math.floor(Date.now()/1000)) })
const config = value => ({ get: key => key === 'nodeReportToken' ? value : undefined })
function make(db = {}) { return new M5Service(db, config(secret)) }
test('node reports fail closed when unconfigured and compare secret safely', async () => {
  const off = new M5Service({}, config(''))
  await assert.rejects(off.reportTraffic(headers(secret), '127.0.0.1', { stats: [{}] }), BusinessException)
  await assert.rejects(make().reportTraffic(headers('wrong'), '127.0.0.1', { stats: [{}] }), BusinessException)
  await assert.rejects(make().reportTraffic({ ...headers(secret), 'x-timestamp': '1' }, '127.0.0.1', { stats: [{}] }), BusinessException)
})
test('collector rejects per-node identifiers, oversized batches, and oversized payloads before database access', async () => {
  const service = make({ domain: { findMany: async () => { throw new Error('unexpected DB access') } } })
  const auth = headers(secret)
  await assert.rejects(service.reportTraffic(auth, '127.0.0.1', { nodeId: '7', stats: [{}] }), /nodeId is unsupported/)
  await assert.rejects(service.reportTraffic(auth, '127.0.0.1', { stats: Array(201).fill({}) }), /invalid report batch/)
  await assert.rejects(service.reportLogs(auth, '127.0.0.1', { logs: Array(201).fill({}) }), /invalid log batch/)
  await assert.rejects(service.reportLogs(auth, '127.0.0.1', { logs: [{ url: 'x'.repeat(300000) }] }), /invalid log batch/)
})
test('traffic collector validates the owner domain and upserts exact counters transactionally', async () => {
  const writes=[]
  const db={$queryRaw:async q=>q.sql.includes('FROM domains')?[{id:'9',user_id:'1'}]:[], $transaction:async fn=>fn({$executeRaw:async q=>{writes.push(q)}})}
  const service=make(db), time=new Date(Math.floor(Date.now()/3600000)*3600000).toISOString().replace('.000Z','Z')
  const result=await service.reportTraffic(headers(secret),'127.0.0.1',{stats:[{domainId:'9',time,traffic:'9007199254740993',requests:'4',bandwidthPeak:'10',cacheHit:'3',cacheMiss:'1',statusCodes:{200:'3',404:'1'}}]})
  assert.deepEqual(result,{accepted:1}); assert.equal(writes.length,4)
  assert.match(writes[0].strings.join(''),/INSERT INTO traffic_stats_hourly/)
  assert.match(writes[1].strings.join(''),/DELETE FROM traffic_status_hourly/)
  assert.match(writes[2].strings.join(''),/traffic_status_hourly/)
  await assert.rejects(service.reportTraffic(headers(secret),'127.0.0.1',{stats:[{domainId:'9',time,traffic:'1',requests:'1',cacheHit:'2'}]}),/cache counters exceed/)
})
test('access-log inputs reject non-IP, absolute URLs, bad status and do not contact storage', async () => {
  const service=make({$queryRaw:async()=>{throw new Error('unexpected DB access')}})
  const valid={time:'2026-10-24T12:00:00Z',domainId:'1',ip:'1.1.1.1',url:'/ok',status:200,bytes:'1'}
  for(const override of [{ip:'127.0.0.1:80'},{url:'http://127.0.0.1/'},{url:'//internal/'},{status:600},{url:'x'.repeat(2049)},{time:'2026-02-30T12:00:00Z'}])
    await assert.rejects(service.reportLogs(headers(secret),'127.0.0.1',{logs:[{...valid,...override}]}),BusinessException)
})
test('access-log CSV escapes formula cells, enforces paging, and UTC aggregate buckets are aligned', async () => {
  const db={$queryRaw:async()=>[{id:'1',domainId:'2',eventTime:new Date('2026-10-24T12:00:00Z'),ip:'1.1.1.1',url:'=HYPERLINK("x")',statusCode:200,bytes:'5',userAgent:'+cmd',region:null,isp:null}]}
  const service=make(db)
  const csv=await service.exportLogs('1',{startTime:'2026-10-24T00:00:00Z',endTime:'2026-10-25T00:00:00Z'})
  assert.match(csv,/'=HYPERLINK/); assert.match(csv,/'\+cmd/)
  await assert.rejects(service.accessLogs('1',{pageSize:'101'}),BusinessException)
  await assert.rejects(service.stat('1','traffic',{granularity:'week',startTime:'2026-10-24T00:00:00Z',endTime:'2026-10-31T00:00:00Z'}),BusinessException)
})
test('retention job issues an actual bounded DELETE for expired records', async () => {
  let query
  const service=make({accessLog:{deleteMany:async args=>{query=args;return {count:3}}}})
  assert.deepEqual(await service.pruneExpiredLogs(),{count:3})
  assert.ok(query.where.expiresAt.lt instanceof Date)
})

test('access-log filters include userAgent substring and searches allow arbitrary seconds within 31 days', async () => {
  let query
  const db={$queryRaw:async value=>{query=value;return []}}
  const service=make(db)
  const result=await service.accessLogs('1',{startTime:'2026-10-24T12:00:17+00:00',endTime:'2026-10-24T13:00:43Z',userAgent:'Mozilla'})
  assert.equal(result.list.length,0)
  assert.match(query.sql,/LOCATE\(\?,l\.user_agent\)>0/)
  assert.ok(query.values.includes('Mozilla'))
  assert.ok(query.values.includes('2026-10-24 12:00:17'))
  assert.ok(query.values.includes('2026-10-24 13:00:43'))
  await assert.rejects(service.accessLogs('1',{startTime:'2026-09-01T00:00:00Z',endTime:'2026-10-24T00:00:00Z'}),BusinessException)
})

test('statistics default ranges floor end by granularity and span complete UTC buckets', async () => {
  const service=make({$queryRaw:async()=>[]})
  for(const [granularity,span] of [['hour',24*3600000],['day',30*86400000],['week',28*86400000]]){
    const result=await service.stat('1','traffic',{granularity})
    const end=new Date(result.endTime),start=new Date(result.startTime)
    if(granularity==='hour')assert.equal(end.getUTCMinutes(),0)
    else assert.equal(end.getUTCHours(),0)
    if(granularity==='week')assert.equal(end.getUTCDay(),1)
    assert.equal(end.getTime()-start.getTime(),span)
  }
  const month=await service.stat('1','traffic',{granularity:'month'})
  assert.equal(new Date(month.endTime).getUTCDate(),1)
  assert.equal(new Date(month.endTime).getUTCHours(),0)
  assert.equal(new Date(month.startTime).getUTCMonth(),new Date(month.endTime).getUTCMonth())
  assert.equal(new Date(month.startTime).getUTCFullYear(),new Date(month.endTime).getUTCFullYear()-1)
})

test('CSV log export rejects more than 5000 matching rows instead of returning a truncated first page', async () => {
  const entries=Array.from({length:100},(_,i)=>({id:String(i+1),domainId:'2',eventTime:new Date('2026-10-24T12:00:00Z'),ip:'1.1.1.1',url:'/ok',statusCode:200,bytes:'1',userAgent:null,region:null,isp:null}))
  const service=make({$queryRaw:async()=>entries})
  await assert.rejects(service.exportLogs('1',{startTime:'2026-10-24T00:00:00Z',endTime:'2026-10-25T00:00:00Z'}),/exceeds 5000 rows/)
})

test('log report persists unsigned bytes with parameterized SQL, honors saved retention and publishes only after commit', async () => {
  const statements=[],published=[]
  const max='18446744073709551615'
  const db={
    $queryRaw:async q=>q.sql.includes('FROM domains')?[{id:'9',user_id:'7'}]:[{domain_id:'9',retention_days:2}],
    $transaction:async fn=>fn({$executeRaw:async q=>{statements.push(q)}}),
  }
  const service=new M5Service(db,config(secret),{publish:log=>published.push(log)})
  const before=Date.now()
  const eventTime=new Date(before-60000).toISOString().replace('.000Z','Z')
  const result=await service.reportLogs(headers(secret),'127.0.0.1',{logs:[{time:eventTime,domainId:'9',ip:'1.1.1.1',url:'/ok',status:200,bytes:max,ua:'Agent'}]})
  assert.deepEqual(result,{accepted:1})
  assert.equal(statements.length,1)
  assert.match(statements[0].sql,/CAST\(\? AS UNSIGNED\)/)
  assert.ok(statements[0].values.includes(max))
  const expiry=statements[0].values.at(-1)
  const parsedExpiry=new Date(`${expiry.replace(' ','T')}Z`).getTime()
  assert.ok(parsedExpiry>=before+2*86400000-2000)
  assert.equal(published.length,1)
  assert.equal(published[0].bytes,max)
})

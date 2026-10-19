const test = require('node:test')
const assert = require('node:assert/strict')
const { DomainResourceService } = require('../dist/modules/domain-resource/domain-resource.service.js')

function fixture() {
  const domain = { id: 4n, userId: 2n, deletedAt: null }
  const rules = [], groups = [], origins = []
  let rid = 1n, gid = 1n, oid = 1n
  const db = {
    domain: { findFirst: async ({ where }) => where.id === domain.id && where.userId === domain.userId ? domain : null },
    $queryRawUnsafe: async () => [{ id: 4n }],
    $transaction: async fn => fn(db),
    cacheRule: {
      count: async () => rules.length,
      aggregate: async () => ({ _max: { priority: rules.length - 1 } }),
      create: async ({ data }) => { const row = { id: rid++, ...data }; rules.push(row); return row },
      findMany: async ({ orderBy } = {}) => orderBy ? rules.slice().sort((a,b) => a.priority-b.priority) : rules,
    },
    originGroup: {
      create: async ({ data }) => { const { origins: nested, ...fields } = data; const group = { id: gid++, ...fields }; groups.push(group); for (const o of nested.create) origins.push({ id: oid++, originGroupId: group.id, ...o }); return { ...group, origins: origins.filter(o => o.originGroupId === group.id) } },
      findFirst: async ({ where, include }) => { const g = groups.find(g => g.id === where.id && (where.domainId === undefined || g.domainId === where.domainId)); return g && include ? { ...g, origins: origins.filter(o => o.originGroupId === g.id) } : (g || null) },
      findMany: async () => groups.map(g => ({ ...g, origins: origins.filter(o => o.originGroupId === g.id) })),
      update: async ({ where, data }) => Object.assign(groups.find(g => g.id === where.id), data),
      delete: async ({ where }) => { const i=groups.findIndex(g=>g.id===where.id); groups.splice(i,1); return {} },
    },
    origin: {
      count: async () => origins.length,
      findFirst: async ({ where }) => origins.find(o => o.id === where.id) || null,
      findMany: async ({ where }) => origins.filter(o => where.id.in.includes(o.id)).map(o => ({ ...o, group: groups.find(g => g.id === o.originGroupId) })),
      create: async ({ data }) => { const row = { id: oid++, ...data }; origins.push(row); return row },
      update: async ({ where, data }) => Object.assign(origins.find(o => o.id === where.id), data),
      delete: async ({ where }) => { const i=origins.findIndex(o=>o.id===where.id); origins.splice(i,1); return {} },
    },
  }
  return { service: new DomainResourceService(db), rules, groups, origins }
}
const origin = (overrides = {}) => ({ address: 'origin.example.test', port: 443, weight: 1, protocol: 'https', ...overrides })

test('cache rules persist expanded matcher/action fields and sort priority; safe regex subset is validation-only', async () => {
  const { service, rules } = fixture()
  for (const data of [
    { name:'type', matchType:'file_type', matchValue:'js', matchMode:'exact', action:'force_cache', ttl:60, ignoreParams:false, status:0 },
    { name:'status', matchType:'status', matchValue:'200, 304', matchMode:'contains', action:'cache', ttl:1, ignoreParams:true, cacheKey:'$host${uri}' },
    { name:'header', matchType:'header', matchValue:'X-Region:eu', matchMode:'prefix', action:'bypass', ttl:0, ignoreParams:true },
    { name:'query', matchType:'query', matchValue:'lang=en', matchMode:'suffix', action:'cache', ttl:2, ignoreParams:true },
    { name:'regex', matchType:'path', matchValue:'/img/[a-z]+\\.png$', matchMode:'regex', action:'cache', ttl:2, ignoreParams:true },
  ]) await service.createCacheRule('2', '4', data)
  assert.equal(rules.length, 5)
  assert.equal(rules[0].status, 0)
  assert.equal(rules[0].action, 'force_cache')
  assert.equal((await service.listCacheRules('2','4')).at(-1).priority, 4)
  await assert.rejects(service.createCacheRule('2','4',{name:'redos',matchType:'path',matchValue:'/(a+)+$',matchMode:'regex',action:'cache',ttl:1,ignoreParams:true}), /安全子集/)
  await assert.rejects(service.createCacheRule('2','4',{name:'key',matchType:'all',matchValue:'',matchMode:'exact',action:'cache',ttl:1,ignoreParams:true,cacheKey:'${bad space}'}), /cacheKey/)
})

test('origin policy aliases canonicalize; existing groups accept additions and can be deleted', async () => {
  const { service, groups } = fixture()
  const group = await service.createOriginGroup('2','4',{lbPolicy:2,healthCheck:{enabled:true,path:'/ready',interval:30,timeout:5,expectedStatus:204},origins:[origin()]})
  assert.equal(group.lbPolicy,'weighted')
  const changed = await service.addOriginsToGroup('2','4',group.id,{origins:[origin({address:'10.0.0.2',protocol:'http',port:8080})]})
  assert.equal(changed.origins.length,2)
  await assert.rejects(service.createOriginGroup('2','4',{healthCheck:{enabled:true,path:'//evil.test',interval:10,timeout:3,expectedStatus:200},origins:[origin()]}), /healthCheck/)
  assert.deepEqual(await service.deleteOriginGroup('2','4',group.id),{deleted:true})
  assert.equal(groups.length,0)
})

test('health check probes only saved domain origins and blocks configured private destinations', async () => {
  const { service } = fixture()
  const group = await service.createOriginGroup('2','4',{healthCheck:{enabled:true,path:'/health',interval:30,timeout:3,expectedStatus:200},origins:[origin({address:'127.0.0.1',protocol:'http',port:8080})]})
  const result = await service.healthCheck('2','4',{originIds:[group.origins[0].id]})
  assert.deepEqual(Object.keys(result),['results'])
  assert.equal(result.results[0].statusCode,null)
  assert.equal(result.results[0].errorCode,'BLOCKED_ADDRESS')
  assert.equal('address' in result.results[0],false)
  await assert.rejects(service.healthCheck('2','4',{originIds:['999']}), /记录不存在/)
  await assert.rejects(service.healthCheck('2','4',{originIds:['1'],url:'http://127.0.0.1'}), /originIds/)
})

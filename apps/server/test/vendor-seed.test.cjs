const {test}=require('node:test')
const assert=require('node:assert/strict')
const {join}=require('node:path')
require('ts-node').register({project:join(__dirname,'../tsconfig.json'),transpileOnly:true})
const {seedVendors}=require('../prisma/seeds/vendors.seed.ts')

test('M4 vendor seeds preserve operator-owned names and disabled status',async()=>{
 const existing={id:1n,code:'cloudflare',name:'Operator name',driver:'CloudflareDriver',status:0}
 const rows=new Map([['cloudflare',existing]])
 const updates=[]
 const db={vendor:{upsert:async({where,create,update})=>{
  updates.push(update)
  if(!rows.has(where.code))rows.set(where.code,{id:2n,...create,status:1})
  return rows.get(where.code)
 }}}
 assert.equal(await seedVendors(db),2)
 assert.equal(await seedVendors(db),2)
 assert.equal(rows.size,2)
 assert.equal(rows.get('cloudflare'),existing)
 assert.equal(rows.get('cloudflare').status,0)
 assert.equal(rows.get('cloudflare').name,'Operator name')
 assert.equal(rows.get('ali').driver,'AliDriver')
 assert.ok(updates.every(update=>Object.keys(update).length===0))
})

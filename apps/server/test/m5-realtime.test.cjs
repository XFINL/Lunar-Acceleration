const { test } = require('node:test')
const assert = require('node:assert/strict')
const { createServer } = require('node:http')
const { createHmac } = require('node:crypto')
const WebSocket = require('ws')
const { M5RealtimeGateway } = require('../dist/modules/statistics/m5-realtime.gateway')

const secret='m5-websocket-test-secret-that-is-not-production'
const token=(sub='42', exp=Math.floor(Date.now()/1000)+60)=>{
  const head=Buffer.from(JSON.stringify({alg:'HS256',typ:'JWT'})).toString('base64url')
  const body=Buffer.from(JSON.stringify({sub,exp})).toString('base64url')
  return `${head}.${body}.${createHmac('sha256',secret).update(`${head}.${body}`).digest('base64url')}`
}
const config={get:key=>key==='jwt.secret'?secret:undefined}
function makeDb(state={}){
  return {$queryRaw:async query=>{
    const sql=query.sql
    if(sql.includes('FROM users'))return state.active===false?[]:[{id:'42',status:state.active===false?0:1,deleted_at:null}]
    if(sql.includes('FROM user_roles'))return state.permission===false?[]:[{code:'log:read'}]
    if(sql.includes('FROM user_packages'))return state.feature===false?[]:[{enabled:1}]
    if(sql.includes('FROM domains'))return state.owns===false?[]:[{id:'9'}]
    throw new Error(`unexpected SQL: ${sql}`)
  }}
}
async function open(url){
  return new Promise((resolve,reject)=>{
    const ws=new WebSocket(url)
    ws.once('open',()=>resolve(ws))
    ws.once('unexpected-response',(_request,response)=>resolve({status:response.statusCode,ws}))
    ws.once('error',error=>{ if(ws.readyState===WebSocket.CLOSED)reject(error) })
  })
}
function next(ws, predicate=()=>true){
  return new Promise((resolve,reject)=>{
    const timer=setTimeout(()=>{ws.off('message',handler);reject(new Error('timed out waiting for websocket message'))},1500)
    const handler=data=>{let message;try{message=JSON.parse(data.toString())}catch{return}if(predicate(message)){clearTimeout(timer);ws.off('message',handler);resolve(message)}}
    ws.on('message',handler)
  })
}
async function fixture(state){
  const server=createServer()
  const gateway=new M5RealtimeGateway(makeDb(state),config)
  gateway.attach(server)
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve))
  const address=server.address()
  return {gateway,server,url:`ws://127.0.0.1:${address.port}/api/v1/user/logs/realtime`}
}
async function close(fixture,ws){
  if(ws&&ws.readyState===WebSocket.OPEN)ws.close()
  fixture.gateway.onModuleDestroy()
  await new Promise(resolve=>fixture.server.close(resolve))
}

test('M5 realtime WebSocket enforces JWT, live log:read permission, plan flag, domain owner and pushes filtered persisted-log shape',async()=>{
  const f=await fixture({})
  let ws
  try{
    ws=await open(`${f.url}?token=${encodeURIComponent(token())}`)
    assert.equal(ws.status,undefined,'valid JWT with active user, permission and plan feature upgrades')
    const subscribed=next(ws,m=>m.type==='subscribed')
    ws.send(JSON.stringify({action:'subscribe',domainId:'9',filters:{statusCode:[200],ip:'1.1.1.1',url:'/docs'}}))
    assert.deepEqual(await subscribed,{type:'subscribed',domainId:'9'})
    const received=next(ws,m=>m.type==='log')
    f.gateway.publish({domainId:'9',eventTime:new Date('2026-10-24T12:00:00Z'),ip:'1.1.1.1',url:'/docs/index',statusCode:200,bytes:'18446744073709551615',userAgent:'agent',region:null,isp:null})
    assert.deepEqual(await received,{type:'log',log:{domainId:'9',time:'2026-10-24T12:00:00.000Z',ip:'1.1.1.1',url:'/docs/index',status:200,bytes:'18446744073709551615',userAgent:'agent',region:null,isp:null}})
    const policy=next(ws,m=>m.type==='error')
    ws.send(JSON.stringify({action:'subscribe',domainId:'9',filters:{statusCode:Array(21).fill(200)}}))
    assert.equal((await policy).code,'invalid_filters')
    await new Promise(resolve=>ws.once('close',resolve))
  }finally{await close(f,ws)}
})

test('M5 realtime WebSocket rejects absent permission, absent plan feature, inactive user and invalid/expired JWT',async()=>{
  for(const [state,jwt,status] of [
    [{permission:false},token(),403],
    [{feature:false},token(),403],
    [{active:false},token(),401],
    [{},token('42',Math.floor(Date.now()/1000)-1),401],
  ]){
    const f=await fixture(state)
    try{
      const result=await open(`${f.url}?token=${encodeURIComponent(jwt)}`)
      assert.equal(result.status,status)
    }finally{await close(f)}
  }
})

test('M5 realtime WebSocket rechecks domain ownership and closes untrusted subscriptions safely',async()=>{
  const f=await fixture({owns:false})
  let ws
  try{
    ws=await open(`${f.url}?token=${encodeURIComponent(token())}`)
    const policy=next(ws,m=>m.type==='error')
    ws.send(JSON.stringify({action:'subscribe',domainId:'9'}))
    assert.equal((await policy).code,'domain_not_available')
    const closed=new Promise(resolve=>ws.once('close',(code,reason)=>resolve([code,reason])))
    const [code,reason]=await closed
    assert.equal(code,1008)
    assert.equal(reason.toString(),'policy violation')
  }finally{await close(f,ws)}
})

import test from 'node:test'
import { assert, withApp, DESKTOP_CHROME } from './vane-helpers.mjs'

const metadata = { origin: 'https://fern.example', 'cf-connecting-ip': '203.0.113.31', 'user-agent': DESKTOP_CHROME }
const batch = (app, events, headers = metadata) => app.post('/api/vane/collect-batch', { events }, '', headers)
const json = async response => { const body = await response.json(); return { status: response.status, body } }

test('native batches admit real pageviews once across simultaneous and in-batch retries, with exact goals, properties, counters and atomic conflict refusal',async t=>{
 const a=await withApp(t);await a.clock(Date.parse('2026-10-19T12:00:00Z'))
 const id=await a.addSite({paths:[],queryKeys:['plan']}),events=Array.from({length:98},(_,index)=>a.event(id,{path:index%2?'/thanks':'/checkout/123456',width:1440,props:{item:`synthetic-vane-${index}`,phone:'123 456 7890'},utm:{source:'newsletter'},query:{plan:'free'}}))
 const records=[...events,events[0],events[0]]
 const raced=await Promise.all([batch(a,records),batch(a,records)]),responses=await Promise.all(raced.map(json))
 assert.deepEqual(responses.map(r=>r.status),[202,202]);assert.deepEqual(responses.map(r=>r.body.accepted).sort((x,y)=>x-y),[0,98])
 for(const response of responses){assert.equal(response.body.atomic,true);assert.equal(response.body.results.length,100);assert.equal(response.body.results.filter(r=>r.status===202).length,response.body.accepted);assert.ok(response.body.results.every(r=>r.accepted&&(r.status===202||r.status===200&&r.duplicate===true)))}
 const again=await json(await batch(a,records));assert.equal(again.body.accepted,0);assert.ok(again.body.results.every(r=>r.status===200&&r.duplicate))
 const report=await (await a.request(`/api/vane/summary?siteId=${id}&period=today`,{headers:{cookie:a.owner}})).json()
 assert.deepEqual([report.pageviews,report.goals,report.visitors,report.transport.direct],[98,49,1,98])
 assert.deepEqual(report.pages.map(r=>[r.label,r.count]).sort(),[['/checkout/:number',49],['/thanks',49]])
 const custody=await a.dump()
 assert.equal(custody.vane_events.filter(row=>row.kind==='pageview').length,98)
 assert.equal(custody.vane_event_props.length,98)
 assert.equal(custody.vane_admission.find(row=>row.site_id===id).count,98)
 assert.equal(custody.vane_exclusions.find(row=>row.site_id===id&&row.reason==='dropped-property').count,98)
 assert.equal(custody.vane_collection_batch_admitted.length,0,'admission scratch never survives the transaction')
 const newEvent=a.event(id),conflicting={...events[0],path:'/different'}
 const conflict=await json(await batch(a,[newEvent,conflicting]));assert.deepEqual([conflict.status,conflict.body.index,conflict.body.accepted],[409,1,0])
 const after=await a.dump();assert.equal(after.vane_events.filter(row=>row.kind==='pageview').length,98);assert.equal(after.vane_collection_batch_admitted.length,0)
 assert.ok(!JSON.stringify(after).includes('203.0.113.31'),'visitor connection metadata is not stored')
})

test('batch validation is bounded, origin and consent scoped, refuses personal or trusted-metadata fields atomically, and leaves privacy counters field-free',async t=>{
 const a=await withApp(t);await a.clock(Date.parse('2026-10-19T12:00:00Z'))
 const id=await a.addSite({paths:[],consent:'required',declinedCounter:true,signalCounter:true}),valid=()=>a.event(id,{consent:'granted'})
 const personal=await json(await batch(a,[valid(),{...valid(),props:{email:'synthetic-vane@example.test'}}]))
 assert.deepEqual([personal.status,personal.body.index,personal.body.accepted],[400,1,0])
 for(const input of [[valid(),{...valid(),client_ip:'198.51.100.5'}],[valid(),{...valid(),cf:{country:'US'}}],[valid(),{...valid(),consent:'not-required'}]]){
  const refused=await json(await batch(a,input));assert.equal(refused.body.index,1);assert.equal(refused.body.accepted,0);assert.ok([400,403].includes(refused.status))
 }
 const foreign=await json(await batch(a,[valid()],{...metadata,origin:'https://foreign.example'}));assert.deepEqual([foreign.status,foreign.body.index],[403,0])
 assert.equal((await batch(a,[])).status,400)
 assert.equal((await batch(a,Array.from({length:101},valid))).status,400)
 assert.equal((await a.post('/api/vane/collect-batch',{events:[valid()],extra:true},'',metadata)).status,400)
 assert.equal((await a.post('/api/vane/collect-batch',{events:[valid()],padding:'x'.repeat(65536)},'',metadata)).status,413)
 assert.equal((await a.post('/api/vane/collect',[valid()],'',metadata)).status,400,'the ordinary collector still accepts one record only')
 for(const signal of [{dnt:'1'},{'sec-gpc':'1'}]){
  const refused=await json(await batch(a,[valid(),valid()],{...metadata,...signal}));assert.deepEqual([refused.status,refused.body.index,refused.body.accepted],[403,0,0])
 }
 let custody=await a.dump()
 assert.deepEqual([custody.vane_events.length,custody.vane_event_props.length,custody.vane_salts.length,custody.vane_signals.length,custody.vane_collection_batch_admitted.length],[0,0,0,0,0],'validation creates neither events, identities, salts nor implicit signal counts')
 const count=await a.request('/api/vane/signal/'+id,{method:'POST',headers:{...metadata,dnt:'1'},body:''});assert.equal(count.status,202)
 custody=await a.dump();assert.deepEqual([custody.vane_events.length,custody.vane_signals[0].count],[0,1])
 const accepted=await json(await batch(a,[valid()]));assert.deepEqual([accepted.status,accepted.body.accepted,accepted.body.results[0].status],[202,1,202])
})

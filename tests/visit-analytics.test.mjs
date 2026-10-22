import test from 'node:test'
import { assert, withApp } from './vane-helpers.mjs'

test('native visit facts keep reverse arrivals, tied IDs, a late bridge, engagement, performance replacement, restore and erasure exact through the summary door',async t=>{
 const a=await withApp(t),headers={cookie:a.owner},date='2026-06-01',origin='https://fern.example'
 await a.clock(Date.parse(date+'T10:00:00Z'))
 const siteId=await a.addSite({retention:'forever',paths:[]}),loads={}
 const load=async(name,time,id,source='synthetic-vane-1.example')=>{
  await a.clock(Date.parse(date+'T'+time+'Z'))
  const event=a.event(siteId,{id,path:'/'+name,source});loads[name]=event
  const response=await a.post('/api/vane/collect',event,'',{origin,'cf-connecting-ip':'203.0.113.17','user-agent':'Synthetic Vane Browser 1'})
  assert.equal(response.status,202,await response.clone().text());return event
 }
 const summary=async(app=a,extra='')=>{
  await app.clock(Date.parse('2026-06-02T12:00:00Z'))
  const response=await app.request(`/api/vane/summary?siteId=${siteId}&from=${date}&to=2026-06-02&interval=day${extra}`,{headers:{cookie:app.owner}})
  assert.equal(response.status,200,await response.clone().text());return response.json()
 }
 await load('c','10:50:00','ffffffff-ffff-4fff-8fff-ffffffffffff')
 await load('a','10:00:00','eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee','direct')
 assert.deepEqual([(await summary()).visits,(await summary()).bounces],[2,2])
 await a.clock(Date.parse(date+'T10:25:00Z'))
 loads.b=a.event(siteId,{id:'00000000-0000-4000-8000-000000000002',path:'/b',source:'synthetic-vane-1.example'})
 loads.tie=a.event(siteId,{id:'00000000-0000-4000-8000-000000000001',path:'/tie',source:'synthetic-vane-1.example'})
 const tied=await a.post('/api/vane/collect-batch',{events:[loads.b,loads.tie]},'',{origin,'cf-connecting-ip':'203.0.113.17','user-agent':'Synthetic Vane Browser 1'})
 assert.equal(tied.status,202,await tied.clone().text())
 let report=await summary()
 assert.deepEqual([report.pageviews,report.visits,report.bounces,report.averageDuration,report.medianDuration],[4,1,0,3000,3000])
 assert.deepEqual(report.entryPages.map(r=>[r.path,r.pageviews,r.visits]),[['/a',1,1]])
 assert.deepEqual(report.exitPages.map(r=>[r.path,r.pageviews,r.visits]),[['/c',1,1]])
 assert.equal(report.sourceVisits.find(r=>r.label==='direct').visits,1)
 assert.deepEqual(report.series.map(r=>[r.visits,r.pageviews,r.duration]),[[1,4,3000]])
 assert.equal(report.topPages.find(r=>r.path==='/tie').averageTimeOnPage,0)
 assert.equal(report.topPages.find(r=>r.path==='/b').averageTimeOnPage,1500)
 const tiedJourney=(await summary(a,'&journey=/tie')).journey
 assert.deepEqual(tiedJourney.next.map(r=>[r.steps,r.visits]),[[['/b','/c','(exit)'],1]])
 assert.deepEqual(tiedJourney.previous.map(r=>[r.steps,r.visits]),[[['/a','(entrance)'],1]])
 // Public engagement and performance arrive after their page occurrence.
 await a.clock(Date.parse(date+'T10:50:12Z'))
 assert.equal((await a.post('/api/vane/engage',{siteId,id:loads.c.id,scroll:80},'',{origin})).status,202)
 for(const lcp of [1000,3000])assert.equal((await a.post('/api/vane/perf',{siteId,id:loads.c.id,lcp,cls:0.2},'',{origin})).status,202)
 report=await summary()
 assert.deepEqual([report.pageviews,report.visits,report.averageDuration,report.medianDuration],[4,1,3012,3012])
 assert.equal(report.topPages.find(r=>r.path==='/c').averageScrollDepth,80)
 assert.deepEqual(report.perf.pages.map(r=>[r.label,r.measured,r.lcp,r.cls]),[['/c',1,3000,0.2]])
 // A retry neither adds a raw page nor duplicates any frequency population.
 assert.equal((await a.post('/api/vane/collect',loads.c,'',{origin,'cf-connecting-ip':'203.0.113.17','user-agent':'Synthetic Vane Browser 1'})).status,200)
 assert.equal((await summary()).pageviews,4)
 // A historical opaque ID sorts before the packed UUIDs at the same instant.
 // Introducing it invalidates and rebuilds the chain; journeys still follow
 // logical IDs, including the three distinct pages after this first match.
 await load('legacy','10:25:00','-'.repeat(36))
 const legacyJourney=(await summary(a,'&journey=/legacy')).journey
 assert.deepEqual(legacyJourney.next.map(r=>[r.steps,r.visits]),[[['/tie','/b','/c'],1]])
 assert.deepEqual(legacyJourney.previous.map(r=>[r.steps,r.visits]),[[['/a','(entrance)'],1]])
 report=await summary()
 const archive=await a.archive(),b=await withApp(t)
 const restored=await b.post('/api/vane/restore',{archive},b.owner)
 assert.equal(restored.status,200,await restored.clone().text())
 const after=await summary(b)
 assert.deepEqual([after.visits,after.bounces,after.topPages,after.entryPages,after.exitPages,after.perf],[report.visits,report.bounces,report.topPages,report.entryPages,report.exitPages,report.perf])
 assert.deepEqual((await summary(b,'&journey=/legacy')).journey,legacyJourney)
 const proposal=await (await b.post('/api/vane/commands',{command:'history.erase',input:{siteId}},b.owner)).json()
 assert.equal((await b.form({operation:'proposal.approve',id:proposal.id},b.owner)).status,303)
 const erased=await summary(b)
 assert.deepEqual([erased.pageviews,erased.visits,erased.bounces,erased.topPages,erased.perf.pages],[0,0,0,[],[]])
})

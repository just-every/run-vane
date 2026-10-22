import test from 'node:test'
import assert from 'node:assert/strict'
import { installation } from './harness.mjs'

// Admission, mutation, portable history and erasure all use public product
// doors. SQL reads only inspect the real rows that those doors retained.
test('compact native history preserves unusual IDs, raw detail, exact goals, replay and archive erasure',async t=>{
 const a=await installation();let sourceOpen=true
 t.after(()=>sourceOpen?a.close():undefined)
 const origin='https://fern.example',site=await a.addSite({retention:'30'}),at=Date.parse('2026-04-01T12:00:00Z')
 await a.clock(at)
 const canonical=a.event(site,{path:'/thanks'}),unusual=a.event(site,{id:'-'.repeat(36),path:'/thanks'})
 for(const event of [canonical,unusual])assert.equal((await a.collect(event)).status,202)
 const replay=await a.collect(canonical);assert.equal(replay.status,200);assert.equal((await replay.json()).duplicate,true)
 await a.clock(at+15000)
 assert.equal((await a.post('/api/vane/engage',{siteId:site,id:canonical.id,scroll:81},'',{origin})).status,202)
 assert.equal((await a.post('/api/vane/perf',{siteId:site,id:canonical.id,lcp:2601,inp:73,cls:0.123,load:2900},'',{origin})).status,202)
 const original=await a.archive(),events=original.payload.tables.vane_events
 assert.equal(events.length,4)
 assert.ok(events.every(row=>!Object.hasOwn(row,'_raw_id')))
 assert.ok(!Object.keys(original.payload.tables).some(name=>name.startsWith('vane_raw_')||name.startsWith('vane_visit_')))
 const page=events.find(row=>row.id===`${site}:${canonical.id}`)
 assert.ok(page.at>=at&&page.at<at+15000);assert.ok(page.engaged_at>=at+15000);assert.equal(page.scroll,81)
 assert.deepEqual([page.lcp,page.inp,page.cls,page.load_ms],[2601,73,0.123,2900])
 assert.ok(events.some(row=>row.id===`${site}:${unusual.id}:signup`))
 assert.equal((await a.inspectDb.prepare('SELECT COUNT(*) AS n FROM vane_raw_events').first()).n,4)
 const hashes=(await a.inspectDb.prepare('SELECT typeof(value) AS storage,length(value) AS bytes FROM vane_raw_identities').all()).results
 assert.ok(hashes.length>0&&hashes.every(row=>row.storage==='blob'&&row.bytes===32))
 const cells=(await a.inspectDb.prepare('SELECT kind,SUM(n) AS n FROM vane_analytics_cells GROUP BY kind ORDER BY kind').all()).results
 assert.deepEqual(cells,[{kind:'pageview',n:2},{kind:'signup',n:2}])
 await a.close();sourceOpen=false
 const b=await installation();t.after(()=>b.close())
 const restored=await b.post('/api/vane/restore',{archive:original},b.owner)
 assert.equal(restored.status,200,await restored.clone().text())
 const after=await b.archive(),sorted=rows=>[...rows].sort((x,y)=>x.id.localeCompare(y.id))
 assert.deepEqual(sorted(after.payload.tables.vane_events),sorted(events))
 assert.deepEqual((await b.inspectDb.prepare('SELECT kind,SUM(n) AS n FROM vane_analytics_cells GROUP BY kind ORDER BY kind').all()).results,cells)
 await b.clock(at+40*86400000)
 const erased=await b.form({operation:'history.retention',siteId:site},b.owner)
 assert.equal(erased.status,303,await erased.clone().text())
 assert.equal((await b.archive()).payload.tables.vane_events.length,0)
 for(const name of ['vane_raw_events','vane_raw_details','vane_raw_contexts','vane_raw_identities','vane_raw_sites','vane_analytics_cells','vane_analytics_identities'])assert.equal((await b.inspectDb.prepare(`SELECT COUNT(*) AS n FROM ${name}`).first()).n,0,name)
})

import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { installation } from './harness.mjs'
const fixture=JSON.parse(await readFile(new URL('./fixtures/umami-events.json',import.meta.url),'utf8'))
async function withApp(t){const app=await installation();t.after(()=>app.close());return app}
async function movein(app,siteId,document=fixture){const r=await app.post('/api/vane/import-preview',{siteId,document},app.owner);assert.equal(r.status,200,await r.clone().text());const p=await r.json();const a=await app.post('/api/vane/import-apply',{siteId,document:p.carry,fingerprint:p.fingerprint},app.owner);assert.equal(a.status,200,await a.clone().text());return {preview:p,applied:await a.json()}}

test('HTTP-001 and ACCESS-002: one Worker serves honest public doors; every private door rejects anonymous and cross-origin requests',async t=>{
 const a=await withApp(t),id=await a.addSite()
 const health=await a.request('/health');assert.equal(health.status,200);assert.equal((await health.json()).status,'ok')
 for(const path of ['/','/signin'])assert.equal((await a.request(path)).status,200,path)
 const setup=await a.request('/setup');assert.ok([200,303].includes(setup.status),'setup answers')
 const script=await a.request('/vane.js');assert.equal(script.status,200);assert.match(script.headers.get('content-type'),/javascript/);assert.match(await script.text(),/\/api\/vane\/collect/)
 const config=await a.request('/api/vane/config/'+id,{headers:{origin:'https://fern.example'}});assert.equal(config.status,200);assert.deepEqual((await config.json()).paths,['/','/thanks'])
 for(const path of ['/no-such-page','/api/no-such-door'])assert.equal((await a.request(path)).status,404,path)
 assert.equal((await a.request('/api/vane/no-such-door',{headers:{cookie:a.owner}})).status,404)
 for(const path of ['/api/vane/sites','/api/vane/summary','/api/vane/export','/api/vane/proposals','/api/vane/import-journal'])assert.equal((await a.request(path)).status,401)
 for(const path of ['/api/vane/commands','/api/vane/import-preview','/api/vane/import-apply','/api/vane/import-undo','/api/vane/restore','/app/action'])assert.equal((await a.post(path,{})).status,401)
 assert.equal((await a.post('/api/vane/commands',{command:'site.create'},a.owner,{origin:'https://foreign.example'})).status,403)
 for(const path of ['/app','/app/sites/'+id]){const r=await a.request(path);assert.equal(r.status,303);assert.match(r.headers.get('location'),/^\/signin/)}
 assert.equal((await a.post('/auth/signout',{},a.owner)).status,204)
 assert.equal((await a.request('/api/vane/sites',{headers:{cookie:a.owner}})).status,401)
})
test('administrator prepares, owner approves once, members only read and revoked operators lose access',async t=>{
 const a=await withApp(t),admin=await a.invite('admin@example.test','admin'),member=await a.invite('member@example.test','member')
 const input={name:'Oak Books',origin:'https://oak.example',paths:['/'],goals:{},sources:[],campaigns:[],consent:'required',sampleRate:100,retentionDays:30}
 assert.equal((await a.post('/api/vane/commands',{command:'site.create',input},member)).status,403)
 const p=await (await a.post('/api/vane/commands',{command:'site.create',input},admin)).json()
 assert.equal((await a.form({operation:'proposal.approve',id:p.id},admin)).status,403)
 assert.equal((await a.request('/api/vane/sites',{headers:{cookie:member}})).status,200)
 assert.equal((await a.request('/api/vane/export',{headers:{cookie:member}})).status,403)
 for(const path of ['/api/vane/import-preview','/api/vane/import-apply','/api/vane/import-undo','/api/vane/restore'])assert.equal((await a.post(path,{},admin)).status,403)
 assert.equal((await a.form({operation:'proposal.approve',id:p.id},a.owner)).status,303)
 assert.equal((await a.form({operation:'proposal.approve',id:p.id},a.owner)).status,409)
 const proposals=await (await a.request('/api/vane/proposals',{headers:{cookie:a.owner}})).json();assert.ok(proposals[0].approved_by);assert.notEqual(proposals[0].approved_by,proposals[0].prepared_by)
 const operators=await (await a.request('/auth/operators',{headers:{cookie:a.owner}})).json();const list=Array.isArray(operators)?operators:operators.operators
 const person=list.find(p=>p.email==='admin@example.test');assert.equal((await a.post('/auth/operator/status',{operatorId:person.id,status:'inactive'},a.owner)).status,200)
 assert.equal((await a.request('/api/vane/sites',{headers:{cookie:admin}})).status,401)
})
test('script ingestion enforces site origin, field allowlists, consent, deduplication and goal totals',async t=>{
 const a=await withApp(t),id=await a.addSite(),event=a.event(id,{path:'/thanks'})
 assert.equal((await a.collect(event,'https://foreign.example')).status,403)
 assert.equal((await a.collect({...event,email:'synthetic@example.test'})).status,400)
 assert.equal((await a.collect({...event,path:'/people/alex?email=private'})).status,400)
 assert.equal((await a.collect(event)).status,202)
 assert.equal((await a.collect(event)).status,200)
 assert.equal((await a.collect({...event,path:'/'})).status,409)
 const report=await (await a.request('/api/vane/summary?siteId='+id,{headers:{cookie:a.owner}})).json();assert.equal(report.visits,1);assert.equal(report.goals,1);assert.equal(report.sources[0].label,'search.example')
 const consentSite=await a.addSite({origin:'https://consent.example',consent:'required'})
 assert.equal((await a.collect(a.event(consentSite),'https://consent.example')).status,403)
 assert.equal((await a.collect(a.event(consentSite,{consent:'granted'}),'https://consent.example')).status,202)
})
test('Umami dry run retains no raw identifiers; exact reviewed import is idempotent, journalled and undoable',async t=>{
 const a=await withApp(t),id=await a.addSite(),before=await a.archive(),r=await a.post('/api/vane/import-preview',{siteId:id,document:fixture},a.owner),p=await r.json()
 assert.equal(r.status,200);assert.equal(JSON.stringify(p).includes('synthetic-session'),false);assert.equal(JSON.stringify(p).includes('synthetic-private-path'),false)
 assert.deepEqual((await a.archive()).payload.tables,before.payload.tables)
 assert.equal((await a.post('/api/vane/import-apply',{siteId:id,document:p.carry,fingerprint:'changed'},a.owner)).status,409)
 const first=await movein(a,id),second=await movein(a,id);assert.equal(first.applied.job.id,second.applied.job.id)
 const archive=await a.archive();assert.equal(archive.payload.tables.vane_import_events.length,3);assert.ok(archive.payload.tables.vane_import_events.every(e=>e.sample_rate===null&&e.consent===null))
 const history=await(await a.request('/api/vane/summary?siteId='+id+'&from=2026-10-01&to=2026-10-04',{headers:{cookie:a.owner}})).json();assert.equal(history.visits,2);assert.equal(history.goals,1);assert.equal(history.unknownCoverage,3)
 for(const secret of ['synthetic-session','synthetic-private-path','synthetic%40example.test','Synthetic title'])assert.equal(JSON.stringify(archive).includes(secret),false)
 const journal=await (await a.request(`/api/vane/import-journal?siteId=${id}&jobId=${first.applied.job.id}`,{headers:{cookie:a.owner}})).json();assert.ok(journal.approval.ownerId);assert.ok(journal.batches.length)
 const undone=await a.post('/api/vane/import-undo',{siteId:id,jobId:first.applied.job.id},a.owner);assert.equal(undone.status,200,await undone.clone().text());assert.equal((await a.archive()).payload.tables.vane_import_events.length,0)
})
test('complete history restores atomically into an empty installation, rejects corruption and preserves import undo',async t=>{
 const a=await withApp(t),b=await withApp(t),id=await a.addSite();await a.collect(a.event(id));const imported=await movein(a,id),archive=await a.archive()
 const corrupt=structuredClone(archive);corrupt.payload.tables.vane_events[0].path='/changed'
 assert.equal((await b.post('/api/vane/restore',{archive:corrupt},b.owner)).status,400)
 assert.equal((await b.archive()).payload.tables.vane_sites.length,0)
 const result=await b.post('/api/vane/restore',{archive},b.owner);assert.equal(result.status,200,await result.clone().text())
 const restored=await b.archive();assert.deepEqual(restored.payload.tables.vane_events,archive.payload.tables.vane_events);assert.deepEqual(restored.payload.tables.vane_import_events,archive.payload.tables.vane_import_events)
 assert.equal((await b.post('/api/vane/restore',{archive},b.owner)).status,409)
 const undone=await b.post('/api/vane/import-undo',{siteId:id,jobId:imported.applied.job.id},b.owner);assert.equal(undone.status,200,await undone.clone().text())
 assert.equal((await b.archive()).payload.tables.vane_import_events.length,0)
})
test('owner erasure removes live and imported custody and later journals fence old backups',async t=>{
 const a=await withApp(t),b=await withApp(t),id=await a.addSite();await a.collect(a.event(id));await movein(a,id);const old=await a.archive()
 const p=await (await a.post('/api/vane/commands',{command:'history.erase',input:{siteId:id}},a.owner)).json();assert.ok((await a.archive()).payload.tables.vane_events.length)
 const erased=await a.form({operation:'proposal.approve',id:p.id},a.owner);assert.equal(erased.status,303,await erased.clone().text())
 const later=await a.archive();assert.equal(later.payload.tables.vane_events.length,0);assert.equal(later.payload.tables.vane_import_events.length,0);assert.ok(later.payload.tables.vane_deletions.length);assert.ok(later.payload.tables.ik_d1_erasure_journal.length)
 assert.equal((await b.post('/api/vane/restore',{archive:old,journal:later},b.owner)).status,409)
 assert.equal((await b.archive()).payload.tables.vane_sites.length,0)
})
test('retention removes old imported history while retaining recent events and a deletion journal',async t=>{
 const a=await withApp(t),id=await a.addSite({retentionDays:30}),old=structuredClone(fixture);for(const row of old.data)row.createdAt='2020-01-01T00:00:00Z';await movein(a,id,old);await a.collect(a.event(id))
 for(let n=0;n<3;n++){const r=await a.form({operation:'history.retention',siteId:id},a.owner);assert.equal(r.status,303,await r.clone().text())}
 const archive=await a.archive();assert.equal(archive.payload.tables.vane_import_events.length,0);assert.equal(archive.payload.tables.vane_events.length,1);assert.equal(archive.payload.tables.vane_deletions.length,1)
})

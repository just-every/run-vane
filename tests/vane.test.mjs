import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { installation } from './harness.mjs'
const fixture=JSON.parse(await readFile(new URL('./fixtures/umami-events.json',import.meta.url),'utf8'))
async function withApp(t){const app=await installation();t.after(()=>app.close());return app}
// A real browser whose requests are all recorded: the built Worker serves the installation's origin, `pages` serves fixture pages, and anything else is refused.
async function browse(t,a,pages={}){
 const {chromium}=await import('@playwright/test'),browser=await chromium.launch({headless:true,args:['--use-mock-keychain','--password-store=basic']});t.after(()=>browser.close())
 const context=await browser.newContext(),requests=[]
 await context.route('**/*',async route=>{
  const request=route.request(),url=new URL(request.url());requests.push(url.origin)
  if(pages[url.href])return route.fulfill({contentType:'text/html',body:pages[url.href]})
  if(url.origin!==a.origin)return route.abort()
  const response=await a.request(url.pathname+url.search,{method:request.method(),headers:request.headers(),body:request.postData()??undefined})
  return route.fulfill({status:response.status,headers:Object.fromEntries(response.headers),body:Buffer.from(await response.arrayBuffer())})
 })
 return {context,requests}
}
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
 const report=await (await a.request('/api/vane/summary?siteId='+id,{headers:{cookie:a.owner}})).json();assert.equal(report.pageviews,1);assert.equal(report.goals,1);assert.equal(report.sources[0].label,'search.example')
 const consentSite=await a.addSite({origin:'https://consent.example',consent:'required'})
 assert.equal((await a.collect(a.event(consentSite),'https://consent.example')).status,403)
 assert.equal((await a.collect(a.event(consentSite,{consent:'granted'}),'https://consent.example')).status,202)
})
test('Umami dry run retains no raw identifiers; exact reviewed import is idempotent, journalled and undoable',async t=>{
 const a=await withApp(t),id=await a.addSite(),before=await a.archive(),r=await a.post('/api/vane/import-preview',{siteId:id,document:fixture},a.owner),p=await r.json()
 assert.equal(r.status,200);assert.equal(JSON.stringify(p).includes('synthetic-session'),false);assert.equal(JSON.stringify(p).includes('synthetic-private-path'),false)
 const {vane_audit:auditAfter,...after}=(await a.archive()).payload.tables,{vane_audit:auditBefore,...unchanged}=before.payload.tables
 assert.deepEqual(after,unchanged);assert.deepEqual(auditAfter.filter(entry=>!auditBefore.some(prior=>prior.id===entry.id)).map(entry=>entry.action),['history.export'],'only the export itself is audited')
 assert.equal((await a.post('/api/vane/import-apply',{siteId:id,document:p.carry,fingerprint:'changed'},a.owner)).status,409)
 const first=await movein(a,id),second=await movein(a,id);assert.equal(first.applied.job.id,second.applied.job.id)
 const archive=await a.archive();assert.equal(archive.payload.tables.vane_import_events.length,3);assert.ok(archive.payload.tables.vane_import_events.every(e=>e.sample_rate===null&&e.consent===null))
 const history=await(await a.request('/api/vane/summary?siteId='+id+'&from=2026-10-01&to=2026-10-04',{headers:{cookie:a.owner}})).json();assert.equal(history.pageviews,2);assert.equal(history.goals,1);assert.equal(history.unknownCoverage,3)
 for(const secret of ['synthetic-session','synthetic-private-path','synthetic%40example.test','Synthetic title'])assert.equal(JSON.stringify(archive).includes(secret),false)
 const journal=await (await a.request(`/api/vane/import-journal?siteId=${id}&jobId=${first.applied.job.id}`,{headers:{cookie:a.owner}})).json();assert.ok(journal.approval.ownerId);assert.ok(journal.batches.length)
 const undone=await a.post('/api/vane/import-undo',{siteId:id,jobId:first.applied.job.id},a.owner);assert.equal(undone.status,200,await undone.clone().text());assert.equal((await a.archive()).payload.tables.vane_import_events.length,0)
})
test('complete history restores atomically into an empty installation, rejects corruption and preserves import undo',async t=>{
 const a=await withApp(t),b=await withApp(t),id=await a.addSite();await a.collect(a.event(id));const imported=await movein(a,id),archive=await a.archive()
 const corrupt=structuredClone(archive);corrupt.payload.tables.vane_events[0].path='/changed'
 assert.equal((await b.post('/api/vane/restore',{archive:corrupt},b.owner)).status,400)
 assert.equal((await b.archive()).payload.tables.vane_sites.length,0)
 const earlier=structuredClone(archive);delete earlier.payload.tables.vane_signals;delete earlier.payload.tables.vane_audit;earlier.sha256=createHash('sha256').update(JSON.stringify(earlier.payload)).digest('hex')
 const result=await b.post('/api/vane/restore',{archive:earlier},b.owner);assert.equal(result.status,200,await result.clone().text())
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
test('TRAFFIC-001 the default seven-day report compares totals and every breakdown with the preceding period and states its coverage limits',async t=>{
 const a=await withApp(t),id=await a.addSite(),dayOf=n=>new Date(Date.now()-n*86400000).toISOString().slice(0,10)
 const row=(n,ago,path,referrerDomain,query,eventName='')=>({id:'traffic-'+n,websiteId:'w',sessionId:'s'+n,createdAt:dayOf(ago)+'T12:00:00Z',urlPath:path,urlQuery:query,referrerPath:'',referrerQuery:'',referrerDomain,pageTitle:'',eventType:eventName?2:1,eventName})
 const data=[row(1,2,'/','search.example','utm_campaign=launch'),row(2,9,'/','search.example','utm_campaign=launch'),row(3,8,'/','',''),row(4,12,'/','',''),row(5,10,'/thanks','search.example','utm_campaign=launch','signup')]
 await movein(a,id,{data,count:data.length,page:1,pageSize:data.length})
 assert.equal((await a.collect(a.event(id,{path:'/thanks'}))).status,202)
 const r=await (await a.request('/api/vane/summary?siteId='+id,{headers:{cookie:a.owner}})).json()
 assert.deepEqual([r.from,r.to,r.previousFrom],[dayOf(6),dayOf(-1),dayOf(13)])
 assert.deepEqual([r.pageviews,r.goals,r.previousPageviews,r.previousGoals,r.imported,r.unknownCoverage],[2,1,3,1,1,1])
 const pick=rows=>rows.map(({label,count,previous})=>[label,count,previous])
 assert.deepEqual(pick(r.sources),[['search.example',2,1],['direct',0,2]])
 assert.deepEqual(pick(r.campaigns),[['launch',2,1],['none',0,2]])
 assert.deepEqual(pick(r.pages),[['/',1,3],['/thanks',1,0]])
 assert.deepEqual(pick(r.goalBreakdown),[['signup',1,1]])
 assert.match(r.explanation,new RegExp(`${r.from} to ${r.to} .*: 2 accepted page loads; ${r.previousFrom} to ${r.from}: 3\\. Difference: -1\\. Goal events: 1, previously 1\\.`))
 for(const limit of ['Consent exclusions','blockers','sampling','imports','Collection coverage is not measured'])assert.ok(r.explanation.includes(limit),limit)
 const earlier=await (await a.request(`/api/vane/summary?siteId=${id}&from=${r.previousFrom}&to=${r.from}`,{headers:{cookie:a.owner}})).json()
 assert.deepEqual([earlier.pageviews,earlier.goals,earlier.imported,earlier.unknownCoverage],[3,1,4,4])
 const page=await (await a.request('/app/sites/'+id+'?section=report',{headers:{cookie:a.owner}})).text()
 assert.match(page,/-33\.3%<\/span> compared with the previous period \(3\)/)
 assert.match(page,/<th scope="row">direct<\/th><td class="vane-number">0<\/td><td class="vane-number">2<\/td><td class="vane-number">-2<\/td>/)
 for(const limit of ['Sample rate</dt><dd>100% of eligible page loads','Consent</dt><dd>Not required','Allowed paths</dt><dd>/, /thanks','Imported activity</dt><dd>1','Unknown coverage</dt><dd>1','Blocked scripts, missing consent, sampling and unconfigured paths'])assert.ok(page.includes(limit),limit)
})
test('PRIVACY-005 visitor data stays in the installation: the script talks only to its own origin, and collection, reports, import and export make no outbound request',async t=>{
 const a=await withApp(t),id=await a.addSite(),before=a.egress.length,seed=JSON.parse(await readFile(new URL('../seed.json',import.meta.url),'utf8'))
 assert.deepEqual(seed.externals.map(external=>external.id),['cloudflare'])
 const {context,requests}=await browse(t,a,{'https://fern.example/thanks':`<!doctype html><title>Fern Studio</title><h1>Thanks</h1><script src="${a.origin}/vane.js" data-site="${id}"></script>`})
 const page=await context.newPage(),collected=page.waitForResponse(response=>new URL(response.url()).pathname==='/api/vane/collect'&&response.request().method()==='POST')
 await page.goto('https://fern.example/thanks')
 assert.equal((await collected).status(),202)
 assert.deepEqual([...new Set(requests)],['https://fern.example',a.origin])
 assert.deepEqual(await page.evaluate(()=>[document.cookie,localStorage.length,sessionStorage.length]),['',0,0]);assert.deepEqual(await context.cookies(),[])
 assert.equal((await a.collect(a.event(id))).status,202)
 const summary=await (await a.request('/api/vane/summary?siteId='+id,{headers:{cookie:a.owner}})).json();assert.equal(summary.pageviews,2);assert.equal(summary.goals,1)
 for(const path of ['/app','/api/vane/sites',...['report','settings','history','approvals'].map(section=>`/app/sites/${id}?section=${section}`)])assert.equal((await a.request(path,{headers:{cookie:a.owner}})).status,200,path)
 await movein(a,id);assert.equal((await a.archive()).payload.tables.vane_events.length,3)
 assert.deepEqual(a.egress.slice(before),[])
 await context.close()
})
test('LOBBY-001 a fresh installation keeps its themed Lobby, first-run setup, email-link sign-in and /app, with no landing-drawing figures in analytics',async t=>{
 const a=await installation({setup:false});t.after(()=>a.close())
 const themed=async(path,cookie='')=>{const r=await a.request(path,{headers:{cookie}});assert.equal(r.status,200,path);const html=await r.text();assert.match(html,/<link rel="stylesheet" href="\/rer-theme\.css">/,path);return html}
 const lobby=await themed('/');await themed('/signin')
 assert.equal((await a.request('/app',{headers:{cookie:a.owner}})).headers.get('location'),'/setup')
 await themed('/setup',a.owner)
 assert.equal((await a.request('/setup',{method:'POST',headers:{origin:a.origin,'content-type':'application/x-www-form-urlencoded',cookie:a.owner},body:'confirm=yes'})).status,303)
 assert.equal((await a.request('/setup',{headers:{cookie:a.owner}})).headers.get('location'),'/app')
 assert.equal((await a.post('/auth/signout',{},a.owner)).status,204)
 assert.equal((await a.post('/auth/magic-link',{email:'owner@example.test'})).status,202)
 const link=new URL(a.sentMail.at(-1).html.match(/href="([^"]*\/auth\/confirm\?token=[^"]+)"/)[1].replaceAll('&amp;','&'))
 const confirmed=await a.post('/auth/confirm',{token:link.searchParams.get('token')});assert.equal(confirmed.status,303)
 const owner=a.cookieOf(confirmed),app=await themed('/app',owner)
 assert.match(app,/<link rel="stylesheet" href="\/vane\.css">/)
 assert.deepEqual(await (await a.request('/api/vane/sites',{headers:{cookie:owner}})).json(),[])
 for(const figure of ['Juniper','4,812','28,416','3,912'])for(const html of [lobby,app])assert.equal(html.includes(figure),false,figure)
 const {context}=await browse(t,a);await context.addCookies(owner.split('; ').map(pair=>{const [name,...value]=pair.split('=');return {name,value:value.join('='),url:a.origin}}))
 const page=await context.newPage()
 for(const [path,title] of [['/','Vane'],['/app','Sites']]){
  assert.equal((await page.goto(a.origin+path,{waitUntil:'networkidle'})).status(),200,path)
  assert.ok((await page.title()).includes(title),path)
  assert.notEqual(await page.evaluate(()=>getComputedStyle(document.documentElement).getPropertyValue('--rer-page').trim()),'',`${path} carries the shared theme tokens`)
  assert.equal(await page.evaluate(()=>/Juniper|4,812|28,416|3,912/.test(document.body.innerText)),false,path)
 }
 await context.close()
})
test('INSTALL-001 Verify installation names the exact cause of each failure and turns verified when the first event arrives',async t=>{
 const a=await withApp(t),id=await a.addSite(),owner={headers:{cookie:a.owner}}
 const home=(body,headers={})=>()=>new Response(`<!doctype html><title>Fern Studio</title>${body}`,{headers:{'content-type':'text/html',...headers}})
 const script=(site=id)=>`<script defer src="${a.origin}/vane.js" data-site="${site}"></script>`
 const verify=async(siteId=id)=>{const r=await a.form({operation:'install.verify',siteId},a.owner);assert.equal(r.status,303,await r.clone().text());return new URL(r.headers.get('location'),a.origin).searchParams.get('notice')}
 assert.equal((await (await a.request('/api/vane/sites',owner)).json())[0].awaitingFirstEvent,true)
 assert.ok((await (await a.request('/app',owner)).text()).includes('Awaiting first event'))
 assert.match(await (await a.request(`/app/sites/${id}?section=settings`,owner)).text(),/<input type="hidden" name="operation" value="install.verify">.*Verify installation<\/button>/s)
 a.fixtureSites['https://fern.example']=home('<h1>Fern</h1>')
 assert.match(await verify(),/^No script from http:\/\/127\.0\.0\.1:8787\/vane\.js was found on https:\/\/fern\.example\//)
 a.fixtureSites['https://fern.example']=home(script('not-this-site'))
 assert.match(await verify(),/names site ID "not-this-site", not /)
 a.fixtureSites['https://fern.example']=home(script(),{'content-security-policy':"default-src 'self'"})
 assert.match(await verify(),/Content Security Policy does not allow scripts from http:\/\/127\.0\.0\.1:8787/)
 a.fixtureSites['https://fern.example']=home(script(),{'content-security-policy':`default-src 'self'; script-src 'self' ${a.origin}`})
 assert.match(await verify(),/Content Security Policy does not allow connections to http:\/\/127\.0\.0\.1:8787/)
 a.fixtureSites['https://fern.example']=()=>new Response(null,{status:301,headers:{location:'https://www.fern.example/'}});a.fixtureSites['https://www.fern.example']=home(script())
 assert.match(await verify(),/moved to https:\/\/www\.fern\.example, but this site is registered for https:\/\/fern\.example/)
 const consentSite=await a.addSite({origin:'https://consent.example',consent:'required'}),pathSite=await a.addSite({origin:'https://paths.example',paths:['/thanks'],goals:{}})
 a.fixtureSites['https://consent.example']=home(script(consentSite));a.fixtureSites['https://paths.example']=home(script(pathSite))
 assert.match(await verify(consentSite),/requires consent, but https:\/\/consent\.example\/ never sets window\.vaneConsent/)
 assert.match(await verify(pathSite),/homepage path \/ is not an allowed path/)
 a.fixtureSites['https://fern.example']=home(script(),{'content-security-policy':`script-src 'self' ${a.origin}; connect-src ${a.origin}`})
 const pending=verify();await new Promise(done=>setTimeout(done,1500))
 assert.equal((await a.collect(a.event(id))).status,202)
 assert.match(await pending,/^Installation verified: the script is on https:\/\/fern\.example\/ and its first event has arrived\.$/)
 assert.equal((await (await a.request('/api/vane/sites',owner)).json()).find(site=>site.id===id).awaitingFirstEvent,false)
})
test('PRIVACY-002 GPC and DNT stop collection, an owner-enabled field-free counter shows their share, and settings and the methodology page state the stance',async t=>{
 const a=await withApp(t),owner={headers:{cookie:a.owner}},counted=await a.addSite({signalCounter:true}),quiet=await a.addSite({origin:'https://quiet.example'})
 const page=(origin,site,attribute='')=>`<!doctype html><title>Fixture</title><script src="${a.origin}/vane.js" data-site="${site}"${attribute}></script>`
 const {context,requests}=await browse(t,a,{'https://fern.example/':page('https://fern.example',counted,' data-count-signals'),'https://quiet.example/':page('https://quiet.example',quiet)})
 const signals={gpc:"Object.defineProperty(Navigator.prototype,'globalPrivacyControl',{get:()=>true})",dnt:"Object.defineProperty(Navigator.prototype,'doNotTrack',{get:()=>'1'})"}
 for(const script of Object.values(signals)){
  const tab=await context.newPage();await tab.addInitScript(script);const before=requests.length
  const sent=tab.waitForResponse(response=>new URL(response.url()).pathname===`/api/vane/signal/${counted}`)
  await tab.goto('https://fern.example/');assert.equal((await sent).status(),202)
  await tab.goto('https://quiet.example/',{waitUntil:'networkidle'})
  assert.deepEqual(requests.slice(before),['https://fern.example',a.origin,a.origin,'https://quiet.example',a.origin],'a signalling browser sends one count to a counting site and nothing beyond the script to any other')
  await tab.close()
 }
 const plain=await context.newPage(),collected=plain.waitForResponse(response=>new URL(response.url()).pathname==='/api/vane/collect')
 await plain.goto('https://fern.example/');assert.equal((await collected).status(),202)
 const report=await (await a.request('/api/vane/summary?siteId='+counted,owner)).json();assert.deepEqual([report.pageviews,report.privacySignals,report.signalCounter],[1,2,true])
 assert.match(await (await a.request(`/app/sites/${counted}?section=report`,owner)).text(),/2 page loads sent Global Privacy Control or Do Not Track and were not collected \(66\.7% of observed page loads\)/)
 const archive=await a.archive();assert.deepEqual(archive.payload.tables.vane_signals.map(row=>Object.keys(row).sort()),[['count','day','site_id']])
 assert.equal((await a.request('/api/vane/summary?siteId='+quiet,owner).then(r=>r.json())).pageviews,0)
 assert.equal((await a.post('/api/vane/signal/'+quiet,undefined,'',{origin:'https://quiet.example'})).status,403)
 assert.equal((await a.request('/api/vane/signal/'+counted,{method:'POST',headers:{origin:'https://fern.example'},body:'path=/private'})).status,400)
 const settings=await (await a.request(`/app/sites/${counted}?section=settings`,owner)).text()
 assert.ok(settings.includes(`data-site=&quot;${counted}&quot; data-count-signals&gt;&lt;/script&gt;`),'the snippet carries the counter');assert.match(settings,/Privacy stance.*CCPA|Privacy stance.*California Consumer Privacy Act/s);assert.match(settings,/name="signalCounter" value="on" checked/)
 const methodology=await a.request('/methodology');assert.equal(methodology.status,200)
 const text=await methodology.text();for(const phrase of ['Global Privacy Control and Do Not Track are honoured by default','California Consumer Privacy Act as amended by the CPRA','other US state privacy laws','one count that carries no path'])assert.ok(text.includes(phrase),phrase)
 await context.close()
})
test('COLLECT-001 in a browser a default-mode pageview leaves no cookie or storage, and only the owner opt-out writes vane_ignore and stops collection',async t=>{
 const a=await withApp(t),id=await a.addSite(),owner={headers:{cookie:a.owner}},page=`<!doctype html><title>Fern Studio</title><script src="${a.origin}/vane.js" data-site="${id}"></script>`
 const {context,requests}=await browse(t,a,{'https://fern.example/':page,'https://fern.example/thanks':page}),tab=await context.newPage()
 const collects=[];tab.on('request',request=>{if(new URL(request.url()).pathname==='/api/vane/collect')collects.push(request.url())})
 const storage=()=>tab.evaluate(()=>({cookie:document.cookie,local:{...localStorage},session:sessionStorage.length}))
 const collected=()=>tab.waitForResponse(response=>new URL(response.url()).pathname==='/api/vane/collect')
 let sent=collected();await tab.goto('https://fern.example/');assert.equal((await sent).status(),202)
 assert.deepEqual(await storage(),{cookie:'',local:{},session:0});assert.deepEqual(await context.cookies(),[])
 await tab.goto('https://fern.example/thanks#vane-ignore=on');await tab.goto('https://fern.example/');await tab.waitForTimeout(1500)
 assert.equal(collects.length,1,'an excluded browser sends nothing');assert.deepEqual(await storage(),{cookie:'',local:{vane_ignore:'true'},session:0})
 sent=collected();await tab.goto('https://fern.example/thanks#vane-ignore=off');assert.equal((await sent).status(),202)
 assert.equal(collects.length,2);assert.deepEqual(await storage(),{cookie:'',local:{},session:0})
 assert.ok(requests.every(origin=>['https://fern.example',a.origin].includes(origin)))
 const summary=await (await a.request('/api/vane/summary?siteId='+id,owner)).json();assert.deepEqual([summary.pageviews,summary.goals],[2,1])
 const inventory=await (await a.request(`/app/sites/${id}?section=report`,owner)).text(),methodology=await (await a.request('/methodology')).text()
 for(const html of [inventory,methodology])for(const phrase of ['exactly two declared exceptions','single vane_ignore localStorage flag that holds no identifier','Consented identifier'])assert.ok(html.includes(phrase),phrase)
 assert.ok((await (await a.request(`/app/sites/${id}?section=settings`,owner)).text()).includes('https://fern.example/#vane-ignore=on'))
 await context.close()
})
test('AUDIT-001 every audited action is recorded with actor, time and subject, shown in the audit view, exported, and kept without erased data',async t=>{
 const a=await withApp(t),b=await withApp(t),admin=await a.invite('admin@example.test','admin'),member=await a.invite('member@example.test','member'),owner={headers:{cookie:a.owner}}
 const input={name:'Fern Studio',origin:'https://fern.example',paths:['/','/thanks'],goals:{signup:'/thanks'},campaigns:['launch'],sources:['search.example'],consent:'not-required',sampleRate:100,retentionDays:90}
 const created=await (await a.post('/api/vane/commands',{command:'site.create',input},admin)).json(),id=created.payload.siteId
 assert.equal((await a.form({operation:'proposal.approve',id:created.id},a.owner)).status,303)
 assert.equal((await a.form({operation:'config.prepare',siteId:id,...input,name:'Fern Studio US',paths:'/\n/thanks',goals:'signup=/thanks',campaigns:'launch',sources:'search.example'},admin)).status,303)
 const configured=(await (await a.request('/api/vane/proposals',owner)).json()).find(p=>p.state==='pending');assert.equal((await a.form({operation:'proposal.approve',id:configured.id},a.owner)).status,303)
 const imported=await movein(a,id);assert.equal((await a.post('/api/vane/import-undo',{siteId:id,jobId:imported.applied.job.id},a.owner)).status,200)
 assert.equal((await a.form({operation:'history.retention',siteId:id},a.owner)).status,303)
 assert.equal((await a.collect(a.event(id,{path:'/thanks'}))).status,202)
 const erase=await (await a.post('/api/vane/commands',{command:'history.erase',input:{siteId:id}},a.owner)).json();assert.equal((await a.form({operation:'proposal.approve',id:erase.id},a.owner)).status,303)
 const archive=await a.archive()
 const log=await (await a.request('/api/vane/audit',owner)).json(),actions=new Set(log.map(entry=>entry.action))
 for(const action of ['sign-in','agent.prepare','proposal.prepare','proposal.approve','site.create','settings.change','import.apply','import.undo','history.retention','history.erase','history.export'])assert.ok(actions.has(action),action)
 const people=await (await a.request('/auth/operators',owner)).json(),list=Array.isArray(people)?people:people.operators,adminId=list.find(p=>p.email==='admin@example.test').id
 assert.deepEqual(log.filter(entry=>entry.action==='agent.prepare').map(entry=>entry.subject).sort(),[created.id,erase.id].sort())
 assert.equal(log.find(entry=>entry.action==='agent.prepare'&&entry.subject===created.id).actor,adminId)
 assert.ok(log.filter(entry=>entry.action==='sign-in').map(entry=>entry.actor).includes(adminId))
 assert.ok(log.every(entry=>entry.at>Date.now()-600000&&entry.actor&&entry.subject))
 assert.ok(log.find(entry=>entry.action==='settings.change').subject===id&&log.find(entry=>entry.action==='history.erase').subject===id)
 assert.equal(archive.payload.tables.vane_events.length,0)
 const exported=archive.payload.tables.vane_audit;assert.ok(['import.apply','history.erase'].every(action=>exported.some(entry=>entry.action===action)),'audit travels in the archive')
 assert.equal(/\/thanks|search\.example|launch/.test(JSON.stringify(exported)),false,'audit entries hold no erased event data')
 const view=await (await a.request('/app?section=audit',owner)).text();for(const action of ['agent.prepare','settings.change','history.erase','sign-in'])assert.ok(view.includes(`<th scope="row">${action}</th>`),action)
 assert.equal((await a.request('/api/vane/audit',{headers:{cookie:member}})).status,403)
 assert.equal((await b.post('/api/vane/restore',{archive},b.owner)).status,200)
 const restored=await (await b.request('/api/vane/audit',{headers:{cookie:b.owner}})).json();assert.ok(restored.some(entry=>entry.action==='history.restore'));assert.ok(restored.some(entry=>entry.action==='history.erase'&&entry.subject===id))
})
test('METRIC-001 unique visitors are distinct daily salted hashes summed over days, with no IP, user agent or stale salt kept',async t=>{
 const a=await withApp(t),owner={headers:{cookie:a.owner}},id=await a.addSite({timeZone:'Pacific/Pago_Pago'}),other=await a.addSite({origin:'https://oak.example'})
 const people=[{ip:'203.0.113.7',ua:'Synthetic Browser 1'},{ip:'198.51.100.4',ua:'Synthetic Browser 2'}]
 const visit=async(site,origin,person,path='/')=>assert.equal((await a.post('/api/vane/collect',a.event(site,{path}),'',{origin,'cf-connecting-ip':person.ip,'user-agent':person.ua})).status,202)
 const localDay=timeZone=>new Intl.DateTimeFormat('en-CA',{timeZone,year:'numeric',month:'2-digit',day:'2-digit'}).format(Date.now()),next=d=>new Date(Date.parse(d)+86400000).toISOString().slice(0,10)
 const first=localDay('Pacific/Pago_Pago'),second=localDay('Pacific/Kiritimati');assert.notEqual(first,second)
 await visit(id,'https://fern.example',people[0]);await visit(id,'https://fern.example',people[0],'/thanks');await visit(id,'https://fern.example',people[1])
 // The site's time zone moves from UTC-11 to UTC+14: its local date, and so its salt, rotates to the next day.
 const input={siteId:id,name:'Fern Studio',origin:'https://fern.example',paths:['/','/thanks'],goals:{signup:'/thanks'},campaigns:['launch'],sources:['search.example'],consent:'not-required',sampleRate:100,retentionDays:90,timeZone:'Pacific/Kiritimati'}
 const moved=await (await a.post('/api/vane/commands',{command:'site.configure',input},a.owner)).json();assert.equal((await a.form({operation:'proposal.approve',id:moved.id},a.owner)).status,303)
 await visit(id,'https://fern.example',people[0]);await visit(id,'https://fern.example',people[1]);await visit(other,'https://oak.example',people[0])
 const summary=async query=>(await a.request(`/api/vane/summary?siteId=${id}${query}`,owner)).json()
 for(const day of [first,second])assert.equal((await summary(`&from=${day}&to=${next(day)}`)).visitors,2,day)
 const range=await summary('');assert.deepEqual([range.to,range.visitors,range.pageviews],[next(second),4,5]);assert.match(range.explanation,/Unique visitors: 4, previously 0, each the sum of daily uniques/)
 const hashes=day=>new Set(rows.filter(r=>r.site_id===id&&r.day===day&&r.kind==='pageview').map(r=>r.visitor)),rows=(await a.archive()).payload.tables.vane_events
 assert.deepEqual([hashes(first).size,hashes(second).size,new Set([...hashes(first),...hashes(second)]).size],[2,2,4],'a visitor cannot be followed across days')
 const elsewhere=rows.find(r=>r.site_id===other).visitor;assert.ok(rows.filter(r=>r.site_id===id).every(r=>r.visitor!==elsewhere),'the same visitor hashes differently on another site')
 const archive=await a.archive();assert.equal(Object.hasOwn(archive.payload.tables,'vane_salts'),false)
 await a.scheduled();const database=await a.dump()
 for(const secret of [...people.map(p=>p.ip),'Synthetic Browser'])for(const [where,value] of [['database',database],['archive',archive]])assert.equal(JSON.stringify(value).includes(secret),false,`${where} holds ${secret}`)
 assert.deepEqual(database.vane_salts.filter(salt=>salt.site_id===id).map(salt=>salt.day),[second],'the previous day salt is gone');assert.ok(database.vane_salts.every(salt=>salt.created_at>Date.now()-86400000))
 const methodology=await (await a.request('/methodology')).text();for(const phrase of ['SHA-256(daily salt + site ID + IP address + user agent)','deleted after 24 hours','sum of daily uniques'])assert.ok(methodology.includes(phrase),phrase)
})
test('METRIC-002 one visitor\'s pageviews 10, 40 and 5 minutes apart make 2 visits of 4 pageviews, 2 pages per visit, and the daily salt ends a visit at midnight',async t=>{
 const a=await withApp(t),owner={headers:{cookie:a.owner}},id=await a.addSite(),person={origin:'https://fern.example','cf-connecting-ip':'203.0.113.9','user-agent':'Synthetic Browser 3'}
 assert.equal((await a.request('/__dev/clock',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({at:0})})).status,404,'the clock door needs the local dev key')
 const load=async at=>{await a.clock(at);assert.equal((await a.post('/api/vane/collect',a.event(id),'',person)).status,202)}
 const start=Date.parse('2026-03-02T09:00:00Z');for(const minutes of [0,10,50,55])await load(start+minutes*60000)
 const summary=async(from,to)=>(await a.request(`/api/vane/summary?siteId=${id}&from=${from}&to=${to}`,owner)).json()
 const day=await summary('2026-03-02','2026-03-03');assert.deepEqual([day.visits,day.pageviews,day.pagesPerVisit,day.visitors,day.viewsPerVisitor],[2,4,2,1,4])
 assert.match(day.explanation,/Visits: 2, previously 0, each a run of one visitor hash's page loads with no gap over 30 minutes/)
 const page=await (await a.request(`/app/sites/${id}?section=report&from=2026-03-02&to=2026-03-03`,owner)).text()
 for(const tile of ['<h2>Visits</h2><p class="vane-metric">2</p>','<h2>Pageviews</h2><p class="vane-metric">4</p>','<h2>Pages per visit</h2><p class="vane-metric">2</p><p class="vane-help">Views per visitor: 4.</p>'])assert.ok(page.includes(tile),tile)
 // 23:50 is a new visit after a 13-hour gap; 00:05 is 15 minutes later but on the next day's salt, so it is another.
 await load(Date.parse('2026-03-02T23:50:00Z'));await load(Date.parse('2026-03-03T00:05:00Z'))
 const both=await summary('2026-03-02','2026-03-04');assert.deepEqual([both.visits,both.pageviews,both.pagesPerVisit,both.visitors,both.viewsPerVisitor],[4,6,1.5,2,3])
 const methodology=await (await a.request('/methodology')).text();for(const phrase of ['no gap over 30 minutes','a visit also ends at midnight in the site’s time zone','views per visitor'])assert.ok(methodology.includes(phrase),phrase)
})
test('METRIC-003 a quick bounce, a 45-second single-page visit and a three-page visit give the bounce rate, visit durations and time on page, and the script pings only after 10 visible seconds',async t=>{
 const a=await withApp(t),owner={headers:{cookie:a.owner}},id=await a.addSite(),start=Date.parse('2026-03-04T10:00:00Z')
 const person=n=>({origin:'https://fern.example','cf-connecting-ip':'198.51.100.'+n,'user-agent':'Synthetic Browser '+n})
 const load=async(n,seconds,path='/')=>{await a.clock(start+seconds*1000);const event=a.event(id,{path});assert.equal((await a.post('/api/vane/collect',event,'',person(n))).status,202);return event.id}
 const engage=async(pageLoad,seconds,status,body={siteId:id,id:pageLoad,scroll:pageLoad===last?80:40})=>{await a.clock(start+seconds*1000);const r=await a.post('/api/vane/engage',body,'',{origin:'https://fern.example'});assert.equal(r.status,status,await r.text())}
 let last
 await load(1,0)
 const single=await load(2,0);await engage(single,5,409);await engage(single,11,202);await engage(single,45,202)
 await load(3,0);await load(3,20,'/thanks');last=await load(3,80);await engage(last,120,202)
 await engage(single,50,400,{siteId:id,id:single,seconds:50});await engage(crypto.randomUUID(),50,404);await engage(single,1900,409)
 const r=await (await a.request(`/api/vane/summary?siteId=${id}&from=2026-03-04&to=2026-03-05`,owner)).json()
 assert.deepEqual([r.visits,r.pageviews,r.bounces,r.bounceRate,r.medianDuration,r.averageDuration],[3,5,1,33.3,45,55])
 assert.deepEqual(r.engagement,[{path:'/',pageviews:4,entries:3,bounceRate:33.3,medianDuration:45,averageDuration:55,medianTimeOnPage:30,averageTimeOnPage:26,averageScrollDepth:60,reached75Share:50},{path:'/thanks',pageviews:1,entries:0,bounceRate:null,medianDuration:null,averageDuration:null,medianTimeOnPage:60,averageTimeOnPage:60,averageScrollDepth:null,reached75Share:null}])
 const page=await (await a.request(`/app/sites/${id}?section=report&from=2026-03-04&to=2026-03-05`,owner)).text()
 for(const html of ['<h2>Bounce rate</h2><p class="vane-metric">33.3%</p>','<h2>Visit duration</h2><p class="vane-metric">0m 45s</p><p class="vane-help">Median; average 0m 55s.','<th scope="row">/</th><td class="vane-number">4</td><td class="vane-number">3</td><td class="vane-number">33.3%</td><td class="vane-number">0m 45s / 0m 55s</td><td class="vane-number">0m 30s / 0m 26s</td>'])assert.ok(page.includes(html),html)
 // In a browser: a page hidden after 3 seconds sends nothing (a bounce); the next visit pings at 10 visible seconds and again when hidden.
 const oak=await a.addSite({origin:'https://oak.example'}),html=`<!doctype html><title>Oak</title><script src="${a.origin}/vane.js" data-site="${oak}"></script>`
 const {context}=await browse(t,a,{'https://oak.example/':html}),tab=await context.newPage(),pings=[]
 tab.on('request',request=>{if(new URL(request.url()).pathname==='/api/vane/engage'&&request.method()==='POST')pings.push(JSON.parse(request.postData()))})
 const answered=path=>tab.waitForResponse(response=>new URL(response.url()).pathname===path&&response.request().method()==='POST')
 const hide=()=>tab.evaluate(()=>{Object.defineProperty(document,'visibilityState',{configurable:true,get:()=>'hidden'});document.dispatchEvent(new Event('visibilitychange'))})
 const morning=Date.parse('2026-03-05T10:00:00Z'),later=morning+7200000
 await tab.clock.install({time:morning});await a.clock(morning)
 let sent=answered('/api/vane/collect');await tab.goto('https://oak.example/');assert.equal((await sent).status(),202)
 await tab.clock.fastForward(3000);await hide();await tab.waitForTimeout(1000);assert.equal(pings.length,0,'hidden within 10 seconds: no ping')
 await a.clock(later);await tab.clock.setSystemTime(later)
 sent=answered('/api/vane/collect');await tab.goto('https://oak.example/');assert.equal((await sent).status(),202)
 await a.clock(later+11000);sent=answered('/api/vane/engage');await tab.clock.fastForward(10000);assert.equal((await sent).status(),202)
 await a.clock(later+30000);sent=answered('/api/vane/engage');await tab.clock.fastForward(19000);await hide();assert.equal((await sent).status(),202)
 assert.deepEqual(pings.map(p=>Object.keys(p).sort()),[['id','scroll','siteId'],['id','scroll','siteId']],'pings carry only the site and page-load IDs and the scroll depth')
 const o=await (await a.request(`/api/vane/summary?siteId=${oak}&from=2026-03-05&to=2026-03-06`,owner)).json()
 assert.deepEqual([o.visits,o.bounces,o.bounceRate,o.medianDuration,o.averageDuration],[2,1,50,15,15])
 const methodology=await (await a.request('/methodology')).text();for(const phrase of ['A bounce is a visit with one page load and no engagement ping','visible for 10 seconds or more','median and average time on each page'])assert.ok(methodology.includes(phrase),phrase)
 await context.close()
})
test('METRIC-006 in a browser, visits scrolling a long page to 50% and to 100% give a 75% average depth and a 50% share reaching 75%, and a 75% scroll goal converts once',async t=>{
 const a=await withApp(t),owner={headers:{cookie:a.owner}},id=await a.addSite({scrollGoals:{'deep-read':{path:'/',depth:75}}})
 const html=`<!doctype html><title>Fern Studio</title><div style="height:4000px">A long page</div><script src="${a.origin}/vane.js" data-site="${id}"></script>`
 const {context}=await browse(t,a,{'https://fern.example/':html}),tab=await context.newPage(),loads=[]
 const answered=path=>tab.waitForResponse(response=>new URL(response.url()).pathname===path&&response.request().method()==='POST')
 const morning=Date.parse('2026-03-06T10:00:00Z');await tab.clock.install({time:morning})
 for(const [visit,share] of [0.5,1].entries()) {
  const time=morning+visit*7200000;await a.clock(time);await tab.clock.setSystemTime(time)
  let sent=answered('/api/vane/collect');await tab.goto('https://fern.example/');assert.equal((await sent).status(),202)
  await tab.evaluate(share=>scrollTo(0,document.documentElement.scrollHeight*share-innerHeight),share)
  await a.clock(time+11000);sent=answered('/api/vane/engage');await tab.clock.fastForward(10000)
  const ping=await sent;assert.equal(ping.status(),202);const body=JSON.parse(ping.request().postData());assert.equal(body.scroll,share*100);loads.push(body.id)
 }
 for(const scroll of [101,-1,50.5,undefined])assert.equal((await a.post('/api/vane/engage',{siteId:id,id:loads[0],scroll},'',{origin:'https://fern.example'})).status,400,String(scroll))
 const r=await (await a.request(`/api/vane/summary?siteId=${id}&from=2026-03-06&to=2026-03-07`,owner)).json()
 assert.deepEqual([r.engagement[0].path,r.engagement[0].averageScrollDepth,r.engagement[0].reached75Share],['/',75,50])
 assert.deepEqual([r.goals,r.goalBreakdown.map(g=>[g.label,g.count])],[1,[['deep-read',1]]],'only the visit that reached 75% converts, once')
 const page=await (await a.request(`/app/sites/${id}?section=report&from=2026-03-06&to=2026-03-07`,owner)).text();assert.ok(page.includes('<td class="vane-number">75.0%</td><td class="vane-number">50.0%</td>'))
 assert.ok((await (await a.request(`/app/sites/${id}?section=settings`,owner)).text()).includes('deep-read=/@75'))
 const methodology=await (await a.request('/methodology')).text();for(const phrase of ['as a whole percentage from 0 to 100','the share of page loads reaching 75%','converts once per page load'])assert.ok(methodology.includes(phrase),phrase)
 await context.close()
})

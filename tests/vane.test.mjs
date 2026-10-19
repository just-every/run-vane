import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { installation } from './harness.mjs'
const fixture=JSON.parse(await readFile(new URL('./fixtures/umami-events.json',import.meta.url),'utf8'))
async function withApp(t){const app=await installation();t.after(()=>app.close());return app}
// A real browser whose requests are all recorded: the built Worker serves the installation's origin, `pages` serves fixture pages, and anything else is refused.
async function browse(t,a,pages={},options={}){
 const {chromium}=await import('@playwright/test'),browser=await chromium.launch({headless:true,args:['--use-mock-keychain','--password-store=basic']});t.after(()=>browser.close())
 const context=await browser.newContext(options),requests=[]
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
 const input={name:'Oak Books',origin:'https://oak.example',paths:['/'],goals:{},consent:'required',sampleRate:100,retentionDays:30}
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
 for(const limit of ['Sample rate</dt><dd>100% of eligible page loads','Consent</dt><dd>Not required','Allowed paths</dt><dd>/, /thanks','Imported activity</dt><dd>1','Unknown coverage</dt><dd>1','Blocked scripts, missing consent, sampling and excluded paths'])assert.ok(page.includes(limit),limit)
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
 assert.match(await verify(pathSite),/homepage path \/ is left out by this site's include or exclude paths/)
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
 const input={name:'Fern Studio',origin:'https://fern.example',paths:['/','/thanks'],goals:{signup:'/thanks'},consent:'not-required',sampleRate:100,retentionDays:90}
 const created=await (await a.post('/api/vane/commands',{command:'site.create',input},admin)).json(),id=created.payload.siteId
 assert.equal((await a.form({operation:'proposal.approve',id:created.id},a.owner)).status,303)
 assert.equal((await a.form({operation:'config.prepare',siteId:id,...input,name:'Fern Studio US',paths:'/\n/thanks',goals:'signup=/thanks'},admin)).status,303)
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
 const input={siteId:id,name:'Fern Studio',origin:'https://fern.example',paths:['/','/thanks'],goals:{signup:'/thanks'},consent:'not-required',sampleRate:100,retentionDays:90,timeZone:'Pacific/Kiritimati'}
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
 assert.deepEqual(r.topPages,[{path:'/',visitors:3,pageviews:4,visits:3,bounceRate:33.3,conversionRate:33.3,medianDuration:45,averageDuration:55,medianTimeOnPage:30,averageTimeOnPage:26,averageScrollDepth:60,reached75Share:50},{path:'/thanks',visitors:1,pageviews:1,visits:1,bounceRate:0,conversionRate:100,medianDuration:120,averageDuration:120,medianTimeOnPage:60,averageTimeOnPage:60,averageScrollDepth:null,reached75Share:null}])
 const page=await (await a.request(`/app/sites/${id}?section=report&from=2026-03-04&to=2026-03-05`,owner)).text()
 for(const html of ['<h2>Bounce rate</h2><p class="vane-metric">33.3%</p>','<h2>Visit duration</h2><p class="vane-metric">0m 45s</p><p class="vane-help">Median; average 0m 55s.','<th scope="row">/</th><td class="vane-number">3</td><td class="vane-number">4</td><td class="vane-number">3</td><td class="vane-number">33.3%</td><td class="vane-number">0m 45s / 0m 55s</td><td class="vane-number">0m 30s / 0m 26s</td>'])assert.ok(page.includes(html),html)
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
 assert.deepEqual([r.topPages[0].path,r.topPages[0].averageScrollDepth,r.topPages[0].reached75Share],['/',75,50])
 assert.deepEqual([r.goals,r.goalBreakdown.map(g=>[g.label,g.count])],[1,[['deep-read',1]]],'only the visit that reached 75% converts, once')
 const page=await (await a.request(`/app/sites/${id}?section=report&from=2026-03-06&to=2026-03-07`,owner)).text();assert.ok(page.includes('<td class="vane-number">75.0%</td><td class="vane-number">50.0%</td>'))
 assert.ok((await (await a.request(`/app/sites/${id}?section=settings`,owner)).text()).includes('deep-read=/@75'))
 const methodology=await (await a.request('/methodology')).text();for(const phrase of ['as a whole percentage from 0 to 100','the share of page loads reaching 75%','converts once per page load'])assert.ok(methodology.includes(phrase),phrase)
 await context.close()
})
test('DASH-003 seeded visits give top, entry and exit pages with visitors, pageviews, bounce rate, time on page and conversion rate, and grouping by /blog/* sums the posts',async t=>{
 const a=await withApp(t),owner={headers:{cookie:a.owner}},id=await a.addSite({paths:['/','/pricing','/blog/a','/blog/b','/thanks']}),start=Date.parse('2026-03-09T10:00:00Z')
 const visit=async(n,paths)=>{for(const [i,path] of paths.entries()){await a.clock(start+n*3600000+i*20000);assert.equal((await a.post('/api/vane/collect',a.event(id,{path}),'',{origin:'https://fern.example','cf-connecting-ip':'192.0.2.'+n,'user-agent':'Synthetic Browser '+n})).status,202)}}
 await visit(1,['/','/blog/a','/thanks']);await visit(2,['/blog/a','/blog/b']);await visit(3,['/blog/b']);await visit(4,['/pricing','/'])
 const summary=async(group='')=>(await a.request(`/api/vane/summary?siteId=${id}&from=2026-03-09&to=2026-03-10${group&&'&group='+encodeURIComponent(group)}`,owner)).json()
 const pick=rows=>rows.map(r=>[r.path,r.visitors,r.pageviews,r.visits,r.bounceRate,r.conversionRate])
 const r=await summary()
 assert.deepEqual(pick(r.topPages),[['/',2,2,2,0,50],['/blog/a',2,2,2,0,50],['/blog/b',2,2,2,50,0],['/pricing',1,1,1,0,0],['/thanks',1,1,1,0,100]])
 assert.deepEqual(pick(r.entryPages),[['/',1,1,1,0,100],['/blog/a',1,1,1,0,0],['/blog/b',1,1,1,100,0],['/pricing',1,1,1,0,0]])
 assert.deepEqual(pick(r.exitPages),[['/blog/b',2,2,2,50,0],['/',1,1,1,0,0],['/thanks',1,1,1,0,100]])
 assert.deepEqual([r.topPages[0].medianTimeOnPage,r.topPages[0].averageTimeOnPage,r.entryPages[0].medianDuration],[10,10,40],'time on / is 20 s then 0 s; the visit entering / lasts 40 s')
 const g=await summary('/blog/*')
 assert.deepEqual(pick(g.topPages),[['/blog/*',3,4,3,33.3,33.3],['/',2,2,2,0,50],['/pricing',1,1,1,0,0],['/thanks',1,1,1,0,100]])
 assert.deepEqual(pick(g.entryPages)[0],['/blog/*',2,2,2,50,0]);assert.deepEqual(pick(g.exitPages)[0],['/blog/*',2,2,2,50,0])
 assert.deepEqual(pick((await summary('/blog/*=/articles')).topPages)[0],['/articles',3,4,3,33.3,33.3],'a rewrite rule renames the group')
 assert.equal((await a.request(`/api/vane/summary?siteId=${id}&group=blog`,owner)).status,400)
 const page=await (await a.request(`/app/sites/${id}?section=report&from=2026-03-09&to=2026-03-10&group=%2Fblog%2F*`,owner)).text()
 for(const html of ['<h2>Top pages</h2>','<h2>Entry pages</h2>','<h2>Exit pages</h2>','<th scope="row">/blog/*</th><td class="vane-number">3</td><td class="vane-number">4</td><td class="vane-number">3</td><td class="vane-number">33.3%</td>','name="group" value="/blog/*"'])assert.ok(page.includes(html),html)
})
test('CONV-001 /thanks/* converts on /thanks/pro only and /thanks** on every page below, a 75% scroll goal on /blog/** converts at 80% and not at 50%, with unique converters and the conversion rate against visitors',async t=>{
 const a=await withApp(t),owner={headers:{cookie:a.owner}},paths=['/','/thanks','/thanks/pro','/thanks/pro/annual','/blog/post','/blog/2026/notes'],start=Date.parse('2026-03-10T10:00:00Z')
 const refused=await a.post('/api/vane/commands',{command:'site.create',input:{name:'Fern Studio',origin:'https://fern.example',paths,goals:{signup:'/checkout*'},consent:'not-required'}},a.owner);assert.equal(refused.status,400,'a goal pattern must match an allowed path')
 const id=await a.addSite({paths,goals:{signup:'/thanks**',pro:'/thanks/*'},scrollGoals:{'deep-read':{path:'/blog/**',depth:75}}})
 const load=async(n,path,seconds=0)=>{await a.clock(start+n*3600000+seconds*1000);const event=a.event(id,{path});assert.equal((await a.post('/api/vane/collect',event,'',{origin:'https://fern.example','cf-connecting-ip':'192.0.2.'+n,'user-agent':'Synthetic Browser '+n})).status,202);return event.id}
 const read=async(n,path,scroll)=>{const pageLoad=await load(n,path);await a.clock(start+n*3600000+11000);assert.equal((await a.post('/api/vane/engage',{siteId:id,id:pageLoad,scroll},'',{origin:'https://fern.example'})).status,202)}
 await load(1,'/thanks');await load(1,'/thanks',30);await load(2,'/thanks/pro');await load(6,'/thanks/pro/annual');await load(3,'/');await read(4,'/blog/2026/notes',80);await read(5,'/blog/post',50)
 const r=await (await a.request(`/api/vane/summary?siteId=${id}&from=2026-03-10&to=2026-03-11`,owner)).json()
 assert.deepEqual([r.visitors,r.goals,r.converters,r.conversionRate],[6,6,4,66.7])
 assert.deepEqual(r.goalBreakdown.map(g=>[g.label,g.count,g.converters,g.conversionRate]),[['signup',4,3,50],['deep-read',1,1,16.7],['pro',1,1,16.7]],'/thanks/* stays within one segment; /thanks** reaches /thanks and /thanks/pro/annual')
 const page=await (await a.request(`/app/sites/${id}?section=report&from=2026-03-10&to=2026-03-11`,owner)).text()
 for(const html of ['<th scope="row">signup</th><td class="vane-number">4</td><td class="vane-number">3</td><td class="vane-number">50.0%</td>','Converting visitors: 4 (66.7% of unique visitors).'])assert.ok(page.includes(html),html)
 assert.ok((await (await a.request(`/app/sites/${id}?section=settings`,owner)).text()).includes('signup=/thanks**\npro=/thanks/*\ndeep-read=/blog/**@75'))
 assert.ok((await (await a.request('/methodology')).text()).includes('so /thanks/* covers /thanks/pro'))
})
test('DASH-006 iPhone Safari, Android Chrome, Windows Edge and an iPad fill the device, browser, OS and screen tables, and no raw user agent is stored',async t=>{
 const a=await withApp(t),owner={headers:{cookie:a.owner}},id=await a.addSite()
 const agents=[['Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1',390],['Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36',412],['Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36 Edg/126.0.0.0',1536],['Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',820]]
 for(const [ua,width] of agents)assert.equal((await a.post('/api/vane/collect',a.event(id,{width}),'',{origin:'https://fern.example','user-agent':ua})).status,202)
 for(const width of [-1,'wide',1.5])assert.equal((await a.collect(a.event(id,{width}))).status,400,String(width))
 const r=await (await a.request('/api/vane/summary?siteId='+id,owner)).json(),pick=rows=>rows.map(row=>[row.label,row.visitors,row.pageviews])
 assert.deepEqual(pick(r.devices),[['mobile',2,2],['desktop',1,1],['tablet',1,1]])
 assert.deepEqual(pick(r.browsers),[['Safari',2,2],['Chrome',1,1],['Edge',1,1]]);assert.deepEqual(pick(r.browserVersions),[['Safari 17',2,2],['Chrome 126',1,1],['Edge 126',1,1]])
 assert.deepEqual(pick(r.systems),[['Android',1,1],['Windows',1,1],['iOS',1,1],['iPadOS',1,1]]);assert.deepEqual(pick(r.systemVersions),[['Android 14',1,1],['Windows 10/11',1,1],['iOS 17.4',1,1],['iPadOS 17.0',1,1]])
 assert.deepEqual(pick(r.screens),[['Mobile (under 576 px)',2,2],['Desktop (1440 px and wider)',1,1],['Tablet (576–991 px)',1,1]])
 const page=await (await a.request(`/app/sites/${id}?section=report`,owner)).text();for(const html of ['<h2>Devices</h2>','<th scope="row">iPadOS 17.0</th><td class="vane-number">1</td>','<h2>Screen sizes</h2>'])assert.ok(page.includes(html),html)
 // In a browser at phone width, the script sends its viewport width and the page load lands in the phone class.
 const other=await a.addSite({origin:'https://oak.example'}),{context}=await browse(t,a,{'https://oak.example/':`<!doctype html><title>Oak</title><script src="${a.origin}/vane.js" data-site="${other}"></script>`},{viewport:{width:390,height:844}}),tab=await context.newPage()
 const sent=tab.waitForResponse(response=>new URL(response.url()).pathname==='/api/vane/collect'&&response.request().method()==='POST');await tab.goto('https://oak.example/');const response=await sent
 assert.equal(response.status(),202);assert.equal(JSON.parse(response.request().postData()).width,390)
 assert.deepEqual(pick((await (await a.request('/api/vane/summary?siteId='+other,owner)).json()).screens),[['Mobile (under 576 px)',1,1]])
 const dump=await a.dump(),stored=JSON.stringify([dump,await a.archive()]);for(const fragment of ['Mozilla/5.0','Pixel 8','AppleWebKit','HeadlessChrome'])assert.equal(stored.includes(fragment),false,fragment)
 for(const row of dump.vane_events)assert.ok(!Object.values(row).some(value=>[390,412,1536,820,'390','412','1536','820'].includes(value)),'only the screen class is stored, never the width')
 const methodology=await (await a.request('/methodology')).text();for(const phrase of ['never the user agent or the width in pixels','Windows 10/11','counts as a macOS desktop'])assert.ok(methodology.includes(phrase),phrase)
 await context.close()
})
test('DASH-012 with a named search parameter, a term two visitors searched is reported with searches per visit, start pages and exits, and an email-like term never appears',async t=>{
 const a=await withApp(t),owner={headers:{cookie:a.owner}},id=await a.addSite({paths:['/','/search'],goals:{},searchParam:'q'}),plain=await a.addSite({origin:'https://oak.example'}),start=Date.parse('2026-03-11T10:00:00Z')
 const visit=async(n,steps)=>{for(const [i,[path,search]] of steps.entries()){await a.clock(start+n*3600000+i*20000);assert.equal((await a.post('/api/vane/collect',a.event(id,{path,...(search?{search}:{})}),'',{origin:'https://fern.example','cf-connecting-ip':'192.0.2.'+n,'user-agent':'Synthetic Browser '+n})).status,202)}}
 await visit(1,[['/'],['/search','returns'],['/search','shipping'],['/']]);await visit(2,[['/search','returns']]);await visit(3,[['/'],['/search','alice@example.com']])
 assert.equal((await a.collect(a.event(plain,{search:'returns'}),'https://oak.example')).status,400,'no search term without a named parameter')
 assert.equal((await a.collect(a.event(id,{path:'/search',search:'x'.repeat(101)}))).status,400)
 const r=(await (await a.request(`/api/vane/summary?siteId=${id}&from=2026-03-11&to=2026-03-12`,owner)).json()).siteSearch
 assert.deepEqual([r.searches,r.searchVisits,r.searchesPerVisit,r.exitAfterSearch],[4,3,1.33,66.7])
 assert.deepEqual(r.terms,[{term:'returns',searches:2,visitors:2}],'shipping (one visitor) and the email-like term stay hidden')
 assert.deepEqual(r.startPages.map(p=>[p.path,p.searches]),[['/',2],['(entry)',1],['/search',1]])
 const page=await (await a.request(`/app/sites/${id}?section=report&from=2026-03-11&to=2026-03-12`,owner)).text()
 for(const html of ['<h2>Site search</h2>','<th scope="row">returns</th><td class="vane-number">2</td><td class="vane-number">2</td>','<dt>Visits that exit after searching</dt><dd>66.7%</dd>'])assert.ok(page.includes(html),html)
 assert.equal(page.includes('shipping'),false)
 // In a browser the script sends the named parameter's term, lowercased.
 const {context}=await browse(t,a,{'https://fern.example/search?q=Returns':`<!doctype html><title>Search</title><script src="${a.origin}/vane.js" data-site="${id}"></script>`}),tab=await context.newPage()
 const sent=tab.waitForResponse(response=>new URL(response.url()).pathname==='/api/vane/collect'&&response.request().method()==='POST');await tab.goto('https://fern.example/search?q=Returns');const response=await sent
 assert.equal(response.status(),202);assert.equal(JSON.parse(response.request().postData()).search,'returns')
 const stored=JSON.stringify([await a.dump(),await a.archive()]);assert.equal(stored.includes('alice'),false,'the email-like term is never stored')
 assert.ok((await (await a.request('/methodology')).text()).includes('two different visitor hashes searched it on the same day'))
 await context.close()
})
test('SHARE-002 a site made public with two reports shows only those to a signed-out reader at its stable URL, honours the indexing choice, and turning it off returns 404',async t=>{
 const a=await withApp(t),id=await a.addSite()
 for(const path of ['/','/thanks'])assert.equal((await a.collect(a.event(id,{path}))).status,202)
 const configure=async extra=>{const input={siteId:id,name:'Fern Studio',origin:'https://fern.example',paths:['/','/thanks'],goals:{signup:'/thanks'},consent:'not-required',sampleRate:100,retentionDays:90,...extra};const p=await (await a.post('/api/vane/commands',{command:'site.configure',input},a.owner)).json();assert.equal((await a.form({operation:'proposal.approve',id:p.id},a.owner)).status,303)}
 const stats=()=>a.request('/stats/'+id)
 assert.equal((await stats()).status,404,'not public until the owner approves it')
 await configure({publicReports:['totals','pages']})
 let page=await stats(),html=await page.text();assert.equal(page.status,200)
 for(const part of ['<h2>Unique visitors</h2>','<h2>Pageviews</h2><p class="vane-metric">2</p>','<h2>Top pages</h2>','<h2>Exit pages</h2>','<meta name="robots" content="noindex, nofollow">'])assert.ok(html.includes(part),part)
 for(const part of ['<h2>Sources</h2>','<h2>Goals</h2>','Campaigns','Devices','Site search','search.example'])assert.equal(html.includes(part),false,part)
 assert.equal(page.headers.get('x-robots-tag'),'noindex, nofollow');assert.equal(page.headers.getSetCookie().length,0)
 assert.ok((await (await a.request(`/app/sites/${id}?section=settings`,{headers:{cookie:a.owner}})).text()).includes(`/stats/${id}`))
 await configure({publicReports:['totals','pages'],publicIndexing:true})
 page=await stats();assert.equal(page.headers.get('x-robots-tag'),'index, follow');assert.ok((await page.text()).includes('<meta name="robots" content="index, follow">'))
 await configure({publicReports:[]})
 assert.equal((await stats()).status,404,'turning it off returns 404');assert.equal((await a.request('/stats/no-such-site')).status,404)
 assert.equal((await a.post('/api/vane/commands',{command:'site.configure',input:{siteId:id,name:'Fern Studio',origin:'https://fern.example',paths:['/'],goals:{},consent:'not-required',publicReports:['search-terms']}},a.owner)).status,400,'only listed reports can be public')
})
test('CONV-003 in a browser an outbound link, a PDF link, a marked 404 page and a form submission send four automatic events with the right details and no form contents',async t=>{
 const a=await withApp(t),owner={headers:{cookie:a.owner}},id=await a.addSite({autoEvents:['outbound','download','404','form']}),quiet=await a.addSite({origin:'https://oak.example'})
 const home=`<!doctype html><title>Fern</title><a id="out" href="https://elsewhere.example/guide?ref=fern#top">Guide</a> <a id="pdf" href="/files/menu.pdf?v=2">Menu</a><form id="signup" action="/thanks" method="post"><input name="email" value="secret@example.com"><button>Join</button></form><script src="${a.origin}/vane.js" data-site="${id}"></script>`
 const missing=`<!doctype html><title>Not found</title><meta name="vane-404"><script src="${a.origin}/vane.js" data-site="${id}"></script>`
 const {context}=await browse(t,a,{'https://fern.example/':home,'https://fern.example/missing-page':missing}),tab=await context.newPage()
 // Keepalive events outlive their page's navigation and are not page responses, so the installation's own report is watched.
 const recorded=async n=>{for(let i=0;i<100;i++){const r=await (await a.request('/api/vane/summary?siteId='+id,owner)).json();if(r.automaticEvents.length>=n)return r;await new Promise(done=>setTimeout(done,100))}assert.fail(`event ${n} did not arrive`)}
 const open=async()=>{const loaded=tab.waitForResponse(response=>new URL(response.url()).pathname==='/api/vane/collect');await tab.goto('https://fern.example/');await loaded}
 for(const [n,act] of [()=>tab.click('#out',{noWaitAfter:true}),()=>tab.click('#pdf',{noWaitAfter:true}),()=>tab.click('button',{noWaitAfter:true})].entries()){await open();await act();await recorded(n+1)}
 await tab.goto('https://fern.example/missing-page');const r=await recorded(4)
 assert.deepEqual(r.automaticEvents.map(e=>[e.kind,e.label,e.count]),[['404','/missing-page',1],['download','https://fern.example/files/menu.pdf',1],['form','signup',1],['outbound','https://elsewhere.example/guide',1]])
 assert.ok((await (await a.request(`/app/sites/${id}?section=report`,owner)).text()).includes('<th scope="row">Form submission</th><td>signup</td>'))
 const post=(siteId,body,origin='https://fern.example')=>a.post('/api/vane/event',{id:crypto.randomUUID(),siteId,consent:'not-required',...body},'',{origin})
 assert.equal((await post(quiet,{kind:'outbound',prop:'https://elsewhere.example/'},'https://oak.example')).status,403,'only turned-on events are accepted')
 assert.equal((await post(id,{kind:'outbound',prop:'https://elsewhere.example/?q=1'})).status,400,'no query is stored')
 assert.equal((await post(id,{kind:'form',prop:'/signup',email:'x@example.com'})).status,400,'no field values')
 assert.equal((await post(id,{kind:'404',prop:'/users/alice@example.com'})).status,202)
 const stored=JSON.stringify([await a.dump(),await a.archive()]);for(const secret of ['secret@example.com','ref=fern','v=2','alice@example.com'])assert.equal(stored.includes(secret),false,secret)
 assert.ok(stored.includes('(redacted)'))
 await context.close()
})
test('SITE-001 a site with apex and www origins counts both, changes time zone and currency through approval, transfers by site archive, and deletion leaves no history',async t=>{
 const a=await withApp(t),b=await withApp(t),id=await a.addSite({origins:['https://www.fern.example'],currency:'eur'}),get=(app,path)=>app.request(path,{headers:{cookie:app.owner}})
 for(const origin of ['https://fern.example','https://www.fern.example'])assert.equal((await a.collect(a.event(id),origin)).status,202,origin)
 assert.equal((await a.collect(a.event(id),'https://shop.fern.example')).status,403)
 await movein(a,id)
 const summary=async(app,siteId=id)=>(await get(app,'/api/vane/summary?siteId='+siteId)).json(),before=await summary(a);assert.equal(before.pageviews,2)
 const config=async app=>(await (await get(app,'/api/vane/sites')).json()).find(s=>s.id===id)?.config
 assert.deepEqual([(await config(a)).origins,(await config(a)).currency,(await config(a)).timeZone],[['https://www.fern.example'],'EUR','UTC'])
 const input={siteId:id,name:'Fern Studio',origin:'https://fern.example',origins:'https://www.fern.example',paths:['/','/thanks'],goals:{signup:'/thanks'},consent:'not-required',timeZone:'America/Chicago',currency:'USD'}
 assert.equal((await a.post('/api/vane/commands',{command:'site.configure',input:{...input,currency:'XYZ'}},a.owner)).status,400)
 const change=await (await a.post('/api/vane/commands',{command:'site.configure',input},a.owner)).json()
 assert.equal((await config(a)).currency,'EUR')
 assert.equal((await a.form({operation:'proposal.approve',id:change.id},a.owner)).status,303)
 assert.deepEqual([(await config(a)).currency,(await config(a)).timeZone],['USD','America/Chicago'])
 assert.match(await (await get(a,`/app/sites/${id}?section=settings`)).text(),/name="currency"[^>]*value="USD"/)
 // Transfer: the site archive carries settings, native and imported history into another installation.
 const admin=await a.invite('admin@example.test','admin'),member=await a.invite('member@example.test','member')
 for(const person of [admin,member])assert.equal((await a.request('/api/vane/export?siteId='+id,{headers:{cookie:person}})).status,403)
 const response=await get(a,'/api/vane/export?siteId='+id);assert.equal(response.status,200);const archive=await response.json()
 assert.equal((await b.post('/api/vane/site-import',{archive},(await b.invite('admin@example.test','admin')))).status,403)
 const corrupt=structuredClone(archive);corrupt.payload.tables.vane_events[0].path='/changed'
 assert.equal((await b.post('/api/vane/site-import',{archive:corrupt},b.owner)).status,400)
 assert.equal((await b.post('/api/vane/site-import',{archive},b.owner)).status,201)
 const moved=await summary(b),after=await summary(a);assert.deepEqual([moved.pageviews,moved.imported,moved.goals],[after.pageviews,after.imported,after.goals])
 assert.ok(archive.payload.tables.vane_import_events.length>0);assert.deepEqual((await b.dump()).vane_import_events,archive.payload.tables.vane_import_events)
 assert.deepEqual(await config(b),await config(a))
 assert.equal((await b.collect(b.event(id),'https://www.fern.example')).status,202)
 assert.equal((await b.post('/api/vane/site-import',{archive},b.owner)).status,409)
 // Deletion through approval removes the site and every row of its history; only journals naming the ID remain.
 const deletion=await (await a.post('/api/vane/commands',{command:'site.delete',input:{siteId:id}},a.owner)).json()
 assert.equal((await summary(a)).pageviews,after.pageviews)
 assert.equal((await a.form({operation:'proposal.approve',id:deletion.id},a.owner)).status,303)
 assert.equal((await get(a,'/api/vane/summary?siteId='+id)).status,404)
 const left=Object.entries(await a.dump()).filter(([,rows])=>JSON.stringify(rows).includes(id)).map(([name])=>name).sort()
 assert.deepEqual(left.filter(name=>!['vane_audit','vane_deletions','vane_proposals','vane_import_erasure_fences'].includes(name)&&!name.startsWith('ik_')),[])
 const dump=await a.dump();for(const name of ['vane_sites','vane_events','vane_signals','vane_auto_events','vane_admission','vane_salts','vane_import_events'])assert.equal(dump[name].filter(row=>JSON.stringify(row).includes(id)).length,0,name)
 assert.ok(dump.vane_audit.some(row=>row.action==='site.delete'&&row.subject===id)&&dump.vane_audit.some(row=>row.action==='site.export')&&(await b.dump()).vane_audit.some(row=>row.action==='site.import'))
 assert.equal((await a.post('/api/vane/site-import',{archive},a.owner)).status,409)
})
test('COLLECT-002 in a browser every page is collected with its hostname, paths are redacted and rewritten, UTM values, ref/source sources and the paid-click flag are kept, and titles and other queries never stored',async t=>{
 const a=await withApp(t),id=await a.addSite({paths:[],excludePaths:['/admin/**'],rewrites:['/orders/*=/orders/:id'],queryKeys:['plan'],origins:['https://www.fern.example']})
 const page=title=>`<!doctype html><title>${title}</title><script src="${a.origin}/vane.js" data-site="${id}"></script>`
 const urls={
  'https://fern.example/users/jo%40example.com?utm_source=google&utm_medium=cpc&utm_campaign=spring&utm_term=pour-over&utm_content=hero&gclid=gclid-secret-1&ref=x':'/users/:email',
  'https://fern.example/reset/eyJhbGciOiJIUzI1NiJ9xQ2/confirm?fbclid=fb-secret-2':'/reset/:token/confirm',
  'https://fern.example/orders/1234567':'/orders/:id','https://fern.example/orders/42':'/orders/:id',
  'https://fern.example/invoices/0b8e4c1a-2f3d-4e5f-8a9b-1c2d3e4f5a6b':'/invoices/:uuid',
  'https://fern.example/blog/top-10-brews-2024':'/blog/top-10-brews-2024',
  'https://fern.example/?ref=producthunt':'/',
  'https://www.fern.example/?source=newsletter&plan=pro&secret=private-value':'/',
 }
 const {context}=await browse(t,a,Object.fromEntries([...Object.keys(urls),'https://fern.example/admin/panel'].map(url=>[url,page('Order 1234567 for jo@example.com')]))),tab=await context.newPage()
 for(const url of Object.keys(urls)){const sent=tab.waitForResponse(r=>new URL(r.url()).pathname==='/api/vane/collect');await tab.goto(url);assert.equal((await sent).status(),202,url)}
 const excluded=tab.waitForResponse(r=>new URL(r.url()).pathname==='/api/vane/collect');await tab.goto('https://fern.example/admin/panel');assert.equal((await excluded).status(),403)
 const dump=await a.dump(),rows=dump.vane_events.filter(e=>e.site_id===id&&e.kind==='pageview').sort((x,y)=>x.at-y.at||x.id.localeCompare(y.id))
 assert.deepEqual(rows.map(e=>e.path).sort(),Object.values(urls).sort())
 const first=rows.find(e=>e.path==='/users/:email')
 assert.deepEqual([first.hostname,first.source,first.campaign,first.utm_source,first.utm_medium,first.utm_term,first.utm_content,first.paid_click],['fern.example','google','spring','google','cpc','pour-over','hero',1],'utm_source wins over ref, every UTM field and the paid-click flag are kept')
 assert.equal(rows.find(e=>e.path==='/reset/:token/confirm').paid_click,1)
 assert.equal(rows.find(e=>e.path==='/blog/top-10-brews-2024').paid_click,0)
 const home=rows.filter(e=>e.path==='/').map(e=>[e.hostname,e.source,e.query])
 assert.deepEqual(home,[['fern.example','producthunt',null],['www.fern.example','newsletter','plan=pro']])
 const stored=JSON.stringify(dump)
 for(const secret of ['jo@example.com','jo%40example.com','1234567','eyJhbGciOiJIUzI1NiJ9xQ2','0b8e4c1a','gclid-secret-1','fb-secret-2','private-value','Order ','/admin/panel'])assert.equal(stored.includes(secret),false,secret)
 const r=await (await a.request('/api/vane/summary?siteId='+id,{headers:{cookie:a.owner}})).json()
 assert.deepEqual(Object.fromEntries(r.sources.map(s=>[s.label,s.count])),{direct:5,google:1,producthunt:1,newsletter:1})
 assert.deepEqual(r.topPages.map(p=>p.path).filter(p=>p.startsWith('/orders')),['/orders/:id'])
 assert.equal(r.topPages.find(p=>p.path==='/orders/:id').pageviews,2)
 // Direct posts get the same treatment: a query in the path is refused, and an unknown kept key or UTM field is refused.
 for(const extra of [{path:'/thanks?email=x'},{query:{secret:'x'}},{utm:{campaign:'x'}}])assert.equal((await a.collect(a.event(id,extra))).status,400,JSON.stringify(extra))
})

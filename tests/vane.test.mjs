import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { installation } from './harness.mjs'
const fixture=JSON.parse(await readFile(new URL('./fixtures/umami-events.json',import.meta.url),'utf8'))
// DASH-007 makes report row values links that filter by them; assertions on a row's cells read past the link.
const unlinked=html=>html.replace(/<a href="[^"]*" data-filter-link>([^<]*)<\/a>/g,'$1')
async function withApp(t){const app=await installation();t.after(()=>app.close());return app}
// A real browser whose requests are all recorded: the built Worker serves the installation's origin, `pages` serves fixture pages, and anything else is refused.
// Headless browsers are excluded as automation (COLLECT-003), so it presents a desktop Chrome user agent unless userAgent is null.
const DESKTOP_CHROME='Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36'
async function browse(t,a,pages={},{userAgent=DESKTOP_CHROME,...options}={}){
 const {chromium}=await import('@playwright/test'),browser=await chromium.launch({headless:true,args:['--use-mock-keychain','--password-store=basic']});t.after(()=>browser.close())
 const context=await browser.newContext(userAgent===null?options:{...options,userAgent}),requests=[]
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
 const page=unlinked(await (await a.request('/app/sites/'+id+'?section=report',{headers:{cookie:a.owner}})).text())
 assert.match(page,/-33\.3%<\/span> compared with the previous period \(3\)/)
 assert.match(page,/<th scope="row">direct<\/th><td class="vane-number">0<\/td><td class="vane-number">2<\/td><td class="vane-number" data-change="-2">-2 \(-100\.0%\)<\/td>/)
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
 for(const tile of ['<h2>Visits</h2><p class="vane-metric">2</p>','<h2>Pageviews</h2><p class="vane-metric">4</p>','<h2>Pages per visit</h2><p class="vane-metric">2</p><p class="vane-help">Views per visitor: 4. <a href="/methodology#pages-per-visit"'])assert.ok(page.includes(tile),tile)
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
 assert.deepEqual(r.topPages,[{path:'/',visitors:3,pageviews:4,visits:3,bounceRate:33.3,conversions:1,conversionRate:33.3,medianDuration:45,averageDuration:55,medianTimeOnPage:30,averageTimeOnPage:26,averageScrollDepth:60,reached75Share:50,previous:0},{path:'/thanks',visitors:1,pageviews:1,visits:1,bounceRate:0,conversions:1,conversionRate:100,medianDuration:120,averageDuration:120,medianTimeOnPage:60,averageTimeOnPage:60,averageScrollDepth:null,reached75Share:null,previous:0}])
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
 const page=unlinked(await (await a.request(`/app/sites/${id}?section=report&from=2026-03-10&to=2026-03-11`,owner)).text())
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
 assert.deepEqual(r.terms,[{term:'returns',searches:2,visitors:2,previous:0}],'shipping (one visitor) and the email-like term stay hidden')
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
 // The site has two hostnames, so page rows carry the hostname (DASH-013).
 assert.deepEqual(r.topPages.map(p=>p.path).filter(p=>p.includes('/orders')),['fern.example/orders/:id'])
 assert.equal(r.topPages.find(p=>p.path==='fern.example/orders/:id').pageviews,2)
 // Direct posts get the same treatment: a query in the path is refused, and an unknown kept key or UTM field is refused.
 for(const extra of [{path:'/thanks?email=x'},{query:{secret:'x'}},{utm:{campaign:'x'}}])assert.equal((await a.collect(a.event(id,extra))).status,400,JSON.stringify(extra))
})
test('DASH-004 Google organic and paid, Facebook, an email UTM, webmail, chatgpt.com and five-field UTMs land in their channels, every UTM field is reportable, and each row\'s visitors, bounce rate and duration match the seeded visits',async t=>{
 const a=await withApp(t),owner={headers:{cookie:a.owner}},id=await a.addSite({goals:{signup:'/thanks',landing:'/'}}),start=Date.parse('2026-03-10T10:00:00Z')
 const send=async(n,at,extra)=>{await a.clock(at);const event=a.event(id,{source:'direct',campaign:'none',...extra});const r=await a.post('/api/vane/collect',event,'',{origin:'https://fern.example','cf-connecting-ip':'203.0.113.'+n,'user-agent':'Synthetic Browser '+n});assert.equal(r.status,202,JSON.stringify(extra));return event.id}
 await send(1,start,{referrer:'https://www.google.com/'});await send(1,start+120000,{path:'/thanks'})
 await send(2,start,{referrer:'https://www.google.com/',click:true})
 await send(3,start,{referrer:'https://l.facebook.com/'})
 const mail=await send(4,start,{utm:{source:'newsletter',medium:'email'},campaign:'october'})
 await a.clock(start+45000);assert.equal((await a.post('/api/vane/engage',{siteId:id,id:mail,scroll:40},'',{origin:'https://fern.example'})).status,202)
 await send(5,start,{referrer:'https://chatgpt.com/'})
 await send(6,start,{utm:{source:'brewnews',medium:'banner',term:'pour-over',content:'hero'},campaign:'launch'})
 await send(7,start,{referrer:'https://duckduckgo.com/'})
 await send(8,start,{})
 const webmail=await send(9,start,{referrer:'https://mail.google.com/mail/u/0/'})
 await a.clock(start+15000);assert.equal((await a.post('/api/vane/engage',{siteId:id,id:webmail,scroll:10},'',{origin:'https://fern.example'})).status,202)
 const summary=async(goal='')=>(await a.request(`/api/vane/summary?siteId=${id}&from=2026-03-10&to=2026-03-11${goal?'&goal='+goal:''}`,owner)).json(),r=await summary('signup')
 const table=rows=>Object.fromEntries(rows.map(row=>[row.label,[row.visitors,row.visits,row.bounceRate,row.averageDuration,row.medianDuration,row.conversionRate]]))
 assert.deepEqual(table(r.channels),{'Organic Search':[2,2,50,60,60,50],'Email':[2,2,0,30,30,0],'AI Assistants':[1,1,100,0,0,0],'Direct':[1,1,100,0,0,0],'Display':[1,1,100,0,0,0],'Organic Social':[1,1,100,0,0,0],'Paid Search':[1,1,100,0,0,0]})
 assert.deepEqual(table(r.sourceVisits).Google,[2,2,50,60,60,50])
 assert.deepEqual(Object.keys(table(r.sourceVisits)).sort(),['ChatGPT','DuckDuckGo','Facebook','Google','Webmail','brewnews','direct','newsletter'])
 assert.deepEqual(Object.keys(table(r.referrers)).sort(),['chatgpt.com/','duckduckgo.com/','l.facebook.com/','www.google.com/'],'webmail addresses are never kept')
 for(const [key,labels] of [['utmSources',['brewnews','newsletter']],['utmMediums',['banner','email']],['utmCampaigns',['launch','october']],['utmTerms',['pour-over']],['utmContents',['hero']]])assert.deepEqual(r[key].map(row=>row.label).sort(),labels,key)
 assert.deepEqual(table(r.utmMediums).email,[1,1,0,45,45,0])
 // With any goal, every visit converts: each entered on / (the landing goal); the page tables follow the same choice.
 const any=await summary();assert.ok(any.channels.every(row=>row.conversionRate===100));assert.equal(any.topPages.find(p=>p.path==='/thanks').conversionRate,100);assert.equal(r.entryPages.find(p=>p.path==='/').conversionRate,11.1,'one of nine visits entering on / reached signup')
 assert.equal((await a.request(`/api/vane/summary?siteId=${id}&goal=nope`,owner)).status,400)
 const page=unlinked(await (await a.request(`/app/sites/${id}?section=report&from=2026-03-10&to=2026-03-11`,owner)).text())
 assert.match(page,/<th scope="row">AI Assistants<\/th><td class="vane-number">1<\/td><td class="vane-number">1<\/td><td class="vane-number">100\.0%<\/td>/)
 // In a browser, a link followed from chatgpt.com reaches collection as its referring page and channel.
 const {context}=await browse(t,a,{'https://chatgpt.com/c/123?q=private':'<!doctype html><a href="https://fern.example/thanks?utm_medium=referral">Fern</a>','https://fern.example/thanks?utm_medium=referral':`<!doctype html><title>Journal</title><script src="${a.origin}/vane.js" data-site="${id}"></script>`}),tab=await context.newPage()
 await a.clock(Date.now());await tab.goto('https://chatgpt.com/c/123?q=private');const sent=tab.waitForResponse(r=>new URL(r.url()).pathname==='/api/vane/collect');await tab.click('a');assert.equal((await sent).status(),202)
 const followed=(await a.dump()).vane_events.find(e=>e.site_id===id&&e.path==='/thanks'&&e.kind==='pageview'&&e.referrer);assert.deepEqual([followed.source,followed.referrer,followed.channel,followed.utm_medium],['chatgpt.com','chatgpt.com/','AI Assistants','referral'])
 const methodology=await (await a.request('/methodology')).text();for(const phrase of ['AI Assistants','chatgpt.com','Paid Social','mail.google.com'])assert.ok(methodology.includes(phrase),phrase)
})
test('DASH-014 Hacker News, two Slack referrers, Facebook and an unlisted blog report under named sources with a drill-down, and an approved owner rule regroups the blog',async t=>{
 const a=await withApp(t),owner={headers:{cookie:a.owner}},id=await a.addSite()
 for(const [n,referrer] of ['https://news.ycombinator.com/item?id=1','android-app://com.slack.android','https://app.slack.com/','https://l.facebook.com/','https://brewblog.example/'].entries())assert.equal((await a.post('/api/vane/collect',a.event(id,{source:'direct',campaign:'none',referrer}),'',{origin:'https://fern.example','cf-connecting-ip':'198.51.100.'+n,'user-agent':'Synthetic Browser'})).status,202,referrer)
 const summary=async()=>(await a.request('/api/vane/summary?siteId='+id,owner)).json(),pick=r=>Object.fromEntries(r.sources.map(s=>[s.label,s.count]))
 let r=await summary()
 assert.deepEqual(pick(r),{'Hacker News':1,Slack:2,Facebook:1,'brewblog.example':1})
 assert.deepEqual(Object.fromEntries(r.sourceVisits.map(s=>[s.label,s.visits])),{'Hacker News':1,Slack:2,Facebook:1,'brewblog.example':1})
 assert.deepEqual(r.sourceReferrers.filter(s=>s.source==='Slack').map(s=>s.referrer).sort(),['android-app://com.slack.android','app.slack.com'])
 assert.deepEqual(Object.fromEntries(r.channels.map(c=>[c.label,c.visits])),{'Organic Social':4,Referral:1})
 const input={siteId:id,name:'Fern Studio',origin:'https://fern.example',paths:['/','/thanks'],goals:{signup:'/thanks'},consent:'not-required',sourceRules:'brewblog.example=Brew Blog'}
 const p=await (await a.post('/api/vane/commands',{command:'site.configure',input},a.owner)).json()
 assert.equal(pick(await summary())['brewblog.example'],1,'the rule waits for approval')
 assert.equal((await a.form({operation:'proposal.approve',id:p.id},a.owner)).status,303)
 r=await summary();assert.deepEqual(pick(r),{'Hacker News':1,Slack:2,Facebook:1,'Brew Blog':1})
 assert.ok((await (await a.request(`/app/sites/${id}?section=report`,owner)).text()).includes('brewblog.example as Brew Blog'))
 const methodology=await (await a.request('/methodology')).text()
 for(const line of ['Hacker News: news.ycombinator.com.','Slack: slack.com, android-app://com.slack.android.','Facebook: facebook.com, fb.com, android-app://com.facebook.katana.','X: x.com, twitter.com, t.co'])assert.ok(methodology.includes(line),line)
})
test('PRIVACY-001 the data inventory and generated policy text change with the site settings, and every stored column of the site is in its inventory',async t=>{
 const a=await withApp(t),owner={headers:{cookie:a.owner}},id=await a.addSite(),inv=async()=>(await a.request('/api/vane/inventory?siteId='+id,owner)).json()
 let i=await inv(),text=i.policyText.join(' ')
 assert.deepEqual(i.fields.map(f=>f.name).filter(name=>['Automatic events','Site search','Privacy-signal count','Kept query parameters'].includes(name)),[])
 assert.deepEqual([i.retention,i.processors.length,/Cloudflare/.test(i.processors[0]),/midnight in UTC/.test(i.salt)],['90 days',1,true,true])
 for(const phrase of ['sets no cookies','without asking for consent','kept for 90 days'])assert.ok(text.includes(phrase),phrase);assert.equal(text.includes('files you download'),false)
 const input={siteId:id,name:'Fern Studio',origin:'https://fern.example',paths:['/','/thanks'],goals:{signup:'/thanks'},consent:'required',retentionDays:30,timeZone:'America/Chicago',searchParam:'q',signalCounter:true,autoEvents:['download','outbound'],queryKeys:['plan']}
 const p=await (await a.post('/api/vane/commands',{command:'site.configure',input},a.owner)).json();assert.equal((await a.form({operation:'proposal.approve',id:p.id},a.owner)).status,303)
 i=await inv();text=i.policyText.join(' ')
 assert.deepEqual(i.fields.map(f=>f.name).filter(name=>['Automatic events','Site search','Privacy-signal count','Kept query parameters'].includes(name)),['Kept query parameters','Site search','Automatic events','Privacy-signal count'])
 assert.deepEqual([i.retention,/midnight in America\/Chicago/.test(i.salt)],['30 days',true])
 for(const phrase of ['files you download','links you follow to other sites','Search terms you enter','only records your visit after you give consent','we only count how many such page loads arrive','kept for 30 days'])assert.ok(text.includes(phrase),phrase)
 assert.ok((await (await a.request(`/app/sites/${id}?section=settings`,owner)).text()).includes('Data inventory'))
 // Everything the site stores is named by the inventory.
 const visitor={origin:'https://fern.example','cf-connecting-ip':'203.0.113.40','user-agent':'Synthetic Browser'},event=a.event(id,{consent:'granted',search:'Pour Over',query:{plan:'pro'},utm:{medium:'email',source:'news',term:'t',content:'c'},referrer:'https://news.ycombinator.com/item',click:true,width:390})
 await a.clock(Date.now());assert.equal((await a.post('/api/vane/collect',event,'',visitor)).status,202)
 await a.clock(Date.now()+15000);assert.equal((await a.post('/api/vane/engage',{siteId:id,id:event.id,scroll:60},'',visitor)).status,202)
 assert.equal((await a.post('/api/vane/event',{id:crypto.randomUUID(),siteId:id,kind:'download',prop:'https://fern.example/menu.pdf',consent:'granted'},'',visitor)).status,202)
 assert.equal((await a.request('/api/vane/signal/'+id,{method:'POST',headers:visitor,body:''})).status<300,true)
 const dump=await a.dump()
 for(const table of ['vane_events','vane_auto_events','vane_signals']) {
  const named=new Set(i.fields.filter(f=>f.table===table).flatMap(f=>f.columns)),rows=dump[table].filter(row=>row.site_id===id)
  assert.ok(rows.length,table)
  for(const row of rows)for(const [column,value] of Object.entries(row))if(value!==null)assert.ok(named.has(column),`${table}.${column} is in the inventory`)
 }
})
test('DASH-013 www and blog hostnames keep their pages apart, the Hostnames report and filter (is, is not, contains, wildcard) narrow the dashboard and Stats API, and a goal scoped to one hostname converts only there',async t=>{
 const a=await withApp(t),owner={headers:{cookie:a.owner}},www='https://www.fern.example',blog='https://blog.fern.example'
 const id=await a.addSite({origin:www,origins:[blog],paths:[],goals:{'blog-thanks':'blog.fern.example/thanks'},autoEvents:['outbound']})
 let n=0;const send=async(origin,path)=>{n++;const r=await a.post('/api/vane/collect',a.event(id,{path,source:'direct',campaign:'none'}),'',{origin,'cf-connecting-ip':'203.0.113.'+n,'user-agent':'Synthetic Browser'});assert.equal(r.status,202,origin+path)}
 for(const origin of [www,blog])for(const path of ['/','/pricing','/thanks'])await send(origin,path)
 for(const origin of [www,blog])assert.equal((await a.post('/api/vane/event',{id:crypto.randomUUID(),siteId:id,kind:'outbound',prop:'https://example.org/',consent:'not-required'},'',{origin})).status,202)
 assert.equal((await a.post('/api/vane/collect',a.event(id,{path:'/'}),'',{origin:'https://shop.fern.example'})).status,403,'a hostname the site does not allow is refused')
 const summary=async(query='')=>{const r=await a.request(`/api/vane/summary?siteId=${id}${query}`,owner);assert.equal(r.status,200,query);return r.json()}
 const all=await summary()
 assert.deepEqual(all.topPages.map(p=>p.path).sort(),['blog.fern.example/','blog.fern.example/pricing','blog.fern.example/thanks','www.fern.example/','www.fern.example/pricing','www.fern.example/thanks'])
 assert.deepEqual(all.hostnames.map(h=>[h.path,h.visitors,h.visits,h.pageviews,h.bounceRate,h.conversions]),[['blog.fern.example',3,3,3,100,1],['www.fern.example',3,3,3,100,0]])
 assert.deepEqual(all.goalBreakdown.map(g=>[g.label,g.count]),[['blog-thanks',1]],'the scoped goal converts only on its hostname')
 const shape=r=>[r.pageviews,r.visitors,r.goals,r.topPages.length,r.automaticEvents.reduce((sum,e)=>sum+Number(e.count),0),[...new Set(r.topPages.map(p=>p.path.split('/')[0]))].sort().join(' ')]
 assert.deepEqual(shape(await summary('&hostOp=is&host=blog.fern.example')),[3,3,1,3,1,'blog.fern.example'])
 assert.deepEqual(shape(await summary('&hostOp=is_not&host=blog.fern.example')),[3,3,0,3,1,'www.fern.example'])
 assert.deepEqual(shape(await summary('&hostOp=contains&host=blog')),[3,3,1,3,1,'blog.fern.example'])
 assert.deepEqual(shape(await summary('&hostOp=matches&host=*.fern.example')),[6,6,1,6,2,'blog.fern.example www.fern.example'])
 assert.equal((await a.request(`/api/vane/summary?siteId=${id}&hostOp=is&host=bl'og`,owner)).status,400)
 const page=await (await a.request(`/app/sites/${id}?section=report&hostOp=is&host=blog.fern.example`,owner)).text()
 assert.ok(page.includes('Filtered: hostname is blog.fern.example'));assert.ok(!page.includes('www.fern.example/pricing'))
})
test('COVERAGE-001 declined consent, excluded paths, privacy signals, sampling, an import and erased history are each shown with their denominator, and every total is labelled partial',async t=>{
 const a=await withApp(t),owner={headers:{cookie:a.owner}},id=await a.addSite({paths:[],excludePaths:['/admin/**'],consent:'required',declinedCounter:true,signalCounter:true,sampleRate:50})
 // In a browser, a page load without consent sends only an empty declined count.
 const {context}=await browse(t,a,{'https://fern.example/':`<!doctype html><title>Fern</title><script src="${a.origin}/vane.js" data-site="${id}"></script>`}),tab=await context.newPage()
 const declined=tab.waitForRequest(r=>new URL(r.url()).pathname==='/api/vane/declined/'+id);await tab.goto('https://fern.example/');const request=await declined
 assert.equal(request.postData()??'',''); assert.equal((await request.response()).status(),202)
 const site={origin:'https://fern.example'}
 assert.equal((await a.post('/api/vane/declined/'+id,{path:'/private'},'',site)).status,400,'a declined count carries no fields')
 assert.equal((await a.request('/api/vane/declined/'+id,{method:'POST',headers:site,body:''})).status,202)
 for(const n of [1,2])assert.equal((await a.post('/api/vane/collect',a.event(id,{consent:'granted'}),'',{...site,'cf-connecting-ip':'203.0.113.'+n})).status,202)
 assert.equal((await a.post('/api/vane/collect',a.event(id,{consent:'granted',path:'/admin/users'}),'',site)).status,403)
 assert.equal((await a.request('/api/vane/signal/'+id,{method:'POST',headers:site,body:''})).status,202)
 const today=new Date().toISOString().slice(0,10),data=[{id:'cov-1',websiteId:'w',sessionId:'s',createdAt:today+'T00:00:01Z',urlPath:'/',urlQuery:'',referrerPath:'',referrerQuery:'',referrerDomain:'',pageTitle:'',eventType:1,eventName:''}]
 await movein(a,id,{data,count:1,page:1,pageSize:1})
 const r=await (await a.request('/api/vane/summary?siteId='+id,owner)).json()
 assert.deepEqual([r.complete,r.exclusions,r.privacySignals,r.imported],[false,[{reason:'consent-declined',count:2},{reason:'excluded-path',count:1}],1,1])
 const html=await (await a.request(`/app/sites/${id}?section=report`,owner)).text(),seen=r.pageviews
 for(const part of ['Every total below is partial',`Declined consent</dt><dd>2 of ${2+seen} page loads that reached Vane (${(200/(2+seen)).toFixed(1)}%)`,`Excluded paths</dt><dd>1 of ${1+seen} page loads that reached Vane`,'Sample rate</dt><dd>50%','Imported share</dt><dd>1 of','Totals</dt><dd>Partial.'])assert.ok(html.includes(part),part)
 const inventory=await (await a.request('/api/vane/inventory?siteId='+id,owner)).json();assert.ok(inventory.fields.some(f=>f.table==='vane_exclusions'&&/without consent/.test(f.description)))
 const p=await (await a.post('/api/vane/commands',{command:'history.erase',input:{siteId:id}},a.owner)).json();assert.equal((await a.form({operation:'proposal.approve',id:p.id},a.owner)).status,303)
 const after=await (await a.request('/api/vane/summary?siteId='+id,owner)).json();assert.deepEqual([after.deletedHistory.map(d=>d.reason),after.exclusions],[['owner-erasure'],[]])
 assert.ok((await (await a.request(`/app/sites/${id}?section=report`,owner)).text()).includes('Deleted history</dt><dd>Events before'))
})
test('DASH-002 events either side of the November daylight-saving change and midnight in America/Chicago fall in local days and hours, every preset range returns its totals, and the data table matches the chart',async t=>{
 const a=await withApp(t),owner={headers:{cookie:a.owner}}
 await a.clock(Date.parse('2025-05-01T17:00:00Z'));const id=await a.addSite({timeZone:'America/Chicago'})
 // Local times: noon on five earlier days, then 23:30 CDT on 31 October, 00:30 and 01:30 CDT, 01:30 CST (the repeated hour) and 23:50 CST on 1 November, and 00:10 CST on 2 November.
 for(const [at,path] of [['2025-06-01T17:00:00Z','/'],['2025-12-01T18:00:00Z','/'],['2026-01-10T18:00:00Z','/'],['2026-08-15T17:00:00Z','/'],['2026-10-10T17:00:00Z','/'],['2026-11-01T04:30:00Z','/'],['2026-11-01T05:30:00Z','/'],['2026-11-01T06:30:00Z','/'],['2026-11-01T07:30:00Z','/'],['2026-11-02T05:50:00Z','/'],['2026-11-02T06:10:00Z','/thanks']]){await a.clock(Date.parse(at));assert.equal((await a.collect(a.event(id,{path}))).status,202,at)}
 await a.clock(Date.parse('2026-11-02T18:00:00Z'))
 const summary=async query=>{const r=await a.request(`/api/vane/summary?siteId=${id}${query}`,owner);assert.equal(r.status,200,query);return r.json()}
 const presets={today:['2026-11-02','2026-11-03',1],yesterday:['2026-11-01','2026-11-02',4],'7d':['2026-10-27','2026-11-03',6],'30d':['2026-10-04','2026-11-03',7],'90d':['2026-08-05','2026-11-03',8],month:['2026-11-01','2026-11-03',5],'last-month':['2026-10-01','2026-11-01',2],year:['2026-01-01','2026-11-03',9],'12mo':['2025-12-01','2026-11-03',10],all:['2025-06-01','2026-11-03',11]}
 const sum=(r,key)=>r.series.reduce((n,b)=>n+b[key],0)
 for(const [period,[from,to,pageviews]] of Object.entries(presets))for(const interval of ['','week','month']){
  const r=await summary(`&period=${period}&interval=${interval}`)
  assert.deepEqual([r.from,r.to,r.pageviews],[from,to,pageviews],period)
  // Hours count their own distinct hashes, so only daily and longer buckets add up to the range's daily uniques.
  assert.deepEqual([sum(r,'pageviews'),sum(r,'visits'),r.interval==='hour'?r.visitors:sum(r,'visitors'),sum(r,'conversions')],[r.pageviews,r.visits,r.visitors,r.goals],`${period} by ${r.interval}: the buckets add up to the totals`)
 }
 // Daily buckets follow local days: 23:30 on 31 October and 00:10 on 2 November stay out of 1 November.
 const week=await summary('&period=7d');assert.equal(week.interval,'day')
 assert.deepEqual(week.series.map(b=>[b.label,b.pageviews,b.visits,b.conversions]),[['2026-10-27',0,0,0],['2026-10-28',0,0,0],['2026-10-29',0,0,0],['2026-10-30',0,0,0],['2026-10-31',1,1,0],['2026-11-01',4,4,0],['2026-11-02',1,1,1]])
 // The fall-back day has 25 hourly buckets; 01:00 happens twice, once in CDT and once in CST.
 const day=await summary('&period=yesterday');assert.equal(day.interval,'hour');assert.equal(day.series.length,25)
 assert.deepEqual(day.series.filter(b=>b.pageviews).map(b=>b.label),['2026-11-01 00:00 CDT','2026-11-01 01:00 CDT','2026-11-01 01:00 CST','2026-11-01 23:00 CST'])
 assert.equal((await a.request(`/api/vane/summary?siteId=${id}&period=90d&interval=hour`,owner)).status,400,'hourly charts cover at most 31 days')
 // The page draws the chosen metric and lists every bucket in its data table; each point equals its table cell.
 for(const [query,metric,expected] of [['period=7d&metric=pageviews','pageviews',['0','0','0','0','1','4','1']],['period=yesterday&metric=visits','visits',null]]){
  const html=await (await a.request(`/app/sites/${id}?section=report&${query}`,owner)).text()
  const points=[...html.matchAll(/<circle class="vane-chart-point"[^>]*data-value="([^"]*)"/g)].map(m=>m[1]),cells=[...html.matchAll(new RegExp(`<td class="vane-number" data-metric="${metric}">([^<]*)</td>`,'g'))].map(m=>m[1])
  assert.equal(points.length,metric==='pageviews'?7:25,query);assert.deepEqual(points,cells,query);if(expected)assert.deepEqual(points,expected)
  assert.match(html,/<svg class="vane-chart"[^>]*role="img"/);assert.match(html,/<caption>[^<]* by (day|hour), [^<]*America\/Chicago\)<\/caption>/)
 }
 // A new site's time zone starts as the zone the owner's browser reports.
 const {context}=await browse(t,a,{},{timezoneId:'America/Chicago'});await context.addCookies(a.owner.split('; ').map(pair=>{const [name,...value]=pair.split('=');return {name,value:value.join('='),url:a.origin}}))
 const page=await context.newPage();await page.goto(a.origin+'/app',{waitUntil:'networkidle'})
 assert.equal(await page.getByRole('textbox',{name:'Time zone'}).inputValue(),'America/Chicago')
})
test('DASH-008 the last 30 days compared with the previous period, the same period last year and a custom period, with and without matched weekdays, overlay the chart and give every table row its absolute and percentage change',async t=>{
 const a=await withApp(t),owner={headers:{cookie:a.owner}}
 await a.clock(Date.parse('2025-05-01T10:00:00Z'));const id=await a.addSite({paths:['/','/pricing','/thanks']})
 const visit=async(at,people,path,source)=>{await a.clock(Date.parse(at));for(const n of people)assert.equal((await a.post('/api/vane/collect',a.event(id,{path,source}),'',{origin:'https://fern.example','cf-connecting-ip':`203.0.113.${n}`,'user-agent':'Synthetic Browser'})).status,202,at)}
 await visit('2025-06-10T10:00:00Z',[1],'/pricing','alpha.example');await visit('2025-06-20T10:00:00Z',[1,2,3,4],'/','beta.example')
 await visit('2026-04-28T10:00:00Z',[1],'/pricing','alpha.example');await visit('2026-05-15T10:00:00Z',[1,2],'/pricing','alpha.example');await visit('2026-05-29T10:00:00Z',[1],'/','gamma.example')
 await visit('2026-06-10T10:00:00Z',[1,2,3],'/pricing','alpha.example');await visit('2026-06-20T10:00:00Z',[4],'/','beta.example')
 await a.clock(Date.parse('2026-06-30T12:00:00Z'))
 const summary=async query=>{const r=await a.request(`/api/vane/summary?siteId=${id}&period=30d${query}`,owner);assert.equal(r.status,200,query);return r.json()}
 const sources=r=>Object.fromEntries(r.sources.map(row=>[row.label,[row.count,row.previous]])),at=(r,i)=>[r.series[i].pageviews,r.previousSeries[i].pageviews]
 const previous=await summary('');assert.deepEqual([previous.from,previous.to,previous.previousFrom,previous.previousTo,previous.pageviews,previous.previousPageviews],['2026-06-01','2026-07-01','2026-05-02','2026-06-01',4,3])
 assert.deepEqual(sources(previous),{'alpha.example':[3,2],'beta.example':[1,0],'gamma.example':[0,1]})
 assert.deepEqual([at(previous,9),at(previous,13),at(previous,19),at(previous,27)],[[3,0],[0,2],[1,0],[0,1]],'the overlay pairs each day with its compared day')
 const year=await summary('&compare=year');assert.deepEqual([year.previousFrom,year.previousTo,year.previousPageviews],['2025-06-01','2025-07-01',5])
 assert.deepEqual(sources(year),{'alpha.example':[3,1],'beta.example':[1,4]});assert.deepEqual([at(year,9),at(year,19)],[[3,1],[1,4]])
 assert.deepEqual(year.channels.map(row=>[row.label,row.visitors,row.previous]),[['Referral',4,5]])
 assert.deepEqual(year.topPages.map(row=>[row.path,row.visitors,row.previous]),[['/pricing',3,1],['/',1,4]])
 // Matching weekdays: 1 June 2026 is a Monday, and so is each compared start.
 const weekly=await summary('&weekdays=on');assert.deepEqual([weekly.previousFrom,weekly.previousTo],['2026-04-27','2026-05-27']);assert.deepEqual(sources(weekly),{'alpha.example':[3,3],'beta.example':[1,0]})
 assert.deepEqual((await summary('&compare=year&weekdays=on')).previousFrom,'2025-06-02')
 const custom=await summary('&compare=custom&compareFrom=2025-06-15&compareTo=2025-06-25');assert.deepEqual([custom.previousFrom,custom.previousTo,custom.previousPageviews],['2025-06-15','2025-06-25',4])
 const shifted=await summary('&compare=custom&compareFrom=2025-06-15&compareTo=2025-06-25&weekdays=on');assert.deepEqual([shifted.previousFrom,shifted.previousTo,shifted.previousPageviews],['2025-06-09','2025-06-19',1])
 assert.equal((await a.request(`/api/vane/summary?siteId=${id}&compare=custom&compareFrom=2025-06-25&compareTo=2025-06-15`,owner)).status,400)
 // On the page: both series on the chart, and every table row carries its change, absolute and in percent.
 for(const [query,r,rows] of [['',previous,[['alpha.example','+1 (+50.0%)'],['beta.example','+1 (new)'],['gamma.example','-1 (-100.0%)']]],['&compare=year',year,[['alpha.example','+2 (+200.0%)'],['beta.example','-3 (-75.0%)'],['/pricing','+2 (+200.0%)'],['Referral','-1 (-20.0%)']]]]){
  const html=unlinked(await (await a.request(`/app/sites/${id}?section=report&period=30d&metric=pageviews${query}`,owner)).text())
  const values=kind=>[...html.matchAll(new RegExp(`<circle class="${kind}"[^>]*data-value="([^"]*)"`,'g'))].map(m=>Number(m[1]))
  assert.deepEqual([values('vane-chart-point'),values('vane-chart-compare-point')],[r.series.map(b=>b.pageviews),r.previousSeries.map(b=>b.pageviews)],query)
  assert.equal((html.match(/<polyline class="vane-chart-compare"/g)??[]).length,1,query)
  for(const [label,text] of rows)assert.match(html,new RegExp(`<th scope="row">${label.replace('.','\\.')}</th>(<td[^>]*>[^<]*</td>)*<td class="vane-number" data-change="[^"]*">${text.replace(/[+().]/g,'\\$&')}</td>`),`${query} ${label}`)
  const tables=html.split('<table>').slice(1).map(part=>part.split('</table>')[0]).filter(table=>!table.includes('Compared with</th>'))
  assert.ok(tables.length>=10,query)
  for(const table of tables){assert.ok(table.includes('<th scope="col" class="vane-number">Change</th>'),table.slice(0,120));assert.equal((table.match(/<tr><th scope="row">/g)??[]).length,(table.match(/data-change="/g)??[]).length,table.slice(0,120))}
 }
})
test('RETENTION-002 a keep-forever site keeps 30 months of imported history and today\'s events, 25 months erases only older events with one journal entry, and a store past 80% of its capacity warns with both choices and drops nothing',async t=>{
 const a=await withApp(t),owner={headers:{cookie:a.owner}}
 await a.clock(Date.parse('2026-10-19T12:00:00Z'));const id=await a.addSite({retention:'forever'})
 const bytesOf=async(app,cookie)=>Number((await (await app.request('/app?section=history',{headers:{cookie}})).text()).match(/data-store-bytes="(\d+)"/)[1]),fresh=await bytesOf(a,a.owner)
 const months=Array.from({length:30},(_,i)=>new Date(Date.UTC(2024,3+i,15,10)).toISOString()),history=structuredClone(fixture)
 history.data=months.map((createdAt,i)=>({...structuredClone(fixture.data[0]),id:`synthetic-month-${i}`,sessionId:`synthetic-month-session-${i}`,createdAt}));history.count=history.pageSize=30
 // The import applies in batches; the same reviewed document is applied again until it is complete.
 const {preview}=await movein(a,id,history);for(let n=0;n<5;n++){const r=await (await a.post('/api/vane/import-apply',{siteId:id,document:preview.carry,fingerprint:preview.fingerprint},a.owner)).json();if(r.complete)break}
 assert.equal((await a.collect(a.event(id))).status,202)
 const pageviews=async(from,to)=>(await (await a.request(`/api/vane/summary?siteId=${id}&from=${from}&to=${to}`,owner)).json()).pageviews
 // Apply retention erases one imported event per run, so the owner repeats it until none remain.
 const retain=async()=>{for(let n=0;n<10;n++){const r=await a.form({operation:'history.retention',siteId:id},a.owner);assert.equal(r.status,303);const notice=new URL(r.headers.get('location'),a.origin).searchParams.get('notice');if(!/remain to expire/.test(notice))return notice}throw new Error('retention did not finish')}
 assert.match(await retain(),/erased nothing/)
 let tables=(await a.archive()).payload.tables
 assert.deepEqual([tables.vane_import_events.length,tables.vane_events.length,tables.vane_deletions.length],[30,1,0],'every imported and live event remains')
 assert.deepEqual([await pageviews('2024-04-15','2024-04-16'),await pageviews('2024-04-15','2026-10-20')],[1,31],'the oldest imported day still returns its event')
 assert.equal((await (await a.request('/api/vane/inventory?siteId='+id,owner)).json()).retention,'as long as this installation exists')
 assert.match(await (await a.request(`/app/sites/${id}?section=settings`,owner)).text(),/<option value="forever" selected>As long as this installation exists<\/option>/)
 // 25 months before 19 October 2026 is 19 September 2024: the six monthly rows before it go, the other 24 and today's event stay.
 const input={siteId:id,name:'Fern Studio',origin:'https://fern.example',paths:['/','/thanks'],goals:{signup:'/thanks'},consent:'not-required',sampleRate:100,retention:'25m'}
 const changed=await (await a.post('/api/vane/commands',{command:'site.configure',input},a.owner)).json();assert.equal((await a.form({operation:'proposal.approve',id:changed.id},a.owner)).status,303)
 assert.match(await retain(),/Retention applied/)
 tables=(await a.archive()).payload.tables
 assert.deepEqual([tables.vane_import_events.length,tables.vane_events.length,tables.vane_deletions.map(d=>d.before_day)],[24,1,['2024-09-19']])
 assert.deepEqual([await pageviews('2024-04-15','2024-09-19'),await pageviews('2024-09-19','2026-10-20')],[0,25])
 // A fixture store whose published capacity puts a fresh installation 5% under the 80% warning.
 const b=await installation({vars:{VANE_STORE_LIMIT_MB:String(fresh*1.05/0.8/1048576)}});t.after(()=>b.close())
 await b.clock(Date.parse('2026-10-19T12:00:00Z'));const small=await b.addSite(),warning=async path=>(await (await b.request(path,{headers:{cookie:b.owner}})).text()).match(/<div class="vane-error" role="alert" data-store-share="[^"]*">([^<]*)<\/div>/)?.[1]
 assert.equal(await warning('/app'),undefined,'below 80% no page warns')
 let sent=0;while(!await warning('/app')){for(let n=0;n<25;n++,sent++)assert.equal((await b.collect(b.event(small))).status,202);assert.ok(sent<5000,'the store reaches 80%')}
 for(const path of ['/app',`/app/sites/${small}?section=report`,`/app/sites/${small}?section=history`]){const text=await warning(path);assert.match(text,/a scheduled warehouse export of older events/,path);assert.match(text,/a shorter retention window/,path)}
 for(let n=0;n<5;n++,sent++)assert.equal((await b.collect(b.event(small))).status,202,'nothing is turned away at 80%')
 assert.equal((await (await b.request(`/api/vane/summary?siteId=${small}&period=today`,{headers:{cookie:b.owner}})).json()).pageviews,sent,'every event is kept')
})
test('DASH-010 three sites sort by change and search on the overview, and a roll-up of two sums visitors and visits per site with the cross-site note, exact pageview and conversion sums, a recomputed bounce rate and a split by site',async t=>{
 const a=await withApp(t),owner={headers:{cookie:a.owner}}
 await a.clock(Date.parse('2026-10-10T12:00:00Z'))
 const fern=await a.addSite(),oak=await a.addSite({name:'Oak Books',origin:'https://oak.example'}),elm=await a.addSite({name:'Elm Bakery',origin:'https://elm.example'})
 const visit=async(siteId,origin,ip,path='/')=>assert.equal((await a.post('/api/vane/collect',a.event(siteId,{path}),'',{origin,'cf-connecting-ip':ip,'user-agent':'Synthetic Browser'})).status,202)
 // Previous seven days: five Elm visitors and one Oak visitor.
 for(const n of [11,12,13,14,15])await visit(elm,'https://elm.example',`198.51.100.${n}`);await visit(oak,'https://oak.example','198.51.100.16')
 // Today: one person (same IP and user agent) on Fern and Oak, a second Fern visitor who converts five minutes later, a second Oak visitor and one Elm visitor.
 await a.clock(Date.parse('2026-10-17T14:00:00Z'))
 await visit(fern,'https://fern.example','203.0.113.1');await visit(oak,'https://oak.example','203.0.113.1');await visit(fern,'https://fern.example','203.0.113.2');await visit(oak,'https://oak.example','203.0.113.3');await visit(elm,'https://elm.example','203.0.113.4')
 await a.clock(Date.parse('2026-10-17T14:05:00Z'));await visit(fern,'https://fern.example','203.0.113.2','/thanks')
 await a.clock(Date.parse('2026-10-17T15:00:00Z'))
 const listed=async query=>{const html=await (await a.request('/app'+query,owner)).text();return [...html.matchAll(/<li data-site="([^"]+)">.*?data-visitors="(\d+)".*?data-change="(-?\d+)">([^<]*)<\/span>.*?<svg class="vane-sparkline"[^>]*aria-label="Visitors trend: ([^"]*)"/g)].map(m=>[m[1],Number(m[2]),m[4],m[5].split(', ').length])}
 assert.deepEqual(await listed('?sort=change'),[[fern,2,'+2 (new)',7],[oak,2,'+1 (+100.0%)',7],[elm,1,'-4 (-80.0%)',7]],'sorted by change, largest increase first, each with a seven-day sparkline')
 assert.deepEqual((await listed('?sort=visitors&q=OAK')).map(r=>r[0]),[oak],'search matches names and origins, ignoring case')
 // Only the owner creates a roll-up.
 const admin=await a.invite('admin@example.test','admin')
 assert.equal((await a.form({operation:'rollup.create',name:'Marketing and store',[`site_${fern}`]:'on',[`site_${oak}`]:'on'},admin)).status,403)
 const created=await a.form({operation:'rollup.create',name:'Marketing and store',[`site_${fern}`]:'on',[`site_${oak}`]:'on'},a.owner);assert.equal(created.status,303)
 const rollupId=created.headers.get('location').match(/^\/app\/rollups\/([\w-]+)\?/)[1]
 const summary=async query=>(await (await a.request(`/api/vane/summary?${query}`,owner)).json())
 const r=await summary(`rollupId=${rollupId}&period=today`),f=await summary(`siteId=${fern}&period=today`),o=await summary(`siteId=${oak}&period=today`)
 assert.deepEqual([r.visitors,r.visits,r.pageviews,r.goals,r.bounces,r.bounceRate],[4,4,5,1,3,75],'4 visitors and 4 visits summed per site, exact sums, and 3 bounced of 4 summed visits')
 assert.deepEqual([r.visitors,r.visits,r.pageviews,r.goals],[f.visitors+o.visitors,f.visits+o.visits,f.pageviews+o.pageviews,f.goals+o.goals])
 // Split by site: each row is one site's own figures.
 const split=await summary(`rollupId=${rollupId}&period=today&split=site`),pick=rows=>rows.map(row=>[row.path,row.visitors,row.pageviews,row.bounceRate])
 assert.deepEqual(pick(split.topPages),[...pick(f.topPages).map(([p,...x])=>['Fern Studio · '+p,...x]),...pick(o.topPages).map(([p,...x])=>['Oak Books · '+p,...x])])
 assert.deepEqual(split.channels.map(row=>[row.label,row.visitors,row.visits]),[...f.channels.map(row=>['Fern Studio · '+row.label,row.visitors,row.visits]),...o.channels.map(row=>['Oak Books · '+row.label,row.visitors,row.visits])])
 const page=await (await a.request(`/app/rollups/${rollupId}?period=today`,owner)).text()
 for(const text of ['<h2>Unique visitors (summed per site)</h2>','<h2>Visits (summed per site)</h2>','counts once per site','<a href="/methodology#roll-ups">'])assert.ok(page.includes(text),text)
 assert.match(page,/<p class="vane-metric">4<\/p>/)
 const methodology=await (await a.request('/methodology')).text()
 for(const rule of ['id="roll-ups"','sum of each site’s own counts','labelled summed per site','Pageviews, goal conversions and other events are exact sums','recomputed from the summed visits and conversions, never averaged across sites'])assert.ok(methodology.includes(rule),rule)
})
test('DASH-011 visits through home → pricing → signup and home → blog → exit give the journeys from home, entering at a page, and to signup with their counts and drop-off',async t=>{
 const a=await withApp(t),owner={headers:{cookie:a.owner}}
 const id=await a.addSite({paths:[]}),start=Date.parse('2026-10-17T10:00:00Z')
 // Three visitors a minute apart per step: two go home → pricing → signup, one goes home → blog and leaves; a fourth enters at the blog.
 const walk=async(ip,offset,paths)=>{for(const [i,path] of paths.entries()){await a.clock(start+offset+i*60000);assert.equal((await a.post('/api/vane/collect',a.event(id,{path}),'',{origin:'https://fern.example','cf-connecting-ip':ip,'user-agent':'Synthetic Browser'})).status,202)}}
 await walk('203.0.113.1',0,['/','/pricing','/signup']);await walk('203.0.113.2',300000,['/','/blog']);await walk('203.0.113.3',600000,['/','/pricing','/signup']);await walk('203.0.113.4',900000,['/blog'])
 await a.clock(Date.parse('2026-10-17T12:00:00Z'))
 const journey=async query=>(await (await a.request(`/api/vane/summary?siteId=${id}&period=today&${query}`,owner)).json()).journey
 const home=await journey('journey=/')
 assert.deepEqual([home.visits,home.next.map(r=>[r.steps.join(' → '),r.visits]),home.previous.map(r=>[r.steps.join(' ← '),r.visits])],[3,[['/pricing → /signup → (exit)',2],['/blog → (exit)',1]],[['(entrance)',3]]])
 assert.deepEqual(home.nextSteps.map(s=>[s.step,s.reached,s.continuing,s.dropOff]),[[1,3,3,0],[2,3,2,1],[3,2,0,2]])
 const signup=await journey('journey=/signup');assert.deepEqual(signup.previous.map(r=>[r.steps.join(' ← '),r.visits]),[['/pricing ← / ← (entrance)',2]])
 const blog=await journey('journey=/blog&journeyMode=entry');assert.deepEqual([blog.visits,blog.next.map(r=>[r.steps.join(' → '),r.visits])],[1,[['(exit)',1]]],'only the visit that entered at /blog')
 assert.equal((await journey('journey=/pricing&journeyMode=entry')).visits,0)
 assert.equal((await journey('')).path,'/','the most loaded page by default')
 // On the page, every page row links to its journeys, and the journey tables show the paths and their counts.
 const page=await (await a.request(`/app/sites/${id}?section=report&period=today&journey=%2F`,owner)).text()
 assert.match(page,/<a href="\?section=report&amp;journey=%2Fpricing&amp;journeyMode=page&amp;period=today#journeys" aria-label="Journeys through \/pricing">Journeys<\/a><\/td><\/tr>/)
 assert.match(page,/<a href="\?section=report&amp;journey=%2Fblog&amp;journeyMode=entry&amp;period=today#journeys" aria-label="Journeys entering at \/blog">/)
 for(const [steps,visits] of [['/pricing → /signup → (exit)',2],['/blog → (exit)',1]])assert.ok(page.includes(`<tr><th scope="row">${steps.replaceAll('>','&gt;')}</th><td class="vane-number">${visits}</td>`)||page.includes(`<tr><th scope="row">${steps}</th><td class="vane-number">${visits}</td>`),steps)
})
test('DASH-001 in a browser the real-time view shows current visitors, pageviews per minute and live pages and sources against 30 minutes earlier, updates within 15 seconds without a reload, and drops visitors idle for 5 minutes',async t=>{
 const a=await withApp(t),id=await a.addSite({paths:['/','/pricing','/thanks']}),owner={headers:{cookie:a.owner}},T=Date.parse('2026-03-02T15:00:30Z'),loads={}
 const load=async(at,n,extra)=>{await a.clock(at);const e=a.event(id,{source:undefined,...extra});loads[n]=e.id;assert.equal((await a.post('/api/vane/collect',e,'',{origin:'https://fern.example','cf-connecting-ip':'203.0.113.'+n,'user-agent':'Synthetic Browser '+n})).status,202)}
 // 32 minutes earlier, one visitor from Google on /pricing: the compared window.
 await load(T-32*60000,1,{path:'/pricing',referrer:'https://www.google.com/'});await a.clock(T)
 const {context}=await browse(t,a,{},{viewport:{width:1440,height:900}});await context.addCookies(a.owner.split('; ').map(pair=>{const [name,...value]=pair.split('=');return {name,value:value.join('='),url:a.origin}}))
 const tab=await context.newPage(),response=await tab.goto(`${a.origin}/app/sites/${id}?section=realtime`),policy=response.headers()['content-security-policy']
 assert.match(policy,/script-src 'nonce-[\w-]+'; connect-src 'self';/);assert.match((await a.request(`/app/sites/${id}?section=report`,owner)).headers.get('content-security-policy'),/script-src 'none'; connect-src 'none';/)
 const text=selector=>tab.evaluate(s=>document.querySelector(s)?.textContent??null,selector),rowsOf=title=>tab.evaluate(t=>[...document.querySelectorAll(`table[data-live="${t}"] tbody tr`)].map(r=>[...r.children].map(c=>c.textContent)),title)
 assert.equal(await text('[data-current-visitors]'),'0');assert.deepEqual(await rowsOf('Live pages'),[['/pricing','0','1','-1 (-100.0%)']])
 await tab.evaluate(()=>{window.vaneSameDocument=true})
 await load(T,2,{path:'/',referrer:'https://news.ycombinator.com/item?id=1'});await load(T,3,{path:'/pricing',referrer:'https://www.google.com/'});await load(T+20000,2,{path:'/pricing'})
 const sent=Date.now();await tab.waitForFunction(()=>document.querySelector('[data-current-visitors]')?.textContent==='2',null,{timeout:15000});assert.ok(Date.now()-sent<=15000)
 assert.equal(await tab.evaluate(()=>window.vaneSameDocument),true,'the view refreshed without a reload')
 assert.deepEqual(await rowsOf('Live pages'),[['/pricing','2','1','+1 (+100.0%)']])
 assert.deepEqual(await rowsOf('Live sources'),[['Google','1','1','0 (0.0%)'],['Hacker News','1','0','+1 (new)']])
 assert.equal(await text('[data-live-pageviews]'),'3');assert.deepEqual(await tab.evaluate(()=>[...document.querySelectorAll('[data-minute-pageviews]')].map(c=>c.textContent).slice(-2)),['0','3'])
 const live=await (await a.request('/api/vane/realtime?siteId='+id,owner)).json();assert.deepEqual([live.currentVisitors,live.previousCurrentVisitors,live.pageviews,live.previousPageviews,live.minutes.length,live.minutes.at(-1).label,live.minutes.at(-1).pageviews],[2,1,3,1,30,'15:00',3])
 assert.equal((await a.request('/api/vane/realtime?siteId='+id)).status,401)
 // An engagement ping keeps visitor 3 current; at 5 minutes idle the others drop.
 await a.clock(T+4*60000);assert.equal((await a.post('/api/vane/engage',{siteId:id,id:loads[3],scroll:40},'',{origin:'https://fern.example'})).status,202)
 await a.clock(T+20000+5*60000);await tab.waitForFunction(()=>document.querySelector('[data-current-visitors]')?.textContent==='1',null,{timeout:15000})
 assert.deepEqual(await rowsOf('Live pages'),[['/pricing','1','0','+1 (new)']]);assert.deepEqual(await rowsOf('Live sources'),[['Google','1','0','+1 (new)']])
 await a.clock(T+9*60000+1000);await tab.waitForFunction(()=>document.querySelector('[data-current-visitors]')?.textContent==='0',null,{timeout:15000})
 assert.deepEqual([await rowsOf('Live pages'),await rowsOf('Live sources')],[[],[]])
 await tab.setViewportSize({width:390,height:844});assert.ok(await tab.evaluate(()=>document.documentElement.scrollWidth<=390),'no horizontal scroll at 390 px')
 await context.close()
})
test('METRIC-004 the signed-out methodology page defines every metric the dashboard links to, and an owner-approved visit timeout is a dated definition version annotated on the charts it affects',async t=>{
 const a=await withApp(t),owner={headers:{cookie:a.owner}},admin=await a.invite('admin@example.test','admin'),id=await a.addSite(),oak=await a.addSite({name:'Oak Store',origin:'https://oak.example'})
 const load=async(site,origin,at)=>{await a.clock(at);assert.equal((await a.post('/api/vane/collect',a.event(site),'',{origin,'cf-connecting-ip':'203.0.113.4','user-agent':'Synthetic Browser 4'})).status,202)}
 const at=(d,minutes)=>Date.parse(d+'T09:00:00Z')+minutes*60000
 // 2 March, under the 30-minute default: page loads 40 minutes apart are two visits.
 for(const m of [0,40])await load(id,'https://fern.example',at('2026-03-02',m))
 const methodology=await a.request('/methodology');assert.equal(methodology.status,200);const page=await methodology.text()
 const report=await (await a.request(`/app/sites/${id}?section=report&from=2026-03-01&to=2026-03-08`,owner)).text(),links=[...new Set([...report.matchAll(/href="\/methodology#([a-z-]+)"/g)].map(m=>m[1]))]
 for(const anchor of ['unique-visitors','visits','pageviews','pages-per-visit','bounce-rate','visit-duration','conversions','time-on-page','scroll-depth'])assert.ok(links.includes(anchor),anchor)
 for(const anchor of [...links,'revenue','consented-mode','definition-versions','estimation','roll-ups'])assert.ok(page.includes(`id="${anchor}"`),anchor)
 for(const phrase of ['exactly two declared exceptions','never averaged across sites','never scaled up','a whole number of minutes from 15 to 120'])assert.ok(page.includes(phrase),phrase)
 // An administrator prepares the change, only 15 to 120 minutes are accepted, forged versions are ignored, and only the owner approves.
 const input={siteId:id,name:'Fern Studio',origin:'https://fern.example',paths:['/','/thanks'],goals:{signup:'/thanks'},consent:'not-required',sampleRate:100,retentionDays:90}
 for(const visitTimeout of [10,121,30.5])assert.equal((await a.post('/api/vane/commands',{command:'site.configure',input:{...input,visitTimeout}},admin)).status,400)
 const p=await (await a.post('/api/vane/commands',{command:'site.configure',input:{...input,visitTimeout:45,definitions:[{metric:'visit-timeout',from:'2020-01-01',minutes:120,previous:30,approvedAt:0}]}},admin)).json()
 assert.equal((await a.form({operation:'proposal.approve',id:p.id},admin)).status,403)
 await a.clock(Date.parse('2026-03-05T08:00:00Z'));assert.equal((await a.form({operation:'proposal.approve',id:p.id},a.owner)).status,303)
 // 5 March, under version 2 (45 minutes): gaps of 40 and 50 minutes make two visits; Oak keeps its 30 minutes.
 for(const m of [0,40,90])await load(id,'https://fern.example',at('2026-03-05',m))
 for(const m of [0,40])await load(oak,'https://oak.example',at('2026-03-05',m))
 const summary=await (await a.request(`/api/vane/summary?siteId=${id}&from=2026-03-01&to=2026-03-08`,owner)).json()
 assert.equal(summary.visits,4,'2 March keeps the 30-minute version, 5 March uses 45 minutes');assert.match(summary.explanation,/no gap over 45 minutes \(the visit definition changed in this range/)
 const note='Visit definition v2: a visit ends after 45 minutes without a page load (was 30).'
 for(const metric of ['visits','bounceRate','duration']){const html=await (await a.request(`/app/sites/${id}?section=report&from=2026-03-01&to=2026-03-08&metric=${metric}`,owner)).text();assert.ok(html.includes('data-annotation="2026-03-05"')&&html.includes(`<time datetime="2026-03-05">2026-03-05</time> ${note}`),metric)}
 for(const query of ['metric=pageviews&from=2026-03-01&to=2026-03-08','metric=visits&from=2026-03-06&to=2026-03-08'])assert.ok(!(await (await a.request(`/app/sites/${id}?section=report&${query}`,owner)).text()).includes('data-annotation='),query)
 assert.ok((await (await a.request(`/app/sites/${id}?section=settings`,owner)).text()).includes('Now visit definition v2, 45 minutes, since 2026-03-05.'))
 // A roll-up applies each site's own version and names the site in the annotation.
 const created=await a.form({operation:'rollup.create',name:'Both',[`site_${id}`]:'on',[`site_${oak}`]:'on'},a.owner),rollup=created.headers.get('location').match(/\/app\/rollups\/([\w-]+)/)[1]
 const rolled=await (await a.request(`/api/vane/summary?rollupId=${rollup}&from=2026-03-01&to=2026-03-08`,owner)).json();assert.equal(rolled.visits,6)
 assert.ok((await (await a.request(`/app/rollups/${rollup}?from=2026-03-01&to=2026-03-08&metric=visits`,owner)).text()).includes(`<time datetime="2026-03-05">2026-03-05</time> Fern Studio: ${note}`))
})
test('COLLECT-003 a headless browser, crawlers, Cloudflare low bot scores and verified bots, data-centre networks, referrer spam, excluded IP ranges, an excluded country and the owner\'s opted-out browser are refused and counted by reason beside real visits, and no visitor IP, country or user agent is stored',async t=>{
 const a=await withApp(t),owner={headers:{cookie:a.owner}},id=await a.addSite({excludeIps:'198.51.100.0/24\n2001:db8::/32',excludeCountries:'ca',autoEvents:['outbound']})
 const chrome='Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36',googlebot='Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)'
 // cf carries Cloudflare's request fields (bot score, verified bot, ASN) at the Worker's fetch door.
 const send=(headers,extra={},cf)=>a.request('/api/vane/collect',{method:'POST',headers:{origin:'https://fern.example','content-type':'application/json','user-agent':chrome,'cf-connecting-ip':'203.0.113.20',...headers},body:JSON.stringify(a.event(id,extra)),...(cf?{cf}:{})})
 // A real headless browser's page load is refused as automation.
 const {context}=await browse(t,a,{'https://fern.example/':`<!doctype html><title>Fern</title><script src="${a.origin}/vane.js" data-site="${id}"></script>`},{userAgent:null}),tab=await context.newPage()
 const refused=tab.waitForResponse(r=>new URL(r.url()).pathname==='/api/vane/collect');await tab.goto('https://fern.example/');assert.equal((await refused).status(),403);await context.close()
 // The owner's opted-out browser sends only an empty count.
 const own=await browse(t,a,{'https://fern.example/':`<!doctype html><title>Fern</title><script src="${a.origin}/vane.js" data-site="${id}"></script>`}),ownTab=await own.context.newPage(),sent=[];ownTab.on('request',r=>sent.push(new URL(r.url()).pathname))
 const ignored=ownTab.waitForRequest(r=>new URL(r.url()).pathname==='/api/vane/ignored/'+id);await ownTab.goto('https://fern.example/#vane-ignore=on');const count=await ignored
 assert.equal(count.postData()??'','');assert.equal((await count.response()).status(),202);await ownTab.waitForTimeout(500);assert.ok(!sent.includes('/api/vane/collect'),'nothing is collected');await own.context.close()
 assert.equal((await a.post('/api/vane/ignored/'+id,{path:'/'},'',{origin:'https://fern.example'})).status,400,'the count carries no fields')
 // Real visits, one from an address just outside the excluded range and one from a residential network that Cloudflare scores as human.
 for(const ip of ['203.0.113.20','198.51.101.7'])assert.equal((await send({'cf-connecting-ip':ip})).status,202)
 assert.equal((await send({},{},{asn:7922,botManagement:{score:85,verifiedBot:false}})).status,202)
 for(const [headers,extra,reason,cf] of [[{'user-agent':googlebot},{},'bot'],[{'user-agent':'curl/8.4.0'},{},'bot'],[{},{referrer:'https://semalt.com/'},'referrer-spam'],[{'cf-connecting-ip':'198.51.100.7'},{},'excluded-ip'],[{'cf-connecting-ip':'2001:db8::5'},{},'excluded-ip'],[{'cf-ipcountry':'CA'},{},'excluded-country'],[{},{},'bot',{botManagement:{score:12,verifiedBot:false}}],[{},{},'bot',{botManagement:{score:95,verifiedBot:true}}],[{},{},'data-centre',{asn:16509}],[{},{},'data-centre',{asn:24940}]]){const r=await send(headers,extra,cf);assert.equal(r.status,403,reason);assert.ok((await r.json()).message.endsWith(`(${reason}).`),reason)}
 const event=(headers,cf)=>a.request('/api/vane/event',{method:'POST',headers:{origin:'https://fern.example','content-type':'application/json','user-agent':chrome,...headers},body:JSON.stringify({id:crypto.randomUUID(),siteId:id,kind:'outbound',prop:'https://elsewhere.example/',consent:'not-required'}),...(cf?{cf}:{})})
 for(const [headers,cf] of [[{'user-agent':googlebot}],[{},{botManagement:{score:4}}],[{},{asn:14061}]])assert.equal((await event(headers,cf)).status,403,'automatic events from excluded traffic are refused');assert.equal((await event({})).status,202)
 const summary=await (await a.request('/api/vane/summary?siteId='+id,owner)).json();assert.equal(summary.pageviews,3)
 assert.deepEqual(summary.exclusions,[{reason:'bot',count:5},{reason:'data-centre',count:2},{reason:'excluded-country',count:1},{reason:'excluded-ip',count:2},{reason:'own-browser',count:1},{reason:'referrer-spam',count:1}])
 const report=await (await a.request(`/app/sites/${id}?section=report`,owner)).text()
 for(const row of ['<dt>Bots and automation</dt><dd>5 of 8 page loads that reached Vane (62.5%), not collected.</dd>','<dt>Data-centre networks</dt><dd>2 of 5 page loads that reached Vane (40.0%), not collected.</dd>','<dt>Excluded IP addresses</dt><dd>2 of 5','<dt>Excluded countries</dt><dd>1 of 4','<dt>Referrer spam</dt><dd>1 of 4','<dt>Own browser (opted out)</dt><dd>1 of 4'])assert.ok(report.includes(row),row)
 const stored=JSON.stringify(await a.dump());for(const value of ['198.51.100.7','2001:db8::5','203.0.113.20','Googlebot','HeadlessChrome','curl/','semalt'])assert.ok(!stored.includes(value),value)
 const settings=await (await a.request(`/app/sites/${id}?section=settings`,owner)).text();assert.ok(settings.includes('198.51.100.0/24\n2001:db8::/32')&&settings.includes('value="CA"'))
 const input={siteId:id,name:'Fern Studio',origin:'https://fern.example',paths:['/','/thanks'],goals:{signup:'/thanks'},consent:'not-required'}
 for(const extra of [{excludeIps:'198.51.100.0/33'},{excludeIps:'example.com'},{excludeCountries:'ZZ'},{excludeCountries:Array.from({length:31},(_,i)=>String.fromCharCode(65+i%26)+String.fromCharCode(65+Math.floor(i/26))).join(' ')}])assert.equal((await a.post('/api/vane/commands',{command:'site.configure',input:{...input,...extra}},a.owner)).status,400,JSON.stringify(extra))
 const methodology=await (await a.request('/methodology')).text();for(const phrase of ['id="excluded-traffic"','headlesschrome','semalt.com','AS16509 Amazon AWS','never stored'])assert.ok(methodology.includes(phrase),phrase)
})
test('REPORT-003 a week where organic search falls 40% on one page names that channel and page with their totals, lists the range\'s annotation and coverage change, and judges each day against the 95% day-of-week prediction interval',async t=>{
 const a=await withApp(t),owner={headers:{cookie:a.owner}},input={name:'Fern Studio',origin:'https://fern.example',paths:[],excludePaths:['/admin/**'],goals:{},consent:'not-required',sampleRate:100,retentionDays:365},id=await a.addSite(input)
 const DAY=86400000,date=ms=>new Date(ms).toISOString().slice(0,10),range=Date.parse('2026-03-09T00:00:00Z')
 const visit=async(at,k,organic)=>{await a.clock(at);assert.equal((await a.post('/api/vane/collect',a.event(id,organic?{path:'/pricing',source:undefined,campaign:undefined,referrer:'https://www.google.com/'}:{path:'/',source:undefined,campaign:undefined}),'',{origin:'https://fern.example','cf-connecting-ip':'203.0.113.'+k,'user-agent':'Synthetic Browser 7'})).status,202)}
 const day=async(start,organic,direct)=>{for(let k=0;k<organic+direct;k++)await visit(start+(9*60+k*5)*60000,k+1,k<organic)}
 // Weeks 2-8 before the range: 4 or 6 direct visits a day, alternating by week; week 1 (the compared week): 4 a day, 10 of them organic.
 for(let week=8;week>=2;week--)for(let d=0;d<7;d++)await day(range-week*7*DAY+d*DAY,0,week%2?4:6)
 for(const [d,organic] of [2,2,2,1,1,1,1].entries())await day(range-7*DAY+d*DAY,organic,4-organic)
 // The range: organic 6 (−40%), direct 18 as before; Monday has 4 visits, Tuesday 1.
 for(const [d,[organic,direct]] of [[2,2],[0,1],[1,3],[1,3],[1,3],[1,3],[0,3]].entries())await day(range+d*DAY,organic,direct)
 await a.clock(range+2*DAY+12*3600000);assert.equal((await a.post('/api/vane/collect',a.event(id,{path:'/admin/users'}),'',{origin:'https://fern.example'})).status,403)
 const p=await (await a.post('/api/vane/commands',{command:'site.configure',input:{...input,siteId:id,visitTimeout:45}},a.owner)).json();assert.equal((await a.form({operation:'proposal.approve',id:p.id},a.owner)).status,303)
 const summary=await (await a.request(`/api/vane/summary?siteId=${id}&from=2026-03-09&to=2026-03-16`,owner)).json(),e=summary.explain
 assert.deepEqual([summary.visits,summary.previousVisits],[24,28])
 const moved=e.movers.map(m=>[m.dimension,m.label,m.then,m.now,m.totalThen,m.totalNow])
 assert.deepEqual(moved.filter(m=>m[0]!=='Device'),[['Channel','Organic Search',10,6,28,24],['Page','/pricing',10,6,28,24]],'direct and / are stable, so only organic search and /pricing moved')
 assert.deepEqual(e.annotations.map(n=>n.day),['2026-03-11']);assert.deepEqual(e.coverage,[{label:'excluded-path',now:1,then:0}])
 const judged=Object.fromEntries(e.variation.map(d=>[d.day,d.metrics?.visitors]))
 // Monday's baseline leaves out MLK Day and Washington's Birthday: 4,6,6,4,6,6 gives 5.33 ± 2.571·s·√(7/6); Tuesday's eight give 5 ± 2.365·s·√(9/8).
 assert.deepEqual(judged['2026-03-09'],{value:4,low:2.5,high:8.2,within:true});assert.deepEqual(judged['2026-03-10'],{value:1,low:2.3,high:7.7,within:false})
 const html=await (await a.request(`/app/sites/${id}?section=report&from=2026-03-09&to=2026-03-16`,owner)).text()
 for(const phrase of ['Channel Organic Search: 10 → 6 visits (−4, −40%), of 28 → 24 visits in all.','Page /pricing: 10 → 6 pageviews (−4, −40%), of 28 → 24 pageviews in all.','2026-03-11: Visit definition v2','Excluded paths: 0 → 1.','2.3 to 7.7: outside normal variation','2.5 to 8.2: within normal variation'])assert.ok(html.includes(phrase),phrase)
 assert.ok(!/because|caused|due to/i.test(html.slice(html.indexOf('Weekly explanation'),html.indexOf('What moved')+4000)),'the explanation never claims a cause')
 const holiday=await (await a.request(`/api/vane/summary?siteId=${id}&from=2026-02-16&to=2026-02-18`,owner)).json();assert.deepEqual(holiday.explain.variation.map(d=>[d.day,d.holiday??null,Boolean(d.metrics)]),[['2026-02-16','Washington’s Birthday',false],['2026-02-17',null,true]])
 assert.equal((await (await a.request(`/api/vane/summary?siteId=${id}&from=2026-01-01&to=2026-03-16`,owner)).json()).explain.variation,null,'ranges over 31 days are not judged')
})
test('CONV-004 conversions from Google and from email give every channel, source, UTM, entry-page and device row its conversions and conversion rate for the selected goal, or for any goal',async t=>{
 const a=await withApp(t),owner={headers:{cookie:a.owner}},id=await a.addSite({paths:[],goals:{signup:'/thanks',demo:'/demo'}})
 const desktop='Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36',iphone='Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1'
 const start=Date.parse('2026-03-03T10:00:00Z'),google={source:undefined,campaign:undefined,referrer:'https://www.google.com/'},email={source:undefined,campaign:'spring',utm:{source:'newsletter',medium:'email'}}
 const visit=async(n,agent,first,paths)=>{for(const [i,path] of paths.entries()){await a.clock(start+n*600000+i*60000);assert.equal((await a.post('/api/vane/collect',a.event(id,{...(i?{source:undefined,campaign:undefined}:first),path}),'',{origin:'https://fern.example','cf-connecting-ip':'203.0.113.'+n,'user-agent':agent})).status,202)}}
 await visit(1,desktop,google,['/','/thanks']);await visit(2,desktop,google,['/']);await visit(3,iphone,google,['/','/demo']);await visit(4,desktop,email,['/pricing','/thanks']);await visit(5,desktop,email,['/pricing'])
 const summary=async goal=>(await a.request(`/api/vane/summary?siteId=${id}&from=2026-03-03&to=2026-03-04${goal?'&goal='+goal:''}`,owner)).json()
 const pick=rows=>Object.fromEntries(rows.map(r=>[r.label??r.path,[r.visits,r.conversions,r.conversionRate]]))
 const signup=await summary('signup')
 assert.deepEqual(pick(signup.channels),{'Organic Search':[3,1,33.3],Email:[2,1,50]})
 assert.deepEqual(pick(signup.sourceVisits),{Google:[3,1,33.3],newsletter:[2,1,50]})
 assert.deepEqual([pick(signup.utmMediums),pick(signup.utmCampaigns)],[{email:[2,1,50]},{spring:[2,1,50]}])
 assert.deepEqual(pick(signup.entryPages),{'/':[3,1,33.3],'/pricing':[2,1,50]})
 assert.deepEqual(pick(signup.devices),{desktop:[4,2,50],mobile:[1,0,0]})
 const any=await summary();assert.deepEqual([pick(any.channels),pick(any.devices)],[{'Organic Search':[3,2,66.7],Email:[2,1,50]},{desktop:[4,2,50],mobile:[1,1,100]}])
 const html=unlinked(await (await a.request(`/app/sites/${id}?section=report&from=2026-03-03&to=2026-03-04&goal=signup`,owner)).text())
 const row=label=>{const i=html.indexOf(`<th scope="row">${label}</th>`);return html.slice(i,html.indexOf('</tr>',i))}
 for(const [label,cells] of [['Email','<td class="vane-number">1</td><td class="vane-number">50.0%</td>'],['Organic Search','<td class="vane-number">1</td><td class="vane-number">33.3%</td>'],['mobile','<td class="vane-number">1</td><td class="vane-number">0</td><td class="vane-number">0.0%</td>']])assert.ok(row(label).includes(cells),label)
 assert.ok(html.includes('<th scope="col" class="vane-number">Conversions</th><th scope="col" class="vane-number">Conversion rate</th>'))
})
test('DASH-009 a member\'s note, an approved settings change, a deploy webhook, an Uptime incident and a signed GitHub release appear on the chart on their days and in the explanation, with owner-only secrets and author-or-owner note deletion',async t=>{
 const a=await withApp(t),owner={headers:{cookie:a.owner}},member=await a.invite('member@example.test','member'),admin=await a.invite('admin@example.test','admin'),id=await a.addSite()
 const today=new Date().toISOString().slice(0,10),earlier=new Date(Date.now()-2*86400000).toISOString().slice(0,10)
 // A member adds a note; markup and over-long notes are refused.
 assert.equal((await a.form({operation:'annotation.add',siteId:id,day:today,text:'Pricing page redesign shipped'},member)).status,303)
 for(const text of ['<b>bold</b>','x'.repeat(281)])assert.equal((await a.form({operation:'annotation.add',siteId:id,day:today,text},member)).status,400)
 // The owner approves a settings change that also makes a public stats page.
 const p=await (await a.post('/api/vane/commands',{command:'site.configure',input:{siteId:id,name:'Fern Studio',origin:'https://fern.example',paths:['/','/thanks'],goals:{signup:'/thanks'},consent:'not-required',publicReports:['totals']}},a.owner)).json();assert.equal((await a.form({operation:'proposal.approve',id:p.id},a.owner)).status,303)
 // Only the owner creates the webhook secret; it is shown once and kept only as its SHA-256.
 assert.equal((await a.form({operation:'annotation-hook.create',siteId:id},admin)).status,403)
 const created=await a.form({operation:'annotation-hook.create',siteId:id},a.owner);assert.equal(created.status,200);const secret=(await created.text()).match(/data-annotation-secret>(vane_ah_[0-9a-f]{64})</)[1]
 assert.ok(!(await (await a.request(`/app/sites/${id}?section=settings`,owner)).text()).includes(secret),'shown once');assert.ok(!JSON.stringify(await a.dump()).includes(secret),'only the hash is kept')
 const hook=(body,token=secret)=>a.request('/api/vane/annotations',{method:'POST',headers:{'content-type':'application/json',authorization:'Bearer '+token},body:JSON.stringify({siteId:id,...body})})
 assert.equal((await hook({id:'deploy-42',kind:'deploy',at:earlier+'T12:00:00Z',title:'Deploy 42',url:'https://ci.example/runs/42?token=abc#log'})).status,201)
 assert.equal((await hook({id:'deploy-42',kind:'deploy',at:earlier+'T12:00:00Z',title:'Deploy 42'})).status,200,'a repeat is idempotent')
 assert.equal((await hook({id:'incident-7',kind:'incident',at:Date.now(),title:'Checkout down for 4 minutes'})).status,201)
 assert.equal((await hook({id:'x',kind:'deploy',at:Date.now(),title:'Forged'},'vane_ah_'+'0'.repeat(64))).status,401)
 assert.equal((await hook({id:'y',kind:'party',at:Date.now(),title:'Unknown kind'})).status,400)
 // A GitHub release, signed with the site's separate GitHub key (kept encrypted, never in plain text).
 assert.equal((await a.form({operation:'annotation-github.create',siteId:id},admin)).status,403)
 const ghKey=(await (await a.form({operation:'annotation-github.create',siteId:id},a.owner)).text()).match(/data-annotation-secret>(vane_gh_[0-9a-f]{64})</)[1];assert.ok(!JSON.stringify(await a.dump()).includes(ghKey))
 const {createHmac}=await import('node:crypto'),github=(event,payload,key=ghKey)=>{const body=JSON.stringify(payload);return a.request('/api/vane/annotations/github/'+id,{method:'POST',headers:{'content-type':'application/json','x-github-event':event,'x-github-delivery':crypto.randomUUID(),'x-hub-signature-256':'sha256='+createHmac('sha256',key).update(body).digest('hex')},body})}
 const release={action:'published',release:{id:901,tag_name:'v2.1.0',name:'v2.1.0',html_url:'https://git.example/fern/site/releases/tag/v2.1.0',published_at:earlier+'T15:00:00Z'}}
 assert.equal((await github('ping',{zen:'hi'})).status,200);assert.equal((await github('release',release)).status,201);assert.equal((await github('release',release)).status,200,'a redelivery is idempotent')
 assert.equal((await github('release',release,'vane_gh_'+'1'.repeat(64))).status,401);assert.equal((await github('push',{ref:'main'})).status,400)
 const html=await (await a.request(`/app/sites/${id}?section=report`,owner)).text()
 for(const [day,kind,text] of [[earlier,'release','Release v2.1.0'],[today,'note','Pricing page redesign shipped'],[today,'settings','Settings approved (version 1 to 2).'],[earlier,'deploy','Deploy 42'],[today,'incident','Checkout down for 4 minutes']])assert.ok(html.includes(`<li data-annotation-day="${day}" data-annotation-kind="${kind}"><time datetime="${day}">${day}</time> ${text}`),kind)
 assert.ok(html.includes(`data-annotation="${earlier}"`)&&html.includes(`data-annotation="${today}"`)&&html.includes('https://ci.example/runs/42</a>')&&!html.includes('token=abc'))
 const summary=await (await a.request(`/api/vane/summary?siteId=${id}`,owner)).json();assert.deepEqual(summary.explain.annotations.map(n=>n.kind).sort(),['deploy','incident','note','release','settings'])
 assert.match(await (await a.request('/app',owner)).text(),/annotated buckets">(<line class="vane-chart-annotation"[^>]*data-annotation-bucket="\d"\/>){2}<polyline/,'the overview sparkline marks both annotated days')
 assert.ok(!(await (await a.request('/stats/'+id)).text()).includes('Pricing page redesign'),'notes are never public')
 // At most 60 integration annotations an hour.
 for(let i=0;i<57;i++)assert.equal((await hook({id:'bulk-'+i,kind:'deploy',at:Date.now(),title:'Deploy '+i})).status,201)
 assert.equal((await hook({id:'bulk-57',kind:'deploy',at:Date.now(),title:'One too many'})).status,429)
 // Only the author or the owner deletes a note.
 const noteId=summary.annotations.find(n=>n.kind==='note').id
 assert.equal((await a.form({operation:'annotation.delete',siteId:id,id:noteId},admin)).status,403);assert.equal((await a.form({operation:'annotation.delete',siteId:id,id:noteId},member)).status,303)
 assert.equal((await a.form({operation:'annotation-hook.revoke',siteId:id},a.owner)).status,303);assert.equal((await hook({id:'after',kind:'deploy',at:Date.now(),title:'After revoke'})).status,401)
 const audit=JSON.stringify(await (await a.request('/api/vane/audit',owner)).json());for(const action of ['annotation.add','annotation.delete','annotation-hook.create','annotation-hook.revoke','annotation-github.create'])assert.ok(audit.includes(action),action)
})
test('CONV-005 the funnel product → cart → checkout → purchase counts entrants, conversion, drop-off and median time per step against the compared day, the hostname filter recomputes it, and a drop-off opens the journeys',async t=>{
 const a=await withApp(t),owner={headers:{cookie:a.owner}},id=await a.addSite({paths:[],origins:['https://shop.fern.example'],goals:{purchase:'/thanks'},funnels:'checkout=/product/* > /cart > /checkout > goal:purchase'})
 assert.equal((await a.post('/api/vane/commands',{command:'site.configure',input:{siteId:id,name:'Fern Studio',origin:'https://fern.example',paths:[],goals:{purchase:'/thanks'},consent:'not-required',funnels:'short=/cart'}},a.owner)).status,400,'a funnel has 2 to 8 steps')
 const visit=async(n,start,steps,origin='https://fern.example')=>{let at=Date.parse(start);for(const [path,after] of steps){at+=after*1000;await a.clock(at);assert.equal((await a.post('/api/vane/collect',a.event(id,{path,source:undefined,campaign:undefined}),'',{origin,'cf-connecting-ip':'203.0.113.'+n,'user-agent':'Synthetic Browser 5'})).status,202)}}
 const d='2026-03-03T10:00:00Z'
 await visit(1,d,[['/product/a',0],['/cart',30],['/checkout',90],['/thanks',60]]);await visit(2,d,[['/product/b',0],['/cart',40],['/checkout',30],['/thanks',120]])
 await visit(3,d,[['/product/a',0],['/cart',50],['/checkout',60]]);await visit(4,d,[['/product/a',0],['/cart',60]]);await visit(5,d,[['/product/c',0]])
 await visit(6,d,[['/cart',0],['/product/a',30]]);await visit(7,d,[['/product/a',0],['/cart',20]],'https://shop.fern.example');await visit(8,'2026-03-02T10:00:00Z',[['/product/a',0],['/cart',45]])
 const funnel=async extra=>(await (await a.request(`/api/vane/summary?siteId=${id}&from=2026-03-03&to=2026-03-04${extra??''}`,owner)).json()).funnels[0]
 const f=await funnel();assert.equal(f.entrants,7)
 assert.deepEqual(f.steps.map(s=>[s.label,s.visits,s.conversionRate,s.stepRate,s.dropOff,s.medianSeconds,s.previous]),[['/product/*',7,100,null,2,null,1],['/cart',5,71.4,71.4,2,40,1],['/checkout',3,42.9,60,1,60,0],['goal:purchase',2,28.6,66.7,null,90,0]])
 const shop=await funnel('&host=shop.fern.example');assert.deepEqual(shop.steps.map(s=>s.visits),[1,1,0,0],'the hostname filter recomputes the funnel')
 const html=await (await a.request(`/app/sites/${id}?section=report&from=2026-03-03&to=2026-03-04`,owner)).text()
 assert.ok(html.includes('<caption>checkout: 7 visits entered</caption>')&&html.includes('<th scope="row">2. /cart</th><td class="vane-number">5</td><td class="vane-number">71.4%</td><td class="vane-number">71.4%</td>'))
 const link=html.match(/<a href="([^"]+)" aria-label="Journeys onward from \/cart">2<\/a>/)[1].replaceAll('&amp;','&');assert.match(link,/journey=%2Fcart/)
 assert.ok((await (await a.request(`/app/sites/${id}${link}`,owner)).text()).includes('passed through /cart'),'the drop-off opens the journeys through /cart')
})
test('PERF-001 in a browser a page whose hero image arrives 3 seconds late reports an LCP p75 above 2.5 s on that page only, per page and device class, with no identifier in the report',async t=>{
 const a=await withApp(t),owner={headers:{cookie:a.owner}},id=await a.addSite({paths:[]}),{deflateSync,crc32}=await import('node:zlib'),{randomBytes}=await import('node:crypto')
 // A 160×120 noise PNG: high entropy, so Chrome counts it as a contentful image.
 const chunk=(type,data)=>{const head=Buffer.alloc(8);head.writeUInt32BE(data.length);head.write(type,4);const crc=Buffer.alloc(4);crc.writeUInt32BE(crc32(Buffer.concat([Buffer.from(type),data])));return Buffer.concat([head,data,crc])},ihdr=Buffer.alloc(13);ihdr.writeUInt32BE(160);ihdr.writeUInt32BE(120,4);ihdr[8]=8;ihdr[9]=2
 const png=Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',ihdr),chunk('IDAT',deflateSync(Buffer.concat(Array.from({length:120},()=>Buffer.concat([Buffer.from([0]),randomBytes(480)]))))),chunk('IEND',Buffer.alloc(0))])
 const script=`<script src="${a.origin}/vane.js" data-site="${id}"></script>`
 const {context}=await browse(t,a,{'https://fern.example/slow':`<!doctype html><title>Slow</title><img src="https://fern.example/hero.png" width="640" height="480" alt="">${script}`,'https://fern.example/fast':`<!doctype html><title>Fast</title><h1>Fast page</h1><p>Plain text renders at once.</p>${script}`})
 await context.route('https://fern.example/hero.png',async route=>{await new Promise(resolve=>setTimeout(resolve,3000));await route.fulfill({contentType:'image/png',body:png})})
 const tab=await context.newPage(),hide=()=>tab.evaluate(()=>{Object.defineProperty(document,'visibilityState',{value:'hidden',configurable:true});document.dispatchEvent(new Event('visibilitychange'))})
 const measure=async path=>{const collected=tab.waitForResponse(r=>new URL(r.url()).pathname==='/api/vane/collect');await tab.goto('https://fern.example'+path,{waitUntil:'load'});assert.equal((await collected).status(),202);await tab.waitForTimeout(300);const sent=tab.waitForRequest(r=>new URL(r.url()).pathname==='/api/vane/perf');await hide();const request=await sent;assert.equal((await request.response()).status(),202);return JSON.parse(request.postData())}
 const slow=await measure('/slow'),fast=await measure('/fast')
 for(const body of [slow,fast])assert.ok(Object.keys(body).every(k=>['siteId','id','lcp','inp','cls','load'].includes(k)),'only the IDs and figures are sent')
 assert.ok(slow.lcp>2500&&slow.load>2500,`slow page LCP ${slow.lcp} ms`);assert.ok(fast.lcp<2500,`fast page LCP ${fast.lcp} ms`)
 const summary=await (await a.request('/api/vane/summary?siteId='+id,owner)).json(),pages=Object.fromEntries(summary.perf.pages.map(r=>[r.label,r]))
 assert.ok(pages['/slow'].lcp>2500&&pages['/fast'].lcp<2500,'LCP p75 is above 2.5 s on the slow page only');assert.deepEqual(summary.perf.devices.map(r=>[r.label,r.measured,r.lcp]),[['desktop',2,pages['/slow'].lcp]],'with two loads, nearest-rank p75 is the slower one')
 const html=await (await a.request(`/app/sites/${id}?section=report`,owner)).text();assert.ok(html.includes(`<th scope="row">/slow</th><td class="vane-number">1</td><td class="vane-number" data-lcp="${pages['/slow'].lcp}">${(pages['/slow'].lcp/1000).toFixed(1)} s</td>`))
 assert.equal((await a.post('/api/vane/perf',{siteId:id,id:slow.id,lcp:100,url:'https://fern.example/slow'},'',{origin:'https://fern.example'})).status,400,'a report carries no other field')
 assert.equal((await a.post('/api/vane/perf',{siteId:id,id:crypto.randomUUID(),lcp:100},'',{origin:'https://fern.example'})).status,404,'a report names an existing page load')
 await context.close()
})
test('DASH-007 filtering the report by Organic Search, mobile and not /blog/* keeps hand-counted whole visits, saves a team segment that reopens in the report and the API and recomputes a funnel, and each comparison filters by visit',async t=>{
 const a=await withApp(t),owner={headers:{cookie:a.owner}},id=await a.addSite({paths:[],goals:{signup:'/thanks'},funnels:'buy=/ > /pricing'})
 const desktop='Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36',iphone='Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1'
 const start=Date.parse('2026-03-03T10:00:00Z'),google={referrer:'https://www.google.com/'},email={campaign:'spring',utm:{source:'newsletter',medium:'email'}}
 const visit=async(n,agent,first,paths)=>{for(const [i,path] of paths.entries()){await a.clock(start+n*600000+i*60000);assert.equal((await a.post('/api/vane/collect',a.event(id,{source:undefined,campaign:undefined,...(i?{}:first),path}),'',{origin:'https://fern.example','cf-connecting-ip':'203.0.113.'+n,'user-agent':agent})).status,202)}}
 // Organic Search + mobile + not /blog/* keeps visits 1, 5 and 6: 2 has /blog/a, 3 is desktop, 4 came from email, and /blog/* (one segment) does not match /blog/deep/post.
 await visit(1,iphone,google,['/','/pricing','/thanks']);await visit(2,iphone,google,['/blog/a','/pricing']);await visit(3,desktop,google,['/','/thanks'])
 await visit(4,iphone,email,['/','/pricing']);await visit(5,iphone,google,['/pricing']);await visit(6,iphone,google,['/','/blog/deep/post'])
 const range='from=2026-03-03&to=2026-03-04',summary=async query=>(await a.request(`/api/vane/summary?siteId=${id}&${range}&${query}`,owner)).json(),totals=r=>[r.visits,r.pageviews,r.goals,r.visitors]
 const all=await summary('');assert.deepEqual(totals(all),[6,12,2,6]);assert.deepEqual(all.funnels[0].steps.map(s=>s.visits),[4,2])
 // Each comparison keeps whole visits: acquisition and device by the first page load, page and goal by any page load (or none).
 for(const [filter,visits] of [['channel:is:Organic Search',5],['source:is:Google',5],['utm_medium:is:email',1],['device:is_not:desktop',5],['entry:is:/pricing',1],['page:contains:BLOG',2],['page:not_contains:blog',4],['page:matches:^/blog/[a-z]+$',1],['page:is:/blog/**',2],['goal:is:signup',2]])assert.equal((await summary('filter='+encodeURIComponent(filter))).visits,visits,filter)
 assert.equal((await a.request(`/api/vane/summary?siteId=${id}&filter=${encodeURIComponent('page:matches:(')}`,owner)).status,400,'an invalid regular expression is refused')
 // In the browser: click Organic Search in the channel table, add the device and page filters, and save the segment.
 const {context}=await browse(t,a,{},{viewport:{width:1440,height:900}});await context.addCookies(a.owner.split('; ').map(pair=>{const [name,...value]=pair.split('=');return {name,value:value.join('='),url:a.origin}}))
 const tab=await context.newPage();await tab.goto(`${a.origin}/app/sites/${id}?section=report&${range}`)
 await Promise.all([tab.waitForURL(/filter=channel/),tab.getByRole('link',{name:'Organic Search',exact:true}).first().click()])
 for(const [dimension,op,value] of [['device','is','mobile'],['page','is_not','/blog/*']]){await tab.getByLabel('Filter dimension').selectOption(dimension);await tab.getByLabel('Filter comparison').selectOption(op);await tab.getByLabel('Filter value').fill(value);await Promise.all([tab.waitForURL(u=>new URL(u).searchParams.get('filterValue')===value),tab.getByRole('button',{name:'Add filter'}).click()])}
 assert.deepEqual(await tab.locator('[data-active-filters] li').allTextContents(),['Channel is Organic Search Remove','Device is mobile Remove','Page is not /blog/* Remove'])
 assert.equal(await tab.locator('.vane-metrics .vane-metric').nth(1).textContent(),'3','visits 1, 5 and 6')
 // The save answers 303 to the report with the segment applied (the routed browser does not follow a fulfilled redirect).
 await tab.getByLabel('Segment name').fill('Organic mobile');const [saved]=await Promise.all([tab.waitForResponse(r=>r.request().method()==='POST'),tab.getByRole('button',{name:'Save as segment'}).click()])
 assert.equal(saved.status(),303);const segment=new URL(saved.headers().location,a.origin).searchParams.get('segment');assert.ok(segment)
 await tab.setViewportSize({width:390,height:844});await tab.goto(`${a.origin}/app/sites/${id}?section=report&${range}&segment=${segment}`)
 assert.equal(await tab.locator('[data-segment-applied]').textContent(),'Segment: Organic mobile.');assert.ok(await tab.locator('#filters').evaluate(e=>e.scrollWidth<=e.clientWidth),'the filters panel fits 390 px')
 // Reopened in the report and the API, the segment's totals, tables and funnel equal the hand count.
 const kept=await summary('segment='+segment);assert.deepEqual(totals(kept),[3,6,1,3]);assert.deepEqual(kept.channels.map(r=>[r.label,r.visits]),[['Organic Search',3]]);assert.deepEqual(kept.devices.map(r=>r.label),['mobile'])
 assert.deepEqual(kept.funnels[0].steps.map(s=>s.visits),[2,1],'the funnel counts visits 1 and 6 entering and visit 1 reaching /pricing')
 assert.deepEqual(totals(await summary(`segment=${segment}&filter=${encodeURIComponent('page:is:/pricing')}`)),[2,4,1,2],'an added filter narrows the segment')
 // Members apply saved segments; only the owner and administrators save or delete them, and each change is audited.
 const member=await a.invite('member@example.test','member');assert.equal((await (await a.request(`/api/vane/summary?siteId=${id}&${range}&segment=${segment}`,{headers:{cookie:member}})).json()).visits,3)
 assert.equal((await a.form({operation:'segment.save',siteId:id,name:'Mine',filters:'channel:is:Email'},member)).status,403)
 assert.ok((await (await a.request('/api/vane/audit',owner)).json()).some(e=>e.action==='segment.save'&&e.detail.includes('Organic mobile')))
 assert.equal((await a.form({operation:'segment.delete',siteId:id,id:segment},a.owner)).status,303);assert.equal((await a.request(`/api/vane/summary?siteId=${id}&segment=${segment}`,owner)).status,404)
})

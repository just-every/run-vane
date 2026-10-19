import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { createHash, createHmac } from 'node:crypto'
import { crc32 } from 'node:zlib'
import { createRequire } from 'node:module'
import { installation } from './harness.mjs'
import { appsScript } from './apps-script.mjs'
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
 const config=await a.request('/api/vane/config/'+id,{headers:{origin:'https://fern.example'}});assert.equal(config.status,200);assert.deepEqual(Object.keys(await config.json()).sort(),['autoEvents','consent','eventDefinitions','queryKeys','sampleRate'],'the script\'s config door serves only what the script uses')
 for(const path of ['/no-such-page','/api/no-such-door'])assert.equal((await a.request(path)).status,404,path)
 assert.equal((await a.request('/api/vane/no-such-door',{headers:{cookie:a.owner}})).status,404)
 for(const path of ['/api/vane/sites','/api/vane/summary','/api/vane/export','/api/vane/proposals','/api/vane/import-journal'])assert.equal((await a.request(path)).status,401)
 for(const path of ['/api/vane/commands','/api/vane/import-preview','/api/vane/import-apply','/api/vane/import-undo','/api/vane/restore','/app/action'])assert.equal((await a.post(path,{})).status,401)
 assert.equal((await a.post('/api/vane/commands',{command:'site.create'},a.owner,{origin:'https://foreign.example'})).status,403)
 for(const path of ['/app','/app/sites/'+id]){const r=await a.request(path);assert.equal(r.status,303);assert.match(r.headers.get('location'),/^\/signin/)}
 assert.equal((await a.post('/auth/signout',{},a.owner)).status,204)
 assert.equal((await a.request('/api/vane/sites',{headers:{cookie:a.owner}})).status,401)
})
test('administrator prepares, owner approves once, members neither prepare sites nor export, and revoked operators lose access',async t=>{
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
 assert.deepEqual(seed.externals.filter(external=>external.required).map(external=>external.id),['cloudflare'])
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
 const view=await (await a.request('/app?section=audit',owner)).text();for(const action of ['agent.prepare','settings.change','history.erase','sign-in'])assert.ok(view.includes(`<th scope="row" data-action="${action}">`),action)
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
 assert.deepEqual(r.topPages,[{path:'/',visitors:3,pageviews:4,visits:3,bounceRate:33.3,conversions:1,conversionRate:33.3,medianDuration:45,averageDuration:55,medianTimeOnPage:30,averageTimeOnPage:26,averageScrollDepth:60,reached75Share:50,previous:0,revenue:0,currency:'USD',revenuePerVisitor:0},{path:'/thanks',visitors:1,pageviews:1,visits:1,bounceRate:0,conversions:1,conversionRate:100,medianDuration:120,averageDuration:120,medianTimeOnPage:60,averageTimeOnPage:60,averageScrollDepth:null,reached75Share:null,previous:0,revenue:0,currency:'USD',revenuePerVisitor:0}])
 const page=unlinked(await (await a.request(`/app/sites/${id}?section=report&from=2026-03-04&to=2026-03-05`,owner)).text())
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
 const page=unlinked(await (await a.request(`/app/sites/${id}?section=report`,owner)).text());for(const html of ['<h2>Devices</h2>','<th scope="row">iPadOS 17.0</th><td class="vane-number">1</td>','<h2>Screen sizes</h2>'])assert.ok(page.includes(html),html)
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
 const page=unlinked(await (await a.request(`/app/sites/${id}?section=report&from=2026-03-11&to=2026-03-12`,owner)).text())
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
test('SHARE-001 a password-protected link that hides revenue and a dark segment link open signed out with the dashboard figures, embed only on allowed origins, refuse wrong passwords, expire, and answer 404 once revoked',async t=>{
 const a=await withApp(t),owner={headers:{cookie:a.owner}},start=Date.parse('2026-03-10T12:00:00Z'),id=await a.addSite({paths:[]});await a.addSite({name:'Oak Books',origin:'https://oak.example',paths:[]})
 await a.clock(start)
 const load=async(n,path)=>{const event=a.event(id,{path});assert.equal((await a.post('/api/vane/collect',event,'',{origin:'https://fern.example','cf-connecting-ip':'203.0.113.'+n})).status,202);return event.id}
 await load(1,'/');await load(2,'/');const thanks=await load(3,'/thanks')
 assert.equal((await a.post('/api/vane/custom',{id:crypto.randomUUID(),siteId:id,page:thanks,name:'Purchase',revenue:{amount:40,currency:'USD'},consent:'not-required'},'',{origin:'https://fern.example'})).status,202)
 const summary=await (await a.request('/api/vane/summary?siteId='+id,owner)).json();assert.equal(summary.revenue.total,40)
 const create=async(body,cookie=a.owner)=>{const r=await a.form({operation:'share.create',siteId:id,...body},cookie);if(r.status!==200)return r.status;return (await r.text()).match(/data-share-url>[^<]*(\/share\/vane_s_[0-9a-f]{64})</)[1]}
 // A password-protected link with totals and pages chosen and revenue left out.
 const locked=await create({label:'Investors',share_totals:'on',share_pages:'on',password:'correct horse',embedOrigins:'https://blog.example'})
 let page=await a.request(locked);assert.equal(page.status,401);assert.ok((await page.text()).includes('name="password"'))
 const unlock=password=>a.request(locked,{method:'POST',headers:{origin:a.origin,'content-type':'application/x-www-form-urlencoded'},body:new URLSearchParams({password}).toString()})
 assert.equal((await unlock('wrong horse')).status,401,'the wrong password is refused');assert.equal((await a.request(locked,{headers:{cookie:'vane_share=99999999999999.forged'}})).status,401,'a forged cookie is refused')
 const opened=await unlock('correct horse');assert.equal(opened.status,303);const cookie=a.cookieOf(opened)
 page=await a.request(locked,{headers:{cookie}});const html=await page.text();assert.equal(page.status,200)
 for(const part of [`<h2>Pageviews</h2><p class="vane-metric">${summary.pageviews}</p>`,`<h2>Unique visitors</h2><p class="vane-metric">${summary.visitors}</p>`,'<h2>Top pages</h2>'])assert.ok(html.includes(part),part)
 for(const part of ['Revenue','$40.00','Oak Books','/app','Settings','<h2>Sources</h2>'])assert.equal(html.includes(part),false,part)
 assert.equal(page.headers.get('x-robots-tag'),'noindex, nofollow');assert.match(page.headers.get('content-security-policy'),/frame-ancestors https:\/\/fern\.example https:\/\/blog\.example$/)
 assert.equal((await a.request('/api/vane/summary?siteId='+id,{headers:{cookie}})).status,401,'the link cookie opens no private route');assert.equal((await a.request('/app',{headers:{cookie}})).status,303)
 // Ten wrong passwords in 15 minutes lock the link until the window ends.
 for(let i=0;i<9;i++)assert.equal((await unlock('wrong horse')).status,401)
 assert.equal((await unlock('correct horse')).status,429);await a.clock(start+16*60000);assert.equal((await unlock('correct horse')).status,303)
 // A saved segment's link with no password, embedded dark on the site's own origin and refused on an unlisted one.
 const saved=await a.form({operation:'segment.save',siteId:id,name:'Thanks',filters:'page:is:/thanks'},a.owner),segment=new URL(saved.headers.get('location'),a.origin).searchParams.get('segment')
 const kept=await (await a.request(`/api/vane/summary?siteId=${id}&segment=${segment}`,owner)).json();assert.equal(kept.pageviews,1)
 const open=await create({label:'Blog',segment,share_totals:'on',share_revenue:'on',expiresDays:'30'})
 const {context}=await browse(t,a,{'https://fern.example/':`<!doctype html><title>Fern</title><iframe src="${a.origin}${open}?theme=dark"></iframe>`,'https://oak.example/':`<!doctype html><title>Oak</title><iframe src="${a.origin}${open}"></iframe>`}),tab=await context.newPage()
 await tab.goto('https://fern.example/');const frame=tab.frames().find(f=>f.url().includes('/share/'))
 assert.ok((await frame.content()).includes(`<h2>Pageviews</h2><p class="vane-metric">${kept.pageviews}</p>`),'the embed shows the segment figures');assert.ok((await frame.content()).includes('data-revenue="">$40.00'),'revenue shows when its report is chosen')
 assert.equal(await frame.evaluate(()=>getComputedStyle(document.body).backgroundColor),'rgb(15, 19, 28)','the dark theme')
 await tab.goto('https://oak.example/');assert.equal((await tab.frames().find(f=>f!==tab.mainFrame()).content()).includes('Pageviews'),false,'an unlisted origin cannot embed it')
 // Only the owner and administrators create links; revoking answers 404 at once, and a link expires after its days.
 assert.equal(await create({share_totals:'on'},await a.invite('member@example.test','member')),403)
 const listed=await (await a.request(`/app/sites/${id}?section=settings`,owner)).text();assert.ok(listed.includes('Investors')&&listed.includes('password-protected')&&!listed.includes(locked),'listed without the token')
 const linkId=(await a.dump()).vane_share_links.find(l=>l.label==='Investors').id;assert.equal((await a.form({operation:'share.revoke',id:linkId},a.owner)).status,303)
 assert.equal((await a.request(locked,{headers:{cookie}})).status,404,'a revoked link returns 404');assert.equal((await a.request(open)).status,200)
 await a.clock(start+31*86400000);assert.equal((await a.request(open)).status,404,'an expired link returns 404')
 assert.deepEqual((await (await a.request('/api/vane/audit',owner)).json()).filter(e=>e.action.startsWith('share.')).map(e=>e.action).sort(),['share.create','share.create','share.revoke'])
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
  assert.match(html,/<svg class="vane-chart"[^>]*role="img"/);assert.match(html,/<caption>[^<]* by (day|hour), [^<]*\(Central Time\)<\/caption>/)
 }
 // A new site's time zone starts as the zone the owner's browser reports.
 const {context}=await browse(t,a,{},{timezoneId:'America/Chicago'});await context.addCookies(a.owner.split('; ').map(pair=>{const [name,...value]=pair.split('=');return {name,value:value.join('='),url:a.origin}}))
 const page=await context.newPage();await page.goto(a.origin+'/app',{waitUntil:'networkidle'})
 assert.equal(await page.getByRole('textbox',{name:'Time zone'}).inputValue(),'America/Chicago')
})
test('DASH-008 a day still running is compared like with like: at 6:30 AM, 9:30 AM and 4 PM Central flat weeks read flat, and Today stops at the current hour without being judged',async t=>{
 const a=await withApp(t),owner={headers:{cookie:a.owner}}
 await a.clock(Date.parse('2026-10-04T12:00:00Z'));const id=await a.addSite({timeZone:'America/Chicago'})
 // Identical days from Oct 5, 2026: one visitor each at 8 AM, noon and 6 PM Central; Monday Oct 19 runs up to each clock time.
 const load=async(d,n,hour)=>{await a.clock(Date.parse(`2026-10-${String(d).padStart(2,'0')}T${hour}:00:00Z`));assert.equal((await a.post('/api/vane/collect',a.event(id),'',{origin:'https://fern.example','cf-connecting-ip':`203.0.113.${n}`,'user-agent':'Synthetic Browser'})).status,202)}
 for(let d=5;d<=18;d++)for(const [n,hour] of [[1,13],[2,17],[3,23]])await load(d,n,hour)
 for(const [at,hour,sofar,arrived] of [['2026-10-19T11:30:00Z',6,0,[]],['2026-10-19T14:30:00Z',9,1,[[1,13]]],['2026-10-19T21:00:00Z',16,2,[[2,17]]]]){
  for(const [n,h] of arrived)await load(19,n,h)
  await a.clock(Date.parse(at))
  const week=await (await a.request(`/api/vane/summary?siteId=${id}&period=7d`,owner)).json(),today=await (await a.request(`/api/vane/summary?siteId=${id}&period=today`,owner)).json()
  assert.deepEqual([week.visitors,week.previousVisitors,week.pageviews,week.previousPageviews,week.visits,week.previousVisits],Array(6).fill(18+sofar),at)
  assert.deepEqual([today.visitors,today.previousVisitors,today.running.day,today.running.thenDay],[sofar,sofar,'2026-10-19','2026-10-18'],at)
  const html=await (await a.request(`/app/sites/${id}?section=report&period=today`,owner)).text()
  assert.equal((html.match(/<circle class="vane-chart-point"/g)??[]).length,hour+1,`${at}: the hourly line stops at the current hour`)
  assert.ok(html.includes('Today is still running')&&!/vane-moved-finding">[^<]*fell/.test(html),`${at}: Today is not judged`)
  assert.ok(!(await (await a.request(`/app/sites/${id}?section=report`,owner)).text()).match(/vane-delta is-bad/),`${at}: no card reads as a drop`)
  assert.match(await (await a.request('/app',owner)).text(),/data-change="0">[^<]*<\/span> so far/,`${at}: the site row's change is flat`)
 }
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
 for(const metric of ['visits','bounceRate','duration']){const html=await (await a.request(`/app/sites/${id}?section=report&from=2026-03-01&to=2026-03-08&metric=${metric}`,owner)).text();assert.ok(html.includes('data-annotation="2026-03-05"')&&html.includes(`<time datetime="2026-03-05">Mar 5, 2026</time> ${note}`),metric)}
 for(const query of ['metric=pageviews&from=2026-03-01&to=2026-03-08','metric=visits&from=2026-03-06&to=2026-03-08'])assert.ok(!(await (await a.request(`/app/sites/${id}?section=report&${query}`,owner)).text()).includes('data-annotation='),query)
 assert.ok((await (await a.request(`/app/sites/${id}?section=settings`,owner)).text()).includes('Now visit definition v2, 45 minutes, since 2026-03-05.'))
 // A roll-up applies each site's own version and names the site in the annotation.
 const created=await a.form({operation:'rollup.create',name:'Both',[`site_${id}`]:'on',[`site_${oak}`]:'on'},a.owner),rollup=created.headers.get('location').match(/\/app\/rollups\/([\w-]+)/)[1]
 const rolled=await (await a.request(`/api/vane/summary?rollupId=${rollup}&from=2026-03-01&to=2026-03-08`,owner)).json();assert.equal(rolled.visits,6)
 assert.ok((await (await a.request(`/app/rollups/${rollup}?from=2026-03-01&to=2026-03-08&metric=visits`,owner)).text()).includes(`<time datetime="2026-03-05">Mar 5, 2026</time> Fern Studio: ${note}`))
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
 const door=await (await a.request('/api/vane/config/'+id,{headers:{origin:'https://fern.example'}})).text();assert.ok(!/198\.51|2001:db8|"CA"|excludeIps|excludeCountries/.test(door),'the public config door never shows the owner\'s exclusions')
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
 for(const phrase of ['Channel Organic Search: 10 → 6 visits (−4, −40%), of 28 → 24 visits in all.','Page /pricing: 10 → 6 pageviews (−4, −40%), of 28 → 24 pageviews in all.','Mar 11, 2026: Visit definition v2','Excluded paths: 0 → 1.','2.3 to 7.7: outside normal variation','2.5 to 8.2: within normal variation'])assert.ok(html.includes(phrase),phrase)
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
 for(const [day,kind,text] of [[earlier,'release','Release v2.1.0'],[today,'note','Pricing page redesign shipped'],[today,'settings','Settings approved (version 1 to 2).'],[earlier,'deploy','Deploy 42'],[today,'incident','Checkout down for 4 minutes']])assert.ok(html.includes(`<li data-annotation-day="${day}" data-annotation-kind="${kind}"><time datetime="${day}">${new Date(day+'T00:00:00Z').toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric',timeZone:'UTC'})}</time> ${text}`),kind)
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
 const html=unlinked(await (await a.request(`/app/sites/${id}?section=report`,owner)).text());assert.ok(html.includes(`<th scope="row">/slow</th><td class="vane-number">1</td><td class="vane-number" data-lcp="${pages['/slow'].lcp}">${(pages['/slow'].lcp/1000).toFixed(1)} s</td>`))
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
 for(const [filter,visits] of [['channel:is:Organic Search',5],['source:is:Google',5],['utm_medium:is:email',1],['device:is_not:desktop',5],['entry:is:/pricing',1],['page:contains:BLOG',2],['page:not_contains:blog',4],['page:matches:^/blog/[a-z]+$',1],['page:is:/blog/**',2],['goal:is:signup',2],['hostname:is:fern.example',6],['browser_version:matches:^Chrome ',1],['os_version:contains:ios',5]])assert.equal((await summary('filter='+encodeURIComponent(filter))).visits,visits,filter)
 assert.equal((await a.request(`/api/vane/summary?siteId=${id}&filter=${encodeURIComponent('page:matches:(')}`,owner)).status,400,'an invalid regular expression is refused')
 // A filtered report finds its kept visits once and deletes them when it returns.
 assert.deepEqual((await a.dump()).vane_report_kept,[],'no kept-visit rows outlive their report')
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
 assert.equal((await a.form({operation:'team.invite',email:'viewer@example.test',role:'viewer',scope:'all'},a.owner)).status,303);const viewer=await a.accept('viewer@example.test')
 assert.equal((await (await a.request(`/api/vane/summary?siteId=${id}&${range}&segment=${segment}`,{headers:{cookie:viewer}})).json()).visits,3)
 assert.equal((await a.form({operation:'segment.save',siteId:id,name:'Mine',filters:'channel:is:Email'},viewer)).status,403)
 assert.ok((await (await a.request('/api/vane/audit',owner)).json()).some(e=>e.action==='segment.save'&&e.detail.includes('Organic mobile')))
 assert.equal((await a.form({operation:'segment.delete',siteId:id,id:segment},a.owner)).status,303);assert.equal((await a.request(`/api/vane/summary?siteId=${id}&segment=${segment}`,owner)).status,404)
})
test('INSTALL-007 a TanStack React Router app and a hash-routed one each record four views with their paths and no duplicates, and manual pageviews replace automatic ones',async t=>{
 const a=await withApp(t),id=await a.addSite({paths:[]})
 const {build}=await import('esbuild'),bundle=(await build({entryPoints:[new URL('./fixtures/spa-router.jsx',import.meta.url).pathname],bundle:true,write:false,format:'iife',jsx:'automatic',minify:true,define:{'process.env.NODE_ENV':'"production"'},logLevel:'silent'})).outputFiles[0].text.replaceAll('</script','<\\/script')
 const app=(hashed,attrs='')=>`<!doctype html><title>Fern app</title><div id="app"></div><script>${hashed?'window.FIXTURE_HASH=true;':''}${bundle}</script><script src="${a.origin}/vane.js" data-site="${id}"${attrs}></script>`
 const manual=`<!doctype html><title>Fern manual</title><script>window.vane=window.vane||function(){(vane.q=vane.q||[]).push(arguments)};vane('pageview')</script><script src="${a.origin}/vane.js" data-site="${id}" data-manual></script>`
 const {context}=await browse(t,a,{'https://fern.example/':app(false),'https://fern.example/app/':app(true,' data-hash'),'https://fern.example/manual':manual})
 const paths=async()=>(await a.dump()).vane_events.filter(e=>e.kind==='pageview').map(e=>e.path).sort()
 const collected=tab=>tab.waitForResponse(r=>new URL(r.url()).pathname==='/api/vane/collect'&&r.status()===202)
 const tour=async(url,expected)=>{const tab=await context.newPage(),first=collected(tab);await tab.goto(url);await first
  for(const to of ['/pricing','/docs','/about']){const sent=collected(tab);await tab.getByRole('link',{name:'Go '+to,exact:true}).click();await tab.getByRole('heading',{name:'View '+to}).waitFor();await sent}
  // Clicking the current view again and replacing its history entry are not new pageviews.
  await tab.getByRole('link',{name:'Go /about',exact:true}).click();await tab.evaluate(()=>history.pushState({},'',location.href));await tab.waitForTimeout(500)
  assert.deepEqual(await paths(),expected);await tab.close()}
 await tour('https://fern.example/',['/','/about','/docs','/pricing'])
 await tour('https://fern.example/app/',['/','/about','/app/','/app/about','/app/docs','/app/pricing','/docs','/pricing'])
 // Manual mode: the queued call and vane('pageview', {url}) are recorded; History API navigation is not.
 const tab=await context.newPage(),first=collected(tab);await tab.goto('https://fern.example/manual');await first
 const second=collected(tab);await tab.evaluate(()=>{history.pushState({},'','/manual/step-1');vane('pageview',{url:'/manual/step-2?utm_source=newsletter'})});await second;await tab.waitForTimeout(500)
 const rows=(await a.dump()).vane_events.filter(e=>e.kind==='pageview'&&e.path.startsWith('/manual'));assert.deepEqual(rows.map(e=>[e.path,e.utm_source]).sort(),[['/manual',null],['/manual/step-2','newsletter']])
 const settings=await (await a.request(`/app/sites/${id}?section=settings`,{headers:{cookie:a.owner}})).text();assert.ok(settings.includes('data-spa-help')&&settings.includes('data-hash')&&settings.includes('data-manual'))
})
test('CONV-002 Signup with plan=pro and plan=free through vane() and CSS classes breaks down by plan, an email property is refused, manual and attribute pageview properties break down by author, and a funnel step and a filter on plan=pro count only the pro signups',async t=>{
 const a=await withApp(t),owner={headers:{cookie:a.owner}},id=await a.addSite({paths:[],funnels:'pro=/ > event:Signup[plan=pro]',publicReports:['totals','sources','campaigns','pages','goals','devices']})
 const script=(attrs='')=>`<script src="${a.origin}/vane.js" data-site="${id}"${attrs}></script>`
 const pages={'https://fern.example/':`<!doctype html><title>Fern</title><button class="vane-event-name=Signup vane-event-plan=free">Free plan</button><form class="vane-event-name=Signup vane-event-plan=pro" action="/" onsubmit="return false"><button>Pro plan</button></form>${script()}`,
  'https://fern.example/post':`<!doctype html><title>Post</title><script>window.vane=window.vane||function(){(vane.q=vane.q||[]).push(arguments)};vane('pageview',{props:{author:'jo'}})</script>${script(' data-manual')}`,
  'https://fern.example/essay':`<!doctype html><title>Essay</title>${script(' data-prop-author="sam"')}`}
 const open=async(n,url)=>{const {context}=await browse(t,a,pages,{extraHTTPHeaders:{'cf-connecting-ip':'203.0.113.'+n}}),tab=await context.newPage(),loaded=tab.waitForResponse(r=>new URL(r.url()).pathname==='/api/vane/collect'&&r.status()===202);await tab.goto(url);await loaded;return tab}
 const fired=async(tab,act)=>{const sent=tab.waitForResponse(r=>new URL(r.url()).pathname==='/api/vane/custom');await act();assert.equal((await sent).status(),202)}
 // Pro and free, each once through a CSS class (a form and a button) and once through vane().
 const one=await open(1,'https://fern.example/');await fired(one,()=>one.getByRole('button',{name:'Pro plan'}).click())
 const two=await open(2,'https://fern.example/');await fired(two,()=>two.evaluate(()=>vane('Signup',{props:{plan:'free'}})))
 const three=await open(3,'https://fern.example/');await fired(three,()=>three.getByRole('button',{name:'Free plan'}).click())
 const four=await open(4,'https://fern.example/');await fired(four,()=>four.evaluate(()=>vane('Signup',{props:{plan:'pro'}})))
 await open(5,'https://fern.example/post');await open(6,'https://fern.example/essay')
 // Through the public door: an email address refuses the event, a phone number is dropped and counted.
 const pageId=(await a.dump()).vane_events.find(e=>e.kind==='pageview'&&e.path==='/').id.split(':')[1],custom=body=>a.post('/api/vane/custom',{id:crypto.randomUUID(),siteId:id,page:pageId,consent:'not-required',...body},'',{origin:'https://fern.example'})
 assert.equal((await custom({name:'Signup',props:{plan:'pro',contact:'jo@example.com'}})).status,400);assert.equal((await custom({name:'jo@example.com'})).status,400)
 assert.equal((await custom({name:'Callback',props:{phone:'+1 (555) 123-4567'}})).status,202);assert.equal((await custom({name:'Signup',props:Object.fromEntries(Array.from({length:31},(_,i)=>['k'+i,'v']))})).status,400,'at most 30 properties')
 const day=(await a.dump()).vane_events[0].day,summary=async query=>(await a.request(`/api/vane/summary?siteId=${id}&from=${day}&to=${new Date(Date.parse(day)+86400000).toISOString().slice(0,10)}&${query}`,owner)).json(),all=await summary('')
 assert.deepEqual(all.customEvents.map(r=>[r.name,r.events,r.visitors]),[['Signup',4,4],['Callback',1,1]])
 assert.deepEqual(all.eventProps.map(r=>[r.name,r.key,r.value,r.events]),[['Signup','plan','free',2],['Signup','plan','pro',2]])
 assert.deepEqual(all.pageProps.map(r=>[r.key,r.value,r.pageviews]),[['author','jo',1],['author','sam',1]])
 assert.deepEqual(all.exclusions,[{reason:'dropped-property',count:1}]);assert.ok(!JSON.stringify(await a.dump()).includes('123-4567'),'the phone number is not stored')
 // The funnel step on Signup with plan=pro, and the DASH-007 filters, count only the pro signups.
 assert.deepEqual(all.funnels[0].steps.map(s=>s.visits),[4,2])
 for(const [filter,visits] of [['prop.plan:is:pro',2],['prop.plan:is_not:pro',4],['event:is:Signup',4],['prop.author:is:jo',1]])assert.equal((await summary('filter='+encodeURIComponent(filter))).visits,visits,filter)
 const html=unlinked(await (await a.request(`/app/sites/${id}?section=report&from=${day}&to=${new Date(Date.parse(day)+86400000).toISOString().slice(0,10)}`,owner)).text())
 for(const row of ['<th scope="row">Signup</th><td class="vane-number">4</td>','<th scope="row">Signup</th><td>plan</td><td>pro</td><td class="vane-number">2</td>','<th scope="row">author</th><td>jo</td><td class="vane-number">1</td>','Dropped properties'])assert.ok(html.includes(row),row)
 assert.ok((await (await a.request('/api/vane/inventory?siteId='+id,owner)).json()).fields.some(f=>f.table==='vane_event_props'))
 const published=await (await a.request(`/stats/${id}?from=${day}&to=${new Date(Date.parse(day)+86400000).toISOString().slice(0,10)}`)).text();assert.ok(published.includes('/essay')&&!/Signup|Callback|Event properties|Page properties/.test(published),'public stats show no custom event or property')
})
test('CONV-006 USD and CAD purchases returning from Stripe Checkout total in USD at the owner-entered rate with credit to the original source, revenue joins the chart, comparisons, channel rows and roll-ups, unconverted revenue is listed apart, and the public page shows revenue only once the owner adds the revenue report',async t=>{
 const a=await withApp(t),owner={headers:{cookie:a.owner}},id=await a.addSite({paths:[],goals:{purchase:'/thanks',signup:'/signup'},rates:'CAD 0.73 from 2026-03-01',publicReports:['totals','pages','devices']}),oak=await a.addSite({name:'Oak Books',origin:'https://oak.example',paths:[]})
 const agent='Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36'
 const google={source:undefined,campaign:undefined,referrer:'https://www.google.com/'},email={source:undefined,campaign:'spring',utm:{source:'newsletter',medium:'email'}},stripe={source:undefined,campaign:undefined,referrer:'https://checkout.stripe.com/c/pay/cs_test_a1'},inside={source:undefined,campaign:undefined}
 const load=async(n,at,first,path,site=id,origin='https://fern.example')=>{await a.clock(Date.parse(at));const event=a.event(site,{...first,path});assert.equal((await a.post('/api/vane/collect',event,'',{origin,'cf-connecting-ip':'203.0.113.'+n,'user-agent':agent})).status,202);return event.id}
 const pay=async(page,revenue,name='Purchase',site=id,origin='https://fern.example')=>{const r=await a.post('/api/vane/custom',{id:crypto.randomUUID(),siteId:site,page,name,revenue,consent:'not-required'},'',{origin});assert.equal(r.status,202,await r.clone().text())}
 // The day before: one USD 20 purchase, for the comparison.
 await pay(await load(9,'2026-03-09T12:00:00Z',google,'/thanks'),{amount:20,currency:'USD'})
 // A Google visitor returns from Stripe Checkout after the visit timeout (a new visit) and pays USD 100; a newsletter
 // visitor returns within the visit and pays CAD 50 (CAD 0.73 from 1 March: USD 36.50); a Google visitor signs up and
 // donates EUR 10, which no rate converts; a fourth visitor buys nothing.
 await load(1,'2026-03-10T10:00:00Z',google,'/pricing');await pay(await load(1,'2026-03-10T10:40:00Z',stripe,'/thanks'),{amount:100,currency:'USD'})
 await load(2,'2026-03-10T11:00:00Z',email,'/pricing');await pay(await load(2,'2026-03-10T11:05:00Z',stripe,'/thanks'),{amount:50,currency:'cad'})
 await load(3,'2026-03-10T12:00:00Z',google,'/');await pay(await load(3,'2026-03-10T12:02:00Z',inside,'/signup'),{amount:10,currency:'EUR'},'Donate')
 await load(4,'2026-03-10T13:00:00Z',google,'/')
 await pay(await load(5,'2026-03-10T14:00:00Z',google,'/',oak,'https://oak.example'),{amount:5,currency:'USD'},'Purchase',oak,'https://oak.example')
 for(const revenue of [{amount:-1,currency:'USD'},{amount:5,currency:'XYZ'},{amount:5},{amount:5,currency:'USD',note:'x'}])assert.equal((await a.post('/api/vane/custom',{id:crypto.randomUUID(),siteId:id,page:(await a.dump()).vane_events.find(e=>e.kind==='pageview').id.split(':')[1],name:'Purchase',revenue,consent:'not-required'},'',{origin:'https://fern.example'})).status,400,JSON.stringify(revenue))
 await a.clock(Date.parse('2026-03-10T20:00:00Z'))
 const summary=async query=>(await a.request(`/api/vane/summary?from=2026-03-10&to=2026-03-11&${query}`,owner)).json(),all=await summary('siteId='+id)
 assert.deepEqual([all.revenue.currency,all.revenue.total,all.revenue.orders,all.revenue.averageOrderValue,all.revenue.perVisitor,all.revenue.previous],['USD',136.5,2,68.25,34.13,20],'USD 100 + CAD 50 at 0.73; the compared day had USD 20')
 assert.deepEqual(all.revenue.unconverted,[{currency:'EUR',amount:10,orders:1}]);assert.deepEqual(all.revenue.rates.map(r=>[r.currency,r.rate,r.from]),[['CAD',0.73,'2026-03-01']])
 // Attribution: no Stripe source; the checkout returns keep Google and the newsletter.
 assert.ok(!JSON.stringify([all.sources,all.sourceVisits,all.referrers]).toLowerCase().includes('stripe'),'Stripe never takes credit')
 const pick=rows=>Object.fromEntries(rows.map(r=>[r.label??r.path,[r.visits,r.conversions,r.revenue]]))
 const purchase=await summary(`siteId=${id}&goal=purchase`),signup=await summary(`siteId=${id}&goal=signup`)
 assert.deepEqual(pick(purchase.channels),{'Organic Search':[4,1,100],Email:[1,1,36.5]});assert.deepEqual(pick(purchase.sourceVisits),{Google:[4,1,100],newsletter:[1,1,36.5]})
 assert.deepEqual(pick(signup.channels),{'Organic Search':[4,1,0],Email:[1,0,0]},'the signup visit carried only unconverted revenue');assert.deepEqual(pick(all.channels),{'Organic Search':[4,2,100],Email:[1,1,36.5]})
 assert.deepEqual([pick(purchase.entryPages)['/thanks'],pick(purchase.topPages)['/thanks'],purchase.devices.map(r=>[r.label,r.revenue,r.revenuePerVisitor])],[[1,1,100],[2,2,136.5],[['desktop',136.5,34.13]]])
 // DASH-002 and DASH-008: the revenue chart and its data table, with the compared day.
 const chart=await summary(`siteId=${id}&metric=revenue&interval=day`);assert.deepEqual([chart.series.map(b=>b.revenue),chart.previousSeries.map(b=>b.revenue)],[[136.5],[20]])
 const html=unlinked(await (await a.request(`/app/sites/${id}?section=report&from=2026-03-10&to=2026-03-11&goal=purchase&metric=revenue&interval=day`,owner)).text())
 for(const text of ['data-revenue>$136.50','+$116.50 against $20.00','data-aov>$68.25','data-rpv>$34.13','Exchange rates (owner-entered)','1 CAD = 0.73 USD from 2026-03-01','€10.00 from 1 event','<td class="vane-number" data-metric="revenue">$136.50</td>','<th scope="row">Organic Search</th>','<td class="vane-number">$100.00</td><td class="vane-number">$33.33</td>','href="/methodology#revenue"'])assert.ok(html.includes(text),text)
 // DASH-010: a roll-up adds revenue as an exact sum.
 const created=await a.form({operation:'rollup.create',name:'Fern and Oak',[`site_${id}`]:'on',[`site_${oak}`]:'on'},a.owner),rollupId=created.headers.get('location').match(/^\/app\/rollups\/([\w-]+)\?/)[1]
 assert.equal((await summary('rollupId='+rollupId)).revenue.total,(await summary('siteId='+id)).revenue.total+(await summary('siteId='+oak)).revenue.total);assert.equal((await summary('rollupId='+rollupId)).revenue.total,141.5)
 const methodology=await (await a.request('/methodology')).text()
 for(const rule of ['id="revenue"','an exchange rate the owner entered','never fetched','Stripe Checkout: checkout.stripe.com','adds revenue as an exact sum'])assert.ok(methodology.includes(rule),rule)
 // SHARE-002: revenue is public only once the owner adds the revenue report; the other reports' rows stay bare.
 const publicPage=async()=>(await a.request(`/stats/${id}?from=2026-03-10&to=2026-03-11`)).text()
 let shared=await publicPage();assert.ok(shared.includes('<h2>Top pages</h2>'));for(const text of ['Revenue','$136.50','CA$50.00','0.73'])assert.equal(shared.includes(text),false,`no revenue by default: ${text}`)
 const proposal=await (await a.post('/api/vane/commands',{command:'site.configure',input:{siteId:id,name:'Fern Studio',origin:'https://fern.example',paths:[],goals:{purchase:'/thanks',signup:'/signup'},consent:'not-required',sampleRate:100,retentionDays:90,rates:'CAD 0.73 from 2026-03-01',publicReports:['totals','pages','devices','revenue']}},a.owner)).json()
 assert.equal((await a.form({operation:'proposal.approve',id:proposal.id},a.owner)).status,303)
 shared=await publicPage()
 for(const text of ['data-revenue>$136.50','<li>$100.00 sent in USD by 1 event.</li>','<li>CA$50.00 sent in CAD by 1 event.</li>','<li>€10.00 sent in EUR by 1 event.</li>','Exchange rates (owner-entered)','1 CAD = 0.73 USD from 2026-03-01, entered by the owner; Vane never fetches a rate.','€10.00 from 1 event: no exchange rate for EUR is in effect','data-aov>$68.25'])assert.ok(shared.includes(text),text)
 assert.equal(shared.includes('Revenue per visitor</th>'),false,'page and device rows carry no revenue column')
})
test('CONV-007 a test purchase through the standard ecommerce events fills the ready-made ecommerce funnel and the product report with the product, quantity and revenue, and malformed or personal product lines are refused',async t=>{
 const a=await withApp(t),owner={headers:{cookie:a.owner}},id=await a.addSite({paths:[]})
 const page=title=>`<!doctype html><title>${title}</title><script src="${a.origin}/vane.js" data-site="${id}"></script>`,pages=Object.fromEntries(['product','cart','thanks'].map(p=>[`https://fern.example/${p}`,page(p)]))
 const {context}=await browse(t,a,pages),visit=async(tab,url)=>{const loaded=tab.waitForResponse(r=>new URL(r.url()).pathname==='/api/vane/collect'&&r.status()===202);await tab.goto(url);await loaded}
 const send=async(tab,name,items,currency='USD')=>{const sent=tab.waitForResponse(r=>new URL(r.url()).pathname==='/api/vane/custom');await tab.evaluate(([n,i,c])=>vane(n,{items:i,currency:c}),[name,items,currency]);assert.equal((await sent).status(),202,name)}
 const tee=(quantity=1)=>({sku:'TEE-1',name:'Fern tee',category:'Shirts',quantity,price:25}),mug={sku:'MUG-1',name:'Fern mug',category:'Kitchen',quantity:1,price:12.5}
 // One shopper buys two tees and a mug across three page loads of one visit.
 const one=await context.newPage();await visit(one,'https://fern.example/product');await send(one,'Product view',[tee()]);await send(one,'Add to cart',[tee(2)])
 await visit(one,'https://fern.example/cart');await send(one,'Add to cart',[mug]);await send(one,'Begin checkout',[tee(2),mug]);await visit(one,'https://fern.example/thanks');await send(one,'Purchase',[tee(2),mug])
 // A second shopper (another network) views and adds one tee, then stops.
 const {context:other}=await browse(t,a,pages,{extraHTTPHeaders:{'cf-connecting-ip':'198.51.100.7'}}),two=await other.newPage();await visit(two,'https://fern.example/product');await send(two,'Product view',[tee()]);await send(two,'Add to cart',[tee()])
 // Through the public door: a euro purchase keeps its own currency, rounded to its minor units; malformed or personal lines are refused.
 const pageId=(await a.dump()).vane_events.find(e=>e.kind==='pageview'&&e.path==='/thanks').id.split(':')[1],custom=body=>a.post('/api/vane/custom',{id:crypto.randomUUID(),siteId:id,page:pageId,consent:'not-required',...body},'',{origin:'https://fern.example'})
 assert.equal((await custom({name:'Purchase',items:[{...tee(),price:19.999}],currency:'eur'})).status,202)
 for(const [body,why] of [[{name:'Signup',items:[tee()],currency:'USD'},'only the standard events carry lines'],[{name:'Purchase',items:[{...tee(),name:'jo@example.com'}],currency:'USD'},'an email address refuses the event'],[{name:'Purchase',items:[tee(0)],currency:'USD'},'a quantity is at least 1'],[{name:'Purchase',items:[tee()],currency:'XYZ'},'an unknown currency'],[{name:'Purchase',items:[tee()]},'lines need a currency'],[{name:'Purchase',items:[{...tee(),email:'x'}],currency:'USD'},'only the declared line fields'],[{name:'Purchase',items:Array.from({length:51},tee),currency:'USD'},'at most 50 lines']])assert.equal((await custom(body)).status,400,why)
 assert.ok(!JSON.stringify(await a.dump()).includes('jo@example.com'),'the refused line is not stored')
 const day=(await a.dump()).vane_events[0].day,to=new Date(Date.parse(day)+86400000).toISOString().slice(0,10),summary=await (await a.request(`/api/vane/summary?siteId=${id}&from=${day}&to=${to}`,owner)).json()
 assert.deepEqual(summary.products.map(r=>[r.sku,r.currency,r.views,r.added,r.checkouts,r.purchased,r.revenue]),[['TEE-1','USD',2,3,2,2,50],['TEE-1','EUR',0,0,0,1,20],['MUG-1','USD',0,1,1,1,12.5]])
 const funnel=summary.funnels.find(f=>f.name==='Ecommerce');assert.deepEqual(funnel.steps.map(s=>[s.label,s.visits]),[['event:Product view',2],['event:Add to cart',2],['event:Begin checkout',1],['event:Purchase',1]])
 const html=unlinked(await (await a.request(`/app/sites/${id}?section=report&from=${day}&to=${to}`,owner)).text())
 for(const row of ['<th scope="row">Fern tee</th><td>TEE-1</td><td>Shirts</td><td class="vane-number">2</td>','$50.00','€20.00','$12.50','data-funnel="Ecommerce"','<th scope="row">4. event:Purchase</th><td class="vane-number">1</td>'])assert.ok(html.includes(row),row)
 assert.ok((await (await a.request('/api/vane/inventory?siteId='+id,owner)).json()).fields.some(f=>f.table==='vane_ecommerce_lines'))
})
test('EXPERIMENT-001 a seeded 20% lift reaches significance with the expected interval once powered, a null test never does, a skewed exposure split triggers the mismatch warning, and the script applies and reports its variant',async t=>{
 const a=await withApp(t),owner={headers:{cookie:a.owner}},id=await a.addSite({paths:[],goals:{signup:'/signup',demo:'/demo'},experiments:'lift = /pricing > signup : control, cheaper\nnull = /pricing > demo : a, b\nskew = /pricing > signup : left, right'})
 const agent='Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36'
 const visit=async(i,path)=>{const event=a.event(id,{path,source:undefined,campaign:undefined}),r=await a.post('/api/vane/collect',event,'',{origin:'https://fern.example','cf-connecting-ip':`198.18.${i>>8}.${i&255}`,'user-agent':agent});assert.equal(r.status,202);return {page:event.id,body:await r.json()}}
 const expose=async(page,experiment)=>{const r=await a.post('/api/vane/exposure',{page,siteId:id,experiment,consent:'not-required'},'',{origin:'https://fern.example'});assert.equal(r.status,202,await r.clone().text());return (await r.json()).variant}
 const tests=async()=>Object.fromEntries((await (await a.request(`/api/vane/summary?siteId=${id}&period=today`,owner)).json()).experiments.map(x=>[x.name,x]))
 // Control converts 7 in 10 visitors (70%), cheaper 21 in 25 (84%: a 20% lift); the null test's arms both convert 7 in 10.
 // Visitors arrive eight at a time; the skew test loses 60% of its right-hand exposures.
 const arms={lift:{control:[],cheaper:[]},null:{a:[],b:[]}};let right=0
 const one=async i=>{
  const {page,body}=await visit(i,'/pricing'),v=body.experiments
  assert.equal(await expose(page,'lift'),v.lift,'the exposure door recomputes the assigned variant');await expose(page,'null')
  if(v.skew==='left'||right++%10<4)await expose(page,'skew')
  const k=arms.lift[v.lift].push(i)-1,m=arms.null[v.null].push(i)-1
  if(v.lift==='control'?k%10<7:k%25<21)await visit(i,'/signup')
  if(m%10<7)await visit(i,'/demo')
 }
 for(let b=0;b<360;b+=8){await Promise.all(Array.from({length:8},(_,j)=>one(b+j)));if(b===88){const early=await tests();assert.ok(early.lift.underpowered&&early.lift.variants[1].verdict==='underpowered','no result is called while underpowered')}}
 const r=await tests(),[control,cheaper]=r.lift.variants,n=[arms.lift.control.length,arms.lift.cheaper.length],c=[Math.floor(n[0]/10)*7+Math.min(n[0]%10,7),Math.floor(n[1]/25)*21+Math.min(n[1]%25,21)]
 assert.deepEqual([control.visitors,control.conversions,cheaper.visitors,cheaper.conversions],[n[0],c[0],n[1],c[1]])
 const z=1.959964,pc=c[0]/n[0],pv=c[1]/n[1],d=pv-pc,se=Math.sqrt(pc*(1-pc)/n[0]+pv*(1-pv)/n[1]),round=x=>Math.round(x*1e4)/1e4
 assert.deepEqual(cheaper.differenceInterval,[round(d-z*se),round(d+z*se)],'the difference interval');assert.ok(cheaper.differenceInterval[0]>0&&cheaper.differenceInterval[0]<0.14&&cheaper.differenceInterval[1]>0.14,'the interval holds the seeded 14-point lift')
 const den=1+z*z/n[0],mid=(pc+z*z/(2*n[0]))/den,half=z*Math.sqrt(pc*(1-pc)/n[0]+z*z/(4*n[0]*n[0]))/den;assert.deepEqual(control.interval,[round(mid-half),round(mid+half)],'the control’s Wilson interval')
 assert.equal(r.lift.underpowered,false);assert.equal(cheaper.verdict,'beats control');assert.ok(cheaper.probabilityBeatsControl>0.99)
 assert.equal(r.null.underpowered,false);assert.equal(r.null.variants[1].verdict,'no difference','the null test never reaches significance')
 assert.equal(r.skew.sampleRatioMismatch,true);assert.ok(r.skew.sampleRatioP<0.01)
 const html=await (await a.request(`/app/sites/${id}?section=report&period=today`,owner)).text()
 for(const text of ['data-experiment="lift"','data-variant="cheaper" data-verdict="beats control"','data-variant="b" data-verdict="no difference"','data-srm'])assert.ok(html.includes(text),text)
 // The script: vane('experiment', ...) calls back with the page load's variant after its pageview, and reports the exposure.
 const {context}=await browse(t,a,{'https://fern.example/pricing':`<!doctype html><title>Pricing</title><script>window.vane=window.vane||function(){(vane.q=vane.q||[]).push(arguments)};vane('experiment','lift',v=>{document.body.dataset.variant=v})</script><script src="${a.origin}/vane.js" data-site="${id}"></script>`}),tab=await context.newPage()
 const exposed=tab.waitForResponse(r=>new URL(r.url()).pathname==='/api/vane/exposure');await tab.goto('https://fern.example/pricing');const response=await exposed
 assert.equal(response.status(),202);const page=JSON.parse(response.request().postData()).page,stored=(await a.dump()).vane_exposures.find(x=>x.page_id===id+':'+page&&x.experiment==='lift');assert.equal(await tab.evaluate(()=>document.body.dataset.variant),stored.variant,'the page shows the variant the server recorded')
 assert.equal((await a.post('/api/vane/exposure',{page:crypto.randomUUID(),siteId:id,experiment:'lift',consent:'not-required'},'',{origin:'https://fern.example'})).status,404)
 assert.equal((await a.post('/api/vane/exposure',{page:crypto.randomUUID(),siteId:id,experiment:'lift',variant:'cheaper',consent:'not-required'},'',{origin:'https://fern.example'})).status,400,'the variant is never taken from the request')
})
test('CONV-009 a click on #book-demo, a contact form, a visible pricing table and a docs pageview defined in the app, previewed against the live page and approved, arrive as custom events with no site code change',async t=>{
 const a=await withApp(t),owner={headers:{cookie:a.owner}},id=await a.addSite({paths:[]})
 const html=`<!doctype html><title>Fern</title><button id="book-demo" class="cta">Book a demo</button><form class="contact" action="/" onsubmit="return false"><button>Send</button></form><div style="height:3000px"></div><section id="pricing">Pricing</section><script src="${a.origin}/vane.js" data-site="${id}"></script>`
 a.fixtureSites['https://fern.example']=()=>new Response(html,{headers:{'content-type':'text/html'}})
 // Preview: the selector is run over the live page; nothing is stored, and only owners and administrators preview.
 const preview=await a.form({operation:'event.preview',siteId:id,selector:'#book-demo',path:'/'},a.owner),shown=await preview.text()
 assert.equal(preview.status,200);assert.ok(shown.includes('data-preview-total="1"')&&shown.includes('<code>&lt;button id="book-demo" class="cta"&gt;</code> Book a demo'),'the matched element is shown')
 assert.ok((await (await a.form({operation:'event.preview',siteId:id,selector:'.missing',path:'/'},a.owner)).text()).includes('data-preview-total="0"'))
 assert.equal((await a.form({operation:'event.preview',siteId:id,selector:'#x{}',path:'/'},a.owner)).status,400,'an invalid selector is refused')
 assert.equal((await a.form({operation:'team.invite',email:'viewer@example.test',role:'viewer',scope:'all'},a.owner)).status,303);assert.equal((await a.form({operation:'event.preview',siteId:id,selector:'#book-demo',path:'/'},await a.accept('viewer@example.test'))).status,403)
 // Defined in the settings and applied only once the owner approves (APPROVE-001).
 const input={siteId:id,name:'Fern Studio',origin:'https://fern.example',paths:[],goals:{},consent:'not-required',eventDefinitions:'Book demo = click #book-demo\nLead = submit form.contact\nPricing seen = visible #pricing\nDocs = pageview /docs/**'}
 assert.equal((await a.post('/api/vane/commands',{command:'site.configure',input:{...input,eventDefinitions:'Book demo = hover #book-demo'}},a.owner)).status,400)
 const proposed=await (await a.post('/api/vane/commands',{command:'site.configure',input},a.owner)).json(),config=async()=>(await a.request('/api/vane/config/'+id,{headers:{origin:'https://fern.example'}})).json()
 assert.deepEqual((await config()).eventDefinitions,[],'nothing is live before approval')
 assert.equal((await a.form({operation:'proposal.approve',id:proposed.id},a.owner)).status,303);assert.equal((await config()).eventDefinitions.length,4)
 // The live page, unchanged: each interaction arrives as its custom event.
 const {context}=await browse(t,a,{'https://fern.example/':html}),tab=await context.newPage(),names=[]
 tab.on('request',r=>{if(new URL(r.url()).pathname==='/api/vane/custom')names.push(JSON.parse(r.postData()).name)})
 const custom=()=>tab.waitForResponse(r=>new URL(r.url()).pathname==='/api/vane/custom'&&r.status()===202),loaded=tab.waitForResponse(r=>new URL(r.url()).pathname==='/api/vane/collect');await tab.goto('https://fern.example/');await loaded
 for(const act of [()=>tab.getByRole('button',{name:'Book a demo'}).click(),()=>tab.getByRole('button',{name:'Send'}).click(),()=>tab.locator('#pricing').scrollIntoViewIfNeeded(),()=>tab.evaluate(()=>history.pushState({},'','/docs/intro'))]){const sent=custom();await act();await sent}
 // The pushState to /docs/intro is a new pageview, so the still-visible pricing table counts once more for it.
 for(let i=0;i<50&&names.length<5;i++)await tab.waitForTimeout(100);await tab.waitForTimeout(300);assert.deepEqual(names,['Book demo','Lead','Pricing seen','Docs','Pricing seen'])
 const day=(await a.dump()).vane_events[0].day,summary=await (await a.request(`/api/vane/summary?siteId=${id}&from=${day}&to=${new Date(Date.parse(day)+86400000).toISOString().slice(0,10)}`,owner)).json()
 assert.deepEqual(summary.customEvents.map(r=>[r.name,r.events]).sort(),[['Book demo',1],['Docs',1],['Lead',1],['Pricing seen',2]])
 assert.ok((await (await a.request(`/app/sites/${id}?section=settings`,owner)).text()).includes('Book demo = click #book-demo'))
})
test('TEAM-001 an analyst invited to one site and a viewer invited to two act only within their role and sites at every door, removal ends access at once, and ownership moves only on the owner\'s confirmation',async t=>{
 const a=await withApp(t),owner={headers:{cookie:a.owner}}
 const A=await a.addSite(),B=await a.addSite({name:'Oak Store',origin:'https://oak.example'}),C=await a.addSite({name:'Elm Clinic',origin:'https://elm.example'})
 a.fixtureSites['https://fern.example']=()=>new Response('<button id="book-demo">Book a demo</button>',{headers:{'content-type':'text/html'}})
 // The owner invites by email with a role and chosen sites; Base sends the invitation and the person accepts it.
 const join=async(email,role,sites)=>{const r=await a.form({operation:'team.invite',email,role,scope:sites?'chosen':'all',...Object.fromEntries((sites??[]).map(id=>['site_'+id,'on']))},a.owner);assert.equal(r.status,303,await r.clone().text());return a.accept(email)}
 const analyst=await join('analyst@example.test','analyst',[A]),viewer=await join('viewer@example.test','viewer',[A,B]),admin=await join('admin@example.test','admin')
 const team=await (await a.request('/app?section=team',owner)).text()
 assert.match(team,/data-person="analyst@example.test">[\s\S]*?>analyst<\/span>[\s\S]*?<td>Fern Studio<\/td>/);assert.match(team,/data-person="viewer@example.test">[\s\S]*?>viewer<\/span>[\s\S]*?<td>Fern Studio, Oak Store<\/td>/)
 // Objects on every site for the delete and revoke doors.
 const shared=await a.form({operation:'share.create',siteId:A,label:'Board',share_totals:'on'},a.owner);assert.equal(shared.status,200)
 const shareId=(await a.dump()).vane_share_links[0].id
 assert.equal((await a.form({operation:'segment.save',siteId:C,name:'Email',filters:'channel:is:Email'},a.owner)).status,303)
 assert.equal((await a.form({operation:'annotation.add',siteId:C,day:new Date().toISOString().slice(0,10),text:'Owner note'},a.owner)).status,303)
 const state0=await a.dump(),segmentC=state0.vane_segments[0].id,noteC=state0.vane_annotations[0].id
 const pending=await (await a.post('/api/vane/commands',{command:'site.configure',input:{siteId:B,name:'Oak Store',origin:'https://oak.example',paths:['/'],goals:{},consent:'required'}},a.owner)).json()
 const rollAll=await a.form({operation:'rollup.create',name:'Every site',[`site_${A}`]:'on',[`site_${B}`]:'on',[`site_${C}`]:'on'},a.owner),rollTwo=await a.form({operation:'rollup.create',name:'Two sites',[`site_${A}`]:'on',[`site_${B}`]:'on'},a.owner)
 const rollAllId=rollAll.headers.get('location').match(/rollups\/([\w-]+)/)[1],rollTwoId=rollTwo.headers.get('location').match(/rollups\/([\w-]+)/)[1]
 const operators=await (await a.request('/auth/operators',owner)).json(),list=Array.isArray(operators)?operators:operators.operators,id=email=>list.find(p=>p.email===email).id
 // Reads: each person sees only their sites in every list and read door; every other site's door answers 403.
 const sitesOf=async cookie=>(await (await a.request('/api/vane/sites',{headers:{cookie}})).json()).map(s=>s.id).sort()
 assert.deepEqual(await sitesOf(analyst),[A]);assert.deepEqual(await sitesOf(viewer),[A,B].sort())
 const reads=site=>[`/api/vane/summary?siteId=${site}`,`/api/vane/realtime?siteId=${site}`,`/api/vane/inventory?siteId=${site}`,`/app/sites/${site}`,`/app/sites/${site}?section=settings`]
 for(const [cookie,open,closed] of [[analyst,[A],[B,C]],[viewer,[A,B],[C]]]) {
  for(const site of open)for(const path of reads(site))assert.equal((await a.request(path,{headers:{cookie}})).status,200,path)
  for(const site of closed)for(const path of [...reads(site),`/api/vane/import-journal?siteId=${site}&jobId=x`])assert.equal((await a.request(path,{headers:{cookie}})).status,403,path)
  const home=await (await a.request('/app',{headers:{cookie}})).text();assert.ok(!home.includes('Elm Clinic'),'out-of-scope sites are not listed')
  for(const path of ['/api/vane/audit','/api/vane/proposals','/api/vane/export',`/api/vane/export?siteId=${open[0]}`,'/app?section=team','/app?section=audit',`/app/rollups/${rollAllId}`,`/api/vane/summary?rollupId=${rollAllId}`])assert.equal((await a.request(path,{headers:{cookie}})).status,403,path)
 }
 assert.equal((await a.request(`/app/rollups/${rollTwoId}`,{headers:{cookie:viewer}})).status,200)
 // Writes: every out-of-role or out-of-scope call through its public door is refused with no write.
 const writable=dump=>Object.fromEntries(Object.entries(dump).filter(([name])=>name.startsWith('vane_')||name==='oa_operators'))
 const archive=JSON.stringify({payload:{format:'vane-history/1',tables:{}},sha256:'0'})
 const forms=site=>[
  {operation:'site.prepare',name:'New',origin:'https://new.example',paths:'/',consent:'required',sampleRate:'100'},{operation:'config.prepare',siteId:site,name:'X',origin:'https://x.example',paths:'/',consent:'required'},
  {operation:'site.delete.prepare',siteId:site},{operation:'history.erase.prepare',siteId:site},{operation:'site.import',archive},{operation:'proposal.approve',id:pending.id},{operation:'proposal.reject',id:pending.id},
  {operation:'history.restore',archive},{operation:'import.preview',siteId:site,document:JSON.stringify(fixture)},{operation:'import.apply',siteId:site,document:JSON.stringify(fixture),fingerprint:'x'},{operation:'import.undo',siteId:site,jobId:'x'},
  {operation:'install.verify',siteId:site},{operation:'history.retention',siteId:site},{operation:'annotation-hook.create',siteId:site},{operation:'annotation-hook.revoke',siteId:site},{operation:'annotation-github.create',siteId:site},{operation:'annotation-github.revoke',siteId:site},
  {operation:'share.create',siteId:site,label:'Mine',share_totals:'on'},{operation:'share.revoke',id:shareId},{operation:'segment.delete',id:segmentC},{operation:'annotation.delete',id:noteC},
  {operation:'rollup.create',name:'Mine',[`site_${A}`]:'on',[`site_${B}`]:'on'},{operation:'team.invite',email:'new@example.test',role:'viewer',scope:'chosen',[`site_${A}`]:'on'},{operation:'team.grant',operatorId:id('viewer@example.test'),role:'analyst',scope:'chosen',[`site_${A}`]:'on'},
  {operation:'team.remove',operatorId:id('viewer@example.test')},{operation:'team.transfer',operatorId:id('admin@example.test'),confirm:'admin@example.test'}]
 const apis=site=>[['/api/vane/commands',{command:'site.create',input:{name:'New',origin:'https://new.example',paths:['/'],goals:{},consent:'required'}}],['/api/vane/commands',{command:'history.erase',input:{siteId:site}}],['/api/vane/commands',{command:'site.delete',input:{siteId:site}}],
  ['/api/vane/import-preview',{siteId:site,document:fixture}],['/api/vane/import-apply',{siteId:site,document:fixture,fingerprint:'x'}],['/api/vane/import-undo',{siteId:site,jobId:'x'}],['/api/vane/install-check',{siteId:site}],['/api/vane/site-import',{archive:JSON.parse(archive)}],['/api/vane/restore',{archive:JSON.parse(archive)}]]
 const scoped=site=>[{operation:'segment.save',siteId:site,name:'Mine',filters:'channel:is:Email'},{operation:'event.preview',siteId:site,selector:'#book-demo',path:'/'},{operation:'annotation.add',siteId:site,day:new Date().toISOString().slice(0,10),text:'Out of scope'},{operation:'config.prepare',siteId:site,eventDefinitions:'book-demo = click #book-demo'}]
 const before=writable(await a.dump())
 for(const [who,cookie,inSite,outSite] of [['analyst',analyst,A,C],['viewer',viewer,B,C]]) {
  for(const body of [...forms(inSite).filter(b=>who==='viewer'||b.operation!=='config.prepare'),...forms(outSite),...scoped(outSite),...(who==='viewer'?scoped(inSite).filter(b=>b.operation!=='annotation.add'):[])])assert.equal((await a.form(body,cookie)).status,403,`${who} ${body.operation} ${body.siteId===outSite?'out of scope':'out of role'}`)
  for(const [path,body] of [...apis(inSite),...apis(outSite),['/api/vane/commands',{command:'site.configure',input:{siteId:outSite,goals:{}}}]])assert.equal((await a.post(path,body,cookie)).status,403,`${who} ${path} ${body.command??''}`)
  if(who==='viewer')assert.equal((await a.post('/api/vane/commands',{command:'site.configure',input:{siteId:inSite,goals:{}}},cookie)).status,403)
 }
 assert.deepEqual(writable(await a.dump()),before,'no refused call wrote anything')
 // In role: the analyst saves a segment (DASH-007), previews and prepares a no-code event (CONV-009) and adds a note; the viewer adds a note (DASH-009).
 assert.equal((await a.form({operation:'segment.save',siteId:A,name:'Email visits',filters:'channel:is:Email'},analyst)).status,303)
 assert.equal((await a.form({operation:'event.preview',siteId:A,selector:'#book-demo',path:'/'},analyst)).status,200)
 assert.equal((await a.form({operation:'config.prepare',siteId:A,name:'Renamed',origin:'https://evil.example',consent:'required',goals:'signup=/thanks',eventDefinitions:'book-demo = click #book-demo'},analyst)).status,303)
 for(const cookie of [analyst,viewer])assert.equal((await a.form({operation:'annotation.add',siteId:A,day:new Date().toISOString().slice(0,10),text:'Team note'},cookie)).status,303)
 // The analyst's proposal carries only the event definition; the site's name, origin and consent stay as they are until the owner approves.
 const proposal=(await (await a.request('/api/vane/proposals',owner)).json()).find(p=>p.prepared_by===id('analyst@example.test')),payload=JSON.parse(proposal.payload_json),current=(await (await a.request('/api/vane/sites',owner)).json()).find(s=>s.id===A)
 assert.equal(payload.name,'Fern Studio');assert.equal(payload.origin,'https://fern.example');assert.equal(payload.config.consent,current.config.consent);assert.deepEqual(payload.config.eventDefinitions,[{name:'book-demo',kind:'click',target:'#book-demo'}])
 assert.equal((await a.form({operation:'proposal.approve',id:proposal.id},a.owner)).status,303)
 // A change of sites applies at once; removal ends the person's sessions at once.
 assert.equal((await a.form({operation:'team.grant',operatorId:id('viewer@example.test'),role:'viewer',scope:'chosen',[`site_${B}`]:'on'},a.owner)).status,303)
 assert.equal((await a.request(`/api/vane/summary?siteId=${A}`,{headers:{cookie:viewer}})).status,403)
 assert.equal((await a.form({operation:'team.remove',operatorId:id('viewer@example.test')},a.owner)).status,303)
 assert.equal((await a.request('/api/vane/sites',{headers:{cookie:viewer}})).status,401)
 // Ownership moves only with the current owner's typed confirmation: the admin cannot take it, and a wrong confirmation changes nothing.
 assert.equal((await a.form({operation:'team.transfer',operatorId:id('admin@example.test'),confirm:'admin@example.test'},admin)).status,403)
 assert.equal((await a.form({operation:'team.transfer',operatorId:id('admin@example.test'),confirm:'someone@example.test'},a.owner)).status,400)
 const roles=async()=>Object.fromEntries((await a.dump()).oa_operators.map(p=>[p.email,p.role]))
 assert.equal((await roles())['admin@example.test'],'admin')
 // Base asks the owner for a fresh emailed proof first; once the owner follows it in this session, the transfer applies.
 assert.equal((await a.form({operation:'team.transfer',operatorId:id('admin@example.test'),confirm:'Admin@example.test'},a.owner)).status,403)
 assert.equal((await roles())['owner@example.test'],'owner')
 assert.equal((await a.post('/auth/step-up',{action:'owner:transfer',returnTo:'/app?section=team'},a.owner)).status,202)
 const proof=a.sentMail.findLast(m=>JSON.stringify(m.to).includes('owner@example.test')).html.match(/href="([^"]*\/auth\/confirm\?token=[^"]+)"/)[1]
 assert.equal((await a.post('/auth/confirm',{token:new URL(proof.replaceAll('&amp;','&'),a.origin).searchParams.get('token')},a.owner)).status,303)
 assert.equal((await a.form({operation:'team.transfer',operatorId:id('admin@example.test'),confirm:'Admin@example.test'},a.owner)).status,303)
 const after=await roles();assert.equal(after['admin@example.test'],'owner');assert.equal(after['owner@example.test'],'admin')
 assert.ok((await a.dump()).vane_audit.some(e=>e.action==='team.transfer'&&e.subject===id('admin@example.test')))
})
test('API-001 a site-scoped Stats API key answers visitors by channel with a filter, a saved segment and a comparison equal to the dashboard, refuses another site, a revoked key and a burst over the published limit, the Plausible v2 route returns the same figures, and a provisioning key creates a site, a goal and a shared link that appear in the app',async t=>{
 const a=await withApp(t),owner={headers:{cookie:a.owner}},id=await a.addSite({paths:[],goals:{signup:'/thanks'}}),other=await a.addSite({name:'Oak Store',origin:'https://oak.example'})
 const desktop='Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36',iphone='Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1'
 const start=Date.parse('2026-03-10T10:00:00Z'),google={referrer:'https://www.google.com/'},email={campaign:'spring',utm:{source:'newsletter',medium:'email'}}
 const visit=async(at,n,agent,first,paths)=>{for(const [i,path] of paths.entries()){await a.clock(at+n*600000+i*60000);assert.equal((await a.post('/api/vane/collect',a.event(id,{source:undefined,campaign:undefined,...(i?{}:first),path}),'',{origin:'https://fern.example','cf-connecting-ip':'203.0.113.'+n,'user-agent':agent})).status,202)}}
 // The compared day before, then this day: Organic Search and Email, on desktop and phones, some reaching /pricing.
 await visit(start-86400000,1,desktop,google,['/','/pricing']);await visit(start-86400000,2,desktop,email,['/'])
 for(const [n,agent,first,paths] of [[1,desktop,google,['/','/pricing']],[2,desktop,google,['/pricing','/thanks']],[3,desktop,email,['/','/pricing']],[4,iphone,google,['/pricing']],[5,desktop,email,['/']],[6,desktop,{},['/pricing']]])await visit(start,n,agent,first,paths)
 assert.equal((await a.form({operation:'segment.save',siteId:id,name:'Pricing',filters:'page:is:/pricing'},a.owner)).status,303)
 const segment=(await a.dump()).vane_segments[0].id
 // The owner creates a read-only key for one site; it is shown once and only its SHA-256 is kept.
 const created=await (await a.form({operation:'apikey.create',kind:'stats',label:'Reporting',[`site_${id}`]:'on'},a.owner)).text(),key=created.match(/data-api-key>(vane_k_[0-9a-f]{64})</)[1]
 assert.ok(!(await (await a.request('/app?section=api',owner)).text()).includes(key),'shown once');assert.ok(!JSON.stringify(await a.dump()).includes(key),'only the hash is kept')
 const bearer=token=>({headers:{authorization:'Bearer '+token}}),v1=(query,token=key)=>a.request('/api/v1/stats?'+query,bearer(token))
 const query=`from=2026-03-10&to=2026-03-11&compare=previous&filter=device:is:desktop&segment=${segment}`
 const dashboard=await (await a.request(`/api/vane/summary?siteId=${id}&${query}`,owner)).json()
 const answer=await v1(`site_id=${id}&${query}&dimension=channel&metrics=visitors,visits,pageviews,bounce_rate`);assert.equal(answer.status,200,await answer.clone().text());const stats=await answer.json()
 assert.deepEqual(stats.results,{visitors:dashboard.visitors,visits:dashboard.visits,pageviews:dashboard.pageviews,bounce_rate:dashboard.bounceRate});assert.equal(stats.results.visits,4,'desktop visits that reached /pricing: 1, 2, 3 and 6')
 assert.deepEqual(stats.previous,{visitors:dashboard.previousVisitors,visits:dashboard.previousVisits,pageviews:dashboard.previousPageviews,bounce_rate:dashboard.previousBounceRate});assert.equal(stats.previous.visits,1)
 assert.deepEqual(stats.breakdown.map(r=>[r.value,r.visitors,r.visits,r.previous]),dashboard.channels.map(r=>[r.label,r.visitors,r.visits,r.previous]))
 assert.deepEqual(Object.fromEntries(stats.breakdown.filter(r=>r.visits).map(r=>[r.value,r.visits])),{'Organic Search':2,Email:1,Direct:1})
 // The Plausible v2-compatible route answers a Plausible query with the same figures (date_range is inclusive, as Plausible's).
 const plausible=body=>a.request('/api/v2/query',{method:'POST',headers:{authorization:'Bearer '+key,'content-type':'application/json'},body:JSON.stringify(body)})
 const fixture={site_id:'fern.example',metrics:['visitors','visits','pageviews','bounce_rate'],date_range:['2026-03-10','2026-03-10'],filters:[['is','visit:device',['Desktop']]],include:{comparisons:{mode:'previous_period'}}}
 const plain=await (await a.request(`/api/vane/summary?siteId=${id}&from=2026-03-10&to=2026-03-11&compare=previous&filter=device:is:Desktop`,owner)).json()
 const totals=await (await plausible(fixture)).json();assert.deepEqual(totals.results[0].metrics,[plain.visitors,plain.visits,plain.pageviews,plain.bounceRate]);assert.deepEqual(totals.results[0].comparison.metrics,[plain.previousVisitors,plain.previousVisits,plain.previousPageviews,plain.previousBounceRate])
 assert.deepEqual(totals.query.date_range,['2026-03-10','2026-03-10'])
 const byChannel=await (await plausible({...fixture,dimensions:['visit:channel'],include:undefined})).json();assert.deepEqual(byChannel.results.map(r=>[r.dimensions[0],r.metrics[0],r.metrics[1]]),plain.channels.map(r=>[r.label,r.visitors,r.visits]))
 // Another site, an unknown or revoked key, a stats key at the Sites API and a burst over the published limit are each refused.
 assert.equal((await v1(`site_id=${other}&period=7d`)).status,403);assert.equal((await plausible({...fixture,site_id:'oak.example'})).status,403)
 assert.equal((await v1(`site_id=${id}&period=7d`,'vane_k_'+'0'.repeat(64))).status,401);assert.equal((await a.request(`/api/v1/stats?site_id=${id}`)).status,401)
 assert.equal((await a.request('/api/v1/sites',{method:'POST',headers:{authorization:'Bearer '+key,'content-type':'application/json'},body:'{}'})).status,403)
 const openapi=await (await a.request('/api/v1/openapi.json')).json();assert.ok(openapi.paths['/api/v1/stats']&&openapi.paths['/api/v2/query']&&openapi.paths['/api/v1/sites']);const limit=openapi['x-rate-limits'].burst
 await a.clock(Math.ceil(Date.now()/(limit.seconds*1000))*limit.seconds*1000+limit.seconds*1000)
 const burst=[];for(let i=0;i<=limit.requests;i++)burst.push((await v1(`site_id=${id}&period=today&metrics=visitors`)));
 assert.ok(burst.slice(0,limit.requests).every(r=>r.status===200),'within the limit');assert.equal(burst.at(-1).status,429);assert.ok(Number(burst.at(-1).headers.get('retry-after'))>0)
 const keyId=(await a.dump()).vane_api_keys[0].id;assert.equal((await a.form({operation:'apikey.revoke',id:keyId},a.owner)).status,303)
 await a.clock(Date.now()+3600000);assert.equal((await v1(`site_id=${id}&period=7d`)).status,401,'revoked at once')
 // Only the owner creates a provisioning key; it creates a site, a goal and a shared link that appear in the app.
 const admin=await a.invite('admin@example.test','admin');assert.equal((await a.form({operation:'apikey.create',kind:'provisioning',label:'Agency'},admin)).status,403)
 const provisioning=(await (await a.form({operation:'apikey.create',kind:'provisioning',label:'Agency'},a.owner)).text()).match(/data-api-key>(vane_p_[0-9a-f]{64})</)[1]
 const provision=(path,body)=>a.request(path,{method:'POST',headers:{authorization:'Bearer '+provisioning,'content-type':'application/json'},body:JSON.stringify(body)})
 const made=await provision('/api/v1/sites',{name:'Birch Bakery',origin:'https://birch.example',paths:[],goals:{},consent:'not-required'});assert.equal(made.status,201,await made.clone().text());const birch=(await made.json()).site_id
 assert.equal((await provision(`/api/v1/sites/${birch}/goals`,{name:'order',path:'/order/thanks'})).status,201)
 const link=await provision(`/api/v1/sites/${birch}/shared-links`,{label:'Client view',reports:['totals']});assert.equal(link.status,201);const url=new URL((await link.json()).url)
 assert.equal((await a.request(url.pathname)).status,200)
 assert.match(await (await a.request('/app?section=api',owner)).text(),/Reporting<\/td>[\s\S]*?<td class="vane-number">\d+<\/td>/,'each key shows its requests today')
 const settings=await (await a.request(`/app/sites/${birch}?section=settings`,owner)).text();assert.ok(settings.includes('Birch Bakery')&&settings.includes('order=/order/thanks'))
 assert.ok((await a.dump()).vane_audit.some(e=>e.detail.includes('via key:Agency')))
 assert.equal((await provision('/api/v1/sites',{name:'Bad',origin:'not an origin'})).status,400)
})
test('API-002 every table of a filtered, compared report downloads as CSV with the dashboard\'s figures, for a site the person may open',async t=>{
 const a=await withApp(t),owner={headers:{cookie:a.owner}},id=await a.addSite({paths:[],goals:{signup:'/thanks'}}),other=await a.addSite({name:'Oak Store',origin:'https://oak.example'})
 const start=Date.parse('2026-03-10T10:00:00Z')
 for(const [n,first,paths] of [[1,{referrer:'https://www.google.com/'},['/','/thanks']],[2,{campaign:'spring',utm:{source:'newsletter',medium:'email'}},['/pricing']],[3,{referrer:'https://www.google.com/'},['/','/pricing']]])for(const [i,path] of paths.entries()){await a.clock(start+n*600000+i*60000);assert.equal((await a.post('/api/vane/collect',a.event(id,{source:undefined,campaign:undefined,...(i?{}:first),path}),'',{origin:'https://fern.example','cf-connecting-ip':'203.0.113.'+n,'user-agent':'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36'})).status,202)}
 const query='from=2026-03-10&to=2026-03-11&compare=previous&filter=page:contains:pricing'
 const dashboard=await (await a.request(`/api/vane/summary?siteId=${id}&${query}`,owner)).json()
 const html=await (await a.request(`/app/sites/${id}?section=report&${query}`,owner)).text()
 const links=[...html.matchAll(/href="([^"]+)" data-csv="(\w+)"/g)].map(m=>[m[2],m[1].replaceAll('&amp;','&')])
 for(const table of ['channels','topPages','entryPages','sources','series'])assert.ok(links.some(([name])=>name===table),table)
 const parse=text=>{const [head,...rows]=text.trim().split('\r\n');const columns=head.split(',');return rows.map(r=>Object.fromEntries(r.split(',').map((v,i)=>[columns[i],v])))}
 for(const [table,href] of links) {
  const r=await a.request(href,owner);assert.equal(r.status,200,table);assert.match(r.headers.get('content-type'),/^text\/csv/);assert.match(r.headers.get('content-disposition'),new RegExp(`attachment; filename="vane-${id}-${table}-2026-03-10-2026-03-11.csv"`))
  const rows=parse(await r.text());assert.equal(rows.length,dashboard[table].length,table)
  for(const [i,row] of rows.entries())for(const [column,value] of Object.entries(row))if(['number','string'].includes(typeof dashboard[table][i][column])&&!/[",\r\n]/.test(String(dashboard[table][i][column])))assert.equal(value,String(dashboard[table][i][column]).replace(/^([=+\-@])/,"'$1"),`${table}.${column}`)
 }
 const channels=parse(await (await a.request(links.find(([name])=>name==='channels')[1],owner)).text());assert.deepEqual(Object.fromEntries(channels.filter(r=>r.visits!=='0').map(r=>[r.label,r.visits])),{'Organic Search':'1',Email:'1'})
 // A viewer of another site gets 403, and a table the report does not have 404.
 assert.equal((await a.form({operation:'team.invite',email:'viewer@example.test',role:'viewer',scope:'chosen',[`site_${other}`]:'on'},a.owner)).status,303);const viewer=await a.accept('viewer@example.test')
 assert.equal((await a.request(links[0][1],{headers:{cookie:viewer}})).status,403);assert.equal((await a.request(`/api/vane/csv?siteId=${id}&table=nope`,owner)).status,404)
})
// A stored ZIP's entries by name, each checked against its CRC-32.
function unzip(bytes){const b=Buffer.from(bytes),end=b.lastIndexOf(Buffer.from([0x50,0x4b,5,6])),files={};let at=b.readUInt32LE(end+16)
 for(let i=0;i<b.readUInt16LE(end+10);i++){const size=b.readUInt32LE(at+20),length=b.readUInt16LE(at+28),name=b.toString('utf8',at+46,at+46+length),offset=b.readUInt32LE(at+42),start=offset+30+b.readUInt16LE(offset+26)+b.readUInt16LE(offset+28),data=b.subarray(start,start+size);assert.equal(crc32(data),b.readUInt32LE(at+16),name);files[name]=data.toString('utf8');at+=46+length+b.readUInt16LE(at+30)+b.readUInt16LE(at+32)}
 return files}
const csvRows=text=>{const [head,...rows]=text.trim().split('\r\n');const columns=head.split(',');return Object.assign(rows.map(r=>Object.fromEntries(r.split(',').map((v,i)=>[columns[i],v]))),{columns})}
const sumBy=(rows,key,field)=>rows.reduce((m,r)=>({...m,[r[key]]:(m[r[key]]??0)+Number(r[field])}),{})
test('API-002 a whole-site ZIP in Plausible\'s layout, the Looker Studio connector and a scheduled R2 export each match the dashboard and the declared schema; only the owner sets the export, with a sealed key, a public https endpoint and every run audited',async t=>{
 const a=await withApp(t),owner={headers:{cookie:a.owner}},id=await a.addSite({paths:[],goals:{signup:'/thanks'}}),other=await a.addSite({name:'Oak Store',origin:'https://oak.example'})
 const desktop='Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36',iphone='Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1'
 const google={referrer:'https://www.google.com/'},email={campaign:'spring',utm:{source:'newsletter',medium:'email'}}
 const visit=async(at,n,agent,first,paths)=>{for(const [i,path] of paths.entries()){await a.clock(at+n*600000+i*60000);assert.equal((await a.post('/api/vane/collect',a.event(id,{source:undefined,campaign:undefined,...(i?{}:first),path}),'',{origin:'https://fern.example','cf-connecting-ip':'203.0.113.'+n,'user-agent':agent})).status,202)}}
 const day1=Date.parse('2026-03-09T10:00:00Z'),day2=Date.parse('2026-03-10T10:00:00Z')
 for(const [n,agent,first,paths] of [[1,desktop,google,['/','/pricing']],[2,iphone,email,['/']]])await visit(day1,n,agent,first,paths)
 for(const [n,agent,first,paths] of [[1,desktop,google,['/','/pricing']],[2,desktop,google,['/pricing','/thanks']],[3,desktop,email,['/','/pricing']],[4,iphone,google,['/pricing']],[5,desktop,email,['/']],[6,desktop,{},['/pricing']]])await visit(day2,n,agent,first,paths)
 const summary=async query=>(await a.request(`/api/vane/summary?siteId=${id}&${query}`,owner)).json()
 const both=await summary('from=2026-03-09&to=2026-03-11'),tenth=await summary('from=2026-03-10&to=2026-03-11')
 // The site ZIP: Plausible's file names and columns, every date, and sums equal to the dashboard's.
 const html=await (await a.request(`/app/sites/${id}?section=report`,owner)).text(),href=html.match(/href="([^"]+)" data-site-zip/)[1].replaceAll('&amp;','&')
 const zipped=await a.request(href,owner);assert.equal(zipped.status,200);assert.equal(zipped.headers.get('content-type'),'application/zip');assert.match(zipped.headers.get('content-disposition'),new RegExp(`attachment; filename="vane-${id}_20260309_20260310.zip"`))
 const files=unzip(await zipped.arrayBuffer()),file=name=>csvRows(files[`imported_${name}_20260309_20260310.csv`])
 assert.deepEqual(Object.keys(files).sort(),['browsers','custom_events','devices','entry_pages','exit_pages','operating_systems','pages','sources','visitors'].map(name=>`imported_${name}_20260309_20260310.csv`))
 const visitors=file('visitors');assert.deepEqual(visitors.columns,['date','visitors','pageviews','bounces','visits','visit_duration']);assert.deepEqual(visitors.map(r=>r.date),['2026-03-09','2026-03-10'])
 const total=field=>visitors.reduce((n,r)=>n+Number(r[field]),0)
 assert.deepEqual([total('visitors'),total('visits'),total('pageviews'),Math.round(total('bounces')/total('visits')*1000)/10],[both.visitors,both.visits,both.pageviews,both.bounceRate])
 const row10=visitors.find(r=>r.date==='2026-03-10');assert.deepEqual([+row10.visitors,+row10.visits,+row10.pageviews],[tenth.visitors,tenth.visits,tenth.pageviews])
 const sources=file('sources');assert.deepEqual(sources.columns,['date','source','referrer','utm_source','utm_medium','utm_campaign','utm_content','utm_term','pageviews','visitors','visits','visit_duration','bounces'])
 assert.deepEqual(Object.fromEntries(Object.entries(sumBy(sources,'source','visits')).map(([k,v])=>[k||'direct',v])),Object.fromEntries(both.sourceVisits.map(r=>[r.label,r.visits])))
 assert.deepEqual(sumBy(file('devices'),'device','visits'),Object.fromEntries(both.deviceVisits.map(r=>[r.label,r.visits])))
 assert.deepEqual(sumBy(file('entry_pages'),'entry_page','entrances'),Object.fromEntries(both.entryPages.map(r=>[r.path,r.visits])))
 assert.deepEqual(sumBy(file('pages'),'page','pageviews'),Object.fromEntries(both.topPages.map(r=>[r.path,r.pageviews])))
 assert.equal((await a.form({operation:'team.invite',email:'viewer@example.test',role:'viewer',scope:'chosen',[`site_${other}`]:'on'},a.owner)).status,303);const viewer=await a.accept('viewer@example.test')
 assert.equal((await a.request(href,{headers:{cookie:viewer}})).status,403,'the ZIP follows the viewer\'s site scope')
 // The Looker Studio connector, run as Apps Script against the Stats API with a site's Stats API key.
 const key=(await (await a.form({operation:'apikey.create',kind:'stats',label:'Looker Studio',[`site_${id}`]:'on'},a.owner)).text()).match(/data-api-key>(vane_k_[0-9a-f]{64})</)[1]
 const looker=appsScript(await readFile(new URL('../connectors/looker-studio/Code.gs',import.meta.url),'utf8'),async(url,options)=>{const u=new URL(url);assert.equal(u.origin,a.origin);const r=await a.request(u.pathname+u.search,{headers:{authorization:options.headers.Authorization}});return {status:r.status,body:await r.text()}});t.after(()=>looker.close())
 assert.equal((await looker.call('getAuthType')).type,'KEY');assert.equal((await looker.call('setCredentials',{key:'nope'})).errorCode,'INVALID_CREDENTIALS');assert.equal((await looker.call('setCredentials',{key})).errorCode,'NONE');assert.equal(await looker.call('isAuthValid'),true)
 assert.equal((await looker.call('getConfig')).dateRangeRequired,true);const schema=(await looker.call('getSchema')).schema;assert.ok(['channel','page','visitors','bounce_rate'].every(name=>schema.some(f=>f.name===name)))
 const request={configParams:{origin:a.origin,site_id:id},dateRange:{startDate:'2026-03-10',endDate:'2026-03-10'}}
 const byChannel=await looker.call('getData',{...request,fields:[{name:'channel'},{name:'visitors'},{name:'visits'},{name:'bounce_rate'}]})
 assert.deepEqual(byChannel.schema.map(f=>f.name),['channel','visitors','visits','bounce_rate']);assert.deepEqual(byChannel.rows.map(r=>r.values),tenth.channels.map(r=>[r.label,r.visitors,r.visits,r.bounceRate===null?null:r.bounceRate/100]))
 const totals=await looker.call('getData',{...request,dateRange:{startDate:'2026-03-09',endDate:'2026-03-10'},fields:[{name:'visitors'},{name:'pageviews'}]});assert.deepEqual(totals.rows,[{values:[both.visitors,both.pageviews]}])
 assert.ok(looker.fetches.every(f=>new URL(f.url).pathname==='/api/v1/stats'&&f.options.headers.Authorization==='Bearer '+key))
 // The published schema of the warehouse export.
 const published=await (await a.request('/api/v1/export-schema.json')).json(),columns=name=>published.objects[name].columns.map(c=>c.name)
 assert.ok(published.never.includes('visitor hash')&&!columns('events').includes('visitor'))
 // Only the owner schedules an export, to a public https endpoint.
 const admin=await a.invite('admin@example.test','admin'),input={operation:'export.save',siteId:id,endpoint:'https://acct.r2.fixture.example',bucket:'vane-export',region:'auto',prefix:'analytics',accessKeyId:'FIXTUREKEY0001',secretAccessKey:'fixture-secret-'+crypto.randomUUID(),from:'2026-03-09'}
 assert.equal((await a.form(input,admin)).status,403)
 for(const endpoint of ['http://acct.r2.fixture.example','https://127.0.0.1','https://10.0.0.5','https://192.168.1.4','https://169.254.169.254','https://localhost','https://[::1]','https://metadata.internal','https://printer.local','https://bucket'])assert.equal((await a.form({...input,endpoint},a.owner)).status,400,endpoint)
 const objects={};let refuse=false
 a.fixtureSites['https://acct.r2.fixture.example']=async request=>{
  const u=new URL(request.url),body=await request.text(),auth=request.headers.get('authorization').match(/^AWS4-HMAC-SHA256 Credential=([^/]+)\/(\d{8})\/auto\/s3\/aws4_request, SignedHeaders=([^,]+), Signature=([0-9a-f]{64})$/)
  // The fixture checks the Signature Version 4 itself, so a PUT signed without the owner's secret key is refused.
  const headers={'content-type':request.headers.get('content-type'),host:u.host,'x-amz-content-sha256':request.headers.get('x-amz-content-sha256'),'x-amz-date':request.headers.get('x-amz-date')},hash=createHash('sha256').update(body).digest('hex')
  const canonical=['PUT',u.pathname,'',...auth[3].split(';').map(name=>`${name}:${headers[name]}`),'',auth[3],hash].join('\n'),scope=`${auth[2]}/auto/s3/aws4_request`
  let signing=createHmac('sha256','AWS4'+input.secretAccessKey).update(auth[2]).digest();for(const part of ['auto','s3','aws4_request'])signing=createHmac('sha256',signing).update(part).digest()
  const valid=request.method==='PUT'&&auth[1]===input.accessKeyId&&headers['x-amz-content-sha256']===hash&&createHmac('sha256',signing).update(['AWS4-HMAC-SHA256',headers['x-amz-date'],scope,createHash('sha256').update(canonical).digest('hex')].join('\n')).digest('hex')===auth[4]
  if(!valid||refuse)return new Response('<Error><Code>AccessDenied</Code></Error>',{status:403})
  objects[decodeURIComponent(u.pathname)]=body;return new Response(null,{status:200})
 }
 assert.equal((await a.form(input,a.owner)).status,303)
 const settings=await (await a.request(`/app/sites/${id}?section=settings`,owner)).text();assert.match(settings,/data-export-status>Daily export to <code>acct\.r2\.fixture\.example\/vane-export\/analytics\/vane\//)
 assert.ok(!settings.includes(input.secretAccessKey)&&!JSON.stringify(await a.dump()).includes(input.secretAccessKey),'the key is sealed');assert.ok(!('vane_exports' in (await a.archive()).payload.tables),'the export and its key are left out of history archives')
 assert.ok(!(await (await a.request(`/app/sites/${id}?section=settings`,{headers:{cookie:admin}})).text()).includes('value="export.save"'),'an admin sees no export form')
 // The scheduled run after both dates end: two objects per date, the rollup equal to that date's dashboard.
 const before=a.egress.length;await a.clock(Date.parse('2026-03-11T01:00:00Z'));await a.scheduled()
 const prefix=`/vane-export/analytics/vane/${id}`
 assert.deepEqual(Object.keys(objects).sort(),[`${prefix}/daily_rollups/2026-03-09.csv`,`${prefix}/daily_rollups/2026-03-10.csv`,`${prefix}/events/2026-03-09.csv`,`${prefix}/events/2026-03-10.csv`])
 const rollup=csvRows(objects[`${prefix}/daily_rollups/2026-03-10.csv`]);assert.deepEqual(rollup.columns,columns('daily_rollups'))
 assert.deepEqual(rollup.map(r=>[r.date,r.site_id,+r.visitors,+r.visits,+r.pageviews,+r.bounce_rate,+r.visit_duration]),[['2026-03-10',id,tenth.visitors,tenth.visits,tenth.pageviews,tenth.bounceRate,tenth.averageDuration]])
 const dump=await a.dump(),events=csvRows(objects[`${prefix}/events/2026-03-10.csv`]);assert.deepEqual(events.columns,columns('events'))
 assert.deepEqual(events.map(r=>r.id).sort(),dump.vane_events.filter(e=>e.site_id===id&&e.day==='2026-03-10').map(e=>e.id).sort())
 for(const hash of new Set(dump.vane_events.map(e=>e.visitor).filter(Boolean)))assert.ok(Object.values(objects).every(text=>!text.includes(hash)),'no visitor hash leaves')
 const runs=()=>a.dump().then(d=>d.vane_audit.filter(e=>e.action.startsWith('export.')&&e.action!=='export.configure').map(e=>[e.action,e.detail]))
 assert.deepEqual((await runs()).map(([action,detail])=>[action,detail.match(/^(\S+): 1 rollup row and (\d+) event rows/)?.slice(1)]).sort(),[['export.run',['2026-03-09','3']],['export.run',['2026-03-10',String(events.length)]]])
 await a.scheduled();assert.equal(Object.keys(objects).length,4,'each date is exported once')
 // A refused upload is audited with no rows sent, keeps the date for later and holds the export back for an hour.
 refuse=true;await a.clock(Date.parse('2026-03-12T01:00:00Z'));await a.scheduled();const sent=a.egress.length;await a.scheduled()
 assert.equal(a.egress.length,sent,'held back after a refusal');assert.ok((await runs()).some(([action,detail])=>action==='export.fail'&&detail.startsWith('2026-03-11 refused: HTTP 403')&&detail.includes('0 rows sent')))
 refuse=false;await a.clock(Date.parse('2026-03-12T02:01:00Z'));await a.scheduled();assert.ok(objects[`${prefix}/events/2026-03-11.csv`],'retried after an hour')
 assert.ok(a.egress.slice(before).every(url=>url.startsWith('https://acct.r2.fixture.example/')),'the export talks only to the owner\'s bucket')
})
test('MOBILE-001 at 390 and 1440 px the site, approval, report, filter and alert journeys complete by keyboard, every page passing an automated WCAG 2.2 AA scan with no horizontal scroll',async t=>{
 const a=await withApp(t),axe=await readFile(createRequire(import.meta.url).resolve('axe-core'),'utf8'),{context}=await browse(t,a)
 await context.addCookies(a.owner.split('; ').map(pair=>{const [name,...value]=pair.split('=');return {name,value:value.join('='),url:a.origin}}))
 // Playwright does not route the request that follows a fulfilled redirect, so a form's 303 is followed as a navigation.
 await context.route(a.origin+'/app/action',async route=>{const request=route.request(),response=await a.request('/app/action',{method:'POST',headers:request.headers(),body:request.postData()??undefined}),location=response.headers.get('location');if(response.status!==303||!location)return route.fulfill({status:response.status,headers:Object.fromEntries(response.headers),body:Buffer.from(await response.arrayBuffer())});return route.fulfill({status:200,contentType:'text/html',body:`<!doctype html><title>Redirecting</title><meta http-equiv="refresh" content="0;url=${location.replaceAll('&','&amp;').replaceAll('"','&quot;')}">`})})
 const page=await context.newPage()
 // Keyboard only: Tab moves focus until it reaches the control, then keys type into it and Enter submits.
 const tabTo=async selector=>{for(let i=0;i<400;i++){await page.keyboard.press('Tab');if(await page.evaluate(s=>document.activeElement?.matches(s)??false,selector))return}assert.fail('Tab never reached '+selector)}
 const submit=async url=>{await Promise.all([page.waitForURL(url),page.keyboard.press('Enter')]);await page.waitForLoadState()}
 // The scan runs axe-core in the page (the page's own CSP stays on) for WCAG 2.0-2.2 A and AA.
 const scanned=async label=>{
  const violations=await page.evaluate(`${axe}\n;axe.run(document,{runOnly:{type:'tag',values:['wcag2a','wcag2aa','wcag21a','wcag21aa','wcag22aa']}}).then(r=>r.violations.map(v=>v.id+': '+v.nodes.map(n=>n.target.join(' ')).join(', ')))`)
  assert.deepEqual(violations,[],label);assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),`${label} scrolls sideways`)
 }
 for(const width of [390,1440]){
  await page.setViewportSize({width,height:900});const origin=`https://fern${width}.example`
  // Site: the Add a site form, then its approval.
  await page.goto(a.origin+'/app');await scanned(`${width} sites`)
  await tabTo('input[name="name"]');await page.keyboard.type(`Fern ${width}`);await tabTo('input[name="origin"]');await page.keyboard.type(origin);await submit(/section=approvals/)
  await scanned(`${width} approvals`)
  await tabTo('form:has(input[value="proposal.approve"]) button[type="submit"]');await submit(/\/app\/sites\/[\w-]+\?/)
  const id=(await a.dump()).vane_sites.find(s=>s.name===`Fern ${width}`)?.id;assert.ok(id,'the approved site exists')
  for(const path of ['/','/pricing','/thanks'])assert.equal((await a.collect(a.event(id,{path,consent:'granted'}),origin)).status,202)
  // Report: change the range from the keyboard.
  await page.goto(`${a.origin}/app/sites/${id}?section=report`);await scanned(`${width} report`)
  await tabTo('select[name="period"]');await page.keyboard.type('Last 30');assert.equal(await page.evaluate(()=>document.activeElement.value),'30d')
  await tabTo('form:has(select[name="period"]) button[type="submit"]');await submit(/period=30d/);await scanned(`${width} report, last 30 days`)
  // Filter: Page is /thanks.
  await tabTo('select[name="filterDimension"]');await page.keyboard.type('Page');assert.equal(await page.evaluate(()=>document.activeElement.value),'page')
  await tabTo('input[name="filterValue"]');await page.keyboard.type('/thanks');await submit(/filterValue=%2Fthanks|filter=page/)
  assert.match(await page.locator('[data-active-filters]').textContent(),/\/thanks/);await scanned(`${width} filtered report`)
  // Alert (ALERT-001): a traffic alert set from the keyboard on the site's settings.
  await page.goto(`${a.origin}/app/sites/${id}?section=settings`)
  await tabTo('select[name="metric"]');await page.keyboard.type('Current');assert.equal(await page.evaluate(()=>document.activeElement.value),'current')
  await tabTo('input[name="threshold"]');await page.keyboard.type('50');await submit(/notice=Alert\+added/)
  assert.match(await page.locator('[data-alerts]').textContent(),/Current visitors above 50/);await scanned(`${width} alerts`)
  for(const section of ['settings','history','realtime']){await page.goto(`${a.origin}/app/sites/${id}?section=${section}`);await scanned(`${width} ${section}`)}
  for(const section of ['team','api','audit']){await page.goto(`${a.origin}/app?section=${section}`);await scanned(`${width} ${section}`)}
  // Every chart has a data table: the report and real-time charts in their details, each site's sparkline in its row.
  for(const path of [`/app/sites/${id}?section=report`,`/app/sites/${id}?section=realtime`,'/app']){await page.goto(a.origin+path)
   const charts=await page.evaluate(()=>[...document.querySelectorAll('svg.vane-chart,svg.vane-sparkline')].map(svg=>{const table=svg.closest('figure,li')?.querySelector('table')??svg.closest('section')?.querySelector('table');return table?table.querySelectorAll('tbody tr').length:0}))
   assert.ok(charts.length&&charts.every(n=>n>0),`${width} ${path}: every chart has a data table with rows`)}
 }
 await context.close()
})
test('MOBILE-001 the app installs as a PWA, a browser that turns on alerts receives an encrypted test alert and a real traffic alert carrying only its title, site and link that the service worker shows, and turning off, a 410 and removal from the team forget the browser',async t=>{
 const a=await withApp(t),id=await a.addSite(),axe=await readFile(createRequire(import.meta.url).resolve('axe-core'),'utf8'),{context}=await browse(t,a)
 await context.addCookies(a.owner.split('; ').map(pair=>{const [name,...value]=pair.split('=');return {name,value:value.join('='),url:a.origin}}))
 await context.route(a.origin+'/app/action',async route=>{const request=route.request(),response=await a.request('/app/action',{method:'POST',headers:request.headers(),body:request.postData()??undefined}),location=response.headers.get('location');if(response.status!==303||!location)return route.fulfill({status:response.status,headers:Object.fromEntries(response.headers),body:Buffer.from(await response.arrayBuffer())});return route.fulfill({status:200,contentType:'text/html',body:`<!doctype html><title>Redirecting</title><meta http-equiv="refresh" content="0;url=${location.replaceAll('&','&amp;').replaceAll('"','&quot;')}">`})})
 const page=await context.newPage(),cdp=await context.newCDPSession(page)
 const scanned=async label=>{const violations=await page.evaluate(`${axe}\n;axe.run(document,{runOnly:{type:'tag',values:['wcag2a','wcag2aa','wcag21a','wcag21aa','wcag22aa']}}).then(r=>r.violations.map(v=>v.id+': '+v.nodes.map(n=>n.target.join(' ')).join(', ')))`);assert.deepEqual(violations,[],label);assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),`${label} scrolls sideways`)}
 await page.goto(a.origin+'/app?section=alerts')
 // Installable: Chrome finds the manifest's name, start URL, standalone display and icons.
 assert.deepEqual((await cdp.send('Page.getInstallabilityErrors')).installabilityErrors,[])
 // Turning alerts on registers the service worker; the test then stands in for the browser's push service.
 await page.getByRole('button',{name:'Turn on alerts in this browser'}).click()
 let active=false;for(let i=0;i<100&&!active;i++){active=await page.evaluate(async()=>Boolean((await navigator.serviceWorker.getRegistration('/'))?.active));if(!active)await page.waitForTimeout(100)}
 assert.ok(active,'the service worker is installed and active')
 const {createECDH,createDecipheriv,createPublicKey,randomBytes,verify}=await import('node:crypto')
 const browser=createECDH('prime256v1');browser.generateKeys()
 const b64url=b=>Buffer.from(b).toString('base64url'),auth=randomBytes(16),key=await page.getAttribute('[data-push]','data-key')
 const subscription=endpoint=>({endpoint,keys:{p256dh:b64url(browser.getPublicKey()),auth:b64url(auth)}})
 const subscribe=(endpoint,cookie=a.owner)=>a.post('/api/vane/push/subscribe',subscription(endpoint),cookie)
 assert.equal((await subscribe('https://push.example/send/browser-1')).status,201)
 assert.equal((await subscribe('http://127.0.0.1:9/send')).status,400,'a private or plain-http endpoint is refused')
 const delivered=[];let answer=201
 a.fixtureSites['https://push.example']=async request=>{delivered.push({url:request.url,headers:Object.fromEntries(request.headers),body:Buffer.from(await request.arrayBuffer())});return new Response(null,{status:answer})}
 // RFC 8291: the browser's key and auth secret decrypt the aes128gcm record; RFC 8292: the VAPID JWT verifies with the installation's key.
 const hmac=(k,d)=>createHmac('sha256',k).update(d).digest()
 const decrypt=body=>{const salt=body.subarray(0,16),idlen=body[20],sender=body.subarray(21,21+idlen),sealed=body.subarray(21+idlen),shared=browser.computeSecret(sender)
  const ikm=hmac(hmac(auth,shared),Buffer.concat([Buffer.from('WebPush: info\0'),browser.getPublicKey(),sender,Buffer.from([1])])),prk=hmac(salt,ikm)
  const decipher=createDecipheriv('aes-128-gcm',hmac(prk,Buffer.from('Content-Encoding: aes128gcm\0\x01')).subarray(0,16),hmac(prk,Buffer.from('Content-Encoding: nonce\0\x01')).subarray(0,12));decipher.setAuthTag(sealed.subarray(-16))
  const plain=Buffer.concat([decipher.update(sealed.subarray(0,-16)),decipher.final()]);assert.equal(plain.at(-1),2,'one final record');return plain.subarray(0,-1).toString()}
 for(const width of [390,1440]){await page.setViewportSize({width,height:900});await page.goto(a.origin+'/app?section=alerts');await scanned(`${width} browser alerts`)}
 await page.getByRole('button',{name:'Send a test alert'}).press('Enter');await page.waitForURL(/notice=Test\+alert\+sent/)
 assert.equal(delivered.length,1);const [sent]=delivered
 assert.equal(sent.headers['content-encoding'],'aes128gcm');const [,jwt,k]=sent.headers.authorization.match(/^vapid t=([^,]+), k=(.+)$/);assert.equal(k,key)
 const [head,claims,signature]=jwt.split('.'),raw=Buffer.from(k,'base64url'),publicKey=createPublicKey({key:{kty:'EC',crv:'P-256',x:b64url(raw.subarray(1,33)),y:b64url(raw.subarray(33,65))},format:'jwk'})
 assert.ok(verify('sha256',Buffer.from(`${head}.${claims}`),{key:publicKey,dsaEncoding:'ieee-p1363'},Buffer.from(signature,'base64url')),'the VAPID JWT is signed with the installation key')
 assert.equal(JSON.parse(Buffer.from(claims,'base64url')).aud,'https://push.example')
 const alert=JSON.parse(decrypt(sent.body));assert.deepEqual(alert,{title:'Test alert',site:'Fern Studio',link:`${a.origin}/app/sites/${id}`},'only the title, site name and link')
 // The installed service worker shows the delivered alert as a notification.
 await cdp.send('ServiceWorker.enable');const registration=await Promise.race([new Promise(resolve=>{cdp.on('ServiceWorker.workerRegistrationUpdated',({registrations})=>{const r=registrations.find(r=>r.scopeURL===a.origin+'/'&&!r.isDeleted);if(r)resolve(r)})}),new Promise((_,reject)=>setTimeout(()=>reject(new Error('no service worker registration reported')),10000))])
 // The headless browser has no notification centre, so the worker's showNotification is recorded instead (the OS edge).
 const worker=context.serviceWorkers().find(w=>w.url()===a.origin+'/vane-sw.js');await worker.evaluate(()=>{self.shown=[];self.registration.showNotification=(title,options)=>{self.shown.push([title,options.body,options.data.link]);return Promise.resolve()}})
 await cdp.send('ServiceWorker.deliverPushMessage',{origin:a.origin,registrationId:registration.registrationId,data:decrypt(sent.body)})
 let notifications=[];for(let i=0;i<50&&!notifications.length;i++){notifications=await worker.evaluate(()=>self.shown);if(!notifications.length)await page.waitForTimeout(100)}
 assert.deepEqual(notifications,[['Test alert','Fern Studio',`${a.origin}/app/sites/${id}`]])
 // A real traffic alert (ALERT-001) reaches the same browser: current visitors above 0, seen by the 5-minute cron.
 assert.equal((await a.form({operation:'alert.create',siteId:id,metric:'current',direction:'above',threshold:'0',cooldown:'6'},a.owner)).status,303)
 assert.equal((await a.post('/api/vane/collect',a.event(id,{path:'/'}),'',{origin:'https://fern.example','cf-connecting-ip':'203.0.113.9','user-agent':DESKTOP_CHROME})).status,202)
 await a.scheduled();assert.equal(delivered.length,2,'the alert is pushed once')
 const fired=decrypt(delivered[1].body),link=`${a.origin}/app/sites/${id}?section=realtime`;assert.deepEqual(JSON.parse(fired),{title:'Current visitors above 0',site:'Fern Studio',link})
 await cdp.send('ServiceWorker.deliverPushMessage',{origin:a.origin,registrationId:registration.registrationId,data:fired})
 for(let i=0;i<50&&notifications.length<2;i++){notifications=await worker.evaluate(()=>self.shown);if(notifications.length<2)await page.waitForTimeout(100)}
 assert.deepEqual(notifications[1],['Current visitors above 0','Fern Studio',link])
 // A push service's 410 forgets the subscription; turning off forgets it too; both are audited.
 answer=410;await page.goto(a.origin+'/app?section=alerts');await page.getByRole('button',{name:'Send a test alert'}).press('Enter');await page.waitForURL(/notice=No\+push/)
 assert.deepEqual((await a.dump()).vane_push_subscriptions,[])
 answer=201;await subscribe('https://push.example/send/browser-2');assert.equal((await a.post('/api/vane/push/unsubscribe',{endpoint:'https://push.example/send/browser-2'},a.owner)).status,200)
 assert.deepEqual((await a.dump()).vane_push_subscriptions,[])
 // Removing a team member (TEAM-001) deletes their browsers' subscriptions.
 const member=await a.invite('alerts@example.test','member');assert.equal((await subscribe('https://push.example/send/member',member)).status,201)
 const operators=await (await a.request('/auth/operators',{headers:{cookie:a.owner}})).json(),list=Array.isArray(operators)?operators:operators.operators
 assert.equal((await a.form({operation:'team.remove',operatorId:list.find(p=>p.email==='alerts@example.test').id},a.owner)).status,303)
 const after=await a.dump();assert.deepEqual(after.vane_push_subscriptions,[]);assert.ok(['push.subscribe','push.unsubscribe'].every(action=>after.vane_audit.some(e=>e.action===action)),'subscribing and unsubscribing are audited')
 assert.ok(!JSON.stringify(after.vane_push_keys).includes('"d"'),'the VAPID private key is sealed')
 assert.ok(a.egress.every(url=>new URL(url).origin==='https://push.example'||new URL(url).hostname==='api.resend.com'),'alerts go only to the push service')
})
test('API-004 an MCP client with a site-scoped Stats API key lists its sites and gets last week\'s top sources equal to the Stats API answer; another site, a missing or revoked key and a write tool without a grant are refused',async t=>{
 const a=await withApp(t),id=await a.addSite({paths:[]}),other=await a.addSite({name:'Oak Store',origin:'https://oak.example'})
 const now=Date.parse('2026-03-12T12:00:00Z')
 for(const [n,first,day] of [[1,{referrer:'https://www.google.com/'},1],[2,{referrer:'https://www.google.com/'},2],[3,{campaign:'spring',utm:{source:'newsletter',medium:'email'}},3],[4,{referrer:'https://news.ycombinator.com/'},4],[5,{},5]]){await a.clock(now-day*86400000);assert.equal((await a.post('/api/vane/collect',a.event(id,{source:undefined,campaign:undefined,...first,path:'/'}),'',{origin:'https://fern.example','cf-connecting-ip':'203.0.113.'+n,'user-agent':'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36'})).status,202)}
 await a.clock(now)
 const key=(await (await a.form({operation:'apikey.create',kind:'stats',label:'Assistant',[`site_${id}`]:'on'},a.owner)).text()).match(/data-api-key>(vane_k_[0-9a-f]{64})</)[1]
 // A minimal MCP client over Streamable HTTP: initialize, the initialized notification, then requests with the negotiated version.
 let version='',next=0
 const send=(message,token=key)=>a.request('/api/v1/mcp',{method:'POST',headers:{'content-type':'application/json',accept:'application/json, text/event-stream',...(token?{authorization:'Bearer '+token}:{}),...(version?{'mcp-protocol-version':version}:{})},body:JSON.stringify(message)})
 const rpc=async(method,params,token)=>{const id=++next,r=await send({jsonrpc:'2.0',id,method,params},token);assert.equal(r.status,200,await r.clone().text());const body=await r.json();assert.equal(body.id,id);return body}
 const init=await rpc('initialize',{protocolVersion:'2025-06-18',capabilities:{},clientInfo:{name:'test-client',version:'1'}});assert.equal(init.result.protocolVersion,'2025-06-18');assert.ok(init.result.capabilities.tools);version=init.result.protocolVersion
 assert.equal((await send({jsonrpc:'2.0',method:'notifications/initialized'})).status,202)
 const tools=(await rpc('tools/list',{})).result.tools;assert.ok(['list_sites','query_stats','add_annotation'].every(name=>tools.some(tool=>tool.name===name)));assert.equal(tools.find(tool=>tool.name==='query_stats').annotations.readOnlyHint,true)
 const listed=(await rpc('tools/call',{name:'list_sites',arguments:{}})).result;assert.deepEqual(listed.structuredContent.sites.map(s=>s.id),[id],'only the key\'s sites')
 // Last week's top sources: the tool's answer is the Stats API's answer.
 const asked=(await rpc('tools/call',{name:'query_stats',arguments:{site_id:id,period:'7d',dimension:'source',metrics:['visitors','visits']}})).result
 const stats=await (await a.request(`/api/v1/stats?site_id=${id}&period=7d&dimension=source&metrics=visitors,visits`,{headers:{authorization:'Bearer '+key}})).json()
 assert.equal(asked.isError,false);assert.deepEqual(asked.structuredContent,stats);assert.deepEqual(JSON.parse(asked.content[0].text),stats)
 assert.deepEqual(Object.fromEntries(stats.breakdown.filter(r=>r.visits).map(r=>[r.value,r.visits])),{Google:2,newsletter:1,'Hacker News':1,direct:1})
 // Another site and a write tool are refused, and the write changes nothing.
 const foreign=(await rpc('tools/call',{name:'query_stats',arguments:{site_id:other,period:'7d'}})).result;assert.equal(foreign.isError,true);assert.equal(foreign.structuredContent.error,'forbidden')
 const write=(await rpc('tools/call',{name:'add_annotation',arguments:{site_id:id,day:'2026-03-11',text:'Launch'}})).result;assert.equal(write.isError,true);assert.equal(write.structuredContent.error,'grant_required');assert.deepEqual((await a.dump()).vane_annotations,[])
 assert.equal((await rpc('tools/call',{name:'drop_tables',arguments:{}})).error.code,-32602);assert.equal((await rpc('resources/list',{})).error.code,-32601)
 // No key, a revoked key and an event-stream GET are refused.
 const anonymous=await send({jsonrpc:'2.0',id:99,method:'tools/list'},null);assert.equal(anonymous.status,401);assert.equal(anonymous.headers.get('www-authenticate'),'Bearer')
 assert.equal((await a.request('/api/v1/mcp',{headers:{authorization:'Bearer '+key,accept:'text/event-stream'}})).status,405)
 assert.equal((await a.form({operation:'apikey.revoke',id:(await a.dump()).vane_api_keys[0].id},a.owner)).status,303);assert.equal((await send({jsonrpc:'2.0',id:100,method:'tools/list'})).status,401)
})
test('IMPORT-006 a page of PostHog $pageview events, a Simple Analytics CSV export page and a Umami website_event database export page import only the day, path, source and campaign, resume without double counting, and keep no person, session, device or IP identifier',async t=>{
 const a=await withApp(t),owner={headers:{cookie:a.owner}},id=await a.addSite({paths:[]})
 const person='0191f2d0-person-7a1b',ip='198.51.100.23',pageview=(uuid,timestamp,url,extra={})=>({uuid,event:'$pageview',timestamp,distinct_id:person,properties:{$current_url:url,$pathname:new URL(url).pathname,$host:'fern.example',$ip:ip,$session_id:'0191f2d0-session',$device_id:'0191f2d0-device',$title:'Title of a PostHog page',token:'phc_projectkey',$browser:'Chrome',$referrer:'$direct',$referring_domain:'$direct',...extra}})
 const page={next:null,results:[
  pageview('0191f2d0-0001-7000-8000-000000000001','2024-03-10T10:00:00.123000+00:00','https://fern.example/?utm_source=newsletter&utm_campaign=spring',{utm_source:'newsletter',utm_campaign:'spring'}),
  pageview('0191f2d0-0002-7000-8000-000000000002','2024-03-10T10:05:00+00:00','https://fern.example/pricing',{$referrer:'https://www.google.com/search?q=fern',$referring_domain:'www.google.com'}),
  pageview('0191f2d0-0003-7000-8000-000000000003','2024-03-11T09:00:00Z','https://fern.example/thanks'),
 ]}
 const {preview}=await movein(a,id,page)
 assert.deepEqual(preview.normalized.map(e=>[e.day,e.path,e.source,e.campaign]).sort(),[['2024-03-10','/','newsletter','spring'],['2024-03-10','/pricing','www.google.com','none'],['2024-03-11','/thanks','direct','none']])
 assert.deepEqual([preview.discarded.sessionIds,preview.discarded.pageTitles,preview.discarded.websiteIds,preview.discarded.sourceEventIds,preview.discarded.rawQueries,preview.discarded.referrerPaths],[9,3,3,3,1,1])
 const totals=async()=>(await (await a.request(`/api/vane/summary?siteId=${id}&from=2024-03-10&to=2024-03-12`,owner)).json()).pageviews
 assert.equal(await totals(),3)
 // The same page again resumes its job: nothing counts twice.
 await movein(a,id,page);assert.equal(await totals(),3)
 const stored=JSON.stringify(await a.dump());for(const value of [person,ip,'0191f2d0-session','0191f2d0-device','phc_projectkey','Title of a PostHog page','0191f2d0-0001-7000-8000-000000000001','utm_source=newsletter'])assert.ok(!stored.includes(value),value)
 // Anything but a $pageview, or a page without events, is refused before custody.
 const refused=await a.post('/api/vane/import-preview',{siteId:id,document:{results:[{...page.results[0],event:'$autocapture'}]}},a.owner);assert.equal(refused.status,400);assert.match(await refused.text(),/ROW_1_UNSUPPORTED_EVENT_TYPE/)
 assert.equal((await a.post('/api/vane/import-preview',{siteId:id,document:{results:[]}},a.owner)).status,400)
 // A Simple Analytics data-point export page (CSV): the same four fields are kept, the session ID and the rest are not.
 const csv='added_iso,path,uuid,session_id,hostname,referrer_hostname,referrer_path,utm_source,utm_campaign,query,browser_name,country_code,is_unique\r\n'+
  '2024-03-12T08:00:00.000Z,/,sa-0001,sa-session-77,fern.example,news.ycombinator.com,/item,,,,Firefox,NL,true\r\n'+
  '2024-03-12T08:05:00.000Z,/pricing,sa-0002,sa-session-77,fern.example,,,newsletter,"spring, launch",ref=x,Firefox,NL,false\r\n'
 const simple=(await movein(a,id,csv)).preview
 assert.deepEqual(simple.normalized.map(e=>[e.day,e.path,e.source,e.campaign]).sort(),[['2024-03-12','/','news.ycombinator.com','none'],['2024-03-12','/pricing','newsletter','spring, launch']])
 assert.deepEqual([simple.discarded.sessionIds,simple.discarded.rawQueries,simple.discarded.referrerPaths],[2,1,1])
 assert.equal((await (await a.request(`/api/vane/summary?siteId=${id}&from=2024-03-12&to=2024-03-13`,owner)).json()).pageviews,2)
 await movein(a,id,csv);assert.equal((await (await a.request(`/api/vane/summary?siteId=${id}&from=2024-03-12&to=2024-03-13`,owner)).json()).pageviews,2,'resumes without double counting')
 // A page of Umami's website_event database export (CSV, PostgreSQL timestamps in UTC): the same fields are kept, and an
 // event keeps its identity through Umami's events API, so a row imported both ways counts once.
 const umami='event_id,website_id,session_id,visit_id,created_at,url_path,url_query,referrer_path,referrer_query,referrer_domain,page_title,event_type,event_name,hostname,tag\n'+
  'b1a6c0de-0001-4000-8000-000000000001,4fb7a9b2-site,77aa-session,88bb-visit,2024-03-13 09:00:00.123+00,/,utm_source=newsletter&utm_campaign=spring,,,,Fern home,1,,fern.example,\n'+
  'b1a6c0de-0002-4000-8000-000000000002,4fb7a9b2-site,77aa-session,88bb-visit,2024-03-13 09:02:00,/pricing,,/search,q=fern,www.google.com,Fern pricing,1,,fern.example,\n'+
  'b1a6c0de-0003-4000-8000-000000000003,4fb7a9b2-site,77aa-session,88bb-visit,2024-03-13T09:05:00Z,/thanks,,,,,Thanks,2,signup,fern.example,\n'
 const export_=(await movein(a,id,umami)).preview
 assert.deepEqual(export_.normalized.map(e=>[e.day,e.kind,e.path,e.source,e.campaign]).sort(),[['2024-03-13','pageview','/','newsletter','spring'],['2024-03-13','pageview','/pricing','www.google.com','none'],['2024-03-13','signup','/thanks','direct','none']])
 assert.deepEqual([export_.discarded.sessionIds,export_.discarded.websiteIds,export_.discarded.pageTitles,export_.discarded.rawQueries,export_.discarded.referrerPaths,export_.discarded.referrerQueries],[6,3,3,1,1,1])
 const day13=async()=>{const r=await (await a.request(`/api/vane/summary?siteId=${id}&from=2024-03-13&to=2024-03-14`,owner)).json();return [r.pageviews,r.goals]}
 assert.deepEqual(await day13(),[2,1])
 await movein(a,id,{data:[{id:'b1a6c0de-0001-4000-8000-000000000001',websiteId:'4fb7a9b2-site',sessionId:'77aa-session',createdAt:'2024-03-13T09:00:00.123Z',urlPath:'/',urlQuery:'utm_source=newsletter&utm_campaign=spring',eventType:1}],count:1,page:1,pageSize:1})
 assert.deepEqual(await day13(),[2,1],'the same Umami event through the events API counts once')
 const after=JSON.stringify(await a.dump());for(const value of ['sa-session-77','sa-0001','ref=x','77aa-session','88bb-visit','4fb7a9b2-site','Fern pricing','b1a6c0de-0002','q=fern'])assert.ok(!after.includes(value),value)
})
test('INSTALL-008 a server sends pageviews and a custom event with its site token, a repeated Idempotency-Key counts once, a token for another site is refused, and no raw IP or user agent is stored',async t=>{
 const a=await withApp(t),owner={headers:{cookie:a.owner}},id=await a.addSite({paths:[]}),other=await a.addSite({name:'Oak Store',origin:'https://oak.example'})
 await a.clock(Date.parse('2026-03-10T15:00:00Z'))
 const token=async site=>(await (await a.form({operation:'apikey.create',kind:'events',label:'Backend '+site.slice(0,4),[`site_${site}`]:'on'},a.owner)).text()).match(/data-api-key>(vane_e_[0-9a-f]{64})</)[1]
 assert.equal((await a.form({operation:'apikey.create',kind:'events',label:'Both',[`site_${id}`]:'on',[`site_${other}`]:'on'},a.owner)).status,400,'an events token covers one site')
 const mine=await token(id),theirs=await token(other)
 const send=(body,key=mine,extra={})=>a.request('/api/v1/events',{method:'POST',headers:{'content-type':'application/json',...(key?{authorization:'Bearer '+key}:{}),...extra},body:JSON.stringify(body)})
 const chrome='Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36',iphone='Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1'
 const page=(path,ip,agent,extra={})=>({type:'pageview',id:crypto.randomUUID(),path,consent:'not-required',client_ip:ip,user_agent:agent,...extra})
 const first=page('/','203.0.113.9',chrome,{referrer:'https://www.google.com/',props:{plan:'pro'}})
 const one=await send(first);assert.equal(one.status,200,await one.clone().text());assert.deepEqual((await one.json()).results.map(r=>r.status),[202])
 const signup=await send({type:'event',id:crypto.randomUUID(),page:first.id,name:'Signup',consent:'not-required',client_ip:'203.0.113.9',user_agent:chrome});assert.deepEqual((await signup.json()).results.map(r=>r.status),[202])
 // A batch with an Idempotency-Key, sent twice: the second answer repeats the first, and nothing counts twice.
 const batch={events:[page('/pricing','203.0.113.9',chrome),page('/','198.51.100.4',iphone)]}
 const sent=await (await send(batch,mine,{'idempotency-key':'order-1001'})).json(),again=await (await send(batch,mine,{'idempotency-key':'order-1001'})).json()
 assert.equal(sent.accepted,2);assert.equal(again.duplicate,true);assert.deepEqual(again.results,sent.results)
 assert.equal((await (await send(first)).json()).results[0].duplicate,true,'a repeated event ID is admitted once')
 const summary=await (await a.request(`/api/vane/summary?siteId=${id}&period=today`,owner)).json()
 assert.deepEqual([summary.pageviews,summary.visitors],[3,2],'two visitors from their client IP and user agent');assert.deepEqual(summary.sourceVisits.find(r=>r.label==='Google')?.visits,1)
 const dump=await a.dump(),events=dump.vane_events.filter(e=>e.site_id===id)
 assert.deepEqual(events.map(e=>e.browser).sort(),['Chrome','Chrome','Safari']);assert.equal(dump.vane_custom_events.filter(e=>e.site_id===id).length,1)
 const stored=JSON.stringify(dump);for(const value of ['203.0.113.9','198.51.100.4',chrome,iphone,'order-1001',mine])assert.ok(!stored.includes(value),value)
 // A token for another site, a Stats API key, no token and a missing client address are refused.
 assert.equal((await send({...page('/','203.0.113.9',chrome),siteId:id},theirs)).status,403)
 const stats=(await (await a.form({operation:'apikey.create',kind:'stats',label:'Read',[`site_${id}`]:'on'},a.owner)).text()).match(/data-api-key>(vane_k_[0-9a-f]{64})</)[1]
 assert.equal((await send(page('/','203.0.113.9',chrome),stats)).status,403);assert.equal((await send(page('/','203.0.113.9',chrome),null)).status,401)
 assert.equal((await send({...page('/','203.0.113.9',chrome),client_ip:undefined})).status,400)
 assert.equal((await (await a.request(`/api/vane/summary?siteId=${other}&period=today`,owner)).json()).pageviews,0)
 const openapi=await (await a.request('/api/v1/openapi.json')).json();assert.ok(openapi.paths['/api/v1/events']&&openapi['x-event-limits'].events.events>0)
})
test('PRIVACY-003 each consent manager adapter and Google Consent Mode decide collection where the site\'s regions require consent: denied then granted from California, Germany and Texas, an unknown country fails closed, and the server holds the same rule',async t=>{
 const a=await withApp(t),states={
  onetrust:g=>`window.OnetrustActiveGroups=',C0001,${g?'C0002,':''}'`,cookiebot:g=>`window.Cookiebot={hasResponse:true,consent:{statistics:${g}}}`,termly:g=>`window.Termly={getConsentState:()=>({analytics:${g}})}`,
  osano:g=>`window.Osano={cm:{getConsent:()=>({ANALYTICS:'${g?'ACCEPT':'DENY'}'})}}`,iubenda:g=>`window._iub={cs:{api:{getPreferences:()=>({purposes:{1:true,4:${g}}})}}}`,cookieyes:g=>`window.getCkyConsent=()=>({isUserActionCompleted:true,categories:{analytics:${g}}})`}
 const regions=['EU','UK','US-CA'],sites={}
 for(const adapter of [...Object.keys(states),'consent-mode'])sites[adapter]=await a.addSite({name:'Fern '+adapter,origin:`https://${adapter}.fern.example`,paths:[],consent:'required',declinedCounter:true,consentRegions:regions,...(adapter==='consent-mode'?{}:{consentAdapter:adapter})})
 const pages={},page=(adapter,script)=>{const url=`https://${adapter}.fern.example/p${Object.keys(pages).length}`;pages[url]=`<!doctype html><title>Fixture</title><script>${script}</script><script src="${a.origin}/vane.js" data-site="${sites[adapter]}"></script>`;return url}
 const {context}=await browse(t,a,pages);let where={}
 // The visitor's location arrives as Cloudflare's request fields, as the edge sets them.
 await context.route(a.origin+'/**',async route=>{const request=route.request(),url=new URL(request.url()),response=await a.request(url.pathname+url.search,{method:request.method(),headers:request.headers(),body:request.postData()??undefined,cf:where});return route.fulfill({status:response.status,headers:Object.fromEntries(response.headers),body:Buffer.from(await response.arrayBuffer())})})
 const tab=await context.newPage()
 // One page load: the script either collects it or sends only the declined-consent count.
 const outcome=async(url,location)=>{where=location;const done=tab.waitForResponse(r=>/\/api\/vane\/(collect|declined\/)/.test(new URL(r.url()).pathname));await tab.goto(url);const r=await done;return new URL(r.url()).pathname==='/api/vane/collect'?[r.status(),JSON.parse(r.request().postData()).consent]:'declined'}
 const california={country:'US',regionCode:'CA'},germany={country:'DE',regionCode:'BE'},texas={country:'US',regionCode:'TX'}
 for(const adapter of Object.keys(states))for(const [location,required] of [[california,true],[germany,true],[texas,false]]){
  assert.deepEqual(await outcome(page(adapter,states[adapter](false)),location),required?'declined':[202,'not-required'],`${adapter} denied in ${location.regionCode}`)
  assert.deepEqual(await outcome(page(adapter,states[adapter](true)),location),required?[202,'granted']:[202,'not-required'],`${adapter} granted in ${location.regionCode}`)
 }
 // Google Consent Mode v2: the last analytics_storage default or update decides; window.vaneConsent comes first.
 const gtag=`window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments)}gtag('consent','default',{analytics_storage:'denied',ad_storage:'denied'});`
 assert.equal(await outcome(page('consent-mode',gtag),germany),'declined')
 assert.deepEqual(await outcome(page('consent-mode',gtag+`gtag('consent','update',{analytics_storage:'granted'})`),germany),[202,'granted'])
 assert.equal(await outcome(page('cookiebot','window.vaneConsent=false;'+states.cookiebot(true)),germany),'declined','window.vaneConsent comes first')
 assert.equal(await outcome(page('onetrust',states.onetrust(false)),{country:'XX'}),'declined','an unknown country (Cloudflare\'s XX) is asked for consent')
 // The configuration door says only whether consent is needed, and collection enforces the same rule.
 where=texas;const config=await (await a.request(`/api/vane/config/${sites.osano}`,{headers:{origin:'https://osano.fern.example'},cf:texas})).json();assert.equal(config.consent,'not-required');assert.equal(config.consentAdapter,'osano');assert.ok(!JSON.stringify(config).includes('US'))
 const direct=(cf,consent)=>a.request('/api/vane/collect',{method:'POST',headers:{origin:'https://osano.fern.example','content-type':'application/json','user-agent':'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36'},body:JSON.stringify(a.event(sites.osano,{consent})),cf})
 assert.equal((await direct(germany,'not-required')).status,403);assert.equal((await direct(texas,'not-required')).status,202);assert.equal((await direct(germany,'granted')).status,202)
 assert.ok(!JSON.stringify((await a.dump()).vane_events).match(/"(DE|BE|TX)"/),'no region is stored')
 await context.close()
})
test('API-003 a signed webhook receives a goal burst as per-minute counts once each after a failed first delivery is retried, and the delivery log shows the failure and the success',async t=>{
 const a=await withApp(t),owner={headers:{cookie:a.owner}},id=await a.addSite({paths:[],goals:{signup:'/thanks'}}),T=Date.parse('2026-03-10T10:00:00Z')
 const add=(body,cookie=a.owner)=>a.form({operation:'webhook.create',siteId:id,url:'https://hooks.fixture.example/vane','event_goal.conversions':'on',...body},cookie)
 assert.equal((await add({url:'http://hooks.fixture.example/vane'})).status,400);assert.equal((await add({url:'https://10.1.2.3/vane'})).status,400)
 assert.equal((await a.form({operation:'team.invite',email:'viewer@example.test',role:'viewer',scope:'all'},a.owner)).status,303);assert.equal((await add({},await a.accept('viewer@example.test'))).status,403)
 await a.clock(T);const made=await add({});assert.equal(made.status,200);const secret=(await made.text()).match(/data-webhook-secret>(vane_wh_[0-9a-f]{64})</)[1]
 assert.ok(!(await (await a.request(`/app/sites/${id}?section=settings`,owner)).text()).includes(secret),'shown once');assert.ok(!JSON.stringify(await a.dump()).includes(secret),'sealed')
 const received=[];let fail=1
 a.fixtureSites['https://hooks.fixture.example']=async request=>{const body=await request.text(),[,ts,v1]=request.headers.get('vane-signature').match(/^t=(\d+),v1=([0-9a-f]{64})$/);received.push({delivery:request.headers.get('vane-delivery'),event:request.headers.get('vane-event'),body:JSON.parse(body),valid:createHmac('sha256',secret).update(`${ts}.${body}`).digest('hex')===v1});return new Response(null,{status:fail-->0?500:204})}
 // A burst: three signups in the 10:00 minute and one in 10:01.
 const load=async(at,n)=>{await a.clock(at);assert.equal((await a.post('/api/vane/collect',a.event(id,{path:'/thanks'}),'',{origin:'https://fern.example','cf-connecting-ip':'203.0.113.'+n,'user-agent':'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36'})).status,202)}
 for(const [n,s] of [[1,5],[2,20],[3,40],[4,90]])await load(T+s*1000,n)
 await a.clock(T+125000);await a.scheduled()
 assert.equal(received.length,2);assert.ok(received.every(r=>r.valid&&r.event==='goal.conversions'))
 await a.scheduled();assert.equal(received.length,2,'a failed delivery waits a minute before its retry')
 await a.clock(T+125000+61000);await a.scheduled();assert.equal(received.length,3)
 const failed=received[0].delivery;assert.equal(received[2].delivery,failed,'the retry carries the same delivery ID')
 const delivered=received.slice(1);assert.deepEqual(delivered.map(r=>[r.body.minute,r.body.goal,r.body.count]).sort(),[['2026-03-10T10:00:00.000Z','signup',3],['2026-03-10T10:01:00.000Z','signup',1]])
 assert.ok(received.every(r=>Object.keys(r.body).sort().join()===['count','event','goal','minute','site_id'].join()),'counts only, never per person')
 await a.clock(T+600000);await a.scheduled();assert.equal(received.length,3,'each delivery succeeds once')
 const log=await (await a.request(`/app/sites/${id}?section=settings`,owner)).text();assert.match(log,/<td class="vane-number">500<\/td><td>HTTP 500; retry in 1 min<\/td>/);assert.equal((log.match(/<td>delivered<\/td>/g)??[]).length,2)
 assert.ok(a.egress.every(url=>url.startsWith('https://hooks.fixture.example/')||url.includes('resend')),'deliveries go only to the endpoint')
 const hook=(await a.dump()).vane_webhooks[0].id;assert.equal((await a.form({operation:'webhook.delete',id:hook},a.owner)).status,303);assert.ok((await a.dump()).vane_audit.some(e=>e.action==='webhook.delete'))
})
test('REPORT-001 two weekly subscribers get the Monday 8:00 New York report once each across a daylight-saving change with the dashboard\'s figures, one-click unsubscribe stops it, temporary failures retry after 15 minutes and 2 hours, four failures show as failed, a rejected message is not retried, and later signed provider bounces and complaints show on the sends and stop further reports to that address',async t=>{
 const key=`whsec_${Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString('base64')}`,a=await installation({vars:{MAIL_WEBHOOK_KEY:key}});t.after(()=>a.close())
 const owner={headers:{cookie:a.owner}},id=await a.addSite({paths:[],timeZone:'America/New_York',goals:{signup:'/thanks'}})
 for(const [n,at,path] of [[1,'2026-02-24T15:00:00Z','/'],[2,'2026-02-25T16:00:00Z','/pricing'],[2,'2026-02-25T16:02:00Z','/thanks'],[3,'2026-02-27T18:00:00Z','/'],[4,'2026-03-04T15:00:00Z','/']]){await a.clock(Date.parse(at));assert.equal((await a.post('/api/vane/collect',a.event(id,{path}),'',{origin:'https://fern.example','cf-connecting-ip':'203.0.113.'+n,'user-agent':'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36'})).status,202)}
 // The mail provider's edge: each address gets the statuses queued for it, then 200.
 const mails=[],plan={'retry@client.example':[500,500],'down@client.example':[500,500,500,500],'gone@client.example':[422]}
 a.fixtureSites['https://api.resend.com']=async request=>{const body=await request.json(),to=body.to[0];if(!/ report, /.test(body.subject)){a.sentMail.push(body);return Response.json({id:crypto.randomUUID()})}const status=plan[to]?.shift()??200,mid=crypto.randomUUID();mails.push({to,subject:body.subject,text:body.text,key:request.headers.get('idempotency-key'),status,mid});return status===200?Response.json({id:mid}):Response.json({message:'refused'},{status})}
 const subscribe=body=>a.form({operation:'report.subscribe',siteId:id,frequency:'weekly',weekday:'1',hour:'8',...body},a.owner),at=async iso=>{await a.clock(Date.parse(iso));await a.scheduled()},to=address=>mails.filter(m=>m.to===address)
 await a.clock(Date.parse('2026-02-27T20:00:00Z'));assert.equal((await subscribe({})).status,303);assert.equal((await subscribe({email:'cfo@client.example'})).status,303)
 assert.equal((await a.form({operation:'team.invite',email:'viewer@example.test',role:'viewer',scope:'all'},a.owner)).status,303)
 // Monday 2 March, 8:00 EST is 13:00 UTC.
 await at('2026-03-02T12:58:00Z');assert.equal(mails.length,0,'not before the local hour')
 await at('2026-03-02T13:01:00Z');assert.deepEqual(mails.map(m=>m.to).sort(),['cfo@client.example','owner@example.test'])
 const week=await (await a.request(`/api/vane/summary?siteId=${id}&from=2026-02-23&to=2026-03-02&compare=previous`,owner)).json()
 for(const m of mails){assert.match(m.subject,/weekly report, 2026-02-23 to 2026-03-01/);for(const line of [`Visitors: ${week.visitors}`,`Visits: ${week.visits}`,`Pageviews: ${week.pageviews}`,`Goal conversions: ${week.goals}`,'- /pricing: 1 pageviews','Unsubscribe with one click: '])assert.ok(m.text.includes(line),line)}
 await at('2026-03-02T13:06:00Z');await at('2026-03-03T13:01:00Z');await at('2026-03-07T13:01:00Z');assert.equal(mails.length,2,'once each, and on no other day')
 // After the change to daylight time (8 March), 8:00 EDT is 12:00 UTC.
 await at('2026-03-09T11:58:00Z');assert.equal(mails.length,2);await at('2026-03-09T12:01:00Z');assert.equal(mails.length,4);assert.ok(mails.slice(2).every(m=>/2026-03-02 to 2026-03-08/.test(m.subject)))
 const link=new URL(to('cfo@client.example').at(-1).text.match(/Unsubscribe with one click: (\S+)/)[1]);assert.equal((await a.request(link.pathname)).status,200);assert.equal((await a.request(link.pathname)).status,404)
 await at('2026-03-16T12:01:00Z');assert.deepEqual(mails.slice(4).map(m=>m.to),['owner@example.test'],'unsubscribed recipients get no more')
 // Daily reports at 6:00 (10:00 UTC): temporary failures retry after 15 minutes and 2 hours with the same delivery ID.
 for(const email of ['retry@client.example','down@client.example','gone@client.example'])assert.equal((await subscribe({email,frequency:'daily',hour:'6'})).status,303)
 await at('2026-03-17T10:01:00Z');await at('2026-03-17T10:17:00Z');await at('2026-03-17T12:16:00Z');assert.equal(to('retry@client.example').length,2,'the third attempt waits 2 hours');await at('2026-03-17T12:18:00Z')
 assert.deepEqual(to('retry@client.example').map(m=>m.status),[500,500,200]);assert.equal(new Set(to('retry@client.example').map(m=>m.key)).size,1,'one delivery ID across attempts')
 assert.deepEqual(to('gone@client.example').map(m=>m.status),[422],'a rejected message is not retried')
 await at('2026-03-18T00:17:00Z');assert.equal(to('down@client.example').length,3,'the fourth attempt waits 12 hours');await at('2026-03-18T00:19:00Z');assert.deepEqual(to('down@client.example').map(m=>m.status),[500,500,500,500])
 const sends=await (await a.request(`/app/sites/${id}?section=settings`,owner)).text()
 assert.match(sends,/<td>down@client\.example<\/td><td>Mar 16, 2026<\/td><td>failed<\/td><td class="vane-number">4<\/td><td>temporary failure \(uncertain\) on all 4 attempts<\/td>/)
 assert.match(sends,/<td>gone@client\.example<\/td><td>[^<]*<\/td><td>failed<\/td><td class="vane-number">1<\/td><td>rejected by the mail provider[^<]*; not retried<\/td>/)
 assert.match(sends,/<td>retry@client\.example<\/td><td>[^<]*<\/td><td>sent<\/td><td class="vane-number">3<\/td>/)
 // Only the owner adds an external recipient; a viewer subscribes their own address.
 const viewer=await a.accept('viewer@example.test');assert.equal((await a.form({operation:'report.subscribe',siteId:id,frequency:'weekly',weekday:'1',hour:'8',email:'someone@client.example'},viewer)).status,403);assert.equal((await a.form({operation:'report.subscribe',siteId:id,frequency:'monthly',weekday:'1',hour:'8'},viewer)).status,303)
 // Later provider events, signed as Resend signs them (Svix), reach /api/vane/mail-events through the installation's key.
 let now=Date.parse('2026-03-18T00:19:00Z')
 const event=(type,mid,to,{id=crypto.randomUUID(),at=now,secret=key}={})=>{const raw=JSON.stringify({type,created_at:new Date(at).toISOString(),data:{email_id:mid,to:[to]}}),ts=Math.floor(now/1000);return {raw,headers:{'content-type':'application/json','svix-id':id,'svix-timestamp':String(ts),'svix-signature':`v1,${createHmac('sha256',Buffer.from(secret.slice(6),'base64')).update(`${id}.${ts}.${raw}`).digest('base64')}`}}}
 const deliver=e=>a.request('/api/vane/mail-events',{method:'POST',headers:e.headers,body:e.raw}),row=async email=>unlinked(await (await a.request(`/app/sites/${id}?section=settings`,owner)).text()).match(new RegExp(`<tr><td>[^<]*</td><td>${email.replace('.','\\.')}</td>.*?</tr>`,'g'))??[]
 const retried=to('retry@client.example').at(-1).mid
 assert.ok((await row('retry@client.example'))[0].includes('<td>no provider event yet</td>'),'connected, nothing reported yet')
 assert.equal((await deliver(event('email.delivered',retried,'retry@client.example',{secret:`whsec_${Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString('base64')}`}))).status,401,'a wrong signature is refused')
 assert.equal((await deliver(event('email.bounced',retried,'other@client.example'))).status,409,'an event must name the send\'s own address')
 assert.deepEqual(await (await deliver(event('email.bounced',crypto.randomUUID(),'owner@example.test'))).json(),{ok:true,kept:false,reason:'not a report email'})
 assert.equal((await deliver(event('email.delivered',retried,'retry@client.example'))).status,200)
 assert.match((await row('retry@client.example'))[0],/<td>sent<\/td><td class="vane-number">3<\/td><td><\/td><td>delivered to the recipient’s mail server \(provider event, Mar 18, 2026\)<\/td>/)
 // The provider reports a permanent bounce hours later: it shows on the send at once, and an identical retry changes nothing.
 now=Date.parse('2026-03-18T05:00:00Z');await a.clock(now);const bounce=event('email.bounced',retried,'retry@client.example',{id:'msg_bounce_1'})
 assert.equal((await deliver(bounce)).status,200);assert.equal((await deliver(bounce)).status,200)
 assert.equal((await deliver(event('email.complained',retried,'retry@client.example',{id:'msg_bounce_1'}))).status,409,'one provider event identity, one body')
 const settings=await (await a.request(`/app/sites/${id}?section=settings`,owner)).text()
 assert.match(settings,/<td>bounced permanently; reports to this address stopped \(provider event, Mar 18, 2026\)<\/td>/);assert.match(settings,/retry@client\.example: Daily at 06:00 <strong data-mail-stop>Reports stopped: the mail provider reported this address bounced permanently on Mar 18, 2026\.<\/strong>/)
 // A spam complaint on the owner's last weekly report stops theirs too; the next due sends fail at once, unsent, with the reason.
 assert.equal((await deliver(event('email.complained',to('owner@example.test').at(-1).mid,'owner@example.test'))).status,200)
 const before={retry:to('retry@client.example').length,owner:to('owner@example.test').length}
 await at('2026-03-18T10:01:00Z');await at('2026-03-23T12:01:00Z')
 assert.deepEqual({retry:to('retry@client.example').length,owner:to('owner@example.test').length},before,'no report email to a stopped address')
 assert.match((await row('retry@client.example'))[0],/<td>failed<\/td><td class="vane-number">0<\/td><td>not sent: the mail provider reported an earlier report email to this address bounced permanently on 2026-03-18; reports to it stopped<\/td>/)
 assert.match((await row('owner@example.test'))[0],/<td>failed<\/td><td class="vane-number">0<\/td><td>not sent: the mail provider reported an earlier report email to this address marked as spam on 2026-03-18; reports to it stopped<\/td>/)
 assert.ok(to('down@client.example').length>4,'other addresses keep their reports')
 assert.ok(!JSON.stringify(await a.dump()).includes(link.pathname.split('/').pop()),'only the unsubscribe token\'s hash is kept')
})
test('ALERT-001 a current-visitors alert above 50 is sent by email within 15 minutes of the crossing with the crossing and send times logged, sends once while the value stays past it, is held by its cool-down when it crosses again, only analysts and up set alerts, goes to the chosen people and signed webhooks, sleeps in quiet hours, and a segment alert counts only the segment\'s visits',async t=>{
 const a=await withApp(t),owner={headers:{cookie:a.owner}},id=await a.addSite({paths:[]}),T=Date.parse('2026-04-01T12:00:00Z')
 assert.equal((await a.form({operation:'team.invite',email:'analyst@example.test',role:'analyst',scope:'all'},a.owner)).status,303);assert.equal((await a.form({operation:'team.invite',email:'viewer@example.test',role:'viewer',scope:'all'},a.owner)).status,303)
 const analyst=await a.accept('analyst@example.test'),viewer=await a.accept('viewer@example.test'),add=(cookie,body={})=>a.form({operation:'alert.create',siteId:id,metric:'current',direction:'above',threshold:'50',cooldown:'6',...body},cookie)
 await a.clock(T);assert.equal((await add(viewer)).status,403,'a viewer cannot set alerts');assert.equal((await add(analyst)).status,303)
 assert.equal((await add(analyst,{threshold:'1.5'})).status,400,'whole numbers only')
 const visitors=async(from,n)=>{for(let i=0;i<n;i++)assert.equal((await a.post('/api/vane/collect',a.event(id,{path:'/'}),'',{origin:'https://fern.example','cf-connecting-ip':`198.51.${from}.${i}`,'user-agent':DESKTOP_CHROME})).status,202)}
 const alerts=()=>a.sentMail.filter(m=>/Current visitors above 50/.test(m.subject)),at=async ms=>{await a.clock(ms);await a.scheduled()}
 // 50 current visitors is not above 50; the 51st, at 12:01, crosses; the next 5-minute check sends it.
 await a.clock(T+60000);await visitors(1,50);await at(T+120000);assert.equal(alerts().length,0,'50 is not above 50')
 // An automated browser is excluded: the coverage count that changes is named in the message.
 await a.post('/api/vane/collect',a.event(id,{path:'/'}),'',{origin:'https://fern.example','cf-connecting-ip':'198.51.9.9','user-agent':'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/141.0.0.0 Safari/537.36'})
 await visitors(2,1);await at(T+300000);assert.equal(alerts().length,1);const [mail]=alerts()
 assert.deepEqual(mail.to,['analyst@example.test']);assert.match(mail.text,/Fern Studio: Current visitors above 50\. Now 51\. What moved against the same window a week before: .*Device desktop: 0 → 51 unique visitors/);assert.match(mail.text,/Coverage that day against a week before: [a-z -]+ 0 → 1\./)
 const settings=async()=>unlinked(await (await a.request(`/app/sites/${id}?section=settings`,owner)).text())
 assert.match(await settings(),/<tr><td>Apr 1, 2026, 12:05\sPM<\/td><td>Current visitors above 50<\/td><td class="vane-number">51<\/td><td>Apr 1, 2026, 12:05\sPM<\/td><td>sent: email accepted by the mail provider for one person; push accepted by 0 browsers<\/td><\/tr>/)
 const [log]=(await a.dump()).vane_alert_log;assert.ok(log.sent_at-(T+120000)<=15*60000,'sent within 15 minutes of the crossing')
 // Still above at the next checks: no repeat. The visitors leave (none current after 5 minutes), then 51 return within the cool-down.
 await at(T+600000);assert.equal(alerts().length,1,'once while it stays past the threshold')
 await at(T+1200000);await a.clock(T+1260000);await visitors(3,51);await at(T+1500000);assert.equal(alerts().length,1,'held by the 6-hour cool-down')
 assert.match(await settings(),/<td class="vane-number">51<\/td><td>not sent<\/td><td>held: cool-down of 6 h since the last send<\/td>/)
 // Recipients: the owner sends a pageviews alert to the analyst and the site's signed webhooks; another alert sleeps in quiet hours.
 const hooks=[];a.fixtureSites['https://hooks.fixture.example']=async request=>{hooks.push({headers:Object.fromEntries(request.headers),body:await request.text()});return new Response(null,{status:204})}
 assert.equal((await a.form({operation:'webhook.create',siteId:id,url:'https://hooks.fixture.example/vane','event_traffic.alert':'on'},a.owner)).status,200)
 const analystId=(await a.dump()).oa_operators.find(o=>o.email==='analyst@example.test').id
 assert.equal((await add(analyst,{metric:'pageviews',threshold:'150',webhooks:'on'})).status,403,'only admins and the owner send alerts to webhooks')
 assert.equal((await add(a.owner,{metric:'pageviews',threshold:'150',[`person_${analystId}`]:'on',webhooks:'on'})).status,303)
 assert.equal((await add(a.owner,{metric:'pageviews',threshold:'150',quietFrom:'12:00',quietTo:'13:00'})).status,303)
 await a.clock(T+1560000);await visitors(4,51);await at(T+1620000);await at(T+1920000)
 const pageviewMails=a.sentMail.filter(m=>/Pageviews in the last 60 minutes above 150/.test(m.subject));assert.deepEqual(pageviewMails.map(m=>m.to[0]),['analyst@example.test'],'the chosen person, not the creator; the quiet alert sends nothing')
 assert.equal(hooks.length,1);const hook=JSON.parse(hooks[0].body);assert.deepEqual([hooks[0].headers['vane-event'],hook.event,hook.alert,hook.value,hook.bound],['traffic.alert','traffic.alert','Pageviews in the last 60 minutes above 150',153,'150'])
 assert.match(hooks[0].headers['vane-signature'],/^t=\d+,v1=[0-9a-f]{64}$/);assert.deepEqual(Object.keys(hook).sort(),['alert','bound','condition','direction','event','metric','seen_at','site_id','value'],'no visitor field')
 assert.match(await settings(),/held: quiet hours \(12:00–13:00\)/)
 // A segment alert counts only the segment's visits: 24 site visits cross 20 but 19 blog visits do not; 21 do.
 const saved=await a.form({operation:'segment.save',siteId:id,name:'Blog readers',filters:'page:contains:/blog'},a.owner),segmentId=new URL(saved.headers.get('location'),a.origin).searchParams.get('segment')
 assert.equal((await add(a.owner,{metric:'visits',threshold:'20',segment:segmentId})).status,303);assert.equal((await add(a.owner,{metric:'visits',threshold:'20'})).status,303)
 const blog=async(from,n,path)=>{for(let i=0;i<n;i++)assert.equal((await a.post('/api/vane/collect',a.event(id,{path}),'',{origin:'https://fern.example','cf-connecting-ip':`198.51.${from}.${i}`,'user-agent':DESKTOP_CHROME})).status,202)}
 await a.clock(T+2*3600000);await blog(5,19,'/blog/launch');await blog(7,5,'/pricing');await at(T+2*3600000+60000);assert.equal(a.sentMail.filter(m=>/Visits in the last 60 minutes above 20/.test(m.subject)).length,1,'the whole site crosses 20 visits; the segment does not')
 await blog(6,2,'/blog/launch');await at(T+2*3600000+120000);assert.equal(a.sentMail.filter(m=>/Visits in the last 60 minutes above 20/.test(m.subject)).length,2,'21 blog visits cross the segment alert')
 assert.match(a.sentMail.at(-1).text,/Now 21\. What moved/)
 const alert=(await a.dump()).vane_alerts[0];assert.equal((await a.form({operation:'alert.delete',id:alert.id},viewer)).status,403);assert.equal((await a.form({operation:'alert.delete',id:alert.id},analyst)).status,303)
 assert.ok((await a.dump()).vane_audit.some(e=>e.action==='alert.create')&&(await a.dump()).vane_audit.some(e=>e.action==='alert.delete'),'setting and deleting alerts are audited')
})
test('ALERT-001 against eight weeks of baseline traffic a 4x spike and a 70% drop alert once each against the same weekday and hour, the cool-down holds a repeat, a Thanksgiving dip is held, and a drop inside a recurring Saturday 2:00-3:00 maintenance window or an Uptime window is held while the same drop at 4:00 alerts, a closed day in the business calendar is held and left out of baselines, held drops show on the chart, and each message names its largest movers',async t=>{
 const a=await withApp(t),owner={headers:{cookie:a.owner}},id=await a.addSite({paths:[]}),HOUR=3600000
 let ip=0;const pageviews=async(iso,n)=>{await a.clock(Date.parse(iso));for(let i=0;i<n;i++)assert.equal((await a.post('/api/vane/collect',a.event(id,{path:'/'}),'',{origin:'https://fern.example','cf-connecting-ip':`198.51.${100+(ip>>8)%50}.${ip++%256}`,'user-agent':DESKTOP_CHROME})).status,202)}
 const usual=[6,7,5,6,8,6,5,7],day=(from,weeks)=>new Date(Date.parse(from)+weeks*7*86400000).toISOString().slice(0,10)
 // Baselines: Thursdays 27 Aug to 19 Nov 2026 at 10:00 and 14:00 UTC, Saturdays 29 Aug to 17 Oct at 2:00 and 4:00.
 for(let w=0;w<13;w++){const d=day('2026-08-27',w);for(const h of ['10','14'])if(!(d==='2026-10-22'&&h==='10'||['2026-11-05','2026-11-12'].includes(d)&&h==='14'))await pageviews(`${d}T${h}:10:00Z`,usual[w%8])}
 for(let w=0;w<8;w++)for(const h of ['02','04'])await pageviews(`${day('2026-08-29',w)}T${h}:10:00Z`,usual[w%8])
 await a.clock(Date.parse('2026-10-20T00:00:00Z'))
 const add=body=>a.form({operation:'alert.create',siteId:id,metric:'pageviews',condition:'anomaly',cooldown:'6',...body},a.owner)
 assert.equal((await add({direction:'above'})).status,303);assert.equal((await add({direction:'below'})).status,303)
 assert.equal((await add({direction:'above',metric:'current'})).status,400,'current visitors take a fixed threshold')
 assert.equal((await a.form({operation:'maintenance.add',siteId:id,kind:'weekly',weekday:'6',from:'02:00',to:'03:00'},a.owner)).status,303)
 const sent=()=>a.sentMail.filter(m=>/usual range/.test(m.subject)).map(m=>m.subject),at=async iso=>{await a.clock(Date.parse(iso));await a.scheduled()}
 // Thursday 22 Oct, 10:00: 24 pageviews by 10:20 against a usual 6 or so: the running hour alerts once.
 await a.clock(Date.parse('2026-10-22T10:00:00Z'));await at('2026-10-22T10:05:00Z');await pageviews('2026-10-22T10:20:00Z',24);await at('2026-10-22T10:25:00Z');await at('2026-10-22T10:30:00Z')
 assert.deepEqual(sent(),['Fern Studio: Pageviews above the usual range for the weekday and hour'],'the spike alerts once')
 assert.match(a.sentMail.at(-1).text,/24 pageviews so far in Thursday 2026-10-22 10:00–11:00 \(UTC\); the usual range for this weekday and hour is \d+(\.\d)? to \d+(\.\d)?\./)
 // Like the report's explanation: the largest movers with their totals, against the same window a week before.
 assert.match(a.sentMail.at(-1).text,/What moved against the same window a week before: .*Page \/: 7 → 24 pageviews \(\+17, \+242\.9%\), of 7 → 24 pageviews in all/);assert.match(a.sentMail.at(-1).text,/Coverage that day against a week before: no coverage count changed\./)
 // A second spike at 12:00 the same day is inside the 6-hour cool-down: held, not sent.
 await pageviews('2026-10-22T12:10:00Z',24);await at('2026-10-22T12:15:00Z');assert.equal(sent().length,1,'the cool-down suppresses a repeat')
 // Saturday 24 Oct: 1 pageview at 2:00 (inside the maintenance window) is held; the same drop at 4:00 alerts.
 await pageviews('2026-10-24T02:10:00Z',1);await at('2026-10-24T03:05:00Z');assert.equal(sent().length,1,'held in maintenance')
 await pageviews('2026-10-24T04:10:00Z',1);await at('2026-10-24T05:05:00Z');assert.deepEqual(sent().slice(1),['Fern Studio: Pageviews below the usual range for the weekday and hour'])
 // Thursday 5 Nov, 14:00: 2 pageviews (a 70% drop) alert when the hour ends; Thanksgiving's empty 14:00 is held.
 await pageviews('2026-11-05T14:10:00Z',2);await at('2026-11-05T15:05:00Z');assert.equal(sent().length,3,'the drop alerts')
 // Uptime sends a maintenance window for Saturday 31 Oct 4:00-5:00 through the annotation door: the empty 4:00 is held.
 const created=await a.form({operation:'annotation-hook.create',siteId:id},a.owner),secret=(await created.text()).match(/data-annotation-secret>(vane_ah_[0-9a-f]{64})</)[1]
 const uptime=body=>a.request('/api/vane/annotations',{method:'POST',headers:{'content-type':'application/json',authorization:'Bearer '+secret},body:JSON.stringify({siteId:id,id:'uptime-mw-7',kind:'maintenance',title:'Database upgrade',...body})})
 assert.equal((await uptime({at:'2026-10-31T04:00:00Z'})).status,400,'a maintenance window needs its end')
 assert.equal((await uptime({at:'2026-10-31T04:00:00Z',until:'2026-10-31T05:00:00Z'})).status,201);assert.equal((await uptime({at:'2026-10-31T04:00:00Z',until:'2026-10-31T05:00:00Z'})).status,200,'a repeat is idempotent')
 await at('2026-10-31T05:05:00Z');assert.equal(sent().length,3,'held in the Uptime window')
 // Thursday 12 Nov is a closed day in the business calendar: its drop is held, and it leaves the baselines after it.
 assert.equal((await a.form({operation:'calendar.close',siteId:id,day:'2026-11-12',label:'Staff retreat'},a.owner)).status,303)
 await pageviews('2026-11-12T14:10:00Z',1);await at('2026-11-12T15:05:00Z');assert.equal(sent().length,3,'held on a closed day')
 await at('2026-11-26T15:05:00Z');assert.equal(sent().length,3,'the Thanksgiving dip does not alert')
 const log=unlinked(await (await a.request(`/app/sites/${id}?section=settings`,owner)).text())
 for(const outcome of ['held: cool-down of 6 h since the last send','held: scheduled maintenance (Saturdays 02:00–03:00)','held: Thanksgiving Day, a US federal holiday, is not judged against ordinary weeks'])assert.ok(log.includes(outcome),outcome)
 assert.match(log,/<td>Pageviews below the usual range for the weekday and hour<\/td><td class="vane-number">1<\/td><td>Oct 24, 2026, 5:05\sAM<\/td><td>sent: email accepted by the mail provider for one person; push accepted by 0 browsers; usual range [\d.]+ to [\d.]+ for Saturday 2026-10-24 04:00–05:00<\/td>/)
 assert.ok(log.includes('Saturdays 02:00–03:00')&&log.includes('2026-10-31 04:00–05:00'),'both windows are listed');assert.equal((await a.dump()).vane_alert_log.length,8)
 assert.ok(log.includes('held: Staff retreat, a closed day in the business calendar, is not judged against ordinary weeks'))
 // REPORT-003's normal-variation judgment uses the same calendar: the closed day is not judged and leaves the next week's baseline.
 const judged=(await (await a.request(`/api/vane/summary?siteId=${id}&from=2026-11-09&to=2026-11-21`,owner)).json()).explain.variation
 assert.deepEqual([judged.find(d=>d.day==='2026-11-12').closed,judged.find(d=>d.day==='2026-11-19').baselineDays],['Staff retreat',7])
 // Held drops show on the chart with their reason, beside Uptime's maintenance annotation.
 const notes=(await (await a.request(`/api/vane/summary?siteId=${id}&from=2026-10-20&to=2026-11-02`,owner)).json()).explain.annotations
 assert.deepEqual(notes.filter(n=>['alert-held','maintenance'].includes(n.kind)).map(n=>[n.day,n.kind,n.text]),[['2026-10-24','alert-held','Pageviews below the usual range for the weekday and hour held: scheduled maintenance (Saturdays 02:00–03:00).'],['2026-10-31','maintenance','Database upgrade'],['2026-10-31','alert-held','Pageviews below the usual range for the weekday and hour held: scheduled maintenance (2026-10-31 04:00–05:00).']])
})
test('FOLLOW-001 a drop alert left unacknowledged reminds once and escalates once, acknowledging and resolving it as a tracking fault stops reminders and records who, when and the outcome, due times count business hours, and the owner can end the policy',async t=>{
 const a=await withApp(t),owner={headers:{cookie:a.owner}},id=await a.addSite({paths:[]}),at=async iso=>{await a.clock(Date.parse(iso));await a.scheduled()}
 assert.equal((await a.form({operation:'team.invite',email:'analyst@example.test',role:'analyst',scope:'all'},a.owner)).status,303);const analyst=await a.accept('analyst@example.test')
 const {oa_operators:operators}=await a.dump(),analystId=operators.find(o=>o.email==='analyst@example.test').id,ownerId=operators.find(o=>o.email==='owner@example.test').id
 // Items are read from the site's settings page: each with its state, responsible person, next action and due time (UTC).
 const items=async()=>[...(await (await a.request(`/app/sites/${id}?section=settings`,owner)).text()).matchAll(/<li data-follow-item="([^"]+)" data-state="([a-z]+)"><strong>[^<]*<\/strong>: ([^\n]*)/g)].map(m=>({id:m[1],state:m[2],text:m[3]}))
 const hooks=[];a.fixtureSites['https://hooks.fixture.example']=async request=>{hooks.push(JSON.parse(await request.text()));return new Response(null,{status:204})}
 await a.clock(Date.parse('2026-04-06T09:00:00Z'))
 assert.equal((await a.form({operation:'webhook.create',siteId:id,url:'https://hooks.fixture.example/vane','event_follow.change':'on'},a.owner)).status,200)
 assert.equal((await a.form({operation:'follow.policy',siteId:id,remind:'1',escalate:'2',second:analystId,start:'9',end:'17'},analyst)).status,403,'the policy is the owner\'s')
 assert.equal((await a.form({operation:'follow.policy',siteId:id,remind:'1',escalate:'2',second:analystId,start:'9',end:'17'},a.owner)).status,303)
 // Current visitors drop below 1 (no one on the site) on Monday 6 April at 10:00 UTC: the alert opens an item.
 assert.equal((await a.form({operation:'alert.create',siteId:id,metric:'current',direction:'below',threshold:'1',cooldown:'1'},a.owner)).status,303)
 await at('2026-04-06T10:01:00Z');const [item]=await items();assert.equal(item.state,'open');assert.match(item.text,/responsible Site owner; next: Acknowledge and check the change, due Apr 6, 2026, 11:01\sAM UTC/)
 const mails=subject=>a.sentMail.filter(m=>m.subject===`Fern Studio: ${subject}`).map(m=>m.to[0])
 await at('2026-04-06T10:59:00Z');assert.deepEqual(mails('Follow-up reminder'),[])
 await at('2026-04-06T11:02:00Z');await at('2026-04-06T11:30:00Z');assert.deepEqual(mails('Follow-up reminder'),['owner@example.test'],'one reminder to the responsible person')
 await at('2026-04-06T12:02:00Z');await at('2026-04-06T12:30:00Z');assert.deepEqual(mails('Follow-up escalation'),['analyst@example.test'],'one escalation to the second recipient')
 assert.equal((await items())[0].state,'open','notifications never close an item')
 assert.equal((await a.form({operation:'follow.assign',id:item.id,to:analystId},a.owner)).status,303);assert.match((await items())[0].text,/responsible analyst;/)
 assert.equal((await a.form({operation:'follow.assign',id:item.id,to:ownerId},a.owner)).status,303)
 // Acknowledge, comment and resolve it as a tracking fault; no reminder follows.
 for(const body of [{operation:'follow.ack'},{operation:'follow.comment',text:'Script tag was dropped by the CMS update.'},{operation:'follow.resolve',outcome:'tracking-fault'}])assert.equal((await a.form({id:item.id,...body},a.owner)).status,303)
 assert.equal((await a.form({operation:'follow.resolve',id:item.id,outcome:'expected'},a.owner)).status,409,'resolved once')
 await at('2026-04-06T15:00:00Z');assert.equal(mails('Follow-up reminder').length+mails('Follow-up escalation').length,2,'reminders stop')
 const page=await (await a.request(`/app/sites/${id}?section=settings`,owner)).text()
 assert.match(page,/data-state="resolved"><strong>Current visitors below 1<\/strong>: resolved, Tracking fault fixed by Site owner at Apr 6, 2026, 12:30\sPM UTC/,'who resolved it, when and with what outcome');assert.ok(page.includes('acknowledge, acknowledged')&&page.includes('comment, Script tag was dropped by the CMS update.'))
 assert.deepEqual(hooks.map(h=>h.action),['open','remind','escalate','assign','assign','acknowledge','comment','resolve']);assert.deepEqual(Object.keys(hooks.at(-1)).sort(),['action','alert','at','event','item_id','outcome','site_id','state']);assert.equal(hooks.at(-1).outcome,'tracking-fault')
 // An alert at 16:30 on Friday is due an hour of business time later: 9:30 on Monday. The owner ends the policy: no reminder.
 await a.clock(Date.parse('2026-04-10T16:00:00Z'));assert.equal((await a.collect(a.event(id,{path:'/'}))).status,202);await at('2026-04-10T16:02:00Z');await at('2026-04-10T16:30:00Z')
 const second=(await items()).find(i=>i.id!==item.id);assert.match(second.text,/due Apr 13, 2026, 9:30\sAM UTC/)
 assert.equal((await a.form({operation:'follow.policy',siteId:id,remind:'1',escalate:'2',second:analystId,start:'9',end:'17',ended:'on'},a.owner)).status,303)
 await at('2026-04-13T12:00:00Z');assert.equal(mails('Follow-up reminder').length,1,'an ended policy reminds no one');assert.equal((await items()).find(i=>i.id===second.id).state,'open')
})

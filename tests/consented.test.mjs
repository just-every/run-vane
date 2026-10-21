import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { chromium } from '@playwright/test'
import { installation } from './harness.mjs'

const json=async r=>{assert.equal(r.status,200,await r.clone().text());return r.json()}
test('METRIC-005: approved consented mode, returning cohorts, attribution, cross-visit funnels and browser revocation',async t=>{
 const a=await installation();t.after(()=>a.close())
 const at=day=>Date.parse(day+'T12:00:00Z'),first=at('2026-10-05'),origin='https://synthetic-vane-1.test'
 await a.clock(first)
 const config={paths:[],goals:{purchase:'/thanks'},consent:'not-required',sampleRate:100,retentionDays:365,timeZone:'UTC',funnels:[{name:'checkout',steps:['/product','goal:purchase'],crossVisit:true}],experiments:[{name:'product',page:'/product',goal:'purchase',variants:['control','alternative']}],publicReports:['totals']}
 const siteId=await a.addSite({name:'synthetic-vane-1',origin,...config})
 const publicConfig=()=>a.request('/api/vane/config/'+siteId,{headers:{origin}})
 const before=await(await publicConfig()).text()
 const admin=await a.invite('synthetic-vane-2@example.test','admin')
 const input={siteId,name:'synthetic-vane-1',origin,config:{...config,consentedVisitors:true,consentLifetimeMonths:13}}
 assert.equal((await a.post('/api/vane/commands',{command:'site.configure',input:{...input,config:{...input.config,consentLifetimeMonths:14}}},a.owner)).status,400)
 const proposal=await a.post('/api/vane/commands',{command:'site.configure',input},admin);assert.equal(proposal.status,201);const prepared=await proposal.json()
 assert.equal(await(await publicConfig()).text(),before,'preparing an opt-in does not offer it')
 assert.equal((await a.form({operation:'proposal.approve',id:prepared.id},admin)).status,403)
 assert.equal((await a.form({operation:'proposal.approve',id:prepared.id},a.owner)).status,303)
 assert.equal((await a.form({operation:'proposal.approve',id:prepared.id},a.owner)).status,409)
 const c=await json(await publicConfig());assert.equal(c.consentedVisitors,true);assert.equal(c.consentLifetimeMonths,13)
 assert.ok(!('funnels' in c)&&!('goals' in c)&&!('retentionDays' in c),'public config exposes only tracker settings')
 const token={id:crypto.randomUUID(),createdAt:first},second={id:crypto.randomUUID(),createdAt:first}
 const load=async(day,path,identity,extra={})=>{await a.clock(at(day));const page=a.event(siteId,{path,...(identity?{consented:identity,consent:'granted'}:{}),...extra});const r=await a.collect(page,origin);assert.equal(r.status,202,await r.clone().text());return {page,result:await r.json()}}
 const expose=async page=>{const r=await a.post('/api/vane/exposure',{siteId,page:page.id,experiment:'product',consent:'granted'},'',{origin});assert.equal(r.status,202);return r.json()}
 const one=await load('2026-10-05','/product',token,{source:'synthetic-vane-3.test'});const exposure1=await expose(one.page)
 await load('2026-10-05','/product',second)
 await load('2026-10-05','/product',null)
 assert.equal((await a.post('/api/vane/custom',{siteId,page:one.page.id,id:crypto.randomUUID(),name:'synthetic-vane-8',consent:'not-required'},'',{origin})).status,403,'a custom event cannot inherit a consented page without a current grant')
 assert.equal((await a.collect(a.event(siteId,{consented:token}),origin)).status,403,'not-required is not an explicit grant')
 assert.equal((await a.collect(a.event(siteId,{consented:{...token,id:'synthetic-vane-4'},consent:'granted'}),origin)).status,400)
 const three=await load('2026-10-07','/product',token,{source:'direct'});const exposure3=await expose(three.page)
 assert.equal(three.result.experiments.product,one.result.experiments.product);assert.equal(exposure1.variant,exposure3.variant)
 await load('2026-10-07','/thanks',token,{source:'direct'})
 await load('2026-10-12','/product',token,{source:'direct'})
 await load('2026-10-12','/product',null)
 const query=`siteId=${siteId}&from=2026-10-05&to=2026-10-13`,report=await json(await a.request('/api/vane/summary?'+query,{headers:{cookie:a.owner}}))
 assert.equal(report.visitors,4,'one linked visitor across days, a second device, and two cookie-free daily uniques')
 assert.deepEqual([report.consented.visitors,report.consented.newVisitors,report.consented.returningVisitors,report.consented.consentedPageviews,report.consented.pageviews,report.consented.share],[2,2,1,5,7,71.4])
 assert.deepEqual(report.consented.cohorts[0].weeks.map(w=>[w.week,w.returning,w.retention]),[[0,2,100],[1,1,50]])
 const cohortCsv=await a.request('/api/vane/csv?'+query+'&table=consentedCohorts',{headers:{cookie:a.owner}});assert.equal(cohortCsv.status,200);assert.match(await cohortCsv.text(),/2026-10-05,2,2,1,50,false/,'cohort CSV matches the report without identifiers')
 const attributionCsv=await a.request('/api/vane/csv?'+query+'&table=consentedAttribution',{headers:{cookie:a.owner}});assert.equal(attributionCsv.status,200);assert.match(await attributionCsv.text(),/synthetic-vane-3.test/);
 assert.equal(report.funnels[0].steps[1].visits,1,'product on day 1 and purchase on day 3 completes across visits')
 assert.ok(report.consented.attribution.some(r=>r.model==='First touch'&&r.source==='synthetic-vane-3.test'&&r.conversions===1))
 assert.ok(report.consented.attribution.some(r=>r.model==='Last non-direct touch'&&r.source==='synthetic-vane-3.test'&&r.conversions===1))
 assert.equal(report.experiments[0].variants.reduce((n,r)=>n+r.conversions,0),1)
 const week2=await json(await a.request(`/api/vane/summary?siteId=${siteId}&from=2026-10-12&to=2026-10-13`,{headers:{cookie:a.owner}}));assert.equal(week2.consented.returningVisitors,1);assert.equal(week2.consented.newVisitors,0)
 const dump=await a.dump(),events=dump.vane_events.filter(e=>e.site_id===siteId&&e.kind==='pageview')
 assert.equal(new Set(events.filter(e=>e.consented_visitor).map(e=>e.consented_visitor)).size,2)
 assert.ok(events.every(e=>!e.consented_visitor||/^[a-f0-9]{64}$/.test(e.consented_visitor)))
 assert.ok(!JSON.stringify(dump).includes(token.id)&&!JSON.stringify(report).includes(events[0].consented_visitor),'raw device ID is never persisted and digests are never reported')
 assert.ok(dump.vane_audit.some(r=>r.action==='settings.change'&&r.subject===siteId))
 const other=await a.addSite({name:'synthetic-vane-5',origin:'https://synthetic-vane-5.test',paths:[],goals:{},consentedVisitors:true,consentLifetimeMonths:1})
 assert.equal((await a.collect(a.event(other,{consented:token,consent:'granted'}),'https://synthetic-vane-5.test')).status,202)
 const different=(await a.dump()).vane_events.find(e=>e.site_id===other);assert.notEqual(different.consented_visitor,events[0].consented_visitor,'same supplied ID cannot link sites')
 await a.clock(at('2026-11-06'));assert.equal((await a.collect(a.event(other,{consented:token,consent:'granted'}),'https://synthetic-vane-5.test')).status,400,'server enforces owner lifetime')
 const required=await a.addSite({name:'synthetic-vane-9',origin:'https://synthetic-vane-9.test',paths:[],goals:{},consent:'required',consentedVisitors:true});assert.equal((await a.collect(a.event(required),'https://synthetic-vane-9.test')).status,403,'consent-required sites still refuse unknown or denied consent')
 const method=await(await a.request('/methodology')).text();assert.match(method,/1 to 13 calendar months/);assert.doesNotMatch(method,/Consented mode does not exist yet/)
 const publicPage=await(await a.request(`/stats/${siteId}?from=2026-10-05&to=2026-10-13`)).text();assert.doesNotMatch(publicPage,/data-consented-cohorts|data-consented-attribution|consented_visitor/)
 const archive=await a.archive();assert.ok(!JSON.stringify(archive).includes(token.id));assert.ok(archive.payload.tables.vane_events.some(e=>e.consented_visitor===events[0].consented_visitor),'history archives preserve only site digests')
 // Real script, real endpoints. The browser clock matches the installation clock; only the network edge is adapted.
 const browser=await chromium.launch({headless:true,args:['--use-mock-keychain','--password-store=basic']});t.after(()=>browser.close())
 const context=await browser.newContext({userAgent:'Mozilla/5.0 synthetic-vane-6 browser'}),requests=[]
 await context.addInitScript(({now})=>{const NativeDate=Date;window.Date=class extends NativeDate{constructor(...args){super(...(args.length?args:[now]))}static now(){return now}};window.vaneConsent=true},{now:first})
 await context.route('**/*',async route=>{
  const request=route.request(),u=new URL(request.url())
  if(u.origin===origin)return route.fulfill({contentType:'text/html',body:`<html><body><p>synthetic-vane-7</p><script src="${a.origin}/vane.js" data-site="${siteId}"></script></body></html>`})
  if(u.origin!==a.origin)return route.abort()
  const path=u.pathname+u.search,body=request.postDataBuffer()??undefined;requests.push({path,body:body?JSON.parse(body.toString()):null})
  const r=await a.request(path,{method:request.method(),headers:request.headers(),body});await route.fulfill({status:r.status,headers:Object.fromEntries(r.headers),body:Buffer.from(await r.arrayBuffer())})
 })
 await a.clock(first);const page=await context.newPage(),loaded=page.waitForResponse(r=>r.url().includes('/api/vane/collect')&&r.status()===202);await page.goto(origin+'/product');await loaded;await page.waitForFunction(()=>localStorage.length===1)
 const key='vane_consent_'+siteId,stored=await page.evaluate(key=>JSON.parse(localStorage.getItem(key)),key);assert.ok(stored.id)
 await page.evaluate(()=>vane('consent',false));assert.equal(await page.evaluate(key=>localStorage.getItem(key),key),null,'revoke deletes immediately')
 const beforeRevoke=requests.filter(r=>r.path==='/api/vane/collect').length
 const revokedLoad=page.waitForResponse(r=>r.url().includes('/api/vane/collect'));await page.evaluate(()=>vane('pageview',{url:'/after-revoke'}));await revokedLoad
 const after=requests.filter(r=>r.path==='/api/vane/collect');assert.equal(after.length,beforeRevoke+1);assert.equal(after.at(-1).body.consented,undefined);assert.equal(after.at(-1).body.consent,'not-required')
 await page.evaluate(()=>vane('consent',true));const regrantedLoad=page.waitForResponse(r=>r.url().includes('/api/vane/collect'));await page.evaluate(()=>vane('pageview',{url:'/new-grant'}));await regrantedLoad
 assert.notEqual(await page.evaluate(key=>JSON.parse(localStorage.getItem(key)).id,key),stored.id,'a new grant never resurrects the revoked identity')
 await context.addInitScript(()=>Object.defineProperty(navigator,'globalPrivacyControl',{get:()=>true}));await page.reload();assert.equal(await page.evaluate(key=>localStorage.getItem(key),key),null,'GPC clears existing storage')
 // The new authenticated panels use the established responsive report/settings components.
 await context.addCookies(a.owner.split('; ').map(pair=>{const i=pair.indexOf('=');return {name:pair.slice(0,i),value:pair.slice(i+1),url:a.origin}}))
 await a.clock(at('2026-10-14'))
 for(const width of [1440,390]){
  await page.setViewportSize({width,height:1000});await page.goto(`${a.origin}/app/sites/${siteId}?from=2026-10-05&to=2026-10-13`)
  await page.getByRole('heading',{name:'Consented visitors',exact:true}).evaluate(el=>el.scrollIntoView({block:'start'}));await page.evaluate(()=>scrollBy(0,-80));assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true)
  if(process.env.VANE_SCREEN_DIR){await mkdir(process.env.VANE_SCREEN_DIR,{recursive:true});await page.screenshot({path:join(process.env.VANE_SCREEN_DIR,`consented-report-${width}.png`)})}
  await page.locator('[data-funnel="checkout"]').evaluate(el=>el.scrollIntoView({block:'start'}));await page.evaluate(()=>scrollBy(0,-80))
  if(process.env.VANE_SCREEN_DIR)await page.screenshot({path:join(process.env.VANE_SCREEN_DIR,`consented-funnel-${width}.png`)})
  await page.goto(`${a.origin}/app/sites/${siteId}?section=settings`);assert.equal(await page.getByLabel('Consented identifier lifetime (months)',{exact:true}).inputValue(),'13')
  await page.getByLabel('Enable consented visitors after explicit analytics consent (off by default)').scrollIntoViewIfNeeded();assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true)
  if(process.env.VANE_SCREEN_DIR)await page.screenshot({path:join(process.env.VANE_SCREEN_DIR,`consented-settings-${width}.png`)})
  await page.getByRole('row').filter({has:page.getByRole('cell',{name:'Consented visitor linkage',exact:true})}).evaluate(el=>el.scrollIntoView({block:'start'}));await page.evaluate(()=>scrollBy(0,-80))
  if(process.env.VANE_SCREEN_DIR)await page.screenshot({path:join(process.env.VANE_SCREEN_DIR,`consented-inventory-${width}.png`)})
  await page.goto(`${a.origin}/methodology#consented-mode`);await page.locator('#consented-mode').evaluate(el=>el.scrollIntoView({block:'start'}));await page.evaluate(()=>scrollBy(0,-40));assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true)
  if(process.env.VANE_SCREEN_DIR)await page.screenshot({path:join(process.env.VANE_SCREEN_DIR,`consented-methodology-${width}.png`)})
 }
 await browser.close()
})

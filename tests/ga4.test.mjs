import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdir } from 'node:fs/promises'
import { chromium } from '@playwright/test'
import { installation } from './harness.mjs'

const report=(dimensions,metrics,rows)=>({dimensionHeaders:dimensions.map(name=>({name})),metricHeaders:metrics.map(name=>({name,type:/Users|sessions|Views|Count|Events/.test(name)?'TYPE_INTEGER':'TYPE_FLOAT'})),rows:rows.map(([dims,values])=>({dimensionValues:dims.map(value=>({value})),metricValues:values.map(value=>({value:String(value)}))})),rowCount:rows.length,metadata:{currencyCode:'EUR',timeZone:'Europe/Berlin',subjectToThresholding:true}})
const json=async response=>{assert.equal(response.status,200,await response.clone().text());return response.json()}
async function finish(a,siteId,p){for(let n=0;n<100;n++){const r=await json(await a.post('/api/vane/import-apply',{siteId,document:p.carry,fingerprint:p.fingerprint},a.owner));if(r.complete)return r}assert.fail('import did not complete')}
async function undo(a,siteId,jobId){for(let n=0;n<100;n++){const r=await json(await a.post('/api/vane/import-undo',{siteId,jobId},a.owner));if(r.complete)return}assert.fail('undo did not complete')}
const summary=(a,siteId)=>a.request(`/api/vane/summary?siteId=${siteId}&from=2025-09-01&to=2026-10-03`,{headers:{cookie:a.owner}}).then(json)

test('IMPORT-002 thirteen months of GA4 daily history and independent dimensions preserve source metrics, key events, review, journal and undo without creating native visits',async t=>{
 const a=await installation();t.after(()=>a.close())
 const siteId=await a.addSite({paths:[],goals:{},retainForever:true})
 const daily=[];for(let at=Date.parse('2025-09-01');at<=Date.parse('2026-10-01');at+=86400000)daily.push([[new Date(at).toISOString().slice(0,10).replaceAll('-','')],[41,30,76,0.125,18.5]])
 const sets=[['pagePath','/pricing'],['landingPage','/'],['browser','Firefox'],['browserVersion','140.0'],['operatingSystem','Linux'],['operatingSystemVersion','6.8'],['deviceCategory','desktop'],['screenResolution','1440x900'],['sessionDefaultChannelGroup','Organic Search'],['sessionSource','google'],['sessionMedium','organic'],['sessionCampaignName','autumn'],['sessionManualAdContent','variant-a'],['sessionManualTerm','privacy'],['country','Germany'],['region','Berlin'],['city','Berlin'],['eventName','purchase']]
 const reports=[report(['date'],['sessions','totalUsers','screenPageViews','bounceRate','purchaseRevenue'],daily),...sets.map(([dimension,value])=>report(['date',dimension],['sessions','eventCount'],[[['20261001',value],[17,21]]]))]
 const document={format:'vane-ga4-history/1',property:'properties/1234',from:'2025-09-01',to:'2026-10-01',reports,keyEvents:[{name:'properties/1234/keyEvents/56',eventName:'purchase',countingMethod:'ONCE_PER_EVENT',defaultValue:{numericValue:9.5,currencyCode:'EUR'}}]}
 const preview=()=>a.post('/api/vane/import-preview',{siteId,document},a.owner).then(json)
 assert.equal((await a.post('/api/vane/import-preview',{siteId,document})).status,401)
 const p=await preview();assert.equal(p.normalized.length,0);assert.equal(p.aggregates.length,daily.length+sets.length+1)
 const totals=p.aggregates.filter(r=>r.report==='GA4.totals');assert.equal(totals.length,daily.length)
 for(const row of totals){assert.deepEqual(row.metrics,{sessions:41,totalUsers:30,screenPageViews:76,bounceRate:0.125,purchaseRevenue:18.5});assert.equal(row.dimensions.currency,'EUR');assert.equal(row.dimensions.sourceTimeZone,'Europe/Berlin');assert.equal(row.dimensions.sourceCoverage,'thresholded')}
 for(const [dimension,value] of sets){const row=p.aggregates.find(r=>r.report==='GA4.'+dimension&&r.dimensions[dimension]===value);assert.ok(row,dimension);assert.deepEqual(row.metrics,{sessions:17,eventCount:21})}
 const definition=p.aggregates.flatMap(r=>r.definitions)[0];assert.equal(definition.event,'purchase');assert.equal(definition.requiresObservation,true);assert.ok(definition.incomplete);assert.equal(definition.kind,'event')
 const first=await finish(a,siteId,p),again=await finish(a,siteId,p);assert.equal(first.job.id,again.job.id)
 const result=await summary(a,siteId);assert.equal(result.pageviews,0);assert.equal(result.importedReports.length,p.aggregates.length)
 const journal=await json(await a.request(`/api/vane/import-journal?siteId=${siteId}&jobId=${first.job.id}`,{headers:{cookie:a.owner}}));assert.equal(journal.job.state,'completed');assert.equal(journal.provenance.length,p.aggregates.length)
 const definitions=await json(await a.request('/api/vane/import-definitions?siteId='+siteId,{headers:{cookie:a.owner}}));assert.equal(definitions.find(d=>d.name==='purchase').incomplete,definition.incomplete)
 assert.equal((await a.form({operation:'import.definition.prepare',siteId,recordId:definitions[0].recordId,name:'purchase'},a.owner)).status,400)
 assert.equal((await a.form({operation:'import.definition.prepare',siteId,recordId:definitions[0].recordId,name:'purchase',complete:'on',kind:'event',event:'purchase',currency:'EUR'},a.owner)).status,303)
 const pending=await json(await a.request('/api/vane/proposals',{headers:{cookie:a.owner}}));assert.ok(pending.some(item=>item.state==='pending'))
 await undo(a,siteId,first.job.id);assert.equal((await summary(a,siteId)).importedReports.length,0)
 assert.equal(a.egress.length,0)
})

test('IMPORT-002 UA CSV retains daily source aggregates; rejects partial GA4 exports, forged carries, personal URLs and unsupported columns before custody',async t=>{
 const a=await installation();t.after(()=>a.close())
 const siteId=await a.addSite({paths:[],goals:{},retainForever:true}),document={format:'vane-ua-csv/1',property:'UA-987-1',from:'2026-10-01',to:'2026-10-02',currency:'USD',csv:'# Universal Analytics\nDate,Source / Medium,Users,Sessions,Pageviews,Bounce Rate,Revenue\n20261001,google / organic,12,15,25,25,19.95\n20261002,direct / (none),8,9,12,50,0\n'}
 const p=await json(await a.post('/api/vane/import-preview',{siteId,document},a.owner));assert.equal(p.aggregates.length,2);assert.equal(p.normalized.length,0)
 const day=p.aggregates.find(r=>r.day==='2026-10-01');assert.deepEqual(day.metrics,{users:12,sessions:15,pageviews:25,bounceRate:25,revenue:19.95});assert.equal(day.report,'UA.history');assert.equal(day.dimensions.sourceProperty,'UA-987-1')
 const first=await finish(a,siteId,p);assert.equal((await summary(a,siteId)).pageviews,0)
 const cases=[{...document,csv:'Page,Users\n/pricing,3\n'},{...document,csv:'Date,Client ID,Users\n20261001,12345,3\n'},{...document,csv:'Date,Page,Users\n20261001,/pricing?email=person%40example.test,3\n'}]
 const partial={format:'vane-ga4-history/1',property:'properties/1234',from:'2026-10-01',to:'2026-10-01',reports:[{...report(['date'],['sessions'],[[['20261001'],[3]]]),rowCount:2}]};cases.push(partial)
 const forged=structuredClone(p.carry);forged.document.records[0].metrics.visitorId=42;cases.push(forged)
 const fractional=structuredClone(partial);fractional.reports[0].rowCount=1;fractional.reports[0].rows[0].metricValues[0].value='1.5';fractional.reports[0].metricHeaders[0].type='TYPE_FLOAT';cases.push(fractional)
 const badRate={...partial,reports:[report(['date'],['bounceRate'],[[['20261001'],[75]]])]};cases.push(badRate)
 for(const value of cases)assert.equal((await a.post('/api/vane/import-preview',{siteId,document:value},a.owner)).status,400)
 await undo(a,siteId,first.job.id);assert.equal((await summary(a,siteId)).importedReports.length,0)
})

test('IMPORT-002 owner uploads, reviews, applies, completes a recovered key event for approval and undoes source reports at desktop and mobile widths',async t=>{
 const a=await installation();t.after(()=>a.close())
 const siteId=await a.addSite({paths:[],goals:{},retainForever:true}),history=`${a.origin}/app/sites/${siteId}?section=history&from=2026-10-01&to=2026-10-02`
 const browser=await chromium.launch({headless:true,args:['--use-mock-keychain','--password-store=basic']});t.after(()=>browser.close())
 const context=await browser.newContext()
 await context.addCookies(a.owner.split('; ').map(pair=>{const [name,...value]=pair.split('=');return {name,value:value.join('='),url:a.origin}}))
 await context.route('**/*',async route=>{
  const req=route.request(),url=new URL(req.url());if(url.origin!==a.origin)return route.abort()
  const r=await a.request(url.pathname+url.search,{method:req.method(),headers:req.headers(),body:['GET','HEAD'].includes(req.method())?undefined:req.postDataBuffer()??undefined}),location=r.headers.get('location')
  if(r.status===303&&location)return route.fulfill({contentType:'text/html',body:`<!doctype html><title>Redirecting</title><meta http-equiv="refresh" content="0;url=${location.replaceAll('&','&amp;')}">`})
  return route.fulfill({status:r.status,headers:Object.fromEntries(r.headers),body:Buffer.from(await r.arrayBuffer())})
 })
 const page=await context.newPage(),screens=process.env.VANE_SCREEN_DIR
 if(screens)await mkdir(screens,{recursive:true})
 async function capture(heading,label){
  const element=page.getByRole('heading',{name:heading,exact:true});await element.waitFor()
  for(const width of [1440,390]){await page.setViewportSize({width,height:960});await element.scrollIntoViewIfNeeded();assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);if(screens)await page.screenshot({path:`${screens}/ga4-${label}-${width}.png`})}
 }
 const document={format:'vane-ga4-history/1',property:'properties/1234',from:'2026-10-01',to:'2026-10-01',reports:[report(['date','sessionSource'],['sessions','screenPageViews','keyEvents','purchaseRevenue'],[[['20261001','google'],[17,29,4,19.95]]])],keyEvents:[{name:'properties/1234/keyEvents/56',eventName:'purchase',countingMethod:'ONCE_PER_EVENT'}]}
 await page.goto(history);await capture('Import a document','import')
 await page.getByLabel('Analytics document',{exact:true}).setInputFiles({name:'ga4-history.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(document))})
 await page.getByRole('button',{name:'Preview import',exact:true}).click();await capture('Review import','preview')
 assert.ok((await page.locator('body').innerText()).includes('GA4 sessions'))
 await page.getByRole('button',{name:'Apply import',exact:true}).click();await page.getByRole('heading',{name:'Import journal',exact:true}).waitFor()
 await page.goto(history);await capture('Imported Google Analytics reports','results');await capture('Recovered definitions','definitions')
 await page.getByText('Complete purchase',{exact:true}).click();await page.getByRole('button',{name:'Prepare completed definition',exact:true}).click()
 await page.waitForURL('**/app?section=approvals**')
 const proposals=await json(await a.request('/api/vane/proposals',{headers:{cookie:a.owner}}));assert.ok(proposals.some(p=>p.state==='pending'))
 await page.goto(`${a.origin}/app/sites/${siteId}?section=settings`);await capture('Data inventory','inventory')
 await page.goto(history);await page.getByRole('button',{name:'Undo import',exact:false}).click();await page.getByRole('heading',{name:'Import journal',exact:true}).waitFor()
 await page.goto(history);assert.equal(await page.getByRole('heading',{name:'Imported Google Analytics reports',exact:true}).count(),0);await capture('Import journal','undo')
 assert.equal((await summary(a,siteId)).pageviews,0);assert.equal((await summary(a,siteId)).importedReports.length,0)
})

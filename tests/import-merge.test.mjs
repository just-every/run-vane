import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { installation } from './harness.mjs'

const api=JSON.parse(await readFile(new URL('./fixtures/plausible/history-api.json',import.meta.url),'utf8')),umami=JSON.parse(await readFile(new URL('./fixtures/umami-events.json',import.meta.url),'utf8'))
const json=async response=>{assert.equal(response.status,200,await response.clone().text());return response.json()}
const dated=day=>JSON.parse(JSON.stringify(api).replaceAll('2026-10-01',day))
const ga4=(from,to,days)=>({format:'vane-ga4-history/1',property:'properties/1234',from,to,reports:[{dimensionHeaders:[{name:'date'}],metricHeaders:['sessions','totalUsers','screenPageViews'].map(name=>({name,type:'TYPE_INTEGER'})),rows:days.map(day=>({dimensionValues:[{value:day.replaceAll('-','')}],metricValues:[{value:'41'},{value:'30'},{value:'76'}]})),rowCount:days.length,metadata:{currencyCode:'EUR',timeZone:'Europe/Berlin',subjectToThresholding:true}}]})
async function apply(a,siteId,p){for(let n=0;n<100;n++){const r=await json(await a.post('/api/vane/import-apply',{siteId,document:p.carry,fingerprint:p.fingerprint},a.owner));if(r.complete)return r}assert.fail('import did not complete')}
const preview=(a,siteId,document)=>a.post('/api/vane/import-preview',{siteId,document},a.owner)
const csvTotal=(text,column)=>{const [head,...lines]=text.trim().split('\r\n'),at=head.split(',').indexOf(column);assert.ok(at>=0,column);return lines.reduce((sum,line)=>sum+Number(line.split(',')[at]),0)}

test('IMPORT-007 a later source skips the days an earlier import holds, names them in its preview and journal, and leaves those days with the first source alone',async t=>{
 const a=await installation();t.after(()=>a.close())
 const siteId=await a.addSite({paths:[],goals:{},retainForever:true})
 const held=await json(await preview(a,siteId,dated('2024-06-04')));assert.ok(held.aggregates.length);assert.deepEqual(held.skipped,[]);await apply(a,siteId,held)
 const days=['2024-06-01','2024-06-02','2024-06-03','2024-06-04'],document=ga4('2024-06-01','2024-06-04',days)
 const p=await json(await preview(a,siteId,document))
 assert.deepEqual(p.skipped,[{day:'2024-06-04',provider:'plausible'}])
 assert.deepEqual([...new Set(p.aggregates.map(r=>r.day))].sort(),days.slice(0,3));assert.ok(p.aggregates.every(r=>r.provider==='ga4'))
 // The owner's review page names each skipped day and its holder before anything is applied.
 const page=await a.form({operation:'import.preview',siteId,document:JSON.stringify(document)},a.owner);assert.equal(page.status,200);const html=await page.text()
 assert.match(html,/data-overlap-days[^>]*>[\s\S]*2024-06-04: held by Plausible/)
 const done=await apply(a,siteId,p)
 const journal=await json(await a.request(`/api/vane/import-journal?siteId=${siteId}&jobId=${done.job.id}`,{headers:{cookie:a.owner}}))
 assert.deepEqual(journal.skipped,[{day:'2024-06-04',provider:'plausible'}]);assert.equal(journal.provenance.length,p.aggregates.length)
 const totals=async(from,to)=>(await json(await a.request(`/api/vane/summary?siteId=${siteId}&from=${from}&to=${to}`,{headers:{cookie:a.owner}}))).importedReports
 const overlap=await totals('2024-06-04','2024-06-05');assert.ok(overlap.length);assert.ok(overlap.every(r=>r.provider==='plausible'),'the held day shows only the first source')
 assert.ok((await totals('2024-06-01','2024-06-04')).every(r=>r.provider==='ga4'))
 // Nothing new to import is refused, and the first source stays as it was.
 assert.equal((await preview(a,siteId,ga4('2024-06-04','2024-06-04',['2024-06-04']))).status,409)
 assert.equal((await totals('2024-06-04','2024-06-05')).length,overlap.length)
})

test('IMPORT-007 any viewer switches imported data off and on for the dashboard, its comparison, CSV tables, shared link and both Stats API doors',async t=>{
 const a=await installation();t.after(()=>a.close())
 const id=await a.addSite(),range='from=2026-10-01&to=2026-10-06'
 await a.clock(Date.parse('2026-10-05T12:00:00Z'));assert.equal((await a.collect(a.event(id))).status,202)
 const imported=await json(await preview(a,id,umami));await apply(a,id,imported)
 await apply(a,id,await json(await preview(a,id,ga4('2026-10-01','2026-10-02',['2026-10-01','2026-10-02']))))
 const summary=async (extra='')=>json(await a.request(`/api/vane/summary?siteId=${id}&${range}${extra}`,{headers:{cookie:a.owner}}))
 const on=await summary(),off=await summary('&imported=off')
 assert.equal(on.pageviews,3);assert.ok(on.imported>0&&on.unknownCoverage>0&&on.importedReports.length>0)
 assert.equal(off.pageviews,1);assert.equal(off.imported,0);assert.deepEqual(off.importedReports,[]);assert.equal(off.importedOff,true)
 assert.equal(off.previousPageviews,0,'the comparison leaves imported history out too')
 assert.deepEqual((await summary('&imported=on')).pages,on.pages,'switching back restores every figure')
 // CSV tables follow the choice.
 const csv=extra=>a.request(`/api/vane/csv?siteId=${id}&${range}&table=pages${extra}`,{headers:{cookie:a.owner}}).then(r=>r.text())
 assert.equal(csvTotal(await csv(''),'count'),3);assert.equal(csvTotal(await csv('&imported=off'),'count'),1)
 assert.equal((await a.request(`/api/vane/csv?siteId=${id}&${range}&table=importedSourceRows`,{headers:{cookie:a.owner}})).status,200)
 assert.equal((await a.request(`/api/vane/csv?siteId=${id}&${range}&table=importedSourceRows&imported=off`,{headers:{cookie:a.owner}})).status,404)
 // The dashboard shows the choice and its CSV links keep it.
 const dash=await (await a.request(`/app/sites/${id}?section=report&${range}&imported=off`,{headers:{cookie:a.owner}})).text()
 assert.match(dash,/name="imported" value="off" checked/);assert.match(dash,/data-csv="pages"/);assert.match(dash,/api\/vane\/csv\?[^"]*imported=off/)
 // Both Stats API doors take the same choice.
 const key=(await (await a.form({operation:'apikey.create',kind:'stats',label:'Reporting',[`site_${id}`]:'on'},a.owner)).text()).match(/data-api-key>(vane_k_[0-9a-f]{64})</)[1],auth={authorization:'Bearer '+key}
 const v1=async extra=>json(await a.request(`/api/v1/stats?site_id=${id}&${range}&metrics=pageviews${extra}`,{headers:auth}))
 assert.equal((await v1('')).results.pageviews,3);assert.equal((await v1('&imported=off')).results.pageviews,1);assert.equal((await v1('&imported=off')).imported,false)
 assert.equal((await a.request(`/api/v1/stats?site_id=${id}&${range}&imported=maybe`,{headers:auth})).status,400)
 const v2=async include=>json(await a.request('/api/v2/query',{method:'POST',headers:{...auth,'content-type':'application/json'},body:JSON.stringify({site_id:id,metrics:['pageviews'],date_range:['2026-10-01','2026-10-05'],...(include?{include}:{})})}))
 assert.equal((await v2()).results[0].metrics[0],3);assert.equal((await v2({imports:false})).results[0].metrics[0],1);assert.equal((await v2({imports:false})).meta.imports_included,false)
 // A shared-link reader switches the same choice without signing in.
 const shared=await a.form({operation:'share.create',siteId:id,label:'Partners',share_totals:'on'},a.owner),url=(await shared.text()).match(/data-share-url>[^<]*(\/share\/vane_s_[0-9a-f]{64})</)[1]
 const tile=html=>Number(html.match(/Pageviews<\/h2><p class="vane-metric">([\d,]+)</)?.[1].replaceAll(',',''))
 const first=await (await a.request(`${url}?${range}`)).text();assert.equal(tile(first),3);assert.match(first,/data-imported-state="on"/)
 const link=first.match(/data-imported-switch/)&&first.match(/href="(\?[^"]*)" data-imported-switch/)[1].replaceAll('&amp;','&');assert.match(link,/imported=off/)
 const hidden=await (await a.request(url+link)).text();assert.equal(tile(hidden),1);assert.match(hidden,/data-imported-state="off"/)
 const back=hidden.match(/href="(\?[^"]*)" data-imported-switch/)[1].replaceAll('&amp;','&');assert.doesNotMatch(back,/imported=/);assert.equal(tile(await (await a.request(url+back)).text()),3)
})

test('IMPORT-007 a reviewed cut-over keeps live days once across events, source reports, CSV and ZIP; custody, transfer, restore and undo retain the policy',async t=>{
 let a=await installation();const opened=[a];t.after(()=>Promise.all(opened.map(x=>x.close())))
 const id=await a.addSite({paths:[],goals:{},retainForever:true}),days=['2026-10-01','2026-10-02','2026-10-03','2026-10-04','2026-10-05','2026-10-06'],range='from=2026-10-01&to=2026-10-07&metric=pageviews&interval=day'
 const events={data:days.map((day,n)=>({id:'cutover-'+n,createdAt:day+'T12:00:00Z',urlPath:'/imported',eventType:1,sessionId:'PRIVATE_SESSION_SENTINEL'})),count:6,page:1,pageSize:6}
 const visit=async app=>{await app.clock(Date.parse('2026-10-03T12:00:00Z'));assert.equal((await app.collect(app.event(id,{path:'/live'}))).status,202);await app.clock(Date.parse('2026-10-04T12:00:00Z'));assert.equal((await app.collect(app.event(id,{path:'/live'}))).status,202);await app.clock(Date.parse('2026-10-10T12:00:00Z'))}
 await visit(a)
 const snapshot=async()=>Object.fromEntries(Object.entries(await a.dump()).filter(([name])=>/^(vane_|ik_)/.test(name)))
 const before=await snapshot()
 for(const cutover of ['2026-02-30','2026-10-05T00:00:00Z',null])assert.equal((await a.post('/api/vane/import-preview',{siteId:id,document:events,cutover},a.owner)).status,400)
 const p=await json(await a.post('/api/vane/import-preview',{siteId:id,document:events,cutover:'2026-10-05'},a.owner))
 assert.deepEqual(p.overlap,['2026-10-03','2026-10-04']);assert.equal(p.cutover,'2026-10-05')
 assert.deepEqual(await snapshot(),before,'preview and invalid dates write nothing')
 assert.equal(JSON.stringify(p).includes('PRIVATE_SESSION_SENTINEL'),false)
 const tampered={...p.carry,cutover:'2026-10-06'}
 assert.equal((await a.post('/api/vane/import-apply',{siteId:id,document:tampered,fingerprint:p.fingerprint},a.owner)).status,409)
 const job=await apply(a,id,p);assert.equal((await apply(a,id,p)).job.id,job.job.id,'a completed repeat keeps its job')
 assert.equal((await a.post('/api/vane/import-preview',{siteId:id,document:events,cutover:'2026-10-06'},a.owner)).status,409,'changing an existing record policy requires undo')
 const journal=await json(await a.request(`/api/vane/import-journal?siteId=${id}&jobId=${job.job.id}`,{headers:{cookie:a.owner}}));assert.equal(journal.cutover,'2026-10-05')
 const report=async(app=a,extra='')=>json(await app.request(`/api/vane/summary?siteId=${id}&${range}${extra}`,{headers:{cookie:app.owner}}))
 let current=await report()
 assert.equal(current.pageviews,4);assert.equal(current.imported,2);assert.equal(current.unknownCoverage,2)
 assert.deepEqual(current.series.map(b=>b.pageviews),[1,1,1,1,0,0]);assert.equal((await report(a,'&imported=off')).pageviews,2)
 const compared=await json(await a.request(`/api/vane/summary?siteId=${id}&from=2026-10-07&to=2026-10-13`,{headers:{cookie:a.owner}}));assert.equal(compared.previousPageviews,4)
 const csv=await a.request(`/api/vane/csv?siteId=${id}&${range}&table=pages`,{headers:{cookie:a.owner}});assert.equal(csvTotal(await csv.text(),'count'),4)
 // Source aggregates remain separately labelled, and obey the same live-day and date boundary.
 const g=await json(await a.post('/api/vane/import-preview',{siteId:id,document:ga4(days[0],days.at(-1),days),cutover:'2026-10-05'},a.owner));await apply(a,id,g)
 assert.deepEqual((await report()).importedReports.map(r=>r.day),days.slice(0,2))
 const zip=async(app,off=false)=>{const response=await app.request(`/api/vane/site-zip?siteId=${id}${off?'&imported=off':''}`,{headers:{cookie:app.owner}});assert.equal(response.status,200);return unzipStored(await response.arrayBuffer())}
 const zipped=await zip(a),off=await zip(a,true)
 const totals=files=>csvTotal(files[Object.keys(files).find(name=>name.startsWith('imported_visitors_'))],'pageviews')
 assert.equal(totals(zipped),4);assert.equal(totals(off),2);assert.ok(Object.keys(zipped).some(n=>n.startsWith('ga4_')));assert.equal(Object.keys(off).some(n=>n.startsWith('ga4_')),false)
 // Live collection arriving after the import also wins; there is never a double-counted day.
 await a.clock(Date.parse('2026-10-02T12:00:00Z'));assert.equal((await a.collect(a.event(id,{path:'/live'}))).status,202);await a.clock(Date.parse('2026-10-10T12:00:00Z'))
 current=await report();assert.equal(current.pageviews,4);assert.equal(current.imported,1);assert.deepEqual(current.importedReports.map(r=>r.day),[days[0]])
 const archive=await a.archive();assert.equal(archive.payload.tables.vane_import_events.length,6,'suppression never erases history or its undo custody')
 assert.equal(JSON.stringify(archive).includes('PRIVATE_SESSION_SENTINEL'),false)
 const siteArchive=await json(await a.request(`/api/vane/export?siteId=${id}`,{headers:{cookie:a.owner}}))
 const b=await installation();opened.push(b);assert.equal((await b.post('/api/vane/site-import',{archive:siteArchive},b.owner)).status,201);assert.equal((await report(b)).pageviews,4);assert.equal((await report(b)).imported,1)
 await b.close();opened.splice(opened.indexOf(b),1)
 const c=await installation();opened.push(c);assert.equal((await c.post('/api/vane/restore',{archive},c.owner)).status,200);assert.equal((await report(c)).pageviews,4);assert.equal((await report(c)).imported,1)
 for(let n=0;n<20;n++){const undone=await json(await c.post('/api/vane/import-undo',{siteId:id,jobId:job.job.id},c.owner));if(undone.complete)break;assert.ok(n<19)}
 assert.equal((await report(c)).pageviews,3,'undo removes only imported contributions, preserving live traffic')
})

// The product's ZIP writer stores entries without compression.
function unzipStored(buffer){const bytes=Buffer.from(buffer),files={};let at=0;while(bytes.readUInt32LE(at)===0x04034b50){const size=bytes.readUInt32LE(at+18),n=bytes.readUInt16LE(at+26),extra=bytes.readUInt16LE(at+28),start=at+30+n+extra;files[bytes.subarray(at+30,at+30+n).toString()]=bytes.subarray(start,start+size).toString();at=start+size}return files}

test('IMPORT-007 the owner reviews and applies a dated import through the history form at 1440 and 390',async t=>{
 const a=await installation();t.after(()=>a.close());const id=await a.addSite({paths:[],goals:{},retainForever:true})
 await a.clock(Date.parse('2026-10-02T12:00:00Z'));assert.equal((await a.collect(a.event(id))).status,202);await a.clock(Date.parse('2026-10-10T12:00:00Z'))
 const document={data:['2026-10-01','2026-10-02','2026-10-03'].map((day,n)=>({id:'browser-cutover-'+n,createdAt:day+'T12:00:00Z',urlPath:'/imported',eventType:1})),count:3,page:1,pageSize:3}
 const {chromium}=await import('@playwright/test'),{mkdir}=await import('node:fs/promises')
 const browser=await chromium.launch({headless:true,args:['--use-mock-keychain','--password-store=basic']});t.after(()=>browser.close());const context=await browser.newContext()
 await context.addCookies(a.owner.split('; ').map(pair=>{const [name,...value]=pair.split('=');return {name,value:value.join('='),url:a.origin}}))
 await context.route('**/*',async route=>{const req=route.request(),url=new URL(req.url());if(url.origin!==a.origin)return route.abort();const response=await a.request(url.pathname+url.search,{method:req.method(),headers:req.headers(),body:['GET','HEAD'].includes(req.method())?undefined:req.postDataBuffer()??undefined});return route.fulfill({status:response.status,headers:Object.fromEntries(response.headers),body:Buffer.from(await response.arrayBuffer())})})
 const tab=await context.newPage(),screens=process.env.VANE_SCREEN_DIR;if(screens)await mkdir(screens,{recursive:true})
 const capture=async(label,width)=>{assert.equal(await tab.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,'history fits '+width);if(screens)await tab.screenshot({path:`${screens}/cutover-${label}-${width}.png`})}
 for(const width of [1440,390]){
  await tab.setViewportSize({width,height:960});await tab.goto(`${a.origin}/app/sites/${id}?section=history`)
  const form=tab.getByRole('heading',{name:'Import a document',exact:true}).locator('..'),date=form.getByLabel('Cut-over date (optional)')
  await date.fill('2026-10-03');await date.scrollIntoViewIfNeeded();await capture('form',width)
  await form.getByLabel('Analytics document').setInputFiles({name:'history.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(document))})
  await form.getByRole('button',{name:'Preview import',exact:true}).click()
  const review=tab.getByRole('heading',{name:'Review import',exact:true}).locator('..');await review.waitFor({state:'visible'});await review.scrollIntoViewIfNeeded()
  const text=await review.innerText();assert.ok(text.includes('2026-10-03')&&text.includes('2026-10-02'),'review exposes the date and the live overlap before approval');await capture('review',width)
  await review.getByRole('button',{name:'Apply import',exact:true}).click();assert.equal(await tab.getByRole('heading',{name:'Import journal',exact:true}).count(),1,await tab.locator('body').innerText())
  const r=await json(await a.request(`/api/vane/summary?siteId=${id}&from=2026-10-01&to=2026-10-04`,{headers:{cookie:a.owner}}));assert.equal(r.pageviews,2);assert.equal(r.imported,1)
  await tab.goto(`${a.origin}/app/sites/${id}?section=report&from=2026-10-01&to=2026-10-04&metric=pageviews`)
  const tile=tab.getByRole('heading',{name:'Pageviews',exact:true}).first().locator('..');await tile.waitFor({state:'visible'});assert.match(await tile.innerText(),/\b2\b/);await capture('report',width)
  await tab.getByText('More options',{exact:true}).click();await tab.getByLabel('Leave imported data out',{exact:true}).check()
  // The ordinary form applies the same viewer choice to the whole-site ZIP download.
  const filter=tab.locator('input[name="imported"][value="off"]').locator('xpath=ancestor::form');await filter.getByRole('button',{name:/apply|update|show/i}).click()
  await tab.locator('[data-site-zip]').waitFor({state:'visible'});assert.ok((await tab.locator('[data-site-zip]').getAttribute('href')).includes('imported=off'))
 }
})

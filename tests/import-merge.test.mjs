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

test('IMPORT-007 later sources name and skip held days; the owner can replace them without losing undo or custody',async t=>{
 const a=await installation();t.after(()=>a.close())
 const siteId=await a.addSite({paths:[],goals:{},retainForever:true}),days=['2024-06-01','2024-06-02','2024-06-03','2024-06-04']
 await apply(a,siteId,await json(await preview(a,siteId,ga4(days[0],days.at(-1),days))))
 const document={format:'vane-plausible-history-normalized/1',records:['2024-06-03','2024-06-04','2024-06-05'].map(day=>({day,provider:'plausible',report:'Plausible.visitors',dimensions:{date:day},metrics:{visitors:20,visits:25,pageviews:40},definitions:[]}))}
 const p=await json(await preview(a,siteId,document))
 assert.deepEqual(p.skipped,[{day:'2024-06-03',provider:'ga4'},{day:'2024-06-04',provider:'ga4'}]);assert.deepEqual(p.aggregates.map(r=>r.day),['2024-06-05'])
 const page=await a.form({operation:'import.preview',siteId,document:JSON.stringify(document)},a.owner);assert.equal(page.status,200);const html=await page.text();assert.match(html,/2024-06-03: held by Google Analytics 4/);assert.match(html,/2024-06-04: held by Google Analytics 4/)
 const done=await apply(a,siteId,p),journal=await json(await a.request(`/api/vane/import-journal?siteId=${siteId}&jobId=${done.job.id}`,{headers:{cookie:a.owner}}));assert.deepEqual(journal.skipped,p.skipped)
 const totals=async()=> (await json(await a.request(`/api/vane/summary?siteId=${siteId}&from=2024-06-01&to=2024-06-06`,{headers:{cookie:a.owner}}))).importedReports
 assert.ok((await totals()).filter(r=>r.day<='2024-06-04').every(r=>r.provider==='ga4'))
 assert.equal((await preview(a,siteId,ga4('2024-06-05','2024-06-05',['2024-06-05']))).status,409)
 const replacement=await json(await a.post('/api/vane/import-preview',{siteId,document,preferNew:true},a.owner));assert.equal(replacement.preferNew,true)
 const tampered={...replacement.carry,preferNew:false};assert.equal((await a.post('/api/vane/import-apply',{siteId,document:tampered,fingerprint:replacement.fingerprint},a.owner)).status,409)
 const replaced=await apply(a,siteId,replacement);assert.ok((await totals()).filter(r=>r.day>='2024-06-03').every(r=>r.provider==='plausible'))
 const undo=await json(await a.post('/api/vane/import-undo',{siteId,jobId:replaced.job.id},a.owner));assert.equal(undo.complete,true);assert.ok((await totals()).filter(r=>r.day<='2024-06-04').every(r=>r.provider==='ga4'),'undo reveals the earlier source')
 // Event exports participate in exactly the same held-day rule.
 const events={data:['2024-06-02','2024-06-06'].map((day,n)=>({id:'synthetic-vane-'+n,createdAt:day+'T12:00:00Z',urlPath:'/',eventType:1})),count:2,page:1,pageSize:2}
 const eventPreview=await json(await preview(a,siteId,events));assert.deepEqual(eventPreview.skipped,[{day:'2024-06-02',provider:'ga4'}]);assert.deepEqual(eventPreview.normalized.map(e=>e.day),['2024-06-06']);await apply(a,siteId,eventPreview)
 const next={...document,records:[{...document.records[0],day:'2024-06-06',dimensions:{date:'2024-06-06'}}]};assert.equal((await preview(a,siteId,next)).status,409)
})

test('IMPORT-007 any viewer switches imported data off and on for the dashboard, its comparison, CSV tables, shared link and both Stats API doors',async t=>{
 const a=await installation();t.after(()=>a.close())
 const id=await a.addSite(),range='from=2026-10-01&to=2026-10-06'
 await a.clock(Date.parse('2026-10-05T12:00:00Z'));assert.equal((await a.collect(a.event(id))).status,202)
 const imported=await json(await preview(a,id,umami));await apply(a,id,imported)
 await apply(a,id,await json(await preview(a,id,ga4('2026-10-03','2026-10-03',['2026-10-03']))))
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
 const aggregateId=await a.addSite({name:'Source report example',origin:'https://source.example',paths:[],goals:{},retainForever:true});
 for(const d of ['2026-10-03','2026-10-04']){await a.clock(Date.parse(d+'T12:00:00Z'));assert.equal((await a.collect(a.event(aggregateId),'https://source.example')).status,202)}await a.clock(Date.parse('2026-10-10T12:00:00Z'));
 const g=await json(await a.post('/api/vane/import-preview',{siteId:aggregateId,document:ga4(days[0],days.at(-1),days),cutover:'2026-10-05'},a.owner));await apply(a,aggregateId,g)
 const aggregateReport=async()=>json(await a.request(`/api/vane/summary?siteId=${aggregateId}&${range}`,{headers:{cookie:a.owner}}));
 assert.deepEqual((await aggregateReport()).importedReports.map(r=>r.day),days.slice(0,2))
 const zip=async(app,off=false)=>{const response=await app.request(`/api/vane/site-zip?siteId=${id}${off?'&imported=off':''}`,{headers:{cookie:app.owner}});assert.equal(response.status,200);return unzipStored(await response.arrayBuffer())}
 const zipped=await zip(a),off=await zip(a,true)
 const totals=files=>csvTotal(files[Object.keys(files).find(name=>name.startsWith('imported_visitors_'))],'pageviews')
 assert.equal(totals(zipped),4);assert.equal(totals(off),2);assert.equal(Object.keys(zipped).some(n=>n.startsWith('ga4_')),false);assert.equal(Object.keys(off).some(n=>n.startsWith('ga4_')),false)
 // Live collection arriving after the import also wins; there is never a double-counted day.
 await a.clock(Date.parse('2026-10-02T12:00:00Z'));assert.equal((await a.collect(a.event(id,{path:'/live'}))).status,202);await a.clock(Date.parse('2026-10-10T12:00:00Z'))
 current=await report();assert.equal(current.pageviews,4);assert.equal(current.imported,1);assert.deepEqual(current.importedReports,[])
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
 // A real loopback HTTP listener lets Chromium perform the form's native 303 navigation.
 const {createServer}=await import('node:http');let a,browser
 const server=createServer(async(req,res)=>{try{const chunks=[];for await(const chunk of req)chunks.push(chunk);const response=await a.request(req.url,{method:req.method,headers:req.headers,...(!['GET','HEAD'].includes(req.method)?{body:Buffer.concat(chunks)}:{})});res.writeHead(response.status,{...Object.fromEntries(response.headers),'set-cookie':response.headers.getSetCookie()});res.end(Buffer.from(await response.arrayBuffer()))}catch(error){res.writeHead(500);res.end(String(error))}})
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(async()=>{await browser?.close();await a?.close();const closed=new Promise(resolve=>server.close(resolve));server.closeAllConnections();await closed})
 a=await installation({origin:`http://127.0.0.1:${server.address().port}`});const id=await a.addSite({paths:[],goals:{},retainForever:true})
 await a.clock(Date.parse('2026-10-02T12:00:00Z'));assert.equal((await a.collect(a.event(id))).status,202);await a.clock(Date.parse('2026-10-10T12:00:00Z'))
 const document={data:['2026-10-01','2026-10-02','2026-10-03'].map((day,n)=>({id:'browser-cutover-'+n,createdAt:day+'T12:00:00Z',urlPath:'/imported',eventType:1})),count:3,page:1,pageSize:3}
 const {chromium}=await import('@playwright/test'),{mkdir}=await import('node:fs/promises')
 browser=await chromium.launch({headless:true,args:['--use-mock-keychain','--password-store=basic']});const context=await browser.newContext()
 await context.addCookies(a.owner.split('; ').map(pair=>{const [name,...value]=pair.split('=');return {name,value:value.join('='),url:a.origin}}))

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
  const [applied]=await Promise.all([tab.waitForResponse(r=>r.url().endsWith('/app/action')&&r.request().method()==='POST'),review.getByRole('button',{name:'Apply import',exact:true}).click()]);assert.equal(applied.status(),303);await tab.getByRole('heading',{name:'Import journal',exact:true}).waitFor({state:'visible'})
  const r=await json(await a.request(`/api/vane/summary?siteId=${id}&from=2026-10-01&to=2026-10-04`,{headers:{cookie:a.owner}}));assert.equal(r.pageviews,2);assert.equal(r.imported,1)
  await tab.goto(`${a.origin}/app/sites/${id}?section=report&from=2026-10-01&to=2026-10-04&metric=pageviews`)
  const tile=tab.locator('.vane-metrics-more section').filter({has:tab.getByRole('heading',{name:'Pageviews',exact:true})});await tile.waitFor({state:'visible'});assert.equal(await tile.locator('.vane-metric').innerText(),'2');await capture('report',width)
  await tab.getByText('More options',{exact:true}).click();await tab.getByLabel('Leave imported data out',{exact:true}).check()
  // The ordinary form applies the same viewer choice to the whole-site ZIP download.
  const filter=tab.locator('input[name="imported"][value="off"]').locator('xpath=ancestor::form');await filter.getByRole('button',{name:/apply|update|show/i}).click()
  await tab.locator('[data-site-zip]').waitFor({state:'visible'});assert.ok((await tab.locator('[data-site-zip]').getAttribute('href')).includes('imported=off'))
 }
})

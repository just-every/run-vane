import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile, mkdir } from 'node:fs/promises'
import { installation } from './harness.mjs'
import { chromium } from '@playwright/test'
const fixture=JSON.parse(await readFile(new URL('./fixtures/matomo-reports.json',import.meta.url),'utf8'))

test('IMPORT-005 Matomo Reporting API aggregates match every source report, propose exact source goals for approval, retain no visitor logs or token, resume once, journal, restore, expire and undo through public doors; history, preview, approval and report work at 1440 and 390',async t=>{
 const a=await installation();t.after(()=>a.close())
 const siteId=await a.addSite({origin:'https://example.com',paths:[],goals:{},retainForever:true}),owner={headers:{cookie:a.owner}},day=fixture.day,range=`siteId=${siteId}&from=${day}&to=2026-10-02`
 let reads=0,redirect=false
 a.fixtureSites['https://matomo.fixture.example']=async request=>{
  reads++;if(redirect)return new Response(null,{status:302,headers:{location:'https://offsite.fixture.example/'}});assert.equal(request.method,'POST')
  const p=new URLSearchParams(await request.text());assert.equal(p.get('method'),'API.getBulkRequest');assert.equal(p.get('token_auth'),'fixture-matomo-token')
  const answers=[...p].filter(([key])=>key.startsWith('urls[')).map(([,value])=>{const q=new URLSearchParams(value),method=q.get('method');assert.equal(q.get('idSite'),'1');assert.equal(q.get('date'),day);assert.equal(q.get('format_metrics'),'0');assert.equal(q.get('filter_limit'),'-1');assert.ok(!method.startsWith('Live.'));return method==='Goals.getGoals'?fixture.goals:fixture.reports[method]})
  return Response.json(answers)
 }
 const matomo={endpoint:'https://matomo.fixture.example/index.php',sourceSite:'1',day,currency:'USD',token:'fixture-matomo-token'}
 const preview=async document=>{const r=await a.post('/api/vane/import-preview',{siteId,document},a.owner);assert.equal(r.status,200,await r.clone().text());return r.json()}
 const csvFixture={format:'vane-matomo-reports/1',day,currency:'USD',reports:{'VisitsSummary.get':'nb_visits,nb_uniq_visitors,nb_actions\n100,80,180\n','Actions.getPageUrls':'label,url,nb_hits,nb_visits\n/pricing,https://example.com/pricing,90,65\n/thank-you,https://example.com/thank-you,60,50\n'}};const csvPreview=await preview(csvFixture);assert.deepEqual(csvPreview.aggregates.find(r=>r.report==='VisitsSummary.get').metrics,{nb_visits:100,nb_uniq_visitors:80,nb_actions:180});assert.equal(csvPreview.aggregates.filter(r=>r.report==='Actions.getPageUrls').reduce((n,r)=>n+r.metrics.nb_hits,0),150)
 const source=await a.post('/api/vane/import-preview',{siteId,matomo},a.owner);assert.equal(source.status,200,await source.clone().text());const p=await source.json()
 assert.equal(reads,1);redirect=true;assert.equal((await a.post('/api/vane/import-preview',{siteId,matomo},a.owner)).status,502,'redirect is refused, not followed');redirect=false;assert.equal(a.egress.some(url=>url.startsWith('https://offsite.fixture.example/')),false);assert.equal(p.normalized.length,0,'source aggregates are never fabricated as events')
 for(const endpoint of ['http://matomo.fixture.example/index.php','https://127.0.0.1/index.php','https://matomo.fixture.example/index.php?token=hidden'])assert.equal((await a.post('/api/vane/import-preview',{siteId,matomo:{...matomo,endpoint}},a.owner)).status,400)
 const admin=await a.invite('admin@example.test','admin');assert.equal((await a.post('/api/vane/import-preview',{siteId,matomo},admin)).status,403);assert.equal(reads,2)
 const bad=structuredClone(fixture);bad.reports['Live.getLastVisitsDetails']=[{idvisitor:'never-store-this',visitIp:'203.0.113.8'}]
 assert.equal((await a.post('/api/vane/import-preview',{siteId,document:bad},a.owner)).status,400)
 const carry=structuredClone(p.carry);carry.records[0].metrics.visitorId=5;assert.equal((await a.post('/api/vane/import-preview',{siteId,document:carry},a.owner)).status,400)
 const changed=await a.post('/api/vane/import-apply',{siteId,document:p.carry,fingerprint:'changed'},a.owner);assert.equal(changed.status,409)
 const apply=async()=>{let result;for(let i=0;i<10;i++){const r=await a.post('/api/vane/import-apply',{siteId,document:p.carry,fingerprint:p.fingerprint},a.owner);assert.equal(r.status,200,await r.clone().text());result=await r.json();if(result.complete)return result}assert.fail('bounded import must finish')}
 const first=await apply(),again=await apply();assert.equal(first.job.id,again.job.id)
 const report=await(await a.request('/api/vane/summary?'+range,owner)).json(),stored=report.importedReports
 for(const [method,sourceRows] of Object.entries(fixture.reports)){
  const input=Array.isArray(sourceRows)?sourceRows:[sourceRows],actual=stored.filter(r=>r.report===method);assert.equal(actual.length,input.length,method)
  for(const metric of Object.keys(actual[0].metrics))assert.equal(actual.reduce((n,r)=>n+r.metrics[metric],0),input.reduce((n,r)=>n+Number(r[metric]??0),0),`${method}.${metric} matches source`)
 }
 assert.deepEqual(stored.filter(r=>r.report==='Actions.getPageUrls').map(r=>r.dimensions.path).sort(),['/pricing','/thank-you']);assert.equal(stored.find(r=>r.report==='UserCountry.getCity').dimensions.city,'Brisbane, Queensland, Australia')
 const definitions=stored.flatMap(r=>r.definitions);assert.deepEqual(definitions.map(d=>[d.name,d.kind,d.pattern]).sort(),[['Order confirmed','pageview','/thank-you'],['Purchase','revenue','Purchase'],['newsletter signup','event','newsletter signup']])
 const csv=await a.request('/api/vane/csv?'+range+'&table=importedSourceRows',owner);assert.equal(csv.status,200);const csvText=await csv.text();assert.ok(csvText.includes('metric_nb_uniq_visitors')&&csvText.includes('VisitsSummary.get')&&csvText.includes('80'));
 const zip=await a.request('/api/vane/site-zip?siteId='+siteId,owner);assert.equal(zip.status,200);const zipText=Buffer.from(await zip.arrayBuffer()).toString();assert.ok(zipText.includes('matomo_Goals.get_')&&zipText.includes('metric_goal_2_revenue')&&zipText.includes('240'));
 const journal=await(await a.request(`/api/vane/import-journal?siteId=${siteId}&jobId=${first.job.id}`,owner)).json();assert.equal(journal.job.state,'completed');assert.ok(journal.approval.ownerId);assert.equal(journal.provenance.length,stored.length)
 const archive=await a.archive(),text=JSON.stringify(archive)
 for(const absent of ['fixture-matomo-token','customer%40example.org','never-store-this','203.0.113.8'])assert.equal(text.includes(absent),false,absent)
 assert.equal(archive.payload.tables.vane_import_events.length,0)
 // A second installation restores source aggregates and can still undo their custody.
 const b=await installation();try{assert.equal((await b.post('/api/vane/restore',{archive},b.owner)).status,200);const undo=await b.post('/api/vane/import-undo',{siteId,jobId:first.job.id},b.owner);assert.equal(undo.status,200,await undo.clone().text());assert.equal((await(await b.request('/api/vane/summary?'+range,{headers:{cookie:b.owner}})).json()).importedReports.length,0)}finally{await b.close()}
 // Use the actual history, preview, approval and report screens by keyboard and forms.
 const browser=await chromium.launch({headless:true,args:['--use-mock-keychain','--password-store=basic']});t.after(()=>browser.close())
 const context=await browser.newContext();await context.addCookies(a.owner.split('; ').map(pair=>{const [name,...value]=pair.split('=');return {name,value:value.join('='),url:a.origin}}))
 await context.route('**/*',async route=>{const req=route.request(),url=new URL(req.url());if(url.origin!==a.origin)return route.abort();const response=await a.request(url.pathname+url.search,{method:req.method(),headers:req.headers(),body:req.postDataBuffer()??undefined});await route.fulfill({status:response.status,headers:Object.fromEntries(response.headers),body:Buffer.from(await response.arrayBuffer())})})
 const page=await context.newPage(),screens=process.env.VANE_SCREEN_DIR;if(screens)await mkdir(screens,{recursive:true})
 for(const width of [1440,390]){
  await page.setViewportSize({width,height:960});await page.goto(`${a.origin}/app/sites/${siteId}?section=history&from=${day}&to=2026-10-02`)
  await page.getByLabel('CSV source date',{exact:true}).fill(day);await page.getByLabel('Matomo CSV',{exact:true}).setInputFiles({name:'summary.csv',mimeType:'text/csv',buffer:Buffer.from(csvFixture.reports['VisitsSummary.get'])});await page.getByRole('button',{name:'Preview Matomo CSV',exact:true}).click();await page.getByRole('heading',{name:'Review import'}).waitFor();assert.ok((await page.locator('main').innerText()).includes('80'));
  await page.goto(`${a.origin}/app/sites/${siteId}?section=history&from=${day}&to=2026-10-02`);
  await page.getByLabel('Matomo Reporting API address').fill(matomo.endpoint);await page.getByLabel('Matomo site ID').fill('1');await page.getByLabel('Source date',{exact:true}).fill(day);await page.getByLabel('Reporting API token').fill(matomo.token)
  await page.getByRole('button',{name:'Preview Matomo reports'}).click();await page.getByRole('heading',{name:'Review import'}).waitFor()
  assert.equal(await page.locator('input[name=token]').inputValue(),'','credentials are not echoed into preview')
  if(screens)await page.getByRole('heading',{name:'Review import',exact:true}).scrollIntoViewIfNeeded();if(screens)await page.screenshot({path:`${screens}/matomo-preview-${width}.png`})
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,'preview has no sideways page scroll')
  await page.goto(`${a.origin}/app/sites/${siteId}?section=history&from=${day}&to=2026-10-02`)
  const [prepared]=await Promise.all([page.waitForResponse(r=>new URL(r.url()).pathname==='/app/action'&&r.request().method()==='POST'),page.getByRole('button',{name:'Prepare newsletter signup goal',exact:true}).click()]);assert.equal(prepared.status(),303,prepared.status()===303?'':await prepared.text());await page.getByRole('heading',{name:'Approvals',exact:true,level:1}).waitFor({timeout:5000}).catch(async()=>assert.fail(JSON.stringify({location:prepared.headers().location,url:page.url(),body:(await page.locator('main').innerText()).slice(0,1600)})))
  if(screens)await page.screenshot({path:`${screens}/matomo-approval-${width}.png`})
  if(width===1440){await page.getByRole('button',{name:'Approve change',exact:true}).last().click()}
  else{await page.getByRole('button',{name:'Reject change',exact:true}).last().click()}
  for(const section of ['history','report','settings']){await page.goto(`${a.origin}/app/sites/${siteId}?section=${section}&from=${day}&to=2026-10-02`);assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,`${section} at ${width}`);if(section==='history'||section==='report')await page.getByRole('heading',{name:'Imported Matomo reports',exact:true}).scrollIntoViewIfNeeded();if(screens)await page.screenshot({path:`${screens}/matomo-${section}-${width}.png`})}
 }
 // Approved source event goal counts future events under its original display name.
 for(const name of ['Order confirmed','Purchase']){const record=stored.find(r=>r.definitions.some(d=>d.name===name));assert.equal((await a.form({operation:'import.goal.prepare',siteId,recordId:record.id,name},a.owner)).status,303);const proposals=await(await a.request('/api/vane/proposals',owner)).json(),proposal=proposals.find(p=>p.state==='pending');assert.equal((await a.form({operation:'proposal.approve',id:proposal.id},a.owner)).status,303)}
 const e=a.event(siteId);assert.equal((await a.collect(e,'https://example.com')).status,202)
 assert.equal((await a.post('/api/vane/custom',{id:crypto.randomUUID(),siteId,page:e.id,name:'newsletter signup'},'',{origin:'https://example.com'})).status,202)
 const live=await(await a.request('/api/vane/summary?siteId='+siteId,owner)).json();assert.equal(live.goalBreakdown.find(g=>g.label==='newsletter signup').count,1)
 const thanks=a.event(siteId,{path:'/thank-you'});assert.equal((await a.collect(thanks,'https://example.com')).status,202);assert.equal((await a.post('/api/vane/custom',{id:crypto.randomUUID(),siteId,page:thanks.id,name:'Purchase',revenue:{amount:49.99,currency:'USD'}},'',{origin:'https://example.com'})).status,202);const converted=await(await a.request('/api/vane/summary?siteId='+siteId,owner)).json();for(const name of ['Order confirmed','Purchase'])assert.equal(converted.goalBreakdown.find(g=>g.label===name).count,1,name)
 // Undo removes only imported history, leaving live collection and independently approved settings.
 assert.equal((await a.post('/api/vane/import-undo',{siteId,jobId:first.job.id},a.owner)).status,200)
 assert.equal((await(await a.request('/api/vane/summary?'+range,owner)).json()).importedReports.length,0)
 assert.equal((await a.archive()).payload.tables.vane_events.filter(e=>e.kind==='pageview').length,2)
 // Retention retires the same aggregate target kind with its erasure fence.
 const expired=await a.addSite({origin:'https://old.example',paths:[],goals:{},retentionDays:30}),old=structuredClone(fixture);old.day='2020-01-01';old.reports['Actions.getPageUrls']=[];delete old.goals
 const oldPreview=await a.post('/api/vane/import-preview',{siteId:expired,document:old},a.owner);assert.equal(oldPreview.status,200,await oldPreview.clone().text());const op=await oldPreview.json()
 let result;for(let n=0;n<10;n++){const r=await a.post('/api/vane/import-apply',{siteId:expired,document:op.carry,fingerprint:op.fingerprint},a.owner);assert.equal(r.status,200,await r.clone().text());result=await r.json();if(result.complete)break}assert.equal(result.complete,true)
 for(let n=0;n<op.aggregates.length;n++)assert.equal((await a.form({operation:'history.retention',siteId:expired},a.owner)).status,303)
 assert.equal((await a.archive()).payload.tables.vane_import_reports.filter(r=>r.site_id===expired).length,0)
})

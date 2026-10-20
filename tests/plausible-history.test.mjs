import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { installation } from './harness.mjs'

const fixture=name=>readFile(new URL('./fixtures/plausible/'+name,import.meta.url))
const [zip,dashboard,api]=await Promise.all([fixture('history-dashboard.zip'),fixture('history-dashboard.json').then(JSON.parse),fixture('history-api.json').then(JSON.parse)])
const day=dashboard.day
const dimensions={visitors:['date'],pages:['page'],entry_pages:['entry_page'],exit_pages:['exit_page'],browsers:['browser'],browser_versions:['browser','browser_version'],operating_systems:['os'],operating_system_versions:['os','os_version'],devices:['device'],channels:['channel'],sources:['source'],referrers:['referrer'],utm_mediums:['utm_medium'],utm_sources:['utm_source'],utm_campaigns:['utm_campaign'],utm_contents:['utm_content'],utm_terms:['utm_term'],countries:['country'],regions:['region'],cities:['city'],goalHistory:['goal'],propertyHistory:['property','value']}
const json=async response=>{assert.equal(response.status,200,await response.clone().text());return response.json()}
const decode=text=>text.replace(/&(?:quot|amp|lt|gt|#39);/g,x=>({'&quot;':'"','&amp;':'&','&lt;':'<','&gt;':'>','&#39;':"'"}[x]))
function hidden(html,name){const match=html.match(new RegExp('name="'+name+'" value="([^"]*)"'));assert.ok(match,'reviewed '+name+' must be present');return decode(match[1])}
async function apply(a,siteId,p){for(let i=0;i<10;i++){const result=await json(await a.post('/api/vane/import-apply',{siteId,document:p.carry,fingerprint:p.fingerprint},a.owner));if(result.complete)return result}assert.fail('bounded import must complete')}
async function undo(a,siteId,jobId){for(let i=0;i<10;i++){const result=await json(await a.post('/api/vane/import-undo',{siteId,jobId},a.owner));if(result.complete)return result}assert.fail('resumable undo must finish')}
const summary=(a,siteId)=>a.request(`/api/vane/summary?siteId=${siteId}&from=${day}&to=2026-10-02`,{headers:{cookie:a.owner}}).then(json)
const preview=(a,siteId,document)=>a.post('/api/vane/import-preview',{siteId,document},a.owner).then(json)
const key=r=>JSON.stringify(Object.entries(r.dimensions).sort())

test('IMPORT-003 dashboard ZIP imports every published history table with exact source counts and rates, keeps recovered names, journals/resumes and undoes without inventing visits',async t=>{
 const a=await installation();t.after(()=>a.close())
 const siteId=await a.addSite({paths:[],goals:{},retainForever:true}),form=new FormData()
 for(const [name,value] of Object.entries({operation:'import.plausible.export.preview',siteId,day,currency:'USD'}))form.set(name,value)
 form.set('plausibleZip',new File([zip],'Plausible export.zip',{type:'application/zip'}))
 const upload=new Request(a.origin+'/app/action',{method:'POST',body:form});const response=await a.request('/app/action',{method:'POST',headers:{origin:a.origin,cookie:a.owner,'content-type':upload.headers.get('content-type')},body:new Uint8Array(await upload.arrayBuffer())})
 assert.equal(response.status,200,await response.clone().text());const html=await response.text()
 const p=await preview(a,siteId,JSON.parse(hidden(html,'document')))
 assert.equal(p.fingerprint,hidden(html,'fingerprint'));assert.equal(p.normalized.length,0)
 for(const [filename,content] of Object.entries(dashboard.files)){
  const name=filename==='conversions.csv'?'goalHistory':filename==='custom_props.csv'?'propertyHistory':filename.slice(0,-4),dim=dimensions[name]
  // The independent source fixture has no quoted commas; preserve every row value.
  const [header,...source]=content.trim().split(/\r?\n/).map(line=>line.split(','))
  const actual=p.aggregates.filter(r=>r.report==='Plausible.'+name)
  assert.equal(actual.length,source.length,filename)
  for(const cells of source){const expectedDimensions=Object.fromEntries(dim.map((d,i)=>[d,cells[i]])),row=actual.find(r=>key(r)===key({dimensions:expectedDimensions}));assert.ok(row,filename+JSON.stringify(expectedDimensions));assert.equal(row.day,day)
   assert.deepEqual(row.metrics,Object.fromEntries(header.slice(dim.length).map((m,i)=>[m,Number(cells[dim.length+i])])),filename)
  }
 }
 const definitions=p.aggregates.flatMap(r=>r.definitions)
 assert.deepEqual(definitions.map(d=>d.name).sort(),['Leads (old)','Purchase','Scroll 75% on /blog/**','Signup','Visit /thanks*','plan'].sort())
 assert.equal(definitions.find(d=>d.name==='Visit /thanks*').pattern,'/thanks*');assert.equal(definitions.find(d=>d.name==='Scroll 75% on /blog/**').depth,75);assert.equal(definitions.some(d=>d.kind==='funnel'),false)
 const first=await apply(a,siteId,p),again=await apply(a,siteId,p);assert.equal(first.job.id,again.job.id)
 const report=await summary(a,siteId);assert.equal(report.importedReports.length,p.aggregates.length);assert.equal(report.pageviews,0)
 const journal=await json(await a.request(`/api/vane/import-journal?siteId=${siteId}&jobId=${first.job.id}`,{headers:{cookie:a.owner}}))
 assert.equal(journal.job.state,'completed');assert.ok(journal.approval.ownerId);assert.equal(journal.provenance.length,p.aggregates.length)
 const csv=await a.request(`/api/vane/csv?siteId=${siteId}&from=${day}&to=2026-10-02&table=importedSourceRows`,{headers:{cookie:a.owner}});assert.equal(csv.status,200);const exported=await csv.text();assert.ok(exported.includes('metric_unique_entrances')&&exported.includes('Plausible.utm_terms')&&exported.includes('Plausible.propertyHistory'))
 const carry=structuredClone(p.carry);carry.records.find(r=>r.report==='Plausible.pages').metrics.visitorId=12
 assert.equal((await a.post('/api/vane/import-preview',{siteId,document:carry},a.owner)).status,400)
 const unsafe=structuredClone(dashboard);unsafe.files['pages.csv']=unsafe.files['pages.csv'].replace('/pricing','/pricing?email=private%40example.test')
 assert.equal((await a.post('/api/vane/import-preview',{siteId,document:unsafe},a.owner)).status,400)
 await undo(a,siteId,first.job.id)
 assert.equal((await summary(a,siteId)).importedReports.length,0)
 assert.equal((await a.archive()).payload.tables.vane_import_events.length,0)
})

test('IMPORT-003 official Stats API reads all dimensions, paginates goals, preserves EUR revenue and typed definitions, rejects redirects/unauthorized reads and undoes history',async t=>{
 const a=await installation();t.after(()=>a.close())
 const siteId=await a.addSite({paths:[],goals:{},retainForever:true}),calls=[];let redirect=false
 a.fixtureSites['https://plausible.io']=async request=>{
  calls.push(request.url);assert.equal(request.headers.get('authorization'),'Bearer fixture-history-token')
  if(redirect)return new Response(null,{status:302,headers:{location:'https://offsite.fixture.example/'}})
  const url=new URL(request.url)
  if(url.pathname==='/api/v1/sites/goals')return Response.json(api.definitions.goals)
  if(url.pathname==='/api/v1/sites/custom-props')return Response.json(api.definitions.properties)
  assert.equal(url.pathname,'/api/v2/query');assert.equal(request.method,'POST');const body=await request.json()
  assert.equal(body.site_id,'switch.fixture.example')
  if(JSON.stringify(body.metrics)==='["total_revenue"]')return Response.json(api.definitions.revenue)
  assert.deepEqual(body.date_range,[day,day]);assert.deepEqual(body.include,{imports:true,total_rows:true})
  const source=api.queries.find(q=>JSON.stringify(q.query.dimensions)===JSON.stringify(body.dimensions));assert.ok(source,'only published history dimensions are requested')
  assert.deepEqual(body.metrics,source.query.metrics)
  const offset=body.pagination.offset,limit=body.dimensions[0]==='event:goal'?2:body.pagination.limit
  return Response.json({...source,query:{...source.query,pagination:body.pagination},results:source.results.slice(offset,offset+limit)})
 }
 const plausible={history:true,sourceSite:'switch.fixture.example',keyType:'stats',token:'fixture-history-token',day}
 assert.equal((await a.post('/api/vane/import-preview',{siteId,plausible})).status,401);assert.equal(calls.length,0)
 const p=await json(await a.post('/api/vane/import-preview',{siteId,plausible},a.owner))
 assert.equal(p.normalized.length,0)
 for(const source of api.queries){
  const report=source.query.dimensions[0].startsWith('event:props:')?'propertyHistory':Object.keys(dimensions).find(name=>name!=='propertyHistory'&&source.query.dimensions.every((d,i)=>({date:'time:day',page:'event:page',entry_page:'visit:entry_page',exit_page:'visit:exit_page',country:'visit:country_name',region:'visit:region_name',city:'visit:city_name',goal:'event:goal'}[dimensions[name][i]]??'visit:'+dimensions[name][i])===d))
  assert.ok(report,JSON.stringify(source.query.dimensions));const actual=p.aggregates.filter(r=>r.report==='Plausible.'+report);assert.equal(actual.length,source.results.length,report)
  for(const raw of source.results){
   const dims=report==='propertyHistory'?{property:'plan',value:raw.dimensions[0]}:Object.fromEntries(dimensions[report].map((d,i)=>[d,raw.dimensions[i]])),metrics={}
   source.query.metrics.forEach((m,i)=>{if(raw.metrics[i]===null)return;if(m.endsWith('revenue')){metrics[m]=raw.metrics[i].value;dims.currency=raw.metrics[i].currency}else metrics[m]=raw.metrics[i]})
   const row=actual.find(r=>key(r)===key({dimensions:dims}));assert.ok(row,report+JSON.stringify(dims));assert.deepEqual(row.metrics,metrics)
  }
 }
 const defs=p.aggregates.flatMap(r=>r.definitions);assert.deepEqual(defs.filter(d=>d.kind!=='property').map(d=>[d.name,d.kind,d.pattern??d.event,d.depth??null,d.currency]).sort(),[['Purchase','revenue','Purchase',null,'EUR'],['Scroll 75% on /blog/**','scroll','/blog/**',75,'USD'],['Signup','event','Signup',null,'USD'],['Visit /thanks*','pageview','/thanks*',null,'USD']])
 assert.deepEqual(defs.find(d=>d.name==='Signup').props,{plan:'pro'});assert.equal(defs.some(d=>d.kind==='funnel'),false)
 const first=await apply(a,siteId,p);assert.equal((await summary(a,siteId)).importedReports.length,p.aggregates.length)
 const proposals=await json(await a.request('/api/vane/import-definitions?siteId='+siteId,{headers:{cookie:a.owner}}))
 assert.deepEqual(proposals.map(d=>d.name).sort(),defs.map(d=>d.name).sort())
 assert.equal(JSON.stringify(await a.archive()).includes('fixture-history-token'),false)
 redirect=true;assert.equal((await a.post('/api/vane/import-preview',{siteId,plausible},a.owner)).status,502);assert.equal(a.egress.some(url=>url.startsWith('https://offsite.fixture.example')),false)
 assert.equal((await a.post('/api/vane/import-preview',{siteId,plausible:{...plausible,endpoint:'https://other.fixture.example'}},a.owner)).status,400)
 await undo(a,siteId,first.job.id);assert.equal((await summary(a,siteId)).importedReports.length,0)
})

import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdir } from 'node:fs/promises'
import { createServer } from 'node:http'
import { chromium } from '@playwright/test'
import { installation } from './harness.mjs'

const from='2026-10-01',to='2026-10-15',timeZone='UTC'
const days=Array.from({length:14},(_,i)=>new Date(Date.parse(from)+i*86400000).toISOString().slice(0,10))
const sourceSite='synthetic-vane-3.example',sourceLabel='synthetic-vane-2.example'
const token='synthetic-vane-4-one-use-token',raw='synthetic-vane-5-raw-response-never-persist'
const querySpecs=[
 {dimensions:['time:day'],metrics:['visitors','visits','pageviews','bounce_rate']},
 {dimensions:['time:day','visit:source'],metrics:['visitors']},
 {dimensions:['time:day','event:goal'],metrics:['events']},
]
const goalsFor=day=>['signup','signed-up','paid-order',...(day===days[1]?['scroll-read']:[])]
// Independent source fixture: the first day includes the bot rejected by Vane's real collect door.
const exported={format:'vane-plausible-parallel/1',sourceSite,timeZone,queries:querySpecs.map((spec,i)=>{
 const results=i===2?days.flatMap(day=>goalsFor(day).map(label=>({dimensions:[day,label],metrics:[1]}))):days.map((day,n)=>({dimensions:i===0?[day]:[day,sourceLabel],metrics:i===0?[n===0?2:1,n===0?2:1,n===0?2:1,n===1?0:100]:[n===0?2:1]}))
 return {query:{site_id:sourceSite,...spec,date_range:[from,days.at(-1)],filters:[],include:{imports:false,total_rows:true},pagination:{limit:500,offset:0}},results,meta:{total_rows:results.length},raw_source:raw}
})}
const evidence=['visitors','visits','pageviews','sourceVisitors'].map(metric=>({day:from,metric,...(metric==='sourceVisitors'?{label:sourceLabel}:{}),cause:'bot filtering',detail:'The source fixture retains one confirmed crawler page load; Vane rejected that same fixture crawler with reason bot.',source:'synthetic-vane-6 collector exclusion audit on 2026-10-01'}))
const json=async response=>{assert.equal(response.status,200,await response.clone().text());return response.json()}
const domainTables=async a=>Object.fromEntries(Object.entries(await a.dump()).filter(([name])=>/^(vane_|ik_)/.test(name)))

test('IMPORT-007 owner compares 14 live overlap days with paginated Plausible queries and an export, attributes measured bot differences only to owner evidence, saves nothing, and uses history forms at 1440 and 390',async t=>{
 let a,browser
 const server=createServer(async(req,res)=>{try{
  const chunks=[];for await(const chunk of req)chunks.push(chunk)
  const response=await a.request(req.url,{method:req.method,headers:req.headers,...(!['GET','HEAD'].includes(req.method)?{body:Buffer.concat(chunks)}:{})})
  res.writeHead(response.status,{...Object.fromEntries(response.headers),'set-cookie':response.headers.getSetCookie()});res.end(Buffer.from(await response.arrayBuffer()))
 }catch(error){res.writeHead(500);res.end(String(error))}})
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve))
 t.after(async()=>{await browser?.close();await a?.close();const closed=new Promise(resolve=>server.close(resolve));server.closeAllConnections();await closed})
 a=await installation({origin:`http://127.0.0.1:${server.address().port}`})
 const siteId=await a.addSite({name:'synthetic-vane-1',origin:'https://synthetic-vane-1.example',paths:[],goals:{signup:'/thanks'},scrollGoals:{'scroll-read':{path:'/thanks',depth:75}},customGoals:{'signed-up':{event:'Signup',revenue:false,currency:'USD',props:{plan:'pro'}},'paid-order':{event:'Purchase',revenue:true,currency:'USD'}},timeZone,retainForever:true})
 for(const day of days){
  await a.clock(Date.parse(day+'T12:00:00Z'))
  const page=a.event(siteId,{path:'/thanks',source:sourceLabel}),origin='https://synthetic-vane-1.example'
  assert.equal((await a.collect(page,origin)).status,202)
  const custom=extra=>a.post('/api/vane/custom',{id:crypto.randomUUID(),siteId,page:page.id,consent:'not-required',...extra},'',{origin})
  assert.equal((await custom({name:'Signup',props:{plan:'pro'}})).status,202)
  assert.equal((await custom({name:'Purchase',revenue:{amount:3.5,currency:'USD'}})).status,202)
  // Accepted custom events that do not match a configured goal must stay out of goal conversions.
  if(day===from){assert.equal((await custom({name:'Untracked'})).status,202);assert.equal((await custom({name:'Signup',props:{plan:'free'}})).status,202);assert.equal((await custom({name:'Purchase',revenue:{amount:2,currency:'EUR'}})).status,202)}
  if(day===days[1]){await a.clock(Date.parse(day+'T12:00:45Z'));assert.equal((await a.post('/api/vane/engage',{siteId,id:page.id,scroll:80},'',{origin})).status,202)}
  if(day===from)assert.equal((await a.post('/api/vane/collect',a.event(siteId,{path:'/',source:sourceLabel}),'',{origin:'https://synthetic-vane-1.example','user-agent':'Googlebot/2.1'})).status,403)
 }
 await a.clock(Date.parse(to+'T12:00:00Z'))
 const base={siteId,sourceSite,from,to,timeZone},read=body=>a.post('/api/vane/parallel-run',{...base,...body},a.owner)
 let mode='normal';const calls=[]
 a.fixtureSites['https://plausible.io']=async request=>{
  assert.equal(request.url,'https://plausible.io/api/v2/query');assert.equal(request.method,'POST');assert.equal(request.headers.get('authorization'),'Bearer '+token)
  const q=await request.json();calls.push(q)
  if(mode==='redirect')return new Response(null,{status:302,headers:{location:'https://synthetic-vane-7.example/'}})
  if(mode==='failure')return Response.json({error:token},{status:401})
  assert.equal(q.site_id,sourceSite);assert.deepEqual(q.date_range,[from,days.at(-1)]);assert.deepEqual(q.include,{imports:false,total_rows:true});assert.deepEqual(q.filters,[])
  const i=querySpecs.findIndex(spec=>JSON.stringify(spec.dimensions)===JSON.stringify(q.dimensions));assert.ok(i>=0);assert.deepEqual(q.metrics,querySpecs[i].metrics)
  // Return smaller pages than requested, proving pagination uses total_rows, rather than page length.
  const fixture=exported.queries[i],offset=q.pagination.offset
  return Response.json({...fixture,query:q,results:fixture.results.slice(offset,offset+7)})
 }
 const admin=await a.invite('synthetic-vane-8@example.test','admin')
 assert.equal((await a.post('/api/vane/parallel-run',{...base,token})).status,401)
 assert.equal((await a.post('/api/vane/parallel-run',{...base,token},admin)).status,403);assert.equal(calls.length,0)
 for(const change of [{endpoint:'https://synthetic-vane-7.example/'},{from:'2026-02-30'},{to:'2026-10-14'},{timeZone:'Australia/Brisbane'},{token:'short'},{evidence:[{...evidence[0],source:''}]}])assert.equal((await read({token,...change})).status,400)
 const before=await domainTables(a)
 const unknown=await json(await read({token}))
 assert.equal(unknown.importedOff,true);assert.equal(unknown.complete,false);assert.equal(unknown.unresolved,4);assert.equal(unknown.days.length,14);assert.equal(calls.length,exported.queries.reduce((sum,q)=>sum+Math.ceil(q.results.length/7),0))
 for(const [n,d] of unknown.days.entries()){
  const goalCount=goalsFor(d.day).length,bounce=n===1?0:100
  assert.equal(d.day,days[n]);assert.deepEqual(d.metrics.map(r=>r.vane),[1,1,1,bounce,goalCount]);assert.deepEqual(d.metrics.map(r=>r.plausible),[n===0?2:1,n===0?2:1,n===0?2:1,bounce,goalCount])
  assert.equal(d.sources[0].label,sourceLabel);assert.equal(d.sources[0].vane,1);assert.equal(d.sources[0].plausible,n===0?2:1)
  assert.deepEqual(d.goals.map(r=>r.label).sort(),goalsFor(d.day).sort());for(const goal of d.goals){assert.equal(goal.vane,1);assert.equal(goal.plausible,1)}
 }
 for(const difference of [...unknown.days[0].metrics,...unknown.days[0].sources].filter(r=>r.material)){assert.equal(difference.status,'unmeasured');assert.equal(difference.evidence,undefined)}
 const explained=await json(await read({token,evidence}));assert.equal(explained.complete,true);assert.equal(explained.unresolved,0)
 for(const difference of [...explained.days[0].metrics,...explained.days[0].sources].filter(r=>r.material)){
  assert.equal(difference.percent,-50);assert.equal(difference.status,'owner evidence');assert.equal(difference.evidence.cause,'bot filtering');assert.equal(difference.evidence.source,evidence[0].source)
 }
 const summary=await json(await a.request(`/api/vane/summary?siteId=${siteId}&from=${from}&to=${to}&imported=off`,{headers:{cookie:a.owner}}))
 assert.deepEqual(summary.exclusions,[{reason:'bot',count:1}]);assert.equal(summary.pageviews,14)
 assert.deepEqual(summary.goalBreakdown.map(r=>[r.label,r.count]).sort(),[['paid-order',14],['scroll-read',1],['signed-up',14],['signup',14]])
 assert.ok(summary.customEvents.find(r=>r.name==='Untracked'),'ordinary custom events remain visible in their own report')
 const reads=calls.length,uploaded=await json(await read({document:exported,evidence}))
 assert.deepEqual(uploaded.days,explained.days);assert.equal(uploaded.source,'Plausible Stats API export');assert.equal(calls.length,reads)
 const nullBounce=structuredClone(exported);nullBounce.queries[0].results[1].metrics[3]=null
 const missing=await json(await read({document:nullBounce,evidence}));assert.equal(missing.complete,false);assert.equal(missing.days[1].metrics.find(r=>r.metric==='bounceRate').status,'unmeasured')
 const truncated=structuredClone(exported);truncated.queries[1].results.pop();assert.equal((await read({document:truncated})).status,400)
 const filtered=structuredClone(exported);filtered.queries[0].query.filters=[['is','visit:source',[sourceLabel]]];assert.equal((await read({document:filtered})).status,400)
 const duplicate=structuredClone(exported);duplicate.queries[0].results[1]=duplicate.queries[0].results[0];assert.equal((await read({document:duplicate})).status,400)
 mode='redirect';assert.equal((await read({token})).status,502);assert.equal(a.egress.some(url=>url.startsWith('https://synthetic-vane-7.example')),false)
 mode='failure';const failure=await read({token});assert.equal(failure.status,502);assert.equal((await failure.text()).includes(token),false);mode='normal'
 assert.deepEqual(await domainTables(a),before,'report reads and failed reads write no domain data')
 for(const absent of [token,raw,evidence[0].detail]){assert.equal(JSON.stringify(explained).includes(absent),absent===evidence[0].detail);assert.equal(JSON.stringify(await a.dump()).includes(absent),false)}
 // Use native browser file uploads and form POSTs against the actual HTTP transport.
 browser=await chromium.launch({headless:true,args:['--use-mock-keychain','--password-store=basic']})
 const context=await browser.newContext();await context.addCookies(a.owner.split('; ').map(pair=>{const [name,...value]=pair.split('=');return {name,value:value.join('='),url:a.origin}}))
 const tab=await context.newPage(),screens=process.env.VANE_SCREEN_DIR;if(screens)await mkdir(screens,{recursive:true})
 const upload=async evidenceValues=>{
  const form=tab.getByRole('heading',{name:'Compare a parallel run',exact:true}).locator('..')
  await form.getByLabel('First overlap date',{exact:true}).fill(from);await form.getByLabel('Day after the final overlap date',{exact:true}).fill(to)
  await form.getByLabel('Plausible site ID',{exact:true}).fill(sourceSite)
  await form.getByLabel('Stats API query responses (instead of a token)',{exact:true}).setInputFiles({name:'synthetic-vane-9.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(exported))})
  await form.getByLabel('Evidence for differences over 5% (JSON)',{exact:true}).fill(JSON.stringify(evidenceValues))
  await form.getByRole('button',{name:'Compare overlap days',exact:true}).click();await tab.locator('[data-parallel-report]').waitFor({state:'visible'})
 }
 const capture=async(label,width)=>{
  assert.equal(await tab.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,'parallel history fits '+width)
  if(screens)await tab.screenshot({path:`${screens}/parallel-${label}-${width}.png`})
 }
 for(const width of [1440,390]){
  await tab.setViewportSize({width,height:960});await tab.goto(`${a.origin}/app/sites/${siteId}?section=history`)
  await upload([]);assert.equal(await tab.locator('[data-parallel-day]').count(),14);assert.equal(await tab.locator('[data-parallel-status="unmeasured"]').count(),4)
  await tab.getByRole('heading',{name:'Parallel-run comparison',exact:true}).scrollIntoViewIfNeeded();await capture('unmeasured',width)
  await upload(evidence);assert.equal(await tab.locator('[data-parallel-report]').getAttribute('data-parallel-complete'),'true');assert.equal(await tab.locator('[data-parallel-status="owner evidence"]').count(),4)
  const first=tab.locator(`[data-parallel-day="${from}"]`);assert.ok((await first.innerText()).includes('bot filtering'));await first.scrollIntoViewIfNeeded();await capture('evidence',width)
  assert.equal(await tab.getByLabel('One-use Plausible Stats API token',{exact:true}).inputValue(),'')
 }
 await tab.goto(`${a.origin}/app/sites/${siteId}?section=history`);assert.equal(await tab.locator('[data-parallel-report]').count(),0,'report and evidence are request-local')
 assert.deepEqual(await domainTables(a),before,'browser report forms save no domain data')
})

import test from 'node:test'
import { mkdir } from 'node:fs/promises'
import { createServer } from 'node:http'
import { join } from 'node:path'
import { assert, installation, browse } from './vane-helpers.mjs'
const DAY=86400000,BASE='2026-09-07',BASE_END='2026-09-14',NOW=Date.parse('2026-10-10T12:00:00Z')
const dates=(from,to)=>Array.from({length:(Date.parse(to)-Date.parse(from))/DAY},(_,i)=>new Date(Date.parse(from)+i*DAY).toISOString().slice(0,10))
async function result(r,status=200){assert.equal(r.status,status,await r.clone().text());return r.json()}
// Serve the actual Worker over HTTP for browser form redirects, rather than fulfilling a redirect back to an
// intercepted URL (Chromium leaves that as an empty document). Native auth, route dispatch and response status stay real.
async function httpInstallation(t,options={}) {
 let app
 const server=createServer(async(req,res)=>{try{
  const chunks=[];for await(const chunk of req)chunks.push(chunk)
  const headers=Object.fromEntries(Object.entries(req.headers).filter(([k])=>!['host','content-length','transfer-encoding','connection'].includes(k)))
  const response=await app.request(req.url,{method:req.method,headers,...(['GET','HEAD'].includes(req.method)?{}:{body:Buffer.concat(chunks)})})
  const responseHeaders=Object.fromEntries(response.headers);delete responseHeaders['content-length'];delete responseHeaders['content-encoding'];responseHeaders['set-cookie']=response.headers.getSetCookie()
  res.writeHead(response.status,responseHeaders);res.end(Buffer.from(await response.arrayBuffer()))
 }catch{res.writeHead(500);res.end('Fixture HTTP bridge failed')}})
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>{server.close();server.closeAllConnections()})
 app=await installation({...options,origin:`http://127.0.0.1:${server.address().port}`});app.servesHttp=true;t.after(()=>app.close());return app
}

const input=(siteId,from,to)=>({siteId,from,to,comparedFrom:BASE,comparedTo:BASE_END})
async function sender(a,siteId){const r=await result(await a.post('/api/vane/movement-evidence/settings',{siteId,enabled:'on',confirm:'on'},a.owner));assert.ok(r.token);return r.token}
async function send(a,token,body){return a.request('/api/vane/agent-evidence',{method:'POST',headers:{authorization:'Bearer '+token,'content-type':'application/json'},body:JSON.stringify(body)})}
// An independent business-server edge: real HTTP checkout requests fail with 500 after a deploy. Only successful
// responses add a confirmed order to its private ledger; Vane receives daily aggregates, never those order IDs.
async function checkoutEdge(t) {
 const state={broken:false,firstBrokenDay:'',days:new Map(),orderIds:[]}
 const server=createServer(async(req,res)=>{
  const url=new URL(req.url,'http://localhost')
  if(req.method==='GET'&&url.pathname==='/counts'){res.setHeader('content-type','application/json');return res.end(JSON.stringify(state.days.get(url.searchParams.get('day'))??{attempts:0,orders:0,errors:0}))}
  if(req.method!=='POST'||url.pathname!=='/checkout'){res.writeHead(404);return res.end()}
  const chunks=[];for await(const chunk of req)chunks.push(chunk);const {day,attempt}=JSON.parse(Buffer.concat(chunks).toString())
  const row=state.days.get(day)??{attempts:0,orders:0,errors:0};row.attempts++
  const failed=state.broken&&attempt>=2,complete=!failed&&(!state.broken?attempt<2:day===state.firstBrokenDay&&attempt===0)
  if(failed)row.errors++
  let orderId=null;if(complete){row.orders++;orderId=crypto.randomUUID();state.orderIds.push(orderId)}state.days.set(day,row)
  res.writeHead(failed?500:complete?201:200,{'content-type':'application/json'});res.end(JSON.stringify(failed?{error:'Checkout unavailable'}:{completed:complete,orderId}))
 })
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>{server.close();server.closeAllConnections()})
 const origin=`http://127.0.0.1:${server.address().port}`
 return {state,async run(from,to,broken){state.broken=broken;state.firstBrokenDay=from
  for(const day of dates(from,to))for(let attempt=0;attempt<5;attempt++){const response=await fetch(origin+'/checkout',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({day,attempt})}),body=await response.json();assert.equal(response.status,broken&&attempt>=2?500:(!broken&&attempt<2||broken&&day===from&&attempt===0)?201:200);if(response.status===201)assert.ok(body.orderId)}
 },async publish(a,siteId,key,from,to){for(const day of dates(from,to)){const row=await(await fetch(origin+'/counts?'+new URLSearchParams({day}))).json();for(const [metric,numerator] of [['orders',row.orders],['checkout-errors',row.errors]])await result(await send(a,key,{siteId,day,metric,numerator,denominator:row.attempts,revision:1}),201)}}}
}
async function dailyEvidence(a,id,key,from,to,{orders=2,errors=0,attempts=5}={}){for(const [index,day] of dates(from,to).entries())for(const [metric,numerator] of [['orders',typeof orders==='function'?orders(index):orders],['checkout-errors',errors]])await result(await send(a,key,{siteId:id,day,metric,numerator,denominator:attempts,revision:1,url:'https://source.example/receipts?discard=synthetic-vane-6'}),201)}
async function traffic(a,id,origin,from,to,{visits=5,success=2}={}) {
 for(const [d,day] of dates(from,to).entries())for(let i=0;i<visits;i++){
  const at=Date.parse(day+'T12:00:00Z')+i*60000,ip='198.51.100.'+(i+1)
  await a.clock(at)
  const post=path=>a.post('/api/vane/collect',a.event(id,{path,source:'google.com',campaign:'launch'}),'',{origin,'cf-connecting-ip':ip})
  assert.equal((await post('/checkout')).status,202)
  if(i<(typeof success==='function'?success(d):success)){await a.clock(at+1000);assert.equal((await post('/thanks')).status,202)}
 }
}
async function google(a,id,origin){
 a.fixtureSites['https://oauth2.googleapis.com']=async()=>Response.json({access_token:'synthetic-vane-3',refresh_token:'synthetic-vane-4',expires_in:3600,token_type:'Bearer',scope:'https://www.googleapis.com/auth/webmasters.readonly'})
 a.fixtureSites['https://www.googleapis.com']=async request=>{
  const u=new URL(request.url);if(u.pathname==='/webmasters/v3/sites')return Response.json({siteEntry:[{siteUrl:origin+'/',permissionLevel:'siteOwner'}]})
  const q=await request.json();assert.equal(request.headers.get('authorization'),'Bearer synthetic-vane-3');assert.equal(q.dataState,'final')
  const rows=dates(BASE,'2026-10-05').filter(d=>d>=q.startDate&&d<=q.endDate).map(day=>{const dropped=day>='2026-09-21'&&day<'2026-09-28',clicks=dropped?2:10,impressions=100,position=dropped?9:2
   return {keys:q.dimensions.map(d=>d==='date'?day:d==='query'?'organic guide':origin+'/checkout'),clicks,impressions,ctr:clicks/impressions,position}})
  return Response.json({rows,responseAggregationType:'byProperty'})
 }
 const begin=await a.form({operation:'search.google.begin',siteId:id},a.owner);assert.equal(begin.status,303)
 const state=new URL(begin.headers.get('location')).searchParams.get('state')
 assert.equal((await a.request('/api/vane/search-console/callback?'+new URLSearchParams({state,code:'synthetic-vane-5'}),{headers:{cookie:a.owner}})).status,303)
 assert.equal((await a.form({operation:'search.google.property',siteId:id,property:origin+'/'},a.owner)).status,303)
 assert.equal((await a.form({operation:'search.google.sync',siteId:id,from:BASE,to:'2026-10-05'},a.owner)).status,303)
}
async function annotation(a,id,{day,title,kind='note'}){
 if(kind==='note'){assert.equal((await a.form({operation:'annotation.add',siteId:id,day,text:title},a.owner)).status,303);return}
 const secretResponse=await a.form({operation:'annotation-hook.create',siteId:id},a.owner),key=(await secretResponse.text()).match(/data-annotation-secret>(vane_ah_[0-9a-f]{64})</)[1]
 assert.equal((await a.request('/api/vane/annotations',{method:'POST',headers:{authorization:'Bearer '+key,'content-type':'application/json'},body:JSON.stringify({siteId:id,id:'synthetic-vane-7',kind,at:day+'T12:00:00Z',title,url:'https://source.example/incidents/checkout'})})).status,201)
}

test('Movement investigations rank a tracking break, organic ranking drop and corroborated checkout failure first in three fixture weeks, cite denominators, preserve unknowns and list every window annotation at 1440 and 390',async t=>{
 const a=await httpInstallation(t,{vars:{GOOGLE_CLIENT_ID:'synthetic-vane-1',GOOGLE_CLIENT_SECRET:'synthetic-vane-2'}});await a.clock(Date.parse('2026-09-01T12:00:00Z'))
 const cases=[{name:'tracking',from:'2026-09-14',to:'2026-09-21',category:'tracking-coverage'},{name:'organic',from:'2026-09-21',to:'2026-09-28',category:'channel-mix'},{name:'checkout',from:'2026-09-28',to:'2026-10-05',category:'page-behavior'}]
 for(const c of cases){
  c.origin=`https://${c.name}.example`;c.id=await a.addSite({origin:c.origin,name:c.name,paths:[],goals:{signup:'/thanks'},retainForever:true,funnels:[{name:'checkout',steps:['/checkout','goal:signup']}],eventDefinitions:[{name:'Signup',kind:'click',target:'#signup'}]})
  await traffic(a,c.id,c.origin,BASE,BASE_END)
  await traffic(a,c.id,c.origin,c.from,c.to,{visits:c.name==='checkout'?5:1,success:c.name==='checkout'?d=>d===0?1:0:0})
  await annotation(a,c.id,{day:c.from,title:'In-window '+c.name})
  await annotation(a,c.id,{day:BASE,title:'Out-of-window '+c.name})
 }
 // A real native sitemap investigation records structural evidence inside the tracking-break window.
 const tracking=cases[0];await a.clock(Date.parse('2026-09-20T18:00:00Z'))
 a.fixtureSites[tracking.origin]=request=>{const p=new URL(request.url).pathname;return p==='/robots.txt'?new Response('User-agent: *'):p==='/sitemap.xml'?new Response(`<urlset><url><loc>${tracking.origin}/checkout</loc></url></urlset>`):new Response('<!doctype html><h1>Changed checkout</h1><button id="join-now">Join</button>')}
 const inspected=await result(await a.post('/api/vane/instrumentation/run',{siteId:tracking.id,from:tracking.from,to:tracking.to,pageLimit:10},a.owner));assert.ok(inspected.problems.some(p=>p.kind==='missing-script'))
 await a.clock(NOW);await google(a,cases[1].id,cases[1].origin)
 await annotation(a,cases[2].id,{day:'2026-10-01',title:'Checkout failures reported by Spool',kind:'error-spike'})
 const business=await checkoutEdge(t);await business.run(BASE,BASE_END,false);await business.run(cases[2].from,cases[2].to,true)
 for(const c of [cases[0],cases[2]]){c.key=await sender(a,c.id);if(c.name==='checkout'){await business.publish(a,c.id,c.key,BASE,BASE_END);await business.publish(a,c.id,c.key,c.from,c.to)}else{await dailyEvidence(a,c.id,c.key,BASE,BASE_END);await dailyEvidence(a,c.id,c.key,c.from,c.to)}}
 assert.equal(business.state.orderIds.length,15,'fourteen baseline orders and one after the actual checkout failure')
 for(const c of cases){
  c.result=await result(await a.post('/api/vane/movement',input(c.id,c.from,c.to),a.owner));const answer=c.result
  assert.equal(answer.hypotheses[0].category,c.category,c.name);assert.ok(answer.hypotheses[0].evidence.length>=2);assert.ok(answer.hypotheses.every(h=>h.disprove.length>30&&h.limitation.length>20&&['low','medium'].includes(h.confidence)))
  assert.match(answer.statement,/Correlation is not proof/);assert.ok(answer.unknown.some(u=>/not measured|unavailable|incomplete/.test(u)))
  assert.ok(answer.annotations.some(n=>n.text==='In-window '+c.name));assert.equal(answer.annotations.some(n=>n.text==='Out-of-window '+c.name),false)
  const report=await result(await a.request('/api/vane/summary?'+new URLSearchParams({siteId:c.id,from:c.from,to:c.to,compare:'custom',compareFrom:BASE,compareTo:BASE_END,imported:'off'}),{headers:{cookie:a.owner}}))
  const accepted=answer.hypotheses.flatMap(h=>h.evidence).find(e=>e.label==='Accepted native page loads');assert.deepEqual([accepted.now,accepted.then,accepted.denominatorNow,accepted.denominatorThen],[report.pageviews,report.previousPageviews,report.pageviews,report.previousPageviews])
  assert.ok(answer.hypotheses.flatMap(h=>h.evidence).every(e=>!e.href.includes('discard=')))
 }
 assert.match(cases[1].result.hypotheses[0].title,/Organic ranking decline/)
 assert.deepEqual(cases[1].result.hypotheses[0].evidence[0],{label:'Google query “organic guide” (Pacific dates, source-limited)',unit:'clicks',denominatorUnit:'source impressions',now:14,then:70,denominatorNow:700,denominatorThen:700,href:cases[1].result.hypotheses[0].evidence[0].href})
 assert.match(cases[2].result.hypotheses[0].title,/Checkout failure/);assert.ok(cases[2].result.annotations.some(n=>n.kind==='error-spike'&&n.text==='Checkout failures reported by Spool'))
 const orders=cases[2].result.hypotheses[0].evidence.find(e=>e.unit==='completed orders');assert.deepEqual([orders.now,orders.then,orders.denominatorNow,orders.denominatorThen],[1,14,35,35])
 assert.ok(cases[2].result.unknown.some(u=>u.includes('not independently verified')),'a sender credential is never labelled provider verification')
 const beforeEgress=a.egress.length
 for(const c of cases)await result(await a.post('/api/vane/movement',input(c.id,c.from,c.to),a.owner))
 assert.equal(a.egress.length,beforeEgress,'investigating uses stored facts and makes no model/provider request')
 const {context}=await browse(t,a);await context.addCookies(a.owner.split('; ').map(pair=>{const i=pair.indexOf('=');return {name:pair.slice(0,i),value:pair.slice(i+1),url:a.origin}}));const page=await context.newPage(),dir=process.env.VANE_SCREEN_DIR;if(dir)await mkdir(dir,{recursive:true})
 for(const width of [1440,390])for(const c of cases){
  await page.setViewportSize({width,height:1000});await page.goto(`${a.origin}/app/sites/${c.id}?${new URLSearchParams({from:c.from,to:c.to,compare:'custom',compareFrom:BASE,compareTo:BASE_END})}#movement`)
  assert.equal(await page.locator('[data-movement-result]').count(),1,'the saved exact-window investigation is rendered before submit')
  const submitted=page.waitForResponse(r=>new URL(r.url()).pathname==='/app/action'&&r.request().method()==='POST');await page.getByRole('button',{name:'Investigate why numbers moved',exact:true}).focus();await page.keyboard.press('Enter');const response=await submitted;assert.equal(response.status(),303,'movement form returns its normal redirect');const posted=Object.fromEntries(new URLSearchParams(response.request().postData()));assert.deepEqual([posted.from,posted.to,posted.comparedFrom,posted.comparedTo],[c.from,c.to,BASE,BASE_END]);await page.waitForURL(url=>url.hash==='#movement'&&url.searchParams.get('compareFrom')===BASE&&url.searchParams.get('compareTo')===BASE_END)
  await page.waitForLoadState('domcontentloaded');const view=page.locator('[data-movement-result]');await view.locator('li[data-movement-category]').first().scrollIntoViewIfNeeded();assert.equal(await view.locator('li[data-movement-category]').first().getAttribute('data-movement-category'),c.category)
  assert.match(await view.textContent(),/What would disprove it/);assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true)
  if(dir)await page.screenshot({path:join(dir,`movement-${c.name}-${width}.png`)})
  await view.locator('[data-movement-unknown]').scrollIntoViewIfNeeded();if(dir)await page.screenshot({path:join(dir,`movement-unknown-${c.name}-${width}.png`)})
 }
 const dump=await a.dump();for(const orderId of business.state.orderIds)assert.equal(JSON.stringify(dump).includes(orderId),false,'business order identities never enter Vane');assert.ok(dump.vane_audit.some(r=>r.action==='agent.movement'));assert.equal(dump.vane_movement_investigations.length,12)
})

test('Aggregate evidence is off until explicit owner consent, shown once and hashed, scoped, revision-safe, revocable and limited, and never grants native or annotation authority',async t=>{
 const a=await installation();t.after(()=>a.close());await a.clock(NOW)
 const id=await a.addSite({paths:[],goals:{}}),other=await a.addSite({origin:'https://other.example',paths:[],goals:{}}),admin=await a.invite('synthetic-vane-evidence-admin@example.test','admin'),viewer=await a.invite('synthetic-vane-evidence-viewer@example.test','member')
 const configure=(extra={},cookie=a.owner)=>a.post('/api/vane/movement-evidence/settings',{siteId:id,enabled:'on',confirm:'on',...extra},cookie)
 const body={siteId:id,day:'2026-10-01',metric:'orders',numerator:2,denominator:5,revision:1}
 assert.equal((await send(a,'synthetic-vane-8',body)).status,401)
 for(const cookie of [admin,viewer,''])assert.equal((await configure({},cookie)).status,cookie?403:401)
 assert.equal((await configure({confirm:''})).status,400)
 const key=(await result(await configure())).token
 assert.equal((await send(a,key,{...body,siteId:other})).status,401)
 assert.equal((await a.request('/api/vane/sites',{headers:{authorization:'Bearer '+key}})).status,401)
 assert.equal((await a.request('/api/vane/annotations',{method:'POST',headers:{authorization:'Bearer '+key,'content-type':'application/json'},body:JSON.stringify({siteId:id,id:'synthetic-vane-9',kind:'deploy',at:NOW,title:'Not authorized'})})).status,401)
 for(const bad of [{...body,orderId:'synthetic-vane-10'},{...body,numerator:6},{...body,denominator:-1},{...body,metric:'customer'},{...body,revision:0},{...body,day:'2030-01-01'},{...body,url:'https://user:password@source.example/'},{...body,url:'javascript:alert(1)'}])assert.equal((await send(a,key,bad)).status,400)
 await result(await send(a,key,{...body,url:'https://source.example/orders/1234567?secret=synthetic-vane-11#fragment'}),201)
 const redacted=await result(await a.request(`/api/vane/movement-evidence?siteId=${id}&from=2026-10-01&to=2026-10-02`,{headers:{cookie:a.owner}}));assert.equal(redacted[0].url,'https://source.example/orders/:number')
 const corrected={...body,numerator:3,revision:2};await result(await send(a,key,corrected),201)
 assert.equal((await result(await send(a,key,corrected))).duplicate,true);assert.equal((await result(await send(a,key,body))).stale,true)
 assert.equal((await send(a,key,{...corrected,numerator:4})).status,409)
 const rows=await result(await a.request(`/api/vane/movement-evidence?siteId=${id}&from=2026-10-01&to=2026-10-02`,{headers:{cookie:a.owner}}));assert.equal(rows.length,1);assert.equal(rows[0].numerator,3)
 const rotated=(await result(await configure())).token;assert.notEqual(rotated,key);assert.equal((await send(a,key,{...corrected,revision:3})).status,401)
 const count=(await a.dump()).vane_agent_evidence_keys[0].requests
 for(let i=count;i<60;i++)await result(await send(a,rotated,{...corrected,revision:i+3}),201)
 assert.equal((await send(a,rotated,{...corrected,revision:1000})).status,429)
 await a.clock(NOW+3600000);await result(await send(a,rotated,{...corrected,revision:1001}),201)
 const dump=await a.dump();assert.equal(dump.vane_agent_evidence_keys[0].secret_hash.length,64);assert.equal(JSON.stringify(dump).includes(rotated),false);assert.equal(JSON.stringify(dump).includes(key),false);assert.ok(dump.vane_audit.some(r=>r.action==='agent.evidence.enable'))
 const archive=await a.archive();assert.equal(archive.payload.tables.vane_agent_evidence_keys,undefined);assert.ok(archive.payload.tables.vane_agent_evidence.length)
 await result(await configure({enabled:'off'}));assert.equal((await send(a,rotated,{...corrected,revision:1002})).status,401)
 assert.equal((await a.request(`/api/vane/movement-evidence?siteId=${id}&from=2026-10-01&to=2026-10-02`,{headers:{cookie:viewer}})).status,403)
 // The enabled/disabled state is visible at both widths; the credential is absent on a subsequent GET.
 const {context}=await browse(t,a);await context.addCookies(a.owner.split('; ').map(pair=>{const i=pair.indexOf('=');return {name:pair.slice(0,i),value:pair.slice(i+1),url:a.origin}}));const page=await context.newPage(),dir=process.env.VANE_SCREEN_DIR;if(dir)await mkdir(dir,{recursive:true})
 for(const width of [1440,390]){await page.setViewportSize({width,height:1000});await page.goto(`${a.origin}/app/sites/${id}?section=settings`);await page.getByRole('heading',{name:'Incoming aggregate evidence',exact:true}).scrollIntoViewIfNeeded();assert.equal(await page.locator('[data-agent-evidence-token]').count(),0);assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);if(dir)await page.screenshot({path:join(dir,`movement-evidence-settings-${width}.png`)})}
})

test('Movement refuses invalid or private requests, missing source dates never become zero causes, and derived evidence follows archives, erasure and retention',async t=>{
 const a=await installation();t.after(()=>a.close());await a.clock(NOW)
 const id=await a.addSite({paths:[],goals:{},retainForever:true}),viewer=await a.invite('synthetic-vane-movement-viewer@example.test','member'),p=input(id,'2026-09-14','2026-09-21')
 assert.equal((await a.post('/api/vane/movement',p,'')).status,401);assert.equal((await a.post('/api/vane/movement',p,viewer)).status,403)
 assert.equal((await a.post('/api/vane/movement',p,a.owner,{origin:'https://foreign.example'})).status,403)
 for(const bad of [{...p,to:'2026-09-14'},{...p,to:'2026-10-21'},{...p,comparedTo:'2026-09-15'},{...p,comparedFrom:'2026-09-15',comparedTo:'2026-09-22'},{...p,from:'0001-01-01'},{...p,filters:['visitor:is:synthetic-vane-12']}])assert.equal((await a.post('/api/vane/movement',bad,a.owner)).status,400)
 const key=await sender(a,id);await result(await send(a,key,{siteId:id,day:p.from,metric:'orders',numerator:0,denominator:0,revision:1}),201)
 const importedDocument={data:[{id:'synthetic-vane-14',createdAt:'2026-09-16T12:00:00Z',urlPath:'/',eventType:1}],count:1,page:1,pageSize:1}
 const preview=await result(await a.post('/api/vane/import-preview',{siteId:id,document:importedDocument},a.owner));await result(await a.post('/api/vane/import-apply',{siteId:id,document:preview.carry,fingerprint:preview.fingerprint},a.owner))
 const mixed=await result(await a.request('/api/vane/summary?'+new URLSearchParams({siteId:id,from:p.from,to:p.to}),{headers:{cookie:a.owner}}));assert.equal(mixed.pageviews,1,'ordinary reports retain the reviewed imported page load')
 const answer=await result(await a.post('/api/vane/movement',p,a.owner));assert.equal(answer.nativeOnly,true);assert.ok(answer.unknown.some(u=>u.includes('Imported history is excluded')));assert.equal(answer.hypotheses.length,0,'unknown imported coverage cannot become a native-traffic cause');assert.ok(answer.unknown.some(u=>u.includes('1/7 current')&&u.includes('not zero')));assert.ok(answer.sourceCoverage.every(c=>c.complete===false));assert.equal(answer.hypotheses.some(h=>/missing|unavailable|unknown/.test(h.title)),false)
 const archive=await a.archive();assert.ok(archive.payload.tables.vane_movement_investigations.length);assert.equal(archive.payload.tables.vane_agent_evidence_keys,undefined)
 const restored=await installation();try{await result(await restored.post('/api/vane/restore',{archive},restored.owner));const history=await result(await restored.request('/api/vane/movement?siteId='+id,{headers:{cookie:restored.owner}}));assert.equal(history[0].id,answer.id);assert.equal((await send(restored,key,{siteId:id,day:p.from,metric:'orders',numerator:1,denominator:1,revision:2})).status,401)}finally{await restored.close()}
 const erase=await result(await a.post('/api/vane/commands',{command:'history.erase',input:{siteId:id}},a.owner),201);assert.equal((await a.form({operation:'proposal.approve',id:erase.id},a.owner)).status,303)
 let dump=await a.dump();assert.equal(dump.vane_agent_evidence.length,0);assert.equal(dump.vane_movement_investigations.length,0);assert.ok(dump.vane_audit.some(r=>r.action==='agent.movement'))
 // Retention removes source aggregates and derived explanations whose current or compared window was erased.
 assert.equal((await send(a,key,{siteId:id,day:p.from,metric:'orders',numerator:0,denominator:0,revision:1})).status,409,'erased aggregates cannot be replayed')
 const retentionId=await a.addSite({origin:'https://retention.example',paths:[],goals:{},retainForever:true}),retentionKey=await sender(a,retentionId),retentionInput={...p,siteId:retentionId}
 await result(await send(a,retentionKey,{siteId:retentionId,day:p.from,metric:'orders',numerator:0,denominator:0,revision:1}),201);await result(await a.post('/api/vane/movement',retentionInput,a.owner))
 const sites=await result(await a.request('/api/vane/sites',{headers:{cookie:a.owner}})),s=sites.find(s=>s.id===retentionId),config={...s.config};delete config.retainForever;config.retentionDays=30
 const change=await result(await a.post('/api/vane/commands',{command:'site.configure',input:{siteId:retentionId,name:s.name,origin:s.origin,config}},a.owner),201);assert.equal((await a.form({operation:'proposal.approve',id:change.id},a.owner)).status,303)
 await a.clock(Date.parse('2026-12-01T12:00:00Z'));assert.equal((await a.form({operation:'history.retention',siteId:retentionId},a.owner)).status,303)
 dump=await a.dump();assert.equal(dump.vane_agent_evidence.length,0);assert.equal(dump.vane_movement_investigations.length,0)
 const remove=await result(await a.post('/api/vane/commands',{command:'site.delete',input:{siteId:id}},a.owner),201);assert.equal((await a.form({operation:'proposal.approve',id:remove.id},a.owner)).status,303);assert.equal((await a.dump()).vane_agent_evidence_keys.some(k=>k.site_id===id),false)
 await a.clock(NOW)
 const consentOrigin='https://consent.example',consentId=await a.addSite({origin:consentOrigin,paths:[],goals:{},consent:'required',declinedCounter:false,retainForever:true})
 await a.clock(Date.parse('2026-09-08T12:00:00Z'));for(let i=0;i<5;i++)assert.equal((await a.collect(a.event(consentId,{consent:'granted'}),consentOrigin)).status,202)
 const all=await result(await a.request('/api/vane/sites',{headers:{cookie:a.owner}})),cs=all.find(s=>s.id===consentId)
 const enabling=await result(await a.post('/api/vane/commands',{command:'site.configure',input:{siteId:consentId,name:cs.name,origin:cs.origin,config:{...cs.config,declinedCounter:true}}},a.owner),201);assert.equal((await a.form({operation:'proposal.approve',id:enabling.id},a.owner)).status,303)
 await a.clock(Date.parse('2026-09-15T12:00:00Z'));assert.equal((await a.collect(a.event(consentId,{consent:'granted'}),consentOrigin)).status,202)
 for(let i=0;i<20;i++)assert.equal((await a.post('/api/vane/declined/'+consentId,undefined,'',{origin:consentOrigin})).status,202)
 await a.clock(NOW);const historical=await result(await a.post('/api/vane/movement',{...p,siteId:consentId},a.owner))
 assert.equal(historical.hypotheses.some(h=>h.title==='Changed consent coverage is consistent with the drop'),false,'a newly enabled counter cannot fabricate a past consent denominator')
 assert.ok(historical.unknown.some(u=>u.includes('preserved approved history')))

})

import test from 'node:test'
import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { assert, installation, browse } from './vane-helpers.mjs'
const origin='http://127.0.0.1:9137',DAY=86400000
const windowOf=at=>({from:new Date(at-DAY).toISOString().slice(0,10),to:new Date(at+DAY).toISOString().slice(0,10)})
function website(a,id,state) {
 const html=path=>`<!doctype html><title>Fixture</title><h1>Fixture</h1><p>synthetic-vane-private-body</p><input id="account123456" value="synthetic-vane-private-input"><button id="${state.broken?'join-now':'signup'}">Join</button>${state.broken&&path==='/pricing'?'':`<script>window.plausible=function(){};plausible.init=o=>plausible.o=o;plausible.init({captureOnLocalhost:true});</script><script defer src="${a.origin}/vane.js" data-site="${id}"></script>`}`
 const requests=[]
 a.fixtureSites[origin]=request=>{requests.push({url:request.url,headers:Object.fromEntries(request.headers)});const u=new URL(request.url)
  if(u.pathname==='/robots.txt')return new Response('User-agent: *\nDisallow: /private')
  if(u.pathname==='/sitemap.xml')return new Response(`<urlset><url><loc>${origin}/</loc></url><url><loc>${origin}/pricing</loc></url></urlset>`)
  return new Response(html(u.pathname),{headers:{'content-type':'text/html'}})
 }
 return {html,requests}
}
async function result(response,status=200){assert.equal(response.status,status,await response.clone().text());return response.json()}
async function deploy(a,id,at,key){
 await a.clock(at)
 if(!key){const r=await a.form({operation:'annotation-hook.create',siteId:id},a.owner);assert.equal(r.status,200);key=(await r.text()).match(/data-annotation-secret>(vane_ah_[0-9a-f]{64})</)[1]}
 assert.equal((await a.request('/api/vane/annotations',{method:'POST',headers:{authorization:'Bearer '+key,'content-type':'application/json'},body:JSON.stringify({siteId:id,id:'synthetic-vane-deploy-'+at,kind:'deploy',at,title:'Fixture deployment'})})).status,201)
 return key
}
async function newLoad(a,id,path,at,name){await a.clock(at);const p=a.event(id,{path});assert.equal((await a.collect(p,origin)).status,202);if(name)assert.equal((await a.post('/api/vane/custom',{id:crypto.randomUUID(),siteId:id,page:p.id,name,consent:'not-required'},'',{origin})).status,202);return p}

test('Instrumentation investigation compares a renamed signup control and missing template script, prepares a reviewed no-code fix and PR draft, then verifies deployed pages and real payloads once',async t=>{
 const a=await installation();t.after(()=>a.close());const now=Date.now()+60000;await a.clock(now)
 const id=await a.addSite({origin,paths:[],goals:{},customGoals:{signup:{event:'Signup',revenue:false,currency:'USD'}},eventDefinitions:[{name:'Signup',kind:'click',target:'#signup'}],incumbentCompatibility:true})
 const state={broken:false},site=website(a,id,state),input={siteId:id,...windowOf(now),pageLimit:10}
 const run=()=>a.post('/api/vane/instrumentation/run',input,a.owner)
 const baseline=await result(await run());assert.equal(baseline.problems.some(p=>p.kind==='missing-script'||p.kind==='missing-selector'),false)
 state.broken=true;await newLoad(a,id,'/',now+1000,'SignUp')
 const broken=await result(await run())
 assert.ok(broken.problems.some(p=>p.kind==='missing-script'&&p.page==='/pricing'))
 assert.ok(broken.problems.some(p=>p.kind==='missing-selector'&&p.name==='Signup'&&p.target==='#signup'&&p.replacement==='#join-now'))
 assert.ok(broken.problems.some(p=>p.kind==='misnamed-event'&&p.name==='SignUp'))
 assert.ok(broken.problems.every(p=>p.evidence.startsWith('/app/sites/'+id)))
 assert.equal(broken.draft.state,'draft-only');assert.ok(broken.draft.changes.some(c=>c.after.includes('/vane.js')));assert.ok(broken.draft.changes.some(c=>c.after==='Signup: #join-now'))
 assert.ok(broken.unknown.some(u=>u.includes('CONV-008')))
 const prepared=await result(await a.post('/api/vane/instrumentation/prepare',{siteId:id,runId:broken.id,confirm:'on'},a.owner),201)
 const proposals=await result(await a.request('/api/vane/proposals',{headers:{cookie:a.owner}})),proposal=proposals.find(p=>p.id===prepared.proposalId),payload=JSON.parse(proposal.payload_json)
 assert.deepEqual(payload.config.eventDefinitions,[{name:'Signup',kind:'click',target:'#join-now'}]);assert.deepEqual(payload.config.customGoals,{signup:{event:'Signup',revenue:false,currency:'USD'}})
 const verify=()=>a.post('/api/vane/instrumentation/verify',{siteId:id,fixId:prepared.id},a.owner)
 assert.equal((await verify()).status,409,'verification cannot bypass owner approval')
 assert.equal((await a.form({operation:'proposal.approve',id:prepared.proposalId},a.owner)).status,303)
 let unverified=await result(await verify());assert.equal(unverified.state,'unverified');assert.ok(unverified.missing.some(m=>m.includes('deploy or release')))
 // A new payload before deployment cannot prove the deployed fix.
 await newLoad(a,id,'/',now+2000,'Signup');const key=await deploy(a,id,now+3000)
 unverified=await result(await verify());assert.equal(unverified.state,'unverified');assert.ok(unverified.missing.some(m=>m.includes('matching script')))
 // The renamed control remains renamed; only the missing script is restored in the shipped HTML.
 const fixed=path=>site.html(path).replace(path==='/pricing'?'</button>':'SENTINEL_NEVER_MATCH',`</button><script>window.plausible=function(){};plausible.init=o=>plausible.o=o;plausible.init({captureOnLocalhost:true});</script><script defer src="${a.origin}/vane.js" data-site="${id}"></script>`)
 a.fixtureSites[origin]=request=>{const p=new URL(request.url).pathname;return p==='/robots.txt'?new Response('User-agent: *'):p==='/sitemap.xml'?new Response(`<urlset><url><loc>${origin}/</loc></url><url><loc>${origin}/pricing</loc></url></urlset>`):new Response(fixed(p),{headers:{'content-type':'text/html'}})}
 await a.clock(now+4000)
 const pages={[origin+'/']:fixed('/'),[origin+'/pricing']:fixed('/pricing')},{context}=await browse(t,a,pages),page=await context.newPage()
 await page.goto(origin+'/');await page.waitForFunction(()=>typeof window.vane==='function')
 const clicked=page.waitForResponse(r=>new URL(r.url()).pathname==='/api/vane/custom'&&r.request().postDataJSON().name==='Signup');await page.getByRole('button',{name:'Join',exact:true}).click();assert.equal((await clicked).status(),202)
 await a.clock(now+5000);const pricing=page.waitForResponse(r=>new URL(r.url()).pathname==='/api/vane/collect');await page.goto(origin+'/pricing');assert.equal((await pricing).status(),202)
 const pricingEvent=page.waitForResponse(r=>new URL(r.url()).pathname==='/api/vane/custom');await page.getByRole('button',{name:'Join',exact:true}).click();assert.equal((await pricingEvent).status(),202)
 const verified=await result(await verify());assert.equal(verified.state,'verified');assert.ok(verified.annotationId)
 assert.deepEqual(await result(await verify()),{state:'verified',at:verified.at})
 const dump=await a.dump();assert.equal(dump.vane_annotations.filter(r=>r.id===verified.annotationId).length,1)
 assert.ok(dump.vane_audit.some(r=>r.action==='agent.instrumentation'));assert.ok(dump.vane_audit.some(r=>r.action==='agent.fix.prepare'));assert.ok(dump.vane_audit.some(r=>r.action==='agent.fix.verify'))
 const custody=JSON.stringify({runs:dump.vane_instrumentation_runs,fixes:dump.vane_instrumentation_fixes,scans:dump.vane_cutover_scans})
 for(const sentinel of ['synthetic-vane-private-body','synthetic-vane-private-input','account123456','<h1>'])assert.equal(custody.includes(sentinel),false,sentinel+' is not retained')
 assert.ok(site.requests.every(r=>!r.headers.cookie&&!r.headers.authorization),'the site never receives native authentication')
 // Review the evidence and verified fix through the unchanged Settings/Approvals components at both required widths.
 await context.addCookies(a.owner.split('; ').map(pair=>{const i=pair.indexOf('=');return {name:pair.slice(0,i),value:pair.slice(i+1),url:a.origin}}))
 const dir=process.env.VANE_SCREEN_DIR;if(dir)await mkdir(dir,{recursive:true})
 for(const width of [1440,390]){
  await page.setViewportSize({width,height:1000});await page.goto(`${a.origin}/app/sites/${id}?section=settings`)
  await page.locator('#instrumentation').scrollIntoViewIfNeeded();assert.ok(await page.getByRole('button',{name:'Investigate instrumentation',exact:true}).isVisible())
  const card=page.locator(`[data-instrumentation-run="${broken.id}"]`);await card.getByText('Review PR draft',{exact:true}).click();await card.scrollIntoViewIfNeeded();assert.match(await card.textContent(),/Draft only/)
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);if(dir)await page.screenshot({path:join(dir,`instrumentation-draft-${width}.png`)})
  await page.locator(`[data-instrumentation-fix="${prepared.id}"]`).scrollIntoViewIfNeeded();assert.match(await page.locator(`[data-instrumentation-fix="${prepared.id}"]`).textContent(),/Verified fix/)
  if(dir)await page.screenshot({path:join(dir,`instrumentation-verified-${width}.png`)})
  await page.goto(`${a.origin}/app/sites/${id}?section=approvals`);const approved=page.locator(`[data-proposal="${prepared.proposalId}"]`);await approved.scrollIntoViewIfNeeded();assert.match(await approved.textContent(),/approved/)
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);if(dir)await page.screenshot({path:join(dir,`instrumentation-approval-${width}.png`)})
 }
 // History erasure discards investigations, snapshots and fixes, while the audit remains.
 const erase=await result(await a.post('/api/vane/commands',{command:'history.erase',input:{siteId:id}},a.owner),201)
 assert.equal((await a.form({operation:'proposal.approve',id:erase.id},a.owner)).status,303)
 const erased=await a.dump();assert.equal(erased.vane_instrumentation_runs.length,0);assert.equal(erased.vane_instrumentation_fixes.length,0);assert.equal(erased.vane_cutover_scans.length,0);assert.ok(erased.vane_audit.some(r=>r.action==='agent.fix.verify'))
})

test('Instrumentation authority is owner-only and scoped, same-origin, read-only until a reviewed version-bound approval, and incomplete scans never claim recovery',async t=>{
 const a=await installation();t.after(()=>a.close());const now=Date.now()+60000;await a.clock(now)
 const id=await a.addSite({origin,paths:[],goals:{},eventDefinitions:[{name:'Signup',kind:'click',target:'#signup'}]}),state={broken:true};website(a,id,state)
 const admin=await a.invite('synthetic-vane-admin@example.test','admin'),viewer=await a.invite('synthetic-vane-viewer@example.test','member'),input={siteId:id,...windowOf(now),pageLimit:10}
 for(const cookie of [admin,viewer,''])for(const path of ['/api/vane/instrumentation/run','/api/vane/instrumentation/prepare','/api/vane/instrumentation/verify'])assert.equal((await a.post(path,input,cookie)).status,cookie?403:401)
 assert.equal((await a.request('/api/vane/instrumentation?siteId='+id,{headers:{cookie:viewer}})).status,403)
 assert.equal((await a.post('/api/vane/instrumentation/run',input,a.owner,{origin:'https://other.example'})).status,403)
 assert.equal((await a.post('/api/vane/instrumentation/run',{...input,to:input.from},a.owner)).status,400)
 const run=await result(await a.post('/api/vane/instrumentation/run',input,a.owner));assert.equal((await a.post('/api/vane/instrumentation/prepare',{siteId:id,runId:run.id},a.owner)).status,400,'explicit structural review is required')
 const before=(await a.dump()).vane_sites.find(s=>s.id===id).config_json
 const prepared=await result(await a.post('/api/vane/instrumentation/prepare',{siteId:id,runId:run.id,confirm:'on'},a.owner),201)
 assert.equal((await a.dump()).vane_sites.find(s=>s.id===id).config_json,before,'drafting does not change collection')
 assert.equal((await a.form({operation:'proposal.approve',id:prepared.proposalId},admin)).status,403)
 assert.equal((await a.form({operation:'proposal.approve',id:prepared.proposalId},a.owner)).status,303)
 const current=await result(await a.request('/api/vane/sites',{headers:{cookie:a.owner}})),v=current.find(s=>s.id===id)
 const change=await result(await a.post('/api/vane/commands',{command:'site.configure',input:{siteId:id,name:v.name,origin:v.origin,config:v.config}},a.owner),201)
 assert.equal((await a.form({operation:'proposal.approve',id:change.id},a.owner)).status,303)
 assert.equal((await a.post('/api/vane/instrumentation/verify',{siteId:id,fixId:prepared.id},a.owner)).status,409,'a later settings version requires a fresh investigation')
 a.fixtureSites[origin]=()=>new Response('Unavailable',{status:503})
 const failed=await result(await a.post('/api/vane/instrumentation/run',input,a.owner));assert.ok(failed.unknown.some(u=>u.includes('crawl failed')));assert.equal(failed.draft.changes.length,0)
 const dump=await a.dump();assert.equal(dump.vane_annotations.filter(r=>r.id.startsWith('instrumentation:')).length,0)
 const archive=await a.archive();assert.ok(archive.payload.tables.vane_instrumentation_runs.length);assert.ok(archive.payload.tables.vane_instrumentation_fixes.length)
 const zip=await result(await a.request('/api/vane/export?siteId='+id,{headers:{cookie:a.owner}}));assert.equal(zip.payload.tables.vane_instrumentation_fixes,undefined,'a pending approval never travels to another installation')
})

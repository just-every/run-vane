import test from 'node:test'
import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { assert, installation, browse } from './vane-helpers.mjs'
import { githubFixture } from './instrumentation-github-fixture.mjs'
const origin='http://127.0.0.1:9137',DAY=86400000
const windowOf=at=>({from:new Date(at-DAY).toISOString().slice(0,10),to:new Date(at+DAY).toISOString().slice(0,10)})
function website(a,id,state) {
 const html=path=>`<!doctype html><title>Fixture</title><h1>Fixture</h1><p>synthetic-vane-private-body</p><input id="account123456" value="synthetic-vane-private-input"><button id="${state.broken&&path!=='/unchanged'?'join-now':'signup'}">Join</button>${state.broken&&path==='/pricing'?'':`<script>window.plausible=function(){};plausible.init=o=>plausible.o=o;plausible.init({captureOnLocalhost:true});</script><script defer src="${a.origin}/vane.js" data-site="${id}"></script>`}`
 const requests=[]
 a.fixtureSites[origin]=request=>{requests.push({url:request.url,headers:Object.fromEntries(request.headers)});const u=new URL(request.url)
  if(u.pathname==='/robots.txt')return new Response('User-agent: *\nDisallow: /private')
  if(u.pathname==='/sitemap.xml')return new Response(`<urlset><url><loc>${origin}/</loc></url><url><loc>${origin}/pricing</loc></url><url><loc>${origin}/unchanged</loc></url></urlset>`)
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
 const state={broken:false},site=website(a,id,state),github=githubFixture(a),input={siteId:id,...windowOf(now),pageLimit:10}
 await result(await a.post('/api/vane/instrumentation/github',{siteId:id,enabled:'on',confirm:'on',credentialKind:'fine-grained',scopeConfirm:'on',repository:'just-every/run-vane',branch:'main',token:github.state.token,mappings:'/pricing = public/pricing.html'},a.owner))
 const run=()=>a.post('/api/vane/instrumentation/run',input,a.owner)
 const baseline=await result(await run());assert.equal(baseline.problems.some(p=>p.kind==='missing-script'||p.kind==='missing-selector'),false)
 state.broken=true;github.state.head=github.changed;await newLoad(a,id,'/',now+1000,'SignUp')
 const broken=await result(await run())
 assert.ok(broken.github.files.some(f=>f.file==='public/pricing.html'&&f.scriptRemoved));assert.equal(broken.github.files.some(f=>f.file==='private/unmapped.html'),false)
 assert.ok(broken.problems.some(p=>p.kind==='missing-script'&&p.page==='/pricing'))
 assert.ok(broken.problems.some(p=>p.kind==='missing-selector'&&p.name==='Signup'&&p.target==='#signup'&&p.replacement==='#join-now'))
 assert.ok(broken.problems.some(p=>p.kind==='misnamed-event'&&p.name==='SignUp'))
 assert.ok(broken.problems.every(p=>p.kind==='deploy-diff'?p.evidence===`https://github.com/just-every/run-vane/compare/${github.initial}...${github.changed}`:p.evidence.startsWith('/app/sites/'+id)),'every citation is bound to this site or the exact connected source comparison')
 assert.equal(broken.draft.state,'draft-only');assert.ok(broken.draft.changes.some(c=>c.after.includes('/vane.js')));assert.ok(broken.draft.changes.some(c=>c.after==='Signup: #signup, #join-now'))
 assert.ok(broken.unknown.some(u=>u.includes('CONV-008')))
 const prepared=await result(await a.post('/api/vane/instrumentation/prepare',{siteId:id,runId:broken.id,confirm:'on'},a.owner),201)
 const proposals=await result(await a.request('/api/vane/proposals',{headers:{cookie:a.owner}})),proposal=proposals.find(p=>p.id===prepared.proposalId),payload=JSON.parse(proposal.payload_json)
 assert.deepEqual(payload.config.eventDefinitions,[{name:'Signup',kind:'click',target:'#signup, #join-now'}]);assert.deepEqual(payload.config.customGoals,{signup:{event:'Signup',revenue:false,currency:'USD'}})
 const publish=()=>a.post('/api/vane/instrumentation/github-pr',{siteId:id,fixId:prepared.id,confirm:'on'},a.owner)
 assert.equal((await publish()).status,409);assert.equal(github.state.requests.some(r=>r.method==='POST'),false,'no source write before the normal owner approval')
 const verify=()=>a.post('/api/vane/instrumentation/verify',{siteId:id,fixId:prepared.id},a.owner)
 assert.equal((await verify()).status,409,'verification cannot bypass owner approval')
 assert.equal((await a.form({operation:'proposal.approve',id:prepared.proposalId},a.owner)).status,303)
 const published=await result(await publish());assert.equal(published.url,'https://github.com/just-every/run-vane/pull/17');assert.equal(published.head,github.candidate)
 const writes=github.state.requests.filter(r=>r.method==='POST').length;assert.deepEqual(await result(await publish()),published);assert.equal(github.state.requests.filter(r=>r.method==='POST').length,writes,'a confirmed PR is never created twice')
 let unverified=await result(await verify());assert.equal(unverified.state,'unverified');assert.ok(unverified.missing.some(m=>m.includes('deploy or release')))
 // A new payload before deployment cannot prove the deployed fix.
 await newLoad(a,id,'/',now+2000,'Signup');const key=await deploy(a,id,now+3000)
 unverified=await result(await verify());assert.equal(unverified.state,'unverified');assert.ok(unverified.missing.some(m=>m.includes('matching script')))
 // The renamed control remains renamed; only the missing script is restored in the shipped HTML.
 const fixed=path=>site.html(path).replace(path==='/pricing'?'</button>':'SENTINEL_NEVER_MATCH',`</button><script>window.plausible=function(){};plausible.init=o=>plausible.o=o;plausible.init({captureOnLocalhost:true});</script><script defer src="${a.origin}/vane.js" data-site="${id}"></script>`)
 a.fixtureSites[origin]=request=>{const p=new URL(request.url).pathname;return p==='/robots.txt'?new Response('User-agent: *'):p==='/sitemap.xml'?new Response(`<urlset><url><loc>${origin}/</loc></url><url><loc>${origin}/pricing</loc></url><url><loc>${origin}/unchanged</loc></url></urlset>`):new Response(fixed(p),{headers:{'content-type':'text/html'}})}
 await a.clock(now+4000)
 const pages={[origin+'/']:fixed('/'),[origin+'/pricing']:fixed('/pricing'),[origin+'/unchanged']:fixed('/unchanged')},{context}=await browse(t,a,pages),page=await context.newPage()
 await page.goto(origin+'/');await page.waitForFunction(()=>typeof window.vane==='function')
 const clicked=page.waitForResponse(r=>new URL(r.url()).pathname==='/api/vane/custom'&&r.request().postDataJSON().name==='Signup');await page.getByRole('button',{name:'Join',exact:true}).click();assert.equal((await clicked).status(),202)
 await a.clock(now+5000);const pricing=page.waitForResponse(r=>new URL(r.url()).pathname==='/api/vane/collect');await page.goto(origin+'/pricing');assert.equal((await pricing).status(),202)
 const pricingEvent=page.waitForResponse(r=>new URL(r.url()).pathname==='/api/vane/custom');await page.getByRole('button',{name:'Join',exact:true}).click();assert.equal((await pricingEvent).status(),202)
 await a.clock(now+6000);const unchangedLoad=page.waitForResponse(r=>new URL(r.url()).pathname==='/api/vane/collect');await page.goto(origin+'/unchanged');assert.equal((await unchangedLoad).status(),202)
 const unchangedEvent=page.waitForResponse(r=>new URL(r.url()).pathname==='/api/vane/custom');await page.getByRole('button',{name:'Join',exact:true}).click();assert.equal((await unchangedEvent).status(),202,'the original selector keeps working on an unchanged template')
 const verified=await result(await verify());assert.equal(verified.state,'verified');assert.ok(verified.annotationId)
 assert.deepEqual(await result(await verify()),{state:'verified',at:verified.at})
 const dump=await a.dump();assert.equal(dump.vane_annotations.filter(r=>r.id===verified.annotationId).length,1);assert.equal(dump.vane_annotations.find(r=>r.id===verified.annotationId).url,published.url)
 assert.ok(dump.vane_audit.some(r=>r.action==='agent.instrumentation'));assert.ok(dump.vane_audit.some(r=>r.action==='agent.fix.prepare'));assert.ok(dump.vane_audit.some(r=>r.action==='agent.fix.verify'))
 const custody=JSON.stringify({runs:dump.vane_instrumentation_runs,fixes:dump.vane_instrumentation_fixes,scans:dump.vane_cutover_scans})
 for(const sentinel of ['synthetic-vane-private-body','synthetic-vane-private-input','account123456','<h1>','synthetic-vane-source-body','synthetic-vane-private-unmapped',github.state.token])assert.equal(custody.includes(sentinel),false,sentinel+' is not retained')
 assert.equal(github.state.requests.some(r=>r.path.includes('/compare/')||r.path.includes('/contents/')),false,'broad patches and symlink-resolving contents are never requested')
 assert.ok(site.requests.every(r=>!r.headers.cookie&&!r.headers.authorization),'the site never receives native authentication')
 // Review the evidence and verified fix through the unchanged Settings/Approvals components at both required widths.
 await context.addCookies(a.owner.split('; ').map(pair=>{const i=pair.indexOf('=');return {name:pair.slice(0,i),value:pair.slice(i+1),url:a.origin}}))
 const dir=process.env.VANE_SCREEN_DIR;if(dir)await mkdir(dir,{recursive:true})
 for(const width of [1440,390]){
  await page.setViewportSize({width,height:1000});await page.goto(`${a.origin}/app/sites/${id}?section=settings`)
  await page.locator('#instrumentation').scrollIntoViewIfNeeded();const source=page.getByText('GitHub source and draft PR authority',{exact:true});await source.click();assert.equal(await page.getByLabel('Repository-scoped GitHub token',{exact:true}).inputValue(),'');if(dir)await page.screenshot({path:join(dir,`instrumentation-source-${width}.png`)});await page.getByLabel('Repository-scoped GitHub token',{exact:true}).scrollIntoViewIfNeeded();if(dir)await page.screenshot({path:join(dir,`instrumentation-source-controls-${width}.png`)});await source.click();assert.ok(await page.getByRole('button',{name:'Investigate instrumentation',exact:true}).isVisible())
  const card=page.locator(`[data-instrumentation-run="${broken.id}"]`);await card.getByText('Review PR draft',{exact:true}).click();await card.scrollIntoViewIfNeeded();assert.match(await card.textContent(),/Draft only/);assert.ok(await page.getByRole('link',{name:'Open draft PR 17',exact:true}).count())
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);if(dir)await page.screenshot({path:join(dir,`instrumentation-draft-${width}.png`)})
  await page.locator(`[data-instrumentation-fix="${prepared.id}"]`).scrollIntoViewIfNeeded();assert.match(await page.locator(`[data-instrumentation-fix="${prepared.id}"]`).textContent(),/Verified fix/)
  if(dir)await page.screenshot({path:join(dir,`instrumentation-verified-${width}.png`)})
  await page.goto(`${a.origin}/app/sites/${id}?section=approvals`);const approved=page.locator(`[data-proposal="${prepared.proposalId}"]`);await approved.scrollIntoViewIfNeeded();assert.match(await approved.textContent(),/approved/)
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);if(dir)await page.screenshot({path:join(dir,`instrumentation-approval-${width}.png`)})
 }
 // History erasure discards investigations, snapshots and fixes, while the audit remains.
 const erase=await result(await a.post('/api/vane/commands',{command:'history.erase',input:{siteId:id}},a.owner),201)
 assert.equal((await a.form({operation:'proposal.approve',id:erase.id},a.owner)).status,303)
 const erased=await a.dump();assert.equal(erased.vane_instrumentation_runs.length,0);assert.equal(erased.vane_instrumentation_fixes.length,0);assert.equal(erased.vane_instrumentation_prs.length,0);assert.equal(erased.vane_cutover_scans.length,0);assert.ok(erased.vane_audit.some(r=>r.action==='agent.fix.verify'))
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


test('Instrumentation recognizes active approved proxy script tags, ignores cache queries and refuses stale investigation drafts after settings change',async t=>{
 const a=await installation();t.after(()=>a.close());const now=Date.now()+60000;await a.clock(now)
 const siteOrigin='https://proxy.example',id=await a.addSite({origin:siteOrigin,paths:[],goals:{}})
 const connection=await result(await a.post('/api/vane/proxy-connections',{operation:'proxy.create',siteId:id,hostname:'proxy.example',mode:'external',publicPrefix:'/insights'},a.owner))
 a.fixtureSites[siteOrigin]=request=>{const path=new URL(request.url).pathname;return path==='/robots.txt'?new Response('User-agent: *'):path==='/sitemap.xml'?new Response(`<urlset><url><loc>${siteOrigin}/pricing</loc></url></urlset>`):new Response(`<script defer src='/insights/script.js?cache=synthetic-vane-1' data-site='${id}' data-api='/insights'></script>`)}
 const input={siteId:id,...windowOf(now),pageLimit:10},run=await result(await a.post('/api/vane/instrumentation/run',input,a.owner))
 assert.equal(run.problems.some(p=>p.kind==='missing-script'),false,'a currently approved proxy script is native instrumentation')
 assert.equal((await a.post('/api/vane/proxy-connections',{operation:'proxy.revoke',siteId:id,connectionId:connection.connection.id},a.owner)).status,200)
 const revoked=await result(await a.post('/api/vane/instrumentation/run',input,a.owner));assert.ok(revoked.problems.some(p=>p.kind==='missing-script'),'revoked proxy scripts are not treated as active')
 const sites=await result(await a.request('/api/vane/sites',{headers:{cookie:a.owner}})),site=sites.find(s=>s.id===id),change=await result(await a.post('/api/vane/commands',{command:'site.configure',input:{siteId:id,name:site.name,origin:site.origin,config:site.config}},a.owner),201)
 assert.equal((await a.form({operation:'proposal.approve',id:change.id},a.owner)).status,303)
 assert.equal((await a.post('/api/vane/instrumentation/prepare',{siteId:id,runId:revoked.id,confirm:'on'},a.owner)).status,409,'a stale investigation cannot propose changes against a newer configuration')
 // Pause only the network edge; erasing through the real owner door while a crawl waits must fence its result.
 let release,started;const waiting=new Promise(resolve=>{release=resolve}),reached=new Promise(resolve=>{started=resolve})
 a.fixtureSites[siteOrigin]=async request=>{const path=new URL(request.url).pathname;if(path==='/robots.txt')return new Response('User-agent: *');if(path==='/sitemap.xml')return new Response(`<urlset><url><loc>${siteOrigin}/pricing</loc></url></urlset>`);started();await waiting;return new Response('<h1>No script</h1>')}
 const pending=a.post('/api/vane/instrumentation/run',input,a.owner);await reached
 const erased=await result(await a.post('/api/vane/commands',{command:'history.erase',input:{siteId:id}},a.owner),201);assert.equal((await a.form({operation:'proposal.approve',id:erased.id},a.owner)).status,303)
 release();assert.equal((await pending).status,400,'the in-flight investigation cannot publish stale pre-erasure evidence')
 assert.equal((await a.dump()).vane_instrumentation_runs.length,0)

})


test('GitHub hand-off is off-default, owner-approved, sealed and revocable; source drift and an uncertain provider reply never replay a mutation or touch a default branch',async t=>{
 const a=await installation();t.after(()=>a.close());const now=Date.now()+60000;await a.clock(now)
 const id=await a.addSite({origin,paths:[],goals:{}}),web={broken:true};website(a,id,web)
 const github=githubFixture(a),settings={siteId:id,enabled:'on',confirm:'on',credentialKind:'fine-grained',scopeConfirm:'on',repository:'just-every/run-vane',branch:'main',token:github.state.token,mappings:'/pricing = public/pricing.html'},endpoint='/api/vane/instrumentation/github'
 const admin=await a.invite('synthetic-vane-github-admin@example.test','admin')
 assert.equal((await a.post(endpoint,settings,admin)).status,403);assert.equal((await a.post(endpoint,settings,'')).status,401)
 assert.equal((await a.post(endpoint,{...settings,confirm:''},a.owner)).status,400);assert.equal(github.state.requests.length,0)
 for(const extra of [{credentialKind:'classic'},{scopeConfirm:''}])assert.equal((await a.post(endpoint,{...settings,...extra},a.owner)).status,400)
 for(const file of ['.env','public/.env.html','public/api-key.html','.github/workflows/build.html','deploy/index.html','package.json','pnpm-lock.yaml','certs/site.html'])assert.equal((await a.post(endpoint,{...settings,mappings:'/pricing = '+file},a.owner)).status,409)
 assert.equal(github.state.requests.length,0,'sensitive and operational mappings are refused before any GitHub request')
 for(const mappings of ['/pricing = ../private.html','/orders/1234567 = public/pricing.html','/pricing = /absolute.html'])assert.equal((await a.post(endpoint,{...settings,mappings},a.owner)).status,400)
 const realEdge=a.fixtureSites['https://api.github.com'];a.fixtureSites['https://api.github.com']=()=>new Response(null,{status:302,headers:{location:'https://github-redirect.example/credential-leak'}})
 assert.equal((await a.post(endpoint,settings,a.owner)).status,502);assert.equal(a.egress.some(url=>new URL(url).hostname==='github-redirect.example'),false,'GitHub redirects are refused at the real fetch boundary')
 a.fixtureSites['https://api.github.com']=()=>Response.json({},{headers:{'x-oauth-scopes':'repo, workflow'}})
 assert.equal((await a.post(endpoint,settings,a.owner)).status,403,'classic OAuth scopes cannot be used for source authority')
 a.fixtureSites['https://api.github.com']=realEdge;await result(await a.post(endpoint,settings,a.owner))
 const archive=await a.archive();assert.equal(archive.payload.tables.vane_instrumentation_github,undefined);assert.equal(archive.payload.tables.vane_instrumentation_prs,undefined);assert.equal(JSON.stringify(await a.dump()).includes(github.state.token),false)
 github.state.head=github.changed
 const investigate=()=>a.post('/api/vane/instrumentation/run',{siteId:id,...windowOf(now),pageLimit:10},a.owner)
 const prepare=async()=>{const run=await result(await investigate()),fix=await result(await a.post('/api/vane/instrumentation/prepare',{siteId:id,runId:run.id,confirm:'on'},a.owner),201);assert.equal((await a.form({operation:'proposal.approve',id:fix.proposalId},a.owner)).status,303);return fix}
 const moved=await prepare();github.state.head='e'.repeat(40)
 assert.equal((await a.post('/api/vane/instrumentation/github-pr',{siteId:id,fixId:moved.id,confirm:'on'},a.owner)).status,409)
 assert.equal(github.state.requests.filter(r=>r.method==='POST').length,0,'a moved source branch causes no outbound write');assert.equal((await a.dump()).vane_instrumentation_prs.find(p=>p.fix_id===moved.id).state,'blocked','a known no-write preflight failure is not labelled an uncertain send')
 github.state.head=github.changed
 const changed=await prepare();github.state.sourceChanged=true
 assert.equal((await a.post('/api/vane/instrumentation/github-pr',{siteId:id,fixId:changed.id,confirm:'on'},a.owner)).status,409,'changing the exact source diff voids the approval even if the source-head response is unchanged')
 assert.equal(github.state.requests.filter(r=>r.method==='POST').length,0)
 github.state.sourceChanged=false
 const linked=await prepare();github.state.symlink=true
 const reads=github.state.requests.filter(r=>r.path.includes('/git/blobs/')).length
 assert.equal((await a.post('/api/vane/instrumentation/github-pr',{siteId:id,fixId:linked.id,confirm:'on'},a.owner)).status,409,'symlink templates cannot resolve into secret-bearing files')
 assert.equal(github.state.requests.filter(r=>r.path.includes('/git/blobs/')).length,reads,'symlink mode is refused before source bytes are read')
 assert.equal(github.state.requests.filter(r=>r.method==='POST').length,0)
 github.state.symlink=false;const uncertain=await prepare();github.state.loseReply=true
 const publish=()=>a.post('/api/vane/instrumentation/github-pr',{siteId:id,fixId:uncertain.id,confirm:'on'},a.owner)
 const lost=await publish();assert.equal(lost.status,502);assert.equal((await lost.text()).includes('synthetic-vane-provider-detail'),false)
 const mutations=github.state.requests.filter(r=>r.method==='POST').length,reconciled=await result(await publish());assert.equal(reconciled.state,'published');assert.equal(github.state.requests.filter(r=>r.method==='POST').length,mutations,'reconciliation performs reads only')
 const fresh=await prepare();assert.equal((await a.post(endpoint,{siteId:id,enabled:'off'},a.owner)).status,200)
 assert.equal((await a.post('/api/vane/instrumentation/github-pr',{siteId:id,fixId:fresh.id,confirm:'on'},a.owner)).status,409)
 assert.equal(github.state.requests.filter(r=>r.method==='POST').length,mutations,'disconnect blocks the next external change')
 assert.ok(github.state.requests.filter(r=>r.method==='POST'&&r.path.endsWith('/git/refs')).every(r=>r.body.ref.startsWith('refs/heads/vane/instrumentation-')))
 assert.ok((await a.dump()).vane_audit.some(r=>r.action==='agent.github.pr'));assert.ok((await a.dump()).vane_audit.some(r=>r.action==='agent.github.pr.begin'))
 // A connect callback begun before disconnect must not resurrect its credential when the provider finally replies.
 const edge=a.fixtureSites['https://api.github.com'];let release,started;const waiting=new Promise(resolve=>{release=resolve}),reached=new Promise(resolve=>{started=resolve})
 a.fixtureSites['https://api.github.com']=async request=>{if(new URL(request.url).pathname==='/repos/just-every/run-vane'){started();await waiting}return edge(request)}
 const connecting=a.post(endpoint,settings,a.owner);await reached
 assert.equal((await a.post(endpoint,{siteId:id,enabled:'off'},a.owner)).status,200);release()
 assert.equal((await connecting).status,409);assert.equal((await a.dump()).vane_instrumentation_github.length,0,'a delayed source callback cannot restore revoked authority')

})

test('Instrumentation compares page, scroll and custom goals and funnel reach with arriving native payloads, and cites a sitemap step removed with HTTP 404',async t=>{
 const a=await installation();t.after(()=>a.close());const now=Date.now()+60000,today=new Date(now).toISOString().slice(0,10),yesterday=new Date(now-86400000).toISOString().slice(0,10),tomorrow=new Date(now+86400000).toISOString().slice(0,10)
 await a.clock(now-86400000)
 const id=await a.addSite({origin,paths:[],goals:{signup:'/thanks'},scrollGoals:{deep:{path:'/blog',depth:75}},customGoals:{contact:{event:'Contact',revenue:false,currency:'USD'}},eventDefinitions:[{name:'Contact',kind:'click',target:'#signup'}],funnels:[{name:'checkout',steps:['/checkout','/thanks']}]})
 let removed=false
 a.fixtureSites[origin]=request=>{const path=new URL(request.url).pathname;return path==='/robots.txt'?new Response('User-agent: *'):path==='/sitemap.xml'?new Response(`<urlset>${['/checkout','/thanks','/blog'].map(path=>`<url><loc>${origin+path}</loc></url>`).join('')}</urlset>`):path==='/thanks'&&removed?new Response('Gone',{status:404}):new Response(`<html><head><script defer src="${a.origin}/vane.js" data-site="${id}"></script></head><body><button id="signup">Contact</button></body></html>`,{headers:{'content-type':'text/html'}})}
 const load=async(path,at)=>{await a.clock(at);const page=a.event(id,{path});assert.equal((await a.collect(page,origin)).status,202);return page}
 const checkout=await load('/checkout',now-86400000);await load('/thanks',now-86400000+1000);const blog=await load('/blog',now-86400000+2000)
 await a.clock(now-86400000+3000);assert.equal((await a.post('/api/vane/custom',{id:crypto.randomUUID(),siteId:id,page:checkout.id,name:'Contact',consent:'not-required'},'',{origin})).status,202)
 await a.clock(now-86400000+20000);assert.equal((await a.post('/api/vane/engage',{siteId:id,id:blog.id,scroll:80},'',{origin})).status,202)
 await a.clock(now-86400000+25000);await result(await a.post('/api/vane/instrumentation/run',{siteId:id,from:yesterday,to:today,pageLimit:10},a.owner))
 removed=true;await load('/checkout',now);await load('/blog',now+1000);await a.clock(now+30000)
 const current=await result(await a.post('/api/vane/instrumentation/run',{siteId:id,from:today,to:tomorrow,pageLimit:10},a.owner))
 for(const name of ['signup','deep','contact']){const goal=current.goals.find(g=>g.name===name);assert.deepEqual([goal.count,goal.previous],[0,1]);assert.ok(current.problems.some(p=>p.kind==='silent-goal'&&p.name===name))}
 assert.deepEqual(current.pageviews,{count:2,previous:3});assert.equal(current.runningComparison,true)
 const funnel=current.funnels.find(f=>f.name==='checkout');assert.deepEqual(funnel.steps.map(s=>[s.visits,s.previous]),[[1,1],[0,1]])
 assert.ok(current.problems.some(p=>p.kind==='missing-funnel-step'&&p.page==='/thanks'&&p.detail.includes('HTTP 404')));assert.ok(current.problems.some(p=>p.kind==='silent-funnel-step'))
 assert.ok(current.draft.manual.some(m=>m.includes('Restore /thanks')))
 const history=await result(await a.request('/api/vane/cutover-scans?siteId='+id,{headers:{cookie:a.owner}}));assert.equal(history[0].pages.find(p=>new URL(p.url).pathname==='/thanks').status,404)
 const {context}=await browse(t,a);await context.addCookies(a.owner.split('; ').map(pair=>{const i=pair.indexOf('=');return {name:pair.slice(0,i),value:pair.slice(i+1),url:a.origin}}));const page=await context.newPage(),dir=process.env.VANE_SCREEN_DIR;if(dir)await mkdir(dir,{recursive:true})
 for(const width of [1440,390]){await page.setViewportSize({width,height:1000});await page.goto(`${a.origin}/app/sites/${id}?section=settings`);const card=page.locator(`[data-instrumentation-run="${current.id}"]`);await card.scrollIntoViewIfNeeded();assert.match(await card.textContent(),/signup: 1 → 0 conversions/);assert.match(await card.textContent(),/HTTP 404/);assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);if(dir)await page.screenshot({path:join(dir,`instrumentation-goals-${width}.png`)});await card.getByText('Review PR draft',{exact:true}).click();assert.match(await card.textContent(),/Restore \/thanks/);if(dir)await page.screenshot({path:join(dir,`instrumentation-manual-${width}.png`)})}
})

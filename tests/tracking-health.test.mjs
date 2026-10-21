import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { chromium } from '@playwright/test'
import { installation } from './harness.mjs'

// Dates format with narrow no-break spaces before AM/PM in current ICU; compare them as plain spaces.
const plain=text=>String(text).replace(/[  ]/g,' ')
test('ALERT-002 the daily tracking-health check names a silent site, a goal silent after a deploy, a silent page, a collection-error surge and a consent collapse, each in its own alert, and the overview reads the goals tracking',async t=>{
 const a=await installation();t.after(()=>a.close())
 const zone='America/Chicago',goals=Object.fromEntries(Array.from({length:11},(_,i)=>[`g${i+1}`,`/g${i+1}`]))
 await a.clock(Date.parse('2026-10-20T16:00:00Z'))
 const fern=await a.addSite({paths:[],goals,customGoals:{Signup:{event:'Signup',revenue:false,currency:'USD'}},timeZone:zone})
 const oak=await a.addSite({name:'Oak Bakery',origin:'https://oak.example',paths:[],goals:{},timeZone:zone})
 const pine=await a.addSite({name:'Pine Clinic',origin:'https://pine.example',paths:[],goals:{},timeZone:zone,consent:'required',declinedCounter:true})
 const load=async(siteId,origin,path,extra={})=>{const page=a.event(siteId,{path,...extra}),r=await a.collect(page,origin);assert.equal(r.status,202,await r.clone().text());return page}
 const signup=async(page,name)=>assert.equal((await a.post('/api/vane/custom',{id:crypto.randomUUID(),siteId:fern,page:page.id,name,consent:'not-required'},'',{origin:'https://fern.example'})).status,202)
 // Every baseline Tuesday the whole Fern site sends and all 12 goals fire; Oak sends; Pine's visitors all grant consent.
 const ordinary=async day=>{
  await a.clock(Date.parse(day+'T18:00:00Z'))
  const home=await load(fern,'https://fern.example','/');await signup(home,'Signup');await load(fern,'https://fern.example','/pricing')
  for(let i=1;i<=11;i++)await load(fern,'https://fern.example',`/g${i}`)
  await load(oak,'https://oak.example','/')
  for(let i=0;i<10;i++)await load(pine,'https://pine.example','/',{consent:'granted'})
 }
 await ordinary('2026-10-20')
 // The first check runs at the default 09:00 local time and judges the day before: all 12 goals fired.
 await a.clock(Date.parse('2026-10-21T13:55:00Z'));await a.scheduled()
 assert.equal((await a.dump()).vane_health.length,0,'not before 09:00 local time')
 await a.clock(Date.parse('2026-10-21T14:00:00Z'));await a.scheduled()
 const overview=async()=>plain(await (await a.request('/app',{headers:{cookie:a.owner}})).text())
 assert.ok((await overview()).includes('All 12 goals tracking · checked Wed, Oct 21, 9:00 AM CDT'))
 const settings=async(id,cookie=a.owner)=>plain(await (await a.request(`/app/sites/${id}?section=settings`,{headers:{cookie}})).text())
 assert.ok((await settings(fern)).includes('2026-10-20 was not judged: fewer than 4 earlier Tuesdays to compare.'))
 const alert=(siteId,metric,extra={})=>a.form({operation:'alert.create',siteId,metric,cooldown:6,...extra},a.owner)
 // The error surge also goes to Fern's signed webhook that takes traffic alerts (API-003).
 const hooks=[];a.fixtureSites['https://hooks.fixture.example']=async request=>{hooks.push({headers:Object.fromEntries(request.headers),body:await request.text()});return new Response(null,{status:204})}
 assert.equal((await a.form({operation:'webhook.create',siteId:fern,url:'https://hooks.fixture.example/vane','event_traffic.alert':'on'},a.owner)).status,200)
 for(const [siteId,metric,extra] of [[fern,'silent-goal'],[fern,'silent-page'],[fern,'error-surge',{webhooks:'on'}],[oak,'silent-site'],[pine,'consent-collapse']])assert.equal((await alert(siteId,metric,extra)).status,303,metric)
 assert.equal((await alert(fern,'consent-collapse')).status,400,'a site that does not count declined consent has no consent rate')
 for(const day of ['2026-10-27','2026-11-03','2026-11-10'])await ordinary(day)
 // Only the owner moves the daily check, and the change is audited.
 const admin=await a.invite('admin@example.test','admin')
 assert.equal((await a.form({operation:'health.time',siteId:fern,time:'07:30'},admin)).status,403)
 assert.equal((await a.form({operation:'health.time',siteId:fern,time:'07:30'},'')).status,401)
 assert.equal((await a.post('/app/action',{operation:'health.time',siteId:fern,time:'07:30'},a.owner,{origin:'https://foreign.example'})).status,403)
 for(const time of ['24:00','07:60','7:30','-1:00'])assert.equal((await a.form({operation:'health.time',siteId:fern,time},a.owner)).status,400,'ALERT-002 rejects invalid local time '+time)
 assert.equal((await a.dump()).vane_audit.filter(r=>r.action==='health.time').length,0,'refused time changes write no audit or setting')
 for(const siteId of [fern,oak,pine])assert.equal((await a.form({operation:'health.time',siteId,time:'07:30'},a.owner)).status,303)
 assert.ok((await a.dump()).vane_audit.some(r=>r.action==='health.time'&&r.subject===fern&&r.detail==='07:30'))
 assert.ok((await settings(fern,admin)).includes('The check runs daily at 07:30 (America/Chicago); the owner sets the time.'))
 // Tuesday 17 November: a deploy renames the Signup event and drops the script from /pricing, a staging origin sends
 // page loads Fern does not register, Oak's script is removed and Pine's consent banner stops granting consent.
 await a.clock(Date.parse('2026-11-17T18:00:00Z'))
 const created=await a.form({operation:'annotation-hook.create',siteId:fern},a.owner);assert.equal(created.status,200)
 const secret=(await created.text()).match(/data-annotation-secret>(vane_ah_[0-9a-f]{64})</)[1]
 assert.equal((await a.request('/api/vane/annotations',{method:'POST',headers:{'content-type':'application/json',authorization:'Bearer '+secret},body:JSON.stringify({siteId:fern,id:'deploy-7',kind:'deploy',at:'2026-11-17T17:00:00Z',title:'Deploy 7'})})).status,201)
 const home=await load(fern,'https://fern.example','/');await signup(home,'SignUp')
 for(let i=1;i<=11;i++)await load(fern,'https://fern.example',`/g${i}`)
 for(let i=0;i<12;i++)assert.equal((await a.collect(a.event(fern,{path:'/'}),'https://staging.fern.example')).status,403)
 for(let i=0;i<4;i++)await load(pine,'https://pine.example','/',{consent:'granted'})
 for(let i=0;i<20;i++)assert.equal((await a.post('/api/vane/declined/'+pine,undefined,'',{origin:'https://pine.example'})).status,202)
 const counts=(await a.dump()).vane_exclusions.filter(r=>r.day==='2026-11-17')
 assert.deepEqual(counts.map(r=>[r.site_id===fern?'fern':'pine',r.reason,r.count]).sort(),[['fern','collection-error',12],['pine','consent-declined',20]],'refused page loads are counted by reason and nothing else')
 const health=()=>a.sentMail.filter(m=>/Tracking health/.test(m.subject))
 await a.clock(Date.parse('2026-11-18T13:25:00Z'));await a.scheduled()
 assert.equal(health().length,0,'not before the owner’s 07:30')
 await a.clock(Date.parse('2026-11-18T13:30:00Z'));await a.scheduled()
 const mail=subject=>{const found=health().filter(m=>m.subject===subject);assert.equal(found.length,1,subject);return plain(found[0].text)}
 const goal=mail('Fern Studio: Tracking health: a goal stops firing'),page=mail('Fern Studio: Tracking health: a page stops sending pageviews'),errors=mail('Fern Studio: Tracking health: collection errors surge'),silent=mail('Oak Bakery: Tracking health: the site stops sending page loads'),consent=mail('Pine Clinic: Tracking health: the consent rate collapses')
 assert.equal(health().length,5,'each condition raises its own named alert')
 assert.match(goal,/Goal Signup had no conversion on 2026-11-17 \(America\/Chicago\), after the deploy “Deploy 7” on 2026-11-17; it converted on each of the 4 earlier Tuesdays compared \(2026-11-10, 2026-11-03, 2026-10-27, 2026-10-20\), last on 2026-11-10\. The site had 12 page loads that day\./)
 assert.doesNotMatch(goal,/Goal g\d/,'the goals that still fire are not named')
 assert.match(page,/\/pricing sent no pageview on 2026-11-17 \(America\/Chicago\) while the rest of the site sent 12; it had pageviews on each of the 4 earlier Tuesdays compared/)
 assert.match(errors,/12 page loads were refused as collection errors on 2026-11-17 \(America\/Chicago\); the usual range for a Tuesday is 0 to 0\./)
 assert.match(silent,/No page load arrived on 2026-11-17 \(America\/Chicago\); the site had page loads on each of the 4 earlier Tuesdays compared/)
 assert.match(consent,/The consent rate fell to 16\.7% of the 24 page loads that reached Vane on 2026-11-17 \(America\/Chicago\), under half its usual 100% on each of the 4 earlier Tuesdays compared/)
 // Each message explains the judged day as the report's explanation does: movers with their totals, annotations, coverage.
 for(const text of [goal,page,errors,silent,consent])assert.match(text,/What moved against the same window a week before: .+ in all/)
 assert.match(page,/Page \/pricing: 1 → 0 pageviews \(−1, −100%\), of 13 → 12 pageviews in all/)
 assert.match(silent,/Page \/: 1 → 0 pageviews \(−1, −100%\), of 1 → 0 pageviews in all/)
 assert.match(consent,/Page \/: 10 → 4 pageviews \(−6, −60%\), of 10 → 4 pageviews in all/)
 assert.match(goal,/Annotations that day: Deploy 7\./)
 assert.match(errors,/Coverage that day against a week before: collection-error 0 → 12/)
 assert.match(consent,/consent-declined 0 → 20/)
 // Sent alerts are logged and opened as follow-up items; a second run the same day sends nothing more.
 const after=await a.dump()
 assert.equal(after.vane_alert_log.filter(r=>r.sent_at!==null).length,5)
 assert.deepEqual(after.vane_follow_items.map(i=>i.title).sort(),['Tracking health: a goal stops firing','Tracking health: a page stops sending pageviews','Tracking health: collection errors surge','Tracking health: the consent rate collapses','Tracking health: the site stops sending page loads'])
 assert.ok(after.vane_health.every(r=>!/198\.51|Mozilla|visitor/i.test(r.result_json)),'the check keeps names and counts, never a visitor field')
 await a.scheduled();assert.equal(health().length,5,'one check a day')
 assert.equal(hooks.length,1,'the next 5-minute run delivers the surge to the webhook once');const hook=JSON.parse(hooks[0].body)
 assert.deepEqual([hooks[0].headers['vane-event'],hook.alert,hook.metric,hook.condition,hook.value,hook.bound],['traffic.alert','Tracking health: collection errors surge','error-surge','tracking-health',12,'0 to 0'])
 assert.match(hooks[0].headers['vane-signature'],/^t=\d+,v1=[0-9a-f]{64}$/);assert.deepEqual(Object.keys(hook).sort(),['alert','bound','condition','direction','event','metric','seen_at','site_id','value'],'no visitor field')
 // The overview: 11 of 12 goals tracking, naming the silent goal, with the time the check ran.
 const lines=await overview()
 assert.ok(lines.includes('11 of 12 goals tracking (no conversion on 2026-11-17: Signup) · checked Wed, Nov 18, 7:30 AM CST'))
 assert.ok(lines.includes('No goals to track · checked Wed, Nov 18, 7:30 AM CST'))
 const fernSettings=await settings(fern)
 for(const text of ['Goals that stopped firing: Signup (after the deploy “Deploy 7” on 2026-11-17).','Pages that stopped sending pageviews: /pricing.','Collection errors: 12 (usual range 0 to 0), a surge.'])assert.ok(fernSettings.includes(text),text)
 assert.ok((await settings(pine)).includes('Consent rate: 16.7% of 24 page loads that reached Vane (usual 100%), collapsed.'))
 // The report's coverage names the refused page loads too (COVERAGE-001).
 const report=plain(await (await a.request(`/app/sites/${fern}?from=2026-11-17&to=2026-11-18`,{headers:{cookie:a.owner}})).text())
 assert.ok(report.includes('Collection errors'),'the report states the page loads refused as collection errors')
 // The overview line and the settings section at both review widths, without sideways scrolling.
 const browser=await chromium.launch({headless:true,args:['--use-mock-keychain','--password-store=basic']});t.after(()=>browser.close())
 const context=await browser.newContext();await context.addCookies(a.owner.split('; ').map(pair=>{const at=pair.indexOf('=');return {name:pair.slice(0,at),value:pair.slice(at+1),url:a.origin}}))
 await context.route('**/*',async route=>{
  const request=route.request(),url=new URL(request.url());if(url.origin!==a.origin)return route.abort()
  const response=await a.request(url.pathname+url.search,{method:request.method(),headers:request.headers(),body:['GET','HEAD'].includes(request.method())?undefined:request.postDataBuffer()??undefined})
  await route.fulfill({status:response.status,headers:Object.fromEntries(response.headers),body:Buffer.from(await response.arrayBuffer())})
 })
 const view=await context.newPage()
 for(const width of [1440,390]){
  await view.setViewportSize({width,height:1000});await view.goto(`${a.origin}/app`)
  assert.match(plain(await view.locator(`[data-site="${fern}"] [data-health]`).textContent()),/^11 of 12 goals tracking \(no conversion on 2026-11-17: Signup\) · checked Wed, Nov 18, 7:30 AM CST$/)
  assert.equal(await view.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true)
  if(process.env.VANE_SCREEN_DIR){await mkdir(process.env.VANE_SCREEN_DIR,{recursive:true});await view.screenshot({path:join(process.env.VANE_SCREEN_DIR,`tracking-health-overview-${width}.png`)})}
  await view.goto(`${a.origin}/app/sites/${fern}?section=settings`)
  await view.getByRole('heading',{name:'Tracking health',exact:true}).scrollIntoViewIfNeeded()
  assert.match(await view.locator('[data-health-findings]').textContent(),/\/pricing/)
  assert.equal(await view.getByLabel('Daily check at',{exact:true}).inputValue(),'07:30')
  assert.equal(await view.getByRole('option',{name:'Tracking health: a page stops sending pageviews',exact:true}).count(),1)
  assert.equal(await view.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true)
  if(process.env.VANE_SCREEN_DIR)await view.screenshot({path:join(process.env.VANE_SCREEN_DIR,`tracking-health-settings-${width}.png`)})
 }
 await browser.close()
 // ALERT-002 / ERASURE-001: derived findings leave with the erased history, while the owner's schedule stays.
 const snapshot=await a.archive()
 assert.deepEqual(snapshot.payload.tables.vane_health,(await a.dump()).vane_health,'ALERT-002 health custody is part of the installation archive')
 const erasure=await a.post('/api/vane/commands',{command:'history.erase',input:{siteId:fern}},a.owner)
 assert.equal(erasure.status,201);const prepared=await erasure.json()
 assert.equal((await a.form({operation:'proposal.approve',id:prepared.id},a.owner)).status,303)
 const cleared=(await a.dump()).vane_health.find(r=>r.site_id===fern)
 assert.deepEqual([cleared.check_minute,cleared.checked_day,cleared.checked_at,cleared.result_json],[450,null,null,null],'ALERT-002 keeps only the approved check time after erasure')
 assert.ok((await overview()).includes('Tracking health: first check at 07:30 (America/Chicago)'))
 const deletion=await a.post('/api/vane/commands',{command:'site.delete',input:{siteId:fern}},a.owner)
 assert.equal(deletion.status,201);const remove=await deletion.json()
 assert.equal((await a.form({operation:'proposal.approve',id:remove.id},a.owner)).status,303)
 assert.equal((await a.dump()).vane_health.some(r=>r.site_id===fern),false,'ALERT-002 site deletion removes its health schedule too')
})

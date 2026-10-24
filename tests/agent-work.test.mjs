import test from 'node:test'
import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { assert, installation, browse } from './vane-helpers.mjs'
async function json(response,status=200){assert.equal(response.status,status,await response.clone().text());return response.json()}
const draft=(siteId)=>({siteId,from:'2026-10-05',to:'2026-10-12',title:'Review pricing CTA',effect:'Improve native signup conversion',guardrail:'Keep page loading and consent stable',measurement:'An experiment with a confidence interval',target:'pane'})
test('Agent drafts preserve the review plan and refuse every unavailable shipping destination and unauthorized caller',async t=>{
 const a=await installation();t.after(()=>a.close());const id=await a.addSite(),viewer=await a.invite('synthetic-vane-1@example.test','member')
 const made=await json(await a.post('/api/vane/agent/draft',draft(id),a.owner),201)
 assert.equal(made.state,'draft-only');assert.equal(made.guardrail,draft(id).guardrail)
 const list=await json(await a.request('/api/vane/agent/work?'+new URLSearchParams({siteId:id,id:made.id}),{headers:{cookie:a.owner}}));assert.equal(list[0].measurement,draft(id).measurement)
 for(const target of ['pane','github','ads','webflow','mango']){const r=await json(await a.post('/api/vane/agent/ship',{siteId:id,id:made.id,target,approved:true},a.owner),409);assert.equal(r.error,'grant_unavailable')}
 assert.equal((await a.post('/api/vane/agent/draft',draft(id),viewer)).status,403)
 assert.equal((await a.post('/api/vane/agent/draft',draft(id))).status,401)
 assert.equal((await a.request('/api/vane/agent/work?siteId='+id,{headers:{cookie:viewer}})).status,403)
 assert.equal((await a.post('/api/vane/agent/draft',{...draft(id),token:'synthetic-vane-2'},a.owner)).status,400)
 assert.equal(a.egress.filter(u=>!u.startsWith('https://api.resend.com')).length,0)
})
test('Weekly local opportunities cite exact native figures and linked drafts and suppress dismissed types next week',async t=>{
 const a=await installation();t.after(()=>a.close());const id=await a.addSite({paths:['/','/pricing','/guide','/thanks']})
 for(const day of ['2026-10-06','2026-10-13'])for(const path of ['/','/pricing','/guide'])for(let i=0;i<5;i++){
  await a.clock(Date.parse(day+'T12:00:00Z')+i*60000)
  assert.equal((await a.post('/api/vane/collect',a.event(id,{path}),'',{'origin':'https://fern.example','cf-connecting-ip':`198.51.100.${i+1+['/','/pricing','/guide'].indexOf(path)*5}`})).status,202)
 }
 await a.clock(Date.parse('2026-10-20T12:00:00Z'))
 const r=await json(await a.post('/api/vane/agent/brief',{siteId:id,to:'2026-10-12'},a.owner))
 assert.equal(r.opportunities.length,3);assert.equal(r.shortfall,null)
 for(const o of r.opportunities){assert.equal(o.type,'entry-exit');assert.deepEqual(o.figures,{entries:5,exits:5});const linked=await json(await a.request(o.draft,{headers:{cookie:a.owner}}));assert.equal(linked[0].id,o.draftId);assert.equal(linked[0].state,'draft-only')}
 const repeat=await json(await a.post('/api/vane/agent/brief',{siteId:id,to:'2026-10-12'},a.owner));assert.equal(repeat.id,r.id)
 await json(await a.post('/api/vane/agent/dismiss',{siteId:id,type:'entry-exit'},a.owner))
 const next=await json(await a.post('/api/vane/agent/brief',{siteId:id,to:'2026-10-19'},a.owner));assert.equal(next.opportunities.length,0);assert.match(next.shortfall,/Fewer than three/)
 const archive=await a.archive();assert.equal(archive.payload.tables.vane_agent_dismissals.length,1);assert.ok(archive.payload.tables.vane_agent_work.length>=5)
 const erased=await json(await a.post('/api/vane/commands',{command:'history.erase',input:{siteId:id}},a.owner),201);assert.equal((await a.form({operation:'proposal.approve',id:erased.id},a.owner)).status,303)
 assert.equal((await a.dump()).vane_agent_work.length,0);assert.equal((await a.dump()).vane_agent_dismissals.length,1)
})
test('Result assessment refuses local drafts as shipped changes',async t=>{
 const a=await installation();t.after(()=>a.close());const id=await a.addSite();await a.clock(Date.parse('2026-10-20T12:00:00Z'))
 const made=await json(await a.post('/api/vane/agent/draft',draft(id),a.owner),201)
 const r=await json(await a.post('/api/vane/agent/measure',{siteId:id,fixId:made.id,from:'2026-10-12',to:'2026-10-19',comparedFrom:'2026-10-05',comparedTo:'2026-10-12'},a.owner),409);assert.equal(r.error,'change')
})
test('Anomaly pursuit attaches movement evidence, preserves the open item and waits for a person to confirm expected traffic',async t=>{
 const a=await installation();t.after(()=>a.close());const id=await a.addSite(),made={id:'synthetic-vane-3'}
 assert.equal((await a.post('/api/vane/agent/pursue',{siteId:id,itemId:made.id},a.owner)).status,404)
 assert.equal((await a.dump()).vane_follow_items.length,0)
 await a.clock(Date.parse('2026-10-19T10:00:00Z'))
 assert.equal((await a.form({operation:'alert.create',siteId:id,metric:'current',direction:'below',threshold:'1',cooldown:'1'},a.owner)).status,303)
 await a.scheduled();const item=(await a.dump()).vane_follow_items[0];assert.ok(item)
 await a.clock(Date.parse('2026-10-20T10:00:00Z'));const mails=a.sentMail.length
 const pursued=await json(await a.post('/api/vane/agent/pursue',{siteId:id,itemId:item.id,from:'2026-10-12',to:'2026-10-19',comparedFrom:'2026-10-05',comparedTo:'2026-10-12'},a.owner))
 assert.equal(pursued.state,'awaiting-person');assert.equal(a.sentMail.length,mails)
 assert.equal((await a.dump()).vane_follow_items.find(i=>i.id===item.id).state,'open')
 assert.ok((await a.dump()).vane_follow_events.some(e=>e.item_id===item.id&&e.detail.includes(pursued.id)))
 const {context}=await browse(t,a);await context.addCookies(a.owner.split('; ').map(pair=>{const i=pair.indexOf('=');return {name:pair.slice(0,i),value:pair.slice(i+1),url:a.origin}}));const page=await context.newPage()
 const dir=process.env.VANE_SCREENSHOT_DIR;if(dir)await mkdir(dir,{recursive:true})
 for(const width of [1440,390]){await page.setViewportSize({width,height:1000});await page.goto(`${a.origin}/app/sites/${id}?section=settings`);await page.locator('#follow-up').scrollIntoViewIfNeeded();await page.evaluate(()=>scrollBy(0,-110));assert.equal(await page.getByRole('link',{name:'Open investigation evidence'}).getAttribute('href'),`/api/vane/agent/work?siteId=${id}&id=${pursued.id}`);assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);const menu=page.locator('summary[aria-label=Menu]');if(await menu.isVisible()){await menu.focus();assert.equal(await page.locator('#vane-menu-tip').evaluate(e=>getComputedStyle(e).visibility),'visible');await menu.blur();await menu.hover();await page.waitForTimeout(100);assert.equal(await page.locator('#vane-menu-tip').evaluate(e=>getComputedStyle(e).visibility),'hidden');await page.waitForTimeout(250);assert.equal(await page.locator('#vane-menu-tip').evaluate(e=>getComputedStyle(e).visibility),'visible')}if(dir)await page.screenshot({path:join(dir,`agent-pursuit-${width}.png`)})}
 assert.equal((await a.form({operation:'follow.resolve',id:item.id,outcome:'expected'},a.owner)).status,303)
 assert.equal((await a.dump()).vane_follow_items.find(i=>i.id===item.id).outcome,'expected')
})

test('Scheduled ended-week briefs review all five opportunity types with exact figures and suppress dismissed types in saved briefs and next week',async t=>{
 const a=await installation({vars:{GOOGLE_CLIENT_ID:'synthetic-vane-1',GOOGLE_CLIENT_SECRET:'synthetic-vane-2'}});t.after(()=>a.close());await a.clock(Date.parse('2026-10-20T12:00:00Z'))
 const id=await a.addSite({paths:[],retainForever:true,goals:{signup:'/thanks'},funnels:[{name:'stalled',steps:['/stall','/missing']}]})
 a.fixtureSites['https://oauth2.googleapis.com']=async()=>Response.json({access_token:'synthetic-vane-3',refresh_token:'synthetic-vane-4',expires_in:3600,scope:'https://www.googleapis.com/auth/webmasters.readonly'})
 a.fixtureSites['https://www.googleapis.com']=async req=>{const url=new URL(req.url);if(url.pathname.endsWith('/sites'))return Response.json({siteEntry:[{siteUrl:'https://fern.example/',permissionLevel:'siteOwner'}]});const q=await req.json(),days=['2026-10-06','2026-10-13'].filter(d=>d>=q.startDate&&d<=q.endDate);return Response.json({rows:days.map(d=>({keys:q.dimensions.map(k=>k==='date'?d:k==='query'?'growth guide':'https://fern.example/slow'),clicks:10,impressions:200,ctr:.05,position:6}))})}
 const begun=await a.form({operation:'search.google.begin',siteId:id},a.owner),state=new URL(begun.headers.get('location')).searchParams.get('state');assert.equal((await a.request('/api/vane/search-console/callback?'+new URLSearchParams({state,code:'synthetic-vane-5'}),{headers:{cookie:a.owner}})).status,303);assert.equal((await a.form({operation:'search.google.property',siteId:id,property:'https://fern.example/'},a.owner)).status,303)
 for(const day of ['2026-10-06','2026-10-13'])for(const [index,path] of ['/slow','/fast','/campaign','/stall'].entries())for(let i=0;i<5;i++){
  const ip=`198.51.100.${index*5+i+1}`,at=Date.parse(day+'T12:00:00Z')+i*60000,event=a.event(id,{path,campaign:path==='/campaign'?'winner':'baseline'});await a.clock(at);assert.equal((await a.post('/api/vane/collect',event,'',{origin:'https://fern.example','cf-connecting-ip':ip})).status,202)
  if(['/slow','/fast','/campaign'].includes(path))assert.equal((await a.post('/api/vane/perf',{siteId:id,id:event.id,lcp:path==='/slow'?4000:1000},'',{origin:'https://fern.example'})).status,202)
  if(['/fast','/campaign'].includes(path)){await a.clock(at+1000);assert.equal((await a.post('/api/vane/collect',a.event(id,{path:'/thanks'}),'',{origin:'https://fern.example','cf-connecting-ip':ip})).status,202)}
 }
 await a.clock(Date.parse('2026-10-12T12:00:00Z'));const mail=a.sentMail.length;await a.scheduled();assert.equal(a.sentMail.length,mail);let work=await json(await a.request('/api/vane/agent/work?siteId='+id,{headers:{cookie:a.owner}})),brief=work.find(w=>w.kind==='brief'&&w.to_day==='2026-10-12');assert.ok(brief);assert.equal(brief.opportunities.length,5);assert.deepEqual(new Set(brief.opportunities.map(o=>o.type)),new Set(['entry-exit','campaign','slow-page','search','funnel']));
 const of=type=>brief.opportunities.find(o=>o.type===type);assert.deepEqual(of('campaign').figures,{visits:5,conversions:5,rate:100,siteRate:50});assert.deepEqual(of('slow-page').figures,{measured:5,lcpMilliseconds:4000,visits:5,conversions:0,rate:0,peerVisits:10,peerConversions:10,peerRate:100});assert.deepEqual(of('search').figures,{clicks:10,impressions:200,position:6,ctr:.05});assert.deepEqual(of('funnel').figures,{entered:5,reached:0});assert.deepEqual(of('entry-exit').figures,{entries:5,exits:5});
 for(const o of brief.opportunities){const linked=await json(await a.request(o.draft,{headers:{cookie:a.owner}}));assert.equal(linked[0].id,o.draftId);assert.equal(linked[0].state,'draft-only')}
 await a.scheduled();work=await json(await a.request('/api/vane/agent/work?siteId='+id,{headers:{cookie:a.owner}}));assert.equal(work.filter(w=>w.kind==='brief'&&w.to_day==='2026-10-12').length,1)
 const {context}=await browse(t,a);await context.addCookies(a.owner.split('; ').map(pair=>{const i=pair.indexOf('=');return {name:pair.slice(0,i),value:pair.slice(i+1),url:a.origin}}));const page=await context.newPage(),dir=process.env.VANE_SCREEN_DIR;if(dir)await mkdir(dir,{recursive:true});
 for(const width of [1440,390]){await page.setViewportSize({width,height:1000});await page.goto(`${a.origin}/app/sites/${id}?section=settings`);await page.getByRole('heading',{name:'Weekly growth briefs',exact:true}).scrollIntoViewIfNeeded();for(const type of ['entry-exit','campaign','slow-page','search','funnel'])assert.equal(await page.getByRole('button',{name:'Dismiss '+type,exact:true}).count(),1);assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);if(dir)await page.screenshot({path:join(dir,`growth-all-${width}.png`)});for(const title of brief.opportunities.map(o=>o.title)){await page.getByRole('heading',{name:title,exact:true}).scrollIntoViewIfNeeded();if(dir)await page.screenshot({path:join(dir,`growth-${brief.opportunities.find(o=>o.title===title).type}-${width}.png`)})}}
 const briefId=brief.id, originalDrafts=brief.opportunities.map(o=>o.draftId)
 // The Settings form must stop raising dismissed types even in an already saved week.
 for(const [index,type] of ['entry-exit','campaign','slow-page','search','funnel'].entries()){
  assert.equal((await a.form({operation:'agent.dismiss',siteId:id,type},a.owner)).status,303)
  const saved=await json(await a.request('/api/vane/agent/work?'+new URLSearchParams({siteId:id,id:briefId}),{headers:{cookie:a.owner}}))
  assert.equal(saved[0].opportunities.length,4-index);assert.equal(saved[0].opportunities.some(o=>o.type===type),false)
  if(index>=2)assert.match(saved[0].shortfall,/Fewer than three/)
  else assert.equal(saved[0].shortfall,null)
 }
 const repeated=await json(await a.post('/api/vane/agent/brief',{siteId:id,to:'2026-10-12'},a.owner));assert.equal(repeated.id,briefId);assert.deepEqual(repeated.opportunities,[]);assert.match(repeated.shortfall,/Fewer than three/)
 for(const width of [1440,390]){
  await page.setViewportSize({width,height:1000});await page.goto(`${a.origin}/app/sites/${id}?section=settings`);await page.getByRole('heading',{name:'Weekly growth briefs',exact:true}).scrollIntoViewIfNeeded()
  for(const type of ['entry-exit','campaign','slow-page','search','funnel'])assert.equal(await page.getByRole('button',{name:'Dismiss '+type,exact:true}).count(),0)
  assert.equal(await page.getByText(/Fewer than three supported opportunities/).count(),1)
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true)
  if(dir)await page.screenshot({path:join(dir,`growth-dismissed-${width}.png`)})
  const menu=page.locator('summary[aria-label=Menu]')
  if(await menu.isVisible()){
   await menu.focus();assert.equal(await page.locator('#vane-menu-tip').evaluate(e=>getComputedStyle(e).visibility),'visible');if(dir)await page.screenshot({path:join(dir,`growth-menu-focus-${width}.png`)})
   await menu.blur();await menu.hover();await page.waitForTimeout(100);assert.equal(await page.locator('#vane-menu-tip').evaluate(e=>getComputedStyle(e).visibility),'hidden');await page.waitForTimeout(250);assert.equal(await page.locator('#vane-menu-tip').evaluate(e=>getComputedStyle(e).visibility),'visible');if(dir)await page.screenshot({path:join(dir,`growth-menu-hover-${width}.png`)})
  }
 }
 const stored=(await a.dump()).vane_agent_work;assert.equal(JSON.parse(stored.find(w=>w.id===briefId).payload_json).opportunities.length,5);for(const draftId of originalDrafts)assert.ok(stored.some(w=>w.id===draftId))
 await a.clock(Date.parse('2026-10-19T12:00:00Z'));await a.scheduled();work=await json(await a.request('/api/vane/agent/work?siteId='+id,{headers:{cookie:a.owner}}));brief=work.find(w=>w.kind==='brief'&&w.to_day==='2026-10-19');assert.deepEqual(brief.opportunities,[]);assert.match(brief.shortfall,/Fewer than three/)
})

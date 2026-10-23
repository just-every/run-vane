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
 for(const width of [1440,390]){await page.setViewportSize({width,height:1000});await page.goto(`${a.origin}/app/sites/${id}?section=settings`);await page.locator('#follow-up').scrollIntoViewIfNeeded();await page.evaluate(()=>scrollBy(0,-110));assert.ok((await page.locator('#follow-up').innerText()).includes(pursued.id));assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);const menu=page.locator('summary[aria-label=Menu]');if(await menu.isVisible()){await menu.focus();assert.equal(await page.locator('#vane-menu-tip').evaluate(e=>getComputedStyle(e).visibility),'visible');await menu.blur();await menu.hover();await page.waitForTimeout(100);assert.equal(await page.locator('#vane-menu-tip').evaluate(e=>getComputedStyle(e).visibility),'hidden');await page.waitForTimeout(250);assert.equal(await page.locator('#vane-menu-tip').evaluate(e=>getComputedStyle(e).visibility),'visible')}if(dir)await page.screenshot({path:join(dir,`agent-pursuit-${width}.png`)})}
 assert.equal((await a.form({operation:'follow.resolve',id:item.id,outcome:'expected'},a.owner)).status,303)
 assert.equal((await a.dump()).vane_follow_items.find(i=>i.id===item.id).outcome,'expected')
})

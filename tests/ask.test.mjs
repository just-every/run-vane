import test from 'node:test'
import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { assert, installation } from './vane-helpers.mjs'

// The provider edge is the only fake: a scripted model that answers the exact question text it was sent with a JSON plan.
// Everything after it (validation, the Stats API query, the figures, the page, the audit) is the real product.
const MODELS='https://models.fixture.example',now=Date.parse('2026-03-18T15:00:00Z')
const query=(extra={})=>({kind:'query',query:{metrics:['visitors'],period:'7d',filters:[],...extra}})
const SCRIPT={
 'How many visitors and pageviews did we have in the last 7 days?':query({metrics:['visitors','pageviews']}),
 'Which campaigns brought paying customers from Texas this month?':query({metrics:['visitors','conversion_rate'],dimension:'utm_campaign',period:'month',filters:['region:is:Texas','goal:is:signup']}),
 'What are our top sources over the last 30 days?':query({metrics:['visitors','visits'],dimension:'source',period:'30d'}),
 'Which pages get the most pageviews this month?':query({metrics:['pageviews'],dimension:'page',period:'month'}),
 'How did visits change against the previous period?':query({metrics:['visits'],period:'30d',compare:'previous'}),
 'Which regions sent visitors between March 5 and March 12?':query({metrics:['visitors'],dimension:'region',period:undefined,from:'2026-03-05',to:'2026-03-13'}),
 'What was our bounce rate by device last month?':query({metrics:['bounce_rate','visitors'],dimension:'device',period:'last-month'}),
 'How is the site doing?':{kind:'clarify',prompt:'Do you mean traffic or engagement?',choices:[{label:'Visitors over the last 7 days',query:{metrics:['visitors'],period:'7d',filters:[]}},{label:'Pageviews by page this month',query:{metrics:['pageviews'],dimension:'page',period:'month',filters:[]}}]},
 'Who is the person that visited from Austin?':{kind:'unanswerable',reason:'people',explanation:'Visitors are anonymous daily hashes, so no person can be named.'},
 'Why did traffic dip on Tuesday?':{kind:'unanswerable',reason:'causes',explanation:'Vane shows what moved, not a proven cause.'},
}
function provider(a,seen){
 a.fixtureSites[MODELS]=async request=>{
  const body=await request.json();seen.push({url:request.url,authorization:request.headers.get('authorization'),body})
  const plan=SCRIPT[body.messages.at(-1).content]??body.__unknown
  return plan?Response.json({choices:[{message:{role:'assistant',content:JSON.stringify(plan)}}]}):Response.json({choices:[{message:{content:'not json'}}]})
 }
}
const ai={AI_ENABLED:'true',AI_API_KEY:'synthetic-vane-ask-1',AI_BASE_URL:MODELS+'/v1',AI_MODEL:'fixture/model'}
async function seed(a,siteId){
 let n=0
 const visit=async(at,{campaign='launch',region='Texas',source='search.example',paths=['/'],ua='Synthetic Browser'}={})=>{const ip='198.51.100.'+(++n)
  for(const [i,path] of paths.entries()){await a.clock(at+i*20000);const r=await a.request('/api/vane/collect',{method:'POST',headers:{origin:'https://fern.example','content-type':'application/json','user-agent':ua,'cf-connecting-ip':ip},body:JSON.stringify(a.event(siteId,{path,campaign,source})),cf:{country:'US',region,regionCode:'XX',city:null,metroCode:null}});assert.equal(r.status,202,await r.clone().text())}}
 const day=86400000
 for(let d=1;d<=14;d++){
  await visit(now-d*day,{campaign:d%3?'launch':'spring',paths:d%4?['/','/pricing']:['/','/thanks']})
  await visit(now-d*day+3600000,{campaign:'spring',region:'Ohio',source:'news.example',paths:['/blog']})
 }
 await visit(now-30*day,{campaign:'winter',paths:['/']})
}
const statsKey=async a=>(await(await a.form({operation:'apikey.create',kind:'stats',label:'Ask check',...Object.fromEntries((a.sites??[]).map(id=>['site_'+id,'on']))},a.owner)).text()).match(/data-api-key>(vane_k_[0-9a-f]{64})</)?.[1]

test('AGENT-007 ten fixture questions answer with the shown Stats API query, a clarifying choice and honest refusals, and the model sees only the question and the vocabulary',async t=>{
 const a=await installation({vars:ai});t.after(()=>a.close())
 const seen=[];provider(a,seen)
 await a.clock(now);const id=await a.addSite({paths:[],retainForever:true});a.sites=[id];await seed(a,id)
 await a.clock(now)
 assert.equal((await a.form({operation:'ask.configure',siteId:id,enabled:'on'},a.owner)).status,303)
 const key=await statsKey(a);assert.ok(key,'a Stats API key reads the same figures')
 const stats=async path=>{const r=await a.request(path,{headers:{authorization:'Bearer '+key}});assert.equal(r.status,200,await r.clone().text());return r.json()}
 const ask=async question=>{const r=await a.post('/api/vane/ask',{siteId:id,question},a.owner);assert.equal(r.status,200,await r.clone().text());return r.json()}
 const answerable=Object.keys(SCRIPT).filter(q=>SCRIPT[q].kind==='query')
 for(const question of answerable){
  const answer=await ask(question);assert.equal(answer.kind,'answer',question)
  assert.deepEqual(answer.stats,await stats(answer.api),'the answer equals the Stats API result for the shown query: '+question)
  assert.deepEqual(answer.query.metrics,SCRIPT[question].query.metrics)
 }
 const texas=await ask('Which campaigns brought paying customers from Texas this month?')
 assert.deepEqual(texas.filters,['Region is Texas','Goal is signup']);assert.equal(texas.query.dimension,'utm_campaign');assert.ok(texas.stats.breakdown.length>0,'the fixture has Texas visitors who reached /thanks')
 assert.ok(texas.stats.breakdown.every(r=>r.value==='launch'||r.value==='spring'))
 const range=await ask('Which regions sent visitors between March 5 and March 12?');assert.deepEqual(range.range,{from:'2026-03-05',to:'2026-03-13',timeZone:'UTC'})
 assert.equal((await ask('How did visits change against the previous period?')).stats.compare.mode,'previous')
 // Ambiguous: a choice, whose pick runs the shown query without asking the model again.
 const before=seen.length,unclear=await ask('How is the site doing?');assert.equal(unclear.kind,'clarify');assert.equal(unclear.choices.length,2)
 const picked=await a.post('/api/vane/ask',{siteId:id,query:unclear.choices[1].query},a.owner);const chosen=await picked.json()
 assert.equal(seen.length,before+1,'a clarifying choice does not call the model');assert.deepEqual(chosen.stats,await stats(unclear.choices[1].api))
 // Unanswerable: people and causes say so and run nothing.
 for(const [question,reason] of [['Who is the person that visited from Austin?','people'],['Why did traffic dip on Tuesday?','causes']]){const refused=await ask(question);assert.deepEqual([refused.kind,refused.reason],['unanswerable',reason]);assert.equal(refused.stats,undefined)}
 // Ten fixture questions in all: seven plain, one with a choice, two refused.
 assert.equal(Object.keys(SCRIPT).length,10)
 // What left Vane: only the model host, the configured key, the question and the vocabulary; no figure, address or page value.
 assert.deepEqual([...new Set(seen.map(s=>s.url))],[MODELS+'/v1/chat/completions']);assert.ok(seen.every(s=>s.authorization==='Bearer synthetic-vane-ask-1'))
 const sent=JSON.stringify(seen.map(s=>s.body));for(const marker of ['198.51.100','Synthetic Browser','Ohio','/pricing','/blog','news.example'])assert.equal(sent.includes(marker),false,marker+' never goes to the model provider')
 assert.match(seen[0].body.messages[0].content,/Goals declared for this site: signup\./)
 // Audited without the text.
 const dump=await a.dump();const audited=dump.vane_audit.filter(r=>r.action==='ask.question');assert.equal(audited.length,seen.length);assert.ok(dump.vane_audit.some(r=>r.action==='ask.configure'&&r.detail==='enabled'))
 for(const text of Object.keys(SCRIPT))assert.equal(JSON.stringify(dump).includes(text),false,'no question text is stored')
 // The page, at both review widths.
 const {chromium}=await import('@playwright/test')
 const browser=await chromium.launch({headless:true,args:['--use-mock-keychain','--password-store=basic']});t.after(()=>browser.close())
 const context=await browser.newContext();await context.addCookies(a.owner.split('; ').map(pair=>{const at=pair.indexOf('=');return {name:pair.slice(0,at),value:pair.slice(at+1),url:a.origin}}))
 await context.route('**/*',async route=>{const request=route.request(),url=new URL(request.url());if(url.origin!==a.origin)return route.abort()
  const response=await a.request(url.pathname+url.search,{method:request.method(),headers:request.headers(),body:['GET','HEAD'].includes(request.method())?undefined:request.postDataBuffer()??undefined})
  await route.fulfill({status:response.status,headers:Object.fromEntries(response.headers),body:Buffer.from(await response.arrayBuffer())})})
 const view=await context.newPage(),dir=process.env.VANE_SCREEN_DIR;if(dir)await mkdir(dir,{recursive:true})
 for(const width of [1440,390]){
  await view.setViewportSize({width,height:1000});await view.goto(`${a.origin}/app/sites/${id}?section=ask`)
  await view.getByLabel('Your question').fill('Which campaigns brought paying customers from Texas this month?');await view.getByRole('button',{name:'Ask',exact:true}).click()
  assert.equal((await view.locator('[data-ask-api]').textContent()),texas.api)
  assert.match(await view.locator('[data-ask-query]').textContent(),/Region is Texas; Goal is signup/)
  assert.equal(await view.locator('svg.vane-ask-chart').count(),1);assert.ok(await view.locator('table').count()>=2,'every chart has its data table')
  const rows=await view.locator('table').first().locator('tbody tr').count();assert.equal(rows,texas.stats.breakdown.length)
  assert.equal(await view.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,'no sideways scrolling')
  if(dir)await view.screenshot({path:join(dir,`ask-answer-${width}.png`),fullPage:true})
  await view.getByLabel('Your question').fill('How is the site doing?');await view.getByRole('button',{name:'Ask',exact:true}).click()
  await view.getByRole('button',{name:'Pageviews by page this month'}).click();assert.match(await view.locator('[data-ask-api]').textContent(),/dimension=page/)
  await view.getByLabel('Your question').fill('Who is the person that visited from Austin?');await view.getByRole('button',{name:'Ask',exact:true}).click()
  assert.match(await view.locator('[data-ask-unanswerable]').textContent(),/asks about people/)
  assert.equal(await view.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);if(dir)await view.screenshot({path:join(dir,`ask-refusal-${width}.png`),fullPage:true})
 }
 await browser.close()
 // The same question through an assistant's MCP key.
 const rpc=async(body)=>(await a.request('/api/v1/mcp',{method:'POST',headers:{authorization:'Bearer '+key,'content-type':'application/json','mcp-protocol-version':'2025-06-18'},body:JSON.stringify({jsonrpc:'2.0',id:1,...body})})).json()
 assert.ok((await rpc({method:'tools/list'})).result.tools.some(x=>x.name==='ask_question'&&x.annotations?.readOnlyHint))
 const mcp=await rpc({method:'tools/call',params:{name:'ask_question',arguments:{site_id:id,question:'How many visitors and pageviews did we have in the last 7 days?'}}})
 assert.deepEqual(mcp.result.structuredContent.stats,await stats(mcp.result.structuredContent.api));assert.ok((await a.dump()).vane_audit.some(r=>r.action==='ask.question'&&r.actor.startsWith('key:')))
})

test('AGENT-007 questions are off until the owner enables them, owner-only to change, scoped, limited, and a bad model reply runs nothing',async t=>{
 const a=await installation({vars:ai});t.after(()=>a.close())
 const seen=[];provider(a,seen)
 await a.clock(now);const id=await a.addSite({paths:[]}),other=await a.addSite({name:'Oak Bakery',origin:'https://oak.example',paths:[]})
 const post=(body,cookie=a.owner,path='/api/vane/ask')=>a.post(path,body,cookie)
 const question='How many visitors and pageviews did we have in the last 7 days?'
 assert.equal((await post({siteId:id,question})).status,403,'off by default');assert.equal(seen.length,0,'nothing is sent while off')
 const viewer=await a.invite('synthetic-vane-ask-viewer@example.test','member'),admin=await a.invite('synthetic-vane-ask-admin@example.test','admin')
 assert.equal((await post({siteId:id,enabled:'on'},admin,'/api/vane/ask-settings')).status,403,'only the owner enables questions');assert.equal((await post({siteId:id,enabled:'on'},'','/api/vane/ask-settings')).status,401)
 assert.equal((await post({siteId:id,enabled:'maybe'},a.owner,'/api/vane/ask-settings')).status,400);assert.equal((await post({siteId:id,enabled:'on',note:'x'},a.owner,'/api/vane/ask-settings')).status,400)
 assert.equal((await post({siteId:id,enabled:true},a.owner,'/api/vane/ask-settings')).status,200)
 assert.equal((await post({siteId:id,question},viewer)).status,200,'a team member with access asks');assert.equal((await post({siteId:other,question})).status,403,'a site the owner has not enabled stays off')
 assert.equal((await post({siteId:id,question},'')).status,401)
 // Refused before any call: short, long, an email address, control characters.
 const sent=seen.length
 for(const bad of ['hi','x'.repeat(301),'Show visitors for jane@example.com','line\nbreak question'])assert.equal((await post({siteId:id,question:bad})).status,400,bad.slice(0,20))
 assert.equal(seen.length,sent,'a refused question is never sent')
 // A model reply Vane cannot run is refused and nothing is run or repaired.
 const bad=body=>{a.fixtureSites[MODELS]=async()=>Response.json({choices:[{message:{content:typeof body==='string'?body:JSON.stringify(body)}}]})}
 for(const reply of ['not json',{kind:'query',query:{metrics:['revenue'],period:'7d',filters:[]}},{kind:'query',query:{metrics:['visitors'],period:'7d',filters:['visitor:is:abc']}},{kind:'query',query:{metrics:['visitors'],period:'7d',filters:[],site_id:other}},{kind:'query',query:{metrics:['visitors'],period:'7d',from:'2026-03-01',to:'2026-03-02',filters:[]}},{kind:'shell',command:'rm'},{kind:'clarify',prompt:'One?',choices:[{label:'a',query:{metrics:['visitors'],period:'7d',filters:[]}}]}]){bad(reply);const r=await post({siteId:id,question});assert.equal(r.status,502,JSON.stringify(reply));assert.match((await r.json()).message,/nothing was run/)}
 // A provider that is off or down answers with a fixed reason, never the provider's own text.
 a.fixtureSites[MODELS]=()=>new Response('{"error":{"message":"secret upstream detail"}}',{status:500});const down=await post({siteId:id,question});assert.equal(down.status,502);assert.equal((await down.text()).includes('secret upstream detail'),false)
 // Each attempt counts toward 60 an hour per site; the next hour starts again.
 bad(query());for(let i=(await a.dump()).vane_audit.filter(r=>r.action==='ask.question').length;i<60;i++)assert.equal((await post({siteId:id,question})).status,200)
 const limited=await post({siteId:id,question});assert.equal(limited.status,429)
 // Audit rows carry wall time, so age them an hour and a minute instead of waiting.
 await a.inspectDb.prepare('UPDATE vane_audit SET at=at-3660000').run();assert.equal((await post({siteId:id,question})).status,200)
 // Turning it off stops asking and the model is not called again.
 assert.equal((await a.form({operation:'ask.configure',siteId:id,enabled:'off'},a.owner)).status,303);const calls=(await a.dump()).vane_audit.length;assert.equal((await post({siteId:id,question})).status,403);assert.equal((await a.dump()).vane_audit.length,calls)
})

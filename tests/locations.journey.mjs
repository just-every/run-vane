import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdir } from 'node:fs/promises'
import { chromium } from '@playwright/test'
import { installation } from './harness.mjs'

const json=async response=>{assert.equal(response.status,200,await response.clone().text());return response.json()}
const austin={country:'US',region:'Texas',regionCode:'TX',city:'Austin',metroCode:'635'}
const marfa={country:'US',region:'Texas',regionCode:'TX',city:'Marfa',metroCode:'633'}
const main='Metro 635 (unnamed)',small='Metro 633 (unnamed)'
const range='from=2026-03-09&to=2026-03-16&compare=previous'
const pick=rows=>rows.map(r=>[r.label,r.visitors,r.visits,r.conversions,r.conversionRate,r.previous])

test('DASH-005 metro codes retain honest unnamed labels across reports, segments, APIs, privacy suppression, live expiry and portable history',async t=>{
 let active=await installation();t.after(()=>active.close())
 const a=active,id=await a.addSite({paths:[],retainForever:true,publicReports:['locations']})
 const owner={headers:{cookie:a.owner}}
 let visitor=0
 async function visit(cf,at,paths=['/']){
  const ip='198.51.100.'+(++visitor)
  for(const [i,path] of paths.entries()){
   await a.clock(at+i*20000)
   const response=await a.request('/api/vane/collect',{method:'POST',headers:{origin:'https://fern.example','content-type':'application/json','user-agent':'Synthetic Browser','cf-connecting-ip':ip},body:JSON.stringify(a.event(id,{path})),cf:{...cf,postalCode:'RAW_POSTAL_SENTINEL',latitude:'RAW_LATITUDE_SENTINEL',longitude:'RAW_LONGITUDE_SENTINEL',timezone:'RAW_TIMEZONE_SENTINEL'}})
   assert.equal(response.status,202,await response.clone().text())
  }
 }
 const prior=Date.parse('2026-03-03T15:00:00Z'),now=Date.parse('2026-03-10T15:00:00Z')
 for(let n=0;n<30;n++)await visit(austin,prior+n*60000)
 for(let n=0;n<12;n++)await visit(austin,now+n*60000,n<3?['/','/thanks']:['/'])
 for(let n=0;n<3;n++)await visit(marfa,now+(20+n)*60000)
 // Unknown edge country codes discard even otherwise populated city/metro fields.
 for(const [n,country] of [undefined,'XX','T1'].entries())await visit({...austin,country},now+(30+n)*60000)
 await visit({country:'CA',region:'Ontario',city:'Toronto',metroCode:'635'},now+33*60000)
 const summary=extra=>a.request(`/api/vane/summary?siteId=${id}&${range}${extra??''}`,owner).then(json)
 const report=await summary('&goal=signup')
 assert.deepEqual(pick(report.metros),[[main,12,12,3,25,30],[small,3,3,0,0,0]])
 assert.equal(report.visitors,19)
 assert.equal(report.countries.find(r=>r.label==='Unknown location')?.visitors,3)
 const filtered=await summary('&filter='+encodeURIComponent('metro:is:'+main))
 assert.deepEqual([filtered.visitors,filtered.visits,filtered.goals,filtered.pageviews],[12,12,3,15])
 assert.deepEqual((await summary('&filter='+encodeURIComponent('metro:is_not:'+main))).visitors,7)
 const saved=await a.form({operation:'segment.save',siteId:id,name:'Austin metro',filters:'metro:is:'+main},a.owner)
 assert.equal(saved.status,303)
 const segment=new URL(saved.headers.get('location'),a.origin).searchParams.get('segment');assert.ok(segment)
 assert.deepEqual(pick((await summary('&segment='+segment)).metros),[[main,12,12,3,25,30]])

 const created=await a.form({operation:'apikey.create',kind:'stats',label:'Metro reporting',[`site_${id}`]:'on'},a.owner)
 assert.equal(created.status,200)
 const key=(await created.text()).match(/data-api-key>(vane_k_[0-9a-f]{64})</)?.[1];assert.ok(key)
 const statsQuery=`site_id=${id}&${range}&dimension=metro&metrics=visitors,visits,conversion_rate`
 const stats=await json(await a.request('/api/v1/stats?'+statsQuery,{headers:{authorization:'Bearer '+key}}))
 assert.deepEqual(stats.breakdown.map(r=>[r.value,r.visitors,r.visits,r.conversions,r.conversionRate,r.previous]),pick(report.metros))
 const scoped=await json(await a.request('/api/v1/stats?'+statsQuery+'&segment='+segment,{headers:{authorization:'Bearer '+key}}))
 assert.equal(scoped.results.visitors,12);assert.equal(scoped.breakdown.length,1)
 assert.equal((await a.request('/api/v1/stats?'+statsQuery)).status,401)
 const rpc=async(method,params,id=1)=>json(await a.request('/api/v1/mcp',{method:'POST',headers:{authorization:'Bearer '+key,'content-type':'application/json',accept:'application/json, text/event-stream','mcp-protocol-version':'2025-06-18'},body:JSON.stringify({jsonrpc:'2.0',id,method,params})}))
 await rpc('initialize',{protocolVersion:'2025-06-18',capabilities:{},clientInfo:{name:'metro-journey',version:'1'}})
 const mcp=await rpc('tools/call',{name:'query_stats',arguments:{site_id:id,from:'2026-03-09',to:'2026-03-16',compare:'previous',dimension:'metro',metrics:['visitors','visits','conversion_rate']}},2)
 assert.equal(mcp.result.isError,false);assert.deepEqual(mcp.result.structuredContent,stats)
 const csv=await a.request(`/api/vane/csv?siteId=${id}&${range}&table=metros`,owner)
 assert.equal(csv.status,200);assert.match(csv.headers.get('content-type'),/text\/csv/)
 const lines=(await csv.text()).trim().split('\r\n'),columns=lines.shift().split(',')
 const exported=lines.map(line=>Object.fromEntries(line.split(',').map((value,i)=>[columns[i],value])))
 assert.deepEqual(exported.map(r=>[r.label,Number(r.visitors),Number(r.conversions),Number(r.previous)]),[[main,12,3,30],[small,3,0,0]])

 const shared=await a.form({operation:'share.create',siteId:id,label:'Metro partners',share_locations:'on'},a.owner)
 assert.equal(shared.status,200)
 const link=(await shared.text()).match(/data-share-url>[^<]*(\/share\/vane_s_[0-9a-f]{64})</)?.[1];assert.ok(link)
 const sharedPath=link+'?'+range,publicPath='/stats/'+id+'?'+range
 for(const path of [sharedPath,publicPath]){
  const response=await a.request(path);assert.equal(response.status,200)
  const html=await response.text();assert.ok(html.includes(main));assert.ok(html.includes('Other metro areas'))
  assert.equal(html.includes(small),false);assert.equal(html.includes('Marfa'),false)
 }
 const historicalDump=await a.dump(),events=historicalDump.vane_events
 assert.equal(events.filter(e=>e.country===null).length,3)
 assert.ok(events.filter(e=>e.country===null).every(e=>[e.region,e.city,e.metro_code,e.metro_name].every(v=>v===null)))
 assert.ok(events.filter(e=>e.country==='Canada').every(e=>e.metro_code===null&&e.metro_name===null))
 assert.ok(events.every(e=>e.metro_name===null))
 const archive=await a.archive(),stored=JSON.stringify([historicalDump,archive])
 for(const raw of ['198.51.100.','RAW_POSTAL_SENTINEL','RAW_LATITUDE_SENTINEL','RAW_LONGITUDE_SENTINEL','RAW_TIMEZONE_SENTINEL'])assert.equal(stored.includes(raw),false,raw+' must not persist')

 const liveAt=Date.parse('2026-03-16T18:00:00Z');await visit(austin,liveAt)
 const realtime=()=>a.request('/api/vane/realtime?siteId='+id,owner).then(json)
 assert.deepEqual((await realtime()).metros,[{label:main,visitors:1,previous:0}])
 const browser=await chromium.launch({headless:true,args:['--use-mock-keychain','--password-store=basic']})
 let browserOpen=true;t.after(()=>browserOpen?browser.close():undefined)
 const context=await browser.newContext()
 await context.addCookies(a.owner.split('; ').map(pair=>{const [name,...value]=pair.split('=');return {name,value:value.join('='),url:a.origin}}))
 await context.route('**/*',async route=>{
  const req=route.request(),url=new URL(req.url());if(url.origin!==a.origin)return route.abort()
  const response=await a.request(url.pathname+url.search,{method:req.method(),headers:req.headers(),body:['GET','HEAD'].includes(req.method())?undefined:req.postDataBuffer()??undefined})
  return route.fulfill({status:response.status,headers:Object.fromEntries(response.headers),body:Buffer.from(await response.arrayBuffer())})
 })
 const page=await context.newPage(),screens=process.env.VANE_SCREEN_DIR
 if(screens)await mkdir(screens,{recursive:true})
 async function capture(path,label,locator,check){
  for(const width of [1440,390]){
   await page.setViewportSize({width,height:960});await page.goto(a.origin+path)
   const target=locator();await target.waitFor({state:'visible'});await target.scrollIntoViewIfNeeded()
   await check();assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,label+' at '+width)
   if(screens)await page.screenshot({path:`${screens}/locations-${label}-${width}.png`})
  }
 }
 const metroTable=()=>page.locator('table[data-locations="US metro areas"]')
 await capture(`/app/sites/${id}?section=report&${range}&goal=signup`,'report',metroTable,async()=>{
  const text=await metroTable().innerText();assert.ok(text.includes(main));assert.ok(text.includes(small));assert.match(text,/25\.0%/)
 })
 await capture(`/app/sites/${id}?section=report&${range}&segment=${segment}`,'segment',metroTable,async()=>{
  const text=await metroTable().innerText();assert.ok(text.includes(main));assert.equal(text.includes(small),false)
 })
 await capture(`/app/sites/${id}?section=realtime`,'realtime',()=>page.locator('table[data-live="Live US metro areas"]'),async()=>{
  const table=page.locator('table[data-live="Live US metro areas"]');assert.ok((await table.innerText()).includes(main));assert.equal(await table.locator('[data-visitors]').innerText(),'1')
 })
 await capture(`/app/sites/${id}?section=settings`,'settings',()=>page.getByRole('rowheader',{name:'Location',exact:true}),async()=>{const body=await page.locator('body').innerText();assert.ok(body.includes('metro_code'));assert.ok(body.includes('metro_name'))})
 // Public journeys run with an empty cookie jar.
 await context.clearCookies()
 for(const [path,label] of [[sharedPath,'shared'],[publicPath,'public']])await capture(path,label,metroTable,async()=>{
  const text=await metroTable().innerText();assert.ok(text.includes(main));assert.ok(text.includes('Other metro areas'));assert.equal(text.includes(small),false)
  assert.equal((await page.locator('body').innerText()).includes('Marfa'),false)
 })
 await capture('/methodology','methodology',()=>page.getByRole('heading',{name:'Location',exact:true}),async()=>{
  const body=await page.locator('body').innerText();assert.ok(body.includes('Metro NNN (unnamed)'));assert.ok(body.includes('NULL location fields'))
 })
 await a.clock(liveAt+5*60000+1000);assert.deepEqual((await realtime()).metros,[])
 await browser.close();browserOpen=false

 // Restore the historical archive into a second installation after disposing the first Worker.
 await a.close();active=await installation()
 const b=active
 assert.equal((await b.post('/api/vane/restore',{archive},b.owner)).status,200)
 const restored=await json(await b.request(`/api/vane/summary?siteId=${id}&${range}&goal=signup`,{headers:{cookie:b.owner}}))
 assert.deepEqual(pick(restored.metros),pick(report.metros))
 assert.deepEqual((await b.archive()).payload.tables.vane_events,archive.payload.tables.vane_events)
 const prepared=await b.post('/api/vane/commands',{command:'history.erase',input:{siteId:id}},b.owner)
 assert.equal(prepared.status,201)
 const proposal=await prepared.json()
 assert.equal((await b.form({operation:'proposal.approve',id:proposal.id},b.owner)).status,303)
 assert.deepEqual((await json(await b.request(`/api/vane/summary?siteId=${id}&${range}`,{headers:{cookie:b.owner}}))).metros,[])
 assert.equal((await b.archive()).payload.tables.vane_events.length,0)
})

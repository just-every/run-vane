import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdir } from 'node:fs/promises'
import { chromium } from '@playwright/test'
import { installation } from './harness.mjs'
const T=Date.parse('2026-10-19T12:00:00Z'),DAY=86400000
const scope='https://www.googleapis.com/auth/webmasters.readonly'

test('SEARCH-001, ACCESS-001, API-001/002 and ARCHIVE-001 read-only session-bound OAuth, private query/page figures and source dates, organic landing filter, 16-month ranges, first daily fill of late Google days exactly once, disconnect and credential-free archives through public doors at 1440 and 390',async t=>{
 const a=await installation({vars:{GOOGLE_CLIENT_ID:'fixture-google-client',GOOGLE_CLIENT_SECRET:'fixture-google-secret'}});t.after(()=>a.close())
 const id=await a.addSite({paths:[],goals:{},retainForever:true}),other=await a.addSite({origin:'https://other.example',paths:[],goals:{}}),owner={headers:{cookie:a.owner}}
 await a.clock(Date.parse('2026-10-16T12:00:00Z'))
 for(const [i,path,source] of [[1,'/guide','google.com'],[2,'/guide','google.com'],[3,'/shop','google.com'],[4,'/guide','direct']])assert.equal((await a.post('/api/vane/collect',a.event(id,{path,source}),'',{origin:'https://fern.example','cf-connecting-ip':`198.51.100.${i}`})).status,202)
 await a.clock(T)
 let publishedLate=false,apiCalls=0,revoked=0,tokenCalls=0
 a.fixtureSites['https://oauth2.googleapis.com']=async request=>{
  const p=new URLSearchParams(await request.text())
  if(new URL(request.url).pathname==='/revoke'){revoked++;assert.equal(p.get('token'),'fixture-google-refresh');return Response.json({})}
  tokenCalls++;assert.equal(p.get('client_id'),'fixture-google-client');assert.equal(p.get('client_secret'),'fixture-google-secret');assert.ok(['authorization_code','refresh_token'].includes(p.get('grant_type')))
  return Response.json({access_token:'fixture-google-access',refresh_token:'fixture-google-refresh',expires_in:3600,token_type:'Bearer',scope})
 }
 a.fixtureSites['https://www.googleapis.com']=async request=>{
  assert.equal(request.headers.get('authorization'),'Bearer fixture-google-access');const url=new URL(request.url)
  if(url.pathname==='/webmasters/v3/sites')return Response.json({siteEntry:[{siteUrl:'https://fern.example/',permissionLevel:'siteOwner'},{siteUrl:'sc-domain:fern.example',permissionLevel:'siteFullUser'}]})
  apiCalls++;assert.ok(url.pathname.endsWith('/searchAnalytics/query'));const q=await request.json();assert.equal(q.dataState,'final');assert.equal(q.rowLimit,25000);assert.equal(q.startRow,0)
  const days=['2026-10-16',...(publishedLate?['2026-10-17','2026-10-18']:[])].filter(d=>d>=q.startDate&&d<=q.endDate),rows=[]
  const row=(keys,clicks,impressions,position)=>({keys,clicks,impressions,ctr:clicks/impressions,position})
  for(const d of days){const late=d!=='2026-10-16'
   if(q.dimensions.length===1)rows.push(row([d],late?5:12,late?50:120,late?3:2.5))
   else if(q.dimensions.join(',')==='date,query')rows.push(row([d,'coffee guide'],late?5:8,late?50:80,late?3:2),...(!late?[row([d,'buy beans'],2,20,4),row([d,'private@example.test'],2,20,3)]:[]))
   else if(q.dimensions.join(',')==='date,page')rows.push(row([d,'https://fern.example/guide'],late?5:9,late?50:90,2),...(!late?[row([d,'https://fern.example/shop'],3,30,4)]:[]))
   else if(q.dimensions.join(',')==='date,query,page')rows.push(row([d,'coffee guide','https://fern.example/guide'],late?5:8,late?50:80,2),...(!late?[row([d,'buy beans','https://fern.example/shop'],2,20,4),row([d,'private@example.test','https://fern.example/orders/1234567?token=private-query'],2,20,3)]:[]))
   else assert.fail('only documented independent Google grains are queried')
  }
  if(q.dimensions.length===1&&q.startDate<'2026-10-01')for(let at=Date.parse(q.startDate);at<Date.parse('2026-10-16');at+=DAY)rows.push(row([new Date(at).toISOString().slice(0,10)],1,10,3));
  return Response.json({rows,responseAggregationType:'byProperty'})
 }
 const op=(operation,extra={},cookie=a.owner)=>a.form({operation,siteId:id,...extra},cookie)
 const source=async(from='2026-10-16',to='2026-10-19',cookie=a.owner)=>{const r=await a.request(`/api/vane/search-console/report?${new URLSearchParams({siteId:id,from,to})}`,{headers:{cookie}});assert.equal(r.status,200,await r.clone().text());return r.json()}
 assert.equal((await a.request('/api/vane/search-console/report?siteId='+id)).status,401)
 assert.equal((await a.request('/api/vane/search-console/callback?state=invalid')).status,401)
 assert.equal((await a.post('/app/action',{operation:'search.google.begin',siteId:id},a.owner,{origin:'https://foreign.example'})).status,403)
 const member=await a.invite('reader@example.test','member');assert.equal((await op('search.google.begin',{},member)).status,403)
 assert.equal((await a.form({operation:'team.invite',email:'scoped@example.test',role:'viewer',scope:'selected',['site_'+other]:'on'},a.owner)).status,303);const scoped=await a.accept('scoped@example.test');assert.equal((await a.request(`/api/vane/search-console/report?siteId=${id}&from=2026-10-16&to=2026-10-19`,{headers:{cookie:scoped}})).status,403)
 const disconnectedInventory=await(await a.request('/api/vane/inventory?siteId='+id,owner)).json();assert.equal(disconnectedInventory.fields.some(f=>f.table==='vane_search_connections'),false);
 const started=await op('search.google.begin');assert.equal(started.status,303);const consent=new URL(started.headers.get('location'));assert.equal(consent.origin,'https://accounts.google.com');assert.equal(consent.searchParams.get('scope'),scope)
 const callback='/api/vane/search-console/callback?'+new URLSearchParams({state:consent.searchParams.get('state'),code:'fixture-code'})
 assert.equal((await a.request(callback,owner)).status,303);assert.equal((await a.request(callback,owner)).status,400,'state is single use')
 assert.equal((await op('search.google.property',{property:'https://not-returned.example/'})).status,400)
 assert.equal((await op('search.google.property',{property:'https://fern.example/'})).status,303)
 let report=await source();assert.deepEqual(report.overall,{clicks:12,impressions:120,ctr:0.1,position:2.5});assert.deepEqual(report.queries.find(r=>r.query==='coffee guide'),{query:'coffee guide',clicks:8,impressions:80,ctr:0.1,position:2})
 assert.deepEqual(report.pages.map(r=>[r.path,r.clicks,r.impressions]),[['/guide',9,90],['/shop',3,30]])
 assert.equal(report.days.find(d=>d.day==='2026-10-18').status,'pending');assert.ok(report.nextSync>T);assert.equal(report.timeZone,'America/Los_Angeles');assert.equal(JSON.stringify(report).includes('private@example.test'),false)
 assert.equal((await source('2025-06-19','2026-10-20')).from,'2025-06-19','any available 16-month source range can be read')
 assert.equal((await op('search.google.sync',{from:'2025-06-19',to:'2026-10-20'})).status,303,'whole source history is fetched as paged date-dimensional ranges')
 const connectedInventory=await(await a.request('/api/vane/inventory?siteId='+id,owner)).json();assert.ok(connectedInventory.fields.some(f=>f.table==='vane_search_connections'));assert.match(connectedInventory.policyText.join(' '),/Google Search Console/);const stored=(await a.dump()).vane_search_connections;assert.equal(stored.length,1);assert.equal(JSON.stringify(stored).includes('fixture-google-refresh'),false,'tokens sealed in storage');const csv=await a.request(`/api/vane/search-console/report?siteId=${id}&from=2026-10-16&to=2026-10-19&format=csv&table=queries`,owner);assert.equal(csv.status,200);assert.match(await csv.text(),/coffee guide,8,80,0.1,2/);assert.ok(Buffer.from(await(await a.request('/api/vane/site-zip?siteId='+id,owner)).arrayBuffer()).includes(Buffer.from('google_search.csv')));
 const statsKey=(await(await a.form({operation:'apikey.create',kind:'stats',label:'Search report',[`site_${id}`]:'on'},a.owner)).text()).match(/data-api-key>(vane_k_[0-9a-f]{64})</)[1];const statsResponse=await a.request(`/api/v1/stats?site_id=${id}&from=2026-10-16&to=2026-10-19&search_query=coffee+guide&search_provider=google&dimension=entry_page&metrics=visitors,visits,pageviews`,{headers:{authorization:'Bearer '+statsKey}});assert.equal(statsResponse.status,200);const stats=await statsResponse.json();assert.deepEqual(stats.results,{visitors:2,visits:2,pageviews:2});assert.equal(stats.breakdown.find(r=>r.value==='/guide').visitors,2);
 const browser=await chromium.launch({headless:true,args:['--use-mock-keychain','--password-store=basic']});t.after(()=>browser.close());const context=await browser.newContext()
 await context.addCookies(a.owner.split('; ').map(pair=>{const [name,...value]=pair.split('=');return {name,value:value.join('='),url:a.origin}}))
 await context.route('**/*',async route=>{const req=route.request(),url=new URL(req.url());if(url.origin!==a.origin)return route.abort();const r=await a.request(url.pathname+url.search,{method:req.method(),headers:req.headers(),body:['GET','HEAD'].includes(req.method())?undefined:req.postDataBuffer()??undefined});await route.fulfill({status:r.status,headers:Object.fromEntries(r.headers),body:Buffer.from(await r.arrayBuffer())})})
 const page=await context.newPage(),screens=process.env.VANE_SCREEN_DIR;if(screens)await mkdir(screens,{recursive:true})
 for(const width of [1440,390]){
  await page.setViewportSize({width,height:960});await page.goto(`${a.origin}/app/sites/${id}?from=2026-10-16&to=2026-10-19`);await page.getByRole('region',{name:'Google search queries',exact:true}).scrollIntoViewIfNeeded();if(screens)await page.screenshot({path:`${screens}/google-report-${width}.png`});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true)
  await page.getByRole('link',{name:'coffee guide',exact:true}).click();await page.waitForURL(/searchQuery=coffee/)
  const selectedCSV=await a.request(`/api/vane/search-console/report?siteId=${id}&from=2026-10-16&to=2026-10-19&searchQuery=coffee+guide&searchProvider=google&format=csv&table=landingPages`,owner);assert.match(await selectedCSV.text(),/coffee guide,.*8,80,0.1,2,2/);const filtered=await(await a.request('/api/vane/summary?siteId='+id+'&'+new URL(page.url()).searchParams,owner)).json();assert.equal(filtered.pageviews,2);assert.equal(filtered.visits,2,'only organic visits landing on the query’s page remain');assert.match(await page.locator('main').innerText(),/Landing pages for coffee guide/);const landing=page.getByRole('region',{name:'Google query landing pages',exact:true});assert.match(await landing.innerText(),/Vane visitors/);assert.match(await landing.locator('tbody tr').first().innerText(),/8\s+80\s+10.0%\s+2\s+2/)
  await landing.scrollIntoViewIfNeeded();if(screens)await page.screenshot({path:`${screens}/google-filter-${width}.png`});await page.getByText('Source page figures',{exact:true}).click();await page.getByRole('region',{name:'Google source pages',exact:true}).scrollIntoViewIfNeeded();if(screens)await page.screenshot({path:`${screens}/google-pages-${width}.png`})
  await page.goto(`${a.origin}/app/sites/${id}?section=settings&from=2026-10-16&to=2026-10-19`);await page.getByRole('heading',{name:'Google Search Console',exact:true}).scrollIntoViewIfNeeded();if(screens)await page.screenshot({path:`${screens}/google-settings-${width}.png`});await page.getByRole('heading',{name:'Data inventory',exact:true}).scrollIntoViewIfNeeded();if(screens)await page.screenshot({path:`${screens}/google-inventory-${width}.png`});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true)
 }
 const beforeCalls=apiCalls;publishedLate=true;await a.clock(T+DAY+1000);await a.scheduled();report=await source();for(const day of ['2026-10-17','2026-10-18'])assert.equal(report.days.find(d=>d.day===day).status,'final');assert.equal(report.queries.find(r=>r.query==='coffee guide').clicks,18);assert.ok(apiCalls>beforeCalls)
 const archive=await a.archive(),rows=archive.payload.tables.vane_search_rows;assert.ok(rows.length);for(const key of ['fixture-google-access','fixture-google-refresh','fixture-google-secret','private@example.test','private-query'])assert.equal(JSON.stringify(archive).includes(key),false,key);assert.equal(archive.payload.tables.vane_search_connections,undefined);assert.equal(archive.payload.tables.vane_search_oauth_states,undefined)
 const restored=await installation();try{assert.equal((await restored.post('/api/vane/restore',{archive},restored.owner)).status,200);const sourceCopy=await(await restored.request(`/api/vane/search-console/report?siteId=${id}&from=2026-10-16&to=2026-10-19`,{headers:{cookie:restored.owner}})).json();assert.equal(sourceCopy.queries.find(r=>r.query==='coffee guide').clicks,18);assert.equal(sourceCopy.connection.status,'disconnected')}finally{await restored.close()}
 await a.clock(T+2*DAY+1000);await a.scheduled();assert.deepEqual((await a.archive()).payload.tables.vane_search_rows,rows,'a finalized source date is filled once, without additive repeats')
 assert.equal((await op('search.google.disconnect')).status,303);assert.equal(revoked,1);assert.equal((await a.dump()).vane_search_connections.length,0);assert.equal((await a.dump()).vane_search_oauth_states.length,0);const count=apiCalls;await a.clock(T+3*DAY+1000);await a.scheduled();assert.equal(apiCalls,count);assert.equal((await source()).connection.status,'disconnected');assert.equal((await source()).queries.find(r=>r.query==='coffee guide').clicks,18,'disconnect retains already fetched history')
 const erased=await a.post('/api/vane/commands',{command:'history.erase',input:{siteId:id}},a.owner);assert.equal(erased.status,201);assert.equal((await a.form({operation:'proposal.approve',id:(await erased.json()).id},a.owner)).status,303);const restarted=await op('search.google.begin'),newState=new URL(restarted.headers.get('location')).searchParams.get('state');assert.equal((await a.request('/api/vane/search-console/callback?'+new URLSearchParams({state:newState,code:'fixture-code'}),owner)).status,303);assert.equal((await op('search.google.property',{property:'https://fern.example/'})).status,303);assert.equal((await source()).queries.length,0,'a new sync cannot resurrect erased source dates');
 assert.ok(tokenCalls>=2,'the daily sync refreshes expiring OAuth access without exposing the refresh token')
})

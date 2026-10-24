import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdir } from 'node:fs/promises'
import { chromium } from '@playwright/test'
import { installation } from './harness.mjs'

const T=Date.parse('2026-10-19T12:00:00Z'),DAY=86400000

test('SEARCH-002 verified Bing connection, source keyword/page figures beside Google, organic landing filter, private credentials and scoped public doors',async t=>{
 const a=await installation({vars:{GOOGLE_CLIENT_ID:'fixture-google-client',GOOGLE_CLIENT_SECRET:'fixture-google-secret'}});t.after(()=>a.close())
 const id=await a.addSite({paths:[],goals:{},retainForever:true}),other=await a.addSite({origin:'https://other.example',paths:[],goals:{}})
 const owner={headers:{cookie:a.owner}},apiKey='synthetic-vane-1',property='https://fern.example/'
 await a.clock(Date.parse('2026-10-16T12:00:00Z'))
 for(const [i,path,source] of [[1,'/guide','bing.com'],[2,'/guide','bing.com'],[3,'/shop','bing.com'],[4,'/guide','direct']]){
  const response=await a.post('/api/vane/collect',a.event(id,{path,source}),'',{origin:'https://fern.example','cf-connecting-ip':`198.51.100.${i}`})
  assert.equal(response.status,202)
 }
 await a.clock(T)
 let providerCalls=0,refuse=false,olderWindow=true
 const date='/Date('+Date.parse('2026-10-16T07:00:00Z')+'-0700)/'
 const row=(Query,Clicks,Impressions,AvgImpressionPosition)=>({Date:date,Query,Clicks,Impressions,AvgImpressionPosition,AvgClickPosition:AvgImpressionPosition+1})
 a.fixtureSites['https://ssl.bing.com']=async request=>{
  providerCalls++;const url=new URL(request.url)
  assert.ok(url.searchParams.get('apikey')===apiKey,'Bing uses its documented API-key query protocol')
  assert.equal(request.method,'GET')
  const method=url.pathname.split('/').at(-1)
  assert.ok(url.pathname.startsWith('/webmaster/api.svc/json/'),'only documented Bing JSON endpoints receive the credential')
  if(method==='GetUserSites')return Response.json({d:[{Url:property,IsVerified:true},{Url:'https://fern.example/not-verified/',IsVerified:false},{Url:'https://fern.example/alternate/',IsVerified:true}]})
  assert.equal(url.searchParams.get('siteUrl'),property)
  if(refuse&&method==='GetQueryStats')return new Response('',{status:503})
  if(method==='GetQueryStats')return Response.json({d:[row('coffee guide',8,80,2),row('buy beans',2,20,4),row('private@example.test',2,20,3),...(olderWindow?[{...row('aged phrase',3,30,5),Date:'/Date('+Date.parse('2026-10-09T07:00:00Z')+'-0700)/'}]:[])]})
  if(method==='GetPageStats')return Response.json({d:[row(property+'guide',9,90,2.2),row(property+'shop',3,30,4)]})
  if(method==='GetRankAndTrafficStats')return Response.json({d:[{Date:date,Clicks:12,Impressions:120}]})
  if(method==='GetPageQueryStats'){
   const page=JSON.parse(url.searchParams.get('page'))
   if(page===property+'guide')return Response.json({d:[row('coffee guide',8,80,2),row('private@example.test',1,10,3)]})
   if(page===property+'shop')return Response.json({d:[row('buy beans',2,20,4)]})
   assert.fail('Bing page-query calls must use a page returned by GetPageStats')
  }
  assert.fail('unexpected Bing provider method')
 }
 const op=(operation,extra={},cookie=a.owner)=>a.form({operation,siteId:id,...extra},cookie)
 const reportURL=(from='2026-10-16',to='2026-10-19')=>'/api/vane/bing/report?'+new URLSearchParams({siteId:id,from,to})
 const source=async(from='2026-10-16',to='2026-10-19',cookie=a.owner)=>{
  const response=await a.request(reportURL(from,to),{headers:{cookie}});assert.equal(response.status,200);return response.json()
 }
 assert.equal((await a.request(reportURL())).status,401)
 assert.equal((await a.post('/app/action',{operation:'search.bing.connect',siteId:id,property,apiKey})).status,401)
 assert.equal((await a.post('/app/action',{operation:'search.bing.connect',siteId:id,property,apiKey},a.owner,{origin:'https://foreign.example'})).status,403)
 const member=await a.invite('bing-reader@example.test','member')
 for(const operation of ['search.bing.connect','search.bing.sync','search.bing.disconnect'])assert.equal((await op(operation,{property,apiKey},member)).status,403)
 assert.equal((await a.form({operation:'team.invite',email:'bing-scoped@example.test',role:'viewer',scope:'selected',['site_'+other]:'on'},a.owner)).status,303)
 const scoped=await a.accept('bing-scoped@example.test')
 assert.equal((await a.request(reportURL(),{headers:{cookie:scoped}})).status,403)
 assert.equal(providerCalls,0,'refused public-door requests cannot reach Bing')
 assert.equal((await op('search.bing.connect',{property:'https://fern.example/not-verified/',apiKey})).status,400,'a returned but unverified property cannot connect')
 a.fixtureSites['https://oauth2.googleapis.com']=()=>Response.json({access_token:'synthetic-vane-2',refresh_token:'synthetic-vane-3',expires_in:3600,token_type:'Bearer',scope:'https://www.googleapis.com/auth/webmasters.readonly'});
 a.fixtureSites['https://www.googleapis.com']=async request=>{const url=new URL(request.url);if(url.pathname==='/webmasters/v3/sites')return Response.json({siteEntry:[{siteUrl:property,permissionLevel:'siteOwner'}]});const q=await request.json(),keys=q.dimensions.map(key=>key==='date'?'2026-10-16':key==='query'?'pour over':property+'shop');return Response.json({rows:[{keys,clicks:4,impressions:40,ctr:0.1,position:6}]})};
 const googleBegin=await op('search.google.begin'),googleState=new URL(googleBegin.headers.get('location')).searchParams.get('state');assert.equal((await a.request('/api/vane/search-console/callback?'+new URLSearchParams({state:googleState,code:'fixture-code'}),owner)).status,303);assert.equal((await op('search.google.property',{property})).status,303);
 assert.equal((await op('search.bing.connect',{property,apiKey})).status,303)
 let report=await source()
 assert.deepEqual(report.queries.find(value=>value.query==='coffee guide'),{query:'coffee guide',clicks:8,impressions:80,ctr:0.1,position:2})
 const guide=report.pages.find(value=>value.page==='/guide');assert.equal(guide.clicks,9);assert.equal(guide.impressions,90);assert.equal(guide.ctr,0.1);assert.ok(Math.abs(guide.position-2.2)<1e-12)
 const landing=report.queryPages.find(value=>value.query==='coffee guide'&&value.page==='/guide');assert.equal(landing.clicks,8);assert.equal(landing.impressions,80);assert.equal(landing.position,2)
 assert.deepEqual(report.dates,[{date:'2026-10-16',clicks:12,impressions:120,ctr:0.1,position:null}])
 assert.ok(report.connection.connected);assert.ok(report.connection.nextSyncAt>T);assert.match(report.metadata.date,/weekly/i)
 assert.equal(JSON.stringify(report).includes('private@example.test'),false,'source query labels follow the existing privacy policy')
 assert.equal((await source('2026-10-15','2026-10-16')).queries.length,0,'the report end date is exclusive')
 assert.equal((await a.request(reportURL('2026-10-16','2026-10-16'),owner)).status,400)
 assert.equal((await source('2026-10-16','2026-10-19',member)).queries.find(value=>value.query==='coffee guide').clicks,8,'a site reader can read aggregate source data')
 const stored=(await a.dump()).vane_bing_connections
 assert.equal(stored.length,1);assert.ok(typeof stored[0].sealed_key==='string'&&stored[0].sealed_key.length>0,'the connection stores a sealed credential')
 assert.ok(!JSON.stringify(stored).includes(apiKey),'the API key is absent in plaintext storage')
 const csv=await a.request(reportURL()+'&format=csv&table=queries',owner);assert.equal(csv.status,200);assert.match(await csv.text(),/coffee guide,8,80,0.1,2/)
 const archive=await a.archive();assert.ok(archive.payload.tables.vane_bing_rows.some(value=>value.kind==='query'&&value.query==='coffee guide'))
 assert.equal(archive.payload.tables.vane_bing_connections,undefined)
 for(const text of [JSON.stringify(report),JSON.stringify(archive),await(await a.request(`/app/sites/${id}?section=settings`,owner)).text()])assert.ok(!text.includes(apiKey),'reports, settings and archives must not expose the API key')

 assert.ok(Buffer.from(await(await a.request('/api/vane/site-zip?siteId='+id,owner)).arrayBuffer()).includes(Buffer.from('bing_search.csv')));const currentInventory=await(await a.request('/api/vane/inventory?siteId='+id,owner)).json();assert.ok(currentInventory.fields.some(f=>f.table==='vane_bing_rows'));assert.match(currentInventory.policyText.join(' '),/Bing Webmaster Tools/);
 const browser=await chromium.launch({headless:true,args:['--use-mock-keychain','--password-store=basic']});t.after(()=>browser.close())
 const context=await browser.newContext()
 await context.addCookies(a.owner.split('; ').map(pair=>{const [name,...value]=pair.split('=');return {name,value:value.join('='),url:a.origin}}))
 await context.route('**/*',async route=>{
  const req=route.request(),url=new URL(req.url());if(url.origin!==a.origin)return route.abort()
  const response=await a.request(url.pathname+url.search,{method:req.method(),headers:req.headers(),body:['GET','HEAD'].includes(req.method())?undefined:req.postDataBuffer()??undefined})
  await route.fulfill({status:response.status,headers:Object.fromEntries(response.headers),body:Buffer.from(await response.arrayBuffer())})
 })
 const page=await context.newPage(),screens=process.env.VANE_SCREEN_DIR;if(screens)await mkdir(screens,{recursive:true})
 for(const width of [1440,390]){
  await page.setViewportSize({width,height:960});await page.goto(`${a.origin}/app/sites/${id}?from=2026-10-16&to=2026-10-19`)
  await page.getByRole('heading',{name:'Google search keywords',exact:true}).waitFor();assert.match(await page.getByRole('region',{name:'Google search queries',exact:true}).innerText(),/pour over\s+4\s+40\s+10.0%\s+6/)
  await page.getByRole('region',{name:'Bing search queries',exact:true}).scrollIntoViewIfNeeded()
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true)
  if(screens)await page.screenshot({path:`${screens}/bing-report-${width}.png`})
  await page.getByRole('link',{name:'coffee guide',exact:true}).click();await page.waitForURL(/searchQuery=coffee/)
  const filtered=await(await a.request('/api/vane/summary?siteId='+id+'&'+new URL(page.url()).searchParams,owner)).json()
  assert.equal(filtered.pageviews,2);assert.equal(filtered.visits,2,'the Bing keyword selects organic visits landing on its source page, excluding direct and other landing pages')
  assert.match(await page.locator('main').innerText(),/Landing pages for coffee guide/)
  await page.getByRole('region',{name:'Bing query landing pages',exact:true}).scrollIntoViewIfNeeded();if(screens)await page.screenshot({path:`${screens}/bing-filter-${width}.png`})
  await page.goto(`${a.origin}/app/sites/${id}?section=settings&from=2026-10-16&to=2026-10-19`)
  await page.getByRole('heading',{name:'Bing Webmaster Tools',exact:true}).scrollIntoViewIfNeeded()
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true)
  if(screens)await page.screenshot({path:`${screens}/bing-settings-${width}.png`});await page.getByRole('heading',{name:'Data inventory',exact:true}).scrollIntoViewIfNeeded();if(screens)await page.screenshot({path:`${screens}/bing-inventory-${width}.png`})
 }
 refuse=true;assert.equal((await op('search.bing.sync')).status,502)
 report=await source();assert.match(report.connection.error,/503/);assert.equal(report.queries.find(value=>value.query==='coffee guide').clicks,8,'a provider failure retains successful data, never fabricated zero')
 assert.ok(!JSON.stringify(report).includes(apiKey),'provider errors must not echo credential-bearing URLs')
 refuse=false;olderWindow=false;await a.clock(report.connection.nextSyncAt+1);await a.scheduled();report=await source()
 assert.equal(report.connection.error,null);assert.equal(report.queries.find(value=>value.query==='coffee guide').clicks,8,'repeated source dates replace their snapshot rather than adding counts')
 assert.equal((await op('search.bing.disconnect')).status,303)
 assert.equal((await a.dump()).vane_bing_connections.length,0,'disconnect deletes the actual sealed credential record')
 const calls=providerCalls;await a.clock(T+2*DAY+1000);await a.scheduled();assert.equal(providerCalls,calls,'disconnected sites stop making provider requests')
 assert.equal((await op('search.bing.connect',{property:'https://fern.example/alternate/',apiKey})).status,409);assert.equal((await op('search.bing.connect',{property,apiKey})).status,303);assert.equal((await source('2026-10-09','2026-10-10')).queries.find(r=>r.query==='aged phrase').clicks,3,'same-property reconnect retains older fetched source history');assert.equal((await op('search.bing.disconnect')).status,303);
 report=await source();assert.equal(report.connection.connected,false);assert.equal(report.queries.find(value=>value.query==='coffee guide').clicks,8,'disconnect retains fetched aggregate history')
})

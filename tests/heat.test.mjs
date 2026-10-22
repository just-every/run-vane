import test from 'node:test'
import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { assert, withApp, DESKTOP_CHROME } from './vane-helpers.mjs'

test('HEAT-001 real clicks aggregate at two buttons without text or identifiers; scroll reach is METRIC-006 and owner tab capture is local',async t=>{
 const a=await withApp(t),id=await a.addSite(),owner={headers:{cookie:a.owner}}
 const configure=(enabled,cookie=a.owner)=>a.post('/api/vane/heat-settings',{siteId:id,path:'/',enabled},cookie)
 const report=async width=>{const r=await a.request(`/api/vane/heat?siteId=${id}&path=%2F&from=2026-03-06&to=2026-03-07&width=${width}`,owner);assert.equal(r.status,200,await r.clone().text());return r.json()}
 const origin='https://fern.example',headers={origin,'user-agent':DESKTOP_CHROME},click={siteId:id,path:'/',kind:'click',x:4,y:2,width:1440,consent:'not-required'}
 const config=async()=>{const r=await a.request('/api/vane/config/'+id,{headers:{origin}});assert.equal(r.status,200);return r.json()}
 assert.equal(Object.hasOwn(await config(),'heatPaths'),false)
 assert.equal((await a.post('/api/vane/heat-click',click,'',headers)).status,403,'deny by default')
 assert.equal((await configure(true,'')).status,401)
 assert.equal((await a.request('/api/vane/heat?siteId='+id)).status,401)
 const admin=await a.invite('synthetic-vane-1@example.test','admin')
 assert.equal((await configure(true,admin)).status,403,'only the owner enables a page')
 assert.equal((await a.request('/api/vane/heat?siteId='+id,{headers:{cookie:admin}})).status,403,'heatmaps are owner-only')
 assert.equal((await configure(true)).status,200)
 assert.deepEqual((await config()).heatPaths,['/'])
 assert.equal((await config()).heatCaptureOrigin,a.origin)
 for(const extra of [{id:'synthetic-vane-2'},{text:'synthetic-vane-3'},{selector:'#synthetic-vane-4'},{value:'synthetic-vane-5'}])assert.equal((await a.post('/api/vane/heat-click',{...click,...extra},'',headers)).status,400)
 for(const extra of [{origin:'https://other.example'},{dnt:'1'},{'sec-gpc':'1'},{'user-agent':'Googlebot/2.1'}])assert.equal((await a.post('/api/vane/heat-click',click,'',{...headers,...extra})).status,403)
 assert.equal((await a.post('/api/vane/heat-click',{...click,path:'/thanks'},'',headers)).status,403)
 const html=`<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><title>synthetic-vane-heat-target</title><style>body{margin:0;background:#fff7e8;color:#18252a;font:18px system-ui}main{height:4000px}header{padding:24px}nav{display:flex;justify-content:space-around;padding:24px 0}button{font:inherit;width:130px;height:60px;background:#1c4543;color:white;border:0;border-radius:8px}form{padding:24px}input{max-width:85%}section{padding:24px;margin-top:600px}</style></head><body><main><header><h1>Fern Studio</h1><p>A long page with two places to click.</p></header><nav><button id="left">synthetic-vane-left</button><button id="right">synthetic-vane-right</button></nav><form><input aria-label="Private note" value="synthetic-vane-private-form"></form><section><h2>Further down</h2><p>The same maximum scroll depth feeds the page report and scroll map.</p></section></main><script src="${a.origin}/vane.js" data-site="${id}"></script></body></html>`
 const {chromium}=await import('@playwright/test')
 // Real native tab capture, when explicitly requested for the screenshot proof.
 // These flags select the real fixture tab in Chromium's permission picker; no fake device or media is used.
 // browser.newContext() is required by the home rules. Chromium blocks cross-tab
 // Capture Handles in this private context; strict capture remains a real assertion,
 // not a fake handle or a downgraded screenshot proof. An ordinary-context exception
 // is needed before that acceptance can pass (capture_handle_manager.cc).
 const capture=process.env.VANE_HEAT_CAPTURE==='1',browser=await chromium.launch({headless:true,...(capture?{channel:'chromium'}:{}),args:['--use-mock-keychain','--password-store=basic',...(capture?['--enable-usermedia-screen-capturing','--auto-select-tab-capture-source-by-title=synthetic-vane-heat-target']:[])]});t.after(()=>browser.close())
 const context=await browser.newContext({userAgent:DESKTOP_CHROME,viewport:{width:1440,height:900}}),bodies=[]
 await context.addCookies(a.owner.split('; ').map(pair=>{const index=pair.indexOf('=');return {name:pair.slice(0,index),value:pair.slice(index+1),url:a.origin}}))
 await context.route('**/*',async route=>{
  const request=route.request(),url=new URL(request.url())
  if(url.origin===origin&&url.pathname==='/')return route.fulfill({contentType:'text/html',body:html})
  if(url.origin!==a.origin)return route.abort()
  if(url.pathname==='/api/vane/heat-click'&&request.method()==='POST')bodies.push(JSON.parse(request.postData()))
  const r=await a.request(url.pathname+url.search,{method:request.method(),headers:request.headers(),body:request.postData()??undefined})
  return route.fulfill({status:r.status,headers:Object.fromEntries(r.headers),body:Buffer.from(await r.arrayBuffer())})
 })
 const target=await context.newPage(),morning=Date.parse('2026-03-06T10:00:00Z');await target.clock.install({time:morning})
 const answered=path=>target.waitForResponse(r=>new URL(r.url()).pathname===path&&r.request().method()==='POST')
 const screenDir=process.env.VANE_SCREEN_DIR;if(screenDir)await mkdir(screenDir,{recursive:true})
 for(const [index,width] of [1440,390].entries()){
  await target.setViewportSize({width,height:900})
  for(const [visit,share] of [.5,1].entries()){
   const time=morning+(index*2+visit)*7200000;await a.clock(time);await target.clock.setSystemTime(time)
   let sent=answered('/api/vane/collect');await target.goto(origin+'/');assert.equal((await sent).status(),202)
   for(const [button,count] of [['left',3],['right',2]])for(let n=0;n<count;n++){sent=answered('/api/vane/heat-click');await target.locator('#'+button).click();assert.equal((await sent).status(),202)}
   await target.evaluate(share=>scrollTo(0,document.documentElement.scrollHeight*share-innerHeight),share)
   await a.clock(time+11000);sent=answered('/api/vane/engage');await target.clock.fastForward(10000);assert.equal((await sent).status(),202)
  }
  const map=await report(width);assert.equal(map.clicks,10);assert.deepEqual(map.cells.map(c=>c.count).sort((a,b)=>a-b),[4,6]);assert.deepEqual([map.scroll.averageScrollDepth,map.scroll.reached75Share],[75,50])
  const summary=await (await a.request(`/api/vane/summary?siteId=${id}&from=2026-03-06&to=2026-03-07`,owner)).json()
  assert.deepEqual([map.scroll.averageScrollDepth,map.scroll.reached75Share],[summary.topPages[0].averageScrollDepth,summary.topPages[0].reached75Share])
  const expected=await target.evaluate(()=>['left','right'].map(id=>{const b=document.getElementById(id).getBoundingClientRect(),d=document.documentElement;return {x:Math.floor((b.x+b.width/2+scrollX)/d.scrollWidth*40),y:Math.floor((b.y+b.height/2+scrollY)/d.scrollHeight*100)}}))
  assert.deepEqual(map.cells.map(c=>({x:c.x,y:c.y})),expected,'the two hottest grid cells are on the real buttons')
  await target.evaluate(()=>scrollTo(0,0));await target.clock.runFor(200)
  if(screenDir)await target.screenshot({path:join(screenDir,`heat-fixture-${width}.png`)})
  const page=await context.newPage();await page.setViewportSize({width,height:900});await page.goto(`${a.origin}/app/sites/${id}?section=heat&heatPath=%2F&heatWidth=${width}&from=2026-03-06&to=2026-03-07`)
  assert.equal(await page.locator('[data-heat-average]').textContent(),'75%');assert.equal(await page.locator('[data-heat-deep]').textContent(),'50%')
  assert.equal(await page.locator('[data-heat-empty]').isVisible(),true,'a screenshot is never invented')
  if(capture){
   await page.getByRole('button',{name:'Capture live page'}).click()
   await page.waitForFunction(()=>!document.querySelector('[data-heat-capture]').disabled,{},{timeout:25000})
   const captureStatus=await page.locator('[data-heat-status]').textContent()
   if(!captureStatus.startsWith('Live screenshot captured locally')){assert.equal(await page.locator('[data-heat-click] image').count(),0,'an unverified tab never becomes a screenshot');t.diagnostic('Strict native capture did not succeed. Chromium suppresses cross-tab Capture Handles in browser.newContext(); the home rules require this context and prohibit launchPersistentContext. No handle or stream was substituted.')}
   assert.match(captureStatus,/Live screenshot captured locally/)
   assert.equal(await page.locator('[data-heat-click] image').count(),1)
   assert.equal(await page.locator('[data-heat-click] rect').count(),2)
   assert.equal(await page.locator('[data-heat-scroll] image').count(),1)
  }else t.diagnostic('Native live-screenshot proof NOT RUN: Chromium blocks cross-tab Capture Handles in the home-required browser.newContext(). An owner-approved ordinary-context proof is pending. VANE_HEAT_CAPTURE=1 keeps the strict real-stream assertion; aggregate/table screenshots do not prove capture.')
  if(screenDir)await page.screenshot({path:join(screenDir,`heat-${width}.png`),fullPage:true})
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,'no horizontal overflow')
  await page.close()
 }
 assert.equal(bodies.length,20);for(const body of bodies)assert.deepEqual(Object.keys(body).sort(),['consent','kind','path','siteId','width','x','y'])
 const dump=await a.dump();assert.equal(dump.vane_heat_clicks.length,4)
 for(const row of dump.vane_heat_clicks)assert.deepEqual(Object.keys(row).sort(),['count','day','path','site_id','width','x','y'])
 for(const marker of ['synthetic-vane-left','synthetic-vane-right','synthetic-vane-private-form'])assert.equal(JSON.stringify(dump).includes(marker),false,marker+' never enters custody')
 assert.ok(dump.vane_audit.some(row=>row.action==='heat.configure'))
 assert.equal((await configure(false)).status,200)
 assert.equal(Object.hasOwn(await config(),'heatPaths'),false)
 assert.equal((await a.post('/api/vane/heat-click',click,'',headers)).status,403,'disabling takes effect server-side')
 assert.equal((await report(1440)).clicks,10,'disabling preserves existing history')
 await context.close()
})

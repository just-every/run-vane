import test from 'node:test'
import { assert, readFile, createHash, createHmac, crc32, createRequire, installation, appsScript, fixture, unlinked, withApp, DESKTOP_CHROME, browse, movein } from './vane-helpers.mjs'

test('MOBILE-001 at 390 and 1440 px the site, approval, report, filter and alert journeys complete by keyboard, every page passing an automated WCAG 2.2 AA scan with no horizontal scroll',async t=>{
 const a=await withApp(t),axe=await readFile(createRequire(import.meta.url).resolve('axe-core'),'utf8'),{context}=await browse(t,a)
 await context.addCookies(a.owner.split('; ').map(pair=>{const [name,...value]=pair.split('=');return {name,value:value.join('='),url:a.origin}}))
 // Playwright does not route the request that follows a fulfilled redirect, so a form's 303 is followed as a navigation.
 await context.route(a.origin+'/app/action',async route=>{const request=route.request(),response=await a.request('/app/action',{method:'POST',headers:request.headers(),body:request.postData()??undefined}),location=response.headers.get('location');if(response.status!==303||!location)return route.fulfill({status:response.status,headers:Object.fromEntries(response.headers),body:Buffer.from(await response.arrayBuffer())});return route.fulfill({status:200,contentType:'text/html',body:`<!doctype html><title>Redirecting</title><meta http-equiv="refresh" content="0;url=${location.replaceAll('&','&amp;').replaceAll('"','&quot;')}">`})})
 const page=await context.newPage()
 // Keyboard only: Tab moves focus until it reaches the control, then keys type into it and Enter submits.
 const tabTo=async selector=>{for(let i=0;i<400;i++){await page.keyboard.press('Tab');if(await page.evaluate(s=>document.activeElement?.matches(s)??false,selector))return}assert.fail('Tab never reached '+selector)}
 const submit=async url=>{await Promise.all([page.waitForURL(url),page.keyboard.press('Enter')]);await page.waitForLoadState()}
 // The scan runs axe-core in the page (the page's own CSP stays on) for WCAG 2.0-2.2 A and AA.
 const scanned=async label=>{
  const violations=await page.evaluate(`${axe}\n;axe.run(document,{runOnly:{type:'tag',values:['wcag2a','wcag2aa','wcag21a','wcag21aa','wcag22aa']}}).then(r=>r.violations.map(v=>v.id+': '+v.nodes.map(n=>n.target.join(' ')).join(', ')))`)
  assert.deepEqual(violations,[],label);assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),`${label} scrolls sideways`)
 }
 for(const width of [390,1440]){
  await page.setViewportSize({width,height:900});const origin=`https://fern${width}.example`
  // Site: the Add a site form, then its approval.
  await page.goto(a.origin+'/app');await scanned(`${width} sites`)
  await tabTo('input[name="name"]');await page.keyboard.type(`Fern ${width}`);await tabTo('input[name="origin"]');await page.keyboard.type(origin);await submit(/section=approvals/)
  await scanned(`${width} approvals`)
  await tabTo('form:has(input[value="proposal.approve"]) button[type="submit"]');await submit(/\/app\/sites\/[\w-]+\?/)
  const id=(await a.dump()).vane_sites.find(s=>s.name===`Fern ${width}`)?.id;assert.ok(id,'the approved site exists')
  for(const path of ['/','/pricing','/thanks'])assert.equal((await a.collect(a.event(id,{path,consent:'granted'}),origin)).status,202)
  // Report: change the range from the keyboard.
  await page.goto(`${a.origin}/app/sites/${id}?section=report`);await scanned(`${width} report`)
  await tabTo('select[name="period"]');await page.keyboard.type('Last 30');assert.equal(await page.evaluate(()=>document.activeElement.value),'30d')
  await tabTo('form:has(select[name="period"]) button[type="submit"]');await submit(/period=30d/);await scanned(`${width} report, last 30 days`)
  // Filter: Page is /thanks.
  await tabTo('select[name="filterDimension"]');await page.keyboard.type('Page');assert.equal(await page.evaluate(()=>document.activeElement.value),'page')
  await tabTo('input[name="filterValue"]');await page.keyboard.type('/thanks');await submit(/filterValue=%2Fthanks|filter=page/)
  assert.match(await page.locator('[data-active-filters]').textContent(),/\/thanks/);await scanned(`${width} filtered report`)
  // Alert (ALERT-001): a traffic alert set from the keyboard on the site's settings.
  await page.goto(`${a.origin}/app/sites/${id}?section=settings`)
  await tabTo('select[name="metric"]');await page.keyboard.type('Current');assert.equal(await page.evaluate(()=>document.activeElement.value),'current')
  await tabTo('input[name="threshold"]');await page.keyboard.type('50');await submit(/notice=Alert\+added/)
  assert.match(await page.locator('[data-alerts]').textContent(),/Current visitors above 50/);await scanned(`${width} alerts`)
  for(const section of ['settings','history','realtime']){await page.goto(`${a.origin}/app/sites/${id}?section=${section}`);await scanned(`${width} ${section}`)}
  for(const section of ['team','api','audit']){await page.goto(`${a.origin}/app?section=${section}`);await scanned(`${width} ${section}`)}
  // Every chart has a data table: the report and real-time charts in their details, each site's sparkline in its row.
  for(const path of [`/app/sites/${id}?section=report`,`/app/sites/${id}?section=realtime`,'/app']){await page.goto(a.origin+path)
   const charts=await page.evaluate(()=>[...document.querySelectorAll('svg.vane-chart,svg.vane-sparkline')].map(svg=>{const table=svg.closest('figure,li')?.querySelector('table')??svg.closest('section')?.querySelector('table');return table?table.querySelectorAll('tbody tr').length:0}))
   assert.ok(charts.length&&charts.every(n=>n>0),`${width} ${path}: every chart has a data table with rows`)}
 }
 await context.close()
})
test('MOBILE-001 the app installs as a PWA, a browser that turns on alerts receives an encrypted test alert and a real traffic alert carrying only its title, site and link that the service worker shows, and turning off, a 410 and removal from the team forget the browser',async t=>{
 const a=await withApp(t),id=await a.addSite(),axe=await readFile(createRequire(import.meta.url).resolve('axe-core'),'utf8'),{context}=await browse(t,a)
 await context.addCookies(a.owner.split('; ').map(pair=>{const [name,...value]=pair.split('=');return {name,value:value.join('='),url:a.origin}}))
 await context.route(a.origin+'/app/action',async route=>{const request=route.request(),response=await a.request('/app/action',{method:'POST',headers:request.headers(),body:request.postData()??undefined}),location=response.headers.get('location');if(response.status!==303||!location)return route.fulfill({status:response.status,headers:Object.fromEntries(response.headers),body:Buffer.from(await response.arrayBuffer())});return route.fulfill({status:200,contentType:'text/html',body:`<!doctype html><title>Redirecting</title><meta http-equiv="refresh" content="0;url=${location.replaceAll('&','&amp;').replaceAll('"','&quot;')}">`})})
 const page=await context.newPage(),cdp=await context.newCDPSession(page)
 const scanned=async label=>{const violations=await page.evaluate(`${axe}\n;axe.run(document,{runOnly:{type:'tag',values:['wcag2a','wcag2aa','wcag21a','wcag21aa','wcag22aa']}}).then(r=>r.violations.map(v=>v.id+': '+v.nodes.map(n=>n.target.join(' ')).join(', ')))`);assert.deepEqual(violations,[],label);assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),`${label} scrolls sideways`)}
 await page.goto(a.origin+'/app?section=alerts')
 // Installable: Chrome finds the manifest's name, start URL, standalone display and icons.
 assert.deepEqual((await cdp.send('Page.getInstallabilityErrors')).installabilityErrors,[])
 // Turning alerts on registers the service worker; the test then stands in for the browser's push service.
 await page.getByRole('button',{name:'Turn on alerts in this browser'}).click()
 let active=false;for(let i=0;i<100&&!active;i++){active=await page.evaluate(async()=>Boolean((await navigator.serviceWorker.getRegistration('/'))?.active));if(!active)await page.waitForTimeout(100)}
 assert.ok(active,'the service worker is installed and active')
 const {createECDH,createDecipheriv,createPublicKey,randomBytes,verify}=await import('node:crypto')
 const browser=createECDH('prime256v1');browser.generateKeys()
 const b64url=b=>Buffer.from(b).toString('base64url'),auth=randomBytes(16),key=await page.getAttribute('[data-push]','data-key')
 const subscription=endpoint=>({endpoint,keys:{p256dh:b64url(browser.getPublicKey()),auth:b64url(auth)}})
 const subscribe=(endpoint,cookie=a.owner)=>a.post('/api/vane/push/subscribe',subscription(endpoint),cookie)
 assert.equal((await subscribe('https://push.example/send/browser-1')).status,201)
 assert.equal((await subscribe('http://127.0.0.1:9/send')).status,400,'a private or plain-http endpoint is refused')
 const delivered=[];let answer=201
 a.fixtureSites['https://push.example']=async request=>{delivered.push({url:request.url,headers:Object.fromEntries(request.headers),body:Buffer.from(await request.arrayBuffer())});return new Response(null,{status:answer})}
 // RFC 8291: the browser's key and auth secret decrypt the aes128gcm record; RFC 8292: the VAPID JWT verifies with the installation's key.
 const hmac=(k,d)=>createHmac('sha256',k).update(d).digest()
 const decrypt=body=>{const salt=body.subarray(0,16),idlen=body[20],sender=body.subarray(21,21+idlen),sealed=body.subarray(21+idlen),shared=browser.computeSecret(sender)
  const ikm=hmac(hmac(auth,shared),Buffer.concat([Buffer.from('WebPush: info\0'),browser.getPublicKey(),sender,Buffer.from([1])])),prk=hmac(salt,ikm)
  const decipher=createDecipheriv('aes-128-gcm',hmac(prk,Buffer.from('Content-Encoding: aes128gcm\0\x01')).subarray(0,16),hmac(prk,Buffer.from('Content-Encoding: nonce\0\x01')).subarray(0,12));decipher.setAuthTag(sealed.subarray(-16))
  const plain=Buffer.concat([decipher.update(sealed.subarray(0,-16)),decipher.final()]);assert.equal(plain.at(-1),2,'one final record');return plain.subarray(0,-1).toString()}
 for(const width of [390,1440]){await page.setViewportSize({width,height:900});await page.goto(a.origin+'/app?section=alerts');await scanned(`${width} browser alerts`)}
 await page.getByRole('button',{name:'Send a test alert'}).press('Enter');await page.waitForURL(/notice=Test\+alert\+sent/)
 assert.equal(delivered.length,1);const [sent]=delivered
 assert.equal(sent.headers['content-encoding'],'aes128gcm');const [,jwt,k]=sent.headers.authorization.match(/^vapid t=([^,]+), k=(.+)$/);assert.equal(k,key)
 const [head,claims,signature]=jwt.split('.'),raw=Buffer.from(k,'base64url'),publicKey=createPublicKey({key:{kty:'EC',crv:'P-256',x:b64url(raw.subarray(1,33)),y:b64url(raw.subarray(33,65))},format:'jwk'})
 assert.ok(verify('sha256',Buffer.from(`${head}.${claims}`),{key:publicKey,dsaEncoding:'ieee-p1363'},Buffer.from(signature,'base64url')),'the VAPID JWT is signed with the installation key')
 assert.equal(JSON.parse(Buffer.from(claims,'base64url')).aud,'https://push.example')
 const alert=JSON.parse(decrypt(sent.body));assert.deepEqual(alert,{title:'Test alert',site:'Fern Studio',link:`${a.origin}/app/sites/${id}`},'only the title, site name and link')
 // The installed service worker shows the delivered alert as a notification.
 await cdp.send('ServiceWorker.enable');const registration=await Promise.race([new Promise(resolve=>{cdp.on('ServiceWorker.workerRegistrationUpdated',({registrations})=>{const r=registrations.find(r=>r.scopeURL===a.origin+'/'&&!r.isDeleted);if(r)resolve(r)})}),new Promise((_,reject)=>setTimeout(()=>reject(new Error('no service worker registration reported')),10000))])
 // The headless browser has no notification centre, so the worker's showNotification is recorded instead (the OS edge).
 const worker=context.serviceWorkers().find(w=>w.url()===a.origin+'/vane-sw.js');await worker.evaluate(()=>{self.shown=[];self.registration.showNotification=(title,options)=>{self.shown.push([title,options.body,options.data.link]);return Promise.resolve()}})
 await cdp.send('ServiceWorker.deliverPushMessage',{origin:a.origin,registrationId:registration.registrationId,data:decrypt(sent.body)})
 let notifications=[];for(let i=0;i<50&&!notifications.length;i++){notifications=await worker.evaluate(()=>self.shown);if(!notifications.length)await page.waitForTimeout(100)}
 assert.deepEqual(notifications,[['Test alert','Fern Studio',`${a.origin}/app/sites/${id}`]])
 // A real traffic alert (ALERT-001) reaches the same browser: current visitors above 0, seen by the 5-minute cron.
 assert.equal((await a.form({operation:'alert.create',siteId:id,metric:'current',direction:'above',threshold:'0',cooldown:'6'},a.owner)).status,303)
 assert.equal((await a.post('/api/vane/collect',a.event(id,{path:'/'}),'',{origin:'https://fern.example','cf-connecting-ip':'203.0.113.9','user-agent':DESKTOP_CHROME})).status,202)
 await a.scheduled();assert.equal(delivered.length,2,'the alert is pushed once')
 const fired=decrypt(delivered[1].body),link=`${a.origin}/app/sites/${id}?section=realtime`;assert.deepEqual(JSON.parse(fired),{title:'Current visitors above 0',site:'Fern Studio',link})
 await cdp.send('ServiceWorker.deliverPushMessage',{origin:a.origin,registrationId:registration.registrationId,data:fired})
 for(let i=0;i<50&&notifications.length<2;i++){notifications=await worker.evaluate(()=>self.shown);if(notifications.length<2)await page.waitForTimeout(100)}
 assert.deepEqual(notifications[1],['Current visitors above 0','Fern Studio',link])
 // A push service's 410 forgets the subscription; turning off forgets it too; both are audited.
 answer=410;await page.goto(a.origin+'/app?section=alerts');await page.getByRole('button',{name:'Send a test alert'}).press('Enter');await page.waitForURL(/notice=No\+push/)
 assert.deepEqual((await a.dump()).vane_push_subscriptions,[])
 answer=201;await subscribe('https://push.example/send/browser-2');assert.equal((await a.post('/api/vane/push/unsubscribe',{endpoint:'https://push.example/send/browser-2'},a.owner)).status,200)
 assert.deepEqual((await a.dump()).vane_push_subscriptions,[])
 // Removing a team member (TEAM-001) deletes their browsers' subscriptions.
 const member=await a.invite('alerts@example.test','member');assert.equal((await subscribe('https://push.example/send/member',member)).status,201)
 const operators=await (await a.request('/auth/operators',{headers:{cookie:a.owner}})).json(),list=Array.isArray(operators)?operators:operators.operators
 assert.equal((await a.form({operation:'team.remove',operatorId:list.find(p=>p.email==='alerts@example.test').id},a.owner)).status,303)
 const after=await a.dump();assert.deepEqual(after.vane_push_subscriptions,[]);assert.ok(['push.subscribe','push.unsubscribe'].every(action=>after.vane_audit.some(e=>e.action===action)),'subscribing and unsubscribing are audited')
 assert.ok(!JSON.stringify(after.vane_push_keys).includes('"d"'),'the VAPID private key is sealed')
 assert.ok(a.egress.every(url=>new URL(url).origin==='https://push.example'||new URL(url).hostname==='api.resend.com'),'alerts go only to the push service')
})
test('API-004 an MCP client with a site-scoped Stats API key lists its sites and gets last week\'s top sources equal to the Stats API answer; another site, a missing or revoked key and a write tool without a grant are refused',async t=>{
 const a=await withApp(t),id=await a.addSite({paths:[]}),other=await a.addSite({name:'Oak Store',origin:'https://oak.example'})
 const now=Date.parse('2026-03-12T12:00:00Z')
 for(const [n,first,day] of [[1,{referrer:'https://www.google.com/'},1],[2,{referrer:'https://www.google.com/'},2],[3,{campaign:'spring',utm:{source:'newsletter',medium:'email'}},3],[4,{referrer:'https://news.ycombinator.com/'},4],[5,{},5]]){await a.clock(now-day*86400000);assert.equal((await a.post('/api/vane/collect',a.event(id,{source:undefined,campaign:undefined,...first,path:'/'}),'',{origin:'https://fern.example','cf-connecting-ip':'203.0.113.'+n,'user-agent':'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36'})).status,202)}
 await a.clock(now)
 const key=(await (await a.form({operation:'apikey.create',kind:'stats',label:'Assistant',[`site_${id}`]:'on'},a.owner)).text()).match(/data-api-key>(vane_k_[0-9a-f]{64})</)[1]
 // A minimal MCP client over Streamable HTTP: initialize, the initialized notification, then requests with the negotiated version.
 let version='',next=0
 const send=(message,token=key)=>a.request('/api/v1/mcp',{method:'POST',headers:{'content-type':'application/json',accept:'application/json, text/event-stream',...(token?{authorization:'Bearer '+token}:{}),...(version?{'mcp-protocol-version':version}:{})},body:JSON.stringify(message)})
 const rpc=async(method,params,token)=>{const id=++next,r=await send({jsonrpc:'2.0',id,method,params},token);assert.equal(r.status,200,await r.clone().text());const body=await r.json();assert.equal(body.id,id);return body}
 const init=await rpc('initialize',{protocolVersion:'2025-06-18',capabilities:{},clientInfo:{name:'test-client',version:'1'}});assert.equal(init.result.protocolVersion,'2025-06-18');assert.ok(init.result.capabilities.tools);version=init.result.protocolVersion
 assert.equal((await send({jsonrpc:'2.0',method:'notifications/initialized'})).status,202)
 const tools=(await rpc('tools/list',{})).result.tools;assert.ok(['list_sites','query_stats','add_annotation'].every(name=>tools.some(tool=>tool.name===name)));assert.equal(tools.find(tool=>tool.name==='query_stats').annotations.readOnlyHint,true)
 const listed=(await rpc('tools/call',{name:'list_sites',arguments:{}})).result;assert.deepEqual(listed.structuredContent.sites.map(s=>s.id),[id],'only the key\'s sites')
 // Last week's top sources: the tool's answer is the Stats API's answer.
 const asked=(await rpc('tools/call',{name:'query_stats',arguments:{site_id:id,period:'7d',dimension:'source',metrics:['visitors','visits']}})).result
 const stats=await (await a.request(`/api/v1/stats?site_id=${id}&period=7d&dimension=source&metrics=visitors,visits`,{headers:{authorization:'Bearer '+key}})).json()
 assert.equal(asked.isError,false);assert.deepEqual(asked.structuredContent,stats);assert.deepEqual(JSON.parse(asked.content[0].text),stats)
 assert.deepEqual(Object.fromEntries(stats.breakdown.filter(r=>r.visits).map(r=>[r.value,r.visits])),{Google:2,newsletter:1,'Hacker News':1,direct:1})
 // Another site and a write tool are refused, and the write changes nothing.
 const foreign=(await rpc('tools/call',{name:'query_stats',arguments:{site_id:other,period:'7d'}})).result;assert.equal(foreign.isError,true);assert.equal(foreign.structuredContent.error,'forbidden')
 const write=(await rpc('tools/call',{name:'add_annotation',arguments:{site_id:id,day:'2026-03-11',text:'Launch'}})).result;assert.equal(write.isError,true);assert.equal(write.structuredContent.error,'grant_required');assert.deepEqual((await a.dump()).vane_annotations,[])
 assert.equal((await rpc('tools/call',{name:'drop_tables',arguments:{}})).error.code,-32602);assert.equal((await rpc('resources/list',{})).error.code,-32601)
 // No key, a revoked key and an event-stream GET are refused.
 const anonymous=await send({jsonrpc:'2.0',id:99,method:'tools/list'},null);assert.equal(anonymous.status,401);assert.equal(anonymous.headers.get('www-authenticate'),'Bearer')
 assert.equal((await a.request('/api/v1/mcp',{headers:{authorization:'Bearer '+key,accept:'text/event-stream'}})).status,405)
 assert.equal((await a.form({operation:'apikey.revoke',id:(await a.dump()).vane_api_keys[0].id},a.owner)).status,303);assert.equal((await send({jsonrpc:'2.0',id:100,method:'tools/list'})).status,401)
})
test('IMPORT-006 a page of PostHog $pageview events, a Simple Analytics CSV export page and a Umami website_event database export page import only the day, path, source and campaign, resume without double counting, and keep no person, session, device or IP identifier',async t=>{
 const a=await withApp(t),owner={headers:{cookie:a.owner}},id=await a.addSite({paths:[]})
 const person='0191f2d0-person-7a1b',ip='198.51.100.23',pageview=(uuid,timestamp,url,extra={})=>({uuid,event:'$pageview',timestamp,distinct_id:person,properties:{$current_url:url,$pathname:new URL(url).pathname,$host:'fern.example',$ip:ip,$session_id:'0191f2d0-session',$device_id:'0191f2d0-device',$title:'Title of a PostHog page',token:'phc_projectkey',$browser:'Chrome',$referrer:'$direct',$referring_domain:'$direct',...extra}})
 const page={next:null,results:[
  pageview('0191f2d0-0001-7000-8000-000000000001','2024-03-10T10:00:00.123000+00:00','https://fern.example/?utm_source=newsletter&utm_campaign=spring',{utm_source:'newsletter',utm_campaign:'spring'}),
  pageview('0191f2d0-0002-7000-8000-000000000002','2024-03-10T10:05:00+00:00','https://fern.example/pricing',{$referrer:'https://www.google.com/search?q=fern',$referring_domain:'www.google.com'}),
  pageview('0191f2d0-0003-7000-8000-000000000003','2024-03-11T09:00:00Z','https://fern.example/thanks'),
 ]}
 const {preview}=await movein(a,id,page)
 assert.deepEqual(preview.normalized.map(e=>[e.day,e.path,e.source,e.campaign]).sort(),[['2024-03-10','/','newsletter','spring'],['2024-03-10','/pricing','www.google.com','none'],['2024-03-11','/thanks','direct','none']])
 assert.deepEqual([preview.discarded.sessionIds,preview.discarded.pageTitles,preview.discarded.websiteIds,preview.discarded.sourceEventIds,preview.discarded.rawQueries,preview.discarded.referrerPaths],[9,3,3,3,1,1])
 const totals=async()=>(await (await a.request(`/api/vane/summary?siteId=${id}&from=2024-03-10&to=2024-03-12`,owner)).json()).pageviews
 assert.equal(await totals(),3)
 // The same page again resumes its job: nothing counts twice.
 await movein(a,id,page);assert.equal(await totals(),3)
 const stored=JSON.stringify(await a.dump());for(const value of [person,ip,'0191f2d0-session','0191f2d0-device','phc_projectkey','Title of a PostHog page','0191f2d0-0001-7000-8000-000000000001','utm_source=newsletter'])assert.ok(!stored.includes(value),value)
 // Anything but a $pageview, or a page without events, is refused before custody.
 const refused=await a.post('/api/vane/import-preview',{siteId:id,document:{results:[{...page.results[0],event:'$autocapture'}]}},a.owner);assert.equal(refused.status,400);assert.match(await refused.text(),/ROW_1_UNSUPPORTED_EVENT_TYPE/)
 assert.equal((await a.post('/api/vane/import-preview',{siteId:id,document:{results:[]}},a.owner)).status,400)
 // A Simple Analytics data-point export page (CSV): the same four fields are kept, the session ID and the rest are not.
 const csv='added_iso,path,uuid,session_id,hostname,referrer_hostname,referrer_path,utm_source,utm_campaign,query,browser_name,country_code,is_unique\r\n'+
  '2024-03-12T08:00:00.000Z,/,sa-0001,sa-session-77,fern.example,news.ycombinator.com,/item,,,,Firefox,NL,true\r\n'+
  '2024-03-12T08:05:00.000Z,/pricing,sa-0002,sa-session-77,fern.example,,,newsletter,"spring, launch",ref=x,Firefox,NL,false\r\n'
 const simple=(await movein(a,id,csv)).preview
 assert.deepEqual(simple.normalized.map(e=>[e.day,e.path,e.source,e.campaign]).sort(),[['2024-03-12','/','news.ycombinator.com','none'],['2024-03-12','/pricing','newsletter','spring, launch']])
 assert.deepEqual([simple.discarded.sessionIds,simple.discarded.rawQueries,simple.discarded.referrerPaths],[2,1,1])
 assert.equal((await (await a.request(`/api/vane/summary?siteId=${id}&from=2024-03-12&to=2024-03-13`,owner)).json()).pageviews,2)
 await movein(a,id,csv);assert.equal((await (await a.request(`/api/vane/summary?siteId=${id}&from=2024-03-12&to=2024-03-13`,owner)).json()).pageviews,2,'resumes without double counting')
 // A page of Umami's website_event database export (CSV, PostgreSQL timestamps in UTC): the same fields are kept, and an
 // event keeps its identity through Umami's events API, so a row imported both ways counts once.
 const umami='event_id,website_id,session_id,visit_id,created_at,url_path,url_query,referrer_path,referrer_query,referrer_domain,page_title,event_type,event_name,hostname,tag\n'+
  'b1a6c0de-0001-4000-8000-000000000001,4fb7a9b2-site,77aa-session,88bb-visit,2024-03-13 09:00:00.123+00,/,utm_source=newsletter&utm_campaign=spring,,,,Fern home,1,,fern.example,\n'+
  'b1a6c0de-0002-4000-8000-000000000002,4fb7a9b2-site,77aa-session,88bb-visit,2024-03-13 09:02:00,/pricing,,/search,q=fern,www.google.com,Fern pricing,1,,fern.example,\n'+
  'b1a6c0de-0003-4000-8000-000000000003,4fb7a9b2-site,77aa-session,88bb-visit,2024-03-13T09:05:00Z,/thanks,,,,,Thanks,2,signup,fern.example,\n'
 const export_=(await movein(a,id,umami)).preview
 assert.deepEqual(export_.normalized.map(e=>[e.day,e.kind,e.path,e.source,e.campaign]).sort(),[['2024-03-13','pageview','/','newsletter','spring'],['2024-03-13','pageview','/pricing','www.google.com','none'],['2024-03-13','signup','/thanks','direct','none']])
 assert.deepEqual([export_.discarded.sessionIds,export_.discarded.websiteIds,export_.discarded.pageTitles,export_.discarded.rawQueries,export_.discarded.referrerPaths,export_.discarded.referrerQueries],[6,3,3,1,1,1])
 const day13=async()=>{const r=await (await a.request(`/api/vane/summary?siteId=${id}&from=2024-03-13&to=2024-03-14`,owner)).json();return [r.pageviews,r.goals]}
 assert.deepEqual(await day13(),[2,1])
 await movein(a,id,{data:[{id:'b1a6c0de-0001-4000-8000-000000000001',websiteId:'4fb7a9b2-site',sessionId:'77aa-session',createdAt:'2024-03-13T09:00:00.123Z',urlPath:'/',urlQuery:'utm_source=newsletter&utm_campaign=spring',eventType:1}],count:1,page:1,pageSize:1})
 assert.deepEqual(await day13(),[2,1],'the same Umami event through the events API counts once')
 const after=JSON.stringify(await a.dump());for(const value of ['sa-session-77','sa-0001','ref=x','77aa-session','88bb-visit','4fb7a9b2-site','Fern pricing','b1a6c0de-0002','q=fern'])assert.ok(!after.includes(value),value)
})
test('INSTALL-008 DASH-005 COLLECT-003 PRIVACY-003 a server sends pageviews and a custom event with its site token, a repeated Idempotency-Key counts once, a token for another site is refused, and no raw IP or user agent is stored',async t=>{
 const a=await withApp(t),owner={headers:{cookie:a.owner}},id=await a.addSite({paths:[]}),other=await a.addSite({name:'Oak Store',origin:'https://oak.example'})
 await a.clock(Date.parse('2026-03-10T15:00:00Z'))
 const token=async site=>(await (await a.form({operation:'apikey.create',kind:'events',label:'Backend '+site.slice(0,4),[`site_${site}`]:'on'},a.owner)).text()).match(/data-api-key>(vane_e_[0-9a-f]{64})</)[1]
 assert.equal((await a.form({operation:'apikey.create',kind:'events',label:'Both',[`site_${id}`]:'on',[`site_${other}`]:'on'},a.owner)).status,400,'an events token covers one site')
 const mine=await token(id),theirs=await token(other)
 const send=(body,key=mine,extra={})=>a.request('/api/v1/events',{method:'POST',headers:{'content-type':'application/json',...(key?{authorization:'Bearer '+key}:{}),...extra},body:JSON.stringify(body)})
 const chrome='Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36',iphone='Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1'
 const page=(path,ip,agent,extra={})=>({type:'pageview',id:crypto.randomUUID(),path,consent:'not-required',client_ip:ip,user_agent:agent,...extra})
 const first=page('/','203.0.113.9',chrome,{referrer:'https://www.google.com/',props:{plan:'pro'}})
 const one=await send(first);assert.equal(one.status,200,await one.clone().text());assert.deepEqual((await one.json()).results.map(r=>r.status),[202])
 const signup=await send({type:'event',id:crypto.randomUUID(),page:first.id,name:'Signup',consent:'not-required',client_ip:'203.0.113.9',user_agent:chrome});assert.deepEqual((await signup.json()).results.map(r=>r.status),[202])
 // A batch with an Idempotency-Key, sent twice: the second answer repeats the first, and nothing counts twice.
 const batch={events:[page('/pricing','203.0.113.9',chrome),page('/','198.51.100.4',iphone)]}
 const sent=await (await send(batch,mine,{'idempotency-key':'order-1001'})).json(),again=await (await send(batch,mine,{'idempotency-key':'order-1001'})).json()
 assert.equal(sent.accepted,2);assert.equal(again.duplicate,true);assert.deepEqual(again.results,sent.results)
 assert.equal((await (await send(first)).json()).results[0].duplicate,true,'a repeated event ID is admitted once')
 const summary=await (await a.request(`/api/vane/summary?siteId=${id}&period=today`,owner)).json()
 assert.deepEqual([summary.pageviews,summary.visitors],[3,2],'two visitors from their client IP and user agent');assert.deepEqual(summary.sourceVisits.find(r=>r.label==='Google')?.visits,1)
 const dump=await a.dump(),events=dump.vane_events.filter(e=>e.site_id===id)
 assert.ok(events.every(e=>[e.country,e.region,e.city,e.metro_code].every(v=>v===null)&&!Object.hasOwn(e,'metro_name')),'Events API never stores the sender server’s location');assert.equal(summary.countries.find(r=>r.label==='Unknown location')?.visitors,2)
 assert.deepEqual(events.map(e=>e.browser).sort(),['Chrome','Chrome','Safari']);assert.equal(dump.vane_custom_events.filter(e=>e.site_id===id).length,1)
 const stored=JSON.stringify(dump);for(const value of ['203.0.113.9','198.51.100.4',chrome,iphone,'order-1001',mine])assert.ok(!stored.includes(value),value)
 // A token for another site, a Stats API key, no token and a missing client address are refused.
 assert.equal((await send({...page('/','203.0.113.9',chrome),siteId:id},theirs)).status,403)
 const stats=(await (await a.form({operation:'apikey.create',kind:'stats',label:'Read',[`site_${id}`]:'on'},a.owner)).text()).match(/data-api-key>(vane_k_[0-9a-f]{64})</)[1]
 assert.equal((await send(page('/','203.0.113.9',chrome),stats)).status,403);assert.equal((await send(page('/','203.0.113.9',chrome),null)).status,401)
 assert.equal((await send({...page('/','203.0.113.9',chrome),client_ip:undefined})).status,400)
 assert.equal((await (await a.request(`/api/vane/summary?siteId=${other}&period=today`,owner)).json()).pageviews,0)
 const openapi=await (await a.request('/api/v1/openapi.json')).json();assert.ok(openapi.paths['/api/v1/events']&&openapi['x-event-limits'].events.events>0)
})
test('PRIVACY-003 each consent manager adapter and Google Consent Mode decide collection where the site\'s regions require consent: denied then granted from California, Germany and Texas, an unknown country fails closed, and the server holds the same rule',async t=>{
 const a=await withApp(t),states={
  onetrust:g=>`window.OnetrustActiveGroups=',C0001,${g?'C0002,':''}'`,cookiebot:g=>`window.Cookiebot={hasResponse:true,consent:{statistics:${g}}}`,termly:g=>`window.Termly={getConsentState:()=>({analytics:${g}})}`,
  osano:g=>`window.Osano={cm:{getConsent:()=>({ANALYTICS:'${g?'ACCEPT':'DENY'}'})}}`,iubenda:g=>`window._iub={cs:{api:{getPreferences:()=>({purposes:{1:true,4:${g}}})}}}`,cookieyes:g=>`window.getCkyConsent=()=>({isUserActionCompleted:true,categories:{analytics:${g}}})`}
 const regions=['EU','UK','US-CA'],sites={}
 for(const adapter of [...Object.keys(states),'consent-mode'])sites[adapter]=await a.addSite({name:'Fern '+adapter,origin:`https://${adapter}.fern.example`,paths:[],consent:'required',declinedCounter:true,consentRegions:regions,...(adapter==='consent-mode'?{}:{consentAdapter:adapter})})
 const pages={},page=(adapter,script)=>{const url=`https://${adapter}.fern.example/p${Object.keys(pages).length}`;pages[url]=`<!doctype html><title>Fixture</title><script>${script}</script><script src="${a.origin}/vane.js" data-site="${sites[adapter]}"></script>`;return url}
 const {context}=await browse(t,a,pages);let where={}
 // The visitor's location arrives as Cloudflare's request fields, as the edge sets them.
 await context.route(a.origin+'/**',async route=>{const request=route.request(),url=new URL(request.url()),response=await a.request(url.pathname+url.search,{method:request.method(),headers:request.headers(),body:request.postData()??undefined,cf:where});return route.fulfill({status:response.status,headers:Object.fromEntries(response.headers),body:Buffer.from(await response.arrayBuffer())})})
 const tab=await context.newPage()
 // One page load: the script either collects it or sends only the declined-consent count.
 const outcome=async(url,location)=>{where=location;const done=tab.waitForResponse(r=>/\/api\/vane\/(collect|declined\/)/.test(new URL(r.url()).pathname));await tab.goto(url);const r=await done;return new URL(r.url()).pathname==='/api/vane/collect'?[r.status(),JSON.parse(r.request().postData()).consent]:'declined'}
 const california={country:'US',region:'California',regionCode:'CA'},germany={country:'DE',region:'Berlin',regionCode:'BE',city:'Berlin',postalCode:'never-store-10115',latitude:'52.1234567',longitude:'13.7654321',timezone:'never-store-zone'},texas={country:'US',region:'Texas',regionCode:'TX',city:'Austin'}
 for(const adapter of Object.keys(states))for(const [location,required] of [[california,true],[germany,true],[texas,false]]){
  assert.deepEqual(await outcome(page(adapter,states[adapter](false)),location),required?'declined':[202,'not-required'],`${adapter} denied in ${location.regionCode}`)
  assert.deepEqual(await outcome(page(adapter,states[adapter](true)),location),required?[202,'granted']:[202,'not-required'],`${adapter} granted in ${location.regionCode}`)
 }
 // Google Consent Mode v2: the last analytics_storage default or update decides; window.vaneConsent comes first.
 const gtag=`window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments)}gtag('consent','default',{analytics_storage:'denied',ad_storage:'denied'});`
 assert.equal(await outcome(page('consent-mode',gtag),germany),'declined')
 assert.deepEqual(await outcome(page('consent-mode',gtag+`gtag('consent','update',{analytics_storage:'granted'})`),germany),[202,'granted'])
 assert.equal(await outcome(page('cookiebot','window.vaneConsent=false;'+states.cookiebot(true)),germany),'declined','window.vaneConsent comes first')
 assert.equal(await outcome(page('onetrust',states.onetrust(false)),{country:'XX'}),'declined','an unknown country (Cloudflare\'s XX) is asked for consent')
 // The configuration door says only whether consent is needed, and collection enforces the same rule.
 where=texas;const config=await (await a.request(`/api/vane/config/${sites.osano}`,{headers:{origin:'https://osano.fern.example'},cf:texas})).json();assert.equal(config.consent,'not-required');assert.equal(config.consentAdapter,'osano');assert.ok(!JSON.stringify(config).includes('US'))
 const direct=(cf,consent)=>a.request('/api/vane/collect',{method:'POST',headers:{origin:'https://osano.fern.example','content-type':'application/json','user-agent':'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36'},body:JSON.stringify(a.event(sites.osano,{consent})),cf})
 const beforeDenied=await a.dump();assert.equal((await direct(germany,'not-required')).status,403);assert.deepEqual(await a.dump(),beforeDenied,'denied consent creates no event, visitor hash, location or other row');assert.equal((await direct(texas,'not-required')).status,202);assert.equal((await direct(germany,'granted')).status,202)
 const stored=await a.dump();assert.ok(stored.vane_events.some(e=>e.country==='Germany'&&e.region==='Berlin'&&e.city==='Berlin'));assert.ok(stored.vane_events.some(e=>e.country==='United States'&&e.region==='Texas'));
 const custody=JSON.stringify([stored,await a.archive()]);for(const raw of ['never-store-10115','52.1234567','13.7654321','never-store-zone'])assert.equal(custody.includes(raw),false,raw);assert.ok(!JSON.stringify(stored.vane_events).match(/"(DE|BE|TX)"/),'raw Cloudflare codes are never stored')
 await context.close()
})
test('API-003 a signed webhook receives a goal burst as per-minute counts once each after a failed first delivery is retried, and the delivery log shows the failure and the success',async t=>{
 const a=await withApp(t),owner={headers:{cookie:a.owner}},id=await a.addSite({paths:[],goals:{signup:'/thanks'}}),T=Date.parse('2026-03-10T10:00:00Z')
 const add=(body,cookie=a.owner)=>a.form({operation:'webhook.create',siteId:id,url:'https://hooks.fixture.example/vane','event_goal.conversions':'on',...body},cookie)
 assert.equal((await add({url:'http://hooks.fixture.example/vane'})).status,400);assert.equal((await add({url:'https://10.1.2.3/vane'})).status,400)
 assert.equal((await a.form({operation:'team.invite',email:'viewer@example.test',role:'viewer',scope:'all'},a.owner)).status,303);assert.equal((await add({},await a.accept('viewer@example.test'))).status,403)
 await a.clock(T);const made=await add({});assert.equal(made.status,200);const secret=(await made.text()).match(/data-webhook-secret>(vane_wh_[0-9a-f]{64})</)[1]
 assert.ok(!(await (await a.request(`/app/sites/${id}?section=settings`,owner)).text()).includes(secret),'shown once');assert.ok(!JSON.stringify(await a.dump()).includes(secret),'sealed')
 const received=[];let fail=1
 a.fixtureSites['https://hooks.fixture.example']=async request=>{const body=await request.text(),[,ts,v1]=request.headers.get('vane-signature').match(/^t=(\d+),v1=([0-9a-f]{64})$/);received.push({delivery:request.headers.get('vane-delivery'),event:request.headers.get('vane-event'),body:JSON.parse(body),valid:createHmac('sha256',secret).update(`${ts}.${body}`).digest('hex')===v1});return new Response(null,{status:fail-->0?500:204})}
 // A burst: three signups in the 10:00 minute and one in 10:01.
 const load=async(at,n)=>{await a.clock(at);assert.equal((await a.post('/api/vane/collect',a.event(id,{path:'/thanks'}),'',{origin:'https://fern.example','cf-connecting-ip':'203.0.113.'+n,'user-agent':'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36'})).status,202)}
 for(const [n,s] of [[1,5],[2,20],[3,40],[4,90]])await load(T+s*1000,n)
 await a.clock(T+125000);await a.scheduled()
 assert.equal(received.length,2);assert.ok(received.every(r=>r.valid&&r.event==='goal.conversions'))
 await a.scheduled();assert.equal(received.length,2,'a failed delivery waits a minute before its retry')
 await a.clock(T+125000+61000);await a.scheduled();assert.equal(received.length,3)
 const failed=received[0].delivery;assert.equal(received[2].delivery,failed,'the retry carries the same delivery ID')
 const delivered=received.slice(1);assert.deepEqual(delivered.map(r=>[r.body.minute,r.body.goal,r.body.count]).sort(),[['2026-03-10T10:00:00.000Z','signup',3],['2026-03-10T10:01:00.000Z','signup',1]])
 assert.ok(received.every(r=>Object.keys(r.body).sort().join()===['count','event','goal','minute','site_id'].join()),'counts only, never per person')
 await a.clock(T+600000);await a.scheduled();assert.equal(received.length,3,'each delivery succeeds once')
 const log=await (await a.request(`/app/sites/${id}?section=settings`,owner)).text();assert.match(log,/<td class="vane-number">500<\/td><td>HTTP 500; retry in 1 min<\/td>/);assert.equal((log.match(/<td>delivered<\/td>/g)??[]).length,2)
 assert.ok(a.egress.every(url=>url.startsWith('https://hooks.fixture.example/')||url.includes('resend')),'deliveries go only to the endpoint')
 const hook=(await a.dump()).vane_webhooks[0].id;assert.equal((await a.form({operation:'webhook.delete',id:hook},a.owner)).status,303);assert.ok((await a.dump()).vane_audit.some(e=>e.action==='webhook.delete'))
})

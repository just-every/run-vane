import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { chromium } from '@playwright/test'
import { installation } from './harness.mjs'

const userAgent='Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36'
const json=async r=>{assert.equal(r.status,200);return r.json()}
test('owner first-party proxy setup verifies installation and keeps every tracker door, regional consent, transport coverage, credential revocation and browser requests within the declared boundary',async t=>{
 const a=await installation();t.after(()=>a.close())
 const origin='https://synthetic-vane-1.test',now=Date.parse('2026-10-05T12:00:00Z');await a.clock(now)
 const id=await a.addSite({name:'synthetic-vane-1',origin,paths:[],goals:{purchase:'/thanks'},autoEvents:['outbound'],signalCounter:true,declinedCounter:true,experiments:[{name:'checkout',page:'/pricing',goal:'purchase',variants:['control','alternative']}]})
 const admin=await a.invite('synthetic-vane-2@example.test','admin'),path='/api/vane/proxy-connections'
 assert.equal((await a.request(path+'?siteId='+id)).status,401)
 assert.equal((await a.post(path,{operation:'proxy.create',siteId:id,hostname:new URL(origin).hostname,mode:'external'},admin)).status,403)
 const created=await json(await a.post(path,{operation:'proxy.create',siteId:id,hostname:new URL(origin).hostname,mode:'external',publicPrefix:'/insights'},a.owner))
 assert.ok(created.credential);const c=created.connection,credential=created.credential
 const list=await json(await a.request(path+'?siteId='+id,{headers:{cookie:a.owner}}));assert.equal(list[0].id,c.id);assert.ok(!JSON.stringify(list).includes(credential))
 const headers={origin,'user-agent':userAgent,authorization:'Bearer '+credential,'x-vane-proxy-ip':'198.51.100.77','x-vane-proxy-country':'US','x-vane-proxy-region':'CA','x-vane-proxy-city':encodeURIComponent('San José')}
 const call=(door,body,extra={})=>a.request(`/api/vane/proxy/${c.id}/${door}`,{method:body===undefined?'GET':'POST',headers:{...headers,...(typeof body==='object'?{'content-type':'application/json'}:{}),...extra},...(body===undefined?{}:{body:typeof body==='string'?body:JSON.stringify(body)})})
 assert.equal((await call('script.js')).status,200);assert.equal((await call('config/'+id)).status,200)
 const originless={authorization:'Bearer '+credential,'x-vane-proxy-ip':'198.51.100.77'};
 assert.equal((await a.request(`/api/vane/proxy/${c.id}/config/${id}`,{headers:originless})).status,200,'same-origin browser config GET has no Origin header');
 assert.equal((await call('config/'+id,undefined,{origin:'https://synthetic-vane-8.test'})).status,403);
 assert.equal((await a.request(`/api/vane/proxy/${c.id}/collect`,{method:'POST',headers:{...originless,'content-type':'application/json'},body:JSON.stringify(a.event(id))})).status,403,'events still require the registered origin');
 assert.equal((await a.request(`/api/vane/proxy/${c.id}/collect`,{method:'POST',body:'{}',headers:{origin}})).status,401)
 assert.equal((await call('collect',{...a.event(id),siteId:'synthetic-vane-3'})).status,403)
 const page=a.event(id,{path:'/pricing',consent:'not-required'});assert.equal((await call('collect',page)).status,202)
 assert.equal((await call('collect',page)).status,200,'response replay does not duplicate the accepted load')
 const direct=a.event(id,{path:'/direct',consent:'not-required'});assert.equal((await a.post('/api/vane/collect',direct,'',{origin,'user-agent':userAgent,'cf-connecting-ip':'198.51.100.77','x-vane-proxy-country':'DE'})).status,202)
 assert.equal((await call('custom',{siteId:id,page:page.id,id:crypto.randomUUID(),name:'Signup',props:{plan:'pro'},consent:'not-required'})).status,202)
 assert.equal((await call('event',{siteId:id,id:crypto.randomUUID(),kind:'outbound',prop:'https://synthetic-vane-4.test/docs',consent:'not-required'})).status,202)
 assert.equal((await call('perf',{siteId:id,id:page.id,lcp:1200,inp:40,cls:0.01,load:1800})).status,202)
 assert.equal((await call('exposure',{siteId:id,page:page.id,experiment:'checkout',consent:'not-required'})).status,202)
 await a.clock(now+11000);assert.equal((await call('engage',{siteId:id,id:page.id,scroll:50})).status,202)
 for(const door of ['signal','ignored'])assert.equal((await call(door+'/'+id,'')).status,202,door)
 assert.equal((await call('collect',a.event(id,{consent:'not-required'}),{'sec-gpc':'1'})).status,403)
 const regionalOrigin='https://synthetic-vane-5.test',regional=await a.addSite({name:'synthetic-vane-5',origin:regionalOrigin,paths:[],goals:{},consent:'required',consentRegions:['US-CA'],declinedCounter:true})
 const regionalProxy=await json(await a.post(path,{operation:'proxy.create',siteId:regional,hostname:new URL(regionalOrigin).hostname,mode:'external',publicPrefix:'/regional'},a.owner))
 const denied=await a.request(`/api/vane/proxy/${regionalProxy.connection.id}/collect`,{method:'POST',headers:{...headers,origin:regionalOrigin,authorization:'Bearer '+regionalProxy.credential,'content-type':'application/json'},body:JSON.stringify(a.event(regional,{consent:'not-required'}))})
 assert.equal(denied.status,403,'attested region code still enforces California consent')
 assert.equal((await a.request(`/api/vane/proxy/${regionalProxy.connection.id}/declined/${regional}`,{method:'POST',headers:{...headers,origin:regionalOrigin,authorization:'Bearer '+regionalProxy.credential},body:''})).status,202)
 const query=`siteId=${id}&from=2026-10-05&to=2026-10-06`,report=await json(await a.request('/api/vane/summary?'+query,{headers:{cookie:a.owner}}))
 assert.deepEqual([report.transport.proxy,report.transport.direct,report.transport.unknown,report.transport.total],[1,1,0,2]);assert.equal(report.transport.proxyShare,50)
 const statsKey=(await (await a.form({operation:'apikey.create',kind:'stats',label:'synthetic-vane-1',[`site_${id}`]:'on'},a.owner)).text()).match(/data-api-key>(vane_k_[0-9a-f]{64})</)[1],statsAuth={authorization:'Bearer '+statsKey}
 const stats=await json(await a.request(`/api/v1/stats?site_id=${id}&from=2026-10-05&to=2026-10-06&metrics=pageviews`,{headers:statsAuth}))
 assert.deepEqual(stats.transport,report.transport,'Stats API transport aggregates match the signed-in report')
 const compatible=await json(await a.request('/api/v2/query',{method:'POST',headers:{...statsAuth,'content-type':'application/json'},body:JSON.stringify({site_id:id,metrics:['pageviews'],date_range:['2026-10-05','2026-10-05']})}))
 assert.deepEqual(compatible.meta.transport,report.transport,'the compatible Stats API uses the same native denominator')
 const csv=await a.request('/api/vane/csv?'+query+'&table=transportCoverage',{headers:{cookie:a.owner}});assert.equal(csv.status,200);assert.match(await csv.text(),/First-party proxy,1,50/)
 const dump=await a.dump(),event=dump.vane_events.find(e=>e.id===id+':'+page.id)
 assert.equal(event.country,'United States');assert.equal(event.city,'San José');assert.equal(event.transport,'proxy')
 assert.ok(!JSON.stringify(dump).includes('198.51.100.77')&&!JSON.stringify(dump).includes(userAgent)&&!JSON.stringify(dump).includes(credential),'visitor metadata and raw server credentials never enter custody')
 const archive=await a.archive();assert.ok(!('vane_proxy_connections' in archive.payload.tables));assert.equal(archive.payload.tables.vane_events.find(e=>e.id===event.id).transport,'proxy')
 const setup=await json(await a.request(`/api/vane/proxy-setup?siteId=${id}&connectionId=${c.id}&platform=nextjs`,{headers:{cookie:a.owner}}));assert.ok(setup.files.length>0);assert.ok(!JSON.stringify(setup).includes(credential))
 // Actual script/config/collection requests traverse the Worker ingress. Only
 // the fixture website and its trusted server/network edge are supplied here.
 const browser=await chromium.launch({headless:true,args:['--use-mock-keychain','--password-store=basic']});t.after(()=>browser.close())
 const context=await browser.newContext({userAgent}),seen=[]
 await context.addCookies(a.owner.split('; ').map(pair=>{const i=pair.indexOf('=');return {name:pair.slice(0,i),value:pair.slice(i+1),url:a.origin}}))
 await context.route('**/*',async route=>{
  const req=route.request(),url=new URL(req.url());let r
  if(url.origin===origin&&url.pathname.startsWith('/insights/')){
   const suffix=url.pathname.slice('/insights/'.length);seen.push(suffix)
   r=await a.request(`/api/vane/proxy/${c.id}/${suffix}`,{method:req.method(),headers:{...req.headers(),...headers},body:req.postDataBuffer()??undefined})
  }else if(url.origin===origin)return route.fulfill({contentType:'text/html',body:`<!doctype html><title>synthetic-vane-1</title><p>Pricing</p><script defer src="${origin}/insights/script.js" data-site="${id}" data-api="/insights"></script>`})
  else if(url.origin===a.origin)r=await a.request(url.pathname+url.search,{method:req.method(),headers:req.headers(),body:req.postDataBuffer()??undefined})
  else return route.abort()
  return route.fulfill({status:r.status,headers:Object.fromEntries(r.headers),body:Buffer.from(await r.arrayBuffer())})
 })
 const tab=await context.newPage(),accepted=tab.waitForResponse(r=>new URL(r.url()).pathname==='/insights/collect'&&r.status()===202);await tab.goto(origin+'/pricing');await accepted
 assert.ok(seen.includes('script.js')&&seen.includes('config/'+id)&&seen.includes('collect'));assert.ok(seen.every(s=>!s.startsWith('api/vane')))
 const proxyScript=(src=origin+'/insights/script.js',api='/insights',siteId=id)=>`<script defer src="${src}" data-site="${siteId}"${api===null?'':` data-api="${api}"`}></script>`
 const directScript=siteId=>`<script defer src="${a.origin}/vane.js" data-site="${siteId}"></script>`
 let homepageScripts=directScript(regional)+proxyScript(),homepagePolicy="default-src 'self'"
 a.fixtureSites[origin]=()=>new Response(`<!doctype html><title>synthetic-vane-1</title>${homepageScripts}`,{headers:{'content-type':'text/html','content-security-policy':homepagePolicy}})
 const homepageAccepted=tab.waitForResponse(r=>new URL(r.url()).pathname==='/insights/collect'&&r.status()===202);await tab.goto(origin+'/');await homepageAccepted
 const verify=async(cookie=a.owner)=>json(await a.post('/api/vane/install-check',{siteId:id},cookie))
 assert.equal((await a.post('/api/vane/install-check',{siteId:id})).status,401)
 assert.equal((await verify()).state,'verified','the matching proxy script verifies with a self-only CSP even when another site script appears first')
 assert.equal((await verify(admin)).state,'verified','admins retain installation-check access without proxy-management access')
 homepagePolicy=`script-src 'self'; connect-src ${a.origin}`
 assert.equal((await verify()).cause,'csp_blocked','connect-src must permit the selected proxy origin')
 homepagePolicy="default-src 'self'"
 for(const api of [null,'/wrong']){
  homepageScripts=proxyScript(undefined,api)
  assert.equal((await verify()).cause,'proxy_api_mismatch','the tracker needs the registered data-api prefix')
 }
 for(const src of [origin+'/unregistered/script.js',regionalOrigin+'/regional/script.js']){
  homepageScripts=proxyScript(src)
  assert.equal((await verify()).cause,'script_missing','only this site’s registered hostname and prefix can verify')
 }
 homepageScripts=proxyScript(undefined,undefined,regional)
 assert.equal((await verify()).cause,'wrong_site_id')
 homepageScripts=directScript(id);homepagePolicy=`script-src ${a.origin}; connect-src ${a.origin}`
 assert.equal((await verify()).state,'verified','the existing direct installation still verifies')
 homepageScripts=directScript(regional)+proxyScript();homepagePolicy="default-src 'self'"
 for(const width of [1440,390]){
  await tab.setViewportSize({width,height:1000});await tab.goto(`${a.origin}/app/sites/${id}?section=settings&proxyId=${c.id}&proxyPlatform=nextjs`)
  await tab.getByRole('heading',{name:'First-party proxy',exact:true}).evaluate(el=>el.scrollIntoView({block:'start'}));await tab.evaluate(()=>scrollBy(0,-80))
  assert.equal(await tab.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true)
  if(process.env.VANE_SCREEN_DIR){await mkdir(process.env.VANE_SCREEN_DIR,{recursive:true});await tab.screenshot({path:join(process.env.VANE_SCREEN_DIR,`proxy-settings-${width}.png`)})}
  await tab.goto(`${a.origin}/app/sites/${id}?from=2026-10-05&to=2026-10-06`);await tab.getByRole('heading',{name:'Coverage and collection limits',exact:true}).evaluate(el=>el.scrollIntoView({block:'start'}));await tab.evaluate(()=>scrollBy(0,-80))
  if(process.env.VANE_SCREEN_DIR)await tab.screenshot({path:join(process.env.VANE_SCREEN_DIR,`proxy-coverage-${width}.png`)})
  await tab.locator('dt').filter({hasText:/^First-party proxy$/}).evaluate(el=>el.nextElementSibling.scrollIntoView({block:'center'}))
  if(process.env.VANE_SCREEN_DIR)await tab.screenshot({path:join(process.env.VANE_SCREEN_DIR,`proxy-share-${width}.png`)})
 }
 await tab.goto(a.origin+'/methodology#proxy-coverage')
 assert.equal(await tab.locator('p#proxy-coverage').isVisible(),true,'the public methodology exposes the proxy-share definition anchor')
 // The owner can complete the browser form; the server credential survives only this response.
 await tab.goto(`${a.origin}/app/sites/${id}?section=settings`);
 const createForm=tab.locator('form').filter({has:tab.locator('input[name="operation"][value="proxy.create"]')});
 await createForm.locator('[name="publicPrefix"]').fill('/browser');
 await createForm.getByRole('button',{name:'Create connection',exact:true}).click();
 await tab.locator('[data-proxy-credential]').waitFor();
 const once=await tab.locator('[data-proxy-credential]').innerText();assert.ok(once.length>16);
 for(const width of [1440,390]){
  await tab.setViewportSize({width,height:1000});await tab.getByRole('heading',{name:'One-use server credential',exact:true}).evaluate(el=>el.scrollIntoView({block:'center'}));
  assert.equal(await tab.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
  if(process.env.VANE_SCREEN_DIR)await tab.screenshot({path:join(process.env.VANE_SCREEN_DIR,`proxy-credential-${width}.png`)});
 }
 await tab.goto(`${a.origin}/app/sites/${id}?section=settings`);assert.equal(await tab.locator('[data-proxy-credential]').count(),0);
 assert.ok(!(await tab.content()).includes(once),'reload cannot expose the one-use credential again');
 const rotated=await json(await a.post(path,{operation:'proxy.rotate',siteId:id,connectionId:c.id},a.owner));assert.notEqual(rotated.credential,credential);assert.equal((await call('script.js')).status,401)
 assert.equal((await a.post(path,{operation:'proxy.revoke',siteId:id,connectionId:c.id},a.owner)).status,200)
 assert.equal((await call('script.js',undefined,{authorization:'Bearer '+rotated.credential})).status,401)
 homepageScripts=proxyScript()
 assert.equal((await verify()).cause,'script_missing','revoked proxy connections cannot verify')
})

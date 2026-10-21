import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { chromium } from '@playwright/test'
import { installation } from './harness.mjs'

const userAgent='Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36'
const json=async r=>{assert.equal(r.status,200);return r.json()}
test('owner first-party proxy setup keeps every tracker door, regional consent, transport coverage, credential revocation and browser requests within the declared boundary',async t=>{
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
 for(const door of ['signal','declined','ignored'])assert.equal((await call(door+'/'+id,'')).status,202,door)
 assert.equal((await call('collect',a.event(id,{consent:'not-required'}),{'sec-gpc':'1'})).status,403)
 const regional=await a.addSite({name:'synthetic-vane-5',origin,paths:[],goals:{},consent:'required',consentRegions:['US-CA']})
 const regionalProxy=await json(await a.post(path,{operation:'proxy.create',siteId:regional,hostname:new URL(origin).hostname,mode:'external',publicPrefix:'/regional'},a.owner))
 const denied=await a.request(`/api/vane/proxy/${regionalProxy.connection.id}/collect`,{method:'POST',headers:{...headers,authorization:'Bearer '+regionalProxy.credential,'content-type':'application/json'},body:JSON.stringify(a.event(regional,{consent:'not-required'}))})
 assert.equal(denied.status,403,'attested region code still enforces California consent')
 const query=`siteId=${id}&from=2026-10-05&to=2026-10-06`,report=await json(await a.request('/api/vane/summary?'+query,{headers:{cookie:a.owner}}))
 assert.deepEqual([report.transport.proxy,report.transport.direct,report.transport.unknown,report.transport.total],[1,1,0,2]);assert.equal(report.transport.proxyShare,50)
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
 for(const width of [1440,390]){
  await tab.setViewportSize({width,height:1000});await tab.goto(`${a.origin}/app/sites/${id}?section=settings&proxyId=${c.id}&proxyPlatform=nextjs`)
  await tab.getByRole('heading',{name:'First-party proxy',exact:true}).evaluate(el=>el.scrollIntoView({block:'start'}));await tab.evaluate(()=>scrollBy(0,-80))
  assert.equal(await tab.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true)
  if(process.env.VANE_SCREEN_DIR){await mkdir(process.env.VANE_SCREEN_DIR,{recursive:true});await tab.screenshot({path:join(process.env.VANE_SCREEN_DIR,`proxy-settings-${width}.png`)})}
  await tab.goto(`${a.origin}/app/sites/${id}?from=2026-10-05&to=2026-10-06`);await tab.getByRole('heading',{name:'Coverage and collection limits',exact:true}).evaluate(el=>el.scrollIntoView({block:'start'}));await tab.evaluate(()=>scrollBy(0,-80))
  if(process.env.VANE_SCREEN_DIR)await tab.screenshot({path:join(process.env.VANE_SCREEN_DIR,`proxy-coverage-${width}.png`)})
 }
 const rotated=await json(await a.post(path,{operation:'proxy.rotate',siteId:id,connectionId:c.id},a.owner));assert.notEqual(rotated.credential,credential);assert.equal((await call('script.js')).status,401)
 assert.equal((await a.post(path,{operation:'proxy.revoke',siteId:id,connectionId:c.id},a.owner)).status,200)
 assert.equal((await call('script.js',undefined,{authorization:'Bearer '+rotated.credential})).status,401)
})

import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { chromium } from '@playwright/test'
import { installation } from './harness.mjs'

test('ALERT-002 revenue drops use site-currency amounts, dated conversion and hourly baselines; unavailable conversion never becomes a zero drop',async t=>{
 const a=await installation();t.after(()=>a.close())
 const id=await a.addSite({paths:[],goals:{},currency:'AUD',rates:[{currency:'EUR',rate:1.5,from:'2026-08-01'}],retainForever:true})
 const T=Date.parse('2026-10-27T10:00:00Z'),HOUR=3600000
 const purchase=async(siteId,at,amount,currency,origin='https://fern.example')=>{
  await a.clock(at);const page=a.event(siteId,{path:'/checkout'})
  assert.equal((await a.collect(page,origin)).status,202)
  assert.equal((await a.post('/api/vane/custom',{id:crypto.randomUUID(),siteId,page:page.id,name:'Purchase',revenue:{amount,currency},consent:'not-required'},'',{origin})).status,202)
 }
 // Eight corresponding weekday/hour windows establish AUD 150, using each event's dated rate.
 for(let week=8;week>=1;week--)await purchase(id,T-week*7*24*HOUR+600000,100,'EUR')
 const add=body=>a.form({operation:'alert.create',siteId:id,metric:'revenue',direction:'below',cooldown:6,...body},a.owner)
 await a.clock(T-2*HOUR)
 assert.equal((await add({threshold:'50.25'})).status,303)
 assert.equal((await add({condition:'anomaly'})).status,303)
 assert.equal((await add({threshold:'50.251'})).status,400,'AUD thresholds use cents')
 // A new amount with no conversion rate must hold both otherwise-crossing alerts without a log or mail.
 await purchase(id,T-2*HOUR+600000,100,'CAD');await a.clock(T-HOUR+300000);await a.scheduled()
 const mails=()=>a.sentMail.filter(m=>/Revenue/.test(m.subject))
 assert.equal(mails().length,0);assert.equal((await a.dump()).vane_alert_log.length,0)
 assert.ok((await a.dump()).vane_audit.some(r=>r.action==='alert.revenue-unavailable'&&/missing dated exchange rate/.test(r.detail)))
 // The later known AUD 15 is below both the fixed amount and the usual range.
 const drop=T
 await purchase(id,drop+600000,10,'EUR');await a.clock(drop+HOUR+300000);await a.scheduled()
 assert.equal(mails().length,2)
 const fixed=mails().find(m=>/below AUD 50.25/.test(m.subject)),anomaly=mails().find(m=>/usual range/.test(m.subject))
 assert.ok(fixed);assert.match(fixed.text,/Now AUD 15.00\./)
 assert.match(anomaly.subject,/Revenue \(AUD\)/);assert.match(anomaly.text,/AUD 15.00 revenue/);assert.match(anomaly.text,/usual range for this weekday and hour is AUD 150.00 to AUD 150.00/)
 const log=(await a.dump()).vane_alert_log
 assert.equal(log.length,2);assert.ok(log.every(r=>r.value===15&&r.sent_at!==null&&r.currency==='AUD'))
 assert.equal(log.find(r=>r.condition==='threshold').threshold,50.25)
 assert.equal(log.find(r=>r.condition==='anomaly').threshold,150)
 await a.scheduled();assert.equal(mails().length,2,'one send for the crossing/hour')
 // The default site currency is explicitly USD too, without multiplying amounts into cents or micros.
 const usd=await a.addSite({origin:'https://dollars.example',paths:[],goals:{}})
 await purchase(usd,drop+HOUR+600000,0.1,'USD','https://dollars.example')
 assert.equal((await a.form({operation:'alert.create',siteId:usd,metric:'revenue',direction:'below',threshold:'0.25',cooldown:6},a.owner)).status,303)
 await a.scheduled();const dollars=mails().find(m=>/below USD 0.25/.test(m.subject));assert.ok(dollars);assert.match(dollars.text,/Now USD 0.10\./)
 // The real settings route shows the metric, threshold amount and recorded outcome at both review widths.
 const browser=await chromium.launch({headless:true,args:['--use-mock-keychain','--password-store=basic']});t.after(()=>browser.close())
 const context=await browser.newContext();await context.addCookies(a.owner.split('; ').map(pair=>{const at=pair.indexOf('=');return {name:pair.slice(0,at),value:pair.slice(at+1),url:a.origin}}))
 await context.route('**/*',async route=>{
  const request=route.request(),url=new URL(request.url());if(url.origin!==a.origin)return route.abort()
  const response=await a.request(url.pathname+url.search,{method:request.method(),headers:request.headers(),body:['GET','HEAD'].includes(request.method())?undefined:request.postDataBuffer()??undefined})
  const location=response.headers.get('location')
  if(response.status===303&&location)return route.fulfill({contentType:'text/html',body:`<!doctype html><title>Redirecting</title><meta http-equiv="refresh" content="0;url=${location.replaceAll('&','&amp;')}">`})
  await route.fulfill({status:response.status,headers:Object.fromEntries(response.headers),body:Buffer.from(await response.arrayBuffer())})
 })
 const page=await context.newPage()
 for(const width of [1440,390]){
  await page.setViewportSize({width,height:1000});await page.goto(`${a.origin}/app/sites/${id}?section=settings`)
  assert.equal(await page.getByRole('option',{name:'Revenue in the last 60 minutes (AUD)',exact:true}).count(),1)
  assert.match(await page.locator('[data-alerts]').textContent(),/below AUD 50.25/)
  assert.match(await page.locator('[data-alert-log]').textContent(),/AUD 15.00/)
  await page.getByLabel('Alert on',{exact:true}).selectOption('revenue')
  await page.getByLabel('Threshold (revenue: AUD amount)',{exact:true}).fill(width===1440?'75.50':'75.75')
  await page.getByRole('button',{name:'Add alert',exact:true}).click()
  await page.waitForURL(url=>url.searchParams.get('notice')==='Alert added.')
  await page.locator('[data-alerts]').waitFor()
  assert.match(await page.locator('[data-alerts]').textContent(),width===1440?/above AUD 75.50/:/above AUD 75.75/)
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true)
  if(process.env.VANE_SCREEN_DIR){await mkdir(process.env.VANE_SCREEN_DIR,{recursive:true});await page.getByRole('heading',{name:'Traffic alerts',exact:true}).scrollIntoViewIfNeeded();await page.screenshot({path:join(process.env.VANE_SCREEN_DIR,`revenue-alert-${width}.png`),fullPage:false});await page.getByLabel('Threshold (revenue: AUD amount)',{exact:true}).scrollIntoViewIfNeeded();await page.screenshot({path:join(process.env.VANE_SCREEN_DIR,`revenue-alert-form-${width}.png`),fullPage:false});await page.locator('[data-alert-log]').scrollIntoViewIfNeeded();await page.screenshot({path:join(process.env.VANE_SCREEN_DIR,`revenue-alert-log-${width}.png`),fullPage:false})}
 }
 // Changing the reporting currency must not relabel an already sent AUD crossing.
 const current=(await(await a.request('/api/vane/sites',{headers:{cookie:a.owner}})).json()).find(s=>s.id===id)
 const proposal=await a.post('/api/vane/commands',{command:'site.configure',input:{siteId:id,name:current.name,origin:current.origin,config:{...current.config,currency:'USD',rates:[]}}},a.owner)
 assert.equal(proposal.status,201);assert.equal((await a.form({operation:'proposal.approve',id:(await proposal.json()).id},a.owner)).status,303)
 for(const width of [1440,390]){
  await page.setViewportSize({width,height:1000});await page.goto(`${a.origin}/app/sites/${id}?section=settings`)
  assert.match(await page.locator('[data-alert-log]').textContent(),/AUD 15.00/)
  assert.doesNotMatch(await page.locator('[data-alert-log]').textContent(),/USD 15.00/)
  if(process.env.VANE_SCREEN_DIR){await page.locator('[data-alert-log]').scrollIntoViewIfNeeded();await page.screenshot({path:join(process.env.VANE_SCREEN_DIR,`revenue-alert-currency-change-${width}.png`)});await page.getByRole('row').filter({has:page.getByRole('rowheader',{name:'Alert log',exact:true})}).scrollIntoViewIfNeeded();await page.screenshot({path:join(process.env.VANE_SCREEN_DIR,`revenue-alert-inventory-${width}.png`)})}
 }
 await browser.close()
})

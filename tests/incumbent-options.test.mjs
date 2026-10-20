import test from 'node:test'
import assert from 'node:assert/strict'
import { chromium } from '@playwright/test'
import { installation } from './harness.mjs'

// Published call specifications, not an inferred Fathom export schema:
// https://usefathom.com/docs/script/script-advanced
// https://plausible.io/docs/script-extensions
// https://plausible.io/docs/custom-props/for-pageviews
// https://plausible.io/docs/file-downloads-tracking
const eventually=async check=>{let error;for(let i=0;i<80;i++){try{return await check()}catch(e){error=e;await new Promise(r=>setTimeout(r,50))}}throw error}

test('IMPORT-008 init properties and extension replacement precede collection; queued and live Fathom cents, routing options and privacy use native doors',async t=>{
 const a=await installation();t.after(()=>a.close());await a.clock(Date.parse('2026-10-01T12:00:00Z'))
 const id=await a.addSite({origin:'https://cutover.example',paths:[],goals:{},incumbentCompatibility:true}),owner={headers:{cookie:a.owner}}
 const browser=await chromium.launch({headless:true,args:['--use-mock-keychain','--password-store=basic']});t.after(()=>browser.close())
 const context=await browser.newContext({userAgent:'Mozilla/5.0 (Macintosh; Intel Mac OS X) AppleWebKit/537.36 (KHTML, like Gecko) Safari/537.36'}),page=await context.newPage(),responses=[];let mode='object'
 const options=()=>mode==='manual'?"{autoCapturePageviews:false,hashBasedRouting:true}":mode==='function'?"{customProperties:eventName=>({author:eventName==='pageview'?'lee':'sam'}),hashBasedRouting:true}":"{customProperties:{author:'jo'},fileDownloads:{fileExtensions:['dwg']},outboundLinks:true,formSubmissions:true}"
 await context.route('**/*',async route=>{
  const request=route.request(),url=new URL(request.url())
  if(url.origin==='https://cutover.example')return route.fulfill({contentType:'text/html',body:`<!doctype html><title>Design studio</title><script>window.plausible=function(){(plausible.q=plausible.q||[]).push(arguments)};plausible.init=o=>plausible.o=o;plausible.init(${options()});</script><script defer event-category="design" data-site="${id}" src="${a.origin}/vane.js"></script><h1>Design plans</h1><a href="/plan.dwg" onclick="event.preventDefault()">Drawing</a><a href="/plan.pdf" onclick="event.preventDefault()">PDF</a><a href="https://other.example/" onclick="event.preventDefault()">Partner</a><form id="contact" onsubmit="event.preventDefault()"><button>Contact</button></form>`})
  if(url.origin!==a.origin)return route.abort()
  const r=await a.request(url.pathname+url.search,{method:request.method(),headers:request.headers(),body:['GET','HEAD'].includes(request.method())?undefined:request.postDataBuffer()??undefined});responses.push([url.pathname,r.status]);return route.fulfill({status:r.status,headers:Object.fromEntries(r.headers),body:Buffer.from(await r.arrayBuffer())})
 })
 const summary=async()=>(await a.request('/api/vane/summary?siteId='+id+'&from=2026-10-01&to=2026-10-02',owner)).json()
 await page.goto('https://cutover.example/plans');await page.waitForFunction(()=>window.plausible?.vane===true)
 await eventually(async()=>{const r=await summary();assert.ok(r.pageProps.some(p=>p.key==='author'&&p.value==='jo'));assert.ok(r.pageProps.some(p=>p.key==='category'&&p.value==='design'))})
 await page.getByRole('link',{name:'Drawing',exact:true}).click();await page.getByRole('link',{name:'PDF',exact:true}).click();await page.getByRole('link',{name:'Partner',exact:true}).click();await page.getByRole('button',{name:'Contact',exact:true}).click()
 await page.evaluate(async()=>{await fathom.trackEvent('Purchase',{_value:4999});await plausible('Invalid',{props:{email:'person@example.com'}})})
 await eventually(async()=>{const r=await summary();assert.equal(r.revenue.total,49.99);assert.deepEqual(r.automaticEvents.map(e=>[e.kind,e.label]),[['download','https://cutover.example/plan.dwg'],['form','contact'],['outbound','https://other.example/']]);assert.equal(r.customEvents.some(e=>e.name==='Invalid'),false);assert.ok(responses.some(([path,status])=>path==='/api/vane/custom'&&status===400))})
 // Per-event functions run on subsequent navigation and custom calls, not once at initialization.
 mode='function';await page.goto('https://cutover.example/blog#/first');await page.waitForFunction(()=>window.plausible?.vane===true)
 await page.evaluate(async()=>{await plausible('Signup');history.pushState({},'', '#/second')})
 await eventually(async()=>{const r=await summary();assert.ok(r.topPages.some(p=>p.path==='/blog/second'));assert.ok(r.pageProps.some(p=>p.key==='author'&&p.value==='lee'));assert.ok(r.eventProps.some(p=>p.key==='author'&&p.value==='sam'))})
 mode='manual';await page.goto('https://cutover.example/manual#/one');await page.waitForFunction(()=>window.plausible?.vane===true)
 const before=(await summary()).pageviews;await page.evaluate(()=>fathom.trackPageview());await eventually(async()=>assert.equal((await summary()).pageviews,before+1))
 await page.evaluate(()=>history.pushState({},'','#/two'));assert.equal((await summary()).pageviews,before+1)
 await page.evaluate(()=>fathom.trackPageview());await eventually(async()=>assert.ok((await summary()).topPages.some(p=>p.path==='/manual/two')))
})

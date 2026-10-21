import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { createHash, createHmac } from 'node:crypto'
import { crc32 } from 'node:zlib'
import { createRequire } from 'node:module'
import { installation } from './harness.mjs'
import { appsScript } from './apps-script.mjs'
const fixture=JSON.parse(await readFile(new URL('./fixtures/umami-events.json',import.meta.url),'utf8'))
// DASH-007 makes report row values links that filter by them; assertions on a row's cells read past the link.
const unlinked=html=>html.replace(/<a href="[^"]*" data-filter-link>([^<]*)<\/a>/g,'$1')
async function withApp(t){const app=await installation();t.after(()=>app.close());return app}
// A real browser whose requests are all recorded: the built Worker serves the installation's origin, `pages` serves fixture pages, and anything else is refused.
// Headless browsers are excluded as automation (COLLECT-003), so it presents a desktop Chrome user agent unless userAgent is null.
const DESKTOP_CHROME='Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36'
async function browse(t,a,pages={},{userAgent=DESKTOP_CHROME,...options}={}){
 const {chromium}=await import('@playwright/test'),browser=await chromium.launch({headless:true,args:['--use-mock-keychain','--password-store=basic']});t.after(()=>browser.close())
 const context=await browser.newContext(userAgent===null?options:{...options,userAgent}),requests=[]
 await context.route('**/*',async route=>{
  const request=route.request(),url=new URL(request.url());requests.push(url.origin)
  if(pages[url.href])return route.fulfill({contentType:'text/html',body:pages[url.href]})
  if(url.origin!==a.origin)return route.abort()
  const response=await a.request(url.pathname+url.search,{method:request.method(),headers:request.headers(),body:request.postData()??undefined})
  return route.fulfill({status:response.status,headers:Object.fromEntries(response.headers),body:Buffer.from(await response.arrayBuffer())})
 })
 return {context,requests}
}
async function movein(app,siteId,document=fixture){const r=await app.post('/api/vane/import-preview',{siteId,document},app.owner);assert.equal(r.status,200,await r.clone().text());const p=await r.json();const a=await app.post('/api/vane/import-apply',{siteId,document:p.carry,fingerprint:p.fingerprint},app.owner);assert.equal(a.status,200,await a.clone().text());return {preview:p,applied:await a.json()}}


export { assert, readFile, createHash, createHmac, crc32, createRequire, installation, appsScript, fixture, unlinked, withApp, DESKTOP_CHROME, browse, movein }

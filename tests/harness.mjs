import { Miniflare, convertV4MiniflareOptions } from 'miniflare'
import { readFile, readdir } from 'node:fs/promises'
import { resolve, join } from 'node:path'
import { createRequire } from 'node:module'
import { randomBytes } from 'node:crypto'
import assert from 'node:assert/strict'
const require=createRequire(import.meta.url),{unstable_splitSqlQuery:split}=require('wrangler')
export async function installation({setup=true,vars:extra={},origin='http://127.0.0.1:8787'}={}) {
 const root=resolve('dist/server'),config=JSON.parse(await readFile(join(root,'wrangler.json'),'utf8'))
 const paths=await readdir(root,{recursive:true})
 const entry=join(root,config.main)
 const modules=[entry,...paths.filter(p=>p.endsWith('.js')&&join(root,p)!==entry).map(p=>join(root,p))].map(path=>({type:'ESModule',path}))
 const vars={AUTH_LOCAL:'true',AUTH_ORIGIN:origin,OWNER_EMAIL:'owner@example.test',SESSION_SECRET:randomBytes(32).toString('hex'),SETUP_TOKEN:randomBytes(32).toString('hex'),RER_DEV_KEY:randomBytes(32).toString('hex'),MAIL_PROVIDER:'resend',MAIL_API_KEY:'test-only-network-edge',MAIL_FROM:'auth@localhost.test',...extra}
 const sentMail=[],egress=[],fixtureSites={}
 // The ingress passes the request's cf fields (bot score, ASN, as Cloudflare's edge sets them) through to the app.
 // Every outbound request from the Worker is recorded; only the fake mail edge and fixture websites answer.
 const mailEdge=async request=>{egress.push(request.url);const site=fixtureSites[new URL(request.url).origin];if(site)return site(request);if(new URL(request.url).hostname!=='api.resend.com')throw new Error('Unexpected test egress');sentMail.push(await request.json());return Response.json({id:crypto.randomUUID()})}
 const mf=new Miniflare(convertV4MiniflareOptions({host:'127.0.0.1',port:0,cf:false,workers:[{name:'ingress',modules:true,script:`export default {fetch(request,env){const url=new URL(request.headers.get('x-original-url')),headers=new Headers(request.headers);headers.delete('x-original-url');headers.set('host',url.host);return env.APP.fetch(new Request(url,{method:request.method,headers,redirect:'manual',cf:request.cf,...(!['GET','HEAD'].includes(request.method)?{body:request.body}:{})}))}}`,serviceBindings:{APP:'app'}},{name:'app',outboundService:mailEdge,modules,modulesRoot:root,compatibilityDate:config.compatibility_date,compatibilityFlags:config.compatibility_flags,bindings:vars,d1Databases:{DB:'test-vane'},assets:{directory:resolve('dist/client'),binding:'ASSETS',routerConfig:{has_user_worker:true,invoke_user_worker_ahead_of_assets:true}}}]}))
 try {
 await mf.ready
 const db=await mf.getD1Database('DB','app')
 for(const file of (await readdir('migrations/core')).filter(p=>p.endsWith('.sql')).sort())for(const sql of split(await readFile(join('migrations/core',file),'utf8')))await db.prepare(sql).run()
 // Workerd reads its CF blob header as UTF-8. Keep the fixture wire ASCII so
 // Node's Latin-1 HTTP headers cannot corrupt non-ASCII platform place names.
 const request=(path,options={})=>{const {cf,...init}=options;return mf.dispatchFetch(origin+path,{redirect:'manual',...init,headers:{'x-original-url':origin+path,...options.headers,...(cf===undefined?{}:{'MF-CF-Blob':JSON.stringify(cf).replace(/[^\x00-\x7f]/g,c=>'\\u'+c.charCodeAt(0).toString(16).padStart(4,'0'))})}})}
 const post=(path,body,cookie='',extra={})=>request(path,{method:'POST',headers:{origin,'content-type':'application/json',cookie,...extra},body:JSON.stringify(body)})
 const form=(body,cookie)=>request('/app/action',{method:'POST',headers:{origin,'content-type':'application/x-www-form-urlencoded',cookie},body:new URLSearchParams(body).toString()})
 const bootstrap=await post('/auth/bootstrap',{token:vars.SETUP_TOKEN,displayName:'Site owner'})
 assert.equal(bootstrap.status,303,await bootstrap.clone().text())
 const cookieOf=response=>response.headers.getSetCookie().map(line=>line.split(';')[0]).join('; ')
 const owner=cookieOf(bootstrap)
 if(setup)await request('/setup',{method:'POST',headers:{origin,'content-type':'application/x-www-form-urlencoded',cookie:owner},body:'confirm=yes'})
 async function invite(email,role) {
  const response=await post('/auth/invite',{email,role,displayName:role},owner);assert.equal(response.status,202,await response.text())
  return accept(email)
 }
 // Follows the newest emailed sign-in or invitation link for an address and returns the session cookie.
 async function accept(email) {
  const message=sentMail.findLast(message=>JSON.stringify(message.to).includes(email))
  const link=(message?.html??'').match(/href="([^"]*\/auth\/confirm\?token=[^"]+)"/)?.[1]
  if(link){const token=new URL(link.replaceAll('&amp;','&'),origin).searchParams.get('token');const confirmed=await post('/auth/confirm',{token});assert.equal(confirmed.status,303);return cookieOf(confirmed)}
  throw new Error('Invitation not found in local outbox')
 }
 async function addSite(overrides={}) {
  const input={name:'Fern Studio',origin:'https://fern.example',paths:['/','/thanks'],goals:{signup:'/thanks'},consent:'not-required',sampleRate:100,retentionDays:90,...overrides}
  const proposed=await post('/api/vane/commands',{command:'site.create',input},owner);assert.equal(proposed.status,201,await proposed.clone().text());const p=await proposed.json()
  const approval=await form({operation:'proposal.approve',id:p.id},owner);assert.equal(approval.status,303,await approval.clone().text());return p.payload.siteId
 }
 const event=(siteId,extra={})=>({siteId,id:crypto.randomUUID(),path:'/',source:'search.example',campaign:'launch',consent:'not-required',...extra})
 const collect=(value,siteOrigin='https://fern.example')=>post('/api/vane/collect',value,'',{origin:siteOrigin})
 // Inspection for absence proofs: every row of every table, and the Worker's scheduled handler.
 const dump=async()=>{const tables=(await db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%'").all()).results.map(r=>r.name);const result={};for(let i=0;i<tables.length;i+=2)Object.assign(result,Object.fromEntries(await Promise.all(tables.slice(i,i+2).map(async name=>[name,(await db.prepare(`SELECT * FROM "${name}"`).all()).results]))));return result}
 const scheduled=async()=>(await mf.getWorker('app')).scheduled({cron:'*/5 * * * *'})
 // The product clock, moved through the local dev-key door so tests can prove gaps of minutes without waiting.
 const clock=async at=>{const r=await request('/__dev/clock',{method:'POST',headers:{'x-rer-dev-key':vars.RER_DEV_KEY,'content-type':'application/json'},body:JSON.stringify({at})});assert.equal(r.status,200,await r.clone().text())}
 const archive=async()=>{const r=await request('/api/vane/export',{headers:{cookie:owner}});assert.equal(r.status,200);return r.json()}
 return {inspectDb:db,dump,scheduled,clock,origin,cookieOf,request,post,form,owner,invite,accept,sentMail,egress,fixtureSites,addSite,event,collect,archive,close:()=>mf.dispose()}
 } catch(error) {await mf.dispose();throw error}
}

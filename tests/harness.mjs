import { Miniflare, convertV4MiniflareOptions } from 'miniflare'
import { readFile, readdir } from 'node:fs/promises'
import { resolve, join } from 'node:path'
import { createRequire } from 'node:module'
import { randomBytes } from 'node:crypto'
import assert from 'node:assert/strict'
const require=createRequire(import.meta.url),{unstable_splitSqlQuery:split}=require('wrangler')
const origin='http://127.0.0.1:8787'
export async function installation() {
 const root=resolve('dist/server'),config=JSON.parse(await readFile(join(root,'wrangler.json'),'utf8'))
 const paths=await readdir(root,{recursive:true})
 const entry=join(root,config.main)
 const modules=[entry,...paths.filter(p=>p.endsWith('.js')&&join(root,p)!==entry).map(p=>join(root,p))].map(path=>({type:'ESModule',path}))
 const vars={AUTH_LOCAL:'true',AUTH_ORIGIN:origin,OWNER_EMAIL:'owner@example.test',SESSION_SECRET:randomBytes(32).toString('hex'),SETUP_TOKEN:randomBytes(32).toString('hex'),RER_DEV_KEY:randomBytes(32).toString('hex'),MAIL_PROVIDER:'resend',MAIL_API_KEY:'test-only-network-edge',MAIL_FROM:'auth@localhost.test'}
 const sentMail=[]
 const mailEdge=async request=>{if(new URL(request.url).hostname!=='api.resend.com')throw new Error('Unexpected test egress');sentMail.push(await request.json());return Response.json({id:crypto.randomUUID()})}
 const mf=new Miniflare(convertV4MiniflareOptions({host:'127.0.0.1',port:0,cf:false,workers:[{name:'ingress',modules:true,script:`export default {fetch(request,env){const url=new URL(request.headers.get('x-original-url')),headers=new Headers(request.headers);headers.delete('x-original-url');headers.set('host',url.host);return env.APP.fetch(new Request(url,{method:request.method,headers,redirect:'manual',...(!['GET','HEAD'].includes(request.method)?{body:request.body}:{})}))}}`,serviceBindings:{APP:'app'}},{name:'app',outboundService:mailEdge,modules,modulesRoot:root,compatibilityDate:config.compatibility_date,compatibilityFlags:config.compatibility_flags,bindings:vars,d1Databases:{DB:'test-vane'},assets:{directory:resolve('dist/client'),binding:'ASSETS',routerConfig:{has_user_worker:true,invoke_user_worker_ahead_of_assets:true}}}]}))
 try {
 await mf.ready
 const db=await mf.getD1Database('DB','app')
 for(const file of (await readdir('migrations/core')).filter(p=>p.endsWith('.sql')).sort())for(const sql of split(await readFile(join('migrations/core',file),'utf8')))await db.prepare(sql).run()
 const request=(path,options={})=>mf.dispatchFetch(origin+path,{redirect:'manual',...options,headers:{'x-original-url':origin+path,...options.headers}})
 const post=(path,body,cookie='',extra={})=>request(path,{method:'POST',headers:{origin,'content-type':'application/json',cookie,...extra},body:JSON.stringify(body)})
 const form=(body,cookie)=>request('/app/action',{method:'POST',headers:{origin,'content-type':'application/x-www-form-urlencoded',cookie},body:new URLSearchParams(body).toString()})
 const bootstrap=await post('/auth/bootstrap',{token:vars.SETUP_TOKEN,displayName:'Site owner'})
 assert.equal(bootstrap.status,303,await bootstrap.clone().text())
 const cookieOf=response=>response.headers.getSetCookie().map(line=>line.split(';')[0]).join('; ')
 const owner=cookieOf(bootstrap)
 await request('/setup',{method:'POST',headers:{origin,'content-type':'application/x-www-form-urlencoded',cookie:owner},body:'confirm=yes'})
 async function invite(email,role) {
  const response=await post('/auth/invite',{email,role,displayName:role},owner);assert.equal(response.status,202,await response.text())
  const message=sentMail.findLast(message=>JSON.stringify(message.to).includes(email))
  const link=(message?.html??'').match(/href="([^"]*\/auth\/confirm\?token=[^"]+)"/)?.[1]
  if(link){const token=new URL(link.replaceAll('&amp;','&'),origin).searchParams.get('token');const confirmed=await post('/auth/confirm',{token});assert.equal(confirmed.status,303);return cookieOf(confirmed)}
  throw new Error('Invitation not found in local outbox')
 }
 async function addSite(overrides={}) {
  const input={name:'Fern Studio',origin:'https://fern.example',paths:['/','/thanks'],goals:{signup:'/thanks'},campaigns:['launch'],sources:['search.example'],consent:'not-required',sampleRate:100,retentionDays:90,...overrides}
  const proposed=await post('/api/vane/commands',{command:'site.create',input},owner);assert.equal(proposed.status,201,await proposed.clone().text());const p=await proposed.json()
  const approval=await form({operation:'proposal.approve',id:p.id},owner);assert.equal(approval.status,303,await approval.clone().text());return p.payload.siteId
 }
 const event=(siteId,extra={})=>({siteId,id:crypto.randomUUID(),path:'/',source:'search.example',campaign:'launch',consent:'not-required',...extra})
 const collect=(value,siteOrigin='https://fern.example')=>post('/api/vane/collect',value,'',{origin:siteOrigin})
 const archive=async()=>{const r=await request('/api/vane/export',{headers:{cookie:owner}});assert.equal(r.status,200);return r.json()}
 return {request,post,form,owner,invite,sentMail,addSite,event,collect,archive,close:()=>mf.dispose()}
 } catch(error) {await mf.dispose();throw error}
}

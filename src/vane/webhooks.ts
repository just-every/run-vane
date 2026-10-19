import { allow, inScope, insist, rows, site, statement, uid, type Actor, type Env } from './core'
import { auditStatement } from './audit'
import { clock } from './clock'
import { seal, unseal } from './sealed'
import { publicHttps } from './warehouse'
// API-003: signed webhooks. Events: goal.conversions, one delivery per site, goal and ended UTC minute with its count,
// never per person; traffic.alert, one delivery per sent ALERT-001 alert that names webhooks among its recipients, with
// its figures only. Follow-up and report events join before ALERT-002, FOLLOW-001 and REPORT-001/002 ship. Each body is signed as Vane-Signature: t=<unix seconds>,v1=<HMAC-SHA256 of "t.body"> with the
// endpoint's secret (shown once, sealed); Vane-Delivery stays the same on every retry so a receiver keeps one. The cron
// queues ended minutes and sends due deliveries every 5 minutes; a failed attempt is retried after 1, 5 and 30
// minutes, 2 and 6 hours, then the delivery shows as failed. The log keeps each attempt's time, status and outcome.
const PURPOSE='vane-webhook-secret-v1',MINUTE=60000,BACKOFF=[60000,300000,1800000,7200000,21600000]
export const WEBHOOK_EVENTS={'goal.conversions':'Goal conversions, counted per minute','traffic.alert':'Traffic alerts that send to webhooks (ALERT-001)'} as const
export interface Webhook { id:string; site_id:string; url:string; events_json:string; sealed_secret:string; last_minute:number; created_by:string; created_at:number }
const hex=(bytes:ArrayBuffer|Uint8Array)=>Array.from(new Uint8Array(bytes),b=>b.toString(16).padStart(2,'0')).join('')
export async function createWebhook(env:Env,actor:Actor,p:any) {
 allow(actor,'admin');const value=await site(env,String(p.siteId??''));inScope(actor,value.id)
 const url=publicHttps(String(p.url??'').trim(),true),events=Object.keys(WEBHOOK_EVENTS).filter(name=>p['event_'+name]==='on'||p.events?.includes?.(name))
 insist(url.pathname.length<=500&&String(p.url).length<=1000,'url','Enter an https address up to 1,000 characters.')
 insist(events.length>0,'events','Choose at least one event.')
 const id=uid(),secret='vane_wh_'+hex(crypto.getRandomValues(new Uint8Array(32)))
 await env.DB.batch([statement(env,'INSERT INTO vane_webhooks(id,site_id,url,events_json,sealed_secret,last_minute,created_by,created_at) VALUES(?,?,?,?,?,?,?,?)',id,value.id,url.href,JSON.stringify(events),await seal(env,PURPOSE,id,secret),Math.floor(clock()/MINUTE)-1,actor.id,clock()),auditStatement(env,actor.id,'webhook.create',value.id,`${url.host} for ${events.join(', ')}`)])
 return {siteId:value.id,secret}
}
export async function deleteWebhook(env:Env,actor:Actor,id:string) {
 allow(actor,'admin');const found=(await rows<Webhook>(env,'SELECT * FROM vane_webhooks WHERE id=?',id))[0];insist(found,'webhook','This webhook no longer exists.',404);inScope(actor,found.site_id)
 await env.DB.batch([statement(env,'DELETE FROM vane_webhooks WHERE id=?',id),statement(env,"UPDATE vane_webhook_deliveries SET state='failed' WHERE webhook_id=? AND state='pending'",id),auditStatement(env,actor.id,'webhook.delete',found.site_id,new URL(found.url).host)])
 return found.site_id
}
export const webhooks=(env:Env,siteId:string)=>rows<Webhook>(env,'SELECT * FROM vane_webhooks WHERE site_id=? ORDER BY created_at',siteId)
export const deliveryLog=(env:Env,siteId:string)=>rows<{delivery_id:string,attempt:number,at:number,status:number|null,outcome:string,event:string,state:string,url:string}>(env,'SELECT a.delivery_id,a.attempt,a.at,a.status,a.outcome,d.event,d.state,COALESCE(w.url,\'\') AS url FROM vane_webhook_attempts a JOIN vane_webhook_deliveries d ON d.id=a.delivery_id LEFT JOIN vane_webhooks w ON w.id=d.webhook_id WHERE a.site_id=? ORDER BY a.at DESC,a.attempt DESC LIMIT 50',siteId)
// Queues each ended minute's goal conversions for every endpoint that takes them.
async function queue(env:Env,now:number) {
 const ended=Math.floor(now/MINUTE)
 for(const hook of await rows<Webhook>(env,'SELECT * FROM vane_webhooks')){
  if(hook.last_minute>=ended-1)continue
  const counts=JSON.parse(hook.events_json).includes('goal.conversions')?await rows<{goal:string,minute:number,count:number}>(env,"SELECT kind AS goal,at/60000 AS minute,COUNT(*) AS count FROM vane_events WHERE site_id=? AND kind<>'pageview' AND at>=? AND at<? GROUP BY kind,at/60000 ORDER BY minute,goal",hook.site_id,(hook.last_minute+1)*MINUTE,ended*MINUTE):[]
  await env.DB.batch([...counts.map(c=>{const minute=new Date(Number(c.minute)*MINUTE).toISOString();return statement(env,"INSERT INTO vane_webhook_deliveries(id,webhook_id,site_id,event,payload,state,attempts,next_at,created_at) VALUES(?,?,?,'goal.conversions',?,'pending',0,?,?)",uid(),hook.id,hook.site_id,JSON.stringify({event:'goal.conversions',site_id:hook.site_id,goal:c.goal,minute,count:Number(c.count)}),now,now)}),statement(env,'UPDATE vane_webhooks SET last_minute=? WHERE id=?',ended-1,hook.id)])
 }
}
async function deliver(env:Env,hook:Webhook,delivery:{id:string,event:string,payload:string,attempts:number},now:number) {
 let status:number|null=null,outcome='delivered'
 try{
  const secret=await unseal(env,PURPOSE,hook.id,hook.sealed_secret),t=Math.floor(Date.now()/1000)
  const signature=hex(await crypto.subtle.sign('HMAC',await crypto.subtle.importKey('raw',new TextEncoder().encode(secret),{name:'HMAC',hash:'SHA-256'},false,['sign']),new TextEncoder().encode(`${t}.${delivery.payload}`)))
  const r=await fetch(hook.url,{method:'POST',redirect:'manual',headers:{'content-type':'application/json','user-agent':'Vane-Webhooks/1','vane-event':delivery.event,'vane-delivery':delivery.id,'vane-signature':`t=${t},v1=${signature}`},body:delivery.payload})
  status=r.status;if(!r.ok)outcome=`HTTP ${r.status}`
 }catch{outcome='no answer'}
 const attempt=delivery.attempts+1,ok=outcome==='delivered',state=ok?'delivered':attempt>BACKOFF.length?'failed':'pending'
 await env.DB.batch([statement(env,'UPDATE vane_webhook_deliveries SET state=?,attempts=?,next_at=? WHERE id=?',state,attempt,ok||state==='failed'?now:now+BACKOFF[attempt-1]!,delivery.id),statement(env,'INSERT INTO vane_webhook_attempts(delivery_id,attempt,site_id,at,status,outcome) VALUES(?,?,?,?,?,?)',delivery.id,attempt,hook.site_id,now,status,ok?'delivered':state==='failed'?`${outcome}; failed after ${attempt} attempts`:`${outcome}; retry in ${BACKOFF[attempt-1]!/60000} min`)])
}
export async function runWebhooks(env:Env,now=clock()) {
 await queue(env,now)
 const hooks=new Map((await rows<Webhook>(env,'SELECT * FROM vane_webhooks')).map(h=>[h.id,h]))
 for(const d of await rows<{id:string,webhook_id:string,event:string,payload:string,attempts:number}>(env,"SELECT id,webhook_id,event,payload,attempts FROM vane_webhook_deliveries WHERE state='pending' AND next_at<=? ORDER BY created_at LIMIT 200",now)){const hook=hooks.get(d.webhook_id);if(hook)await deliver(env,hook,d,now)}
}

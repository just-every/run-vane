import type { Bindings } from '../auth.server'
import { digest, insist, rows, site, statement, VaneError, type Env } from './core'
import { ApiRefusal, EVENT_LIMITS, type ApiKey } from './api-keys'
import { collector } from './collect'
import { customEventResponse } from './custom-events'
import { clock } from './clock'
// INSTALL-008 (ct 13:06Z): POST /api/v1/events with a site's events token. Each event takes the script's fields and
// properties (a pageview, or a custom event naming its page load) plus the caller's client_ip and user_agent, and goes
// through the same collection doors as the script: the address and agent are used in memory for the daily visitor
// hash, the device classes and the owner's exclusions and bot rules, and never stored. The caller's own network is not
// the visitor's, so the request's Cloudflare fields (country, ASN, bot score) are not applied. An Idempotency-Key is
// kept only as its SHA-256 for 24 hours, and a repeat within them answers the first request's results again.
const DAY=86400000,headers={'cache-control':'no-store','x-content-type-options':'nosniff'}
const ADDRESS=/^(?:\d{1,3}(?:\.\d{1,3}){3}|[0-9a-fA-F:.]{2,45})$/
export async function eventsDoor(request:Request,original:Bindings,env:Env,key:ApiKey):Promise<Response> {
 const value=await site(env,(JSON.parse(key.site_ids!) as string[])[0]!),text=await request.text()
 insist(text.length<=262144,'body','Send at most 256 KB.',413)
 let body:any;try{body=JSON.parse(text)}catch{throw new VaneError('json','Send a JSON body.')}
 const list:any[]=Array.isArray(body?.events)?body.events:[body]
 insist(list.length>=1&&list.length<=100&&list.every(e=>e&&typeof e==='object'&&!Array.isArray(e)),'events','Send one event object, or {"events": [...]} with 1 to 100.')
 if(list.some(e=>e.siteId!==undefined&&e.siteId!==value.id))throw new ApiRefusal('forbidden','This token sends events only for its own site.',403)
 for(const e of list)insist(typeof e.client_ip==='string'&&ADDRESS.test(e.client_ip)&&typeof e.user_agent==='string'&&e.user_agent.length>0&&e.user_agent.length<=512&&(e.type===undefined||['pageview','event'].includes(e.type)),'event','Each event names type pageview or event, the visitor’s client_ip and user_agent.')
 const now=clock(),idempotency=request.headers.get('idempotency-key')
 let hash:string|null=null
 if(idempotency!==null){
  insist(/^[\x21-\x7e]{1,200}$/.test(idempotency),'idempotency_key','An Idempotency-Key is 1 to 200 visible characters.')
  hash=await digest(idempotency)
  await env.DB.prepare('DELETE FROM vane_idempotency WHERE at<?').bind(now-DAY).run()
  const claimed=await env.DB.prepare('INSERT OR IGNORE INTO vane_idempotency(key_id,key_hash,at) VALUES(?,?,?) RETURNING key_hash').bind(key.id,hash,now).first()
  if(!claimed){const earlier=(await rows<{answer:string|null}>(env,'SELECT answer FROM vane_idempotency WHERE key_id=? AND key_hash=?',key.id,hash))[0];insist(earlier?.answer,'in_progress','The first request with this Idempotency-Key is still running.',409);return Response.json({...JSON.parse(earlier.answer!),duplicate:true},{headers})}
 }
 // The hourly event budget is taken atomically before anything is collected.
 const hour=Math.floor(now/(EVENT_LIMITS.events.seconds*1000)),budget=await env.DB.prepare("INSERT INTO vane_api_usage(key_id,scope,window,count) VALUES(?,'e',?,?) ON CONFLICT(key_id,scope,window) DO UPDATE SET count=count+excluded.count WHERE count+excluded.count<=? RETURNING count").bind(key.id,hour,list.length,EVENT_LIMITS.events.events).first()
 if(!budget||Number((budget as any).count)>EVENT_LIMITS.events.events){if(hash)await statement(env,'DELETE FROM vane_idempotency WHERE key_id=? AND key_hash=?',key.id,hash).run();throw new ApiRefusal('rate_limited',`Over ${EVENT_LIMITS.events.events} events this hour.`,429,Math.ceil(((hour+1)*EVENT_LIMITS.events.seconds*1000-now)/1000))}
 const results=[]
 for(const {type,client_ip,user_agent,...fields} of list){
  const door=type==='event'?'/api/vane/custom':'/api/vane/collect'
  const forwarded=new Request(new URL(door,env.AUTH_ORIGIN),{method:'POST',headers:{origin:value.origin,'content-type':'application/json','cf-connecting-ip':client_ip,'user-agent':user_agent},body:JSON.stringify({...fields,siteId:value.id})})
  const answer=(type==='event'?await customEventResponse(forwarded,original):await collector(forwarded,original))!
  results.push({status:answer.status,...await answer.json() as object})
 }
 const answer={accepted:results.filter(r=>r.status===202&&!(r as any).duplicate).length,results}
 if(hash)await statement(env,'UPDATE vane_idempotency SET answer=? WHERE key_id=? AND key_hash=?',JSON.stringify(answer),key.id,hash).run()
 return Response.json(answer,{headers})
}

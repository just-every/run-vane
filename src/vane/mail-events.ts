import { createD1EventStore, createDeliveryEventIntake, verifyWebhook, type DeliveryResult } from '../mail.server.mjs'
import { rows, statement, type Env } from './core'
import { auditStatement } from './audit'
import { clock } from './clock'
// REPORT-001: the installation mail provider's signed delivery events (Resend or SendGrid, keyed by MAIL_WEBHOOK_KEY)
// for report emails. Base's intake checks the signature, the event schema and its identity, and keeps every receipt and
// each recipient's newest state in D1; Vane accepts an event only for a report send it holds, to that send's address.
// A permanent bounce, a spam complaint or a provider suppression shows on the send and stops further report email to
// the address; delivered, delayed and failed show as reported. Events for other installation mail (sign-in links) are
// acknowledged and not kept. A provider event is the provider's report, never proof that a person read the email.
const PATH='/api/vane/mail-events',MAX=1048576
export const STOPS:Record<string,string>={bounced:'bounced permanently',complained:'marked as spam',rejected:'suppressed by the provider'}
export const eventsConnected=(env:Env)=>(env.MAIL_PROVIDER==='resend'||env.MAIL_PROVIDER==='sendgrid')&&Boolean(env.MAIL_WEBHOOK_KEY)
interface Send { id:string; site_id:string; email:string; provider_message_id:string|null }
const json=(status:number,body:unknown)=>Response.json(body,{status,headers:{'cache-control':'no-store'}})
// The message IDs and delivery IDs a provider body names, read only after its signature checks out.
function names(provider:string,payload:any):{messages:string[],deliveries:string[]} {
 const list=provider==='resend'?[{m:payload?.data?.email_id}]:Array.isArray(payload)?payload.map((e:any)=>({m:e?.sg_message_id,d:e?.rer_delivery_id})):[]
 return {messages:list.map((e:any)=>e.m).filter((v:any)=>typeof v==='string'),deliveries:list.map((e:any)=>e.d).filter((v:any)=>typeof v==='string')}
}
// SendGrid's event message ID extends the X-Message-Id the send returned ("<id>.<filter>..."); Resend's is the same ID.
const owns=(s:Send,messageId:string,deliveryId:string|null)=>deliveryId===s.id||!!s.provider_message_id&&(messageId===s.provider_message_id||messageId.startsWith(s.provider_message_id+'.'))
export async function mailEventResponse(request:Request,env:Env):Promise<Response|null> {
 if(new URL(request.url).pathname!==PATH)return null
 if(request.method!=='POST')return json(405,{error:'POST the mail provider’s signed delivery events here.'})
 if(!eventsConnected(env))return json(503,{error:'Delivery events are not connected: set MAIL_WEBHOOK_KEY to the Resend or SendGrid webhook key.'})
 const provider=env.MAIL_PROVIDER as 'resend'|'sendgrid',key=env.MAIL_WEBHOOK_KEY!,raw=new Uint8Array(await request.arrayBuffer()),now=clock()
 if(raw.length>MAX)return json(413,{error:'Delivery event is too large.'})
 if(!await verifyWebhook({provider,rawBody:raw,headers:request.headers,key,now}))return json(401,{error:'Invalid provider event signature.'})
 let payload:any;try{payload=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(raw))}catch{return json(400,{error:'Invalid event JSON.'})}
 const {messages,deliveries}=names(provider,payload)
 const prefixes=messages.map(m=>m.split('.')[0]!)
 const sends=await rows<Send>(env,'SELECT id,site_id,email,provider_message_id FROM vane_report_sends WHERE provider_message_id IN (SELECT value FROM json_each(?)) OR id IN (SELECT value FROM json_each(?))',JSON.stringify([...messages,...prefixes]),JSON.stringify(deliveries))
 if(!sends.length)return json(200,{ok:true,kept:false,reason:'not a report email'})
 const matched=new Map<string,Send>()
 const intake=createDeliveryEventIntake({provider,tenantId:'vane',eventNamespace:'report-email',key,store:createD1EventStore({db:env.DB}),clock,
  authorize:event=>{const s=sends.find(s=>owns(s,event.providerMessageId,event.deliveryId));if(!s||!event.recipients.every(r=>r.toLowerCase()===s.email))return false;matched.set(event.eventId,s);return true}})
 let results:DeliveryResult[]
 try{results=await intake.ingestWebhook({rawBody:raw,headers:request.headers})}catch(error:any){
  const code=String(error?.code??'')
  return json(code==='event_storage_failed'?500:code==='event_unauthorized'||code==='event_identity_conflict'?409:400,{error:code==='event_identity_conflict'?'A different event already has that provider identity.':code==='event_unauthorized'?'The event does not match a report email and its recipient.':'The provider event was refused.',code})}
 const writes=[]
 for(const result of results){const s=matched.get(result.eventId);if(!s||result.outcome!=='stored')continue
  for(const r of result.recipients){if(!r.applied||r.state.eventId!==result.eventId)continue
   writes.push(statement(env,'UPDATE vane_report_sends SET provider_status=?,provider_at=? WHERE id=?',r.state.status,r.state.occurredAt,s.id))
   if(STOPS[r.state.status])writes.push(statement(env,'INSERT INTO vane_mail_stops(email,status,occurred_at,created_at) VALUES(?,?,?,?) ON CONFLICT(email) DO NOTHING',s.email,r.state.status,r.state.occurredAt,now),auditStatement(env,`provider:${provider}`,'report.stopped',s.site_id,`the mail provider reported a report email ${STOPS[r.state.status]}; no further report email to that address`))}}
 if(writes.length)await env.DB.batch(writes)
 return json(200,{ok:true,kept:true})
}
export const mailStop=(env:Env,email:string)=>rows<{status:string,occurred_at:number}>(env,'SELECT status,occurred_at FROM vane_mail_stops WHERE email=?',email.toLowerCase()).then(r=>r[0]??null)
export const mailStops=(env:Env,emails:string[])=>rows<{email:string,status:string,occurred_at:number}>(env,'SELECT email,status,occurred_at FROM vane_mail_stops WHERE email IN (SELECT value FROM json_each(?))',JSON.stringify(emails))

import { allow, inScope, insist, rows, site, statement, uid, type Actor, type Env, type Site } from './core'
import { auditStatement } from './audit'
import { clock } from './clock'
import { instant } from './email-reports'
import { localDay } from './visitors'
import { sendPush } from './push'
import { operatorMail } from '../mail.server.mjs'
// FOLLOW-001: every sent alert opens an item for its creator with the next action "Acknowledge and check the change",
// due after the policy's reminder hours counted in business hours (Monday to Friday, start to end hour in the site's
// time zone; 9:00-17:00, 2 and 4 hours by default). The 5-minute cron reminds the responsible person once when an
// unacknowledged item passes its due time, then escalates once to the policy's second recipient at the escalation time.
// Acknowledging stops both; resolving records who, when and the outcome (real change, tracking fault fixed, expected or
// ignored); a person confirming a recovered metric resolves it as expected or real change. The owner can end the policy,
// which stops reminders on every item. A failed delivery or an alert notification never changes an item's state.
// Each change is kept in the item's history, audited, and sent to the site's webhooks taking follow.change (API-003).
const HOUR=3600000
export const OUTCOMES={'real-change':'Real change','tracking-fault':'Tracking fault fixed',expected:'Expected',ignored:'Ignored'} as const
export interface Policy { site_id:string; remind_hours:number; escalate_hours:number; second_id:string|null; start_hour:number; end_hour:number; ended:number }
export interface Item { id:string; site_id:string; alert_id:string; title:string; responsible:string; state:'open'|'acknowledged'|'resolved'; next_action:string; due_at:number; escalate_at:number; reminded_at:number|null; escalated_at:number|null; outcome:string|null; resolved_by:string|null; resolved_at:number|null; created_at:number }
export const policyOf=async(env:Env,siteId:string):Promise<Policy>=>(await rows<Policy>(env,'SELECT * FROM vane_follow_policy WHERE site_id=?',siteId))[0]??{site_id:siteId,remind_hours:2,escalate_hours:4,second_id:null,start_hour:9,end_hour:17,ended:0}
// `hours` of business time after `from`: only Monday to Friday between the start and end hour, local time.
export function businessAfter(from:number,hours:number,p:Pick<Policy,'start_hour'|'end_hour'>,zone:string):number {
 let at=from,left=hours*HOUR
 for(let i=0;i<400&&left>0;i++){
  const d=localDay(at,zone),weekday=(new Date(Date.parse(d)).getUTCDay()+6)%7,open=instant(d,p.start_hour,zone),close=instant(d,p.end_hour,zone)
  if(weekday>4||at>=close){at=instant(new Date(Date.parse(d)+86400000).toISOString().slice(0,10),p.start_hour,zone);continue}
  if(at<open)at=open
  const step=Math.min(left,close-at);at+=step;left-=step
 }
 return at
}
const people=async(env:Env,siteId:string)=>(await rows<{id:string,email:string,role:string,site_ids:string|null,name:string}>(env,"SELECT o.id,o.email,o.role,g.site_ids,COALESCE(NULLIF(o.display_name,''),o.email) AS name FROM oa_operators o LEFT JOIN vane_grants g ON g.operator_id=o.id WHERE o.status='active'")).filter(p=>p.role==='owner'||!p.site_ids||(JSON.parse(p.site_ids) as string[]).includes(siteId))
const change=(env:Env,item:{id:string,site_id:string,title:string},actor:string,action:string,detail:string,now:number,state:string,outcome:string|null=null)=>[
 statement(env,'INSERT INTO vane_follow_events(id,item_id,site_id,actor,action,detail,at) VALUES(?,?,?,?,?,?,?)',uid(),item.id,item.site_id,actor,action,detail,now),
 auditStatement(env,actor,`follow.${action}`,item.site_id,`${item.title}: ${detail}`),
 statement(env,"INSERT INTO vane_webhook_deliveries(id,webhook_id,site_id,event,payload,state,attempts,next_at,created_at) SELECT ?||w.id,w.id,w.site_id,'follow.change',?,'pending',0,?,? FROM vane_webhooks w WHERE w.site_id=? AND EXISTS(SELECT 1 FROM json_each(w.events_json) WHERE value='follow.change')",uid(),JSON.stringify({event:'follow.change',site_id:item.site_id,item_id:item.id,alert:item.title,action,state,outcome,at:new Date(now).toISOString()}),now,now,item.site_id),
]
export async function openItem(env:Env,value:Site,alertId:string,title:string,responsible:string,now:number) {
 const p=await policyOf(env,value.id),zone=value.config.timeZone??'UTC',item={id:uid(),site_id:value.id,title}
 await env.DB.batch([statement(env,"INSERT INTO vane_follow_items(id,site_id,alert_id,title,responsible,state,next_action,due_at,escalate_at,created_at) VALUES(?,?,?,?,?,'open','Acknowledge and check the change',?,?,?)",item.id,value.id,alertId,title,responsible,businessAfter(now,p.remind_hours,p,zone),businessAfter(now,p.escalate_hours,p,zone),now),...change(env,item,'alert','open','opened by the alert',now,'open')])
}
async function notify(env:Env,value:Site,to:string,subject:string,item:Item) {
 const person=(await people(env,value.id)).find(p=>p.id===to);if(!person)return 'not sent: the person can no longer open the site'
 const link=`${env.AUTH_ORIGIN.replace(/\/$/,'')}/app/sites/${encodeURIComponent(value.id)}?section=settings#follow-up`,mail=operatorMail(env)
 let emailed=false;if(mail)try{const r=await mail.send({deliveryId:uid(),from:env.MAIL_FROM!,to:[person.email],subject:`${value.name}: ${subject}`,text:`${value.name}: ${subject}: ${item.title}. Next: ${item.next_action}.\n\nOpen Vane: ${link}`} as any);emailed=r.status==='accepted'||r.status==='development'}catch{}
 const pushed=await sendPush(env,[person.id],{title:subject,site:value.name,link})
 return `to ${person.name}: email ${emailed?'accepted':'not sent'}, push accepted by ${pushed} ${pushed===1?'browser':'browsers'}`
}
export async function runFollowUps(env:Env,now=clock()) {
 for(const item of await rows<Item>(env,"SELECT * FROM vane_follow_items WHERE state='open' AND (reminded_at IS NULL AND due_at<=? OR escalated_at IS NULL AND escalate_at<=?) ORDER BY created_at LIMIT 100",now,now)){
  const value=await site(env,item.site_id),p=await policyOf(env,value.id);if(p.ended)continue
  if(item.reminded_at===null&&item.due_at<=now){const sent=await notify(env,value,item.responsible,'Follow-up reminder',item);await env.DB.batch([statement(env,'UPDATE vane_follow_items SET reminded_at=? WHERE id=?',now,item.id),...change(env,item,'system','remind',`reminder ${sent}`,now,item.state)])}
  if(item.escalated_at===null&&item.escalate_at<=now&&p.second_id){const sent=await notify(env,value,p.second_id,'Follow-up escalation',item);await env.DB.batch([statement(env,'UPDATE vane_follow_items SET escalated_at=? WHERE id=?',now,item.id),...change(env,item,'system','escalate',`escalation ${sent}`,now,item.state)])}
 }
}
async function load(env:Env,actor:Actor,id:string) {
 const item=(await rows<Item>(env,'SELECT * FROM vane_follow_items WHERE id=?',id))[0];insist(item,'item','This follow-up item no longer exists.',404);inScope(actor,item.site_id);return item
}
export async function followAction(env:Env,actor:Actor,p:any) {
 const item=await load(env,actor,String(p.id??'')),now=clock(),op=String(p.operation)
 if(op==='follow.comment'){allow(actor,'viewer');const text=String(p.text??'').trim();insist(text.length>=1&&text.length<=500&&!/[\u0000-\u001f<>]/.test(text),'text','Write a plain-text comment of up to 500 characters.');await env.DB.batch(change(env,item,actor.id,'comment',text,now,item.state));return item.site_id}
 allow(actor,'analyst');insist(item.state!=='resolved','resolved','This item is already resolved.',409)
 if(op==='follow.ack'){insist(item.state==='open','state','This item is already acknowledged.',409);await env.DB.batch([statement(env,"UPDATE vane_follow_items SET state='acknowledged',next_action='Resolve with an outcome' WHERE id=?",item.id),...change(env,item,actor.id,'acknowledge','acknowledged',now,'acknowledged')]);return item.site_id}
 if(op==='follow.assign'){const to=String(p.to??''),person=(await people(env,item.site_id)).find(x=>x.id===to);insist(person,'to','Choose a person who can open this site.');await env.DB.batch([statement(env,'UPDATE vane_follow_items SET responsible=? WHERE id=?',to,item.id),...change(env,item,actor.id,'assign',`assigned to ${person.name}`,now,item.state)]);return item.site_id}
 if(op==='follow.resolve'){const outcome=String(p.outcome??'');insist(Object.hasOwn(OUTCOMES,outcome),'outcome','Choose real change, tracking fault fixed, expected or ignored.')
  await env.DB.batch([statement(env,"UPDATE vane_follow_items SET state='resolved',outcome=?,resolved_by=?,resolved_at=?,next_action='None' WHERE id=?",outcome,actor.id,now,item.id),...change(env,item,actor.id,'resolve',`resolved: ${OUTCOMES[outcome as keyof typeof OUTCOMES]}`,now,'resolved',outcome)]);return item.site_id}
 throw new Error('unknown follow-up operation')
}
export async function savePolicy(env:Env,actor:Actor,p:any) {
 allow(actor,'owner');const value=await site(env,String(p.siteId??''))
 const remind=Number(p.remind),escalate=Number(p.escalate),start=Number(p.start??9),end=Number(p.end??17),second=String(p.second??'')||null,ended=p.ended==='on'?1:0
 insist([remind,escalate].every(n=>Number.isInteger(n)&&n>=1&&n<=168)&&escalate>remind,'hours','Escalate later than the reminder, each 1 to 168 business hours.')
 insist([start,end].every(n=>Number.isInteger(n)&&n>=0&&n<=24)&&end>start,'business','Business hours end after they start, between 0 and 24.')
 if(second)insist((await people(env,value.id)).some(x=>x.id===second),'second','Choose a person who can open this site.')
 await env.DB.batch([statement(env,'INSERT INTO vane_follow_policy(site_id,remind_hours,escalate_hours,second_id,start_hour,end_hour,ended,updated_by,updated_at) VALUES(?,?,?,?,?,?,?,?,?) ON CONFLICT(site_id) DO UPDATE SET remind_hours=excluded.remind_hours,escalate_hours=excluded.escalate_hours,second_id=excluded.second_id,start_hour=excluded.start_hour,end_hour=excluded.end_hour,ended=excluded.ended,updated_by=excluded.updated_by,updated_at=excluded.updated_at',value.id,remind,escalate,second,start,end,ended,actor.id,clock()),auditStatement(env,actor.id,'follow.policy',value.id,ended?'reminders ended':`remind after ${remind} h, escalate after ${escalate} h, ${start}:00-${end}:00`)])
 return value.id
}
export const followItems=(env:Env,siteId:string)=>rows<Item&{responsible_name:string|null,resolver_name:string|null}>(env,"SELECT i.*,COALESCE(NULLIF(r.display_name,''),r.email) AS responsible_name,COALESCE(NULLIF(x.display_name,''),x.email) AS resolver_name FROM vane_follow_items i LEFT JOIN oa_operators r ON r.id=i.responsible LEFT JOIN oa_operators x ON x.id=i.resolved_by WHERE i.site_id=? ORDER BY i.state='resolved',i.created_at DESC LIMIT 20",siteId)
export const followHistory=(env:Env,siteId:string)=>rows<{item_id:string,actor:string,action:string,detail:string,at:number}>(env,'SELECT item_id,actor,action,detail,at FROM vane_follow_events WHERE site_id=? ORDER BY at DESC LIMIT 100',siteId)
export { people as followPeople }

import { transportSummary } from '../proxy/summary'
import { digest, allow, inScope, insist, role, rows, site, statement, uid, type Actor, type Env } from '../core'
import { clock } from '../clock'
import { auditStatement } from '../audit'
import { teamActor } from '../team'
import { localDay } from '../visitors'
import { nextDue, type Subscription } from '../email-reports'
import { createInsightsService } from '../reports'
import { unseal } from '../sealed'
import { publicHttps } from '../warehouse'
import { connection, connections, PURPOSE, slack, type Connection } from './connections'
export interface Schedule {id:string;site_id:string;connection_id:string;segment_id:string|null;frequency:Subscription['frequency'];weekday:number;hour:number;next_at:number;created_by:string;created_at:number}
const shift=(day:string,n:number)=>new Date(Date.parse(day)+n*86400000).toISOString().slice(0,10)
export const schedules=(env:Env,siteId:string)=>rows<Schedule>(env,'SELECT * FROM vane_chat_schedules WHERE site_id=? ORDER BY created_at',siteId)
export const deliveryLog=(env:Env,siteId:string)=>rows<any>(env,'SELECT id,provider,label,kind,period,at,state,reason FROM vane_chat_log WHERE site_id=? ORDER BY at DESC,rowid DESC LIMIT 30',siteId)
export async function creatorActive(env:Env,id:string,siteId:string,owner=false) {
 const o=(await rows<any>(env,"SELECT id,role,display_name AS displayName FROM oa_operators WHERE id=? AND status='active'",id))[0];if(!o)return false
 const actor=await teamActor(env,o);return (owner?actor.role==='owner':actor.access!=='viewer')&&(!actor.sites||actor.sites.includes(siteId))
}
export async function subscribe(env:Env,actor:Actor,p:any) {
 role(actor);const c=await connection(env,actor,String(p.connectionId)),value=await site(env,c.site_id),frequency=String(p.frequency??'weekly') as Schedule['frequency'],weekday=Number(p.weekday??1),hour=Number(p.hour??8),segment=String(p.segment??'')||null
 insist(['daily','weekly','monthly'].includes(frequency)&&Number.isInteger(weekday)&&weekday>=1&&weekday<=7&&Number.isInteger(hour)&&hour>=0&&hour<=23,'schedule','Choose a frequency, weekday and local whole hour.')
 if(segment)insist((await rows(env,'SELECT 1 FROM vane_segments WHERE id=? AND site_id=?',segment,c.site_id)).length,'segment','Choose this site’s saved segment.')
 insist((await schedules(env,c.site_id)).length<20,'schedule','A site has at most 20 chat schedules.')
 await env.DB.batch([statement(env,'INSERT INTO vane_chat_schedules VALUES(?,?,?,?,?,?,?,?,?,?)',uid(),c.site_id,c.id,segment,frequency,weekday,hour,nextDue({frequency,weekday,hour},value.config.timeZone??'UTC',clock()),actor.id,clock()),auditStatement(env,actor.id,'chat.schedule',c.site_id,`${frequency} ${c.provider} report`)]);return c.site_id
}
export async function unsubscribe(env:Env,actor:Actor,id:string) {
 role(actor);const s=(await rows<Schedule>(env,'SELECT * FROM vane_chat_schedules WHERE id=?',id))[0];insist(s,'schedule','This schedule no longer exists.',404);inScope(actor,s.site_id)
 await env.DB.batch([statement(env,'DELETE FROM vane_chat_schedules WHERE id=?',id),auditStatement(env,actor.id,'chat.unschedule',s.site_id,'Chat report stopped')]);return s.site_id
}
// Claim before the network call. An interruption remains uncertain and is never automatically resent.
async function deliver(env:Env,c:Connection,kind:string,period:string,text:string,link:string) {
 const id=uid(),now=clock(),hooks=kind==='report'?await rows<{id:string}>(env,"SELECT w.id FROM vane_webhooks w JOIN oa_operators o ON o.id=w.created_by WHERE w.site_id=? AND o.status='active' AND o.role='owner' AND EXISTS(SELECT 1 FROM json_each(w.events_json) WHERE value='report.generated')",c.site_id):[]
 const claimed=await env.DB.batch([statement(env,"INSERT OR IGNORE INTO vane_chat_log VALUES(?,?,?,?,?,?,?,?,'uncertain','No confirmed provider result; not retried')",id,c.site_id,c.id,c.provider,c.label,kind,period,now),...hooks.map(h=>statement(env,"INSERT INTO vane_webhook_deliveries(id,webhook_id,site_id,event,payload,state,attempts,next_at,created_at) SELECT ?,?,?,'report.generated',?,'pending',0,?,? WHERE EXISTS(SELECT 1 FROM vane_chat_log WHERE id=?)",uid(),h.id,c.site_id,JSON.stringify({event:'report.generated',site_id:c.site_id,report_id:id,kind:'chat',generated_at:new Date(now).toISOString()}),now,now,id))])
 if(!claimed[0]!.meta.changes)return
 let state='failed',reason='The connection owner is no longer active for this site; not sent'
 if(await creatorActive(env,c.created_by,c.site_id,true)){
  try{
   const secret=await unseal(env,PURPOSE,c.id,c.sealed_secret)
   if(c.provider==='slack'){
    const r=await slack('chat.postMessage',secret,{channel:c.channel!,text:text+'\nOpen Vane: '+link,unfurl_links:false,unfurl_media:false} as any);state=r.ok?'accepted':'failed';reason=r.ok?'accepted by Slack; channel delivery unconfirmed':'Slack refused: '+r.error
   }else if(c.provider==='nook'){
    const credential=JSON.parse(secret),origin=publicHttps(credential.origin,true).origin
    const r=await fetch(origin+'/api/conversations/'+encodeURIComponent(c.channel!)+'/messages',{method:'POST',redirect:'manual',signal:AbortSignal.timeout(15000),headers:{authorization:'Bearer '+credential.token,'idempotency-key':'vane:'+(await digest(c.id+':'+kind+':'+period)).slice(0,59),'content-type':'application/json'},body:JSON.stringify({body:text+'\nOpen Vane: '+link})})
    state=r.ok?'accepted':'failed';reason=r.ok?'accepted by Nook':`Nook refused: HTTP ${r.status}`
   }else{
    const endpoint=publicHttps(secret,true),r=await fetch(endpoint.href,{method:'POST',redirect:'manual',signal:AbortSignal.timeout(15000),headers:{'content-type':'application/json'},body:JSON.stringify({type:'message',attachments:[{contentType:'application/vnd.microsoft.card.adaptive',contentUrl:null,content:{$schema:'http://adaptivecards.io/schemas/adaptive-card.json',type:'AdaptiveCard',version:'1.2',body:[{type:'TextBlock',text,wrap:true}],actions:[{type:'Action.OpenUrl',title:'Open Vane',url:link}]}}]})})
    state=r.ok?'accepted':'failed';reason=r.ok?'accepted by workflow; channel delivery unconfirmed':`Workflow refused: HTTP ${r.status}`
   }
  }catch{state='uncertain';reason='No confirmed provider result; check the connection. Not retried.'}
 }
 await env.DB.batch([statement(env,'UPDATE vane_chat_log SET state=?,reason=? WHERE id=?',state,reason,id),auditStatement(env,'chat-delivery','chat.'+state,c.site_id,`${kind}: ${c.provider}; ${reason}`)])
}
async function report(env:Env,c:Connection,kind:string,period:string,from:string,to:string,segment:string|null) {
 const value=await site(env,c.site_id)
 if(segment&&!(await rows(env,'SELECT 1 FROM vane_segments WHERE id=? AND site_id=?',segment,c.site_id)).length)return deliver(env,c,kind,period,'Report unavailable: the saved segment was removed.',env.AUTH_ORIGIN+'/app/sites/'+encodeURIComponent(c.site_id))
 const r=await createInsightsService(env,value,clock(),{from,to,compare:'previous',segment}).list() as any
 const link=env.AUTH_ORIGIN+'/app/sites/'+encodeURIComponent(c.site_id)+'?'+new URLSearchParams({from,to,compare:'previous',...(segment?{segment}:{})})
 // Fixed aggregate fields only: no paths, search queries, visitor hashes or custom property values in chat.
 const text=`${value.name}: ${kind==='test'?'test report':'report'} ${from} to ${shift(to,-1)} (${value.config.timeZone??'UTC'})\nVisitors: ${r.visitors} (previous ${r.previousVisitors}); visits: ${r.visits} (previous ${r.previousVisits}); pageviews: ${r.pageviews} (previous ${r.previousPageviews}); goal conversions: ${r.goals} (previous ${r.previousGoals}); bounce rate: ${r.bounceRate===null?'unavailable':r.bounceRate+'%'}.\nCoverage: partial; daily unique visitors, imports and consent limits apply.\n${transportSummary(r.transport)}`
 return deliver(env,c,kind,period,text,link)
}
export async function testDelivery(env:Env,actor:Actor,id:string) {
 role(actor);const c=await connection(env,actor,id),value=await site(env,c.site_id),today=localDay(clock(),value.config.timeZone??'UTC')
 await report(env,c,'test',uid(),shift(today,-7),today,null);return c.site_id
}
export async function runChatReports(env:Env,now=clock()) {
 await statement(env,'DELETE FROM vane_chat_states WHERE expires_at<=?',now).run()
 for(const s of await rows<Schedule>(env,'SELECT * FROM vane_chat_schedules WHERE next_at<=?',now)){
  if(!await creatorActive(env,s.created_by,s.site_id,true)){await statement(env,'DELETE FROM vane_chat_schedules WHERE id=?',s.id).run();continue}
  const c=(await connections(env,s.site_id)).find(c=>c.id===s.connection_id);if(!c)continue
  const value=await site(env,s.site_id),zone=value.config.timeZone??'UTC',to=localDay(s.next_at,zone),from=s.frequency==='monthly'?new Date(Date.UTC(+to.slice(0,4),+to.slice(5,7)-2,1)).toISOString().slice(0,10):shift(to,s.frequency==='weekly'?-7:-1)
  await report(env,c,'report',s.id+':'+to,from,to,s.segment_id)
  await statement(env,'UPDATE vane_chat_schedules SET next_at=? WHERE id=? AND next_at=?',nextDue(s,zone,now),s.id,s.next_at).run()
 }
}
export async function alertDestinations(env:Env,actor:Actor,siteId:string,p:any) {
 const ids=Object.keys(p).filter(k=>k.startsWith('chat_')&&p[k]==='on').map(k=>k.slice(5));if(!ids.length)return []
 allow(actor,'analyst');inScope(actor,siteId);const available=await connections(env,siteId)
 insist(ids.every(id=>available.some(c=>c.id===id)),'chat','Choose an owner-connected destination for this site.');return ids
}
export async function sendChatAlert(env:Env,alert:{id:string;site_id:string;created_by:string;segment_id:string|null;recipients_json:string},title:string,count:number,bound:string,now:number) {
 const ids=JSON.parse(alert.recipients_json).chat??[];if(!ids.length||!await creatorActive(env,alert.created_by,alert.site_id))return
 const available=await connections(env,alert.site_id),value=await site(env,alert.site_id),day=localDay(now,value.config.timeZone??'UTC')
 const link=env.AUTH_ORIGIN+'/app/sites/'+encodeURIComponent(alert.site_id)+'?'+new URLSearchParams({from:day,to:shift(day,1),...(alert.segment_id?{segment:alert.segment_id}:{})})
 for(const c of available.filter(c=>ids.includes(c.id)))await deliver(env,c,'alert',alert.id+':'+Math.floor(now/300000),`${value.name}: ${title}\nValue: ${count}; bound: ${bound}.\nCoverage: partial.`,link)
}

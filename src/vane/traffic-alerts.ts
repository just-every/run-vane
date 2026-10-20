import { alertDestinations, sendChatAlert } from './chat/delivery'
import { allow, inScope, insist, rows, site, statement, uid, type Actor, type Env, type Site } from './core'
import { auditStatement } from './audit'
import { clock } from './clock'
import { keptVisits } from './segments'
import { openItem } from './follow-up'
import { currentVisitors } from './realtime'
import { sendPush } from './push'
import { operatorMail } from '../mail.server.mjs'
import { escape } from './views/html'
import { localDay } from './visitors'
import { minorDigits } from './ecommerce'
import { alertExplanation } from './alert-explain'
import { count, hourToJudge, judge, localHour, maintenanceFor, windowText, WEEKDAY_NAMES } from './alert-baseline'
// ALERT-001 (first slice): fixed-threshold traffic alerts. An analyst, admin or the owner sets an alert on a site's
// current visitors (DASH-001: latest page load or engagement under 5 minutes old), or its visitors or pageviews in the
// last 60 minutes, above or below a whole-number threshold. The cron evaluates every alert every 5 minutes; when a
// value first crosses, the crossing is logged at that evaluation and sent at once to the alert's creator, by email and
// to every browser where they turned on alerts (MOBILE-001), unless the cool-down since the last send is still running,
// when it is logged as held. The alert sends again only after the value has returned inside the threshold. An alert can
// instead fire on an anomaly (alert-baseline.ts): a spike or drop outside the same weekday and hour's usual range, once
// per hour. A drop in an hour that overlaps a maintenance window, and any anomaly on a US federal holiday, is held.
// Recipients are people who can open the site (the creator by default), each by email and web push, and, when an
// admin or the owner turns it on, the site's signed webhooks (API-003 event traffic.alert). A crossing in the alert's
// quiet hours (local times, wrapping past midnight) is held and logged, not sent later. Every sent alert opens a
// follow-up item (FOLLOW-001). ALERT-002's tracking-health alerts are judged by the daily check (tracking-health.ts).
const HOUR=3600000
export const HEALTH_METRICS={'silent-site':'Tracking health: the site stops sending page loads','silent-goal':'Tracking health: a goal stops firing','silent-page':'Tracking health: a page stops sending pageviews','error-surge':'Tracking health: collection errors surge','consent-collapse':'Tracking health: the consent rate collapses'} as const
export const ALERT_METRICS={current:'Current visitors',visitors:'Visitors in the last 60 minutes',visits:'Visits in the last 60 minutes',pageviews:'Pageviews in the last 60 minutes',revenue:'Revenue in the last 60 minutes (site currency)',conversions:'Goal conversions in the last 60 minutes','conversion-rate':'Conversion rate (%) in the last 60 minutes',...HEALTH_METRICS} as const
export const isHealth=(metric:string):metric is keyof typeof HEALTH_METRICS=>Object.hasOwn(HEALTH_METRICS,metric)
type Metric=keyof typeof ALERT_METRICS
type Traffic=Exclude<Metric,keyof typeof HEALTH_METRICS>
export interface Alert { id:string; site_id:string; metric:Metric; condition:'threshold'|'anomaly'; direction:'above'|'below'; threshold:number; cooldown_hours:number; crossed:number; last_sent_at:number|null; judged_hour:number|null; recipients_json:string; quiet_from:number|null; quiet_to:number|null; segment_id:string|null; goal:string|null; created_by:string; created_at:number }
// Active people who can open a site (TEAM-001): the owner, admins and members granted every site or this one.
export async function sitePeople(env:Env,siteId:string) {
 return (await rows<{id:string,email:string,display_name:string,role:string,site_ids:string|null}>(env,"SELECT o.id,o.email,o.display_name,o.role,g.site_ids FROM oa_operators o LEFT JOIN vane_grants g ON g.operator_id=o.id WHERE o.status='active' ORDER BY o.display_name,o.email")).filter(p=>p.role==='owner'||!p.site_ids||(JSON.parse(p.site_ids) as string[]).includes(siteId)).map(p=>({id:p.id,email:p.email,name:p.display_name||p.email}))
}
const minutesOf=(text:unknown)=>{const m=/^(\d{2}):(\d{2})$/.exec(String(text??''));return m&&+m[1]!<24&&+m[2]!<60?+m[1]!*60+ +m[2]!:NaN}
export const clockText=(m:number)=>`${String(Math.floor(m/60)).padStart(2,'0')}:${String(m%60).padStart(2,'0')}`
const NAMES:Record<Metric,string>={revenue:'Revenue',visitors:'Visitors',visits:'Visits',pageviews:'Pageviews',current:'Current visitors',conversions:'Goal conversions','conversion-rate':'Conversion rate (%)',...HEALTH_METRICS}
const goalOf=(a:{goal?:string|null})=>a.goal?` for goal ${a.goal}`:''
export const alertAmount=(metric:string,amount:number,currency='USD')=>metric==='revenue'?`${currency} ${amount.toLocaleString('en-US',{minimumFractionDigits:minorDigits(currency),maximumFractionDigits:6})}`:amount.toLocaleString('en-US')
export const alertName=(a:{metric:string,condition?:string,direction:string,threshold:number,goal?:string|null},currency='USD')=>isHealth(a.metric)?`${HEALTH_METRICS[a.metric]}${a.goal?` (goal ${a.goal})`:''}`:a.condition==='anomaly'?`${NAMES[a.metric as Metric]}${a.metric==='revenue'?` (${currency})`:''}${goalOf(a)} ${a.direction==='above'?'above':'below'} the usual range for the weekday and hour`:`${ALERT_METRICS[a.metric as Metric]}${goalOf(a)} ${a.direction} ${alertAmount(a.metric,a.threshold,currency)}`
export async function createAlert(env:Env,actor:Actor,p:any) {
 allow(actor,'analyst');const value=await site(env,String(p.siteId??''));inScope(actor,value.id)
 // ALERT-002: a tracking-health alert has no threshold or comparison; the daily check finds its condition.
 const metric=String(p.metric??'') as Metric,health=isHealth(metric),direction=health?metric==='error-surge'?'above':'below':String(p.direction??'above'),condition=health?'threshold':String(p.condition??'threshold'),threshold=health||condition==='anomaly'?0:Number(p.threshold),cooldown=Number(p.cooldown??6)
 insist(Object.hasOwn(ALERT_METRICS,metric),'metric','Choose current visitors, visitors, visits, pageviews, revenue, goal conversions, the conversion rate or a tracking-health check.');insist(direction==='above'||direction==='below','direction','Choose above or below.')
 insist(condition==='threshold'||condition==='anomaly','condition','Choose a fixed threshold or the usual range.');insist(condition==='threshold'||metric!=='current','metric','The usual range is judged for visitors, visits or pageviews per hour, not current visitors.')
 const goal=String(p.goal??'')||null;if(goal){insist(metric==='conversions'||metric==='conversion-rate'||metric==='silent-goal','goal','A goal applies to goal conversions, the conversion rate or a goal that stops firing.');insist(Object.hasOwn({...value.config.goals,...value.config.customGoals},goal),'goal','Choose one of this site’s goals.')}
 insist(metric!=='consent-collapse'||value.config.consent==='required'&&value.config.declinedCounter===true,'metric','The consent rate is known only on a site that requires consent and counts declined consent.')
 insist(metric!=='conversion-rate'||threshold<=100,'threshold','A conversion rate threshold is a percentage from 0 to 100.')
 const segmentId=String(p.segment??'')||null;if(segmentId){insist(metric!=='current','segment','A segment counts visitors, visits or pageviews, not current visitors.');insist(!health,'segment','A tracking-health check watches the whole site, not a segment.');insist((await rows(env,'SELECT 1 FROM vane_segments WHERE id=? AND site_id=?',segmentId,value.id)).length,'segment','Choose one of this site’s segments.')}
 insist((metric==='revenue'?Number.isFinite(threshold)&&Math.abs(threshold*10**minorDigits(value.config.currency??'USD')-Math.round(threshold*10**minorDigits(value.config.currency??'USD')))<0.000001:Number.isInteger(threshold))&&threshold>=0&&threshold<=10000000,'threshold',metric==='revenue'?'Enter an amount from 0 to 10,000,000 in the site currency, using its minor units.':'Enter a whole-number threshold from 0 to 10,000,000.');insist(Number.isInteger(cooldown)&&cooldown>=1&&cooldown<=168,'cooldown','Enter a cool-down from 1 to 168 hours.')
 insist(Number((await rows(env,'SELECT COUNT(*) AS n FROM vane_alerts WHERE site_id=?',value.id))[0].n)<20,'alerts','A site has at most 20 alerts.')
 const allowed=await sitePeople(env,value.id),people=Object.keys(p).filter(k=>k.startsWith('person_')&&p[k]==='on').map(k=>k.slice(7)),hooks=p.webhooks==='on'
 insist(people.every(id=>allowed.some(a=>a.id===id)),'recipients','Choose people who can open this site.');if(hooks)allow(actor,'admin')
 const quiet=[p.quietFrom,p.quietTo].map(v=>String(v??'')),[quietFrom,quietTo]=quiet.map(minutesOf)
 insist(quiet.every(v=>v==='')||Number.isInteger(quietFrom)&&Number.isInteger(quietTo)&&quietFrom!==quietTo,'quiet','Enter both quiet-hour times as HH:MM, or neither.')
 const recipients=JSON.stringify({people:people.length?[...new Set(people)]:[actor.id],webhooks:hooks,chat:await alertDestinations(env,actor,value.id,p)})
 await env.DB.batch([statement(env,'INSERT INTO vane_alerts(id,site_id,metric,condition,direction,threshold,cooldown_hours,recipients_json,quiet_from,quiet_to,segment_id,goal,created_by,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)',uid(),value.id,metric,condition,direction,threshold,cooldown,recipients,quiet[0]?quietFrom:null,quiet[0]?quietTo:null,segmentId,goal,actor.id,clock()),auditStatement(env,actor.id,'alert.create',value.id,alertName({metric,condition,direction,threshold,goal},value.config.currency??'USD'))])
 return value.id
}
export async function deleteAlert(env:Env,actor:Actor,id:string) {
 const found=(await rows<Alert>(env,'SELECT * FROM vane_alerts WHERE id=?',id))[0];insist(found,'alert','This alert no longer exists.',404);inScope(actor,found.site_id)
 if(found.created_by!==actor.id)allow(actor,'admin');else allow(actor,'analyst')
 await env.DB.batch([statement(env,'DELETE FROM vane_alerts WHERE id=?',id),auditStatement(env,actor.id,'alert.delete',found.site_id,alertName(found,(await site(env,found.site_id)).config.currency??'USD'))])
 return found.site_id
}
async function measure(env:Env,value:Site,metric:Traffic,now:number,events:string,goal:string|null) {
 if(metric==='current')return currentVisitors(env,value,now)
 return count(env,value,metric,now-HOUR,now+1,events,goal)
}
async function notify(env:Env,alert:Alert,value:Site,text:string,now:number,count:number,bound:string) {
 const title=alertName(alert,value.config.currency??'USD'),link=`${env.AUTH_ORIGIN.replace(/\/$/,'')}/app/sites/${encodeURIComponent(value.id)}?section=${alert.metric==='current'?'realtime':'report'}`
 const chosen=JSON.parse(alert.recipients_json) as {people:string[],webhooks:boolean},people=(await sitePeople(env,value.id)).filter(p=>(chosen.people.length?chosen.people:[alert.created_by]).includes(p.id))
 const pushed=await sendPush(env,people.map(p=>p.id),{title,site:value.name,link}),mail=operatorMail(env),body=`${value.name}: ${title}. ${text}\n\nOpen Vane: ${link}`
 let emailed=0
 for(const person of people){if(!mail)break;try{const r=await mail.send({deliveryId:uid(),from:env.MAIL_FROM!,to:[person.email],subject:`${value.name}: ${title}`,text:body,html:`<!doctype html><html><body><p>${escape(body.split('\n')[0])}</p><p><a href="${escape(link)}">Open Vane</a></p></body></html>`} as any);if(r.status==='accepted'||r.status==='development')emailed++}catch{}}
 // API-003: one signed delivery per webhook that takes traffic alerts, with the alert's figures and no visitor field.
 const hooks=chosen.webhooks?(await rows<{id:string,events_json:string}>(env,'SELECT id,events_json FROM vane_webhooks WHERE site_id=?',value.id)).filter(h=>JSON.parse(h.events_json).includes('traffic.alert')):[]
 if(hooks.length)await env.DB.batch(hooks.map(h=>statement(env,"INSERT INTO vane_webhook_deliveries(id,webhook_id,site_id,event,payload,state,attempts,next_at,created_at) VALUES(?,?,?,'traffic.alert',?,'pending',0,?,?)",uid(),h.id,value.id,JSON.stringify({event:'traffic.alert',site_id:value.id,alert:title,metric:alert.metric,condition:isHealth(alert.metric)?'tracking-health':alert.condition,direction:alert.direction,value:count,bound,...(alert.metric==='revenue'?{currency:value.config.currency??'USD'}:{}),seen_at:new Date(now).toISOString()}),now,now)))
 await sendChatAlert(env,alert,title,count,bound,now)
 const n=(k:number,one:string,many:string)=>k===1?`one ${one}`:`${k} ${many}`
 return `sent: email accepted by the mail provider for ${n(emailed,'person','people')}; push accepted by ${n(pushed,'browser','browsers')}${chosen.webhooks?`; queued for ${n(hooks.length,'webhook','webhooks')}`:''}`
}
const log=(env:Env,alert:Alert,value:number,bound:number,now:number,sent:boolean,outcome:string,currency:string|null)=>statement(env,'INSERT INTO vane_alert_log(id,alert_id,site_id,metric,condition,direction,threshold,value,seen_at,sent_at,outcome,currency) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)',uid(),alert.id,alert.site_id,alert.metric,alert.condition,alert.direction,bound,value,now,sent?now:null,outcome,currency)
async function held(env:Env,alert:Alert,value:Site,now:number,d:string,h:number,holidayName?:string,closedName?:string,maintenance=alert.direction==='below') {
 if(alert.quiet_from!==null&&alert.quiet_to!==null){const zone=value.config.timeZone??'UTC',m=localHour(now,zone)*60+Number(new Intl.DateTimeFormat('en-US',{timeZone:zone,minute:'2-digit'}).format(now)),{quiet_from:f,quiet_to:t}=alert
  if(f<t?m>=f&&m<t:m>=f||m<t)return `held: quiet hours (${clockText(f)}–${clockText(t)})`}
 if(holidayName)return `held: ${holidayName}, a US federal holiday, is not judged against ordinary weeks`
 if(closedName)return `held: ${closedName}, a closed day in the business calendar, is not judged against ordinary weeks`
 const w=maintenance?await maintenanceFor(env,value,d,h):null
 if(w)return `held: scheduled maintenance (${windowText(w)})`
 if(alert.last_sent_at!==null&&now-alert.last_sent_at<alert.cooldown_hours*HOUR)return `held: cool-down of ${alert.cooldown_hours} h since the last send`
 return null
}
async function anomaly(env:Env,alert:Alert,value:Site,now:number,events:string) {
 const zone=value.config.timeZone??'UTC',{day:d,hour:h}=hourToJudge(now,zone,alert.direction),j=await judge(env,value,alert.metric as Exclude<Traffic,'current'>,d,h,events,alert.goal)
 if(!j||alert.judged_hour===j.start||!(alert.direction==='above'?j.value>j.high:j.value<j.low))return
 const hours=`${WEEKDAY_NAMES[(new Date(Date.parse(d)).getUTCDay()+6)%7]} ${d} ${String(h).padStart(2,'0')}:00–${String(h+1).padStart(2,'0')}:00`
 const text=`${alertAmount(alert.metric,j.value,value.config.currency??'USD')} ${NAMES[alert.metric].toLowerCase()}${goalOf(alert)} ${alert.direction==='above'?'so far in':'in'} ${hours} (${zone}); the usual range for this weekday and hour is ${alertAmount(alert.metric,j.low,value.config.currency??'USD')} to ${alertAmount(alert.metric,j.high,value.config.currency??'USD')}.`
 const reason=await held(env,alert,value,now,d,h,j.holiday,j.closed),outcome=reason??await notify(env,alert,value,`${text} ${await alertExplanation(env,value,j.start,Math.min(j.start+HOUR,now),events)}`,now,j.value,`${alertAmount(alert.metric,j.low,value.config.currency??'USD')} to ${alertAmount(alert.metric,j.high,value.config.currency??'USD')}`)
 await env.DB.batch([statement(env,'UPDATE vane_alerts SET judged_hour=?,last_sent_at=? WHERE id=?',j.start,reason?alert.last_sent_at:now,alert.id),log(env,alert,j.value,alert.metric==='revenue'?(alert.direction==='above'?j.high:j.low):Math.round(alert.direction==='above'?j.high:j.low),now,!reason,`${outcome}; usual range ${alertAmount(alert.metric,j.low,value.config.currency??'USD')} to ${alertAmount(alert.metric,j.high,value.config.currency??'USD')} for ${hours}`,alert.metric==='revenue'?value.config.currency??'USD':null)])
 if(!reason)await openItem(env,value,alert.id,alertName(alert,value.config.currency??'USD'),alert.created_by,now)
}
export async function runAlerts(env:Env,now=clock()) {
 for(const alert of await rows<Alert>(env,'SELECT * FROM vane_alerts ORDER BY created_at')){
  if(isHealth(alert.metric))continue
  const value=await site(env,alert.site_id),zone=value.config.timeZone??'UTC'
  // A segment alert reads only the segment's kept visits, found once per check over the days its windows need.
  const filters=alert.segment_id?(await rows<{filters_json:string}>(env,'SELECT filters_json FROM vane_segments WHERE id=? AND site_id=?',alert.segment_id,value.id))[0]:null
  if(alert.segment_id&&!filters)continue
  const kept=filters?await keptVisits(env,JSON.stringify([value.id]),JSON.parse(filters.filters_json),localDay(now-(alert.condition==='anomaly'?58:9)*86400000,zone),localDay(now+86400000,zone),'vane_events',value.config.sourceRules??[]):null,events=kept?.events??'vane_events'
  try{
  if(alert.condition==='anomaly'){await anomaly(env,alert,value,now,events);continue}
  const count=await measure(env,value,alert.metric,now,events,alert.goal)
  if(count===null)continue
  const crossed=alert.direction==='above'?count>alert.threshold:count<alert.threshold
  if(!crossed){if(alert.crossed)await statement(env,'UPDATE vane_alerts SET crossed=0 WHERE id=?',alert.id).run();continue}
  if(alert.crossed)continue
  const reason=await held(env,alert,value,now,localDay(now,zone),localHour(now,zone))
  const outcome=reason??await notify(env,alert,value,`Now ${alertAmount(alert.metric,count,value.config.currency??'USD')}. ${await alertExplanation(env,value,now-(alert.metric==='current'?300000:HOUR),now,events)}`,now,count,alert.metric==='revenue'?alertAmount(alert.metric,alert.threshold,value.config.currency??'USD'):String(alert.threshold))
  await env.DB.batch([statement(env,'UPDATE vane_alerts SET crossed=1,last_sent_at=? WHERE id=?',reason?alert.last_sent_at:now,alert.id),log(env,alert,count,alert.threshold,now,!reason,outcome,alert.metric==='revenue'?value.config.currency??'USD':null)])
  if(!reason)await openItem(env,value,alert.id,alertName(alert,value.config.currency??'USD'),alert.created_by,now)
  }finally{await kept?.release()}
 }
}
// ALERT-002: a tracking-health finding of the daily check goes out like a fixed-threshold crossing: once when a check
// finds it, again only after a check no longer does; inside quiet hours or the cool-down it is held and logged, not sent
// later (maintenance windows hold hourly drops, not a whole judged day). Its message explains the judged day as every
// alert does, and a sent one opens a follow-up item. A day the check does not judge changes nothing.
export async function raiseHealth(env:Env,alert:Alert,value:Site,found:{value:number,text:string,bound:string}|null|undefined,now:number,from:number,to:number) {
 if(found===undefined)return
 if(!found){if(alert.crossed)await statement(env,'UPDATE vane_alerts SET crossed=0 WHERE id=?',alert.id).run();return}
 if(alert.crossed)return
 const zone=value.config.timeZone??'UTC',reason=await held(env,alert,value,now,localDay(now,zone),localHour(now,zone),undefined,undefined,false)
 const outcome=reason??await notify(env,alert,value,`${found.text} ${await alertExplanation(env,value,from,to)}`,now,found.value,found.bound)
 await env.DB.batch([statement(env,'UPDATE vane_alerts SET crossed=1,last_sent_at=? WHERE id=?',reason?alert.last_sent_at:now,alert.id),log(env,alert,found.value,0,now,!reason,`${outcome}; ${found.bound}`,null)])
 if(!reason)await openItem(env,value,alert.id,alertName(alert),alert.created_by,now)
}
export const siteAlerts=(env:Env,siteId:string)=>rows<Alert>(env,'SELECT * FROM vane_alerts WHERE site_id=? ORDER BY created_at',siteId)
export const alertLog=(env:Env,siteId:string)=>rows<{metric:Metric,condition:string,direction:string,threshold:number,value:number,seen_at:number,sent_at:number|null,outcome:string,currency:string|null}>(env,'SELECT metric,condition,direction,threshold,value,seen_at,sent_at,outcome,currency FROM vane_alert_log WHERE site_id=? ORDER BY seen_at DESC LIMIT 20',siteId)

import { allow, inScope, insist, rows, site, statement, uid, type Actor, type Env, type Site } from './core'
import { auditStatement } from './audit'
import { clock } from './clock'
import { currentVisitors } from './realtime'
import { sendPush } from './push'
import { operatorMail } from '../mail.server.mjs'
import { escape } from './views/html'
import { localDay } from './visitors'
import { hourToJudge, judge, localHour, maintenanceFor, windowText, WEEKDAY_NAMES } from './alert-baseline'
// ALERT-001 (first slice): fixed-threshold traffic alerts. An analyst, admin or the owner sets an alert on a site's
// current visitors (DASH-001: latest page load or engagement under 5 minutes old), or its visitors or pageviews in the
// last 60 minutes, above or below a whole-number threshold. The cron evaluates every alert every 5 minutes; when a
// value first crosses, the crossing is logged at that evaluation and sent at once to the alert's creator, by email and
// to every browser where they turned on alerts (MOBILE-001), unless the cool-down since the last send is still running,
// when it is logged as held. The alert sends again only after the value has returned inside the threshold. An alert can
// instead fire on an anomaly (alert-baseline.ts): a spike or drop outside the same weekday and hour's usual range, once
// per hour. A drop in an hour that overlaps a maintenance window, and any anomaly on a US federal holiday, is held.
const HOUR=3600000
export const ALERT_METRICS={current:'Current visitors',visitors:'Visitors in the last 60 minutes',pageviews:'Pageviews in the last 60 minutes'} as const
type Metric=keyof typeof ALERT_METRICS
export interface Alert { id:string; site_id:string; metric:Metric; condition:'threshold'|'anomaly'; direction:'above'|'below'; threshold:number; cooldown_hours:number; crossed:number; last_sent_at:number|null; judged_hour:number|null; created_by:string; created_at:number }
const NAMES={visitors:'Visitors',pageviews:'Pageviews',current:'Current visitors'}
export const alertName=(a:{metric:string,condition?:string,direction:string,threshold:number})=>a.condition==='anomaly'?`${NAMES[a.metric as Metric]} ${a.direction==='above'?'above':'below'} the usual range for the weekday and hour`:`${ALERT_METRICS[a.metric as Metric]} ${a.direction} ${a.threshold.toLocaleString('en-US')}`
export async function createAlert(env:Env,actor:Actor,p:any) {
 allow(actor,'analyst');const value=await site(env,String(p.siteId??''));inScope(actor,value.id)
 const metric=String(p.metric??'') as Metric,direction=String(p.direction??'above'),condition=String(p.condition??'threshold'),threshold=condition==='anomaly'?0:Number(p.threshold),cooldown=Number(p.cooldown??6)
 insist(Object.hasOwn(ALERT_METRICS,metric),'metric','Choose current visitors, visitors or pageviews.');insist(direction==='above'||direction==='below','direction','Choose above or below.')
 insist(condition==='threshold'||condition==='anomaly','condition','Choose a fixed threshold or the usual range.');insist(condition==='threshold'||metric!=='current','metric','The usual range is judged for visitors or pageviews per hour, not current visitors.')
 insist(Number.isInteger(threshold)&&threshold>=0&&threshold<=10000000,'threshold','Enter a whole-number threshold from 0 to 10,000,000.');insist(Number.isInteger(cooldown)&&cooldown>=1&&cooldown<=168,'cooldown','Enter a cool-down from 1 to 168 hours.')
 insist(Number((await rows(env,'SELECT COUNT(*) AS n FROM vane_alerts WHERE site_id=?',value.id))[0].n)<20,'alerts','A site has at most 20 alerts.')
 await env.DB.batch([statement(env,'INSERT INTO vane_alerts(id,site_id,metric,condition,direction,threshold,cooldown_hours,created_by,created_at) VALUES(?,?,?,?,?,?,?,?,?)',uid(),value.id,metric,condition,direction,threshold,cooldown,actor.id,clock()),auditStatement(env,actor.id,'alert.create',value.id,alertName({metric,condition,direction,threshold}))])
 return value.id
}
export async function deleteAlert(env:Env,actor:Actor,id:string) {
 const found=(await rows<Alert>(env,'SELECT * FROM vane_alerts WHERE id=?',id))[0];insist(found,'alert','This alert no longer exists.',404);inScope(actor,found.site_id)
 if(found.created_by!==actor.id)allow(actor,'admin');else allow(actor,'analyst')
 await env.DB.batch([statement(env,'DELETE FROM vane_alerts WHERE id=?',id),auditStatement(env,actor.id,'alert.delete',found.site_id,alertName(found))])
 return found.site_id
}
async function measure(env:Env,value:Site,metric:Metric,now:number) {
 if(metric==='current')return currentVisitors(env,value,now)
 const day=new Date(now-2*86400000).toISOString().slice(0,10)
 const sql=metric==='pageviews'?"SELECT COUNT(*) AS n FROM vane_events WHERE site_id=? AND kind='pageview' AND day>=? AND at>? AND at<=?":"SELECT COUNT(*) AS n FROM (SELECT DISTINCT day,visitor FROM vane_events WHERE site_id=? AND kind='pageview' AND visitor IS NOT NULL AND day>=? AND at>? AND at<=?)"
 return Number((await rows<{n:number}>(env,sql,value.id,day,now-HOUR,now))[0]?.n??0)
}
async function notify(env:Env,alert:Alert,value:Site,text:string) {
 const title=alertName(alert),link=`${env.AUTH_ORIGIN.replace(/\/$/,'')}/app/sites/${encodeURIComponent(value.id)}?section=${alert.metric==='current'?'realtime':'report'}`
 const pushed=await sendPush(env,[alert.created_by],{title,site:value.name,link}),mail=operatorMail(env),to=(await rows<{email:string,status:string}>(env,'SELECT email,status FROM oa_operators WHERE id=?',alert.created_by))[0]
 let emailed=false
 if(mail&&to?.status==='active'){const body=`${value.name}: ${title}. ${text}\n\nOpen Vane: ${link}`;try{const r=await mail.send({deliveryId:uid(),from:env.MAIL_FROM!,to:[to.email],subject:`${value.name}: ${title}`,text:body,html:`<!doctype html><html><body><p>${escape(body.split('\n')[0])}</p><p><a href="${escape(link)}">Open Vane</a></p></body></html>`} as any);emailed=r.status==='accepted'||r.status==='development'}catch{emailed=false}}
 return `sent: email ${emailed?'accepted by the mail provider':'not sent'}; push accepted by ${pushed===1?'one browser':`${pushed} browsers`}`
}
const log=(env:Env,alert:Alert,value:number,bound:number,now:number,sent:boolean,outcome:string)=>statement(env,'INSERT INTO vane_alert_log(id,alert_id,site_id,metric,condition,direction,threshold,value,seen_at,sent_at,outcome) VALUES(?,?,?,?,?,?,?,?,?,?,?)',uid(),alert.id,alert.site_id,alert.metric,alert.condition,alert.direction,bound,value,now,sent?now:null,outcome)
async function held(env:Env,alert:Alert,value:Site,now:number,d:string,h:number,holidayName?:string) {
 if(holidayName)return `held: ${holidayName}, a US federal holiday, is not judged against ordinary weeks`
 const w=alert.direction==='below'?await maintenanceFor(env,value,d,h):null
 if(w)return `held: scheduled maintenance (${windowText(w)})`
 if(alert.last_sent_at!==null&&now-alert.last_sent_at<alert.cooldown_hours*HOUR)return `held: cool-down of ${alert.cooldown_hours} h since the last send`
 return null
}
async function anomaly(env:Env,alert:Alert,value:Site,now:number) {
 const zone=value.config.timeZone??'UTC',{day:d,hour:h}=hourToJudge(now,zone,alert.direction),j=await judge(env,value,alert.metric as 'visitors'|'pageviews',d,h)
 if(!j||alert.judged_hour===j.start||!(alert.direction==='above'?j.value>j.high:j.value<j.low))return
 const hours=`${WEEKDAY_NAMES[(new Date(Date.parse(d)).getUTCDay()+6)%7]} ${d} ${String(h).padStart(2,'0')}:00–${String(h+1).padStart(2,'0')}:00`
 const text=`${j.value.toLocaleString('en-US')} ${alert.metric} ${alert.direction==='above'?'so far in':'in'} ${hours} (${zone}); the usual range for this weekday and hour is ${j.low} to ${j.high}.`
 const reason=await held(env,alert,value,now,d,h,j.holiday),outcome=reason??await notify(env,alert,value,text)
 await env.DB.batch([statement(env,'UPDATE vane_alerts SET judged_hour=?,last_sent_at=? WHERE id=?',j.start,reason?alert.last_sent_at:now,alert.id),log(env,alert,j.value,Math.round(alert.direction==='above'?j.high:j.low),now,!reason,`${outcome}; usual range ${j.low} to ${j.high} for ${hours}`)])
}
export async function runAlerts(env:Env,now=clock()) {
 for(const alert of await rows<Alert>(env,'SELECT * FROM vane_alerts ORDER BY created_at')){
  const value=await site(env,alert.site_id)
  if(alert.condition==='anomaly'){await anomaly(env,alert,value,now);continue}
  const count=await measure(env,value,alert.metric,now),crossed=alert.direction==='above'?count>alert.threshold:count<alert.threshold
  if(!crossed){if(alert.crossed)await statement(env,'UPDATE vane_alerts SET crossed=0 WHERE id=?',alert.id).run();continue}
  if(alert.crossed)continue
  const zone=value.config.timeZone??'UTC',reason=await held(env,alert,value,now,localDay(now,zone),localHour(now,zone))
  const outcome=reason??await notify(env,alert,value,`Now ${count.toLocaleString('en-US')}.`)
  await env.DB.batch([statement(env,'UPDATE vane_alerts SET crossed=1,last_sent_at=? WHERE id=?',reason?alert.last_sent_at:now,alert.id),log(env,alert,count,alert.threshold,now,!reason,outcome)])
 }
}
export const siteAlerts=(env:Env,siteId:string)=>rows<Alert>(env,'SELECT * FROM vane_alerts WHERE site_id=? ORDER BY created_at',siteId)
export const alertLog=(env:Env,siteId:string)=>rows<{metric:Metric,condition:string,direction:string,threshold:number,value:number,seen_at:number,sent_at:number|null,outcome:string}>(env,'SELECT metric,condition,direction,threshold,value,seen_at,sent_at,outcome FROM vane_alert_log WHERE site_id=? ORDER BY seen_at DESC LIMIT 20',siteId)

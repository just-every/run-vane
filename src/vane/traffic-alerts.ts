import { allow, inScope, insist, rows, site, statement, uid, type Actor, type Env, type Site } from './core'
import { auditStatement } from './audit'
import { clock } from './clock'
import { currentVisitors } from './realtime'
import { sendPush } from './push'
import { operatorMail } from '../mail.server.mjs'
import { escape } from './views/html'
// ALERT-001 (first slice): fixed-threshold traffic alerts. An analyst, admin or the owner sets an alert on a site's
// current visitors (DASH-001: latest page load or engagement under 5 minutes old), or its visitors or pageviews in the
// last 60 minutes, above or below a whole-number threshold. The cron evaluates every alert every 5 minutes; when a
// value first crosses, the crossing is logged at that evaluation and sent at once to the alert's creator, by email and
// to every browser where they turned on alerts (MOBILE-001), unless the cool-down since the last send is still running,
// when it is logged as held. The alert sends again only after the value has returned inside the threshold.
const HOUR=3600000
export const ALERT_METRICS={current:'Current visitors',visitors:'Visitors in the last 60 minutes',pageviews:'Pageviews in the last 60 minutes'} as const
type Metric=keyof typeof ALERT_METRICS
export interface Alert { id:string; site_id:string; metric:Metric; direction:'above'|'below'; threshold:number; cooldown_hours:number; crossed:number; last_sent_at:number|null; created_by:string; created_at:number }
export async function createAlert(env:Env,actor:Actor,p:any) {
 allow(actor,'analyst');const value=await site(env,String(p.siteId??''));inScope(actor,value.id)
 const metric=String(p.metric??'') as Metric,direction=String(p.direction??'above'),threshold=Number(p.threshold),cooldown=Number(p.cooldown??6)
 insist(Object.hasOwn(ALERT_METRICS,metric),'metric','Choose current visitors, visitors or pageviews.');insist(direction==='above'||direction==='below','direction','Choose above or below.')
 insist(Number.isInteger(threshold)&&threshold>=0&&threshold<=10000000,'threshold','Enter a whole-number threshold from 0 to 10,000,000.');insist(Number.isInteger(cooldown)&&cooldown>=1&&cooldown<=168,'cooldown','Enter a cool-down from 1 to 168 hours.')
 insist(Number((await rows(env,'SELECT COUNT(*) AS n FROM vane_alerts WHERE site_id=?',value.id))[0].n)<20,'alerts','A site has at most 20 alerts.')
 await env.DB.batch([statement(env,'INSERT INTO vane_alerts(id,site_id,metric,direction,threshold,cooldown_hours,created_by,created_at) VALUES(?,?,?,?,?,?,?,?)',uid(),value.id,metric,direction,threshold,cooldown,actor.id,clock()),auditStatement(env,actor.id,'alert.create',value.id,`${ALERT_METRICS[metric]} ${direction} ${threshold}`)])
 return value.id
}
export async function deleteAlert(env:Env,actor:Actor,id:string) {
 const found=(await rows<Alert>(env,'SELECT * FROM vane_alerts WHERE id=?',id))[0];insist(found,'alert','This alert no longer exists.',404);inScope(actor,found.site_id)
 if(found.created_by!==actor.id)allow(actor,'admin');else allow(actor,'analyst')
 await env.DB.batch([statement(env,'DELETE FROM vane_alerts WHERE id=?',id),auditStatement(env,actor.id,'alert.delete',found.site_id,`${ALERT_METRICS[found.metric]} ${found.direction} ${found.threshold}`)])
 return found.site_id
}
async function measure(env:Env,value:Site,metric:Metric,now:number) {
 if(metric==='current')return currentVisitors(env,value,now)
 const day=new Date(now-2*86400000).toISOString().slice(0,10)
 const sql=metric==='pageviews'?"SELECT COUNT(*) AS n FROM vane_events WHERE site_id=? AND kind='pageview' AND day>=? AND at>? AND at<=?":"SELECT COUNT(*) AS n FROM (SELECT DISTINCT day,visitor FROM vane_events WHERE site_id=? AND kind='pageview' AND visitor IS NOT NULL AND day>=? AND at>? AND at<=?)"
 return Number((await rows<{n:number}>(env,sql,value.id,day,now-HOUR,now))[0]?.n??0)
}
async function notify(env:Env,alert:Alert,value:Site,count:number) {
 const title=`${ALERT_METRICS[alert.metric]} ${alert.direction} ${alert.threshold.toLocaleString('en-US')}`,link=`${env.AUTH_ORIGIN.replace(/\/$/,'')}/app/sites/${encodeURIComponent(value.id)}?section=${alert.metric==='current'?'realtime':'report'}`
 const pushed=await sendPush(env,[alert.created_by],{title,site:value.name,link}),mail=operatorMail(env),to=(await rows<{email:string,status:string}>(env,'SELECT email,status FROM oa_operators WHERE id=?',alert.created_by))[0]
 let emailed=false
 if(mail&&to?.status==='active'){const text=`${value.name}: ${title}. Now ${count.toLocaleString('en-US')}.\n\nOpen Vane: ${link}`;try{const r=await mail.send({deliveryId:uid(),from:env.MAIL_FROM!,to:[to.email],subject:`${value.name}: ${title}`,text,html:`<!doctype html><html><body><p>${escape(text.split('\n')[0])}</p><p><a href="${escape(link)}">Open Vane</a></p></body></html>`} as any);emailed=r.status==='accepted'||r.status==='development'}catch{emailed=false}}
 return `sent: email ${emailed?'accepted by the mail provider':'not sent'}; push accepted by ${pushed===1?'one browser':`${pushed} browsers`}`
}
export async function runAlerts(env:Env,now=clock()) {
 for(const alert of await rows<Alert>(env,'SELECT * FROM vane_alerts ORDER BY created_at')){
  const value=await site(env,alert.site_id),count=await measure(env,value,alert.metric,now),crossed=alert.direction==='above'?count>alert.threshold:count<alert.threshold
  if(!crossed){if(alert.crossed)await statement(env,'UPDATE vane_alerts SET crossed=0 WHERE id=?',alert.id).run();continue}
  if(alert.crossed)continue
  const cooling=alert.last_sent_at!==null&&now-alert.last_sent_at<alert.cooldown_hours*HOUR
  const outcome=cooling?`held: cool-down of ${alert.cooldown_hours} h since the last send`:await notify(env,alert,value,count)
  await env.DB.batch([statement(env,'UPDATE vane_alerts SET crossed=1,last_sent_at=? WHERE id=?',cooling?alert.last_sent_at:now,alert.id),statement(env,'INSERT INTO vane_alert_log(id,alert_id,site_id,metric,direction,threshold,value,seen_at,sent_at,outcome) VALUES(?,?,?,?,?,?,?,?,?,?)',uid(),alert.id,alert.site_id,alert.metric,alert.direction,alert.threshold,count,now,cooling?null:now,outcome)])
 }
}
export const siteAlerts=(env:Env,siteId:string)=>rows<Alert>(env,'SELECT * FROM vane_alerts WHERE site_id=? ORDER BY created_at',siteId)
export const alertLog=(env:Env,siteId:string)=>rows<{metric:Metric,direction:string,threshold:number,value:number,seen_at:number,sent_at:number|null,outcome:string}>(env,'SELECT metric,direction,threshold,value,seen_at,sent_at,outcome FROM vane_alert_log WHERE site_id=? ORDER BY seen_at DESC LIMIT 20',siteId)

import { allow, inScope, insist, rows, site, sites, statement, type Actor, type Env, type Site } from './core'
import { auditStatement } from './audit'
import { clock } from './clock'
import { localDay } from './visitors'
import { instant } from './email-reports'
import { BASELINE_WEEKS, MIN_BASELINE_DAYS } from './explain'
import { holiday, localHour, T95, WEEKDAY_NAMES } from './alert-baseline'
import { clockText, HEALTH_METRICS, raiseHealth, type Alert } from './traffic-alerts'
// ALERT-002: the daily tracking-health check. Once a day, at the first 5-minute cron run at or after the local time the
// owner sets (09:00 by default, in the site's time zone), Vane judges the local day before against its baseline days:
// the same weekday in the 8 weeks before, leaving out US federal holidays, closed days and days before the site's first
// event (REPORT-003's baseline days), with at least 4 of them. A US federal holiday or a closed day is not judged. It finds
// - a silent site: no page load on the day, after page loads on every baseline day;
// - a silent goal: a goal with no conversion on the day, after conversions on every baseline day, while page loads
//   continue; it names the latest deploy or release annotation (DASH-009) dated from its last conversion's day on;
// - a silent page: a stored path (after the site's rewrite rules, so a template such as /orders/:id is one path) with no
//   pageview on the day, after pageviews on every baseline day, while the rest of the site still sends;
// - a collection-error surge: at least 10 page loads refused as collection errors (COVERAGE-001) on the day, more than
//   the top of the baseline days' 95% prediction interval (mean + t·s·√(1 + 1/n), one decimal);
// - a consent-rate collapse, on a site that requires consent and counts declined consent: with at least 20 page loads
//   reaching Vane on the day, admitted page loads over admitted plus declined ones fall under half their mean rate on
//   the baseline days (each day with a page load reaching Vane, at least 4).
// The overview reads how many of the site's goals converted on the judged day, and when the check ran.
const DAY=86400000,DEFAULT_MINUTE=9*60,MIN_ERRORS=10,MIN_REACHED=20,PAGES_LISTED=10
const shift=(d:string,n:number)=>new Date(Date.parse(d)+n*DAY).toISOString().slice(0,10)
const weekdayOf=(d:string)=>WEEKDAY_NAMES[(new Date(Date.parse(d)).getUTCDay()+6)%7]!
const round1=(n:number)=>Math.round(n*10)/10
export interface HealthResult { day:string; baseline:string[]; notJudged:string|null; pageviews:number; goals:{name:string,conversions:number}[]; siteSilent:boolean; silentGoals:{name:string,last:string|null,deploy:{day:string,kind:string,text:string}|null}[]; silentPages:string[]; errors:{count:number,low:number,high:number,surge:boolean}; consent:{rate:number,usual:number,reached:number,collapse:boolean}|null }
export async function checkHealth(env:Env,value:Site,now:number):Promise<HealthResult> {
 const zone=value.config.timeZone??'UTC',day=shift(localDay(now,zone),-1)
 const first=(await rows<{d:string|null}>(env,'SELECT MIN(day) AS d FROM vane_events WHERE site_id=?',value.id))[0]?.d??null
 const closed=Object.fromEntries((await rows<{day:string,label:string}>(env,'SELECT day,label FROM vane_closed_days WHERE site_id=?',value.id)).map(r=>[r.day,r.label]))
 const baseline=Array.from({length:BASELINE_WEEKS},(_,i)=>shift(day,-7*(i+1))).filter(b=>!holiday(b)&&!closed[b]&&first!==null&&b>=first),days=JSON.stringify([day,...baseline])
 const within='site_id=? AND day IN (SELECT value FROM json_each(?))'
 const [loads,converted,counted]=await Promise.all([
  rows<{day:string,n:number}>(env,`SELECT day,COUNT(*) AS n FROM vane_events WHERE ${within} AND kind='pageview' GROUP BY day`,value.id,days),
  rows<{day:string,kind:string,n:number}>(env,`SELECT day,kind,COUNT(*) AS n FROM vane_events WHERE ${within} AND kind<>'pageview' GROUP BY day,kind`,value.id,days),
  rows<{day:string,reason:string,n:number}>(env,`SELECT day,reason,SUM(count) AS n FROM vane_exclusions WHERE ${within} AND reason IN ('collection-error','consent-declined') GROUP BY day,reason`,value.id,days)])
 const table=(list:{day:string,n:number}[],key:(r:any)=>string=()=>'')=>{const m=new Map<string,number>();for(const r of list)m.set(r.day+'\t'+key(r),(m.get(r.day+'\t'+key(r))??0)+Number(r.n));return (d:string,k='')=>m.get(d+'\t'+k)??0}
 const pageviewsOn=table(loads),conversionsOn=table(converted,r=>r.kind),errorsOn=table(counted.filter(r=>r.reason==='collection-error')),declinedOn=table(counted.filter(r=>r.reason==='consent-declined'))
 const pageviews=pageviewsOn(day),names=Object.keys({...value.config.goals,...value.config.scrollGoals,...value.config.customGoals}),goals=names.map(name=>({name,conversions:conversionsOn(day,name)}))
 const notJudged=holiday(day)?`${holiday(day)}, a US federal holiday`:closed[day]?`${closed[day]}, a closed day in the business calendar`:baseline.length<MIN_BASELINE_DAYS?`fewer than ${MIN_BASELINE_DAYS} earlier ${weekdayOf(day)}s to compare`:null
 const judged=notJudged===null,everyBaseline=(n:(d:string)=>number)=>baseline.every(d=>n(d)>0)
 const xs=baseline.map(d=>errorsOn(d)),n=xs.length,mean=n?xs.reduce((a,x)=>a+x,0)/n:0,sd=n>1?Math.sqrt(xs.reduce((a,x)=>a+(x-mean)**2,0)/(n-1)):0,half=judged?T95[n-1]!*sd*Math.sqrt(1+1/n):0
 const errors={count:errorsOn(day),low:Math.max(0,round1(mean-half)),high:round1(mean+half),surge:false};errors.surge=judged&&errors.count>=MIN_ERRORS&&errors.count>errors.high
 let silentGoals:HealthResult['silentGoals']=[],silentPages:string[]=[]
 if(judged&&pageviews>0){
  silentGoals=await Promise.all(goals.filter(g=>g.conversions===0&&everyBaseline(d=>conversionsOn(d,g.name))).map(async g=>{
   const last=(await rows<{d:string|null}>(env,"SELECT MAX(day) AS d FROM vane_events WHERE site_id=? AND kind=? AND day<?",value.id,g.name,day))[0]?.d??null
   const deploy=(await rows<{day:string,kind:string,text:string}>(env,"SELECT day,kind,text FROM vane_annotations WHERE site_id=? AND kind IN ('deploy','release') AND day>=? AND day<=? ORDER BY at DESC LIMIT 1",value.id,last??day,day))[0]??null
   return {name:g.name,last,deploy}
  }))
  silentPages=(await rows<{path:string}>(env,"SELECT path,COUNT(*) AS n FROM vane_events WHERE site_id=?1 AND kind='pageview' AND day IN (SELECT value FROM json_each(?2)) GROUP BY path HAVING COUNT(DISTINCT day)=?3 AND path NOT IN (SELECT path FROM vane_events WHERE site_id=?1 AND kind='pageview' AND day=?4) ORDER BY n DESC,path LIMIT ?5",value.id,JSON.stringify(baseline),baseline.length,day,PAGES_LISTED)).map(r=>r.path)
 }
 let consent:HealthResult['consent']=null
 if(value.config.consent==='required'&&value.config.declinedCounter===true){
  const rates=baseline.flatMap(d=>{const reached=pageviewsOn(d)+declinedOn(d);return reached?[pageviewsOn(d)/reached]:[]}),reached=pageviews+declinedOn(day),usual=rates.length?rates.reduce((a,r)=>a+r,0)/rates.length:0,rate=reached?pageviews/reached:0
  consent={rate:round1(rate*100),usual:round1(usual*100),reached,collapse:judged&&rates.length>=MIN_BASELINE_DAYS&&reached>=MIN_REACHED&&rate<usual/2}
 }
 return {day,baseline,notJudged,pageviews,goals,siteSilent:judged&&pageviews===0&&everyBaseline(pageviewsOn),silentGoals,silentPages,errors,consent}
}
type Found={value:number,text:string,bound:string}
// What a tracking-health alert reports from a check: undefined when the day was not judged, null when its condition is clear.
function finding(alert:Alert,r:HealthResult,zone:string):Found|null|undefined {
 if(r.notJudged)return undefined
 const on=`on ${r.day} (${zone})`,base=`each of the ${r.baseline.length} earlier ${weekdayOf(r.day)}s compared (${r.baseline.join(', ')})`
 if(alert.metric==='silent-site')return r.siteSilent?{value:0,text:`No page load arrived ${on}; the site had page loads on ${base}.`,bound:`page loads on ${base}`}:null
 if(alert.metric==='silent-goal'){
  const goals=r.silentGoals.filter(g=>!alert.goal||g.name===alert.goal)
  return goals.length?{value:goals.length,text:`${goals.map(g=>`Goal ${g.name} had no conversion ${on}${g.deploy?`, after the ${g.deploy.kind} “${g.deploy.text}” on ${g.deploy.day}`:', with no deploy or release annotated since its last conversion'}; it converted on ${base}, last on ${g.last}`).join('. ')}. The site had ${r.pageviews} page loads that day.`,bound:`conversions on ${base}`}:null
 }
 if(alert.metric==='silent-page')return r.silentPages.length?{value:r.silentPages.length,text:`${r.silentPages.join(', ')} sent no pageview ${on} while the rest of the site sent ${r.pageviews}; ${r.silentPages.length===1?'it':'each'} had pageviews on ${base}.`,bound:`pageviews on ${base}`}:null
 if(alert.metric==='error-surge')return r.errors.surge?{value:r.errors.count,text:`${r.errors.count} page loads were refused as collection errors ${on}; the usual range for a ${weekdayOf(r.day)} is ${r.errors.low} to ${r.errors.high}.`,bound:`${r.errors.low} to ${r.errors.high}`}:null
 if(alert.metric==='consent-collapse')return r.consent?.collapse?{value:r.consent.rate,text:`The consent rate fell to ${r.consent.rate}% of the ${r.consent.reached} page loads that reached Vane ${on}, under half its usual ${r.consent.usual}% on ${base}.`,bound:`under ${round1(r.consent.usual/2)}%`}:null
 return null
}
const localMinute=(at:number,zone:string)=>localHour(at,zone)*60+Number(new Intl.DateTimeFormat('en-US',{timeZone:zone,minute:'2-digit'}).format(at))
export async function runHealth(env:Env,now=clock()) {
 const metrics=JSON.stringify(Object.keys(HEALTH_METRICS))
 for(const value of await sites(env)){
  const zone=value.config.timeZone??'UTC',today=localDay(now,zone),state=(await rows<{check_minute:number,checked_day:string|null}>(env,'SELECT check_minute,checked_day FROM vane_health WHERE site_id=?',value.id))[0],minute=state?.check_minute??DEFAULT_MINUTE
  if(state?.checked_day===today||localMinute(now,zone)<minute)continue
  const result=await checkHealth(env,value,now)
  await statement(env,'INSERT INTO vane_health(site_id,check_minute,checked_day,checked_at,result_json) VALUES(?,?,?,?,?) ON CONFLICT(site_id) DO UPDATE SET checked_day=excluded.checked_day,checked_at=excluded.checked_at,result_json=excluded.result_json',value.id,minute,today,now,JSON.stringify(result)).run()
  const from=instant(result.day,0,zone),to=instant(shift(result.day,1),0,zone)
  for(const alert of await rows<Alert>(env,'SELECT * FROM vane_alerts WHERE site_id=? AND metric IN (SELECT value FROM json_each(?)) ORDER BY created_at',value.id,metrics))await raiseHealth(env,alert,value,finding(alert,result,zone),now,from,to)
 }
}
// Only the owner sets the daily check's local time; the change is audited.
export async function setHealthTime(env:Env,actor:Actor,p:any) {
 allow(actor,'owner');const value=await site(env,String(p.siteId??''));inScope(actor,value.id)
 const m=/^(\d{2}):(\d{2})$/.exec(String(p.time??'')),minute=m&&+m[1]!<24&&+m[2]!<60?+m[1]!*60+ +m[2]!:NaN
 insist(Number.isInteger(minute),'time','Enter the daily check time as HH:MM.')
 await env.DB.batch([statement(env,'INSERT INTO vane_health(site_id,check_minute) VALUES(?,?) ON CONFLICT(site_id) DO UPDATE SET check_minute=excluded.check_minute',value.id,minute),auditStatement(env,actor.id,'health.time',value.id,clockText(minute))])
 return value.id
}
export type Health={minute:number,checkedAt:number|null,result:HealthResult|null}
export async function healthOf(env:Env,siteId:string):Promise<Health> {
 const r=(await rows<{check_minute:number,checked_at:number|null,result_json:string|null}>(env,'SELECT check_minute,checked_at,result_json FROM vane_health WHERE site_id=?',siteId))[0]
 return {minute:r?.check_minute??DEFAULT_MINUTE,checkedAt:r?.checked_at??null,result:r?.result_json?JSON.parse(r.result_json) as HealthResult:null}
}
// The overview's tracking-health line: the goals that converted on the judged day out of the site's goals, and when it ran.
export function healthLine(h:Health,zone:string):string {
 if(!h.result||h.checkedAt===null)return `Tracking health: first check at ${clockText(h.minute)} (${zone})`
 const goals=h.result.goals,tracking=goals.filter(g=>g.conversions>0).length,silent=goals.filter(g=>!g.conversions).map(g=>g.name)
 const at=new Intl.DateTimeFormat('en-US',{timeZone:zone,weekday:'short',month:'short',day:'numeric',hour:'numeric',minute:'2-digit',timeZoneName:'short'}).format(h.checkedAt)
 return `${!goals.length?'No goals to track':tracking===goals.length?goals.length===1?'1 goal tracking':`All ${goals.length} goals tracking`:`${tracking} of ${goals.length} goals tracking (no conversion on ${h.result.day}: ${silent.join(', ')})`} · checked ${at}`
}

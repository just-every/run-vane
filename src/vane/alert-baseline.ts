import { allow, inScope, insist, rows, site, statement, uid, type Actor, type Env, type Site } from './core'
import { auditStatement } from './audit'
import { clock } from './clock'
import { BASELINE_WEEKS, MIN_BASELINE_DAYS, usHolidays } from './explain'
import { instant } from './email-reports'
import { localDay } from './visitors'
import { timedFrom } from './visits'
// ALERT-001: the anomaly condition and scheduled maintenance. An hour's visitors or pageviews are judged against the
// same weekday and local hour in the 8 weeks before, leaving out US federal holidays, with REPORT-003's interval
// (mean ± t·s·√(1 + 1/n), at least 4 baseline hours). A spike is judged on the running hour, as soon as its count
// passes the interval's top; a drop on the hour just ended, below the interval's bottom. An hour on a US federal
// holiday is not judged against ordinary weeks: a crossing on it is logged as held. Maintenance windows are local times
// in the site's time zone, one-off (a date) or weekly (a weekday), and a drop in an hour that overlaps one is held.
// The business calendar's closed days (owner and admins) are left out of baselines too, and an hour on one is held.
const HOUR=3600000,DAY=86400000
const T95:Record<number,number>={3:3.182,4:2.776,5:2.571,6:2.447,7:2.365}
export const WEEKDAY_NAMES=['Monday','Tuesday','Wednesday','Thursday','Friday','Saturday','Sunday']
export interface Window { id:string; site_id:string; kind:'once'|'weekly'; weekday:number|null; day:string|null; start_minute:number; end_minute:number; created_by:string; created_at:number }
const shift=(d:string,n:number)=>new Date(Date.parse(d)+n*DAY).toISOString().slice(0,10)
export const localHour=(at:number,timeZone:string)=>Number(new Intl.DateTimeFormat('en-US',{timeZone,hourCycle:'h23',hour:'2-digit'}).format(at))
const weekdayOf=(d:string)=>(new Date(Date.parse(d)).getUTCDay()+6)%7+1
export const holiday=(d:string)=>usHolidays(Number(d.slice(0,4)))[d]
// Visitors, visits or pageviews in [from, to) from `events` (the site's events, or a segment's kept visits). A visit
// counts in the window it starts in.
export async function count(env:Env,value:Site,metric:'visitors'|'visits'|'pageviews',from:number,to:number,events='vane_events') {
 const day=new Date(from-DAY).toISOString().slice(0,10)
 if(metric==='visits')return Number((await env.DB.prepare(`${timedFrom(events)} SELECT COUNT(*) AS n FROM v WHERE started>=?5 AND started<?6`).bind(JSON.stringify([value.id]),day,new Date(to+DAY).toISOString().slice(0,10),null,from,to).first<{n:number}>())?.n??0)
 const base=`FROM ${events} e WHERE e.site_id=? AND e.kind='pageview' AND e.day>=? AND e.at>=? AND e.at<?`
 return Number((await rows<{n:number}>(env,metric==='pageviews'?`SELECT COUNT(*) AS n ${base}`:`SELECT COUNT(*) AS n FROM (SELECT DISTINCT e.day,e.visitor ${base} AND e.visitor IS NOT NULL)`,value.id,day,from,to))[0]?.n??0)
}
export interface Judgment { start:number; day:string; hour:number; value:number; low:number; high:number; holiday?:string; closed?:string }
// The hour starting at `start` (local day `d`, hour `h`) with its baseline interval, or null without 4 baseline hours.
export async function judge(env:Env,value:Site,metric:'visitors'|'visits'|'pageviews',d:string,h:number,events='vane_events'):Promise<Judgment|null> {
 const zone=value.config.timeZone??'UTC',start=instant(d,h,zone),first=(await rows<{d:string|null}>(env,"SELECT MIN(day) AS d FROM vane_events WHERE site_id=?",value.id))[0]?.d??null
 const closed=Object.fromEntries((await rows<{day:string,label:string}>(env,'SELECT day,label FROM vane_closed_days WHERE site_id=?',value.id)).map(r=>[r.day,r.label]))
 const base=Array.from({length:BASELINE_WEEKS},(_,i)=>shift(d,-7*(i+1))).filter(b=>!holiday(b)&&!closed[b]&&first!==null&&b>=first)
 if(base.length<MIN_BASELINE_DAYS)return null
 const xs=await Promise.all(base.map(b=>{const s=instant(b,h,zone);return count(env,value,metric,s,s+HOUR,events)})),n=xs.length,mean=xs.reduce((a,x)=>a+x,0)/n,sd=Math.sqrt(xs.reduce((a,x)=>a+(x-mean)**2,0)/(n-1)),half=T95[n-1]!*sd*Math.sqrt(1+1/n)
 const v=await count(env,value,metric,start,Math.min(start+HOUR,clock()+1),events)
 return {start,day:d,hour:h,value:v,low:Math.round((mean-half)*10)/10,high:Math.round((mean+half)*10)/10,...(holiday(d)?{holiday:holiday(d)}:{}),...(closed[d]?{closed:closed[d]}:{})}
}
// The hour to judge now: the running one for a spike, the one just ended for a drop.
export function hourToJudge(now:number,timeZone:string,direction:'above'|'below') {
 const at=direction==='above'?now:now-HOUR
 return {day:localDay(at,timeZone),hour:localHour(at,timeZone)}
}
export async function maintenanceFor(env:Env,value:Site,d:string,h:number):Promise<Window|null> {
 const windows=await rows<Window>(env,'SELECT * FROM vane_maintenance WHERE site_id=? ORDER BY created_at',value.id),from=h*60,to=from+60
 return windows.find(w=>(w.kind==='once'?w.day===d:w.weekday===weekdayOf(d))&&w.start_minute<to&&w.end_minute>from)??null
}
export const windowText=(w:Window)=>`${w.kind==='once'?w.day:`${WEEKDAY_NAMES[w.weekday!-1]}s`} ${String(Math.floor(w.start_minute/60)).padStart(2,'0')}:${String(w.start_minute%60).padStart(2,'0')}–${String(Math.floor(w.end_minute/60)).padStart(2,'0')}:${String(w.end_minute%60).padStart(2,'0')}`
const minutes=(text:unknown)=>{const m=/^(\d{2}):(\d{2})$/.exec(String(text??''));return m&&+m[1]!<=24&&+m[2]!<60&&+m[1]!*60+ +m[2]!<=1440?+m[1]!*60+ +m[2]!:NaN}
export async function addWindow(env:Env,actor:Actor,p:any) {
 allow(actor,'analyst');const value=await site(env,String(p.siteId??''));inScope(actor,value.id)
 const kind=String(p.kind??'weekly'),start=minutes(p.from),end=minutes(p.to),weekday=Number(p.weekday),d=String(p.day??'')
 insist(kind==='once'||kind==='weekly','kind','Choose one-off or weekly.');insist(Number.isInteger(start)&&Number.isInteger(end)&&end>start,'window','Enter a start and a later end time, as HH:MM.')
 if(kind==='weekly')insist(Number.isInteger(weekday)&&weekday>=1&&weekday<=7,'weekday','Choose a weekday.');else insist(/^\d{4}-\d{2}-\d{2}$/.test(d)&&shift(d,0)===d,'day','Choose a date.')
 insist(Number((await rows(env,'SELECT COUNT(*) AS n FROM vane_maintenance WHERE site_id=?',value.id))[0].n)<50,'windows','A site has at most 50 maintenance windows.')
 const w={kind,weekday:kind==='weekly'?weekday:null,day:kind==='once'?d:null,start_minute:start,end_minute:end} as Window
 await env.DB.batch([statement(env,'INSERT INTO vane_maintenance(id,site_id,kind,weekday,day,start_minute,end_minute,created_by,created_at) VALUES(?,?,?,?,?,?,?,?,?)',uid(),value.id,kind,w.weekday,w.day,start,end,actor.id,clock()),auditStatement(env,actor.id,'maintenance.add',value.id,windowText(w))])
 return value.id
}
export async function deleteWindow(env:Env,actor:Actor,id:string) {
 const found=(await rows<Window>(env,'SELECT * FROM vane_maintenance WHERE id=?',id))[0];insist(found,'window','This maintenance window no longer exists.',404);inScope(actor,found.site_id);allow(actor,'analyst')
 await env.DB.batch([statement(env,'DELETE FROM vane_maintenance WHERE id=?',id),auditStatement(env,actor.id,'maintenance.delete',found.site_id,windowText(found))])
 return found.site_id
}
export const siteWindows=(env:Env,siteId:string)=>rows<Window>(env,'SELECT * FROM vane_maintenance WHERE site_id=? ORDER BY created_at',siteId)
export async function addClosedDay(env:Env,actor:Actor,p:any) {
 allow(actor,'admin');const value=await site(env,String(p.siteId??''));inScope(actor,value.id)
 const d=String(p.day??''),label=String(p.label??'').trim()
 insist(/^\d{4}-\d{2}-\d{2}$/.test(d)&&shift(d,0)===d,'day','Choose a date.');insist(label.length>=1&&label.length<=80&&!/[\u0000-\u001f<>]/.test(label),'label','Name the closed day in up to 80 plain characters.')
 insist(Number((await rows(env,'SELECT COUNT(*) AS n FROM vane_closed_days WHERE site_id=?',value.id))[0].n)<366,'days','A site has at most 366 closed days.')
 await env.DB.batch([statement(env,'INSERT INTO vane_closed_days(site_id,day,label,created_by,created_at) VALUES(?,?,?,?,?) ON CONFLICT(site_id,day) DO UPDATE SET label=excluded.label',value.id,d,label,actor.id,clock()),auditStatement(env,actor.id,'calendar.close',value.id,`${d} ${label}`)])
 return value.id
}
export async function deleteClosedDay(env:Env,actor:Actor,p:any) {
 allow(actor,'admin');const value=await site(env,String(p.siteId??''));inScope(actor,value.id)
 await env.DB.batch([statement(env,'DELETE FROM vane_closed_days WHERE site_id=? AND day=?',value.id,String(p.day??'')),auditStatement(env,actor.id,'calendar.open',value.id,String(p.day??''))])
 return value.id
}
export const closedDays=(env:Env,siteId:string)=>rows<{day:string,label:string}>(env,'SELECT day,label FROM vane_closed_days WHERE site_id=? ORDER BY day',siteId)

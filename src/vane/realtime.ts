import { rows, type Env, type Site } from './core'
import { localDay } from './visitors'
import { sourceNameSql } from './sources'
import { timedFrom } from './visits'
// DASH-001: the real-time view. A visitor is current while their latest page load or engagement ping is under
// 5 minutes old. The live lists cover the current visitors: pages by each one's latest page load, sources by the
// first page load of that visit (DASH-004). Pageviews per minute fill 30 one-minute buckets ending with the
// current minute. DASH-005: live locations count each current visitor at their latest page load's city, region and
// country (Unknown location without Cloudflare geolocation). DASH-008: everything is compared with the same window 30 minutes earlier.
export const CURRENT_MS=300000
const MINUTE=60000,WINDOW=30*MINUTE
export interface LiveRow { label:string; visitors:number; previous:number }
const current=`SELECT DISTINCT day,visitor FROM vane_events WHERE site_id=?1 AND kind='pageview' AND visitor IS NOT NULL AND day>=?2 AND ((at>?3 AND at<=?4) OR (engaged_at>?3 AND engaged_at<=?4))`
// The rail's live count beside the site name: the current visitors alone.
export async function currentVisitors(env:Env,value:Site,now:number):Promise<number> {
 return Number((await rows<{n:number}>(env,`SELECT COUNT(*) AS n FROM (${current})`,value.id,localDay(now-86400000,value.config.timeZone??'UTC'),now-CURRENT_MS,now))[0]?.n??0)
}
async function live(env:Env,value:Site,now:number,hosts:boolean) {
 const scope=JSON.stringify([value.id]),zone=value.config.timeZone??'UTC',from=localDay(now-86400000,zone),to=localDay(now+86400000,zone)
 const label=hosts?"COALESCE(hostname,'')||path":'path',place="COALESCE(trim(COALESCE(city||', ','')||COALESCE(region||', ','')||country,', '),'Unknown location')"
 const latest=(label:string)=>rows<{label:string,visitors:number}>(env,`WITH c AS (${current}),l AS (SELECT day,visitor,${label} AS label,ROW_NUMBER() OVER (PARTITION BY day,visitor ORDER BY at DESC,id DESC) AS r FROM vane_events WHERE site_id=?1 AND kind='pageview' AND visitor IS NOT NULL AND day>=?2 AND at<=?4) SELECT label,COUNT(*) AS visitors FROM l JOIN c USING(day,visitor) WHERE r=1 GROUP BY label`,value.id,from,now-CURRENT_MS,now)
 const [count,pages,locations]=await Promise.all([
  rows<{n:number}>(env,`SELECT COUNT(*) AS n FROM (${current})`,value.id,from,now-CURRENT_MS,now),
  latest(label),latest(place),
 ])
 const sources=await env.DB.prepare(`${timedFrom('vane_events')},c AS (SELECT DISTINCT day,visitor FROM vane_events WHERE site_id=?5 AND kind='pageview' AND visitor IS NOT NULL AND day>=?2 AND ((at>?6 AND at<=?7) OR (engaged_at>?6 AND engaged_at<=?7))),
cv AS (SELECT q.day,q.visitor,MAX(q.visit) AS visit FROM q JOIN c USING(day,visitor) WHERE q.at<=?7 GROUP BY q.day,q.visitor)
SELECT ${sourceNameSql(value.config.sourceRules)} AS label,COUNT(*) AS visitors FROM q JOIN cv USING(day,visitor,visit) WHERE q.starts=1 GROUP BY label`).bind(scope,from,to,null,value.id,now-CURRENT_MS,now).all<{label:string,visitors:number}>()
 return {current:Number(count[0]?.n??0),pages,sources:sources.results,locations}
}
const merged=(now:{label:string,visitors:number}[],then:{label:string,visitors:number}[]):LiveRow[]=>{
 const labels=[...new Set([...now,...then].map(r=>r.label))],find=(list:typeof now,label:string)=>Number(list.find(r=>r.label===label)?.visitors??0)
 return labels.map(label=>({label,visitors:find(now,label),previous:find(then,label)})).sort((a,b)=>b.visitors-a.visitors||b.previous-a.previous||a.label.localeCompare(b.label))
}
export async function realtime(env:Env,value:Site,now:number) {
 const hosts=(value.config.origins??[]).length>0,zone=value.config.timeZone??'UTC',start=Math.floor(now/MINUTE)*MINUTE-29*MINUTE
 const [present,past,minutes]=await Promise.all([live(env,value,now,hosts),live(env,value,now-WINDOW,hosts),
  rows<{b:number,n:number}>(env,`SELECT CAST((at-?2)/${MINUTE} AS INTEGER) AS b,COUNT(*) AS n FROM vane_events WHERE site_id=?1 AND kind='pageview' AND at>=?2 AND at<=?3 GROUP BY b`,value.id,start-WINDOW,now)])
 const format=new Intl.DateTimeFormat('en-US',{timeZone:zone,hourCycle:'h23',hour:'2-digit',minute:'2-digit'}),at=(b:number)=>Number(minutes.find(r=>Number(r.b)===b)?.n??0)
 const series=Array.from({length:30},(_,i)=>({label:format.format(start+i*MINUTE),pageviews:at(i+30),previousLabel:format.format(start-WINDOW+i*MINUTE),previous:at(i)}))
 return {now,timeZone:zone,currentVisitors:present.current,previousCurrentVisitors:past.current,pageviews:series.reduce((n,m)=>n+m.pageviews,0),previousPageviews:series.reduce((n,m)=>n+m.previous,0),minutes:series,pages:merged(present.pages,past.pages),sources:merged(present.sources,past.sources),locations:merged(present.locations,past.locations)}
}

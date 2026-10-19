import { rows, type Env, type Site } from './core'
import { movers, moverText } from './explain'
import { localDay } from './visitors'
// ALERT-001: an alert explains its change as REPORT-003 does, for its own window against the same window a week
// before: the largest movers in channels (unique visitors), pages and named campaigns (pageviews) and devices (unique
// visitors), each with its counts and the totals they are part of, and the annotations dated on the window's local day.
// A segment alert explains the segment's own visits. Coverage is counted by day (as collected): each exclusion reason and
// the privacy-signal count on the window's local day against the same day a week before, listed when they differ.
const WEEK=7*86400000
type Row={label:string,n:number}
async function counted(env:Env,value:Site,from:number,to:number,events:string) {
 const day=new Date(from-86400000).toISOString().slice(0,10),base=`FROM ${events} e WHERE e.site_id=? AND e.kind='pageview' AND e.day>=? AND e.at>=? AND e.at<?`
 const [channels,pages,campaigns,devices]=await Promise.all([
  rows<Row>(env,`SELECT COALESCE(channel,'Unknown') AS label,COUNT(DISTINCT day||visitor) AS n ${base} AND visitor IS NOT NULL GROUP BY label`,value.id,day,from,to),
  rows<Row>(env,`SELECT path AS label,COUNT(*) AS n ${base} GROUP BY label`,value.id,day,from,to),
  rows<Row>(env,`SELECT campaign AS label,COUNT(*) AS n ${base} AND campaign<>'none' GROUP BY label`,value.id,day,from,to),
  rows<Row>(env,`SELECT COALESCE(device,'Unknown') AS label,COUNT(DISTINCT day||visitor) AS n ${base} AND visitor IS NOT NULL GROUP BY label`,value.id,day,from,to),
 ])
 return {channels,pages,campaigns,devices}
}
const pair=(now:Row[],then:Row[])=>[...new Set([...now,...then].map(r=>r.label))].map(label=>({label,now:Number(now.find(r=>r.label===label)?.n??0),then:Number(then.find(r=>r.label===label)?.n??0)}))
const sum=(list:Row[])=>list.reduce((a,r)=>a+Number(r.n),0)
export async function alertExplanation(env:Env,value:Site,from:number,to:number,events='vane_events'):Promise<string> {
 const [now,then]=await Promise.all([counted(env,value,from,to,events),counted(env,value,from-WEEK,to-WEEK,events)])
 const list=[...movers('Channel','unique visitors',pair(now.channels,then.channels),sum(now.channels),sum(then.channels)),...movers('Page','pageviews',pair(now.pages,then.pages),sum(now.pages),sum(then.pages)),...movers('Campaign','pageviews',pair(now.campaigns,then.campaigns),sum(now.campaigns),sum(then.campaigns)),...movers('Device','unique visitors',pair(now.devices,then.devices),sum(now.devices),sum(then.devices))]
 const zone=value.config.timeZone??'UTC',today=localDay(from,zone),weekBefore=localDay(from-WEEK,zone)
 const [excluded,signals]=await Promise.all([rows<{day:string,reason:string,n:number}>(env,'SELECT day,reason,SUM(count) AS n FROM vane_exclusions WHERE site_id=? AND day IN (?,?) GROUP BY day,reason',value.id,today,weekBefore),rows<{day:string,n:number}>(env,'SELECT day,SUM(count) AS n FROM vane_signals WHERE site_id=? AND day IN (?,?) GROUP BY day',value.id,today,weekBefore)])
 const of=(list:{day:string,n:number}[],d:string,match=(_:any)=>true)=>Number(list.filter(r=>r.day===d&&match(r)).reduce((a,r)=>a+Number(r.n),0))
 const coverage=[...[...new Set(excluded.map(r=>r.reason))].sort().map(reason=>({label:reason,now:of(excluded,today,r=>r.reason===reason),then:of(excluded,weekBefore,r=>r.reason===reason)})),{label:'privacy-signals',now:of(signals,today),then:of(signals,weekBefore)}].filter(c=>c.now!==c.then)
 const notes=await rows<{text:string}>(env,'SELECT text FROM vane_annotations WHERE site_id=? AND day=? ORDER BY at',value.id,today)
 return `What moved against the same window a week before: ${list.map(moverText).join('; ')||'no channel, page, campaign or device changed'}.${notes.length?` Annotations that day: ${notes.map(n=>n.text).join('; ')}.`:''} Coverage that day against a week before: ${coverage.map(c=>`${c.label} ${c.then} → ${c.now}`).join('; ')||'no coverage count changed'}.`
}

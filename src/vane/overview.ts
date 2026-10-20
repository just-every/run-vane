import { insist, rows, type Env, type Site } from './core'
import { bucketKey, comparisonRange, intervalOf, PERIODS, presetRange, runningCut, upTo, type Period } from './periods'
import { annotationsFor } from './annotations'
import { timeSeries } from './series'
import { healthOf } from './tracking-health'
// DASH-010: the sites list shows each site's unique visitors for a preset range in the site's own time zone, the change
// from the previous period of the same length, and a sparkline of the chart's buckets for that range. It sorts by name,
// by visitors (most first) or by change (the largest absolute increase first), and a search keeps the sites whose name
// or origin contains the text, ignoring case. With today in the range, the previous period stops at the same moment of its matching day (DASH-008).
// ALERT-002: each site's row carries its tracking-health line (its goals tracking and when the daily check ran).
export const SORTS={added:'Date added',name:'Name',visitors:'Visitors',change:'Change'} as const
export async function overview(env:Env,list:Site[],now:number,query:{period?:string|null,sort?:string|null,q?:string|null}) {
 const period=(query.period||'7d') as Period,sort=(query.sort||'added') as keyof typeof SORTS,q=String(query.q??'').trim().toLowerCase()
 insist(Object.hasOwn(PERIODS,period),'period','Choose one of the preset ranges.');insist(Object.hasOwn(SORTS,sort),'sort','Sort by date added, name, visitors or change.')
 const uniques=async(id:string,from:string,to:string,events='vane_events')=>Number((await rows(env,`SELECT COUNT(*) AS n FROM (SELECT DISTINCT day,visitor FROM ${events} WHERE site_id=? AND day>=? AND day<? AND kind='pageview' AND visitor IS NOT NULL)`,id,from,to))[0]!.n)
 const shown=list.filter(s=>!q||s.name.toLowerCase().includes(q)||s.origin.toLowerCase().includes(q))
 const rowsOf=await Promise.all(shown.map(async site=>{
  const timeZone=site.config.timeZone??'UTC',earliest=period==='all'?(await rows<{d:string|null}>(env,'SELECT MIN(day) AS d FROM (SELECT day FROM vane_events WHERE site_id=?1 UNION ALL SELECT day FROM vane_import_events WHERE site_id=?1)',site.id))[0]?.d??null:null
  const {from,to}=presetRange(period,now,timeZone,earliest),before=comparisonRange('previous',from,to,false,{from:null,to:null}),scope=JSON.stringify([site.id])
  const cut=runningCut(now,timeZone,from,to,before.from),current='vane_events',then=cut?upTo('vane_events',cut.thenDay,cut.thenAt):'vane_events'
  const interval=intervalOf(null,from,to),[visitors,previous,series,notes,health]=await Promise.all([uniques(site.id,from,to,current),uniques(site.id,before.from,before.to,then),timeSeries(env,scope,from,to,interval,timeZone,current,current),annotationsFor(env,[site],from,to,false),healthOf(env,site.id)])
  // DASH-009: the sparkline (visitors) marks the bucket of each annotation in range; definition versions do not affect visitors.
  const marks=[...new Set(notes.filter(n=>n.kind!=='definition').map(n=>series.findIndex(b=>b.key===bucketKey(interval,n.day,from,timeZone))).filter(i=>i>=0))]
  return {site,from,to,visitors,previous,running:Boolean(cut),sparkline:series.map(b=>b.visitors),trendLabels:series.map(b=>b.label),marks,health}
 }))
 const order:Record<string,(a:any,b:any)=>number>={added:()=>0,name:(a,b)=>a.site.name.localeCompare(b.site.name),visitors:(a,b)=>b.visitors-a.visitors,change:(a,b)=>(b.visitors-b.previous)-(a.visitors-a.previous)}
 return {period,sort,q,rows:[...rowsOf].sort(order[sort])}
}

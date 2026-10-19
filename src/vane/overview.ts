import { insist, rows, type Env, type Site } from './core'
import { comparisonRange, intervalOf, PERIODS, presetRange, type Period } from './periods'
import { timeSeries } from './series'
// DASH-010: the sites list shows each site's unique visitors for a preset range in the site's own time zone, the change
// from the previous period of the same length, and a sparkline of the chart's buckets for that range. It sorts by name,
// by visitors (most first) or by change (the largest absolute increase first), and a search keeps the sites whose name
// or origin contains the text, ignoring case.
export const SORTS={added:'Date added',name:'Name',visitors:'Visitors',change:'Change'} as const
export async function overview(env:Env,list:Site[],now:number,query:{period?:string|null,sort?:string|null,q?:string|null}) {
 const period=(query.period||'7d') as Period,sort=(query.sort||'added') as keyof typeof SORTS,q=String(query.q??'').trim().toLowerCase()
 insist(Object.hasOwn(PERIODS,period),'period','Choose one of the preset ranges.');insist(Object.hasOwn(SORTS,sort),'sort','Sort by date added, name, visitors or change.')
 const uniques=async(id:string,from:string,to:string)=>Number((await rows(env,"SELECT COUNT(*) AS n FROM (SELECT DISTINCT day,visitor FROM vane_events WHERE site_id=? AND day>=? AND day<? AND kind='pageview' AND visitor IS NOT NULL)",id,from,to))[0]!.n)
 const shown=list.filter(s=>!q||s.name.toLowerCase().includes(q)||s.origin.toLowerCase().includes(q))
 const rowsOf=await Promise.all(shown.map(async site=>{
  const timeZone=site.config.timeZone??'UTC',earliest=period==='all'?(await rows<{d:string|null}>(env,'SELECT MIN(day) AS d FROM (SELECT day FROM vane_events WHERE site_id=?1 UNION ALL SELECT day FROM vane_import_events WHERE site_id=?1)',site.id))[0]?.d??null:null
  const {from,to}=presetRange(period,now,timeZone,earliest),before=comparisonRange('previous',from,to,false,{from:null,to:null}),scope=JSON.stringify([site.id])
  const [visitors,previous,series]=await Promise.all([uniques(site.id,from,to),uniques(site.id,before.from,before.to),timeSeries(env,scope,from,to,intervalOf(null,from,to),timeZone,'vane_events','vane_events')])
  return {site,from,to,visitors,previous,sparkline:series.map(b=>b.visitors)}
 }))
 const order:Record<string,(a:any,b:any)=>number>={added:()=>0,name:(a,b)=>a.site.name.localeCompare(b.site.name),visitors:(a,b)=>b.visitors-a.visitors,change:(a,b)=>(b.visitors-b.previous)-(a.visitors-a.previous)}
 return {period,sort,q,rows:[...rowsOf].sort(order[sort])}
}

import { day, insist, rows, type Env, type Site } from './core'
// Adapted from Uptime schedule.ts c699a67fa0358f79b736c27b7657a9189afaa9f4:
// keep comparisons on an interval grid, without inventing missed observations.
export function missedSlots(dueAt:number,now:number,intervalMs:number) { return Math.max(0,Math.floor((now-dueAt)/intervalMs)) }
export function nextDueAfter(dueAt:number,now:number,intervalMs:number) { return dueAt+(missedSlots(dueAt,now,intervalMs)+1)*intervalMs }
const eventSet='(SELECT * FROM vane_events UNION ALL SELECT * FROM vane_import_events)'
// Adapted from Mango insights/service.ts 7f27217b8ce03aeac9cf4eb3fa0c8eb7ebc28d3f:
// repository facts remain separate from their interpretation and time window.
export function createInsightsService(env:Env,value:Site,now=Date.now(),range?:{from:string|null,to:string|null}) {
 let end=nextDueAfter(0,now,86400000),start=end-7*86400000;
 if(range?.from||range?.to) { insist(Boolean(range.from&&range.to)&&[range.from,range.to].every(x=>/^\d{4}-\d{2}-\d{2}$/.test(x!)&&Number.isFinite(Date.parse(x!))&&day(Date.parse(x!))===x),'range','Choose valid start and end dates.');start=Date.parse(range.from!);end=Date.parse(range.to!);insist(start<end&&end-start<=3660*86400000,'range','The end date must follow the start, within ten years.'); }
 const to=day(end),from=day(start),previousFrom=day(start-(end-start));
 const count=async(start:string,end:string,kind:boolean)=>Number((await rows(env,`SELECT COUNT(*) AS n FROM ${eventSet} WHERE site_id=? AND day>=? AND day<? AND kind${kind?'=':'!='}'pageview'`,value.id,start,end))[0].n);
 // Every breakdown row carries its count in the preceding period of the same length.
 const group=async(column:string,goals=false)=>rows<{label:string,count:number,previous:number}>(env,`SELECT ${column} AS label,SUM(CASE WHEN day>=? THEN 1 ELSE 0 END) AS count,SUM(CASE WHEN day<? THEN 1 ELSE 0 END) AS previous FROM ${eventSet} WHERE site_id=? AND day>=? AND day<? AND kind${goals?'!=':'='}'pageview' GROUP BY ${column} ORDER BY count DESC,previous DESC,label`,from,from,value.id,previousFrom,to);
 return {async list(){
  const [visits,goals,previousVisits,previousGoals,sources,campaigns,pages,goalBreakdown,coverage]=await Promise.all([count(from,to,true),count(from,to,false),count(previousFrom,from,true),count(previousFrom,from,false),group('source'),group('campaign'),group('path'),group('kind',true),rows(env,`SELECT COUNT(*) AS imported,SUM(CASE WHEN sample_rate IS NULL OR consent='unknown' THEN 1 ELSE 0 END) AS unknownCoverage FROM ${eventSet} WHERE site_id=? AND day>=? AND day<? AND import_job IS NOT NULL`,value.id,from,to)]);
  const difference=visits-previousVisits;
  return {visits,goals,previousVisits,previousGoals,from,to,previousFrom,sources,campaigns,pages,goalBreakdown,imported:Number(coverage[0].imported),unknownCoverage:Number(coverage[0].unknownCoverage??0),explanation:`${from} to ${to} (end exclusive, UTC): ${visits} accepted page loads; ${previousFrom} to ${from}: ${previousVisits}. Difference: ${difference>=0?'+':''}${difference}. Goal events: ${goals}, previously ${previousGoals}. These are observed events, not unique people or sessions. Consent exclusions, blockers, sampling, collection limits, imports and deleted history can change these totals. Collection coverage is not measured, so this comparison does not establish a change in total traffic.`};
 }};
}

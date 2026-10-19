import type { Env } from './core'
// METRIC-002: a visit is a run of one visitor hash's page loads with no gap over 30 minutes. The hash
// rotates with the daily salt, so a visit also ends at the site's local midnight.
// METRIC-003: a bounce is a visit of one page load with no engagement ping. A visit lasts from its first
// page load to its last signal (page load or ping). Time on a page runs to the next page load of the
// visit; on the visit's last page it runs to that page's last ping, or is 0 without one.
export const VISIT_GAP_MS=1800000
export const ENGAGED_AFTER_MS=10000
const timed=`WITH e AS (SELECT id,day,visitor,path,at,engaged_at,LAG(at) OVER w AS prev_at,LEAD(at) OVER w AS next_at FROM vane_events WHERE site_id=?1 AND day>=?2 AND day<?3 AND kind='pageview' AND visitor IS NOT NULL AND at IS NOT NULL WINDOW w AS (PARTITION BY day,visitor ORDER BY at,id)),
p AS (SELECT *,CASE WHEN prev_at IS NULL OR at-prev_at>${VISIT_GAP_MS} THEN 1 ELSE 0 END AS starts,CASE WHEN next_at IS NOT NULL AND next_at-at<=${VISIT_GAP_MS} THEN next_at-at ELSE COALESCE(engaged_at-at,0) END AS on_page FROM e),
q AS (SELECT *,SUM(starts) OVER (PARTITION BY day,visitor ORDER BY at,id ROWS UNBOUNDED PRECEDING) AS visit FROM p),
v AS (SELECT day,visitor,visit,COUNT(*) AS pages,MAX(engaged_at IS NOT NULL) AS engaged,MAX(CASE WHEN starts=1 THEN path END) AS entry,MAX(MAX(at,COALESCE(engaged_at,at)))-MIN(at) AS duration FROM q GROUP BY day,visitor,visit),
vr AS (SELECT *,ROW_NUMBER() OVER (PARTITION BY entry ORDER BY duration) AS r,COUNT(*) OVER (PARTITION BY entry) AS c,ROW_NUMBER() OVER (ORDER BY duration) AS ra,COUNT(*) OVER () AS ca FROM v),
pr AS (SELECT path,on_page,ROW_NUMBER() OVER (PARTITION BY path ORDER BY on_page) AS r,COUNT(*) OVER (PARTITION BY path) AS c FROM q)`
const middle=(r:string,c:string)=>`${r} IN ((${c}+1)/2,(${c}+2)/2)`
const seconds=(ms:unknown)=>ms===null||ms===undefined?null:Math.round(Number(ms)/1000)
const rate=(part:number,whole:number)=>whole?Math.round(part/whole*1000)/10:null
export interface PageEngagement { path:string; pageviews:number; entries:number; bounceRate:number|null; medianDuration:number|null; averageDuration:number|null; medianTimeOnPage:number|null; averageTimeOnPage:number|null }
export async function visitMetrics(env:Env,siteId:string,from:string,to:string) {
 const [all,entries,pages]=await env.DB.batch<any>([
  env.DB.prepare(`${timed} SELECT (SELECT COUNT(*) FROM v) AS visits,(SELECT COUNT(*) FROM q) AS pageviews,(SELECT COUNT(*) FROM v WHERE pages=1 AND engaged=0) AS bounces,(SELECT AVG(duration) FROM v) AS average,(SELECT AVG(duration) FROM vr WHERE ${middle('ra','ca')}) AS median`).bind(siteId,from,to),
  env.DB.prepare(`${timed} SELECT entry AS path,COUNT(*) AS visits,SUM(pages=1 AND engaged=0) AS bounces,AVG(duration) AS average,AVG(CASE WHEN ${middle('r','c')} THEN duration END) AS median FROM vr GROUP BY entry`).bind(siteId,from,to),
  env.DB.prepare(`${timed} SELECT path,COUNT(*) AS pageviews,AVG(on_page) AS average,AVG(CASE WHEN ${middle('r','c')} THEN on_page END) AS median FROM pr GROUP BY path ORDER BY pageviews DESC,path`).bind(siteId,from,to),
 ])
 const total=all.results[0],visits=Number(total.visits),pageviews=Number(total.pageviews)
 const entered=new Map(entries.results.map(row=>[row.path,row]))
 const perPage:PageEngagement[]=pages.results.map(row=>{const entry=entered.get(row.path),n=Number(entry?.visits??0);return {path:row.path,pageviews:Number(row.pageviews),entries:n,bounceRate:rate(Number(entry?.bounces??0),n),medianDuration:seconds(entry?.median),averageDuration:seconds(entry?.average),medianTimeOnPage:seconds(row.median),averageTimeOnPage:seconds(row.average)}})
 return {visits,timedPageviews:pageviews,pagesPerVisit:visits?Math.round(pageviews/visits*100)/100:null,bounces:Number(total.bounces),bounceRate:rate(Number(total.bounces),visits),medianDuration:seconds(total.median),averageDuration:seconds(total.average),perPage}
}

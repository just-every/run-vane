import { insist, type Env } from './core'
// METRIC-002: a visit is a run of one visitor hash's page loads with no gap over 30 minutes. The hash
// rotates with the daily salt, so a visit also ends at the site's local midnight.
// METRIC-003: a bounce is a visit of one page load with no engagement ping. A visit lasts from its first
// page load to its last signal (page load or ping). Time on a page runs to the next page load of the
// visit; on the visit's last page it runs to that page's last ping, or is 0 without one.
// METRIC-006: a page's scroll depth is the deepest its pings reported; pages without a ping have none.
// DASH-003: top, entry and exit pages each list a set of page loads (all of them, each visit's first,
// each visit's last) by path or page group. A row's visits are the visits its page loads belong to:
// bounce rate, visit duration and conversion rate (visits with a goal event, or with the selected goal) are over those visits.
// DASH-004: channel, source, referrer and UTM tables attribute each visit to its first page load's values.
export const VISIT_GAP_MS=1800000
export const ENGAGED_AFTER_MS=10000
export const timedFrom=(events:string)=>`WITH e AS (SELECT l.id,l.day,l.visitor,l.hostname,l.path,l.at,l.engaged_at,l.scroll,l.channel,l.source,l.referrer,l.utm_source,l.utm_medium,l.campaign,l.utm_term,l.utm_content,EXISTS(SELECT 1 FROM ${events} c WHERE c.id>l.id||':' AND c.id<l.id||';' AND (?4 IS NULL OR c.kind=?4)) AS converted,LAG(l.at) OVER w AS prev_at,LEAD(l.at) OVER w AS next_at FROM ${events} l WHERE l.site_id IN (SELECT value FROM json_each(?1)) AND l.day>=?2 AND l.day<?3 AND l.kind='pageview' AND l.visitor IS NOT NULL AND l.at IS NOT NULL WINDOW w AS (PARTITION BY l.day,l.visitor ORDER BY l.at,l.id)),
p AS (SELECT *,CASE WHEN prev_at IS NULL OR at-prev_at>${VISIT_GAP_MS} THEN 1 ELSE 0 END AS starts,CASE WHEN next_at IS NULL OR next_at-at>${VISIT_GAP_MS} THEN 1 ELSE 0 END AS ends,CASE WHEN next_at IS NOT NULL AND next_at-at<=${VISIT_GAP_MS} THEN next_at-at ELSE COALESCE(engaged_at-at,0) END AS on_page FROM e),
q AS (SELECT *,SUM(starts) OVER (PARTITION BY day,visitor ORDER BY at,id ROWS UNBOUNDED PRECEDING) AS visit FROM p),
v AS (SELECT day,visitor,visit,COUNT(*)=1 AND MAX(engaged_at IS NOT NULL)=0 AS bounce,MAX(converted) AS visit_converted,MAX(MAX(at,COALESCE(engaged_at,at)))-MIN(at) AS duration,MIN(at) AS started FROM q GROUP BY day,visitor,visit)`
const middle=(r:string,c:string)=>`${r} IN ((${c}+1)/2,(${c}+2)/2)`
const seconds=(ms:unknown)=>ms===null||ms===undefined?null:Math.round(Number(ms)/1000)
const rate=(part:number,whole:number)=>whole?Math.round(part/whole*1000)/10:null
export interface PageRow { path:string; visitors:number; pageviews:number; visits:number; bounceRate:number|null; conversionRate:number|null; medianDuration:number|null; averageDuration:number|null; medianTimeOnPage:number|null; averageTimeOnPage:number|null; averageScrollDepth:number|null; reached75Share:number|null }
export interface PageGroup { pattern:string; label:string }
// A group is an exact path or a prefix ending in *, optionally renamed: /blog/* or /blog/*=/articles.
export function pageGroups(value:string|null|undefined):PageGroup[] {
 const lines=String(value??'').split(/[\n,]/).map(x=>x.trim()).filter(Boolean);
 insist(lines.length<=10,'group','Use at most 10 page groups.');
 return lines.map(line=>{const [pattern,label=pattern]=line.split('=').map(x=>x.trim());insist(/^\/[a-z0-9_\-/]{0,119}\*?$/.test(pattern!)&&/^\/[a-z0-9_\-/*]{0,119}$/.test(label!),'group','Group pages by a path prefix such as /blog/*, optionally renamed: /blog/*=/articles.');return {pattern:pattern!,label:label!}});
}
const labelSql=(groups:PageGroup[])=>groups.length?`CASE ${groups.map((_,i)=>`WHEN ${groups[i]!.pattern.endsWith('*')?`substr(path,1,length(?${5+i*2}))=?${5+i*2}`:`path=?${5+i*2}`} THEN ?${6+i*2}`).join(' ')} ELSE path END`:'path'
const groupValues=(groups:PageGroup[])=>groups.flatMap(g=>[g.pattern.endsWith('*')?g.pattern.slice(0,-1):g.pattern,g.label])
// DASH-013: on a site with more than one hostname, page rows are hostname + path, so the same path on two hostnames is two rows.
function table(env:Env,args:(string|null)[],groups:PageGroup[],where:string,events:string,label=labelSql(groups)) {
 return env.DB.prepare(`${timedFrom(events)},
x AS (SELECT ${label} AS label,q.day,q.visitor,q.visit,q.on_page,q.scroll,v.bounce,v.visit_converted,v.duration FROM q JOIN v USING(day,visitor,visit) WHERE ${where}),
xr AS (SELECT *,ROW_NUMBER() OVER (PARTITION BY label ORDER BY on_page) AS r,COUNT(*) OVER (PARTITION BY label) AS c FROM x),
vd AS (SELECT DISTINCT label,day,visitor,visit,bounce,visit_converted,duration FROM x),
vdr AS (SELECT *,ROW_NUMBER() OVER (PARTITION BY label ORDER BY duration) AS r,COUNT(*) OVER (PARTITION BY label) AS c FROM vd)
SELECT a.*,b.visits,b.bounces,b.conversions,b.duration_average,b.duration_median FROM (SELECT label,COUNT(DISTINCT day||' '||visitor) AS visitors,COUNT(*) AS pageviews,AVG(on_page) AS time_average,AVG(CASE WHEN ${middle('r','c')} THEN on_page END) AS time_median,AVG(scroll) AS scroll,AVG(CASE WHEN scroll IS NULL THEN NULL WHEN scroll>=75 THEN 100.0 ELSE 0 END) AS deep FROM xr GROUP BY label) a
JOIN (SELECT label,COUNT(*) AS visits,SUM(bounce) AS bounces,SUM(visit_converted) AS conversions,AVG(duration) AS duration_average,AVG(CASE WHEN ${middle('r','c')} THEN duration END) AS duration_median FROM vdr GROUP BY label) b USING(label) ORDER BY a.pageviews DESC,a.label`).bind(...args,...groupValues(groups))
}
const row=(r:any):PageRow=>({path:r.label,visitors:Number(r.visitors),pageviews:Number(r.pageviews),visits:Number(r.visits),bounceRate:rate(Number(r.bounces),Number(r.visits)),conversionRate:rate(Number(r.conversions),Number(r.visits)),medianDuration:seconds(r.duration_median),averageDuration:seconds(r.duration_average),medianTimeOnPage:seconds(r.time_median),averageTimeOnPage:seconds(r.time_average),averageScrollDepth:r.scroll===null?null:Math.round(Number(r.scroll)),reached75Share:r.deep===null?null:Math.round(Number(r.deep)*10)/10})
export async function visitMetrics(env:Env,siteId:string,from:string,to:string,groups:PageGroup[]=[],goal:string|null=null,events='vane_events',hosts=false) {
 const args=[siteId,from,to,goal],timed=timedFrom(events),label=hosts?`COALESCE(hostname,'')||${labelSql(groups)}`:labelSql(groups)
 const [all,top,entry,exit,hostnames]=await env.DB.batch<any>([
  env.DB.prepare(`${timed},vr AS (SELECT duration,ROW_NUMBER() OVER (ORDER BY duration) AS r,COUNT(*) OVER () AS c FROM v) SELECT (SELECT COUNT(*) FROM v) AS visits,(SELECT COUNT(*) FROM q) AS pageviews,(SELECT SUM(bounce) FROM v) AS bounces,(SELECT AVG(duration) FROM v) AS average,(SELECT AVG(duration) FROM vr WHERE ${middle('r','c')}) AS median`).bind(...args),
  table(env,args,groups,'1',events,label),table(env,args,groups,'q.starts=1',events,label),table(env,args,groups,'q.ends=1',events,label),
  table(env,args,[],'q.hostname IS NOT NULL',events,'q.hostname'),
 ])
 const total=all.results[0],visits=Number(total.visits),pageviews=Number(total.pageviews),bounces=Number(total.bounces??0)
 return {visits,timedPageviews:pageviews,pagesPerVisit:visits?Math.round(pageviews/visits*100)/100:null,bounces,bounceRate:rate(bounces,visits),medianDuration:seconds(total.median),averageDuration:seconds(total.average),topPages:top.results.map(row),entryPages:entry.results.map(row),exitPages:exit.results.map(row),hostnames:hostnames.results.map((r:any)=>({...row(r),conversions:Number(r.conversions)}))}
}

export interface VisitRow { label:string; visitors:number; visits:number; bounceRate:number|null; medianDuration:number|null; averageDuration:number|null; conversionRate:number|null }
export const ENTRY_DIMENSIONS={channels:'channel',sourceVisits:'source',referrers:'referrer',utmSources:'utm_source',utmMediums:'utm_medium',utmCampaigns:"NULLIF(campaign,'none')",utmTerms:'utm_term',utmContents:'utm_content'} as const
// DASH-014: sources are labelled by the named-source SQL; the drill-down lists each source's raw referrers.
export async function entryMetrics(env:Env,siteId:string,from:string,to:string,goal:string|null,sourceName:string,events='vane_events'):Promise<Record<keyof typeof ENTRY_DIMENSIONS,VisitRow[]>&{sourceReferrers:{source:string,referrer:string,visits:number}[]}> {
 const timed=timedFrom(events),names=Object.keys(ENTRY_DIMENSIONS) as (keyof typeof ENTRY_DIMENSIONS)[],label=(name:keyof typeof ENTRY_DIMENSIONS)=>name==='sourceVisits'?sourceName:ENTRY_DIMENSIONS[name]
 const results=await env.DB.batch<any>(names.map(name=>env.DB.prepare(`${timed},
x AS (SELECT ${label(name)} AS label,v.* FROM q JOIN v USING(day,visitor,visit) WHERE q.starts=1),
xr AS (SELECT *,ROW_NUMBER() OVER (PARTITION BY label ORDER BY duration) AS r,COUNT(*) OVER (PARTITION BY label) AS c FROM x WHERE label IS NOT NULL)
SELECT label,COUNT(DISTINCT day||' '||visitor) AS visitors,COUNT(*) AS visits,SUM(bounce) AS bounces,SUM(visit_converted) AS conversions,AVG(duration) AS average,AVG(CASE WHEN ${middle('r','c')} THEN duration END) AS median FROM xr GROUP BY label ORDER BY visits DESC,label`).bind(siteId,from,to,goal)).concat(env.DB.prepare(`${timed} SELECT ${sourceName} AS source,lower(source) AS referrer,COUNT(*) AS visits FROM q WHERE starts=1 AND source<>'direct' GROUP BY 1,2 ORDER BY 1,visits DESC,2`).bind(siteId,from,to,goal)))
 const tables=Object.fromEntries(names.map((name,i)=>[name,results[i]!.results.map((r:any):VisitRow=>({label:r.label,visitors:Number(r.visitors),visits:Number(r.visits),bounceRate:rate(Number(r.bounces),Number(r.visits)),medianDuration:seconds(r.median),averageDuration:seconds(r.average),conversionRate:rate(Number(r.conversions),Number(r.visits))}))]))
 return {...tables,sourceReferrers:results[names.length]!.results.map((r:any)=>({source:r.source,referrer:r.referrer,visits:Number(r.visits)}))} as any
}

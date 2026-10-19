import { gapSql } from './definitions'
import type { Env } from './core'
// DASH-012: a site-search term is lowercased and its spaces collapsed. A term that looks personal (an
// email address, a phone or account number, a URL) is dropped before storage: the search still counts,
// as an empty term. A term is reported only once two different visitor hashes searched it on one day,
// so one person's search cannot be singled out.
export function searchTerm(value:string):string {
 const term=value.trim().toLowerCase().replace(/\s+/g,' ');
 return /@|\d[\d\s().-]{5,}\d|https?:|www\./.test(term)?'':term;
}
const timedFrom=(events:string)=>`WITH e AS (SELECT id,day,visitor,path,at,search,LAG(at) OVER w AS prev_at,LAG(path) OVER w AS prev_path,LEAD(at) OVER w AS next_at,${gapSql("l")} AS gap FROM ${events} l WHERE site_id IN (SELECT value FROM json_each(?1)) AND day>=?2 AND day<?3 AND kind='pageview' AND visitor IS NOT NULL AND at IS NOT NULL WINDOW w AS (PARTITION BY day,visitor ORDER BY at,id)),
q AS (SELECT *,CASE WHEN prev_at IS NULL OR at-prev_at>gap THEN 1 ELSE 0 END AS starts,CASE WHEN next_at IS NULL OR next_at-at>gap THEN 1 ELSE 0 END AS ends,SUM(CASE WHEN prev_at IS NULL OR at-prev_at>gap THEN 1 ELSE 0 END) OVER (PARTITION BY day,visitor ORDER BY at,id ROWS UNBOUNDED PRECEDING) AS visit FROM e),
s AS (SELECT * FROM q WHERE search IS NOT NULL),
sv AS (SELECT day,visitor,visit,COUNT(*) AS searches,MAX(ends) AS exited FROM s GROUP BY day,visitor,visit)`
export async function searchMetrics(env:Env,siteId:string,from:string,to:string,events='vane_events') {
 const timed=timedFrom(events)
 const [totals,terms,starts]=await env.DB.batch<any>([
  env.DB.prepare(`${timed} SELECT (SELECT COUNT(*) FROM s) AS searches,(SELECT COUNT(*) FROM sv) AS visits,(SELECT SUM(exited) FROM sv) AS exits`).bind(siteId,from,to),
  env.DB.prepare(`${timed} SELECT search AS term,COUNT(*) AS searches,COUNT(DISTINCT day||' '||visitor) AS visitors FROM s WHERE search<>'' GROUP BY search HAVING MAX((SELECT COUNT(DISTINCT x.visitor) FROM s x WHERE x.search=s.search AND x.day=s.day))>=2 ORDER BY searches DESC,term`).bind(siteId,from,to),
  env.DB.prepare(`${timed} SELECT CASE WHEN starts=1 THEN '(entry)' ELSE prev_path END AS path,COUNT(*) AS searches FROM s GROUP BY 1 ORDER BY searches DESC,path`).bind(siteId,from,to),
 ])
 const total=totals.results[0],searches=Number(total.searches),visits=Number(total.visits),exits=Number(total.exits??0)
 return {searches,searchVisits:visits,searchesPerVisit:visits?Math.round(searches/visits*100)/100:null,exitAfterSearch:visits?Math.round(exits/visits*1000)/10:null,terms:terms.results.map(r=>({term:r.term,searches:Number(r.searches),visitors:Number(r.visitors)})),startPages:starts.results.map(r=>({path:r.path,searches:Number(r.searches)}))}
}

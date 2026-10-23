import type { Env } from '../../core'
import { ENTRY_DIMENSIONS, type PageGroup, type PageRow, type VisitRow } from '../../visits'
import { refreshVisitFacts } from './maintenance'
import { contextIdentity, dimension, rangePredicate, reportFrom, visitScope, weightedMedian } from './sql'

const seconds = (ms: unknown) => ms == null ? null : Math.round(Number(ms) / 1000)
const rate = (part: number, whole: number) => whole ? Math.round(part / whole * 1000) / 10 : null
const groupValues = (groups: PageGroup[]) => groups.flatMap(g => [g.pattern.endsWith('*') ? g.pattern.slice(0, -1) : g.pattern, g.label])
const pathLabel = (groups: PageGroup[]) => groups.length ? `CASE ${groups.map((g, i) => `WHEN ${g.pattern.endsWith('*') ? `substr(path,1,length(?${5 + i * 2}))=?${5 + i * 2}` : `path=?${5 + i * 2}`} THEN ?${6 + i * 2}`).join(' ')} ELSE path END` : 'path'
const pageRow = (r: any): PageRow => ({ path: r.label, visitors: Number(r.visitors), pageviews: Number(r.pageviews), visits: Number(r.visits), bounceRate: rate(Number(r.bounces), Number(r.visits)), conversions: Number(r.conversions), conversionRate: rate(Number(r.conversions), Number(r.visits)), revenue: Number(r.revenue) / 1e6, medianDuration: seconds(r.duration_median), averageDuration: seconds(r.duration_average), medianTimeOnPage: seconds(r.time_median), averageTimeOnPage: seconds(r.time_average), averageScrollDepth: r.scroll == null ? null : Math.round(Number(r.scroll)), reached75Share: r.deep == null ? null : Math.round(Number(r.deep) * 10) / 10 })

const ENTRY_COLUMNS = ['path', 'hostname', 'device', 'channel', 'source', 'referrer', 'utm_source', 'utm_medium', 'campaign', 'utm_term', 'utm_content'] as const
// Page rows read only the page and hostname labels; deriving every other
// dimension from each frequency row's JSON would cost time per row at volume.
const PAGE_COLUMNS = ['path', 'hostname'] as const
function pointRows(which: 'first' | 'last', columns: readonly (typeof ENTRY_COLUMNS[number])[] = ENTRY_COLUMNS) {
 return `SELECT v.visit,v.day,v.identity AS visit_identity,v.bounce,v.duration,v.visit_converted,v.visit_revenue,c.context,c.dimensions,${contextIdentity()} AS identity,
 ${columns.map(name => `${dimension(name)} AS ${name}`).join(',')},
 1 AS n,${which === 'first' ? 'v.first_on_page' : 'COALESCE(d.engaged_at-(e.at_offset+unixepoch(c.day)*1000),0)'} AS on_page,d.scroll
 FROM v JOIN vane_raw_events e ON e.raw_id=v.${which}_raw JOIN vane_raw_contexts c ON c.context=e.context JOIN vane_raw_sites s ON s.site=c.site LEFT JOIN vane_raw_details d ON d.raw_id=e.raw_id`
}
// The label and visitor identity belong to a raw context, so they are derived once per
// context rather than once per frequency row. Only the weighted median needs ordered
// values, and it orders the distinct time-on-page values with their counts.
function allPagesTable(env: Env, args: (string | null)[], groups: PageGroup[], hosts: boolean, revenue: string, hostname: boolean) {
 const path = pathLabel(groups), label = hostname ? 'hostname' : hosts ? `COALESCE(hostname,'')||${path}` : path
 return env.DB.prepare(`${visitScope(revenue)},
 cx AS (SELECT c.context,c.day,${dimension('path')} AS path,${dimension('hostname')} AS hostname,${contextIdentity()} AS identity
  FROM vane_raw_contexts c JOIN vane_raw_sites s ON s.site=c.site
  WHERE s.site_id IN (SELECT value FROM json_each(?1)) AND c.day>=?2 AND c.day<?3 AND c.kind='pageview'),
 cl AS (SELECT context,identity,${label} AS label FROM cx ${hostname ? 'WHERE hostname IS NOT NULL' : ''}),
 x AS (SELECT cl.label,v.visit,v.day,cl.identity,v.bounce,v.duration,v.visit_converted,v.visit_revenue,p.n,p.on_page,NULLIF(p.scroll,-1) AS scroll
  FROM vane_visit_page_frequencies p JOIN v ON v.visit=p.visit JOIN cl ON cl.context=p.context),
 t AS (SELECT label,on_page,SUM(n) AS n FROM x GROUP BY label,on_page),
 tr AS (SELECT *,SUM(n) OVER (PARTITION BY label ORDER BY on_page ROWS UNBOUNDED PRECEDING) AS r,SUM(n) OVER (PARTITION BY label) AS c FROM t),
 vd AS (SELECT DISTINCT cl.label,v.day,cl.identity,v.visit,v.bounce,v.visit_converted,v.visit_revenue,v.duration
  FROM (SELECT visit,context FROM vane_visit_page_frequencies GROUP BY visit,context) p JOIN v ON v.visit=p.visit JOIN cl ON cl.context=p.context),
 vdr AS (SELECT *,ROW_NUMBER() OVER (PARTITION BY label ORDER BY duration) AS r,COUNT(*) OVER (PARTITION BY label) AS c FROM vd)
 SELECT a.*,m.time_median,b.visits,b.bounces,b.conversions,b.revenue,b.duration_average,b.duration_median FROM
 (SELECT label,COUNT(DISTINCT identity) AS visitors,SUM(n) AS pageviews,SUM(on_page*n)*1.0/SUM(n) AS time_average,
 SUM(scroll*n)*1.0/SUM(CASE WHEN scroll IS NOT NULL THEN n END) AS scroll,
 SUM(CASE WHEN scroll>=75 THEN 100.0*n WHEN scroll IS NOT NULL THEN 0 END)/SUM(CASE WHEN scroll IS NOT NULL THEN n END) AS deep FROM x GROUP BY label) a
 JOIN (SELECT label,${weightedMedian('on_page', 'r', 'n', 'c')} AS time_median FROM tr GROUP BY label) m USING(label)
 JOIN (SELECT label,COUNT(*) AS visits,SUM(bounce) AS bounces,SUM(visit_converted) AS conversions,
 COALESCE(SUM(CASE WHEN ?4 IS NULL OR visit_converted=1 THEN visit_revenue END),0) AS revenue,AVG(duration) AS duration_average,
 AVG(CASE WHEN r IN ((c+1)/2,(c+2)/2) THEN duration END) AS duration_median FROM vdr GROUP BY label) b USING(label) ORDER BY a.pageviews DESC,a.label`).bind(...args, ...groupValues(groups))
}
function pageTable(env: Env, args: (string | null)[], groups: PageGroup[], mode: 'all' | 'first' | 'last', hosts: boolean, revenue: string, hostname = false) {
 if (mode === 'all') return allPagesTable(env, args, groups, hosts, revenue, hostname)
 const path = pathLabel(groups), label = hostname ? 'hostname' : hosts ? `COALESCE(hostname,'')||${path}` : path
 return env.DB.prepare(`${visitScope(revenue)},
 x AS (SELECT ${label} AS label,* FROM (${pointRows(mode as 'first' | 'last', PAGE_COLUMNS)}) ${hostname ? 'WHERE hostname IS NOT NULL' : ''}),
 xr AS (SELECT *,SUM(n) OVER (PARTITION BY label ORDER BY on_page,visit,context,scroll ROWS UNBOUNDED PRECEDING) AS r,SUM(n) OVER (PARTITION BY label) AS c FROM x),
 vd AS (SELECT DISTINCT label,day,identity,visit,bounce,visit_converted,visit_revenue,duration FROM x),
 vdr AS (SELECT *,ROW_NUMBER() OVER (PARTITION BY label ORDER BY duration) AS r,COUNT(*) OVER (PARTITION BY label) AS c FROM vd)
 SELECT a.*,b.visits,b.bounces,b.conversions,b.revenue,b.duration_average,b.duration_median FROM
 (SELECT label,COUNT(DISTINCT identity) AS visitors,SUM(n) AS pageviews,SUM(on_page*n)*1.0/SUM(n) AS time_average,
 ${weightedMedian('on_page', 'r', 'n', 'c')} AS time_median,
 SUM(scroll*n)*1.0/SUM(CASE WHEN scroll IS NOT NULL THEN n END) AS scroll,
 SUM(CASE WHEN scroll>=75 THEN 100.0*n WHEN scroll IS NOT NULL THEN 0 END)/SUM(CASE WHEN scroll IS NOT NULL THEN n END) AS deep FROM xr GROUP BY label) a
 JOIN (SELECT label,COUNT(*) AS visits,SUM(bounce) AS bounces,SUM(visit_converted) AS conversions,
 COALESCE(SUM(CASE WHEN ?4 IS NULL OR visit_converted=1 THEN visit_revenue END),0) AS revenue,AVG(duration) AS duration_average,
 AVG(CASE WHEN r IN ((c+1)/2,(c+2)/2) THEN duration END) AS duration_median FROM vdr GROUP BY label) b USING(label) ORDER BY a.pageviews DESC,a.label`).bind(...args, ...groupValues(groups))
}

// A range without visit facts has empty tables and no averages; skip the grouped
// queries, whose result would be exactly that.
async function hasVisits(env: Env, scope: string, from: string, to: string) {
 return Boolean(await env.DB.prepare(`SELECT 1 FROM vane_visit_facts f JOIN vane_raw_sites s ON s.site=f.site WHERE ${rangePredicate} LIMIT 1`).bind(scope, from, to).first())
}

// Same result shape as visitMetrics. Call only when events==='vane_events':
// partial historical cutoffs, hostname filters and kept-visit sets must retain
// the exact reconstruction over their actual admitted sequence.
export async function readVisitMetrics(env: Env, scope: string, from: string, to: string, groups: PageGroup[] = [], goal: string | null = null, hosts = false, revenue = 'NULL') {
 await refreshVisitFacts(env, scope, from, to)
 if (!await hasVisits(env, scope, from, to)) return { visits: 0, timedPageviews: 0, pagesPerVisit: null, bounces: 0, bounceRate: null, medianDuration: null, averageDuration: null, topPages: [], entryPages: [], exitPages: [], hostnames: [] }
 const args = [scope, from, to, goal]
 const [all, top, entry, exit, hostnames] = await env.DB.batch<any>([
  env.DB.prepare(`WITH f AS (SELECT d.* FROM vane_visit_duration_frequencies d JOIN vane_raw_sites s ON s.site=d.site WHERE s.site_id IN (SELECT value FROM json_each(?1)) AND d.day>=?2 AND d.day<?3),
   r AS (SELECT duration,SUM(n) AS n FROM f GROUP BY duration),
   x AS (SELECT *,SUM(n) OVER (ORDER BY duration ROWS UNBOUNDED PRECEDING) AS r,SUM(n) OVER () AS c FROM r)
   SELECT (SELECT COALESCE(SUM(visits),0) FROM vane_visit_days d JOIN vane_raw_sites s ON s.site=d.site WHERE s.site_id IN (SELECT value FROM json_each(?1)) AND d.day>=?2 AND d.day<?3) AS visits,
   (SELECT COALESCE(SUM(pageviews),0) FROM vane_visit_days d JOIN vane_raw_sites s ON s.site=d.site WHERE s.site_id IN (SELECT value FROM json_each(?1)) AND d.day>=?2 AND d.day<?3) AS pageviews,
   (SELECT COALESCE(SUM(bounces),0) FROM vane_visit_days d JOIN vane_raw_sites s ON s.site=d.site WHERE s.site_id IN (SELECT value FROM json_each(?1)) AND d.day>=?2 AND d.day<?3) AS bounces,
   SUM(duration*n)*1.0/SUM(n) AS average,${weightedMedian('duration', 'r', 'n', 'c')} AS median FROM x`).bind(scope, from, to),
  pageTable(env, args, groups, 'all', hosts, revenue), pageTable(env, args, groups, 'first', hosts, revenue), pageTable(env, args, groups, 'last', hosts, revenue), pageTable(env, args, [], 'all', false, revenue, true),
 ])
 const total = all.results[0], visits = Number(total.visits), pageviews = Number(total.pageviews), bounces = Number(total.bounces)
 return { visits, timedPageviews: pageviews, pagesPerVisit: visits ? Math.round(pageviews / visits * 100) / 100 : null, bounces, bounceRate: rate(bounces, visits), medianDuration: seconds(total.median), averageDuration: seconds(total.average), topPages: top.results.map(pageRow), entryPages: entry.results.map(pageRow), exitPages: exit.results.map(pageRow), hostnames: hostnames.results.map(pageRow) }
}

export async function readEntryMetrics(env: Env, scope: string, from: string, to: string, goal: string | null, sourceName: string, revenue = 'NULL'): Promise<Record<keyof typeof ENTRY_DIMENSIONS, VisitRow[]> & { sourceReferrers: { source: string; referrer: string; visits: number }[] }> {
 await refreshVisitFacts(env, scope, from, to)
 const names = Object.keys(ENTRY_DIMENSIONS) as (keyof typeof ENTRY_DIMENSIONS)[]
 if (!await hasVisits(env, scope, from, to)) return { ...Object.fromEntries(names.map(name => [name, []])), sourceReferrers: [] } as any
 const base = `${reportFrom(revenue)}, entry AS (${pointRows('first')})`
 const results = await env.DB.batch<any>(names.map(name => env.DB.prepare(`${base},
  x AS (SELECT ${name === 'sourceVisits' ? sourceName : ENTRY_DIMENSIONS[name]} AS label,* FROM entry),
  xr AS (SELECT *,ROW_NUMBER() OVER (PARTITION BY label ORDER BY duration) AS r,COUNT(*) OVER (PARTITION BY label) AS c FROM x WHERE label IS NOT NULL)
  SELECT label,COUNT(DISTINCT visit_identity) AS visitors,COUNT(*) AS visits,SUM(bounce) AS bounces,SUM(visit_converted) AS conversions,
  COALESCE(SUM(CASE WHEN ?4 IS NULL OR visit_converted=1 THEN visit_revenue END),0) AS revenue,AVG(duration) AS average,
  AVG(CASE WHEN r IN ((c+1)/2,(c+2)/2) THEN duration END) AS median FROM xr GROUP BY label ORDER BY visits DESC,label`).bind(scope, from, to, goal)).concat(
  env.DB.prepare(`${base} SELECT ${sourceName} AS source,lower(source) AS referrer,COUNT(*) AS visits FROM entry WHERE source<>'direct' GROUP BY 1,2 ORDER BY 1,visits DESC,2`).bind(scope, from, to, goal)))
 const tables = Object.fromEntries(names.map((name, i) => [name, results[i]!.results.map((r: any): VisitRow => ({ label: r.label, visitors: Number(r.visitors), visits: Number(r.visits), bounceRate: rate(Number(r.bounces), Number(r.visits)), medianDuration: seconds(r.median), averageDuration: seconds(r.average), conversions: Number(r.conversions), conversionRate: rate(Number(r.conversions), Number(r.visits)), revenue: Number(r.revenue) / 1e6 }))]))
 return { ...tables, sourceReferrers: results[names.length]!.results.map((r: any) => ({ source: r.source, referrer: r.referrer, visits: Number(r.visits) })) } as any
}

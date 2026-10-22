import type { Env } from '../../core'
import type { PerfRow } from '../../performance'
import { dimension } from './sql'

// Exact nearest-rank percentiles over measured page loads, weighted by the
// number of actual occurrences reporting each value. A late replacement
// subtracts its old value in the same transaction before adding its new one.
export async function readPerformanceMetrics(env: Env, scope: string, from: string, to: string, hosts: boolean) {
 const read = async (label: string): Promise<PerfRow[]> => {
  const result = await env.DB.prepare(`WITH f AS (
   SELECT ${label} AS label,p.metric,p.value,SUM(p.n) AS n FROM vane_visit_performance p
   JOIN vane_raw_contexts c ON c.context=p.context JOIN vane_raw_sites s ON s.site=c.site
   WHERE s.site_id IN (SELECT value FROM json_each(?1)) AND c.day>=?2 AND c.day<?3 GROUP BY label,p.metric,p.value
  ), r AS (SELECT *,SUM(n) OVER (PARTITION BY label,metric ORDER BY value ROWS UNBOUNDED PRECEDING) AS r,SUM(n) OVER (PARTITION BY label,metric) AS total FROM f),
  percentiles AS (SELECT label,metric,MIN(value) AS value FROM r WHERE r>=(3*total+3)/4 GROUP BY label,metric),
  counts AS (SELECT ${label} AS label,SUM(p.n) AS measured FROM vane_visit_measured p JOIN vane_raw_contexts c ON c.context=p.context JOIN vane_raw_sites s ON s.site=c.site
   WHERE s.site_id IN (SELECT value FROM json_each(?1)) AND c.day>=?2 AND c.day<?3 GROUP BY label)
  SELECT counts.label,counts.measured,MAX(CASE WHEN metric='lcp' THEN value END) AS lcp,MAX(CASE WHEN metric='inp' THEN value END) AS inp,
  MAX(CASE WHEN metric='cls' THEN value END) AS cls,MAX(CASE WHEN metric='load' THEN value END) AS load
  FROM counts LEFT JOIN percentiles USING(label) GROUP BY counts.label,counts.measured ORDER BY measured DESC,counts.label`).bind(scope, from, to).all<any>()
  return result.results.map((r: any) => ({ label: r.label, measured: Number(r.measured), ...Object.fromEntries(['lcp','inp','cls','load'].map(k => [k, r[k] == null ? null : Number(r[k])])) })) as PerfRow[]
 }
 const [pages, devices] = await Promise.all([read(hosts ? `COALESCE(${dimension('hostname')},'')||${dimension('path')}` : dimension('path')), read(`COALESCE(${dimension('device')},'unknown')`)])
 return { pages, devices }
}

import { rows, type Env } from '../core'
import { ANALYTIC_DIMENSIONS, dimensionSql } from './schema'
import type { AnalyticsRange } from './read'

// Internal SQL sources retain occurrence weights. They must never be passed to
// a raw COUNT(*) query or a visit-reconstruction query.
export const analyticsCellsSource = (table = 'vane_analytics_cells') => `(SELECT site_id,day,kind,n AS occurrence_count,
 ${ANALYTIC_DIMENSIONS.map(name => `${dimensionSql(name)} AS ${name}`).join(',')}
 FROM ${table})`
const predicate = "site_id IN (SELECT value FROM json_each(?1)) AND day>=?2 AND day<?3"
const bindings = (range: AnalyticsRange) => [JSON.stringify(range.siteIds), range.from, range.to]

export async function analyticsUniques(env: Env, range: AnalyticsRange) {
 const [r] = await rows<{ n: number }>(env, `SELECT COUNT(DISTINCT identity) AS n FROM vane_analytics_identities
 WHERE ${predicate} AND kind='pageview'`, ...bindings(range))
 return Number(r!.n)
}

export async function analyticsConverters(env: Env, range: AnalyticsRange) {
 return rows<{ label: string | null; converters: number }>(env, `SELECT kind AS label,COUNT(DISTINCT identity) AS converters
 FROM vane_analytics_identities WHERE ${predicate} AND kind!='pageview' GROUP BY kind
 UNION ALL SELECT NULL,COUNT(DISTINCT identity) FROM vane_analytics_identities WHERE ${predicate} AND kind!='pageview'`, ...bindings(range))
}

const deviceColumns = ['device', 'browser', "browser||' '||COALESCE(browser_version,'')", 'os', "os||' '||COALESCE(os_version,'')", "COALESCE(screen,'Unknown')"]
export async function analyticsDeviceDimension(env: Env, range: AnalyticsRange, column: string) {
 if (!deviceColumns.includes(column)) throw new Error('Unknown device dimension')
 const identities = `(SELECT *,${ANALYTIC_DIMENSIONS.map(name => `${dimensionSql(name)} AS ${name}`).join(',')} FROM vane_analytics_identities)`
 return rows<{ label: string; visitors: number; pageviews: number }>(env, `WITH counts AS (
  SELECT ${column} AS label,SUM(occurrence_count) AS pageviews FROM ${analyticsCellsSource()}
  WHERE ${predicate} AND kind='pageview' AND device IS NOT NULL GROUP BY label
 ), people AS (
  SELECT ${column} AS label,COUNT(DISTINCT identity) AS visitors FROM ${identities}
  WHERE ${predicate} AND kind='pageview' AND device IS NOT NULL GROUP BY label
 ) SELECT counts.label,COALESCE(people.visitors,0) AS visitors,counts.pageviews FROM counts LEFT JOIN people ON people.label IS counts.label
 ORDER BY pageviews DESC,counts.label`, ...bindings(range))
}

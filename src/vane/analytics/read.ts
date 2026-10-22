import { rows, type Env } from '../core'
import { bucketSql, bucketsOf, localMidnight, type Interval } from '../periods'
import { visitorKey } from '../visitor-key'
import { ANALYTIC_DIMENSIONS, dimensionSql, type AnalyticDimension } from './schema'

export interface AnalyticsRange { siteIds: string[]; from: string; to: string }
const predicate = "site_id IN (SELECT value FROM json_each(?1)) AND day>=?2 AND day<?3"
const bindings = (range: AnalyticsRange) => [JSON.stringify(range.siteIds), range.from, range.to]

// Whole local dates, native events only. These are intentionally small building
// blocks, not a substitute report with absent metrics filled with zero. Caller
// still owns import visibility, running comparisons, visits and visit filters.
export async function analyticsTotals(env: Env, range: AnalyticsRange) {
 const args = bindings(range)
 const result = await env.DB.batch<any>([
  env.DB.prepare(`SELECT COALESCE(SUM(CASE WHEN kind='pageview' THEN n ELSE 0 END),0) AS pageviews,
   COALESCE(SUM(CASE WHEN kind!='pageview' THEN n ELSE 0 END),0) AS goals,
   COALESCE(SUM(CASE WHEN kind='pageview' THEN timed ELSE 0 END),0) AS timedPageviews,
   COALESCE(SUM(CASE WHEN kind='pageview' THEN consented ELSE 0 END),0) AS consentedPageviews
   FROM vane_analytics_cells WHERE ${predicate}`).bind(...args),
  env.DB.prepare(`SELECT COUNT(DISTINCT CASE WHEN kind='pageview' THEN identity END) AS visitors,
   COUNT(DISTINCT CASE WHEN kind!='pageview' THEN identity END) AS converters
   FROM vane_analytics_identities WHERE ${predicate}`).bind(...args),
 ])
 return { ...result[0].results[0], ...result[1].results[0] } as {
  pageviews: number; goals: number; timedPageviews: number; consentedPageviews: number; visitors: number; converters: number
 }
}

export interface AnalyticsGroup { label: string | null; count: number; visitors: number }
export async function analyticsGroup(env: Env, range: AnalyticsRange, dimension: AnalyticDimension, goalEvents = false): Promise<AnalyticsGroup[]> {
 if (!ANALYTIC_DIMENSIONS.includes(dimension)) throw new Error('Unknown analytical dimension')
 const label = dimensionSql(dimension), kind = goalEvents ? "kind!='pageview'" : "kind='pageview'"
 return rows<AnalyticsGroup>(env, `WITH counts AS (
  SELECT ${label} AS label,SUM(n) AS count FROM vane_analytics_cells WHERE ${predicate} AND ${kind} GROUP BY label
 ), people AS (
  SELECT ${label} AS label,COUNT(DISTINCT identity) AS visitors FROM vane_analytics_identities WHERE ${predicate} AND ${kind} GROUP BY label
 ) SELECT counts.label,counts.count,COALESCE(people.visitors,0) AS visitors FROM counts LEFT JOIN people ON people.label IS counts.label
 ORDER BY counts.count DESC,counts.label`, ...bindings(range))
}

export async function analyticsGoals(env: Env, range: AnalyticsRange) {
 return rows<{ label: string; count: number; converters: number }>(env, `WITH counts AS (
  SELECT kind AS label,SUM(n) AS count FROM vane_analytics_cells WHERE ${predicate} AND kind!='pageview' GROUP BY kind
 ), people AS (
  SELECT kind AS label,COUNT(DISTINCT identity) AS converters FROM vane_analytics_identities WHERE ${predicate} AND kind!='pageview' GROUP BY kind
 ) SELECT counts.*,COALESCE(people.converters,0) AS converters FROM counts LEFT JOIN people USING(label) ORDER BY count DESC,label`, ...bindings(range))
}

export async function analyticsTransport(env: Env, range: AnalyticsRange) {
 const [r] = await rows<{ proxy: number; direct: number; unknown: number; total: number }>(env,
  `SELECT COALESCE(SUM(CASE WHEN ${dimensionSql('transport')}='proxy' THEN n ELSE 0 END),0) AS proxy,
   COALESCE(SUM(CASE WHEN ${dimensionSql('transport')}='direct' THEN n ELSE 0 END),0) AS direct,
   COALESCE(SUM(CASE WHEN ${dimensionSql('transport')} IS NULL THEN n ELSE 0 END),0) AS unknown,
   COALESCE(SUM(n),0) AS total FROM vane_analytics_cells WHERE ${predicate} AND kind='pageview'`, ...bindings(range))
 const share = (n: number) => r!.total ? Math.round(n / r!.total * 1000) / 10 : null
 return { ...r!, proxyShare: share(r!.proxy), directShare: share(r!.direct), unknownShare: share(r!.unknown) }
}

// Only the fields whose definitions depend on event occurrence, not visits or
// money. Merge these into the shared series; never claim this is a full Bucket.
export async function analyticsEventSeries(env: Env, range: AnalyticsRange, interval: Exclude<Interval, 'hour'>, timeZone: string) {
 if (interval === ('hour' as string)) throw new Error('Daily analytics do not answer hourly or partial-day queries')
 const key = bucketSql(interval, ''), args = bindings(range)
 const result = await env.DB.batch<any>([
  env.DB.prepare(`SELECT ${key} AS key,SUM(CASE WHEN kind='pageview' THEN n ELSE 0 END) AS pageviews,
   SUM(CASE WHEN kind!='pageview' THEN n ELSE 0 END) AS conversions
   FROM vane_analytics_cells WHERE ${predicate} GROUP BY key`).bind(...args),
  env.DB.prepare(`SELECT ${key} AS key,COUNT(DISTINCT identity) AS visitors FROM vane_analytics_identities
   WHERE ${predicate} AND kind='pageview' GROUP BY key`).bind(...args),
 ])
 const counts = new Map<string, any>(result[0].results.map((r: any) => [r.key, r])), people = new Map<string, any>(result[1].results.map((r: any) => [r.key, r]))
 return bucketsOf(interval, range.from, range.to, timeZone).map(bucket => ({ ...bucket,
  pageviews: Number(counts.get(bucket.key)?.pageviews ?? 0), conversions: Number(counts.get(bucket.key)?.conversions ?? 0), visitors: Number(people.get(bucket.key)?.visitors ?? 0),
 }))
}

// The overview only displays visitor sparklines. Do not reconstruct visits,
// revenue or the rest of the dashboard to answer this one metric.
export async function analyticsVisitorSeries(env: Env, range: AnalyticsRange, interval: Interval, timeZone: string) {
 const hourly = interval === 'hour', key = bucketSql(interval, '?4')
 const list = await rows<{ key: string; visitors: number }>(env,
  `SELECT ${key} AS key,COUNT(DISTINCT ${hourly ? visitorKey() : 'identity'}) AS visitors
   FROM ${hourly ? 'vane_events' : 'vane_analytics_identities'}
   WHERE ${predicate} AND kind='pageview'${hourly ? ' AND at IS NOT NULL AND visitor IS NOT NULL' : ''} GROUP BY key`,
  ...bindings(range), ...(hourly ? [localMidnight(range.from, timeZone)] : []))
 const counts = new Map(list.map(row => [String(row.key), Number(row.visitors)]))
 return bucketsOf(interval, range.from, range.to, timeZone).map(bucket => ({ ...bucket, visitors: counts.get(bucket.key) ?? 0 }))
}

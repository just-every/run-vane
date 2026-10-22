import type { Env } from '../core'
import { bucketSql, type Interval } from '../periods'
import type { Bucket } from '../series'
import { timedFrom } from '../visits'
import { visibleImports } from '../movein/cutover'
import { analyticsEventSeries, type AnalyticsRange } from './read'

// Daily occurrence values come from cells. Visit and revenue values retain
// their existing exact raw computations until those facts are materialized.
export async function analyticsReportSeries(env: Env, range: AnalyticsRange, interval: Exclude<Interval, 'hour'>, timeZone: string, revenue: string, includeImports: boolean): Promise<Bucket[]> {
 const scope = JSON.stringify(range.siteIds), args = [scope, range.from, range.to], key = bucketSql(interval, '')
 const events = analyticsEventSeries(env, range, interval, timeZone)
 const imported = includeImports ? env.DB.prepare(`SELECT ${key} AS k,SUM(kind='pageview') AS pageviews,SUM(kind!='pageview') AS conversions
  FROM ${visibleImports('vane_import_events')} WHERE site_id IN (SELECT value FROM json_each(?1)) AND day>=?2 AND day<?3 GROUP BY k`).bind(...args).all<any>() : Promise.resolve({ results: [] as any[] })
 const [native, history, details] = await Promise.all([events, imported, env.DB.batch<any>([
  env.DB.prepare(`${timedFrom('vane_events')} SELECT ${bucketSql(interval, '', 'started')} AS k,COUNT(*) AS visits,SUM(bounce) AS bounces,AVG(duration) AS duration FROM v GROUP BY k`).bind(...args, null),
  env.DB.prepare(`SELECT ${key} AS k,COALESCE(SUM(r),0) AS revenue FROM (SELECT p.day,p.at,${revenue} AS r
   FROM vane_custom_events ce JOIN vane_events p ON p.id=ce.page_id WHERE p.kind='pageview'
   AND p.site_id IN (SELECT value FROM json_each(?1)) AND p.day>=?2 AND p.day<?3) GROUP BY k`).bind(...args),
 ])])
 const map = (list: any[]) => new Map<string, any>(list.map(row => [String(row.k), row]))
 const h = map(history.results), v = map(details[0].results), money = map(details[1].results)
 return native.map(bucket => {
  const visit = v.get(bucket.key), count = Number(visit?.visits ?? 0), history = h.get(bucket.key)
  return { ...bucket, pageviews: bucket.pageviews + Number(history?.pageviews ?? 0), conversions: bucket.conversions + Number(history?.conversions ?? 0),
   visits: count, bounceRate: count ? Math.round(Number(visit.bounces) / count * 1000) / 10 : null,
   duration: count ? Math.round(Number(visit.duration) / 1000) : null, revenue: Number(money.get(bucket.key)?.revenue ?? 0) / 1e6 }
 })
}

import { visitorKey } from './visitor-key'
import type { Env } from './core'
import { bucketSql, bucketsOf, localMidnight, type Interval } from './periods'
import { timedFrom } from './visits'
import { readVisitSeries } from './analytics/visits'
// DASH-002: the main chart's buckets. Visitors deduplicate consented identities within each bucket and sum cookie-free daily uniques (an hour
// counts its distinct hashes); visits, bounce rate and visit duration belong to the bucket of the visit's
// first page load; pageviews and conversions (goal events) count where they happened. Hourly buckets hold
// timed live events only, so imported history, which has dates but no times, appears from daily buckets up.
export const METRICS={visitors:'Unique visitors',visits:'Visits',pageviews:'Pageviews',bounceRate:'Bounce rate',duration:'Visit duration (average)',conversions:'Goal conversions',revenue:'Revenue'} as const
export type Metric=keyof typeof METRICS
export interface Bucket { key:string; label:string; visitors:number; visits:number; pageviews:number; bounceRate:number|null; duration:number|null; conversions:number; revenue:number }
// CONV-006: revenue counts in the bucket of the page load it was sent on, in the reporting currency (revenue.ts).
export async function timeSeries(env:Env,siteId:string,from:string,to:string,interval:Interval,timeZone:string,eventSet:string,ev:string,revenue='NULL'):Promise<Bucket[]> {
 // An hour's key is its index from the range's first local midnight, bound as the last parameter.
 const hour=interval==='hour',start=hour?[localMidnight(from,timeZone)]:[]
 const visitRows=ev==='vane_events'?readVisitSeries(env,siteId,from,to,interval,timeZone):null
 const [events,rawVisits,money]=await env.DB.batch<any>([
  env.DB.prepare(`SELECT ${bucketSql(interval,'?4')} AS k,SUM(kind='pageview') AS pageviews,SUM(kind!='pageview') AS conversions,COUNT(DISTINCT CASE WHEN kind='pageview' AND visitor IS NOT NULL THEN ${visitorKey()} END) AS visitors FROM ${hour?`(SELECT * FROM ${ev} WHERE at IS NOT NULL)`:eventSet} WHERE site_id IN (SELECT value FROM json_each(?1)) AND day>=?2 AND day<?3 GROUP BY k`).bind(siteId,from,to,...start),
  visitRows?env.DB.prepare('SELECT NULL AS k WHERE 0'):env.DB.prepare(`${timedFrom(ev)} SELECT ${bucketSql(interval,'?5','started')} AS k,COUNT(*) AS visits,SUM(bounce) AS bounces,AVG(duration) AS duration FROM v GROUP BY k`).bind(siteId,from,to,null,...start),
  env.DB.prepare(`SELECT ${bucketSql(interval,'?4')} AS k,COALESCE(SUM(r),0) AS revenue FROM (SELECT p.day,p.at,${revenue} AS r FROM vane_custom_events ce JOIN ${ev} p ON p.id=ce.page_id WHERE p.kind='pageview' AND p.site_id IN (SELECT value FROM json_each(?1)) AND p.day>=?2 AND p.day<?3${hour?' AND p.at IS NOT NULL':''}) GROUP BY k`).bind(siteId,from,to,...start),
 ])
 const by=(result:any)=>new Map<string,any>(result.results.map((r:any)=>[String(r.k),r]))
 const e=by(events),v=by(visitRows?{results:await visitRows}:rawVisits),m=by(money)
 return bucketsOf(interval,from,to,timeZone).map(({key,label})=>{const a=e.get(key),b=v.get(key),n=Number(b?.visits??0);return {key,label,visitors:Number(a?.visitors??0),visits:n,pageviews:Number(a?.pageviews??0),bounceRate:n?Math.round(Number(b.bounces)/n*1000)/10:null,duration:n?Math.round(Number(b.duration)/1000):null,conversions:Number(a?.conversions??0),revenue:Number(m.get(key)?.revenue??0)/1e6}})
}

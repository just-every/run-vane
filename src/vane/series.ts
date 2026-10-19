import type { Env } from './core'
import { bucketSql, bucketsOf, localMidnight, type Interval } from './periods'
import { timedFrom } from './visits'
// DASH-002: the main chart's buckets. Visitors are each bucket's daily uniques summed over its days (an hour
// counts its distinct hashes); visits, bounce rate and visit duration belong to the bucket of the visit's
// first page load; pageviews and conversions (goal events) count where they happened. Hourly buckets hold
// timed live events only, so imported history, which has dates but no times, appears from daily buckets up.
export const METRICS={visitors:'Unique visitors',visits:'Visits',pageviews:'Pageviews',bounceRate:'Bounce rate',duration:'Visit duration (average)',conversions:'Goal conversions'} as const
export type Metric=keyof typeof METRICS
export interface Bucket { key:string; label:string; visitors:number; visits:number; pageviews:number; bounceRate:number|null; duration:number|null; conversions:number }
export async function timeSeries(env:Env,siteId:string,from:string,to:string,interval:Interval,timeZone:string,eventSet:string,ev:string):Promise<Bucket[]> {
 // An hour's key is its index from the range's first local midnight, bound as the last parameter.
 const hour=interval==='hour',start=hour?[localMidnight(from,timeZone)]:[]
 const [events,visits]=await env.DB.batch<any>([
  env.DB.prepare(`SELECT ${bucketSql(interval,'?4')} AS k,SUM(kind='pageview') AS pageviews,SUM(kind!='pageview') AS conversions,COUNT(DISTINCT CASE WHEN kind='pageview' AND visitor IS NOT NULL THEN day||' '||visitor END) AS visitors FROM ${hour?`(SELECT * FROM ${ev} WHERE at IS NOT NULL)`:eventSet} WHERE site_id IN (SELECT value FROM json_each(?1)) AND day>=?2 AND day<?3 GROUP BY k`).bind(siteId,from,to,...start),
  env.DB.prepare(`${timedFrom(ev)} SELECT ${bucketSql(interval,'?5','started')} AS k,COUNT(*) AS visits,SUM(bounce) AS bounces,AVG(duration) AS duration FROM v GROUP BY k`).bind(siteId,from,to,null,...start),
 ])
 const by=(result:any)=>new Map<string,any>(result.results.map((r:any)=>[String(r.k),r]))
 const e=by(events),v=by(visits)
 return bucketsOf(interval,from,to,timeZone).map(({key,label})=>{const a=e.get(key),b=v.get(key),n=Number(b?.visits??0);return {key,label,visitors:Number(a?.visitors??0),visits:n,pageviews:Number(a?.pageviews??0),bounceRate:n?Math.round(Number(b.bounces)/n*1000)/10:null,duration:n?Math.round(Number(b.duration)/1000):null,conversions:Number(a?.conversions??0)}})
}

import { allow, inScope, insist, rows, site, type Actor, type Env } from '../core'
import { connection } from './store'
import type { Metrics, Stored } from './types'
import { keptValue } from '../paths'

function metrics(value:Pick<Stored,'clicks'|'impressions'|'position_sum'|'position_weight'>):Metrics {
 return {clicks:value.clicks,impressions:value.impressions,ctr:value.impressions?value.clicks/value.impressions:null,position:value.position_weight?value.position_sum/value.position_weight:null}
}
function group(values:Stored[],keys:('query'|'page'|'day')[]):Array<Record<string,string|number|null>&Metrics> {
 const map=new Map<string,Stored>()
 for(const value of values){
  const key=JSON.stringify(keys.map(k=>value[k])),held=map.get(key)
  if(held){held.clicks+=value.clicks;held.impressions+=value.impressions;held.position_sum+=value.position_sum;held.position_weight+=value.position_weight}
  else map.set(key,{...value})
 }
 return [...map.values()].map(value=>({...Object.fromEntries(keys.map(k=>[k==='day'?'date':k,value[k]])),...metrics(value)}))
}
const validDay=(day:string)=>/^\d{4}-\d{2}-\d{2}$/.test(day)&&Number.isFinite(Date.parse(day))&&new Date(day+'T00:00:00Z').toISOString().slice(0,10)===day
// Internal SQL helper, not an HTTP handler. Callers without a native Actor must
// establish site scope at their private report, Stats API or scheduled-report door.
export async function queryPaths(env:Env,siteId:string,query:string,from:string,to:string,actor?:Actor):Promise<string[]> {
 if(actor){allow(actor,'viewer');inScope(actor,siteId)}await site(env,siteId)
 insist(validDay(from)&&validDay(to)&&from<to,'period','Choose a valid date range; the end date is exclusive.')
 const kept=keptValue(query);if(kept===null)return []
 return (await rows<{page:string}>(env,"SELECT DISTINCT page FROM vane_bing_rows WHERE site_id=? AND kind='query-page' AND query=? AND day>=? AND day<? ORDER BY page",siteId,kept,from,to)).map(row=>row.page)
}
export async function report(env:Env,actor:Actor,siteId:string,from:string,to:string) {
 allow(actor,'viewer');inScope(actor,siteId);await site(env,siteId)
 insist(validDay(from)&&validDay(to)&&from<to,'period','Choose a valid date range; the end date is exclusive.')
 const config=await connection(env,siteId),values=await rows<Stored>(env,'SELECT * FROM vane_bing_rows WHERE site_id=? AND day>=? AND day<? ORDER BY day,kind,query,page',siteId,from,to)
 const by=(kind:Stored['kind'])=>values.filter(value=>value.kind===kind)
 return {
  provider:'bing' as const,from,to,
  connection:{connected:Boolean(config),property:config?.property??null,connectedAt:config?.connected_at??null,lastSyncAt:config?.last_sync_at??null,lastAttemptAt:config?.last_attempt_at??null,nextSyncAt:config?.next_sync_at??null,error:config?.error??null,queryPagesError:config?.query_pages_error??null},
  queries:group(by('query'),['query']),pages:group(by('page'),['page']),dates:group(by('date'),['day']),
  queryPages:group(by('query-page'),['query','page']).map(value=>({...value,path:value.page})),
  rows:values.map(value=>({date:value.day,kind:value.kind,query:value.query||null,page:value.page||null,...metrics(value),fetchedAt:value.fetched_at})),
  metadata:{
   position:'Bing AvgImpressionPosition, weighted by source impressions when rows are combined. Site/date totals do not provide position.',
   ctr:'Source Clicks / source Impressions, as a fraction; null when impressions are zero.',
   date:'Bing source calendar dates, preserved from the WCF timestamp and its recorded offset. Query, page and query-page data are updated weekly; no values are interpolated between source dates.',
   coverage:'Top queries and pages returned by Bing, with queries for each returned page. Site/date totals are GetRankAndTrafficStats (all Bing verticals). Separate datasets overlap and must not be added together. No country or device dimension is supplied by these endpoints.',
   empty:'An empty source response means Bing returned no rows, not measured zero. Previously observed history is retained outside the returned source date window. Each row carries its actual fetch time.',
   privacy:'Query labels use keptValue; page URLs retain only storedPath. Removed query labels are omitted; redacted labels that coincide are combined.',
   schedule:'Checked daily. Bing controls publication cadence and available history.',
   latestSourceRows:config?.source_counts?JSON.parse(config.source_counts) as Record<string,number|null>:null
  }
 }
}

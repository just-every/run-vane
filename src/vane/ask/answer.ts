import { site, type Env } from '../core'
import { statsV1 } from '../stats-api'
import { filterText, parseFilters } from '../segments'
import type { AskQuery } from './plan'

// The answer is the Stats API's own answer for the query shown: this runs statsV1, the function behind GET /api/v1/stats.
export function statsUrl(origin:string,siteId:string,q:AskQuery):URL {
 const url=new URL('/api/v1/stats',origin)
 url.searchParams.set('site_id',siteId);url.searchParams.set('metrics',q.metrics.join(','))
 for(const [key,value] of [['dimension',q.dimension],['period',q.period],['from',q.from],['to',q.to],['compare',q.compare]] as [string,string|undefined][])if(value)url.searchParams.set(key,value)
 for(const filter of q.filters)url.searchParams.append('filter',filter)
 return url
}
export interface AskAnswer { kind:'answer'; siteId:string; query:AskQuery; api:string; range:{from:string;to:string;timeZone:string}; filters:string[]; stats:any }
export async function run(env:Env,siteId:string,q:AskQuery):Promise<AskAnswer> {
 const value=await site(env,siteId),url=statsUrl(env.AUTH_ORIGIN,value.id,q),stats=await statsV1(env,url)
 return {kind:'answer',siteId:value.id,query:q,api:url.pathname+url.search,range:{from:stats.from,to:stats.to,timeZone:stats.time_zone},filters:parseFilters(q.filters).map(f=>filterText(f)),stats}
}

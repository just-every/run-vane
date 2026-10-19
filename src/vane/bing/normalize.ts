import type { Config } from '../core'
import { keptValue, storedPath } from '../paths'
import { BingError } from './api'
import type { Aggregate, Kind, SourceRow } from './types'

const invalid=()=>new BingError('Bing returned an invalid source date or metric; the previous successful data has been kept.')
export function sourceDate(value:unknown):string {
 if(typeof value!=='string')throw invalid()
 const dotnet=value.match(/^\/Date\((-?\d+)([+-])(\d{2})(\d{2})\)\/$/),utc=value.match(/^\/Date\((-?\d+)\)\/$/)
 if(dotnet||utc){
  const stamp=Number((dotnet??utc)![1]);let offset=0
  if(dotnet){const hours=Number(dotnet[3]),minutes=Number(dotnet[4]);if(hours>23||minutes>59)throw invalid();offset=(hours*60+minutes)*60000*(dotnet[2]==='-'?-1:1)}
  // The milliseconds encode the instant. The suffix preserves the source's local
  // calendar label (Bing's XML example is midnight -07:00), not the Vane site zone.
  const date=new Date(stamp+offset);if(!Number.isFinite(date.getTime()))throw invalid();return date.toISOString().slice(0,10)
 }
 // Retain the date label if Microsoft sends an ISO timestamp rather than WCF JSON.
 if(/^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2}))?$/.test(value)&&Number.isFinite(Date.parse(value))){
  const label=value.slice(0,10);if(new Date(label+'T00:00:00Z').toISOString().slice(0,10)===label)return label
 }
 throw invalid()
}
function count(value:unknown):number {if(typeof value!=='number'||!Number.isSafeInteger(value)||value<0)throw invalid();return value}
export function pagePath(config:Config,value:unknown):string {
 if(typeof value!=='string')throw invalid()
 let url:URL;try{url=new URL(value)}catch{throw invalid()}
 if(!['http:','https:'].includes(url.protocol)||url.username||url.password)throw invalid()
 return storedPath(config,url.pathname)
}
export function normalize(config:Config,kind:Kind,values:SourceRow[],page=''):Aggregate[] {
 const result:Aggregate[]=[]
 for(const value of values){
  if(!value||typeof value!=='object')throw invalid()
  const day=sourceDate(value.Date),clicks=count(value.Clicks),impressions=count(value.Impressions)
  let query='',path=page,position=0,weight=0
  if(kind==='page')path=pagePath(config,value.Query)
  if(kind==='query'||kind==='query-page'){
   if(typeof value.Query!=='string')throw invalid()
   const kept=keptValue(value.Query);if(kept===null)continue;query=kept
  }
  if(kind!=='date'){
   if(typeof value.AvgImpressionPosition!=='number'||!Number.isFinite(value.AvgImpressionPosition)||value.AvgImpressionPosition<0)throw invalid()
   position=value.AvgImpressionPosition*impressions;weight=impressions
  }
  result.push({day,kind,query,page:path,clicks,impressions,position_sum:position,position_weight:weight})
 }
 return fold(result)
}
export function fold(values:Aggregate[]):Aggregate[] {
 const grouped=new Map<string,Aggregate>()
 for(const value of values){
  const key=JSON.stringify([value.day,value.kind,value.query,value.page]),held=grouped.get(key)
  if(held){held.clicks+=value.clicks;held.impressions+=value.impressions;held.position_sum+=value.position_sum;held.position_weight+=value.position_weight}
  else grouped.set(key,{...value})
 }
 return [...grouped.values()]
}

import type { Env } from './core'
import { timedFrom, type VisitRow } from './visits'
import { leadingPlace, named, UNKNOWN_LOCATION, UNKNOWN_METRO, type MetroNaming, type Place } from './metro-names'
import { readLocationMetrics, readMetroPlaces } from './analytics/visits/locations'
// DASH-005: a page load's location comes from Cloudflare's request geolocation at collection: the country (stored
// as its English name), the first-level region (a US state, a Canadian province, England), the city, and for US
// visitors the Nielsen metro area (DMA) code, only when it is exactly 3 ASCII digits. Never an IP address and never a
// metro name: names come from the site's owner-approved table when an answer is made (metro-names.ts). Requests
// without Cloudflare geolocation, and server-side Events API sends (INSTALL-008), whose request location is the
// sender's server, carry no location.
export interface Location { country:string|null; region:string|null; city:string|null; metro_code:string|null }
const names=new Intl.DisplayNames(['en'],{type:'region'})
const text=(value:unknown)=>typeof value==='string'&&value.trim()&&!/[\u0000-\u001f\u007f]/.test(value)?value.trim().slice(0,100):null
export function locationOf(request:Request):Location {
 const cf=(request as any).cf??{},code=String(cf.country??'').toUpperCase(),country=/^[A-Z]{2}$/.test(code)&&code!=='XX'&&code!=='T1'?names.of(code)??null:null
 if(!country)return {country:null,region:null,city:null,metro_code:null}
 return {country,region:text(cf.region),city:text(cf.city),metro_code:code==='US'&&/^\d{3}$/.test(String(cf.metroCode??''))?String(cf.metroCode):null}
}
// A location row: its label, the place it lies in, and VisitRow's figures. Each visit counts under its first page load's
// location, like the channel and device tables (DASH-004, CONV-004), so conversions and conversion rate are per visit.
export interface LocationRow extends VisitRow { country?:string; region?:string; metro_code?:string|null; metro_name?:string|null }
const LEVELS={countries:['country'],regions:['country','region'],cities:['country','region','city'],metros:['metro']} as const
// The US metro areas table holds US page loads keyed on their code: a US load without one counts as Unknown metro area.
// Loads without geolocation stay in the Unknown location row of the other location tables, and other countries'
// loads are not in it.
export const metroKeySql=(row:string)=>`CASE WHEN ${row}.country='United States' THEN COALESCE(${row}.metro_code,'${UNKNOWN_METRO}') END`
export type LocationLevel=keyof typeof LEVELS
const seconds=(ms:unknown)=>ms===null||ms===undefined?null:Math.round(Number(ms)/1000)
const rate=(part:number,whole:number)=>whole?Math.round(part/whole*1000)/10:null
export async function locationMetrics(env:Env,scope:string,from:string,to:string,goal:string|null,events:string,revenue='NULL',naming?:MetroNaming):Promise<Record<LocationLevel,LocationRow[]>> {
 if(events==='vane_events')return readLocationMetrics(env,scope,from,to,goal,revenue,naming)
 const levels=Object.keys(LEVELS) as LocationLevel[]
 const results=await env.DB.batch<any>(levels.map(level=>{const cols=LEVELS[level],expression=(c:string)=>c==='metro'?metroKeySql('q'):`COALESCE(q.${c},'${UNKNOWN_LOCATION}')`;return env.DB.prepare(`${timedFrom(events,revenue)},
x AS (SELECT ${cols.map(c=>`${expression(c)} AS ${c}`).join(',')},v.* FROM q JOIN v USING(day,visitor,visit) WHERE q.starts=1 ${level==='metros'?"AND q.country='United States'":''}),
xr AS (SELECT *,ROW_NUMBER() OVER (PARTITION BY ${cols.join(',')} ORDER BY duration) AS r,COUNT(*) OVER (PARTITION BY ${cols.join(',')}) AS c FROM x)
SELECT ${cols.join(',')},COUNT(DISTINCT identity) AS visitors,COUNT(*) AS visits,SUM(bounce) AS bounces,SUM(visit_converted) AS conversions,COALESCE(SUM(CASE WHEN ?4 IS NULL OR visit_converted=1 THEN visit_revenue END),0) AS revenue,AVG(duration) AS average,AVG(CASE WHEN r IN ((c+1)/2,(c+2)/2) THEN duration END) AS median FROM xr GROUP BY ${cols.join(',')} ORDER BY visits DESC,${cols.join(',')}`).bind(scope,from,to,goal)}))
 return Object.fromEntries(levels.map((level,i)=>[level,results[i]!.results.map((r:any):LocationRow=>({label:r[LEVELS[level].at(-1)!],...(level==='metros'&&naming?named(r.metro,naming):{}),...(level!=='countries'&&level!=='metros'?{country:r.country}:{}),...(level==='cities'?{region:r.region}:{}),visitors:Number(r.visitors),visits:Number(r.visits),bounceRate:rate(Number(r.bounces),Number(r.visits)),medianDuration:seconds(r.median),averageDuration:seconds(r.average),conversions:Number(r.conversions),conversionRate:rate(Number(r.conversions),Number(r.visits)),revenue:Number(r.revenue)/1e6}))])) as Record<LocationLevel,LocationRow[]>
}
// Each coded metro's observed place over the range's first page loads, counted as the report counts (daily uniques).
export async function metroPlaces(env:Env,scope:string,from:string,to:string,events:string):Promise<Record<string,Place>> {
 if(events==='vane_events')return readMetroPlaces(env,scope,from,to)
 const result=await env.DB.prepare(`${timedFrom(events)} SELECT metro_code,city,region,COUNT(DISTINCT identity) AS visitors FROM q WHERE starts=1 AND country='United States' AND metro_code IS NOT NULL GROUP BY metro_code,city,region`).bind(scope,from,to,null).all<{metro_code:string,city:string|null,region:string|null,visitors:number}>()
 const codes=[...new Set(result.results.map(r=>r.metro_code))]
 return Object.fromEntries(codes.flatMap(code=>{const place=leadingPlace(result.results.filter(r=>r.metro_code===code).map(r=>({...r,visitors:Number(r.visitors)})));return place?[[code,place]]:[]}))
}
// On shared links, embeds and the public stats page (SHARE-001, SHARE-002), a city with fewer than 5 unique visitors
// (daily uniques summed over the range) is folded into an "Other cities" row of its region, summing the folded rows.
export const FOLD_BELOW=5
export function foldCities(rows:(LocationRow&{previous?:number})[]):(LocationRow&{previous?:number})[] {
 const kept=rows.filter(r=>r.visitors>=FOLD_BELOW||r.label===UNKNOWN_LOCATION||r.label===UNKNOWN_METRO),other=new Map<string,LocationRow&{previous:number}>()
 for(const r of rows.filter(r=>r.visitors<FOLD_BELOW&&r.label!==UNKNOWN_LOCATION&&r.label!==UNKNOWN_METRO)){
  const key=JSON.stringify([r.country,r.region]),o=other.get(key)??{label:'Other cities',country:r.country,region:r.region,visitors:0,visits:0,bounceRate:null,medianDuration:null,averageDuration:null,conversions:0,conversionRate:null,revenue:0,previous:0}
  o.visitors+=r.visitors;o.visits+=r.visits;o.conversions+=r.conversions;o.revenue+=r.revenue;o.previous+=Number(r.previous??0);o.conversionRate=rate(o.conversions,o.visits);other.set(key,o)
 }
 return [...kept,...other.values()]
}

export function foldMetros(rows:(LocationRow&{previous?:number})[]):(LocationRow&{previous?:number})[] {
 const folded=foldCities(rows.map(r=>({...r,region:undefined})))
 return folded.map(r=>r.label==='Other cities'?{...r,label:'Other metro areas'}:r)
}

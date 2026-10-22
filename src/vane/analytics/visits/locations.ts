import type { Env } from '../../core'
import type { LocationLevel, LocationRow } from '../../locations'
import { leadingPlace, named, UNKNOWN_LOCATION, UNKNOWN_METRO, type MetroNaming, type Place } from '../../metro-names'
import { refreshVisitFacts } from './maintenance'
import { contextIdentity, dimension, reportFrom } from './sql'

const LEVELS = { countries: ['country'], regions: ['country', 'region'], cities: ['country', 'region', 'city'], metros: ['metro'] } as const
const seconds = (ms: unknown) => ms == null ? null : Math.round(Number(ms) / 1000)
const rate = (part: number, whole: number) => whole ? Math.round(part / whole * 1000) / 10 : null

// Location attribution follows each visit's first page. Metrics deduplicate the
// visit identity (which can become consented later in that visit); the observed
// metro place instead counts the first page's identity, as the page report does.
function firstLocations(pageIdentity = false) {
 return `SELECT v.visit,${pageIdentity ? contextIdentity() : 'v.identity'} AS identity,
 v.bounce,v.duration,v.visit_converted,v.visit_revenue,
 ${(['country', 'region', 'city', 'metro_code'] as const).map(name => `${dimension(name)} AS ${name}`).join(',')}
 FROM v JOIN vane_raw_events e ON e.raw_id=v.first_raw
 JOIN vane_raw_contexts c ON c.context=e.context JOIN vane_raw_sites s ON s.site=c.site`
}

// Only native whole-day sequences can use these facts. A filtered event set
// retains its own timedFrom reconstruction in the public location readers.
export async function readLocationMetrics(env: Env, scope: string, from: string, to: string, goal: string | null, revenue = 'NULL', naming?: MetroNaming): Promise<Record<LocationLevel, LocationRow[]>> {
 await refreshVisitFacts(env, scope, from, to)
 const levels = Object.keys(LEVELS) as LocationLevel[]
 const base = `${reportFrom(revenue)}, entry AS (${firstLocations()})`
 const results = await env.DB.batch<any>(levels.map(level => {
  const cols = LEVELS[level]
  const expression = (col: string) => col === 'metro' ? `COALESCE(entry.metro_code,'${UNKNOWN_METRO}')` : `COALESCE(entry.${col},'${UNKNOWN_LOCATION}')`
  return env.DB.prepare(`${base},
   x AS (SELECT ${cols.map(col => `${expression(col)} AS ${col}`).join(',')},identity,bounce,duration,visit_converted,visit_revenue
    FROM entry ${level === 'metros' ? "WHERE country='United States'" : ''}),
   xr AS (SELECT *,ROW_NUMBER() OVER (PARTITION BY ${cols.join(',')} ORDER BY duration) AS r,COUNT(*) OVER (PARTITION BY ${cols.join(',')}) AS c FROM x)
   SELECT ${cols.join(',')},COUNT(DISTINCT identity) AS visitors,COUNT(*) AS visits,SUM(bounce) AS bounces,SUM(visit_converted) AS conversions,
   COALESCE(SUM(CASE WHEN ?4 IS NULL OR visit_converted=1 THEN visit_revenue END),0) AS revenue,AVG(duration) AS average,
   AVG(CASE WHEN r IN ((c+1)/2,(c+2)/2) THEN duration END) AS median FROM xr
   GROUP BY ${cols.join(',')} ORDER BY visits DESC,${cols.join(',')}`).bind(scope, from, to, goal)
 }))
 return Object.fromEntries(levels.map((level, i) => [level, results[i]!.results.map((r: any): LocationRow => ({
  label: r[LEVELS[level].at(-1)!],
  ...(level === 'metros' && naming ? named(r.metro, naming) : {}),
  ...(level !== 'countries' && level !== 'metros' ? { country: r.country } : {}),
  ...(level === 'cities' ? { region: r.region } : {}),
  visitors: Number(r.visitors), visits: Number(r.visits), bounceRate: rate(Number(r.bounces), Number(r.visits)),
  medianDuration: seconds(r.median), averageDuration: seconds(r.average), conversions: Number(r.conversions),
  conversionRate: rate(Number(r.conversions), Number(r.visits)), revenue: Number(r.revenue) / 1e6,
 }))])) as Record<LocationLevel, LocationRow[]>
}

export async function readMetroPlaces(env: Env, scope: string, from: string, to: string): Promise<Record<string, Place>> {
 await refreshVisitFacts(env, scope, from, to)
 const result = await env.DB.prepare(`${reportFrom()}, entry AS (${firstLocations(true)})
  SELECT metro_code,city,region,COUNT(DISTINCT identity) AS visitors FROM entry
  WHERE country='United States' AND metro_code IS NOT NULL GROUP BY metro_code,city,region`)
  .bind(scope, from, to, null).all<{ metro_code: string, city: string | null, region: string | null, visitors: number }>()
 const codes = [...new Set(result.results.map(r => r.metro_code))]
 return Object.fromEntries(codes.flatMap(code => {
  const place = leadingPlace(result.results.filter(r => r.metro_code === code).map(r => ({ ...r, visitors: Number(r.visitors) })))
  return place ? [[code, place]] : []
 }))
}

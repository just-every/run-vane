import type { Env } from '../../core'
import { unpackedIdSql } from '../../raw/schema'
import { refreshVisitFacts } from './maintenance'
import { contextIdentity, dimension } from './sql'

// Filter contexts before reading occurrences: a page without a search never
// needs its raw history reconstructed. Empty redacted terms still count.
const searchRows = `WITH search_contexts AS MATERIALIZED (
 SELECT c.context,c.day,c.visitor,s.site_id,${contextIdentity()} AS identity,${dimension('search')} AS search
 FROM vane_raw_contexts c JOIN vane_raw_sites s ON s.site=c.site
 WHERE s.site_id IN (SELECT value FROM json_each(?1)) AND c.day>=?2 AND c.day<?3
 AND c.kind='pageview' AND c.visitor IS NOT NULL AND ${dimension('search')} IS NOT NULL
), searches AS (
 SELECT c.*,e.raw_id,e.at_offset,e.token,f.visit,f.first_raw,f.last_raw
 FROM search_contexts c JOIN vane_raw_events e ON e.context=c.context JOIN vane_visit_facts f ON f.visit=e.visit_id
)`

// Membership narrows this lookup to the actual search's visit. Decode IDs for
// tied times so historical text IDs and canonical packed IDs retain exactly
// the logical ordering used by the original LAG over page loads.
const previousPath = `(SELECT ${dimension('path', 'pc')} FROM vane_raw_events p
 JOIN vane_raw_contexts pc ON pc.context=p.context JOIN vane_raw_sites ps ON ps.site=p.site
 WHERE p.visit_id=searches.visit AND pc.kind='pageview'
 AND (p.at_offset,${unpackedIdSql('p.token', 'ps.site_id')})
  < (searches.at_offset,${unpackedIdSql('searches.token', 'searches.site_id')})
 ORDER BY p.at_offset DESC,${unpackedIdSql('p.token', 'ps.site_id')} DESC LIMIT 1)`

// Filtered sequences still use search.ts's reconstruction over their actual
// admitted rows. Native whole-day facts already carry exact visit boundaries.
export async function readSearchMetrics(env: Env, scope: string, from: string, to: string) {
 await refreshVisitFacts(env, scope, from, to)
 const [totals, terms, starts] = await env.DB.batch<any>([
  env.DB.prepare(`${searchRows}
   SELECT COUNT(*) AS searches,COUNT(DISTINCT visit) AS visits,
   COUNT(DISTINCT CASE WHEN raw_id=last_raw THEN visit END) AS exits FROM searches`).bind(scope, from, to),
  env.DB.prepare(`${searchRows}, allowed AS (
   SELECT search FROM searches WHERE search<>'' GROUP BY search,day HAVING COUNT(DISTINCT visitor)>=2)
   SELECT search AS term,COUNT(*) AS searches,COUNT(DISTINCT identity) AS visitors FROM searches
   WHERE search IN (SELECT search FROM allowed) GROUP BY search ORDER BY searches DESC,term`).bind(scope, from, to),
  env.DB.prepare(`${searchRows}, starts AS (
   SELECT CASE WHEN raw_id=first_raw THEN '(entry)' ELSE ${previousPath} END AS path FROM searches)
   SELECT path,COUNT(*) AS searches FROM starts GROUP BY path ORDER BY searches DESC,path`).bind(scope, from, to),
 ])
 const total = totals.results[0], searches = Number(total.searches), visits = Number(total.visits), exits = Number(total.exits)
 return {
  searches, searchVisits: visits, searchesPerVisit: visits ? Math.round(searches / visits * 100) / 100 : null,
  exitAfterSearch: visits ? Math.round(exits / visits * 1000) / 10 : null,
  terms: terms.results.map(r => ({ term: r.term, searches: Number(r.searches), visitors: Number(r.visitors) })),
  startPages: starts.results.map(r => ({ path: r.path, searches: Number(r.searches) })),
 }
}

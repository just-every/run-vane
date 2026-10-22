import type { Env } from '../../core'
import { unpackedHashSql, unpackedIdSql } from '../../raw/schema'
import { refreshVisitFacts } from './maintenance'
import { dimension, reportFrom } from './sql'

// Contexts retain the exact consented site/digest/day membership, including
// untimed pages. Read their first physical time through the context/time index
// instead of expanding all page occurrences or reconstructing anonymous visits.
const contexts = `contexts AS MATERIALIZED (
 SELECT c.*,s.site_id,s.site_id||${unpackedHashSql('i.value')} AS identity
 FROM vane_raw_contexts c INDEXED BY vane_raw_context_consented
 JOIN vane_raw_sites s ON s.site=c.site JOIN vane_raw_identities i ON i.identity=c.consented_visitor
 WHERE c.consented_visitor IS NOT NULL AND c.kind='pageview'
 AND s.site_id IN (SELECT value FROM json_each(?1))
 AND EXISTS(SELECT 1 FROM vane_raw_groups g
  CROSS JOIN vane_raw_occurrences e ON e.group_id=g.group_id WHERE g.context=c.context)
)`
const inRange = 'c.day>=?2 AND c.day<?3'
const entryJoin = `CROSS JOIN vane_visit_facts f ON f.site=c.site AND f.day=c.day AND f.visitor=c.visitor
 CROSS JOIN vane_raw_occurrences e ON e.raw_id=f.first_raw
 CROSS JOIN vane_raw_groups g ON g.group_id=e.group_id AND g.context=c.context`

// Each context contributes at most one physical candidate. Select its timestamp
// through the context/time index, then order only that bucket's decoded logical
// IDs, preserving canonical UUID and historical text ordering across storage classes.
function touch(last: boolean) {
 const direction = last ? 'DESC' : 'ASC'
 return `(SELECT ${dimension('source', 'h')} FROM vane_raw_contexts h
 CROSS JOIN vane_raw_occurrences he ON he.raw_id=(
  SELECT candidate.raw_id FROM vane_raw_groups chosen
  CROSS JOIN vane_raw_occurrences candidate ON candidate.group_id=chosen.group_id
  WHERE chosen.context=h.context AND chosen.at_offset=(
   SELECT bucket.at_offset FROM vane_raw_groups bucket
   WHERE bucket.context=h.context AND bucket.at_offset<=c.at-COALESCE(unixepoch(h.day)*1000,0)
   AND EXISTS(SELECT 1 FROM vane_raw_occurrences live WHERE live.group_id=bucket.group_id)
   ORDER BY bucket.at_offset ${direction} LIMIT 1)
  ORDER BY ${unpackedIdSql('candidate.token', 'c.site_id')} ${direction} LIMIT 1
 ) CROSS JOIN vane_raw_groups hg ON hg.group_id=he.group_id
 WHERE h.site=c.site AND h.consented_visitor=c.consented_visitor AND h.kind='pageview'
 ${last ? `AND ${dimension('source', 'h')}<>'direct'` : ''}
 ORDER BY hg.at_offset+COALESCE(unixepoch(h.day)*1000,0) ${direction},${unpackedIdSql('he.token', 'c.site_id')} ${direction} LIMIT 1)`
}

// Only the unrestricted native whole-day source can use maintained visits.
// Filtered/partial event sets continue through consentedReport's raw sequence.
export async function readConsentedReport(env: Env, scope: string, from: string, to: string, goal: string | null) {
 await refreshVisitFacts(env, scope, from, to)
 return env.DB.batch<any>([
  env.DB.prepare(`WITH ${contexts}, firsts AS (
   SELECT site,consented_visitor,MIN(day) AS first_day,
   MIN((SELECT g.at_offset FROM vane_raw_groups g
    WHERE g.context=c.context AND g.at_offset IS NOT NULL
    AND EXISTS(SELECT 1 FROM vane_raw_occurrences e WHERE e.group_id=g.group_id)
    ORDER BY g.at_offset LIMIT 1)+COALESCE(unixepoch(c.day)*1000,0)) AS first_at
   FROM contexts c GROUP BY site,consented_visitor
  ), seen AS (
   SELECT DISTINCT c.identity,f.first_day FROM contexts c JOIN firsts f USING(site,consented_visitor) WHERE ${inRange}
  ), returners AS (
   SELECT DISTINCT c.identity FROM contexts c JOIN firsts acquisition USING(site,consented_visitor)
   ${entryJoin} WHERE ${inRange} AND f.started>acquisition.first_at
  ) SELECT
   (SELECT COALESCE(SUM(n),0) FROM vane_analytics_cells WHERE site_id IN (SELECT value FROM json_each(?1)) AND day>=?2 AND day<?3 AND kind='pageview') AS pageviews,
   (SELECT COALESCE(SUM(consented),0) FROM vane_analytics_cells WHERE site_id IN (SELECT value FROM json_each(?1)) AND day>=?2 AND day<?3 AND kind='pageview') AS consentedPageviews,
   (SELECT COUNT(DISTINCT identity) FROM seen) AS visitors,
   (SELECT COUNT(DISTINCT identity) FROM seen WHERE first_day>=?2) AS newVisitors,
   (SELECT COUNT(*) FROM returners) AS returningVisitors`).bind(scope, from, to),
  env.DB.prepare(`WITH ${contexts}, firsts AS (
   SELECT site,consented_visitor,MIN(day) AS first_day FROM contexts GROUP BY site,consented_visitor
  ), members AS (
   SELECT *,date(first_day,'weekday 0','-6 days') AS cohort FROM firsts f
   WHERE first_day>=?2 AND first_day<?3 AND EXISTS(
    SELECT 1 FROM contexts c WHERE c.site=f.site AND c.consented_visitor=f.consented_visitor AND ${inRange}
   )
  ), activity AS (
   SELECT DISTINCT site,consented_visitor,date(day,'weekday 0','-6 days') AS week FROM contexts c WHERE ${inRange}
  ) SELECT m.cohort,CAST((julianday(a.week)-julianday(m.cohort))/7 AS INTEGER) AS week,COUNT(*) AS visitors,
   (SELECT COUNT(*) FROM members n WHERE n.cohort=m.cohort) AS size
   FROM members m JOIN activity a USING(site,consented_visitor) GROUP BY m.cohort,a.week ORDER BY m.cohort,week`).bind(scope, from, to),
  env.DB.prepare(`${reportFrom()}, ${contexts}, conversions AS MATERIALIZED (
   SELECT v.site,v.site_id,v.started AS at,c.consented_visitor,c.identity
   FROM contexts c CROSS JOIN v ON v.site=c.site AND v.day=c.day AND v.visitor=c.visitor
   CROSS JOIN vane_raw_occurrences e ON e.raw_id=v.first_raw
   CROSS JOIN vane_raw_groups g ON g.group_id=e.group_id AND g.context=c.context
   WHERE ${inRange} AND v.visit_converted=1
  ), touches AS (
   SELECT c.*,${touch(false)} AS first_source,${touch(true)} AS last_source FROM conversions c
  ), models AS (
   SELECT 'First touch' AS model,first_source AS source,identity FROM touches
   UNION ALL SELECT 'Last non-direct touch',COALESCE(last_source,'direct'),identity FROM touches
  ) SELECT model,source,COUNT(*) AS conversions,COUNT(DISTINCT identity) AS visitors
   FROM models GROUP BY model,source ORDER BY model,conversions DESC,source`).bind(scope, from, to, goal),
 ])
}

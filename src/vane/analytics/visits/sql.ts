import { packedIdSql } from '../../raw/schema'
import { ANALYTIC_DIMENSIONS } from '../schema'

export const rangePredicate = 's.site_id IN (SELECT value FROM json_each(?1)) AND f.day>=?2 AND f.day<?3'
export const dimension = (name: typeof ANALYTIC_DIMENSIONS[number], alias = 'c') => `json_extract(${alias}.dimensions,'$[${ANALYTIC_DIMENSIONS.indexOf(name)}]')`
const hash = (value: string) => `CASE WHEN typeof(${value})='blob' THEN lower(hex(${value})) ELSE ${value} END`
export const contextIdentity = (context = 'c', site = 's') => `CASE WHEN ${context}.consented_visitor IS NOT NULL THEN ${site}.site_id||' c '||(SELECT ${hash('value')} FROM vane_raw_identities WHERE identity=${context}.consented_visitor) ELSE ${site}.site_id||' d '||${context}.day||' '||(SELECT ${hash('value')} FROM vane_raw_identities WHERE identity=${context}.visitor) END`

// Native whole-day visits only. A hostname restriction changes the sequence
// itself; callers must use timedFrom on their actual event set for that case.
// Goals and money are read at their real network-edge cardinality, so late
// custom/scroll goals and newly approved exchange rates are immediately exact.
export const reportFrom = (revenue = 'NULL') => `WITH goal_counts AS (
 SELECT p.visit_id AS visit,1 AS converted FROM vane_raw_contexts gc JOIN vane_raw_sites s ON s.site=gc.site
 JOIN vane_raw_events g ON g.context=gc.context
 JOIN vane_raw_events p ON p.site=g.site AND p.token=CASE WHEN typeof(g.token)='blob' THEN substr(g.token,1,16) ELSE substr(g.token,1,length(s.site_id)+37) END
 WHERE s.site_id IN (SELECT value FROM json_each(?1)) AND gc.day>=?2 AND gc.day<?3 AND gc.kind!='pageview'
 AND (?4 IS NULL OR gc.kind=?4) AND p.visit_id IS NOT NULL GROUP BY p.visit_id
), money AS (
 ${revenue === 'NULL' ? 'SELECT NULL AS visit,NULL AS revenue WHERE 0' : `SELECT rp.visit_id AS visit,SUM(${revenue}) AS revenue FROM vane_custom_events ce
 JOIN vane_raw_sites s ON s.site_id=ce.site_id JOIN vane_raw_events rp ON rp.site=s.site AND rp.token=${packedIdSql('ce.page_id', 'ce.site_id')}
 WHERE ce.site_id IN (SELECT value FROM json_each(?1)) AND ce.day>=?2 AND ce.day<?3 AND rp.visit_id IS NOT NULL GROUP BY rp.visit_id`}
), v AS (
 SELECT f.*,s.site_id,f.last_signal-f.started AS duration,(f.pages=1 AND f.engaged=0) AS bounce,
 COALESCE(g.converted,0) AS visit_converted,m.revenue AS visit_revenue
 FROM vane_visit_facts f JOIN vane_raw_sites s ON s.site=f.site LEFT JOIN goal_counts g ON g.visit=f.visit LEFT JOIN money m ON m.visit=f.visit
 WHERE ${rangePredicate}
), q AS (
 SELECT v.visit,v.day,v.identity AS visit_identity,v.bounce,v.duration,v.visit_converted,v.visit_revenue,
 c.context,c.dimensions,${contextIdentity()} AS identity,p.n,p.on_page,NULLIF(p.scroll,-1) AS scroll,
 ${ANALYTIC_DIMENSIONS.map(name => `${dimension(name)} AS ${name}`).join(',')}
 FROM vane_visit_page_frequencies p JOIN v ON v.visit=p.visit JOIN vane_raw_contexts c ON c.context=p.context JOIN vane_raw_sites s ON s.site=c.site
)`

// Weighted order statistics preserve every occurrence without expanding a
// frequency row into repeated page loads. The two middle ranks reproduce AVG
// of the ordinary (unweighted) median, including an even population.
export const weightedMedian = (value: string, cumulative: string, count: string, total: string) =>
 `SUM(${value}*((CASE WHEN (${total}+1)/2 BETWEEN ${cumulative}-${count}+1 AND ${cumulative} THEN 1 ELSE 0 END)+(CASE WHEN (${total}+2)/2 BETWEEN ${cumulative}-${count}+1 AND ${cumulative} THEN 1 ELSE 0 END)))/2.0`

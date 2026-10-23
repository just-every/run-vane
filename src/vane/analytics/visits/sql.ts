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
export const visitScope = (revenue = 'NULL') => `WITH goal_counts AS (
 SELECT pg.visit_id AS visit,1 AS converted FROM vane_raw_contexts gc JOIN vane_raw_sites s ON s.site=gc.site
 CROSS JOIN vane_raw_groups gg ON gg.context=gc.context
 CROSS JOIN vane_raw_occurrences go ON go.group_id=gg.group_id
 CROSS JOIN vane_raw_occurrences po ON po.site=go.site AND po.token=CASE WHEN typeof(go.token)='blob' THEN substr(go.token,1,16) ELSE substr(go.token,1,length(s.site_id)+37) END
 CROSS JOIN vane_raw_groups pg ON pg.group_id=po.group_id
 WHERE s.site_id IN (SELECT value FROM json_each(?1)) AND gc.day>=?2 AND gc.day<?3 AND gc.kind!='pageview'
 AND (?4 IS NULL OR gc.kind=?4) AND pg.visit_id IS NOT NULL GROUP BY pg.visit_id
), money AS (
 ${revenue === 'NULL' ? 'SELECT NULL AS visit,NULL AS revenue WHERE 0' : `SELECT pg.visit_id AS visit,SUM(${revenue}) AS revenue FROM vane_custom_events ce
 CROSS JOIN vane_raw_sites s ON s.site_id=ce.site_id
 CROSS JOIN vane_raw_occurrences po ON po.site=s.site AND po.token=${packedIdSql('ce.page_id', 'ce.site_id')}
 CROSS JOIN vane_raw_groups pg ON pg.group_id=po.group_id
 WHERE ce.site_id IN (SELECT value FROM json_each(?1)) AND ce.day>=?2 AND ce.day<?3 AND pg.visit_id IS NOT NULL GROUP BY pg.visit_id`}
), v AS (
 SELECT f.*,s.site_id,f.last_signal-f.started AS duration,(f.pages=1 AND f.engaged=0) AS bounce,
 COALESCE(g.converted,0) AS visit_converted,m.revenue AS visit_revenue
 FROM vane_visit_facts f JOIN vane_raw_sites s ON s.site=f.site LEFT JOIN goal_counts g ON g.visit=f.visit LEFT JOIN money m ON m.visit=f.visit
 WHERE ${rangePredicate}
)`
export const reportFrom = (revenue = 'NULL', columns: readonly typeof ANALYTIC_DIMENSIONS[number][] = ANALYTIC_DIMENSIONS) => `${visitScope(revenue)}, q AS (
 SELECT v.visit,v.day,v.identity AS visit_identity,v.bounce,v.duration,v.visit_converted,v.visit_revenue,
 c.context,c.dimensions,${contextIdentity()} AS identity,p.n,p.on_page,NULLIF(p.scroll,-1) AS scroll,
 ${columns.map(name => `${dimension(name)} AS ${name}`).join(',')}
 FROM vane_visit_page_frequencies p JOIN v ON v.visit=p.visit JOIN vane_raw_contexts c ON c.context=p.context JOIN vane_raw_sites s ON s.site=c.site
)`

// Weighted order statistics preserve every occurrence without expanding a
// frequency row into repeated page loads. The two middle ranks reproduce AVG
// of the ordinary (unweighted) median, including an even population.
export const weightedMedian = (value: string, cumulative: string, count: string, total: string) =>
 `SUM(${value}*((CASE WHEN (${total}+1)/2 BETWEEN ${cumulative}-${count}+1 AND ${cumulative} THEN 1 ELSE 0 END)+(CASE WHEN (${total}+2)/2 BETWEEN ${cumulative}-${count}+1 AND ${cumulative} THEN 1 ELSE 0 END)))/2.0`

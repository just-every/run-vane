// Public native admission inserts pageviews without raw detail rows. Group
// only its actual queued INSERTs, after dirty/legacy chains have been excluded.
// Context and exact time determine every field below except token endpoints
// and the actual occurrence count. Full tokens determine both endpoints.
export const newGroupSql = `INSERT INTO vane_visit_bulk_new_groups(
 group_id,site,context,day,visitor,at_offset,at,identity,pages,first_raw,last_raw)
 WITH counted AS (
  SELECT e.group_id,w.site,w.context,w.day,w.visitor,w.at_offset,w.at,w.identity,
   COUNT(*) AS pages,MIN(w.token) AS first_token,MAX(w.token) AS last_token
  FROM vane_visit_work w JOIN vane_visit_bulk_chains chain USING(site,day,visitor)
  JOIN vane_raw_occurrences e ON e.raw_id=w.raw_id
  WHERE w.action='bulk' AND w.at IS NOT NULL
  GROUP BY e.group_id
 ) SELECT g.group_id,g.site,g.context,g.day,g.visitor,g.at_offset,g.at,g.identity,g.pages,a.raw_id,z.raw_id
 FROM counted g JOIN vane_raw_occurrences a ON a.site=g.site AND a.token=g.first_token
 JOIN vane_raw_occurrences z ON z.site=g.site AND z.token=g.last_token`

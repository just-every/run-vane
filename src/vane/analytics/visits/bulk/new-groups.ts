// Public native admission inserts pageviews without raw detail rows. Group
// only its actual queued INSERTs, after dirty/legacy chains have been excluded.
// Context and exact time determine every field below except token endpoints
// and the actual occurrence count. Full tokens determine both endpoints.
export const newGroupSql = `INSERT INTO vane_visit_bulk_new_groups(
 group_id,site,context,day,visitor,at_offset,at,identity,pages,first_raw,last_raw)
 SELECT g.group_id,g.site,g.context,g.day,g.visitor,g.at_offset,g.at,g.identity,g.raw_count,a.raw_id,z.raw_id
 FROM vane_visit_bulk_queued_groups g JOIN vane_visit_bulk_chains chain USING(site,day,visitor)
 JOIN vane_raw_occurrences a ON a.site=g.site AND a.token=g.first_token
 JOIN vane_raw_occurrences z ON z.site=g.site AND z.token=g.last_token
 WHERE g.at IS NOT NULL`

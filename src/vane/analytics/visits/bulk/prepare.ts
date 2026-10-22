import { neighborhoodSql } from './neighbors'

// The occurrence aggregates consume the same queue before these statements.
// Legacy IDs and already-invalidated chains retain the ordinary rebuild path.
export const prepareBulkVisitSql = [
 `UPDATE vane_visit_work AS w SET
  (site,context,day,visitor,site_id,at,at_offset,token,identity,new_engaged,new_scroll)=
  (SELECT r.site,r.context,r.day,r.visitor,r.site_id,r.at,r.at_offset,r.token,r.identity,r.engaged_at,r.scroll
   FROM vane_visit_raw r WHERE r.raw_id=w.raw_id) WHERE action='bulk'`,
 `INSERT OR IGNORE INTO vane_visit_legacy(site,day,visitor)
  SELECT site,day,visitor FROM vane_visit_work WHERE action='bulk' AND at IS NOT NULL AND visitor IS NOT NULL AND typeof(token)!='blob'`,
 `INSERT OR IGNORE INTO vane_visit_dirty(site,day,visitor)
  SELECT w.site,w.day,w.visitor FROM vane_visit_work w JOIN vane_visit_legacy l USING(site,day,visitor)
  WHERE w.action='bulk' AND w.at IS NOT NULL`,
 `INSERT INTO vane_visit_bulk_chains(site,day,visitor,gap)
  SELECT site,day,visitor,COALESCE((SELECT json_extract(d.value,'$.minutes') FROM vane_sites s,json_each(s.config_json,'$.definitions') d
   WHERE s.id=w.site_id AND json_extract(d.value,'$.metric')='visit-timeout' AND json_extract(d.value,'$.from')<=w.day
   ORDER BY json_extract(d.value,'$.from') DESC,CAST(d.key AS INTEGER) DESC LIMIT 1),30)*60000
  FROM vane_visit_work w WHERE action='bulk' AND at IS NOT NULL AND visitor IS NOT NULL
   AND NOT EXISTS(SELECT 1 FROM vane_visit_dirty d WHERE d.site=w.site AND d.day=w.day AND d.visitor=w.visitor)
  GROUP BY site,day,visitor`,
 ...neighborhoodSql,
]

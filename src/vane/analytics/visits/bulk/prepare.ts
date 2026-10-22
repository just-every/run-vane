import { neighborhoodSql } from './neighbors'
import { newGroupSql } from './new-groups'

// Occurrence accounting materializes the actual queued groups before this.
// Legacy IDs and already-invalidated chains retain the ordinary rebuild path.
export const prepareBulkVisitSql = [
 `INSERT OR IGNORE INTO vane_visit_legacy(site,day,visitor)
  SELECT site,day,visitor FROM vane_visit_bulk_queued_groups WHERE at IS NOT NULL AND visitor IS NOT NULL AND legacy`,
 `INSERT OR IGNORE INTO vane_visit_dirty(site,day,visitor)
  SELECT w.site,w.day,w.visitor FROM vane_visit_bulk_queued_groups w JOIN vane_visit_legacy l USING(site,day,visitor)
  WHERE w.at IS NOT NULL`,
 `INSERT INTO vane_visit_bulk_chains(site,day,visitor,gap)
  SELECT site,day,visitor,COALESCE((SELECT json_extract(d.value,'$.minutes') FROM vane_sites s,json_each(s.config_json,'$.definitions') d
   WHERE s.id=w.site_id AND json_extract(d.value,'$.metric')='visit-timeout' AND json_extract(d.value,'$.from')<=w.day
   ORDER BY json_extract(d.value,'$.from') DESC,CAST(d.key AS INTEGER) DESC LIMIT 1),30)*60000
  FROM vane_visit_bulk_queued_groups w WHERE at IS NOT NULL AND visitor IS NOT NULL
   AND NOT EXISTS(SELECT 1 FROM vane_visit_dirty d WHERE d.site=w.site AND d.day=w.day AND d.visitor=w.visitor)
  GROUP BY site,day,visitor`,
 newGroupSql,
 ...neighborhoodSql,
]

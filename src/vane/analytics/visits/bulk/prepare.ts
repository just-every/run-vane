import { neighbor } from './neighbors'

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
 `UPDATE vane_visit_work AS w SET prev=${neighbor('w', 'before', true)}
  WHERE action='bulk' AND at IS NOT NULL AND EXISTS(SELECT 1 FROM vane_visit_bulk_chains c WHERE (c.site,c.day,c.visitor)=(w.site,w.day,w.visitor))`,
 `INSERT INTO vane_visit_bulk_pages(raw_id,site,day,visitor,context,at_offset,token,at,engaged,scroll,gap)
  SELECT w.raw_id,w.site,w.day,w.visitor,w.context,w.at_offset,w.token,w.at,w.new_engaged,COALESCE(w.new_scroll,-1),c.gap
  FROM vane_visit_work w JOIN vane_visit_bulk_chains c USING(site,day,visitor) WHERE w.action='bulk' AND w.at IS NOT NULL`,
 `INSERT OR IGNORE INTO vane_visit_bulk_pages(raw_id,site,day,visitor,context,at_offset,token,at,engaged,scroll,gap,old_visit)
  SELECT r.raw_id,r.site,r.day,r.visitor,r.context,r.at_offset,r.token,r.at,r.engaged_at,COALESCE(r.scroll,-1),c.gap,r.visit_id
  FROM (SELECT DISTINCT prev FROM vane_visit_work WHERE action='bulk' AND prev IS NOT NULL) p
  JOIN vane_visit_raw r ON r.raw_id=p.prev JOIN vane_visit_bulk_chains c USING(site,day,visitor)`,
 `UPDATE vane_visit_bulk_pages AS r SET next_id=${neighbor('r', 'after', true)} WHERE old_visit IS NOT NULL`,
 `UPDATE vane_visit_bulk_pages AS p SET old_on_page=CASE
  WHEN next_id IS NOT NULL AND (SELECT at_offset FROM vane_raw_events WHERE raw_id=p.next_id)-at_offset<=gap
  THEN (SELECT at_offset FROM vane_raw_events WHERE raw_id=p.next_id)-at_offset ELSE COALESCE(engaged-at,0) END
  WHERE old_visit IS NOT NULL`,
 `UPDATE vane_visit_bulk_pages AS r SET next_id=${neighbor('r', 'after')}`,
 `UPDATE vane_visit_bulk_pages AS p SET on_page=CASE
  WHEN next_id IS NOT NULL AND (SELECT at_offset FROM vane_raw_events WHERE raw_id=p.next_id)-at_offset<=gap
  THEN (SELECT at_offset FROM vane_raw_events WHERE raw_id=p.next_id)-at_offset ELSE COALESCE(engaged-at,0) END`,
]

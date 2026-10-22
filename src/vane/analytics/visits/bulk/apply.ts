// Remove exactly one previous contribution for each distinct predecessor;
// several new rows can have the same old predecessor. Then move merged visits'
// compressed frequencies and add the final contributions of all changed pages.
export const applyBulkVisitSql = [
 `UPDATE vane_visit_page_frequencies AS f SET n=n-(SELECT COUNT(*) FROM vane_visit_bulk_pages p
   WHERE p.old_visit=f.visit AND p.context=f.context AND p.old_on_page=f.on_page AND p.scroll=f.scroll)
  WHERE visit IN (SELECT old_visit FROM vane_visit_bulk_pages WHERE old_visit IS NOT NULL)`,
 `DELETE FROM vane_visit_page_frequencies WHERE visit IN (SELECT old_visit FROM vane_visit_bulk_pages WHERE old_visit IS NOT NULL) AND n=0`,
 `INSERT INTO vane_visit_facts(visit,site,day,visitor,first_raw,last_raw,started,last_at,last_signal,pages,engaged,identity,first_on_page)
  SELECT visit,site,day,visitor,first_raw,last_raw,started,last_at,last_signal,pages,engaged,identity,first_on_page FROM vane_visit_bulk_groups WHERE 1
  ON CONFLICT(visit) DO UPDATE SET first_raw=excluded.first_raw,last_raw=excluded.last_raw,started=excluded.started,last_at=excluded.last_at,
   last_signal=excluded.last_signal,pages=excluded.pages,engaged=excluded.engaged,identity=excluded.identity,first_on_page=excluded.first_on_page`,
 `INSERT INTO vane_visit_page_frequencies(visit,context,on_page,scroll,n)
  SELECT b.visit,f.context,f.on_page,f.scroll,SUM(f.n) FROM vane_visit_bulk_nodes b JOIN vane_visit_page_frequencies f ON f.visit=b.node_id
  WHERE b.kind=0 AND b.node_id!=b.visit GROUP BY b.visit,f.context,f.on_page,f.scroll
  ON CONFLICT(visit,context,on_page,scroll) DO UPDATE SET n=n+excluded.n`,
 `UPDATE vane_raw_events AS e SET visit_id=(SELECT b.visit FROM vane_visit_bulk_nodes b WHERE b.kind=0 AND b.node_id=e.visit_id)
  WHERE visit_id IN (SELECT node_id FROM vane_visit_bulk_nodes WHERE kind=0 AND node_id!=visit)`,
 `UPDATE vane_raw_events AS e SET visit_id=(SELECT b.visit FROM vane_visit_bulk_nodes b WHERE b.kind=1 AND b.node_id=e.raw_id)
  WHERE raw_id IN (SELECT node_id FROM vane_visit_bulk_nodes WHERE kind=1)`,
 `DELETE FROM vane_visit_facts WHERE visit IN (SELECT node_id FROM vane_visit_bulk_nodes WHERE kind=0 AND node_id!=visit)`,
 `INSERT INTO vane_visit_page_frequencies(visit,context,on_page,scroll,n)
  SELECT e.visit_id,p.context,p.on_page,p.scroll,COUNT(*) FROM vane_visit_bulk_pages p JOIN vane_raw_events e USING(raw_id)
  WHERE e.visit_id IS NOT NULL GROUP BY e.visit_id,p.context,p.on_page,p.scroll
  ON CONFLICT(visit,context,on_page,scroll) DO UPDATE SET n=n+excluded.n`,
]

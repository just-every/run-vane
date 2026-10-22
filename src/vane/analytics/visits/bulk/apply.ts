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
 // All occurrences at one context/time share a visit. UNION removes repeated
 // identical assignments; contradictory targets fail the scratch primary key.
 `INSERT INTO vane_visit_bulk_membership(group_id,visit)
  SELECT g.group_id,b.visit FROM vane_visit_bulk_nodes b JOIN vane_raw_groups g ON g.visit_id=b.node_id
  WHERE b.kind=0 AND b.node_id!=b.visit
  UNION
  SELECT b.node_id,b.visit FROM vane_visit_bulk_nodes b
  WHERE b.kind=1`,
 // Usually the group itself can acquire its final visit in one write. A unique
 // collision means the exact context/time/visit group already exists; only
 // those occurrences need their physical group pointers moved below.
 `UPDATE OR IGNORE vane_raw_groups AS g SET visit_id=(SELECT m.visit FROM vane_visit_bulk_membership m WHERE m.group_id=g.group_id)
  WHERE group_id IN (SELECT group_id FROM vane_visit_bulk_membership)
   AND visit_id IS NOT (SELECT m.visit FROM vane_visit_bulk_membership m WHERE m.group_id=g.group_id)`,
 `UPDATE vane_raw_occurrences AS e SET group_id=(
   SELECT target.group_id FROM vane_visit_bulk_membership m JOIN vane_raw_groups old ON old.group_id=m.group_id
   JOIN vane_raw_groups target ON target.context=old.context
    AND (target.at_offset IS NULL)=(old.at_offset IS NULL) AND coalesce(target.at_offset,0)=coalesce(old.at_offset,0)
    AND (target.visit_id IS NULL)=0 AND coalesce(target.visit_id,0)=m.visit
   WHERE m.group_id=e.group_id)
  WHERE group_id IN (SELECT g.group_id FROM vane_visit_bulk_membership m JOIN vane_raw_groups g USING(group_id)
   WHERE g.visit_id IS NOT m.visit)`,
 `DELETE FROM vane_visit_facts WHERE visit IN (SELECT node_id FROM vane_visit_bulk_nodes WHERE kind=0 AND node_id!=visit)`,
 `INSERT INTO vane_visit_page_frequencies(visit,context,on_page,scroll,n)
  SELECT e.visit_id,p.context,p.on_page,p.scroll,COUNT(*) FROM vane_visit_bulk_pages p JOIN vane_raw_events e USING(raw_id)
  WHERE e.visit_id IS NOT NULL GROUP BY e.visit_id,p.context,p.on_page,p.scroll
  ON CONFLICT(visit,context,on_page,scroll) DO UPDATE SET n=n+excluded.n`,
 // Endpoint rows above account for one or two actual pages per new group.
 // Every remaining queued page has a later token at that exact time, so its
 // on-page duration is zero; native insertion supplied no scroll detail.
 `INSERT INTO vane_visit_page_frequencies(visit,context,on_page,scroll,n)
  SELECT b.visit,g.context,0,-1,SUM(g.pages-CASE WHEN g.first_raw=g.last_raw THEN 1 ELSE 2 END)
  FROM vane_visit_bulk_new_groups g JOIN vane_visit_bulk_nodes b ON b.kind=1 AND b.node_id=g.group_id
  WHERE g.pages>CASE WHEN g.first_raw=g.last_raw THEN 1 ELSE 2 END
  GROUP BY b.visit,g.context
  ON CONFLICT(visit,context,on_page,scroll) DO UPDATE SET n=n+excluded.n`,
]

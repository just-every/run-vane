// Existing visits are closed intervals. Inserting points can join intervals,
// but cannot split one. A running maximum endpoint therefore identifies every
// resulting connected component, including a bridge across several old visits.
export const componentSql = [
 `INSERT INTO vane_visit_bulk_nodes(kind,node_id,site,day,visitor,started,last_at,last_signal,first_raw,last_raw,pages,engaged,identity,first_on_page,run)
  WITH points AS (
   SELECT DISTINCT 0 AS kind,f.visit AS node_id,f.site,f.day,f.visitor,f.started,f.last_at,f.last_signal,f.first_raw,f.last_raw,
    f.pages,f.engaged,f.identity,f.first_on_page,p.gap
   FROM vane_visit_bulk_pages p JOIN vane_visit_facts f ON f.site=p.site AND f.day=p.day AND f.visitor=p.visitor
    AND f.started<=p.at+p.gap AND f.last_at>=p.at-p.gap WHERE p.old_visit IS NULL
   UNION ALL
   SELECT 1,p.raw_id,p.site,p.day,p.visitor,p.at,p.at,MAX(p.at,COALESCE(p.engaged,p.at)),p.raw_id,p.raw_id,
    1,p.engaged IS NOT NULL,w.identity,p.on_page,p.gap
   FROM vane_visit_bulk_pages p JOIN vane_visit_work w USING(raw_id) WHERE p.old_visit IS NULL
  ), prior AS (
   SELECT *,MAX(last_at) OVER (PARTITION BY site,day,visitor ORDER BY started,kind,node_id
    ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING) AS prior_end FROM points
  ) SELECT kind,node_id,site,day,visitor,started,last_at,last_signal,first_raw,last_raw,pages,engaged,identity,first_on_page,
   SUM(CASE WHEN prior_end IS NULL OR started-prior_end>gap THEN 1 ELSE 0 END)
    OVER (PARTITION BY site,day,visitor ORDER BY started,kind,node_id ROWS UNBOUNDED PRECEDING) FROM prior`,
 `INSERT INTO vane_visit_bulk_groups(site,day,visitor,run,visit,first_raw,last_raw,started,last_at,last_signal,pages,engaged,identity,first_on_page)
  WITH ordered AS (
   SELECT n.*,ROW_NUMBER() OVER (PARTITION BY n.site,n.day,n.visitor,n.run ORDER BY n.started,a.token) AS first_rank,
    ROW_NUMBER() OVER (PARTITION BY n.site,n.day,n.visitor,n.run ORDER BY n.last_at DESC,z.token DESC) AS last_rank
   FROM vane_visit_bulk_nodes n JOIN vane_raw_events a ON a.raw_id=n.first_raw JOIN vane_raw_events z ON z.raw_id=n.last_raw
  ), grouped AS (
   SELECT site,day,visitor,run,MIN(CASE WHEN kind=0 THEN node_id END) AS old_visit,
    MAX(CASE WHEN first_rank=1 THEN first_raw END) AS first_raw,MAX(CASE WHEN last_rank=1 THEN last_raw END) AS last_raw,
    MIN(started) AS started,MAX(last_at) AS last_at,MAX(last_signal) AS last_signal,SUM(pages) AS pages,SUM(engaged) AS engaged,
    MAX(identity) AS identity,MAX(CASE WHEN first_rank=1 THEN first_on_page END) AS first_on_page
   FROM ordered GROUP BY site,day,visitor,run
  ) SELECT site,day,visitor,run,COALESCE(old_visit,
    MAX(COALESCE((SELECT seq FROM sqlite_sequence WHERE name='vane_visit_facts'),0),COALESCE((SELECT MAX(visit) FROM vane_visit_facts),0))
     +ROW_NUMBER() OVER (ORDER BY site,day,visitor,run)),
   first_raw,last_raw,started,last_at,last_signal,pages,engaged,identity,
   COALESCE((SELECT p.on_page FROM vane_visit_bulk_pages p WHERE p.raw_id=grouped.first_raw),first_on_page)
  FROM grouped`,
 `UPDATE vane_visit_bulk_nodes AS n SET visit=(SELECT g.visit FROM vane_visit_bulk_groups g
  WHERE (g.site,g.day,g.visitor,g.run)=(n.site,n.day,n.visitor,n.run))`,
]

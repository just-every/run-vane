// Select timestamp boundaries once per distinct new time and existing context.
// Clean canonical chains have visit IDs on every old timed page; newly queued
// pages have none. Filtering groups before expanding occurrences therefore
// avoids scanning or sorting a new tied-token bucket for each of its members.
export const neighborhoodSql = [
 `INSERT INTO vane_visit_bulk_buckets(context,at_offset)
  WITH points AS (
   SELECT DISTINCT w.site,w.day,w.visitor,w.at_offset FROM vane_visit_work w
   JOIN vane_visit_bulk_chains c USING(site,day,visitor) WHERE w.action='bulk' AND w.at IS NOT NULL
  ), contexts AS (
   SELECT DISTINCT cx.context,p.at_offset FROM points p JOIN vane_raw_contexts cx
    ON cx.site=p.site AND cx.day=p.day AND cx.visitor=p.visitor AND cx.kind='pageview'
  ), boundaries AS (
   SELECT context,at_offset FROM contexts
   UNION
   SELECT c.context,(SELECT g.at_offset FROM vane_raw_groups g
    WHERE g.context=c.context AND g.at_offset<c.at_offset AND g.visit_id IS NOT NULL
    ORDER BY g.at_offset DESC LIMIT 1) FROM contexts c
   UNION
   SELECT c.context,(SELECT g.at_offset FROM vane_raw_groups g
    WHERE g.context=c.context AND g.at_offset>c.at_offset AND g.visit_id IS NOT NULL
    ORDER BY g.at_offset ASC LIMIT 1) FROM contexts c
  ) SELECT context,at_offset FROM boundaries WHERE at_offset IS NOT NULL`,
 `INSERT INTO vane_visit_bulk_neighbors(rank,raw_id,site,day,visitor,context,at_offset,token,at,engaged,scroll,gap,old_visit,
   next_id,next_at_offset,old_prev_rank,old_next_rank)
  WITH source AS (
   SELECT w.raw_id,w.site,w.day,w.visitor,w.context,w.at_offset,w.token,w.at,
    w.new_engaged AS engaged,COALESCE(w.new_scroll,-1) AS scroll,c.gap,NULL AS old_visit
   FROM vane_visit_work w JOIN vane_visit_bulk_chains c USING(site,day,visitor)
   WHERE w.action='bulk' AND w.at IS NOT NULL
   UNION ALL
   SELECT e.raw_id,c.site,c.day,c.visitor,g.context,g.at_offset,e.token,g.at_offset+unixepoch(c.day)*1000,
    d.engaged_at,COALESCE(d.scroll,-1),chain.gap,g.visit_id
   FROM vane_visit_bulk_buckets b CROSS JOIN vane_raw_groups g ON g.context=b.context AND g.at_offset=b.at_offset
   CROSS JOIN vane_raw_occurrences e ON e.group_id=g.group_id JOIN vane_raw_contexts c ON c.context=g.context
   JOIN vane_visit_bulk_chains chain ON chain.site=c.site AND chain.day=c.day AND chain.visitor=c.visitor
   LEFT JOIN vane_raw_details d ON d.raw_id=e.raw_id WHERE g.visit_id IS NOT NULL
  ), ranked AS (
   SELECT *,ROW_NUMBER() OVER (ORDER BY site,day,visitor,at_offset,token) AS rank FROM source
  ) SELECT rank,raw_id,site,day,visitor,context,at_offset,token,at,engaged,scroll,gap,old_visit,
   LEAD(raw_id) OVER chain,LEAD(at_offset) OVER chain,
   MAX(CASE WHEN old_visit IS NOT NULL THEN rank END) OVER
    (PARTITION BY site,day,visitor ORDER BY rank ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING),
   MIN(CASE WHEN old_visit IS NOT NULL THEN rank END) OVER
    (PARTITION BY site,day,visitor ORDER BY rank ROWS BETWEEN 1 FOLLOWING AND UNBOUNDED FOLLOWING)
  FROM ranked WINDOW chain AS (PARTITION BY site,day,visitor ORDER BY rank)`,
 // Only a new page or its distinct previous old page can change a frequency.
 // Each such predecessor's old successor is present: it is either in the
 // new page's same-time bucket or the nearest later old bucket in a context.
 `INSERT INTO vane_visit_bulk_pages(raw_id,site,day,visitor,context,at_offset,token,at,engaged,scroll,gap,
   old_visit,next_id,old_on_page,on_page)
  SELECT n.raw_id,n.site,n.day,n.visitor,n.context,n.at_offset,n.token,n.at,n.engaged,n.scroll,n.gap,n.old_visit,n.next_id,
   CASE WHEN old_next.at_offset-n.at_offset<=n.gap THEN old_next.at_offset-n.at_offset ELSE COALESCE(n.engaged-n.at,0) END,
   CASE WHEN n.next_at_offset-n.at_offset<=n.gap THEN n.next_at_offset-n.at_offset ELSE COALESCE(n.engaged-n.at,0) END
  FROM vane_visit_bulk_neighbors n LEFT JOIN vane_visit_bulk_neighbors old_next ON old_next.rank=n.old_next_rank
  WHERE n.old_visit IS NULL OR n.rank IN (SELECT old_prev_rank FROM vane_visit_bulk_neighbors WHERE old_visit IS NULL)`,
]

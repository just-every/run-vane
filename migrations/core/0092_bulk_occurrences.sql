-- Native batch admission aggregates its actual inserted rows once, using the
-- transaction-local scope and raw-ID work queue introduced by 0091. All other
-- occurrence insertions retain the exact 0086 per-row maintenance body.
DROP TRIGGER vane_raw_analytics_insert;
CREATE TRIGGER vane_raw_analytics_insert AFTER INSERT ON vane_raw_events
WHEN NOT EXISTS(SELECT 1 FROM vane_visit_bulk_scope) BEGIN
 INSERT INTO vane_analytics_cells(site_id,day,kind,cell,n,timed,consented)
 SELECT site_id,day,kind,cell,1,timed,consented FROM (SELECT s.site_id,c.day,c.kind,json_remove(c.dimensions,'$[26]','$[25]') AS cell,
  CASE  WHEN c.consented_visitor IS NOT NULL THEN s.site_id||' c '|| CASE  WHEN typeof(ci.value)='blob' THEN lower(hex(ci.value)) ELSE ci.value  END  ELSE s.site_id||' d '||c.day||' '|| CASE  WHEN typeof(vi.value)='blob' THEN lower(hex(vi.value)) ELSE vi.value  END   END  AS identity,
 c.visitor,NEW.at_offset IS NOT NULL AS timed,c.consented_visitor IS NOT NULL AS consented
 FROM vane_raw_contexts c JOIN vane_raw_sites s ON s.site=c.site
 LEFT JOIN vane_raw_identities vi ON vi.identity=c.visitor LEFT JOIN vane_raw_identities ci ON ci.identity=c.consented_visitor
 WHERE c.context=NEW.context) WHERE 1
 ON CONFLICT(site_id,day,kind,cell) DO UPDATE SET n=n+1,timed=timed+excluded.timed,consented=consented+excluded.consented;
 INSERT INTO vane_analytics_identities(site_id,day,kind,cell,identity,n)
 SELECT site_id,day,kind,cell,identity,1 FROM (SELECT s.site_id,c.day,c.kind,json_remove(c.dimensions,'$[26]','$[25]') AS cell,
  CASE  WHEN c.consented_visitor IS NOT NULL THEN s.site_id||' c '|| CASE  WHEN typeof(ci.value)='blob' THEN lower(hex(ci.value)) ELSE ci.value  END  ELSE s.site_id||' d '||c.day||' '|| CASE  WHEN typeof(vi.value)='blob' THEN lower(hex(vi.value)) ELSE vi.value  END   END  AS identity,
 c.visitor,NEW.at_offset IS NOT NULL AS timed,c.consented_visitor IS NOT NULL AS consented
 FROM vane_raw_contexts c JOIN vane_raw_sites s ON s.site=c.site
 LEFT JOIN vane_raw_identities vi ON vi.identity=c.visitor LEFT JOIN vane_raw_identities ci ON ci.identity=c.consented_visitor
 WHERE c.context=NEW.context) WHERE visitor IS NOT NULL
 ON CONFLICT(site_id,day,kind,cell,identity) DO UPDATE SET n=n+1;
 END ;

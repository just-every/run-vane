import { unpackedHashSql } from '../../../raw/schema'

// Read each actual queued INSERT once, before any group memberships change.
// Full token extrema and legacy presence cover the complete queued population;
// metadata and identity expansion then run once per physical group. Neither
// replayed input nor old occurrences sharing a group contribute to this count.
export const queuedGroupSql = `INSERT INTO vane_visit_bulk_queued_groups(
 group_id,site,context,day,visitor,site_id,kind,at_offset,at,identity,cell,consented,
 raw_count,first_token,last_token,legacy)
 WITH admitted AS MATERIALIZED (
  SELECT e.group_id,COUNT(*) AS raw_count,MIN(e.token) AS first_token,MAX(e.token) AS last_token,
   MAX(typeof(e.token)!='blob') AS legacy
  FROM vane_visit_work w CROSS JOIN vane_raw_occurrences e ON e.raw_id=w.raw_id
  WHERE w.action='bulk' GROUP BY e.group_id
 ) SELECT g.group_id,c.site,c.context,c.day,c.visitor,s.site_id,c.kind,g.at_offset,
  g.at_offset+unixepoch(c.day)*1000,
  CASE WHEN c.consented_visitor IS NOT NULL THEN s.site_id||' c '||${unpackedHashSql('ci.value')}
   ELSE s.site_id||' d '||c.day||' '||${unpackedHashSql('vi.value')} END,
  json_remove(c.dimensions,'$[26]','$[25]'),c.consented_visitor IS NOT NULL,
  a.raw_count,a.first_token,a.last_token,a.legacy
 FROM admitted a JOIN vane_raw_groups g ON g.group_id=a.group_id
 JOIN vane_raw_contexts c ON c.context=g.context JOIN vane_raw_sites s ON s.site=c.site
 LEFT JOIN vane_raw_identities vi ON vi.identity=c.visitor
 LEFT JOIN vane_raw_identities ci ON ci.identity=c.consented_visitor`

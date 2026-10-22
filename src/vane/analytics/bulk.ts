import type { Env } from '../core'
import { unpackedHashSql } from '../raw/schema'

// Read only actual physical INSERTs queued by the native batch scope. Keep the
// cell and identity expressions identical to 0086's occurrence insert trigger,
// including its visitor requirement for consented identity references.
const source = `SELECT s.site_id,c.day,c.kind,json_remove(c.dimensions,'$[26]','$[25]') AS cell,
 CASE WHEN c.consented_visitor IS NOT NULL THEN s.site_id||' c '||${unpackedHashSql('ci.value')}
 ELSE s.site_id||' d '||c.day||' '||${unpackedHashSql('vi.value')} END AS identity,
 c.visitor,e.at_offset IS NOT NULL AS timed,c.consented_visitor IS NOT NULL AS consented
 FROM vane_visit_work w JOIN vane_raw_events e ON e.raw_id=w.raw_id
 JOIN vane_raw_contexts c ON c.context=e.context JOIN vane_raw_sites s ON s.site=c.site
 LEFT JOIN vane_raw_identities vi ON vi.identity=c.visitor
 LEFT JOIN vane_raw_identities ci ON ci.identity=c.consented_visitor
 WHERE w.action='bulk'`

// Place after the physical INSERT's immediate changes() guard and before
// finishBulkVisits consumes the queue. Both statements share that atomic batch.
export function bulkOccurrences(env: Env): D1PreparedStatement[] {
 return [
  `INSERT INTO vane_analytics_cells(site_id,day,kind,cell,n,timed,consented)
   SELECT site_id,day,kind,cell,COUNT(*),SUM(timed),SUM(consented)
   FROM (${source}) WHERE 1 GROUP BY site_id,day,kind,cell
   ON CONFLICT(site_id,day,kind,cell) DO UPDATE SET
   n=n+excluded.n,timed=timed+excluded.timed,consented=consented+excluded.consented`,
  `INSERT INTO vane_analytics_identities(site_id,day,kind,cell,identity,n)
   SELECT site_id,day,kind,cell,identity,COUNT(*)
   FROM (${source}) WHERE visitor IS NOT NULL GROUP BY site_id,day,kind,cell,identity
   ON CONFLICT(site_id,day,kind,cell,identity) DO UPDATE SET n=n+excluded.n`,
 ].map(sql => env.DB.prepare(sql))
}

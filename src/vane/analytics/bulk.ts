import type { Env } from '../core'
import { queuedGroupSql } from './visits/bulk/queued-groups'

// Place after the physical INSERT's immediate changes() guard and before
// finishBulkVisits consumes the queue. Both statements share that atomic batch.
export function bulkOccurrences(env: Env): D1PreparedStatement[] {
 return [
  queuedGroupSql,
  `INSERT INTO vane_analytics_cells(site_id,day,kind,cell,n,timed,consented)
   SELECT site_id,day,kind,cell,SUM(raw_count),SUM((at_offset IS NOT NULL)*raw_count),SUM(consented*raw_count)
   FROM vane_visit_bulk_queued_groups WHERE 1 GROUP BY site_id,day,kind,cell
   ON CONFLICT(site_id,day,kind,cell) DO UPDATE SET
   n=n+excluded.n,timed=timed+excluded.timed,consented=consented+excluded.consented`,
  `INSERT INTO vane_analytics_identities(site_id,day,kind,cell,identity,n)
   SELECT site_id,day,kind,cell,identity,SUM(raw_count)
   FROM vane_visit_bulk_queued_groups WHERE visitor IS NOT NULL GROUP BY site_id,day,kind,cell,identity
   ON CONFLICT(site_id,day,kind,cell,identity) DO UPDATE SET n=n+excluded.n`,
 ].map(sql => env.DB.prepare(sql))
}

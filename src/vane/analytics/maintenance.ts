import type { Env } from '../core'
import { cellSql, identitySql } from './schema'

// Include these statements inside restore's existing atomic batch AFTER raw
// rows are loaded. This also upgrades an archive that predates analytics tables.
// Maintenance triggers must be suppressed during restore, as archive.ts already
// does, otherwise restoring raw rows and their saved aggregates double counts.
export function rebuildAnalyticsStatements(env: Env): D1PreparedStatement[] {
 return [
  'DELETE FROM vane_analytics_identities',
  'DELETE FROM vane_analytics_cells',
  `INSERT INTO vane_analytics_cells(site_id,day,kind,cell,n,timed,consented)
   SELECT site_id,day,kind,${cellSql()},COUNT(*),SUM(at IS NOT NULL),SUM(consented_visitor IS NOT NULL)
   FROM vane_events GROUP BY site_id,day,kind,${cellSql()}`,
  `INSERT INTO vane_analytics_identities(site_id,day,kind,cell,identity,n)
   SELECT site_id,day,kind,${cellSql()},${identitySql()},COUNT(*)
   FROM vane_events WHERE visitor IS NOT NULL
   GROUP BY site_id,day,kind,${cellSql()},${identitySql()}`,
 ].map(sql => env.DB.prepare(sql))
}

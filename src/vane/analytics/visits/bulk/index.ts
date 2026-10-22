import type { Env } from '../../../core'
import { prepareBulkVisitSql } from './prepare'
import { componentSql } from './components'
import { applyBulkVisitSql } from './apply'

// These statements and the physical INSERT must share one DB.batch transaction.
// INSERT triggers queue only rows the database actually admitted. The immediate
// changes() admission guard and bulk occurrence accounting run before finish.
export function beginBulkVisits(env: Env): D1PreparedStatement[] {
 return [env.DB.prepare('INSERT INTO vane_visit_bulk_scope(singleton) VALUES(1)')]
}

export function finishBulkVisits(env: Env): D1PreparedStatement[] {
 return [
  ...prepareBulkVisitSql, ...componentSql, ...applyBulkVisitSql,
  'DELETE FROM vane_visit_bulk_membership',
  'DELETE FROM vane_visit_bulk_groups', 'DELETE FROM vane_visit_bulk_nodes',
  'DELETE FROM vane_visit_bulk_neighbors', 'DELETE FROM vane_visit_bulk_buckets',
  'DELETE FROM vane_visit_bulk_pages', 'DELETE FROM vane_visit_bulk_chains',
  "DELETE FROM vane_visit_work WHERE action='bulk'", 'DELETE FROM vane_visit_bulk_scope',
 ].map(sql => env.DB.prepare(sql))
}

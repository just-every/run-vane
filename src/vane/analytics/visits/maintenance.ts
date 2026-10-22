import type { Env } from '../../core'

// All invalidation and rebuild statements execute in one D1 transaction. Raw
// appends and same-visit late inserts are already maintained by SQL triggers.
// Only deletions, a genuine sequence rewrite, legacy noncanonical IDs and a
// dated timeout change reach this exceptional path. No stale facts are read.
export async function refreshVisitFacts(env: Env, scope: string, from: string, to: string) {
 const dirty = await env.DB.prepare(`SELECT 1 FROM vane_visit_dirty d JOIN vane_raw_sites s ON s.site=d.site
  WHERE s.site_id IN (SELECT value FROM json_each(?)) AND d.day>=? AND d.day<? LIMIT 1`).bind(scope, from, to).first()
 if (!dirty) return
 await env.DB.batch([
  env.DB.prepare(`INSERT INTO vane_visit_rebuild(site,day,visitor) SELECT d.site,d.day,d.visitor FROM vane_visit_dirty d JOIN vane_raw_sites s ON s.site=d.site
   WHERE s.site_id IN (SELECT value FROM json_each(?)) AND d.day>=? AND d.day<?`).bind(scope, from, to),
 ])
}

// Restore must omit all derived vane_visit_* tables, then queue the restored
// raw chains after the logical events have been inserted. Normal raw triggers
// can stay enabled; these rows force an exact rebuild of the restored history.
export function rebuildVisitFactsStatements(env: Env): D1PreparedStatement[] {
 return [
  'DELETE FROM vane_visit_work', 'DELETE FROM vane_visit_rebuild', 'DELETE FROM vane_visit_rebuild_pages',
  'DELETE FROM vane_visit_dirty', 'DELETE FROM vane_visit_page_frequencies', 'DELETE FROM vane_visit_duration_frequencies',
  'DELETE FROM vane_visit_days', 'DELETE FROM vane_visit_facts',
  `UPDATE vane_raw_events SET visit_id=NULL WHERE visit_id IS NOT NULL`,
  `INSERT OR IGNORE INTO vane_visit_dirty(site,day,visitor) SELECT site,day,visitor FROM vane_raw_contexts WHERE kind='pageview' AND visitor IS NOT NULL`,
 ].map(sql => env.DB.prepare(sql))
}

import type { Env } from '../../core'
import { bucketSql, localMidnight, type Interval } from '../../periods'
import { refreshVisitFacts } from './maintenance'

// Missing buckets are filled by the existing series assembler. These fields
// answer visits only; event/revenue bucket definitions stay with their owners.
export async function readVisitSeries(env: Env, scope: string, from: string, to: string, interval: Interval, timeZone: string) {
 await refreshVisitFacts(env, scope, from, to)
 const hourly = interval === 'hour'
 return (await env.DB.prepare(`SELECT ${bucketSql(interval, '?4', 'started')} AS k,COUNT(*) AS visits,SUM(pages=1 AND engaged=0) AS bounces,AVG(last_signal-started) AS duration
  FROM vane_visit_facts f JOIN vane_raw_sites s ON s.site=f.site
  WHERE s.site_id IN (SELECT value FROM json_each(?1)) AND day>=?2 AND day<?3 GROUP BY k`).bind(scope, from, to, ...(hourly ? [localMidnight(from, timeZone)] : [])).all<any>()).results
}

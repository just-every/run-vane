import { rows, type Env } from '../core'
import { visibleImports } from './cutover'

/** Label visible history using its provenance, never silently convert source measures. */
export async function importedRanges(env:Env,siteIds:string[],from:string,to:string) {
 return rows<{provider:string;from:string;to:string;kind:string}>(env,`SELECT provider,MIN(day) AS "from",MAX(day) AS "to",kind FROM (
 SELECT e.day,COALESCE(s.provider,'umami') AS provider,'events' AS kind FROM ${visibleImports('vane_import_events')} e LEFT JOIN vane_import_sources s ON s.site_id=e.site_id AND s.job_id=e.import_job WHERE e.site_id IN (SELECT value FROM json_each(?1)) AND e.day>=?2 AND e.day<?3
 UNION ALL SELECT day,provider,'source reports' AS kind FROM ${visibleImports('vane_import_reports')} WHERE site_id IN (SELECT value FROM json_each(?1)) AND day>=?2 AND day<?3
 ) GROUP BY provider,kind ORDER BY "from",provider`,JSON.stringify(siteIds),from,to)
}

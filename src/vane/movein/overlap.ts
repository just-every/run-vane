import type { MoveinEnvironment } from './types'
import { MoveinError } from './types'

export interface HeldDay { day:string; provider:string }
export const providers=['matomo','plausible','ga4','umami','simple','posthog']

/** Ask the small job/source index first. A whole export from the same provider
 * must not repeatedly scan millions of its own rows on every continuation. */
export async function heldByOthers(env:MoveinEnvironment,siteId:string,provider:string,days:string[]):Promise<HeldDay[]> {
 if(!days.length)return []
 const dates=JSON.stringify([...new Set(days)])
 const found=await env.DB.prepare(`SELECT DISTINCT day,provider FROM (
 SELECT day,provider FROM vane_import_reports WHERE site_id=?1 AND provider!=?2 AND day IN (SELECT value FROM json_each(?3))
 UNION ALL SELECT e.day,s.provider FROM vane_import_sources s CROSS JOIN vane_import_events e ON e.site_id=s.site_id AND e.import_job=s.job_id WHERE s.site_id=?1 AND s.provider!=?2 AND e.day IN (SELECT value FROM json_each(?3))
 UNION ALL SELECT e.day,'umami' AS provider FROM vane_import_events e WHERE ?2!='umami' AND e.site_id=?1 AND e.day IN (SELECT value FROM json_each(?3)) AND NOT EXISTS(SELECT 1 FROM vane_import_sources s WHERE s.site_id=e.site_id AND s.job_id=e.import_job)
 ) ORDER BY day,provider`).bind(siteId,provider,dates).all<HeldDay>()
 return found.results
}
export function carriedSkips(input:any):string[] {
 if(input?.skipped===undefined)return []
 if(!Array.isArray(input.skipped)||input.skipped.length>500)throw new MoveinError('INVALID_AGGREGATE')
 return input.skipped.map((s:any)=>{
  if(!s||typeof s.day!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(s.day)||!providers.includes(s.provider))throw new MoveinError('INVALID_AGGREGATE')
  return s.day
 })
}

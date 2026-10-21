import type { MoveinEnvironment } from './types'
import { MoveinError } from './types'

// IMPORT-007: two imports never double count. A day that another source's import already holds is skipped by a new
// source's import and listed in its preview and journal.
export interface HeldDay { day:string; provider:string }
export const providers=['matomo','plausible','ga4','umami','simple','posthog']

/** The days among `days` that an import by a source other than `provider` already holds on this site. */
export async function heldByOthers(env:MoveinEnvironment,siteId:string,provider:string,days:string[]):Promise<HeldDay[]> {
 if(!days.length)return []
 const found=await env.DB.prepare(`SELECT DISTINCT day,provider FROM (SELECT day,provider,site_id FROM vane_import_reports UNION ALL SELECT e.day,COALESCE(s.provider,'umami') AS provider,e.site_id FROM vane_import_events e LEFT JOIN vane_import_sources s ON s.site_id=e.site_id AND s.job_id=e.import_job) WHERE site_id=? AND provider!=? AND day IN (SELECT value FROM json_each(?)) ORDER BY day,provider`).bind(siteId,provider,JSON.stringify([...new Set(days)])).all<HeldDay>()
 return found.results
}
/** A reviewed carry may name days its preview skipped; each is listed only while another source still holds it. */
export function carriedSkips(input:any):string[] {
 if(input?.skipped===undefined)return []
 if(!Array.isArray(input.skipped)||input.skipped.length>500)throw new MoveinError('INVALID_AGGREGATE')
 return input.skipped.map((s:any)=>{
  if(!s||typeof s.day!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(s.day)||!providers.includes(s.provider))throw new MoveinError('INVALID_AGGREGATE')
  return s.day
 })
}

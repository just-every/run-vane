import { canonicalJson, sha256 } from '../../modules/import-kit/src/provenance/identity.ts'
import type { SourceBundle } from '../../modules/import-kit/src/types.ts'
import type { MoveinEnvironment } from './types'
import { MoveinError } from './types'

/** A carry holds sanitized data only. The date is reviewed again on every continuation. */
export function cutoverInput(document:unknown, date?:unknown) {
 let parsed:any=document
 if(typeof parsed==='string'){try{parsed=JSON.parse(parsed)}catch{/* CSV is handled by its source reader. */}}
 if(parsed?.format==='vane-cutover-preview/1'){
  if(Object.keys(parsed).sort().join(',')!=='cutover,document,format'||date!==undefined&&date!==''&&date!==parsed.cutover)throw new MoveinError('INVALID_CUTOVER_CARRY')
  date=parsed.cutover;document=parsed.document
 }
 if(date===undefined||date==='')return {document,cutover:null}
 if(typeof date!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(date)||!Number.isFinite(Date.parse(date))||new Date(date).toISOString().slice(0,10)!==date)throw new MoveinError('INVALID_CUTOVER_DAY')
 return {document,cutover:date}
}

/** Bind the policy to the source artifacts, so changing it invalidates the reviewed fingerprint. */
export function cutoverSource(source:SourceBundle,cutover:string|null):SourceBundle {
 if(!cutover)return source
 const content=canonicalJson({cutover,artifacts:source.artifacts}),hash=sha256(content),name='normalized-cutover.json'
 return {...source,artifacts:[{name,sha256:hash,size:new TextEncoder().encode(content).length}],records:source.records.map(r=>({...r,artifactHash:hash,location:{...r.location,artifact:name}}))}
}

/** Legacy imports keep their existing behavior until reimported with a declared cut-over.
 * A declared cut-over excludes that date and later; any earlier day with live data also uses live alone.
 * Match live days before report filters, so a filter cannot make old imported traffic reappear.
 */
export function visibleImports(table:'vane_import_events'|'vane_import_reports') {
 return `(SELECT i.* FROM ${table} i WHERE NOT EXISTS(SELECT 1 FROM vane_import_cutovers c WHERE c.site_id=i.site_id AND c.job_id=i.import_job AND (i.day>=c.day OR EXISTS(SELECT 1 FROM vane_events live WHERE live.site_id=i.site_id AND live.day=i.day))))`
}

export async function liveOverlap(env:MoveinEnvironment,siteId:string,days:string[]) {
 if(!days.length)return []
 return (await env.DB.prepare('SELECT DISTINCT day FROM vane_events WHERE site_id=? AND day IN (SELECT value FROM json_each(?)) ORDER BY day').bind(siteId,JSON.stringify([...new Set(days)])).all<{day:string}>()).results.map(r=>r.day)
}

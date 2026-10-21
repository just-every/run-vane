import { canonicalJson, sha256 } from '../../modules/import-kit/src/provenance/identity.ts'
import type { SourceBundle } from '../../modules/import-kit/src/types.ts'
import type { MoveinEnvironment } from './types'
import { MoveinError } from './types'

/** A carry holds sanitized data only. The date is reviewed again on every continuation. */
export function cutoverInput(document:unknown, date?:unknown, prefer?:unknown) {
 let parsed:any=document
 if(typeof parsed==='string'){try{parsed=JSON.parse(parsed)}catch{/* CSV is handled by its source reader. */}}
 if(parsed?.format==='vane-cutover-preview/1'){
  if(!['cutover,document,format','cutover,document,format,preferNew'].includes(Object.keys(parsed).sort().join(','))||date!==undefined&&date!==''&&date!==parsed.cutover)throw new MoveinError('INVALID_CUTOVER_CARRY')
  date=parsed.cutover;prefer=parsed.preferNew??false;document=parsed.document
 }
 if(prefer!==undefined&&![true,false,'on',''].includes(prefer as any))throw new MoveinError('INVALID_OVERLAP_CHOICE');
 const preferNew=prefer===true||prefer==='on';
 if(date===undefined||date==='')return {document,cutover:null,preferNew}
 if(typeof date!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(date)||!Number.isFinite(Date.parse(date))||new Date(date).toISOString().slice(0,10)!==date)throw new MoveinError('INVALID_CUTOVER_DAY')
 return {document,cutover:date,preferNew}
}

/** Bind the policy to the source artifacts, so changing it invalidates the reviewed fingerprint. */
export function cutoverSource(source:SourceBundle,cutover:string|null,preferNew=false):SourceBundle {
 if(!cutover&&!preferNew)return source
 const content=canonicalJson({cutover,preferNew,artifacts:source.artifacts}),hash=sha256(content),name='normalized-cutover.json'
 return {...source,artifacts:[{name,sha256:hash,size:new TextEncoder().encode(content).length}],records:source.records.map(r=>({...r,artifactHash:hash,location:{...r.location,artifact:name}}))}
}

/** Legacy imports keep their existing behavior until reimported with a declared cut-over.
 * A declared cut-over excludes that date and later; any earlier day with live data also uses live alone.
 * Match live days before report filters, so a filter cannot make old imported traffic reappear.
 */
export function visibleImports(table:'vane_import_events'|'vane_import_reports') {
 return `(SELECT i.* FROM ${table} i WHERE NOT EXISTS(SELECT 1 FROM vane_import_day_choices choice WHERE choice.site_id=i.site_id AND choice.day=i.day AND choice.job_id!=i.import_job AND EXISTS(SELECT 1 FROM (SELECT site_id,day,import_job FROM vane_import_events UNION ALL SELECT site_id,day,import_job FROM vane_import_reports) chosen WHERE chosen.site_id=choice.site_id AND chosen.day=choice.day AND chosen.import_job=choice.job_id)) AND NOT EXISTS(SELECT 1 FROM vane_import_cutovers c WHERE c.site_id=i.site_id AND c.job_id=i.import_job AND (i.day>=c.day OR EXISTS(SELECT 1 FROM vane_events live WHERE live.site_id=i.site_id AND live.day=i.day))))`
}

export async function liveOverlap(env:MoveinEnvironment,siteId:string,days:string[]) {
 if(!days.length)return []
 return (await env.DB.prepare('SELECT DISTINCT day FROM vane_events WHERE site_id=? AND day IN (SELECT value FROM json_each(?)) ORDER BY day').bind(siteId,JSON.stringify([...new Set(days)])).all<{day:string}>()).results.map(r=>r.day)
}

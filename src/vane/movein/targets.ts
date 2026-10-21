import type { D1TargetAdapter, D1Sql, D1Database } from '../../modules/import-kit/src/d1/types.ts'
import type { TargetRow, Json } from '../../modules/import-kit/src/types.ts'
import { MoveinError } from './types.ts'
import { aggregateFields } from './aggregate-types'
import { jsonChunks } from '../../modules/import-kit/src/d1/sets.ts'

const eventFields=['day','kind','path','source','campaign','consent','sample_rate'] as const
const kinds={
 'analytics-event':{table:'vane_import_events',fields:eventFields},
 'analytics-aggregate':{table:'vane_import_reports',fields:aggregateFields},
} as const
interface Stored { id:string; site_id:string; import_job:string; revision:string; [key:string]:any }
const sql=(sql:string,...params:unknown[]):D1Sql=>({sql,params})
const definition=(kind:string)=>{const found=kinds[kind as keyof typeof kinds];if(!found)throw new MoveinError('UNSUPPORTED_TARGET');return found}

export function targetAdapter(applyingJobId?:string):D1TargetAdapter {
 const revisionJobs=new Map<string,string>()
 function row(value:Stored,kind:string):TargetRow {
  if(!value.revision)throw new MoveinError('IMPORT_EVENT_REVISION_MISSING',409)
  revisionJobs.set(value.revision,value.import_job)
  return {destination:value.site_id,targetKind:kind,targetId:value.id,revision:value.revision,value:Object.fromEntries(definition(kind).fields.map(f=>[f,value[f]])) as Json}
 }
 const jobFor=(revision:string)=>{const job=revisionJobs.get(revision)??applyingJobId;if(!job)throw new MoveinError('IMPORT_EVENT_JOB_MISSING',409);return job}
 return {
  async read(db,destination,kind,id){
   const {table}=definition(kind),found=await db.prepare(`SELECT e.*,r.revision FROM ${table} e LEFT JOIN vane_import_revisions r ON r.event_id=e.id WHERE e.site_id=? AND e.id=?`).bind(destination,id).first<Stored>()
   return found?row(found,kind):undefined
  },
  async readMany(db,destination,requested){
   const groups=new Map<string,Set<string>>(),found=new Map<string,TargetRow>()
   for(const {kind,id} of requested){definition(kind);const ids=groups.get(kind)??new Set<string>();ids.add(id);groups.set(kind,ids)}
   for(const [kind,ids] of groups){
    const {table}=definition(kind)
    // The requested IDs drive primary-key probes; never scan the site's
    // complete native history as the import grows into millions of rows.
    // Anonymous event fields have fixed small bounds. Report JSON can be
    // much larger, so retain the scalar read's one-row response bound there.
    const values=[...ids],rowsPerRead=kind==='analytics-event'?1000:1
    for(let start=0;start<values.length;start+=rowsPerRead)for(const chunk of jsonChunks(values.slice(start,start+rowsPerRead))){
     const result=await db.prepare(`SELECT e.*,r.revision FROM json_each(?) wanted CROSS JOIN ${table} e ON e.id=wanted.value AND e.site_id=? LEFT JOIN vane_import_revisions r ON r.event_id=e.id`).bind(chunk,destination).all<Stored>()
     for(const value of result.results)found.set(JSON.stringify([kind,value.id]),row(value,kind))
    }
   }
   return requested.map(({kind,id})=>found.get(JSON.stringify([kind,id])))
  },
  matches(expected,destination,kind,id){
   const {table,fields}=definition(kind)
   if(!expected)return sql(`NOT EXISTS(SELECT 1 FROM ${table} WHERE id=?) AND NOT EXISTS(SELECT 1 FROM vane_import_revisions WHERE event_id=?)`,id,id)
   const value=expected.value as Record<string,Json>
   return sql(`EXISTS(SELECT 1 FROM ${table} e JOIN vane_import_revisions r ON r.event_id=e.id WHERE e.id=? AND e.site_id=? AND e.import_job=? AND r.revision=? AND ${fields.map(f=>`e.${f} IS ?`).join(' AND ')})`,id,destination,jobFor(expected.revision),expected.revision,...fields.map(f=>value[f]))
  },
  write(expected){
   const {table,fields}=definition(expected.targetKind),job=jobFor(expected.revision),value=expected.value as Record<string,Json>
   revisionJobs.set(expected.revision,job)
   return [sql(`INSERT INTO ${table}(id,site_id,import_job,${fields.join(',')}) VALUES(?,?,?,${fields.map(()=>'?').join(',')}) ON CONFLICT(id) DO UPDATE SET site_id=excluded.site_id,import_job=excluded.import_job,${fields.map(f=>`${f}=excluded.${f}`).join(',')}`,expected.targetId,expected.destination,job,...fields.map(f=>value[f])),sql('INSERT INTO vane_import_revisions(event_id,revision) VALUES(?,?) ON CONFLICT(event_id) DO UPDATE SET revision=excluded.revision',expected.targetId,expected.revision)]
  },
  remove(destination,kind,id){const {table}=definition(kind);return [sql(`DELETE FROM vane_import_revisions WHERE event_id IN (SELECT id FROM ${table} WHERE site_id=? AND id=?)`,destination,id),sql(`DELETE FROM ${table} WHERE site_id=? AND id=?`,destination,id)]},
  async list(db:D1Database,destination:string){const all:TargetRow[]=[];for(const [kind,{table}] of Object.entries(kinds)){const result=await db.prepare(`SELECT e.*,r.revision FROM ${table} e LEFT JOIN vane_import_revisions r ON r.event_id=e.id WHERE e.site_id=? ORDER BY e.id`).bind(destination).all<Stored>();all.push(...result.results.map(r=>row(r,kind)))}return all},
  matchesCount(count,destination){return sql('((SELECT COUNT(*) FROM vane_import_events WHERE site_id=?)+(SELECT COUNT(*) FROM vane_import_reports WHERE site_id=?))=?',destination,destination,count)},
 }
}

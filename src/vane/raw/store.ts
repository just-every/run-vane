import type { Env } from '../core'
import { encodeRawHash, encodeRawId, rawIdSite } from './codec'
import { RAW_DIMENSIONS, type RAW_COLUMNS, contextColumns } from './schema'
export type RawRecord = Partial<Record<typeof RAW_COLUMNS[number],string|number|null>> & {id:string;site_id:string;day:string;kind:string;path:string;source:string;campaign:string;consent:string}
export function rawEventPredicate(id:string,alias='',siteId=rawIdSite(id)) {
 const column=(alias?alias+'.':'')+'_raw_id'
 return {sql:`${column}=(SELECT raw_id FROM vane_raw_occurrences WHERE site=(SELECT site FROM vane_raw_sites WHERE site_id=?) AND token=?)`,values:[siteId,encodeRawId(siteId,id)] as [string,ArrayBuffer|string]}
}
export async function rawEvent<T=Record<string,any>>(env:Env,id:string,columns='*',siteId=rawIdSite(id)):Promise<T|null> {
 const predicate=rawEventPredicate(id,'',siteId)
 return env.DB.prepare(`SELECT ${columns} FROM vane_events WHERE ${predicate.sql}`).bind(...predicate.values).first<T>()
}
interface RawCondition {sql:string;values:unknown[]}
function rawContext(record:RawRecord) {
 const visitor=encodeRawHash(record.visitor as string|null),consented=encodeRawHash(record.consented_visitor as string|null)
 const dimensions=JSON.stringify(RAW_DIMENSIONS.map(name=>record[name]??null)),site=record.site_id
 const values=[site,record.day,record.kind,dimensions,visitor,consented,record.consented_created_at??null,record.consented_expires_at??null]
 const select=`(SELECT site FROM vane_raw_sites WHERE site_id=?),?,?,?,(SELECT identity FROM vane_raw_identities WHERE value=?),(SELECT identity FROM vane_raw_identities WHERE value=?),?,?`
 const match=contextColumns.split(',').map((name,i)=>`${name} IS ${i===0?'(SELECT site FROM vane_raw_sites WHERE site_id=?)':i===4||i===5?'(SELECT identity FROM vane_raw_identities WHERE value=?)':'?'}`).join(' AND ')
 return {visitor,consented,site,values,select,match}
}
// Batch callers may intern an exact shared context once. Their condition must
// mean at least one member needs admission; it must not depend on just the first
// member, which could have won a concurrent admission before this batch starts.
export function rawNormalizeStatements(env:Env,record:RawRecord,when:RawCondition={sql:'1',values:[]}):D1PreparedStatement[] {
 const c=rawContext(record)
 return [
  env.DB.prepare(`INSERT OR IGNORE INTO vane_raw_sites(site_id) SELECT ? WHERE ${when.sql}`).bind(c.site,...when.values),
  ...[c.visitor,c.consented].filter(value=>value!==null).map(value=>env.DB.prepare(`INSERT OR IGNORE INTO vane_raw_identities(value) SELECT ? WHERE ${when.sql}`).bind(value,...when.values)),
  env.DB.prepare(`INSERT OR IGNORE INTO vane_raw_contexts(${contextColumns}) SELECT ${c.select} WHERE ${when.sql}`).bind(...c.values,...when.values),
 ]
}
// Last is the real INSERT ... RETURNING raw_id; changes() immediately afterward
// describes its actual admission. No view changes() is used. normalize:false is
// valid only after the same transaction has interned this exact context above.
export function rawInsertStatements(env:Env,record:RawRecord,{ignore=false,when,normalize=true}:{ignore?:boolean;when?:RawCondition;normalize?:boolean}={}):D1PreparedStatement[] {
 const c=rawContext(record),token=encodeRawId(c.site,record.id)
 const absent='NOT EXISTS(SELECT 1 FROM vane_raw_occurrences WHERE site=(SELECT site FROM vane_raw_sites WHERE site_id=?) AND token=?)'
 const condition={sql:when?`(${when.sql}) AND ${ignore?absent:'1'}`:ignore?absent:'1',values:[...(when?.values??[]),...(ignore?[c.site,token]:[])]}
 return [
  ...(normalize?rawNormalizeStatements(env,record,condition):[]),
  env.DB.prepare(`INSERT OR IGNORE INTO vane_raw_groups(context,at_offset,visit_id)
   SELECT context,?-coalesce(unixepoch(day)*1000,0),NULL FROM vane_raw_contexts WHERE ${c.match} AND (${condition.sql})`).bind(record.at??null,...c.values,...condition.values),
  env.DB.prepare(`INSERT ${ignore?'OR IGNORE ':''}INTO vane_raw_occurrences(site,token,group_id)
   SELECT (SELECT site FROM vane_raw_sites WHERE site_id=?),?,
    (SELECT group_id FROM vane_raw_groups g WHERE ${groupMatchSql('c.context','?-coalesce(unixepoch(c.day)*1000,0)')})
   FROM vane_raw_contexts c WHERE ${c.match} AND (${condition.sql}) RETURNING raw_id`).bind(c.site,token,record.at??null,record.at??null,...c.values,...condition.values),
 ]
}

// Bound JSON retains SQLite's TEXT/BLOB distinction, including opaque IDs and
// noncanonical hashes. A typed pair avoids treating ordinary strings as hex.
function jsonValue(value:ArrayBuffer|string|null) {
 return value instanceof ArrayBuffer
  ? ['blob',Array.from(new Uint8Array(value),byte=>byte.toString(16).padStart(2,'0')).join('')]
  : ['text',value]
}
function decodedValue(path:string) {
 return `CASE WHEN json_extract(row.value,'${path}[0]')='blob' THEN unhex(json_extract(row.value,'${path}[1]')) ELSE json_extract(row.value,'${path}[1]') END`
}
// Match the same null-normalized expression index used by 0093. NULL and
// numeric zero are distinct values for both exact time and derived membership.
function groupMatchSql(context:string,at:string) {
 return `g.context=${context} AND (g.at_offset IS NULL)=(${at} IS NULL) AND coalesce(g.at_offset,0)=coalesce(${at},0) AND (g.visit_id IS NULL)=1 AND coalesce(g.visit_id,0)=0`
}
function rawBatch(records:RawRecord[]) {
 const contexts:unknown[][]=[],indices=new Map<string,number>()
 const rows=records.map(record=>{
  // The key contains every actual context value, never a digest or a selected
  // representative timestamp. Encode identity bytes only for new exact contexts.
  const key=JSON.stringify([record.site_id,record.day,record.kind,RAW_DIMENSIONS.map(name=>record[name]??null),
   record.visitor??null,record.consented_visitor??null,record.consented_created_at??null,record.consented_expires_at??null])
  let index=indices.get(key)
  if(index===undefined) {
   index=contexts.length
   indices.set(key,index)
   const c=rawContext(record)
   contexts.push([...c.values.slice(0,4),jsonValue(c.visitor),jsonValue(c.consented),...c.values.slice(6)])
  }
  return [index,jsonValue(encodeRawId(record.site_id,record.id)),record.at??null]
 })
 const site="(SELECT site FROM vane_raw_sites WHERE site_id=json_extract(row.value,'$[0]'))"
 const match=contextColumns.split(',').map((name,i)=>`c.${name} IS ${i===0?site:i===4||i===5
  ?`(SELECT identity FROM vane_raw_identities WHERE value=${decodedValue(`$[${i}]`)})`
  :`json_extract(row.value,'$[${i}]')`}`).join(' AND ')
 return {rows:JSON.stringify(rows),contexts:JSON.stringify(contexts),site,
  context:`(SELECT context FROM vane_raw_contexts c WHERE ${match})`}
}
// Resolve each distinct context once into transaction-local integer references.
// Each compact row retains its original index, typed full ID and exact timestamp.
// LEFT JOIN deliberately retains inputs with missing metadata: the physical
// integrity trigger must reject them rather than allowing a join to drop them.
// The caller clears vane_collection_batch_contexts AFTER its immediate changes()
// guard, inside this same transaction. The physical INSERT must remain last here.
export function rawInsertManyStatements(env:Env,records:RawRecord[],when:RawCondition={sql:'1',values:[]}):D1PreparedStatement[] {
 const b=rawBatch(records)
 const from=`FROM json_each(?) row
  LEFT JOIN vane_collection_batch_contexts b ON b.context_index=json_extract(row.value,'$[0]')
  LEFT JOIN vane_raw_contexts c ON c.context=b.context`
 const at="json_extract(row.value,'$[2]')-coalesce(unixepoch(c.day)*1000,0)"
 return [
  env.DB.prepare('DELETE FROM vane_collection_batch_contexts'),
  env.DB.prepare(`INSERT INTO vane_collection_batch_contexts(context_index,site,context)
   SELECT CAST(row.key AS INTEGER),${b.site},${b.context} FROM json_each(?) row`).bind(b.contexts),
  env.DB.prepare(`INSERT OR IGNORE INTO vane_raw_groups(context,at_offset,visit_id)
   SELECT DISTINCT b.context,${at},NULL ${from} WHERE ${when.sql}`).bind(b.rows,...when.values),
  env.DB.prepare(`INSERT INTO vane_raw_occurrences(site,token,group_id)
   SELECT b.site,${decodedValue('$[1]')},
    (SELECT group_id FROM vane_raw_groups g WHERE ${groupMatchSql('b.context',at)})
   ${from} WHERE ${when.sql}`).bind(b.rows,...when.values),
 ]
}

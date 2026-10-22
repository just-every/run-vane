import type { Env } from '../core'
import { encodeRawHash, encodeRawId, rawIdSite } from './codec'
import { RAW_DIMENSIONS, type RAW_COLUMNS, contextColumns } from './schema'
export type RawRecord = Partial<Record<typeof RAW_COLUMNS[number],string|number|null>> & {id:string;site_id:string;day:string;kind:string;path:string;source:string;campaign:string;consent:string}
export function rawEventPredicate(id:string,alias='',siteId=rawIdSite(id)) {
 const column=(alias?alias+'.':'')+'_raw_id'
 return {sql:`${column}=(SELECT raw_id FROM vane_raw_events WHERE site=(SELECT site FROM vane_raw_sites WHERE site_id=?) AND token=?)`,values:[siteId,encodeRawId(siteId,id)] as [string,ArrayBuffer|string]}
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
 const absent='NOT EXISTS(SELECT 1 FROM vane_raw_events WHERE site=(SELECT site FROM vane_raw_sites WHERE site_id=?) AND token=?)'
 const condition={sql:when?`(${when.sql}) AND ${ignore?absent:'1'}`:ignore?absent:'1',values:[...(when?.values??[]),...(ignore?[c.site,token]:[])]}
 return [
  ...(normalize?rawNormalizeStatements(env,record,condition):[]),
  env.DB.prepare(`INSERT ${ignore?'OR IGNORE ':''}INTO vane_raw_events(site,token,context,at_offset) SELECT (SELECT site FROM vane_raw_sites WHERE site_id=?),?,context,?-coalesce(unixepoch(day)*1000,0) FROM vane_raw_contexts WHERE ${c.match}${when?` AND (${when.sql})`:''} RETURNING raw_id`).bind(c.site,token,record.at??null,...c.values,...(when?.values??[])),
 ]
}

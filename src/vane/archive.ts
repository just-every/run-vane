import { atomic, digest, insist, role, rows, statement, uid, type Actor, type Env } from './core'
import { cleanSite } from './privacy'
interface Payload { format:'vane-history/1'; exportedAt:number; tables:Record<string,Record<string,any>[]> }
interface Archive { payload:Payload; sha256:string }
function encodeCell(value:any):any { if(value instanceof ArrayBuffer||ArrayBuffer.isView(value)) {const bytes=value instanceof ArrayBuffer?new Uint8Array(value):new Uint8Array(value.buffer,value.byteOffset,value.byteLength);let text='';for(const b of bytes)text+=String.fromCharCode(b);return {blob:btoa(text)}}return value }
function decodeCell(value:any):any { if(value===null||typeof value==='string'||typeof value==='number')return value;insist(value&&Object.keys(value).length===1&&typeof value.blob==='string'&&/^[A-Za-z0-9+/]*={0,2}$/.test(value.blob),'cell','Invalid archive cell.');return Uint8Array.from(atob(value.blob),c=>c.charCodeAt(0)).buffer }
async function tableNames(env:Env) { return (await rows(env,"SELECT name FROM sqlite_master WHERE type='table' AND (name LIKE 'vane_%' OR name LIKE 'ik_%') ORDER BY name")).map(r=>r.name as string).filter(n=>!['vane_proxy_connections','vane_chat_connections','vane_chat_states','vane_chat_schedules'].includes(n)&&n!=='vane_guard'&&n!=='vane_salts'&&n!=='vane_exports'&&n!=='vane_webhooks'&&n!=='vane_report_kept'&&n!=='vane_bing_connections'&&n!=='vane_search_connections'&&n!=='vane_search_oauth_states'&&n!=='vane_push_keys'&&n!=='vane_push_subscriptions') }
export async function exportHistory(env:Env,actor:Actor):Promise<Archive> {
 role(actor);
 const names=await tableNames(env);
 // D1 batch supplies a consistent snapshot across the event and custody tables.
 const result=await env.DB.batch<Record<string,any>>(names.map(n=>statement(env,`SELECT * FROM "${n}"`)));
 const payload:Payload={format:'vane-history/1',exportedAt:Date.now(),tables:Object.fromEntries(names.map((n,i)=>[n,result[i].results.map(row=>Object.fromEntries(Object.entries(row).map(([key,value])=>[key,encodeCell(value)])))]))};
 return {payload,sha256:await digest(JSON.stringify(payload))};
}
async function checked(value:any):Promise<Archive> {
 insist(value?.payload?.format==='vane-history/1'&&value.payload.tables&&typeof value.sha256==='string','archive','Select a Vane history archive.');
 insist(await digest(JSON.stringify(value.payload))===value.sha256,'integrity','Archive integrity check failed.');
 return value;
}
export async function restoreHistory(env:Env,actor:Actor,input:any,journal?:any) {
 role(actor);const archive=await checked(input),later=journal?await checked(journal):null,names=await tableNames(env);
 // An archive from an earlier release lacks tables added since (privacy-signal counts, audit); they restore empty.
 insist(Object.keys(archive.payload.tables).every(name=>names.includes(name))&&['vane_sites','vane_events','vane_deletions'].every(name=>Object.hasOwn(archive.payload.tables,name)),'schema','Archive schema does not match this Vane release.');
 const data:Record<string,Record<string,any>[]>=Object.fromEntries(names.map(name=>[name,archive.payload.tables[name]??[]]));
 const existing=(await rows(env,'SELECT COUNT(*) AS n FROM vane_sites'))[0];insist(Number(existing.n)===0,'not_empty','Restore into an empty analytics installation. Owner sign-in is preserved.',409);
 const fences=[...(later?.payload.tables.vane_deletions??[]),...await rows(env,'SELECT * FROM vane_deletions')];
 const contained=new Set((data.vane_deletions??[]).map(r=>r.id));
 insist(fences.every(f=>contained.has(f.id)),'erased_history','This archive predates a deletion in the later journal. Restore a newer export.',409);
 // Earlier releases named the code column metro and kept an always-empty per-event metro_name (DASH-005).
 for(const record of data.vane_events){if(Object.hasOwn(record,'metro')){record.metro_code=record.metro;delete record.metro;}delete record.metro_name}
 for(const value of data.vane_sites)cleanSite({...value,config:JSON.parse(value.config_json)});
 let count=0;
 for(const name of names) {
  insist(Array.isArray(data[name]),'archive','Invalid archive table.');
  const columns=(await rows(env,`PRAGMA table_info("${name}")`)).map(c=>c.name as string);
  for(const record of data[name]) {
   // Columns added since an earlier release (such as the visitor hash) restore empty.
   insist(record&&typeof record==='object'&&Object.keys(record).every(c=>columns.includes(c))&&['id','site_id'].filter(c=>columns.includes(c)).every(c=>Object.hasOwn(record,c)),'columns','Archive contains an invalid record.');
   insist(++count<=50000,'size','Use rer export/import for installations with more than 50,000 history and journal rows.',413);
  }
 }
 const ordered=names.includes('vane_sites')?['vane_sites',...names.filter(n=>n!=='vane_sites')]:names;
 // Like Base portability's atomic restore, suppress write-maintenance triggers
 // while loading their already-recorded custody state, then recreate them in
 // the same transaction. Otherwise a plan insert duplicates its saved snapshot.
 const triggers=(await rows(env,"SELECT name,tbl_name,sql FROM sqlite_master WHERE type='trigger'")).filter(t=>names.includes(t.tbl_name));
 const inserts:D1PreparedStatement[]=[statement(env,'INSERT INTO vane_guard(value) SELECT CASE WHEN (SELECT COUNT(*) FROM vane_sites)=0 THEN 1 ELSE 0 END')];
 // Recreate the bounded statements in dependency order. Import-kit schemas have
 // their own forward references; defer those checks until the atomic batch ends.
 inserts.push(statement(env,'PRAGMA defer_foreign_keys = ON'));
 inserts.push(...triggers.map(t=>statement(env,`DROP TRIGGER "${t.name}"`)));
 for(const name of ordered)for(const record of data[name]) { const columns=Object.keys(record); inserts.push(statement(env,`INSERT INTO "${name}" (${columns.map(c=>'"'+c+'"').join(',')}) VALUES(${columns.map(()=>'?').join(',')})`,...columns.map(c=>decodeCell(record[c])))); }
 inserts.push(statement(env,'INSERT INTO vane_restore(id,digest,restored_by,at) VALUES(?,?,?,?)',uid(),archive.sha256,actor.id,Date.now()));
 inserts.push(...triggers.map(t=>statement(env,t.sql)));
 await atomic(env,actor,inserts);
 return {restored:true,rows:count};
}

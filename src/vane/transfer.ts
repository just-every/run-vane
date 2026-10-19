import { atomic, digest, insist, role, rows, statement, type Actor, type Env } from './core'
import { cleanSite } from './privacy'
import { audit, auditStatement } from './audit'
// SITE-001: a site archive moves one site, its settings and its history to another installation.
// It carries the site's own events, privacy-signal counts, automatic events, deletion journal and
// imported rows. Daily salts never leave an installation, and an import's journal and undo stay
// with the source installation's whole archive (ARCHIVE-001), so imported rows arrive settled.
const TABLES=['vane_events','vane_signals','vane_auto_events','vane_deletions','vane_import_events'] as const
interface Payload { format:'vane-site/1'; exportedAt:number; site:Record<string,any>; tables:Record<string,Record<string,any>[]> }
interface SiteArchive { payload:Payload; sha256:string }

// Like every export (ACCESS-001), only the owner downloads a site archive or adds a site from one.
export async function exportSite(env:Env,actor:Actor,siteId:string):Promise<SiteArchive> {
 role(actor);
 const value=(await rows(env,'SELECT * FROM vane_sites WHERE id=?',siteId))[0];insist(value,'site_missing','Site not found.',404);
 // One batch gives a consistent snapshot of the site's rows.
 const result=await env.DB.batch<Record<string,any>>([...TABLES.map(name=>statement(env,`SELECT * FROM "${name}" WHERE site_id=?`,siteId)),statement(env,'SELECT r.* FROM vane_import_revisions r JOIN vane_import_events e ON e.id=r.event_id WHERE e.site_id=?',siteId)]);
 const payload:Payload={format:'vane-site/1',exportedAt:Date.now(),site:value,tables:{...Object.fromEntries(TABLES.map((name,i)=>[name,result[i].results])),vane_import_revisions:result[TABLES.length].results}};
 const archive={payload,sha256:await digest(JSON.stringify(payload))};
 await audit(env,actor.id,'site.export',siteId,`archive ${archive.sha256}`);
 return archive;
}

export async function importSite(env:Env,actor:Actor,input:any) {
 role(actor);
 insist(input?.payload?.format==='vane-site/1'&&input.payload.site&&input.payload.tables&&typeof input.sha256==='string','archive','Select a Vane site archive.');
 insist(await digest(JSON.stringify(input.payload))===input.sha256,'integrity','Archive integrity check failed.');
 const {site:value,tables,exportedAt}=input.payload as Payload,id=String(value.id);
 cleanSite({...value,config:JSON.parse(value.config_json)});
 insist((await rows(env,'SELECT 1 FROM vane_sites WHERE id=? OR origin=?',id,value.origin)).length===0,'site_exists','This installation already has this site or its origin. Delete it first to replace it.',409);
 // A site deleted or erased here after the archive was made never comes back from it.
 insist((await rows(env,'SELECT 1 FROM vane_deletions WHERE site_id=? AND at>=?',id,Number(exportedAt))).length===0,'erased_history','This archive predates a deletion of this site here. Transfer a newer archive.',409);
 const events=new Set((tables.vane_import_events??[]).map(row=>row.id)),inserts:D1PreparedStatement[]=[statement(env,'INSERT INTO vane_guard(value) SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM vane_sites WHERE id=? OR origin=?) THEN 1 ELSE 0 END',id,value.origin)];
 let count=0;
 for(const name of ['vane_sites',...TABLES,'vane_import_revisions']) {
  const records=name==='vane_sites'?[value]:tables[name]??[];insist(Array.isArray(records),'archive','Invalid archive table.');
  const columns=(await rows(env,`PRAGMA table_info("${name}")`)).map(c=>c.name as string);
  for(const record of records) {
   insist(record&&typeof record==='object'&&Object.keys(record).every(c=>columns.includes(c))&&Object.values(record).every(v=>v===null||['string','number'].includes(typeof v)),'columns','Archive contains an invalid record.');
   insist(name==='vane_sites'?true:name==='vane_import_revisions'?events.has(record.event_id):record.site_id===id,'columns','Archive rows must all belong to its site.');
   insist(++count<=50000,'size','Use rer export/import for sites with more than 50,000 history rows.',413);
   const keys=Object.keys(record);
   inserts.push(statement(env,`INSERT ${name==='vane_deletions'?'OR IGNORE ':''}INTO "${name}" (${keys.map(c=>'"'+c+'"').join(',')}) VALUES(${keys.map(()=>'?').join(',')})`,...keys.map(c=>record[c])));
  }
 }
 inserts.push(auditStatement(env,actor.id,'site.import',id,`archive ${input.sha256}, ${count} rows`));
 await atomic(env,actor,inserts);
 return {imported:true,siteId:id,rows:count};
}

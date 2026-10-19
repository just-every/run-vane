import { atomic, day, insist, role, rows, site, statement, uid, type Actor, type Env } from './core'
import { cleanSite } from './privacy'
import { eraseSite } from './movein/index'
import { deletionFence } from './deletion-fence'
import { auditSql, auditStatement } from './audit'
import { versioned } from './definitions'
import { localDay } from './visitors'
import { clock } from './clock'
// The command API is the agent door: proposals it prepares are audited as agent actions.
export async function prepare(env:Env,actor:Actor,command:string,input:any,channel:'app'|'command API') {
 role(actor,['owner','admin']);
 insist(['site.create','site.configure','history.erase','site.delete'].includes(command),'command','Unknown preparation command.');
 let payload:any;
 if(command==='site.create')payload={...cleanSite(input),siteId:uid()};
 else { const value=await site(env,String(input.siteId)); payload={siteId:value.id,version:value.version,...(command==='site.configure'?cleanSite(input):{})}; }
 const id=uid();
 await atomic(env,actor,[statement(env,"INSERT INTO vane_proposals(id,command,payload_json,state,prepared_by,created_at) VALUES(?,?,?,'pending',?,?)",id,command,JSON.stringify(payload),actor.id,Date.now()),auditStatement(env,actor.id,channel==='command API'?'agent.prepare':'proposal.prepare',id,`${command} for site ${payload.siteId} via ${channel}`)],['owner','admin']);
 return {id,command,payload,state:'pending'};
}
export async function decide(env:Env,actor:Actor,id:string,approve:boolean) {
 role(actor);
 const p=(await rows(env,'SELECT * FROM vane_proposals WHERE id=?',id))[0];
 insist(p&&p.state==='pending','proposal','This proposal is no longer awaiting approval.',409);
 const payload=JSON.parse(p.payload_json),at=Date.now();
 const guard=statement(env,"INSERT INTO vane_guard(value) SELECT CASE WHEN EXISTS(SELECT 1 FROM vane_proposals WHERE id=? AND state='pending') THEN 1 ELSE 0 END",id);
 const change=statement(env,"UPDATE vane_proposals SET state=?,approved_by=?,approved_at=? WHERE id=? AND state='pending'",approve?'approved':'rejected',actor.id,at,id);
 const operations=[guard];
 // METRIC-004: an approved visit-timeout change becomes a definition version dated the site's local day of approval.
 const dated=(before:any,next:any)=>versioned(before,next,localDay(clock(),next.timeZone??'UTC'),clock());
 if(approve&&p.command==='site.create') { operations.push(statement(env,'INSERT INTO vane_sites(id,name,origin,config_json,created_at) VALUES(?,?,?,?,?)',payload.siteId,payload.name,payload.origin,JSON.stringify(dated(null,payload.config)),at)); }
 if(approve&&p.command!=='site.create') {
  const current=await site(env,payload.siteId); insist(current.version===payload.version,'stale','Site settings changed; prepare a new proposal.',409);
  operations.push(statement(env,'INSERT INTO vane_guard(value) SELECT CASE WHEN EXISTS(SELECT 1 FROM vane_sites WHERE id=? AND version=?) THEN 1 ELSE 0 END',current.id,payload.version));
  if(p.command==='site.configure')operations.push(statement(env,'UPDATE vane_sites SET name=?,origin=?,config_json=?,version=version+1 WHERE id=?',payload.name,payload.origin,JSON.stringify(dated(current.config,payload.config)),current.id));
  // SITE-001: deleting a site first erases its history exactly as history.erase does, then removes the site with its
  // counters and salts. Import custody checks the site at the end of its erasure, so the site goes in a second batch;
  // until it commits the proposal stays pending and approving again finishes the deletion.
  if(p.command==='history.erase'||p.command==='site.delete') {
   const remove=p.command==='site.delete';
   await eraseSite(env,actor,current.id,[
    ...await deletionFence(env),
    {sql:"INSERT INTO vane_guard(value) SELECT CASE WHEN EXISTS(SELECT 1 FROM vane_proposals WHERE id=? AND state='pending') THEN 1 ELSE 0 END",params:[id]},
    {sql:'INSERT INTO vane_guard(value) SELECT CASE WHEN EXISTS(SELECT 1 FROM vane_sites WHERE id=? AND version=?) THEN 1 ELSE 0 END',params:[current.id,payload.version]},
    {sql:'DELETE FROM vane_events WHERE site_id=?',params:[current.id]},
    {sql:'DELETE FROM vane_signals WHERE site_id=?',params:[current.id]},
    {sql:'DELETE FROM vane_exclusions WHERE site_id=?',params:[current.id]},
    {sql:'DELETE FROM vane_auto_events WHERE site_id=?',params:[current.id]},
    ...(remove?[]:[auditSql(actor.id,'proposal.approve',id,`history.erase for site ${current.id}`),auditSql(actor.id,'history.erase',current.id,`version ${payload.version}`),{sql:"UPDATE vane_proposals SET state='approved',approved_by=?,approved_at=? WHERE id=? AND state='pending'",params:[actor.id,at,id]}]),
    {sql:'INSERT INTO vane_deletions(id,site_id,before_day,at,actor,reason) VALUES(?,?,?,?,?,?)',params:[uid(),current.id,day(at+86400000),at,actor.id,remove?'site-deletion':'owner-erasure']},
    {sql:'DELETE FROM vane_guard',params:[]},
   ]);
   if(!remove)return {id,state:'approved',siteId:current.id};
   await atomic(env,actor,[guard,operations[1]!,...['vane_events','vane_signals','vane_exclusions','vane_auto_events','vane_import_events','vane_admission','vane_salts','vane_annotations','vane_annotation_hooks','vane_github_keys','vane_segments'].map(table=>statement(env,`DELETE FROM ${table} WHERE site_id=?`,current.id)),statement(env,'DELETE FROM vane_sites WHERE id=?',current.id),change,auditStatement(env,actor.id,'proposal.approve',id,`site.delete for site ${current.id}`),auditStatement(env,actor.id,'site.delete',current.id,`version ${payload.version}`)]);
   return {id,state:'approved'};
  }
 }
 operations.push(change,auditStatement(env,actor.id,approve?'proposal.approve':'proposal.reject',id,`${p.command} for site ${payload.siteId}`));
 if(approve&&p.command==='site.create')operations.push(auditStatement(env,actor.id,'site.create',payload.siteId,payload.origin));
 if(approve&&p.command==='site.configure')operations.push(auditStatement(env,actor.id,'settings.change',payload.siteId,`version ${payload.version} to ${payload.version+1}`));
 await atomic(env,actor,operations);
 return {id,state:approve?'approved':'rejected',siteId:payload.siteId};
}

import { atomic, day, insist, role, rows, site, statement, uid, type Actor, type Env } from './core'
import { cleanSite } from './privacy'
import { eraseSite } from './movein/index'
import { deletionFence } from './deletion-fence'
export async function prepare(env:Env,actor:Actor,command:string,input:any) {
 role(actor,['owner','admin']);
 insist(['site.create','site.configure','history.erase'].includes(command),'command','Unknown preparation command.');
 let payload:any;
 if(command==='site.create')payload={...cleanSite(input),siteId:uid()};
 else { const value=await site(env,String(input.siteId)); payload={siteId:value.id,version:value.version,...(command==='site.configure'?cleanSite(input):{})}; }
 const id=uid();
 await atomic(env,actor,[statement(env,"INSERT INTO vane_proposals(id,command,payload_json,state,prepared_by,created_at) VALUES(?,?,?,'pending',?,?)",id,command,JSON.stringify(payload),actor.id,Date.now())],['owner','admin']);
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
 if(approve&&p.command==='site.create') { operations.push(statement(env,'INSERT INTO vane_sites(id,name,origin,config_json,created_at) VALUES(?,?,?,?,?)',payload.siteId,payload.name,payload.origin,JSON.stringify(payload.config),at)); }
 if(approve&&p.command!=='site.create') {
  const current=await site(env,payload.siteId); insist(current.version===payload.version,'stale','Site settings changed; prepare a new proposal.',409);
  operations.push(statement(env,'INSERT INTO vane_guard(value) SELECT CASE WHEN EXISTS(SELECT 1 FROM vane_sites WHERE id=? AND version=?) THEN 1 ELSE 0 END',current.id,payload.version));
  if(p.command==='site.configure')operations.push(statement(env,'UPDATE vane_sites SET name=?,origin=?,config_json=?,version=version+1 WHERE id=?',payload.name,payload.origin,JSON.stringify(payload.config),current.id));
  if(p.command==='history.erase') {
   await eraseSite(env,actor,current.id,[
    ...await deletionFence(env),
    {sql:"INSERT INTO vane_guard(value) SELECT CASE WHEN EXISTS(SELECT 1 FROM vane_proposals WHERE id=? AND state='pending') THEN 1 ELSE 0 END",params:[id]},
    {sql:'INSERT INTO vane_guard(value) SELECT CASE WHEN EXISTS(SELECT 1 FROM vane_sites WHERE id=? AND version=?) THEN 1 ELSE 0 END',params:[current.id,payload.version]},
    {sql:'DELETE FROM vane_events WHERE site_id=?',params:[current.id]},
    {sql:'INSERT INTO vane_deletions(id,site_id,before_day,at,actor,reason) VALUES(?,?,?,?,?,?)',params:[uid(),current.id,day(at+86400000),at,actor.id,'owner-erasure']},
    {sql:"UPDATE vane_proposals SET state='approved',approved_by=?,approved_at=? WHERE id=? AND state='pending'",params:[actor.id,at,id]},
    {sql:'DELETE FROM vane_guard',params:[]},
   ]);
   return {id,state:'approved',siteId:current.id};
  }
 }
 operations.push(change);await atomic(env,actor,operations);
 return {id,state:approve?'approved':'rejected',siteId:payload.siteId};
}

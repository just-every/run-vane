import { day, role, site, uid, type Actor, type Env } from './core'
import { prepare, decide } from './commands'
import { expireBefore } from './movein/index'
import { apply, auditSql, restoreHistory, undo } from './audit'
import { jsonValue } from './input'
import { deletionFence } from './deletion-fence'
import { verifyInstallation } from './install-check'
import { clock } from './clock'
import { importSite } from './transfer'
export async function action(env:Env,actor:Actor,p:any):Promise<{siteId?:string;notice:string;section?:string}> {
 let siteId=p.siteId;
 switch(p.operation) {
  case 'site.prepare': await prepare(env,actor,'site.create',p,'app');return {notice:'Site prepared. Review and approve its settings.',section:'approvals'};
  case 'config.prepare': await prepare(env,actor,'site.configure',p,'app');return {siteId,notice:'Settings prepared for approval.',section:'approvals'};
  case 'site.delete.prepare': await prepare(env,actor,'site.delete',p,'app');return {siteId,notice:'Site deletion prepared. Review the permanent deletion before approving.',section:'approvals'};
  case 'site.import': {const result=await importSite(env,actor,jsonValue(p.archive));return {siteId:result.siteId,notice:'Site transferred with its history.'};}
  case 'history.erase.prepare': await prepare(env,actor,'history.erase',p,'app');return {siteId,notice:'Erasure prepared. Review the permanent deletion before approving.',section:'approvals'};
  case 'proposal.approve': case 'proposal.reject': { const result=await decide(env,actor,p.id,p.operation==='proposal.approve');return {siteId:result.siteId,notice:result.state==='approved'?'Change approved and applied.':'Proposal rejected.',section:'approvals'}; }
  case 'history.restore':await restoreHistory(env,actor,jsonValue(p.archive),p.journal?jsonValue(p.journal):undefined);return {notice:'History restored. Your sign-in account is unchanged.'};
  case 'import.apply': {const result=await apply(env,actor,{siteId,document:jsonValue(p.document),fingerprint:p.fingerprint});return {siteId,notice:result.complete?'Import applied. Approval and journal recorded.':'Import saved. Apply the same reviewed document again to continue.',section:'history'};}
  case 'import.undo': {const result=await undo(env,actor,{siteId,jobId:p.jobId});return {siteId,notice:result.complete?'Import undone. The journal remains.':'Undo is in progress. Repeat to finish.',section:'history'};}
  case 'install.verify': {const result=await verifyInstallation(env,actor,siteId);return {siteId,notice:result.message,section:'settings'};}
  case 'history.retention': {
   role(actor);const value=await site(env,siteId),at=clock(),cutoff=day(at-value.config.retentionDays*86400000);
   const result=await expireBefore(env,actor,siteId,cutoff,[...await deletionFence(env),{sql:'DELETE FROM vane_events WHERE site_id=? AND day<?',params:[siteId,cutoff]},{sql:'DELETE FROM vane_signals WHERE site_id=? AND day<?',params:[siteId,cutoff]},{sql:'DELETE FROM vane_auto_events WHERE site_id=? AND day<?',params:[siteId,cutoff]},auditSql(actor.id,'history.retention',siteId,`before ${cutoff}`),{sql:'INSERT OR IGNORE INTO vane_deletions(id,site_id,before_day,at,actor,reason) VALUES(?,?,?,?,?,?)',params:['retention:'+siteId+':'+cutoff,siteId,cutoff,at,actor.id,'retention']}]);
   return {siteId,notice:result.complete?'Retention applied. Older events are erased and the deletion journal is recorded.':`${result.remaining} imported events remain to expire. Apply retention again to continue.`,section:'history'};
  }
  default:throw new Error('Unknown action.');
 }
}

import { applyD1ImportBatches } from '../../modules/import-kit/src/d1/apply';
import { requestContext, reserveReturn } from '../../modules/import-kit/src/d1/budget';
import { jobContext, loadSite } from './policy';
import { MoveinError, type MoveinActor, type MoveinEnvironment } from './types';

/** Resume immutable reviewed custody, without uploading and rebuilding its source page.
 * Approval binds the original owner and exact site policy; any policy change needs a new review. */
export async function resume(env: MoveinEnvironment, actor: MoveinActor, input: {siteId:string; jobId:string; fingerprint:string}) {
 const {site}=await loadSite(env,actor,input.siteId);
 const approval=await env.DB.prepare(`SELECT a.fingerprint,a.owner_id,a.policy_version,a.policy_json,j.fingerprint AS job_fingerprint
   FROM vane_import_approvals a JOIN ik_jobs j ON j.id=a.job_id AND j.destination=a.site_id WHERE a.job_id=? AND a.site_id=?`)
   .bind(input.jobId,site.id).first<{fingerprint:string;owner_id:string;policy_version:number|null;policy_json:string|null;job_fingerprint:string}>();
 if(!approval||approval.owner_id!==actor.id)throw new MoveinError('OWNER_APPROVAL_REQUIRED',403);
 if(typeof input.fingerprint!=='string'||input.fingerprint!==approval.fingerprint||input.fingerprint!==approval.job_fingerprint)throw new MoveinError('REVIEW_FINGERPRINT_MISMATCH',409);
 if(approval.policy_version!==site.version||approval.policy_json!==site.config_json)throw new MoveinError('IMPORT_POLICY_CHANGED_REVIEW_REQUIRED',409);
 const current=await jobContext(env,actor,site,input.jobId), predicate=current.authorization.predicate;
 const authorized={...current,authorization:{...current.authorization,predicate:(...args:Parameters<typeof predicate>)=>{
  const prior=predicate(...args);
  return {sql:`(${prior.sql}) AND EXISTS(SELECT 1 FROM vane_import_approvals WHERE job_id=? AND site_id=? AND owner_id=? AND fingerprint=? AND policy_version=? AND policy_json=?)`,
    params:[...prior.params??[],input.jobId,site.id,actor.id,input.fingerprint,site.version,site.config_json]};
 }}};
 const job=await applyD1ImportBatches(input.jobId,{...reserveReturn(requestContext(authorized),32),batchSize:100,reviewedFingerprint:input.fingerprint});
 return {job,complete:job.state==='completed',fingerprint:input.fingerprint};
}

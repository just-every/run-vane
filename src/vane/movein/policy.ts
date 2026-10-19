import type { D1ImportContext } from '../../modules/import-kit/src/d1/types.ts';
import type { MoveinActor, MoveinEnvironment, ImportSite, SitePolicy } from './types.ts';
import { MoveinError } from './types.ts';
import { targetAdapter } from './targets.ts';

export const mappingVersion = 'vane-umami-v2/1';
export const namespace = (siteId: string) => `vane-umami:${siteId}`;
export function requireOwner(actor: MoveinActor) {
  if (!actor || actor.role !== 'owner' || !actor.id) throw new MoveinError('OWNER_REQUIRED', 403);
}
export async function loadSite(env: MoveinEnvironment, actor: MoveinActor, siteId: string) {
  requireOwner(actor);
  const owner = await env.DB.prepare("SELECT id FROM oa_operators WHERE id=? AND role='owner' AND status='active'").bind(actor.id).first();
  if (!owner) throw new MoveinError('OWNER_REQUIRED', 403);
  const site = await env.DB.prepare('SELECT id,origin,config_json,version FROM vane_sites WHERE id=?').bind(siteId).first<ImportSite>();
  if (!site) throw new MoveinError('SITE_NOT_FOUND', 404);
  let policy: SitePolicy;
  try { policy = JSON.parse(site.config_json); } catch { throw new MoveinError('SITE_POLICY_INVALID'); }
  if (!policy || !Array.isArray(policy.paths) || !policy.goals || Array.isArray(policy.goals) || typeof policy.goals !== 'object') throw new MoveinError('SITE_POLICY_INVALID');
  for (const path of [...policy.paths, ...Object.values(policy.goals)]) if (typeof path !== 'string' || !/^\/(?!\/)[^?#\s]*$/.test(path)) throw new MoveinError('SITE_POLICY_INVALID');
  if (Object.keys(policy.goals).some(value => typeof value !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,79}$/.test(value))) throw new MoveinError('SITE_POLICY_INVALID');
  return { site, policy };
}
export function context(env: MoveinEnvironment, actor: MoveinActor, site: ImportSite, jobId?: string): D1ImportContext {
  requireOwner(actor);
  return {
    destination: site.id, namespace: namespace(site.id), mappingVersion,
    storage: { database: env.DB, targets: targetAdapter(jobId) }, batchSize: 20, maxBatches: 1,
    authorization: { principalId: actor.id, predicate: () => ({
      sql: "EXISTS(SELECT 1 FROM oa_operators WHERE id=? AND role='owner' AND status='active') AND EXISTS(SELECT 1 FROM vane_sites WHERE id=? AND version=? AND config_json=?)",
      params: [actor.id, site.id, site.version, site.config_json],
    }) },
  };
}

/** The current owner controls restored custody; the job keeps its original
 * principal for integrity/attribution. The SQL authority remains today's owner. */
export async function jobContext(env:MoveinEnvironment,actor:MoveinActor,site:ImportSite,jobId:string):Promise<D1ImportContext> {
  requireOwner(actor);
  const job=await env.DB.prepare('SELECT principal_id FROM ik_jobs WHERE id=? AND destination=?').bind(jobId,site.id).first<{principal_id:string}>();
  if(!job)throw new MoveinError('IMPORT_JOB_NOT_FOUND',404);
  const current=context(env,actor,site,jobId);
  return {...current,authorization:{...current.authorization,principalId:job.principal_id}};
}

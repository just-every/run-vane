import { planD1Import, createD1ImportJob, readD1ImportJob } from '../../modules/import-kit/src/d1/jobs.ts';
import { applyD1ImportBatches } from '../../modules/import-kit/src/d1/apply.ts';
import { undoD1Import } from '../../modules/import-kit/src/d1/reverse.ts';
import { atomic } from '../../modules/import-kit/src/d1/database.ts';
import { retireD1ImportCustody } from '../../modules/import-kit/src/d1/retirement.ts';
import type { D1Sql } from '../../modules/import-kit/src/d1/types.ts';
import type { MoveinEnvironment, MoveinActor } from './types.ts';
import { MoveinError } from './types.ts';
import { context, jobContext, loadSite, namespace, requireOwner } from './policy.ts';
import { mapping, normalize } from './normalize.ts';
export type { MoveinActor, MoveinEnvironment } from './types.ts';
export { MoveinError } from './types.ts';
export { importTables as archiveTables } from './tables.ts';

interface DocumentInput { siteId: string; document: unknown }
interface JobInput { siteId: string; jobId: string }

async function planned(env: MoveinEnvironment, actor: MoveinActor, input: DocumentInput) {
  const { site, policy } = await loadSite(env, actor, input.siteId);
  const normalized = normalize(input.document, site, policy);
  const plan = await planD1Import(normalized.source,mapping,context(env,actor,site));
  if (plan.counts.rejected || plan.counts.unmapped) throw new MoveinError('UNMAPPED_EVENTS');
  return { site, normalized, plan };
}

/** Private owner operation. HTTP integration must also enforce native session + CSRF. */
export async function preview(env: MoveinEnvironment, actor: MoveinActor, input: DocumentInput) {
  requireOwner(actor);
  const { normalized, plan } = await planned(env,actor,input);
  return { fingerprint: plan.fingerprint, normalized: normalized.events, discarded: normalized.discarded,
    carry: { format:'vane-umami-preview/1' as const,events:normalized.events,discarded:normalized.discarded },
    counts: plan.counts, consent: null, sampleRate: null,
    originalRetention: 'discarded-before-custody' as const };
}

/** Repeating the same reviewed page resumes its existing job without double counting. */
export async function apply(env: MoveinEnvironment, actor: MoveinActor, input: DocumentInput & { fingerprint: string }) {
  requireOwner(actor);
  const { site, normalized, plan } = await planned(env,actor,input);
  if (typeof input.fingerprint !== 'string' || input.fingerprint !== plan.fingerprint) throw new MoveinError('REVIEW_FINGERPRINT_MISMATCH',409);
  const base = context(env,actor,site);
  const created = await createD1ImportJob(plan,{ ...base,reviewedFingerprint: input.fingerprint });
  // Approval must exist before native publication. The first owner's decision is immutable.
  await env.DB.prepare(`INSERT INTO vane_import_approvals(job_id,site_id,owner_id,approved_at,fingerprint,discarded_json)
    SELECT ?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM oa_operators WHERE id=? AND role='owner' AND status='active')
    AND EXISTS(SELECT 1 FROM vane_sites WHERE id=? AND version=? AND config_json=?)
    ON CONFLICT(job_id) DO NOTHING`).bind(created.id,site.id,actor.id,new Date().toISOString(),plan.fingerprint,JSON.stringify(normalized.discarded),actor.id,site.id,site.version,site.config_json).run();
  const approval = await env.DB.prepare('SELECT fingerprint,owner_id FROM vane_import_approvals WHERE job_id=? AND site_id=?').bind(created.id,site.id).first<{ fingerprint: string; owner_id: string }>();
  if (approval?.fingerprint !== input.fingerprint || approval.owner_id !== actor.id) throw new MoveinError('OWNER_APPROVAL_REQUIRED',403);
  const current = await applyD1ImportBatches(created.id,{ ...context(env,actor,site,created.id),reviewedFingerprint: input.fingerprint });
  return { job: current, complete: current.state === 'completed', fingerprint: plan.fingerprint };
}

export async function journal(env: MoveinEnvironment, actor: MoveinActor, input: JobInput) {
  requireOwner(actor);
  const { site } = await loadSite(env,actor,input.siteId);
  const job = await readD1ImportJob(input.jobId,await jobContext(env,actor,site,input.jobId));
  const approval = await env.DB.prepare('SELECT owner_id AS ownerId,approved_at AS approvedAt,fingerprint,discarded_json FROM vane_import_approvals WHERE site_id=? AND job_id=?').bind(site.id,job.id).first<{ ownerId: string; approvedAt: string; fingerprint: string; discarded_json: string }>();
  const batches = await env.DB.prepare('SELECT action,position,end_position AS endPosition,fence FROM ik_batches WHERE job_id=? ORDER BY fence').bind(job.id).all();
  const provenance = await env.DB.prepare('SELECT target_id AS eventId,reversed FROM ik_provenance WHERE job_id=? ORDER BY ordinal,effect_ordinal').bind(job.id).all();
  return { job, approval: approval ? { ownerId:approval.ownerId,approvedAt:approval.approvedAt,fingerprint:approval.fingerprint } : null,
    discarded: approval ? JSON.parse(approval.discarded_json) : null, batches:batches.results, provenance:provenance.results };
}

export async function undo(env: MoveinEnvironment, actor: MoveinActor, input: JobInput) {
  requireOwner(actor);
  const { site } = await loadSite(env,actor,input.siteId);
  const job = await undoD1Import(input.jobId,await jobContext(env,actor,site,input.jobId));
  return { job, complete:job.state === 'undone' };
}

/** Call before deleting the site: retires all custody, deletes imported rows atomically. */
export async function eraseSite(env: MoveinEnvironment, actor: MoveinActor, siteId: string, nativeStatements: D1Sql[] = []) {
  requireOwner(actor);
  const { site } = await loadSite(env,actor,siteId);
  return retireD1ImportCustody({ values:[namespace(siteId)] },[
    { sql:'DELETE FROM vane_import_revisions WHERE event_id IN (SELECT id FROM vane_import_events WHERE site_id=?)',params:[siteId] },
    { sql:'DELETE FROM vane_import_events WHERE site_id=?',params:[siteId] },
    { sql:'DELETE FROM vane_import_approvals WHERE site_id=?',params:[siteId] },
    ...nativeStatements,
  ],context(env,actor,site),[
    { sql:`INSERT INTO vane_import_erasure_fences(site_id,generation,erased_at) VALUES(?,1,?)
      ON CONFLICT(site_id) DO UPDATE SET generation=generation+1,erased_at=excluded.erased_at`,params:[siteId,new Date().toISOString()] },
  ]);
}

/** One expired target per call keeps each Worker request inside D1's query budget. */
export async function expireBefore(env: MoveinEnvironment, actor: MoveinActor, siteId: string, beforeDay: string, nativeStatements: D1Sql[] = []) {
  requireOwner(actor);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(beforeDay) || !Number.isFinite(Date.parse(beforeDay)) || new Date(beforeDay).toISOString().slice(0,10) !== beforeDay) throw new MoveinError('INVALID_RETENTION_DAY');
  const { site } = await loadSite(env,actor,siteId);
  const expired = await env.DB.prepare('SELECT id FROM vane_import_events WHERE site_id=? AND day<? ORDER BY day,id LIMIT 1').bind(siteId,beforeDay).first<{ id: string }>();
  const fence: D1Sql[] = [{ sql:`INSERT INTO vane_import_erasure_fences(site_id,generation,erased_at) VALUES(?,1,?)
    ON CONFLICT(site_id) DO UPDATE SET generation=generation+1,erased_at=excluded.erased_at`,params:[siteId,new Date().toISOString()] }];
  let receiptId: string | null = null;
  if (expired) {
    const receipt = await retireD1ImportCustody({ target:{kind:'analytics-event',id:expired.id} },[
      { sql:'DELETE FROM vane_import_revisions WHERE event_id=? AND EXISTS(SELECT 1 FROM vane_import_events WHERE id=? AND site_id=? AND day<?)',params:[expired.id,expired.id,siteId,beforeDay] },
      { sql:'DELETE FROM vane_import_events WHERE id=? AND site_id=? AND day<?',params:[expired.id,siteId,beforeDay] },
      ...nativeStatements,
    ],context(env,actor,site),fence);
    receiptId = receipt.receiptId;
  } else {
    await atomic(context(env,actor,site),'erase',[...nativeStatements,...fence]);
  }
  const pending = await env.DB.prepare('SELECT COUNT(*) AS count FROM vane_import_events WHERE site_id=? AND day<?').bind(siteId,beforeDay).first<{ count: number }>();
  return { complete:pending?.count === 0, erased:Number(Boolean(expired)), remaining:pending?.count ?? 0, receiptId };
}

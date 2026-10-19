import { role, rows, uid, type Actor, type Env } from './core'
import { apply as applyImport, undo as undoImport } from './movein/index'
import { exportHistory as exportArchive, restoreHistory as restoreArchive } from './archive'
// AUDIT-001: one durable row per audited action, with the actor, time and subject. Rows
// carry identifiers and counts only, never event data, so they survive history erasure.
const insert='INSERT INTO vane_audit(id,at,actor,action,subject,detail) VALUES(?,?,?,?,?,?)'
export const auditSql=(actor:string,action:string,subject:string,detail='')=>({sql:insert,params:[uid(),Date.now(),actor,action,subject,detail]})
export const auditStatement=(env:Env,actor:string,action:string,subject:string,detail='')=>{const {sql,params}=auditSql(actor,action,subject,detail);return env.DB.prepare(sql).bind(...params)}
export const audit=(env:Env,actor:string,action:string,subject:string,detail='')=>auditStatement(env,actor,action,subject,detail).run()

export async function auditLog(env:Env,actor:Actor) {
 role(actor,['owner','admin']);
 // The subject is named where it is a person, a site or a proposal; the view never shows a bare id.
 return rows(env,'SELECT a.id,a.at,a.actor,COALESCE(o.display_name,a.actor) AS actorName,o.display_name AS actorKnown,a.action,a.subject,COALESCE(so.display_name,vs.name) AS subjectName,vp.command AS subjectCommand,a.detail FROM vane_audit a LEFT JOIN oa_operators o ON o.id=a.actor LEFT JOIN oa_operators so ON so.id=a.subject LEFT JOIN vane_sites vs ON vs.id=a.subject LEFT JOIN vane_proposals vp ON vp.id=a.subject ORDER BY a.at DESC,a.id LIMIT 500');
}
export async function apply(env:Env,actor:Actor,input:Parameters<typeof applyImport>[2]) {
 const result=await applyImport(env,actor,input);await audit(env,actor.id,'import.apply',input.siteId,`job ${result.job.id}, ${result.complete?'complete':'in progress'}`);return result;
}
export async function undo(env:Env,actor:Actor,input:Parameters<typeof undoImport>[2]) {
 const result=await undoImport(env,actor,input);await audit(env,actor.id,'import.undo',input.siteId,`job ${input.jobId}, ${result.complete?'complete':'in progress'}`);return result;
}
export async function exportHistory(env:Env,actor:Actor) {
 const archive=await exportArchive(env,actor);await audit(env,actor.id,'history.export','installation',`archive ${archive.sha256}`);return archive;
}
export async function restoreHistory(env:Env,actor:Actor,input:unknown,journal?:unknown) {
 const result=await restoreArchive(env,actor,input,journal);await audit(env,actor.id,'history.restore','installation',`${result.rows} rows`);return result;
}

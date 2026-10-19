import { day as utcDay, insist, role, rows, site, statement, uid, type Actor, type Config, type Env } from './core'
import { auditStatement } from './audit'
import { clock } from './clock'
import { definitionAnnotations, type Annotation } from './definitions'
import { localDay } from './visitors'
// DASH-009: the dated annotations of a set of sites over local dates [from, to): team members' notes and
// integration events stored in vane_annotations, approved settings changes and completed imports and undos from the
// audit trail, and visit-definition versions (METRIC-004). Every kind marks every chart of its site except a
// definition version, which marks only the charts of visits, bounce rate and visit duration.
export const ANNOTATION_KINDS={note:'Note',settings:'Settings change',definition:'Definition change',import:'Import',deploy:'Deploy',release:'Release',incident:'Uptime incident','error-spike':'Spool error spike',campaign:'Mango campaign send'} as const
export type AnnotationKind=keyof typeof ANNOTATION_KINDS
export async function annotationsFor(env:Env,sites:{id:string,name:string,config:Config}[],from:string,to:string,named:boolean):Promise<Annotation[]> {
 const ids=JSON.stringify(sites.map(s=>s.id)),by=new Map(sites.map(s=>[s.id,s])),label=(id:string)=>named?{site:by.get(id)!.name}:{}
 const [stored,audited]=await Promise.all([
  rows<{id:string,site_id:string,day:string,kind:AnnotationKind,text:string,url:string|null,author:string|null}>(env,'SELECT id,site_id,day,kind,text,url,author FROM vane_annotations WHERE site_id IN (SELECT value FROM json_each(?)) AND day>=? AND day<? ORDER BY day,at',ids,from,to),
  rows<{at:number,action:string,subject:string,detail:string}>(env,"SELECT at,action,subject,detail FROM vane_audit WHERE action IN ('settings.change','import.apply','import.undo') AND subject IN (SELECT value FROM json_each(?)) ORDER BY at",ids),
 ])
 const fromAudit=audited.filter(r=>r.action==='settings.change'||r.detail.endsWith(', complete')).map(r=>({day:localDay(r.at,by.get(r.subject)!.config.timeZone??'UTC'),kind:(r.action==='settings.change'?'settings':'import') as AnnotationKind,text:r.action==='settings.change'?`Settings approved (${r.detail}).`:r.action==='import.apply'?`History imported (${r.detail.replace(/, complete$/,'')}).`:`Imported history removed (${r.detail.replace(/, complete$/,'')}).`,...label(r.subject)})).filter(a=>a.day>=from&&a.day<to)
 return [...stored.map(r=>({day:r.day,kind:r.kind,text:r.text,id:r.id,...(r.url?{url:r.url}:{}),...(r.author?{author:r.author}:{}),...label(r.site_id)})),...fromAudit,...definitionAnnotations(sites,from,to,named)].sort((a,b)=>a.day.localeCompare(b.day))
}

// A plain-text line: no control characters or markup, at most `max` characters.
export function plainText(value:unknown,max:number,code:string,message:string):string {
 const text=String(value??'').trim();
 insist(text.length>0&&text.length<=max&&!/[\u0000-\u001f\u007f<>]/.test(text),code,message);
 return text;
}
export const localDate=(value:unknown)=>{const d=String(value??'');insist(/^\d{4}-\d{2}-\d{2}$/.test(d)&&utcDay(Date.parse(d))===d,'day','Choose a valid date.');return d}
// A note: any signed-in owner, administrator or member adds one (ct 06:25Z); its author or the owner deletes it.
export async function addNote(env:Env,actor:Actor,input:any) {
 role(actor,['owner','admin','member']);
 const value=await site(env,String(input.siteId)),day=localDate(input.day),text=plainText(input.text,280,'note','Write a note of up to 280 characters, as plain text.'),id=uid();
 await env.DB.batch([statement(env,"INSERT INTO vane_annotations(id,site_id,day,kind,text,url,author,at) VALUES(?,?,?,'note',?,NULL,?,?)",id,value.id,day,text,actor.id,clock()),auditStatement(env,actor.id,'annotation.add',value.id,`note ${id} on ${day}`)]);
 return value.id;
}
export async function deleteNote(env:Env,actor:Actor,id:string) {
 const note=(await rows<{site_id:string,author:string,day:string}>(env,"SELECT site_id,author,day FROM vane_annotations WHERE id=? AND kind='note'",id))[0];
 insist(note,'note','This note no longer exists.',404);insist(note.author===actor.id||actor.role==='owner','forbidden','Only the note’s author or the owner deletes it.',403);
 await env.DB.batch([statement(env,'DELETE FROM vane_annotations WHERE id=?',id),auditStatement(env,actor.id,'annotation.delete',note.site_id,`note ${id} on ${note.day}`)]);
 return note.site_id;
}

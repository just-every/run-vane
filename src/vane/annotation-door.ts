import { digest, insist, role, rows, site, statement, VaneError, type Actor, type Env } from './core'
import { auditStatement } from './audit'
import { clock } from './clock'
import { localDay } from './visitors'
import { plainText } from './annotations'
// DASH-009: the annotation door for deploy webhooks, releases, Uptime incidents, Spool error spikes and Mango campaign
// sends (ct 06:25Z). A sender posts {siteId, id, kind, at, title, url?} with the site's secret as a bearer token. The
// secret is created, replaced and revoked only by the owner, shown once and kept only as its SHA-256. The sender's
// id makes a repeat idempotent; a site accepts at most 60 such annotations an hour; a URL keeps only origin and path.
export const HOOK_KINDS=['deploy','release','incident','error-spike','campaign'] as const
export const HOOK_LIMIT_PER_HOUR=60
const headers={'cache-control':'no-store','x-content-type-options':'nosniff'}
const fail=(error:unknown)=>{const e=error instanceof VaneError?error:new VaneError('invalid_annotation','The annotation could not be accepted.');return Response.json({error:e.code,message:e.message},{status:e.status,headers})}
export async function annotationDoor(request:Request,env:Env):Promise<Response|null> {
 if(new URL(request.url).pathname!=='/api/vane/annotations')return null;
 try {
  insist(request.method==='POST','method','POST required.',405);
  const text=await request.text();insist(text.length<=4096,'body','Annotation too large.',413);
  let p:any;try{p=JSON.parse(text)}catch{throw new VaneError('body','Send a JSON annotation.')}
  insist(p&&typeof p==='object'&&Object.keys(p).every(k=>['siteId','id','kind','at','title','url'].includes(k)),'fields','An annotation carries siteId, id, kind, at, title and an optional url.');
  const hook=(await rows<{secret_hash:string}>(env,'SELECT secret_hash FROM vane_annotation_hooks WHERE site_id=?',String(p.siteId)))[0],token=(request.headers.get('authorization')??'').match(/^Bearer (\S{20,200})$/)?.[1];
  insist(hook&&token&&await digest(token)===hook.secret_hash,'unauthorized','Send the site’s annotation secret as a bearer token.',401);
  const value=await site(env,String(p.siteId)),now=clock();
  insist(typeof p.id==='string'&&/^[A-Za-z0-9._:-]{1,100}$/.test(p.id),'id','Send your own ID for the annotation, up to 100 letters, digits and . _ : -.');
  insist((HOOK_KINDS as readonly string[]).includes(p.kind),'kind','The kind is deploy, release, incident, error-spike or campaign.');
  const at=typeof p.at==='number'?p.at:Date.parse(String(p.at));insist(Number.isSafeInteger(at)&&at>0,'at','Send the time as epoch milliseconds or an ISO 8601 timestamp.');
  const title=plainText(p.title,120,'title','Send a plain-text title of up to 120 characters.');
  let url:string|null=null;
  if(p.url!==undefined){let u:URL|null=null;try{u=new URL(String(p.url))}catch{}insist(u&&['http:','https:'].includes(u.protocol)&&!u.username&&!u.password&&String(p.url).length<=500,'url','Send a web address without credentials.');url=u!.origin+u!.pathname}
  const id=`${value.id}:hook:${p.id}`;
  if((await rows(env,'SELECT 1 FROM vane_annotations WHERE id=?',id)).length)return Response.json({accepted:true,duplicate:true},{headers});
  const recent=Number((await rows(env,"SELECT COUNT(*) AS n FROM vane_annotations WHERE site_id=? AND kind<>'note' AND at>?",value.id,now-3600000))[0].n);
  insist(recent<HOOK_LIMIT_PER_HOUR,'rate_limited','This site accepts at most 60 integration annotations an hour.',429);
  await env.DB.prepare('INSERT OR IGNORE INTO vane_annotations(id,site_id,day,kind,text,url,author,at) VALUES(?,?,?,?,?,?,NULL,?)').bind(id,value.id,localDay(at,value.config.timeZone??'UTC'),p.kind,title,url,now).run();
  return Response.json({accepted:true},{status:201,headers});
 } catch(error) { return fail(error) }
}
// The owner creates (or replaces) and revokes the site's secret; the plain secret is returned once, to be shown once.
export async function createHook(env:Env,actor:Actor,siteId:string):Promise<string> {
 role(actor);const value=await site(env,siteId),secret='vane_ah_'+Array.from(crypto.getRandomValues(new Uint8Array(32)),b=>b.toString(16).padStart(2,'0')).join('');
 await env.DB.batch([statement(env,'INSERT INTO vane_annotation_hooks(site_id,secret_hash,created_at,created_by) VALUES(?,?,?,?) ON CONFLICT(site_id) DO UPDATE SET secret_hash=excluded.secret_hash,created_at=excluded.created_at,created_by=excluded.created_by',value.id,await digest(secret),Date.now(),actor.id),auditStatement(env,actor.id,'annotation-hook.create',value.id,'secret created; previous secret, if any, revoked')]);
 return secret;
}
export async function revokeHook(env:Env,actor:Actor,siteId:string) {
 role(actor);const value=await site(env,siteId);
 await env.DB.batch([statement(env,'DELETE FROM vane_annotation_hooks WHERE site_id=?',value.id),auditStatement(env,actor.id,'annotation-hook.revoke',value.id,'secret revoked')]);
}

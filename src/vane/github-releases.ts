import { insist, role, rows, site, statement, VaneError, type Actor, type Env } from './core'
import { auditStatement } from './audit'
import { clock } from './clock'
import { localDay } from './visitors'
import { HOOK_LIMIT_PER_HOUR } from './annotation-door'
// DASH-009: GitHub releases as chart annotations (ct 06:40Z). GitHub signs each delivery with X-Hub-Signature-256, an
// HMAC that needs the key itself, so the site's GitHub key is a separate owner-created secret kept encrypted with
// AES-GCM under a key derived from the installation's session secret, shown once and revocable. The door accepts
// release events only (and GitHub's ping), and a published release is its only annotation.
const utf8=new TextEncoder(),hex=(bytes:ArrayBuffer|Uint8Array)=>Array.from(new Uint8Array(bytes),b=>b.toString(16).padStart(2,'0')).join('')
const b64=(bytes:ArrayBuffer|Uint8Array)=>btoa(String.fromCharCode(...new Uint8Array(bytes))),unb64=(value:string)=>Uint8Array.from(atob(value),c=>c.charCodeAt(0))
const sealingKey=async(env:Env)=>crypto.subtle.importKey('raw',await crypto.subtle.digest('SHA-256',utf8.encode(`vane-github-key-v1\0${env.SESSION_SECRET}`)),'AES-GCM',false,['encrypt','decrypt'])
async function seal(env:Env,siteId:string,key:string){const iv=crypto.getRandomValues(new Uint8Array(12));return `${b64(iv)}.${b64(await crypto.subtle.encrypt({name:'AES-GCM',iv,additionalData:utf8.encode(siteId)},await sealingKey(env),utf8.encode(key)))}`}
async function unseal(env:Env,siteId:string,sealed:string){const [iv,data]=sealed.split('.');return new TextDecoder().decode(await crypto.subtle.decrypt({name:'AES-GCM',iv:unb64(iv!),additionalData:utf8.encode(siteId)},await sealingKey(env),unb64(data!)))}
const headers={'cache-control':'no-store','x-content-type-options':'nosniff'}
export async function githubReleaseDoor(request:Request,env:Env):Promise<Response|null> {
 const match=new URL(request.url).pathname.match(/^\/api\/vane\/annotations\/github\/([\w-]+)$/);
 if(!match)return null;
 try {
  insist(request.method==='POST','method','POST required.',405);
  const body=await request.text();insist(body.length<=65536,'body','Delivery too large.',413);
  const stored=(await rows<{sealed_key:string}>(env,'SELECT sealed_key FROM vane_github_keys WHERE site_id=?',match[1]!))[0],signature=request.headers.get('x-hub-signature-256')??'';
  let key='';try{key=stored?await unseal(env,match[1]!,stored.sealed_key):''}catch{}
  const given=signature.match(/^sha256=([0-9a-f]{64})$/)?.[1],mac=given?Uint8Array.from(given.match(/../g)!,h=>parseInt(h,16)):null;
  // subtle.verify compares the HMAC in constant time.
  insist(key&&mac&&await crypto.subtle.verify('HMAC',await crypto.subtle.importKey('raw',utf8.encode(key),{name:'HMAC',hash:'SHA-256'},false,['verify']),mac,utf8.encode(body)),'unauthorized','The delivery is not signed with this site’s GitHub key.',401);
  const event=request.headers.get('x-github-event');
  if(event==='ping')return Response.json({accepted:true,ping:true},{headers});
  insist(event==='release','event','Only release events are accepted.');
  const p=JSON.parse(body),release=p?.release;
  if(p?.action!=='published')return Response.json({accepted:false,reason:'Only published releases are annotated.'},{status:202,headers});
  insist(release&&Number.isSafeInteger(release.id)&&typeof release.tag_name==='string','release','The release payload is incomplete.');
  const value=await site(env,match[1]!),now=clock(),id=`${value.id}:github:${release.id}`;
  if((await rows(env,'SELECT 1 FROM vane_annotations WHERE id=?',id)).length)return Response.json({accepted:true,duplicate:true},{headers});
  insist(Number((await rows(env,"SELECT COUNT(*) AS n FROM vane_annotations WHERE site_id=? AND kind<>'note' AND at>?",value.id,now-3600000))[0].n)<HOOK_LIMIT_PER_HOUR,'rate_limited','This site accepts at most 60 integration annotations an hour.',429);
  const at=Date.parse(String(release.published_at??''))||now,title=`Release ${String(release.name||release.tag_name)}`.replace(/[\u0000-\u001f\u007f<>]/g,' ').trim().slice(0,120);
  let url:string|null=null;try{const u=new URL(String(release.html_url));if(['http:','https:'].includes(u.protocol))url=u.origin+u.pathname}catch{}
  await env.DB.prepare("INSERT OR IGNORE INTO vane_annotations(id,site_id,day,kind,text,url,author,at) VALUES(?,?,?,'release',?,?,NULL,?)").bind(id,value.id,localDay(at,value.config.timeZone??'UTC'),title,url,now).run();
  return Response.json({accepted:true},{status:201,headers});
 } catch(error) { const e=error instanceof VaneError?error:new VaneError('invalid_delivery','The delivery could not be accepted.');return Response.json({error:e.code,message:e.message},{status:e.status,headers}) }
}
export async function createGithubKey(env:Env,actor:Actor,siteId:string):Promise<string> {
 role(actor);const value=await site(env,siteId),key='vane_gh_'+hex(crypto.getRandomValues(new Uint8Array(32)));
 await env.DB.batch([statement(env,'INSERT INTO vane_github_keys(site_id,sealed_key,created_at,created_by) VALUES(?,?,?,?) ON CONFLICT(site_id) DO UPDATE SET sealed_key=excluded.sealed_key,created_at=excluded.created_at,created_by=excluded.created_by',value.id,await seal(env,value.id,key),Date.now(),actor.id),auditStatement(env,actor.id,'annotation-github.create',value.id,'GitHub release key created; previous key, if any, revoked')]);
 return key;
}
export async function revokeGithubKey(env:Env,actor:Actor,siteId:string) {
 role(actor);const value=await site(env,siteId);
 await env.DB.batch([statement(env,'DELETE FROM vane_github_keys WHERE site_id=?',value.id),auditStatement(env,actor.id,'annotation-github.revoke',value.id,'GitHub release key revoked')]);
}

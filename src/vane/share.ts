import { reportFrame } from './agency/branding'
import { shareOriginAllowed } from './agency/domains'
import { fontHead } from '../base/font-head'
import { digest, inScope, insist, role, rows, site, statement, uid, VaneError, type Actor, type Env, type Site } from './core'
import { auditStatement } from './audit'
import { clock } from './clock'
import { createInsightsService } from './reports'
import { PUBLIC_REPORTS } from './public-reports'
import { segment } from './segments'
import { escape } from './views/html'
import { publicStats } from './views/public'
import { passwordPage } from './views/share'
// SHARE-001: read-only shared links (ct 10:46Z default). The owner or an administrator creates a link to a whole site
// or one of its saved segments (DASH-007, fixed for the viewer), with reports chosen from the public-page list
// (SHARE-002), so revenue (CONV-006) shows only when its report is chosen. The link's token (32 random bytes) is shown
// once; only its SHA-256 is kept. An optional password is kept as a salted PBKDF2-SHA256 hash (100,000 iterations); the
// right one sets a 24-hour signed cookie scoped to the link's path, and after 10 wrong passwords in 15 minutes the link
// answers 429 until that window ends. A link may expire 1 to 365 days after creation; an expired, revoked or unknown
// link answers 404. A link opens in an iframe only on the site's registered origins and up to 5 more https origins the
// owner lists; ?theme=dark shows it dark. Viewers need no account and reach nothing else: no settings, other sites,
// private routes or other periods' controls beyond from/to. Creating and revoking are audited (AUDIT-001).
export const SHARE_PATH=/^\/share\/(vane_s_[0-9a-f]{64})$/
export const PASSWORD_ITERATIONS=100_000,MAX_FAILURES=10,FAILURE_WINDOW=15*60_000,COOKIE_AGE=86_400
const utf8=new TextEncoder(),hex=(bytes:ArrayBuffer|Uint8Array)=>Array.from(new Uint8Array(bytes),b=>b.toString(16).padStart(2,'0')).join('')
const random=(n:number)=>hex(crypto.getRandomValues(new Uint8Array(n)))
async function passwordHash(password:string,salt:string):Promise<string> {
 const key=await crypto.subtle.importKey('raw',utf8.encode(password),'PBKDF2',false,['deriveBits']);
 return hex(await crypto.subtle.deriveBits({name:'PBKDF2',hash:'SHA-256',salt:utf8.encode(salt),iterations:PASSWORD_ITERATIONS},key,256));
}
const macKey=(env:Env)=>crypto.subtle.importKey('raw',utf8.encode(`vane-share-v1\0${env.SESSION_SECRET}`),{name:'HMAC',hash:'SHA-256'},false,['sign'])
const signature=async(env:Env,link:any,expires:number)=>hex(await crypto.subtle.sign('HMAC',await macKey(env),utf8.encode(`${link.id}\0${link.password_hash}\0${expires}`)))
const cookieName='vane_share'
export interface ShareLink { id:string; label:string; segmentId:string|null; segmentName:string|null; reports:string[]; password:boolean; expiresAt:number|null; embedOrigins:string[]; createdAt:number }
export async function shareLinks(env:Env,siteId:string):Promise<ShareLink[]> {
 return (await rows<any>(env,'SELECT l.*,s.name AS segment_name FROM vane_share_links l LEFT JOIN vane_segments s ON s.id=l.segment_id WHERE l.site_id=? ORDER BY l.created_at DESC',siteId)).map(r=>({id:r.id,label:r.label,segmentId:r.segment_id,segmentName:r.segment_name,reports:JSON.parse(r.reports_json),password:Boolean(r.password_hash),expiresAt:r.expires_at,embedOrigins:JSON.parse(r.embed_origins_json),createdAt:r.created_at}))
}
// Returns the link's path, holding its token: shown once and never stored.
export async function createShareLink(env:Env,actor:Actor,input:any):Promise<{siteId:string,path:string}> {
 role(actor,['owner','admin']);
 const value=await site(env,String(input.siteId)),label=String(input.label??'').trim()||'Shared link';
 insist(label.length<=60&&!/[\u0000-\u001f\u007f<>]/.test(label),'share_label','Name the link in up to 60 characters of plain text.');
 const reports:string[]=Array.isArray(input.reports)?[...new Set<string>(input.reports.map(String))]:Object.keys(PUBLIC_REPORTS).filter(key=>input['share_'+key]==='on');
 insist(reports.length>0&&reports.every(key=>Object.hasOwn(PUBLIC_REPORTS,key)),'share_reports','Choose at least one report from the listed ones.');
 const segmentId=input.segment?String(input.segment):null;if(segmentId)await segment(env,value.id,segmentId);
 const password=String(input.password??'');insist(!password||password.length>=8&&password.length<=200,'share_password','A link password has 8 to 200 characters, or leave it empty.');
 const days=input.expiresDays===undefined||input.expiresDays===''?null:Number(input.expiresDays);
 insist(days===null||Number.isInteger(days)&&days>=1&&days<=365,'share_expiry','A link expires after 1 to 365 days, or leave it empty for no expiry.');
 const origins=(Array.isArray(input.embedOrigins)?input.embedOrigins:String(input.embedOrigins??'').split('\n')).map((x:unknown)=>String(x).trim()).filter(Boolean);
 insist(origins.length<=5&&origins.every((o:string)=>{try{const u=new URL(o);return u.protocol==='https:'&&u.origin===o}catch{return false}}),'share_embed','List at most 5 more embedding origins, each https://host with no path.');
 const id=uid(),token='vane_s_'+random(32),salt=password?random(16):null,now=clock();
 await env.DB.batch([statement(env,'INSERT INTO vane_share_links(id,site_id,label,segment_id,reports_json,token_hash,password_salt,password_hash,expires_at,embed_origins_json,created_by,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)',id,value.id,label,segmentId,JSON.stringify(reports),await digest(token),salt,salt?await passwordHash(password,salt):null,days===null?null:now+days*86_400_000,JSON.stringify([...new Set(origins)]),actor.id,now),auditStatement(env,actor.id,'share.create',value.id,`link ${id}${segmentId?`, segment ${segmentId}`:''}, reports ${reports.join(' ')}${salt?', password':''}${days===null?'':`, expires after ${days} days`}`)]);
 return {siteId:value.id,path:'/share/'+token};
}
export async function revokeShareLink(env:Env,actor:Actor,id:string):Promise<string> {
 role(actor,['owner','admin']);
 const found=(await rows<{site_id:string}>(env,'SELECT site_id FROM vane_share_links WHERE id=?',id))[0];insist(found,'share','This shared link no longer exists.',404);inScope(actor,found.site_id);
 await env.DB.batch([statement(env,'DELETE FROM vane_share_links WHERE id=?',id),auditStatement(env,actor.id,'share.revoke',found.site_id,`link ${id}`)]);
 return found.site_id;
}
const notFound=()=>new Response('Not found',{status:404,headers:{'content-type':'text/plain; charset=utf-8','cache-control':'no-store','x-content-type-options':'nosniff'}})
async function document(env:Env,value:Site,link:any,body:string,dark:boolean,status=200,extra:Record<string,string>={}):Promise<Response> {
 const frame=await reportFrame(env,value.id),ancestors=[value.origin,...(value.config.origins??[]),...JSON.parse(link.embed_origins_json)];
 const html=`<!doctype html><html lang="en"${frame.htmlClass}><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex, nofollow"><title>${escape(value.name)} stats · Vane</title>${fontHead}${frame.head}<link rel="stylesheet" href="/vane.css"></head><body class="vane-app${dark?' vane-dark':''}"><main>${frame.brand}${body}</main></body></html>`;
 return new Response(html,{status,headers:{'content-type':'text/html; charset=utf-8','cache-control':'no-store','x-robots-tag':'noindex, nofollow','content-security-policy':`default-src 'none'; ${frame.policy}; base-uri 'none'; form-action 'self'; frame-ancestors ${ancestors.join(' ')}`,'x-content-type-options':'nosniff','referrer-policy':'no-referrer',...extra}});
}
export async function shareResponse(request:Request,env:Env):Promise<Response|null> {
 const url=new URL(request.url),match=url.pathname.match(SHARE_PATH);
 if(!match)return null;
 if(!['GET','HEAD','POST'].includes(request.method))return notFound();
 const now=clock(),link=(await rows<any>(env,'SELECT * FROM vane_share_links WHERE token_hash=?',await digest(match[1]!)))[0];
 if(!link||link.expires_at!==null&&now>=link.expires_at)return notFound();
 const value=await site(env,link.site_id),dark=url.searchParams.get('theme')==='dark';
 if(link.password_hash) {
  const cookie=(request.headers.get('cookie')??'').split(/;\s*/).find(c=>c.startsWith(cookieName+'='))?.slice(cookieName.length+1)??'',[expires,mac]=cookie.split('.');
  const signedIn=Number(expires)>now&&mac===await signature(env,link,Number(expires));
  if(request.method==='POST') {
   if(!await shareOriginAllowed(request,env,value.id))return notFound();
   const windowOpen=link.failed_from!==null&&now-link.failed_from<FAILURE_WINDOW,failures=windowOpen?link.failures:0;
   if(failures>=MAX_FAILURES)return document(env,value,link,passwordPage(value,'Too many wrong passwords. Try again in 15 minutes.'),dark,429);
   const form=await request.formData(),given=String(form.get('password')??'');
   if(given.length>200||await passwordHash(given,link.password_salt)!==link.password_hash) {
    await env.DB.prepare('UPDATE vane_share_links SET failures=?,failed_from=? WHERE id=?').bind(failures+1,windowOpen?link.failed_from:now,link.id).run();
    return document(env,value,link,passwordPage(value,'That password is not right.'),dark,401);
   }
   const until=now+COOKIE_AGE*1000;
   return new Response(null,{status:303,headers:{location:url.pathname+url.search,'cache-control':'no-store','set-cookie':`${cookieName}=${until}.${await signature(env,link,until)}; Path=${url.pathname}; Max-Age=${COOKIE_AGE}; HttpOnly; Secure; SameSite=None; Partitioned`}});
  }
  if(!signedIn)return document(env,value,link,passwordPage(value),dark,401);
 } else if(request.method==='POST')return notFound();
 try {
  const report=await createInsightsService(env,value,now,{from:url.searchParams.get('from'),to:url.searchParams.get('to'),segment:link.segment_id,imported:url.searchParams.get('imported')}).list();
  const response=await document(env,value,link,`${link.segment_id?`<p class="vane-help">Segment: ${escape(report.segment?.name??'')}</p>`:''}${publicStats(value,JSON.parse(link.reports_json),report,env.AUTH_ORIGIN)}`,dark);
  return request.method==='HEAD'?new Response(null,{headers:response.headers}):response;
 } catch(error) { if(error instanceof VaneError&&error.status===404)return notFound(); throw error }
}

import { insist, site, siteOrigin, VaneError, type Env } from './core'
import { clock } from './clock'
import { localDay } from './visitors'
// CONV-003: automatic events, each turned on per site. Outbound links record the destination without its
// query, downloads the file URL for common document and media extensions, 404 pages (marked by the site
// with <meta name="vane-404">) the missing path, and form submissions the form's ID or action path, never
// field values. A path that looks personal (an email address or a long number) is stored as (redacted).
export const AUTO_EVENTS=['outbound','download','404','form'] as const
export const DOWNLOAD=/\.(pdf|docx?|xlsx?|pptx?|csv|txt|rtf|odt|ods|zip|gz|dmg|exe|msi|apk|epub|mp3|wav|mp4|mov|avi|mkv)$/i
const redact=(path:string)=>/@|\d{6,}/.test(path)?'(redacted)':path
const web=(value:string)=>{let url:URL;try{url=new URL(value)}catch{throw new VaneError('prop','Send an absolute web address.')}insist(['http:','https:'].includes(url.protocol)&&!url.username&&!url.password&&!url.search&&!url.hash&&value.length<=300,'prop','Send the address without its query, fragment or credentials.');return url}
function detail(kind:string,prop:string,origins:string[]):string {
 if(kind==='outbound'){const url=web(prop);insist(!origins.includes(url.origin),'prop','An outbound link leaves the site.');return url.origin+url.pathname}
 if(kind==='download'){const url=web(prop);insist(DOWNLOAD.test(url.pathname),'prop','A download is a document or media file.');return url.origin+url.pathname}
 if(kind==='form'&&/^[A-Za-z][\w-]{0,63}$/.test(prop))return prop;
 insist(/^\/[^?#\s]{0,199}$/.test(prop),'prop','Send a path without its query.');
 return redact(prop);
}
export async function autoEventResponse(request:Request,env:Env):Promise<Response|null> {
 if(new URL(request.url).pathname!=='/api/vane/event')return null;
 let cors:Record<string,string>={'vary':'Origin','cache-control':'no-store'};
 if(request.method==='OPTIONS')return new Response(null,{status:204,headers:{...cors,'access-control-allow-origin':request.headers.get('origin')??'null','access-control-allow-methods':'POST','access-control-allow-headers':'content-type','access-control-max-age':'600'}});
 try {
  insist(request.method==='POST','method','POST required.',405);
  const text=await request.text();insist(text.length<=2048,'body','Event too large.',413);
  const payload=JSON.parse(text),value=await site(env,String(payload?.siteId));
  const origin=siteOrigin(value,request);cors={...cors,'access-control-allow-origin':origin};
  insist(Object.keys(payload).every(key=>['id','siteId','kind','prop','consent'].includes(key))&&/^[a-f0-9-]{36}$/.test(payload.id)&&typeof payload.prop==='string','fields','Only the declared automatic-event fields are accepted.');
  insist((value.config.autoEvents??[]).includes(payload.kind),'kind','This automatic event is not turned on for the site.',403);
  insist(payload.consent===(value.config.consent==='required'?'granted':'not-required'),'consent','Consent is required for collection.',403);
  const now=clock();
  await env.DB.prepare('INSERT OR IGNORE INTO vane_auto_events(id,site_id,day,kind,prop,at,hostname) VALUES(?,?,?,?,?,?,?)').bind(value.id+':'+payload.id,value.id,localDay(now,value.config.timeZone??'UTC'),payload.kind,detail(payload.kind,payload.prop,[value.origin,...(value.config.origins??[])]),now,new URL(origin).hostname.toLowerCase()).run();
  return Response.json({accepted:true},{status:202,headers:cors});
 } catch(error) { const e=error instanceof VaneError?error:new VaneError('invalid_event','Event could not be accepted.'); return Response.json({error:e.code,message:e.message},{status:e.status,headers:cors}); }
}

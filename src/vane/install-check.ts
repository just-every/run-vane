import { role, site, type Actor, type Env, type Site } from './core'
import { pathAllowed, storedPath } from './paths'
// Verify installation (INSTALL-001): load the site's homepage server-side, find this
// installation's script and name the exact cause of any failure, then wait up to
// 60 seconds for a first event from that page.
export interface InstallCheck { state:'verified'|'failed'; cause:string; message:string }
const fail=(cause:string,message:string):InstallCheck=>({state:'failed',cause,message})

async function load(start:string) {
 let url=start;
 for(let hop=0;hop<5;hop++) {
  const response=await fetch(url,{redirect:'manual',headers:{accept:'text/html','user-agent':'Vane installation check'},signal:AbortSignal.timeout(15000)});
  const next=response.headers.get('location');
  if(response.status>=300&&response.status<400&&next){url=new URL(next,url).href;continue}
  return {url,response};
 }
 throw new Error('Too many redirects.');
}

const attribute=(tag:string,name:string)=>tag.match(new RegExp(`\\s${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`,'i'))?.slice(1).find(value=>value!==undefined);

// The effective source list for a fetch directive, from headers and meta tags; every policy must allow.
function policies(response:Response,html:string) {
 const header=response.headers.get('content-security-policy');
 const meta=[...html.matchAll(/<meta\b[^>]*>/gi)].map(m=>m[0]).filter(tag=>attribute(tag,'http-equiv')?.toLowerCase()==='content-security-policy').map(tag=>attribute(tag,'content')??'');
 return [...(header?header.split(','):[]),...meta].map(policy=>new Map(policy.split(';').map(part=>part.trim().split(/\s+/)).filter(([name])=>name).map(([name,...sources])=>[name!.toLowerCase(),sources.map(source=>source.toLowerCase())])));
}
function allows(policy:Map<string,string[]>,directives:string[],target:URL,page:URL) {
 const sources=directives.map(name=>policy.get(name)).find(Boolean);
 if(!sources)return true;
 return sources.some(source=>source==='*'||source===`${target.protocol}`||source===target.origin||source===target.host||source==="'self'"&&target.origin===page.origin);
}

export async function verifyInstallation(env:Env,actor:Actor,siteId:string,waitMs=60000):Promise<InstallCheck> {
 role(actor,['owner','admin']);
 const value:Site=await site(env,siteId),installation=new URL(env.AUTH_ORIGIN).origin;
 let loaded;
 try { loaded=await load(value.origin+'/') } catch { return fail('unreachable',`The homepage ${value.origin}/ could not be loaded.`) }
 const page=new URL(loaded.url);
 if(!loaded.response.ok)return fail('unreachable',`The homepage ${page.href} answered ${loaded.response.status}.`);
 if(![value.origin,...(value.config.origins??[])].includes(page.origin))return fail('origin_mismatch',`The homepage moved to ${page.origin}, but this site is registered for ${value.origin}. Events from ${page.origin} are refused; register that origin instead.`);
 const html=await loaded.response.text();
 const scripts=[...html.matchAll(/<script\b[^>]*>/gi)].map(m=>m[0]).flatMap(tag=>{const src=attribute(tag,'src');if(!src)return[];try{const url=new URL(src,page);return url.origin===installation&&url.pathname==='/vane.js'?[{tag,url}]:[]}catch{return[]}});
 if(!scripts.length)return fail('script_missing',`No script from ${installation}/vane.js was found on ${page.href}. Add the snippet from these settings.`);
 const ids=scripts.map(script=>attribute(script.tag,'data-site')??'');
 if(!ids.includes(value.id))return fail('wrong_site_id',`The script on ${page.href} names site ID ${ids.map(id=>`"${id}"`).join(', ')}, not ${value.id}. Copy the snippet again from these settings.`);
 for(const policy of policies(loaded.response,html)) {
  if(!allows(policy,['script-src-elem','script-src','default-src'],scripts[0]!.url,page))return fail('csp_blocked',`The page's Content Security Policy does not allow scripts from ${installation}. Add it to script-src.`);
  if(!allows(policy,['connect-src','default-src'],new URL(installation),page))return fail('csp_blocked',`The page's Content Security Policy does not allow connections to ${installation}. Add it to connect-src.`);
 }
 const path=storedPath(value.config,page.pathname);
 if(!pathAllowed(value.config,path))return fail('path_excluded',`The homepage path ${page.pathname} is left out by this site's include or exclude paths, so its page loads are not collected.`);
 if(value.config.consent==='required'&&!html.includes('vaneConsent'))return fail('consent_missing',`This site requires consent, but ${page.href} never sets window.vaneConsent, so no page load is sent.`);
 const arrived=()=>env.DB.prepare('SELECT 1 FROM vane_events WHERE site_id=? AND path=? LIMIT 1').bind(value.id,path).first();
 for(const until=Date.now()+waitMs;;await new Promise(done=>setTimeout(done,1000))) {
  if(await arrived())return {state:'verified',cause:'verified',message:`Installation verified: the script is on ${page.href} and its first event has arrived.`};
  if(Date.now()>=until)return fail('blocker_suspected',`The script is installed correctly on ${page.href}, but no event arrived within ${Math.round(waitMs/1000)} seconds of the check. Open the page in a browser without a content blocker, Do Not Track or Global Privacy Control, then verify again.`);
 }
}

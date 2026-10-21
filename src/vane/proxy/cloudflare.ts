import { atomic, insist, statement, VaneError, type Actor, type Env } from '../core'
import { auditStatement } from '../audit'
import { clock } from '../clock'
import { managedConnection, ownerSite, publicConnection } from './connections'
import { INSTALLATION_WORKER_NAME, type CloudflareConnect, type ConnectionRow, type ProxyConnection, type ProxyProvider } from './types'

const API='https://api.cloudflare.com/client/v4'
interface Route { id:string; pattern:string; script?:string }
interface Domain { id:string; hostname:string; service:string; zone_id:string; environment?:string; enabled?:boolean }
interface Zone { id:string; name:string; account:{id:string}; status?:string }
interface Settings { bindings?:{type:string;name:string;text?:string}[] }
/** Fixed official endpoints only. Never return Cloudflare response text, request
 * headers or thrown fetch errors: those may contain the transient owner token. */
async function provider<T>(token:string,path:string,method='GET',body?:unknown):Promise<T> {
 let response:Response
 try {
  response=await fetch(API+path,{method,redirect:'manual',signal:AbortSignal.timeout(15000),headers:{authorization:'Bearer '+token,'content-type':'application/json'},...(body===undefined?{}:{body:JSON.stringify(body)})})
 }catch{throw new VaneError('proxy_cloudflare','Cloudflare could not be reached. Check the account permissions and try again.',502)}
 let answer:any
 try{answer=await response.json()}catch{throw new VaneError('proxy_cloudflare','Cloudflare returned an unreadable response.',502)}
 insist(response.ok&&answer?.success===true&&answer.result!==undefined,'proxy_cloudflare','Cloudflare refused the connection. Check the token’s zone and Worker permissions.',502)
 return answer.result as T
}
async function verified(env:Env,actor:Actor,input:CloudflareConnect):Promise<ConnectionRow> {
 const connection=await managedConnection(env,actor,input)
 insist(connection.mode==='worker','proxy_mode','Use a same-Worker connection for Cloudflare routing.')
 insist(typeof input.token==='string'&&input.token.length>0&&input.token.length<=2048&&!/\s/.test(input.token),'proxy_cloudflare_token','Provide a transient Cloudflare API token.')
 insist(/^[a-f0-9]{32}$/.test(input.accountId)&&/^[a-f0-9]{32}$/.test(input.zoneId),'proxy_cloudflare_id','Provide the Cloudflare account and zone IDs.')
 insist(input.workerName===INSTALLATION_WORKER_NAME,'proxy_cloudflare_worker','Select this installation’s existing Vane Worker.')
 const [zone,settings]=await Promise.all([
  provider<Zone>(input.token,`/zones/${input.zoneId}`),
  provider<Settings>(input.token,`/accounts/${input.accountId}/workers/scripts/${input.workerName}/settings`),
 ])
 insist(zone.id===input.zoneId&&zone.account?.id===input.accountId&&zone.status==='active'&&typeof zone.name==='string'&&(connection.hostname===zone.name||connection.hostname.endsWith('.'+zone.name)),'proxy_cloudflare_zone','The active zone must contain this hostname and belong to the Worker’s Cloudflare account.',403)
 // The existing script must actually serve this installation, not just share its name.
 insist(settings.bindings?.some(b=>b.type==='plain_text'&&b.name==='AUTH_ORIGIN'&&b.text===env.AUTH_ORIGIN),'proxy_cloudflare_worker','The selected Worker does not belong to this Vane installation.',403)
 return connection
}
function matchesHost(pattern:string,hostname:string):boolean {
 const escaped=pattern.replace(/[.+?^${}()|[\]\\]/g,'\\$&').replace(/\*/g,'.*')
 return new RegExp('^'+escaped+'$','i').test(hostname)
}
function overlaps(route:Route,hostname:string,prefix:string):boolean {
 const pattern=route.pattern.replace(/^https?:\/\//,''),slash=pattern.indexOf('/'),host=slash<0?pattern:pattern.slice(0,slash),path=slash<0?'/*':pattern.slice(slash)
 if(!matchesHost(host,hostname))return false
 const fixed=path.split('*')[0]!,wanted=prefix+'/'
 return fixed.startsWith(wanted)||wanted.startsWith(fixed)
}
async function record(env:Env,actor:Actor,input:CloudflareConnect,resourceId:string,kind:ProxyProvider['kind']):Promise<ProxyConnection> {
 const found=await managedConnection(env,actor,input),provider:ProxyProvider={kind,resourceId,accountId:input.accountId,zoneId:input.zoneId,workerName:input.workerName,connectedBy:actor.id,connectedAt:clock()}
 await atomic(env,actor,[
  statement(env,'UPDATE vane_proxy_connections SET provider_json=? WHERE id=? AND site_id=? AND revoked_at IS NULL',JSON.stringify(provider),found.id,found.site_id),
  auditStatement(env,actor.id,'proxy.cloudflare.'+kind,found.site_id,`Connection ${found.id}; provider resource ${resourceId}`),
 ])
 return publicConnection({...found,provider_json:JSON.stringify(provider)})
}

/** This explicit owner action alone authorizes a narrow route; no setup, preview
 * or public collector invokes provider writes. Existing routes are never edited. */
export async function connectCloudflareRoute(env:Env,actor:Actor,input:CloudflareConnect):Promise<ProxyConnection> {
 const connection=await verified(env,actor,input),pattern=connection.hostname+connection.public_prefix+'/*'
 const routes=await provider<Route[]>(input.token,`/zones/${input.zoneId}/workers/routes`)
 insist(Array.isArray(routes)&&routes.every(r=>typeof r.pattern==='string'),'proxy_cloudflare','Cloudflare returned invalid route configuration.',502)
 const exact=routes.find(r=>r.pattern===pattern&&r.script===input.workerName)
 insist(routes.every(r=>r===exact||!overlaps(r,connection.hostname,connection.public_prefix)),'proxy_cloudflare_collision','An existing Cloudflare route overlaps this hostname and path. Choose another path; existing routes were left unchanged.',409)
 if(exact)return record(env,actor,input,exact.id,'route')
 // Recheck active owner and connection after network reads, before the sole mutation.
 await managedConnection(env,actor,input)
 const created=await provider<Route>(input.token,`/zones/${input.zoneId}/workers/routes`,'POST',{pattern,script:input.workerName})
 insist(typeof created.id==='string'&&created.pattern===pattern&&created.script===input.workerName,'proxy_cloudflare','Cloudflare did not confirm the requested route.',502)
 return record(env,actor,input,created.id,'route')
}

/** Explicitly attach a dedicated collection subdomain. The app and auth routes
 * remain inaccessible on this hostname because resolveProxy consumes all of it. */
export async function connectCloudflareDomain(env:Env,actor:Actor,input:CloudflareConnect):Promise<ProxyConnection> {
 const connection=await verified(env,actor,input),value=await ownerSite(env,actor,input.siteId)
 insist(connection.hostname!==new URL(value.origin).hostname&&connection.hostname!==new URL(connection.site_origin).hostname,'proxy_cloudflare_domain','Use a dedicated collection subdomain, separate from the website.')
 const domains=await provider<Domain[]>(input.token,`/accounts/${input.accountId}/workers/domains?hostname=${encodeURIComponent(connection.hostname)}`)
 insist(Array.isArray(domains),'proxy_cloudflare','Cloudflare returned invalid domain configuration.',502)
 const existing=domains.find(d=>d.hostname===connection.hostname)
 if(existing){
  insist(existing.service===input.workerName&&existing.zone_id===input.zoneId&&existing.enabled!==false,'proxy_cloudflare_collision','The collection hostname is already attached to a different Worker or zone. It was left unchanged.',409)
  return record(env,actor,input,existing.id,'domain')
 }
 // Attaching a custom domain may create DNS records. Do not replace an existing website.
 const records=await provider<unknown[]>(input.token,`/zones/${input.zoneId}/dns_records?name=${encodeURIComponent(connection.hostname)}`)
 insist(Array.isArray(records)&&records.length===0,'proxy_cloudflare_collision','This hostname already has DNS records. Choose an unused collection subdomain; the records were left unchanged.',409)
 const routes=await provider<Route[]>(input.token,`/zones/${input.zoneId}/workers/routes`)
 insist(Array.isArray(routes)&&routes.every(r=>typeof r.pattern==='string'&&!overlaps(r,connection.hostname,'')),'proxy_cloudflare_collision','An existing Worker route owns this hostname. Choose an unused collection subdomain.',409)
 await managedConnection(env,actor,input)
 const created=await provider<Domain>(input.token,`/accounts/${input.accountId}/workers/domains`,'PUT',{hostname:connection.hostname,service:input.workerName,environment:'production',zone_id:input.zoneId})
 insist(typeof created.id==='string'&&created.hostname===connection.hostname&&created.service===input.workerName&&created.zone_id===input.zoneId,'proxy_cloudflare','Cloudflare did not confirm the requested collection domain.',502)
 return record(env,actor,input,created.id,'domain')
}

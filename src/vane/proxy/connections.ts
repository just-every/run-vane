import { atomic, digest, inScope, insist, role, rows, site, statement, uid, type Actor, type Env } from '../core'
import { auditStatement } from '../audit'
import { clock } from '../clock'
import type { ConnectionRow, CreateProxyConnection, ProxyConnection, ProxyIdentity } from './types'

const columns='id,site_id,mode,hostname,site_origin,public_prefix,created_by,created_at,rotated_at,revoked_at,provider_json'
type PublicRow=Omit<ConnectionRow,'credential_hash'>
export const publicConnection=(r:PublicRow):ProxyConnection=>({
 id:r.id,siteId:r.site_id,mode:r.mode,hostname:r.hostname,siteOrigin:r.site_origin,publicPrefix:r.public_prefix,
 createdBy:r.created_by,createdAt:r.created_at,rotatedAt:r.rotated_at,revokedAt:r.revoked_at,
 provider:r.provider_json?JSON.parse(r.provider_json):null,
})

export async function ownerSite(env:Env,actor:Actor,siteId:string) {
 role(actor);inScope(actor,siteId)
 const active=await env.DB.prepare("SELECT id FROM oa_operators WHERE id=? AND role='owner' AND status='active'").bind(actor.id).first()
 insist(active,'forbidden','This action requires the active owner.',403)
 return site(env,siteId)
}
export async function managedConnection(env:Env,actor:Actor,input:ProxyIdentity):Promise<ConnectionRow> {
 await ownerSite(env,actor,input.siteId)
 const found=await env.DB.prepare('SELECT * FROM vane_proxy_connections WHERE id=? AND site_id=? AND revoked_at IS NULL').bind(input.connectionId,input.siteId).first<ConnectionRow>()
 insist(found,'proxy_connection','This proxy connection is not active for the site.',404)
 return found
}
export function validatePrefix(value:unknown):string {
 insist(typeof value==='string'&&value.length<=100&&/^\/[a-z][a-z0-9-]*(?:\/[a-z][a-z0-9-]*){0,2}$/.test(value)&&!/^\/(?:api|auth|app|setup|signin|__dev)(?:\/|$)/.test(value),'proxy_prefix','Choose a public path such as /insights, with up to three plain path segments.')
 return value
}
export function validateHostname(value:unknown):string {
 insist(typeof value==='string'&&value===value.trim()&&value.length<=253,'proxy_hostname','Enter the public hostname without a scheme, port or path.')
 const host=value.toLowerCase()
 insist(/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)*[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(host)&&!/^\d+(?:\.\d+){3}$/.test(host),'proxy_hostname','Enter a valid public hostname without a scheme, port or path.')
 return host
}
const credential=()=> 'vane_proxy_'+Array.from(crypto.getRandomValues(new Uint8Array(32)),b=>b.toString(16).padStart(2,'0')).join('')

export async function createConnection(env:Env,actor:Actor,input:CreateProxyConnection):Promise<{connection:ProxyConnection;credential:string|null}> {
 const value=await ownerSite(env,actor,input.siteId),hostname=validateHostname(input.hostname),publicPrefix=validatePrefix(input.publicPrefix??'/insights')
 insist(input.mode==='external'||input.mode==='worker','proxy_mode','Choose a server adapter or this installation’s Cloudflare Worker.')
 const origins=[value.origin,...(value.config.origins??[])],siteOrigin=input.siteOrigin??value.origin
 insist(origins.includes(siteOrigin),'proxy_origin','Choose one of this site’s registered origins.')
 const allowedHosts=origins.map(origin=>new URL(origin).hostname.toLowerCase())
 insist(allowedHosts.some(host=>hostname===host||hostname.endsWith('.'+host)),'proxy_hostname','The proxy hostname must be a registered site hostname or one of its subdomains.')
 insist(hostname!==new URL(env.AUTH_ORIGIN).hostname.toLowerCase(),'proxy_hostname','Use the site’s domain for the public proxy, separately from the Vane installation.')
 // Overlapping prefixes would give one site ambiguous ownership of another site's public doors.
 const existing=await rows<{public_prefix:string}>(env,'SELECT public_prefix FROM vane_proxy_connections WHERE hostname=? AND revoked_at IS NULL',hostname)
 insist(existing.every(c=>!publicPrefix.startsWith(c.public_prefix+'/')&&!c.public_prefix.startsWith(publicPrefix+'/')&&publicPrefix!==c.public_prefix),'proxy_conflict','An active proxy already owns this hostname and path.',409)
 const id=uid(),now=clock(),secret=input.mode==='external'?credential():null
 await atomic(env,actor,[
  statement(env,"INSERT INTO vane_guard(value) SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM vane_proxy_connections WHERE hostname=? AND revoked_at IS NULL AND (public_prefix=? OR instr(public_prefix,?||'/')=1 OR instr(?,public_prefix||'/')=1)) THEN 1 ELSE 0 END",hostname,publicPrefix,publicPrefix,publicPrefix),
  statement(env,'INSERT INTO vane_proxy_connections(id,site_id,mode,hostname,site_origin,public_prefix,credential_hash,created_by,created_at) VALUES(?,?,?,?,?,?,?,?,?)',id,value.id,input.mode,hostname,siteOrigin,publicPrefix,secret?await digest(secret):null,actor.id,now),
  auditStatement(env,actor.id,'proxy.create',value.id,`Connection ${id}; ${input.mode} mode; server credential shown once`),
 ])
 const connection=(await listConnections(env,actor,value.id)).find(c=>c.id===id)!
 return {connection,credential:secret}
}
export async function listConnections(env:Env,actor:Actor,siteId:string):Promise<ProxyConnection[]> {
 await ownerSite(env,actor,siteId)
 return (await rows<PublicRow>(env,`SELECT ${columns} FROM vane_proxy_connections WHERE site_id=? ORDER BY created_at DESC,id`,siteId)).map(publicConnection)
}
export async function rotateConnection(env:Env,actor:Actor,input:ProxyIdentity):Promise<{connection:ProxyConnection;credential:string}> {
 const found=await managedConnection(env,actor,input)
 insist(found.mode==='external','proxy_mode','Only external server adapters use a server credential.')
 const secret=credential(),now=clock()
 await atomic(env,actor,[
  statement(env,'UPDATE vane_proxy_connections SET credential_hash=?,rotated_at=? WHERE id=? AND site_id=? AND revoked_at IS NULL',await digest(secret),now,found.id,found.site_id),
  auditStatement(env,actor.id,'proxy.rotate',found.site_id,`Connection ${found.id}; previous credential invalidated`),
 ])
 return {connection:publicConnection({...found,rotated_at:now}),credential:secret}
}
export async function revokeConnection(env:Env,actor:Actor,input:ProxyIdentity):Promise<void> {
 const found=await managedConnection(env,actor,input)
 await atomic(env,actor,[
  statement(env,'UPDATE vane_proxy_connections SET revoked_at=? WHERE id=? AND site_id=? AND revoked_at IS NULL',clock(),found.id,found.site_id),
  auditStatement(env,actor.id,'proxy.revoke',found.site_id,`Connection ${found.id}; ingress disabled`),
 ])
}

import type { Session } from '../../modules/operator-auth/index.mjs'
import { digest, insist, rows, statement, uid, type Env } from '../core'

/** Exact server-configured issuers, never a caller-supplied federation origin. */
export function configuredScimIssuers(env:Env):string[] {
 const providers=env.VANE_OIDC_PROVIDERS?JSON.parse(env.VANE_OIDC_PROVIDERS):[]
 const issuers:string[]=providers.map((p:{preset:string;issuer?:string;tenant?:string})=>p.preset==='google'?'https://accounts.google.com':p.preset==='microsoft'?`https://login.microsoftonline.com/${p.tenant}/v2.0`:p.issuer).filter((v:unknown):v is string=>typeof v==='string')
 if(env.VANE_SAML_CONFIG)issuers.push(JSON.parse(env.VANE_SAML_CONFIG).issuer)
 return [...new Set(issuers)].filter(value=>{try{const url=new URL(value);return url.protocol==='https:'&&!url.username&&!url.password&&!url.search&&!url.hash}catch{return false}})
}
export async function listScimCredentials(env:Env) {
 const credentials=await rows<{issuer:string;created_at:number;revoked_at:number|null}>(env,'SELECT issuer,created_at,revoked_at FROM vane_scim_credentials')
 return configuredScimIssuers(env).map(issuer=>{const found=credentials.find(c=>c.issuer===issuer);return {issuer,active:!!found&&found.revoked_at===null,createdAt:found?.created_at??null}})
}
function issuerOf(env:Env,input:{issuer?:unknown}) {
 insist(typeof input.issuer==='string'&&configuredScimIssuers(env).includes(input.issuer),'scim_issuer','Choose a configured identity provider issuer.')
 return input.issuer
}
function ownerGuard(env:Env,session:Session,now:number) {
 insist(session.operator.role==='owner','forbidden','Only the owner manages SCIM credentials.',403)
 return [statement(env,'DELETE FROM vane_guard'),statement(env,`INSERT INTO vane_guard(value) SELECT CASE WHEN EXISTS(
 SELECT 1 FROM oa_sessions s JOIN oa_operators o ON o.id=s.operator_id WHERE s.id=? AND o.id=?
 AND o.role='owner' AND o.status='active' AND s.operator_version=o.version AND s.revoked_at IS NULL AND s.expires_at>?
 ) THEN 1 ELSE 0 END`,session.id,session.operator.id,now)]
}
/** Return the bearer once. Reissuing atomically rotates this issuer's authority. */
export async function issueScimCredential(env:Env,session:Session,input:{issuer?:unknown}) {
 insist(session.operator.role==='owner','forbidden','Only the owner manages SCIM credentials.',403)
 const issuer=issuerOf(env,input),now=Date.now(),credential='vane_scim_'+Array.from(crypto.getRandomValues(new Uint8Array(32)),b=>b.toString(16).padStart(2,'0')).join('')
 const hash=await digest('vane:scim:v1\0'+credential)
 await env.DB.batch([...ownerGuard(env,session,now),
  statement(env,`INSERT INTO vane_audit(id,at,actor,action,subject,detail) VALUES(?,?,?,
 CASE WHEN EXISTS(SELECT 1 FROM vane_scim_credentials WHERE issuer=? AND revoked_at IS NULL) THEN 'security.scim.rotate' ELSE 'security.scim.issue' END,?,'SCIM-only credential; shown once')`,uid(),now,session.operator.id,issuer,issuer),
  statement(env,`INSERT INTO vane_scim_credentials(issuer,token_hash,created_by,created_at,revoked_at) VALUES(?,?,?,?,NULL)
 ON CONFLICT(issuer) DO UPDATE SET token_hash=excluded.token_hash,created_by=excluded.created_by,created_at=excluded.created_at,revoked_at=NULL`,issuer,hash,session.operator.id,now),
  statement(env,'DELETE FROM vane_guard'),
 ])
 return {credential,issuer}
}
export async function revokeScimCredential(env:Env,session:Session,input:{issuer?:unknown}) {
 insist(session.operator.role==='owner','forbidden','Only the owner manages SCIM credentials.',403)
 const issuer=issuerOf(env,input),now=Date.now()
 await env.DB.batch([...ownerGuard(env,session,now),
  statement(env,"INSERT INTO vane_audit(id,at,actor,action,subject,detail) SELECT ?,?,?,'security.scim.revoke',?,'SCIM credential revoked' WHERE EXISTS(SELECT 1 FROM vane_scim_credentials WHERE issuer=? AND revoked_at IS NULL)",uid(),now,session.operator.id,issuer,issuer),
  statement(env,'UPDATE vane_scim_credentials SET revoked_at=? WHERE issuer=? AND revoked_at IS NULL',now,issuer),
  statement(env,'DELETE FROM vane_guard'),
 ])
 return {issuer}
}
export async function scimAuthority(request:Request,env:Env):Promise<{issuer:string;hash:string}|null> {
 const token=/^Bearer (vane_scim_[0-9a-f]{64})$/i.exec(request.headers.get('authorization')??'')?.[1]
 if(!token)return null
 const hash=await digest('vane:scim:v1\0'+token)
 const credential=(await rows<{issuer:string}>(env,'SELECT issuer FROM vane_scim_credentials WHERE token_hash=? AND revoked_at IS NULL',hash))[0]
 return credential&&configuredScimIssuers(env).includes(credential.issuer)?{issuer:credential.issuer,hash}:null
}

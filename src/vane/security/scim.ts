import { normalizeEmail } from '../../modules/operator-auth/index.mjs'
import { rows, statement, uid, type Env } from '../core'
import { scimAuthority } from './scim-credentials'

const USER='urn:ietf:params:scim:schemas:core:2.0:User',PATCH='urn:ietf:params:scim:api:messages:2.0:PatchOp',ERROR='urn:ietf:params:scim:api:messages:2.0:Error'
const LIMIT=64*1024
type Person={id:string;email:string;role:string;status:string;external_id:string;deactivated_at:number|null}
class Rejected extends Error {constructor(public status:number){super('SCIM request rejected.')}}
function reject(status=400):never{throw new Rejected(status)}
const json=(value:unknown,status=200,extra:Record<string,string>={})=>new Response(JSON.stringify(value),{status,headers:{'Content-Type':'application/scim+json','Cache-Control':'no-store','X-Content-Type-Options':'nosniff',...extra}})
const record=(value:unknown):value is Record<string,unknown>=>!!value&&typeof value==='object'&&!Array.isArray(value)
function exact(value:Record<string,unknown>,allowed:string[]) {if(Object.keys(value).some(k=>!allowed.includes(k)))reject()}
function schema(value:unknown,want:string) {if(!Array.isArray(value)||value.length!==1||value[0]!==want)reject()}
function resource(person:Person,origin:string) {return {schemas:[USER],id:person.id,userName:person.email,active:person.status==='active'&&person.deactivated_at===null,...(person.external_id?{externalId:person.external_id}:{}),meta:{resourceType:'User',location:origin+'/scim/v2/Users/'+encodeURIComponent(person.id)}}}
async function read(request:Request) {
 if(!/^application\/(?:scim\+)?json(?:\s*;|$)/i.test(request.headers.get('content-type')??''))reject(415)
 if(Number(request.headers.get('content-length')??0)>LIMIT)reject(413)
 const reader=request.body?.getReader();if(!reader)reject()
 let size=0;const parts:Uint8Array[]=[]
 try {for(;;){const next=await reader.read();if(next.done)break;size+=next.value.byteLength;if(size>LIMIT)reject(413);parts.push(next.value)}}finally{await reader.cancel()}
 const bytes=new Uint8Array(size);let offset=0;for(const part of parts){bytes.set(part,offset);offset+=part.length}
 let value:unknown;try{value=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes))}catch{reject()}
 if(!record(value))reject();return value
}
type Authority={issuer:string;hash:string}
function credentialGuard(env:Env,authority:Authority) {
 return [statement(env,'DELETE FROM vane_guard'),statement(env,`INSERT INTO vane_guard(value) SELECT CASE WHEN EXISTS(SELECT 1 FROM vane_scim_credentials WHERE issuer=? AND token_hash=? AND revoked_at IS NULL) THEN 1 ELSE 0 END`,authority.issuer,authority.hash)]
}
async function byId(env:Env,issuer:string,id:string) {
 if(!id||id.length>255)reject(404)
 return (await rows<Person>(env,"SELECT o.id,o.email,o.role,o.status,s.external_id,s.deactivated_at FROM vane_scim_users s JOIN oa_operators o ON o.id=s.operator_id WHERE o.id=? AND s.issuer=? AND o.role!='owner'",id,issuer))[0]
}
async function bySubject(env:Env,issuer:string,subject:string) {
 return (await rows<Person>(env,"SELECT o.id,o.email,o.role,o.status,s.external_id,s.deactivated_at FROM vane_scim_users s JOIN oa_operators o ON o.id=s.operator_id WHERE s.issuer=? AND s.external_id=? AND o.role!='owner'",issuer,subject))[0]
}
async function deactivate(env:Env,authority:Authority,person:Person) {
 const now=Date.now(),transition=uid(),guard="EXISTS(SELECT 1 FROM vane_scim_users s JOIN oa_operators o ON o.id=s.operator_id WHERE o.id=? AND o.role!='owner' AND s.transition_id=?)"
 await env.DB.batch([...credentialGuard(env,authority),
  statement(env,`UPDATE vane_scim_users SET deactivated_at=?,transition_id=? WHERE operator_id=? AND issuer=? AND deactivated_at IS NULL AND EXISTS(SELECT 1 FROM oa_operators WHERE id=? AND role!='owner')`,now,transition,person.id,authority.issuer,person.id),
  statement(env,`UPDATE oa_operators SET status='inactive' WHERE id=? AND role!='owner' AND status!='inactive' AND ${guard}`,person.id,person.id,transition),
  statement(env,`UPDATE oa_sessions SET revoked_at=? WHERE operator_id=? AND revoked_at IS NULL AND ${guard}`,now,person.id,person.id,transition),
  statement(env,`UPDATE oa_tokens SET revoked_at=? WHERE (operator_id=? OR issuer_id=?) AND revoked_at IS NULL AND ${guard}`,now,person.id,person.id,person.id,transition),
  statement(env,`UPDATE oa_credentials SET revoked_at=? WHERE operator_id=? AND revoked_at IS NULL AND ${guard}`,now,person.id,person.id,transition),
  statement(env,`UPDATE oa_step_up_challenges SET expires_at=0 WHERE operator_id=? AND expires_at!=0 AND ${guard}`,person.id,person.id,transition),
  statement(env,`UPDATE vane_api_keys SET revoked_at=? WHERE created_by=? AND revoked_at IS NULL AND ${guard}`,now,person.id,person.id,transition),
  statement(env,`DELETE FROM vane_push_subscriptions WHERE operator_id=? AND ${guard}`,person.id,person.id,transition),
  statement(env,`INSERT INTO vane_audit(id,at,actor,action,subject,detail) SELECT ?,?,'scim','team.scim.deactivate',?,'access ended' WHERE ${guard}`,uid(),now,person.id,person.id,transition),
  statement(env,'DELETE FROM vane_guard'),
 ])
 const current=await byId(env,authority.issuer,person.id);if(!current)reject(409)
 return current
}
/** SCIM creates zero-site viewers; only the native owner can grant analytics access. */
export async function scimResponse(request:Request,env:Env):Promise<Response|null> {
 const url=new URL(request.url)
 if(url.pathname!=='/scim/v2'&&!url.pathname.startsWith('/scim/v2/'))return null
 try {
  const authority=await scimAuthority(request,env);if(!authority)reject(401)
  const origin=new URL(env.AUTH_ORIGIN).origin
  if(url.origin!==origin||request.headers.get('host')&&request.headers.get('host')!.toLowerCase()!==url.host.toLowerCase())reject(400)
  if(url.pathname==='/scim/v2/ServiceProviderConfig') {
   if(request.method!=='GET'||url.search)reject(405)
   return json({schemas:['urn:ietf:params:scim:schemas:core:2.0:ServiceProviderConfig'],patch:{supported:true},bulk:{supported:false,maxOperations:0,maxPayloadSize:0},filter:{supported:true,maxResults:1},changePassword:{supported:false},sort:{supported:false},etag:{supported:false},authenticationSchemes:[{type:'oauthbearertoken',name:'Bearer token',description:'Installation-owned SCIM credential',primary:true}]})
  }
  const match=/^\/scim\/v2\/Users(?:\/([^/]+))?$/.exec(url.pathname)
  if(!match)reject(404)
  let id:string|null=null;try{id=match[1]?decodeURIComponent(match[1]):null}catch{reject()}
  if(request.method==='GET') {
   if(id){if(url.search)reject();const person=await byId(env,authority.issuer,id);if(!person)reject(404);return json(resource(person,origin))}
   if([...url.searchParams.keys()].some(key=>key!=='filter')||url.searchParams.getAll('filter').length!==1)reject()
   const filter=/^userName eq "([^"\\\x00-\x1f]{1,254})"$/.exec(url.searchParams.get('filter')??'');if(!filter)reject()
   const person=(await rows<Person>(env,"SELECT o.id,o.email,o.role,o.status,s.external_id,s.deactivated_at FROM vane_scim_users s JOIN oa_operators o ON o.id=s.operator_id WHERE o.email=? AND s.issuer=? AND o.role!='owner'",filter[1]!.toLowerCase(),authority.issuer))[0]
   const resources=person?[resource(person,origin)]:[]
   return json({schemas:['urn:ietf:params:scim:api:messages:2.0:ListResponse'],totalResults:resources.length,startIndex:1,itemsPerPage:resources.length,Resources:resources})
  }
  if(url.search)reject()
  if(request.method==='POST'&&!id) {
   const input=await read(request);exact(input,['schemas','userName','externalId','active']);schema(input.schemas,USER)
   if(typeof input.userName!=='string'||input.userName.length>254||input.active!==undefined&&input.active!==true||typeof input.externalId!=='string'||!input.externalId||input.externalId.length>255||/[\x00-\x1f\x7f]/.test(input.externalId))reject()
   let email:string;try{email=normalizeEmail(input.userName)}catch{reject()}
   const existing=await bySubject(env,authority.issuer,input.externalId)
   if(existing){if(existing.email!==email)reject(409);return json(resource(existing,origin))}
   const now=Date.now(),id=uid(),subject=input.externalId
   const made=await env.DB.batch([...credentialGuard(env,authority),
    statement(env,`INSERT INTO oa_operators(id,email,display_name,role,status,created_at) SELECT ?,?,?,'member','active',?
 WHERE EXISTS(SELECT 1 FROM oa_operators WHERE role='owner' AND status='active')
 AND NOT EXISTS(SELECT 1 FROM vane_scim_users WHERE issuer=? AND external_id=?)
 AND NOT EXISTS(SELECT 1 FROM oa_external_identities WHERE issuer=? AND subject=?)
 ON CONFLICT(email) DO NOTHING RETURNING id`,id,email,email.split('@')[0],now,authority.issuer,subject,authority.issuer,subject),
    statement(env,`INSERT INTO vane_grants(operator_id,role,site_ids,granted_by,granted_at) SELECT id,'viewer','[]','scim',? FROM oa_operators WHERE id=?`,now,id),
    statement(env,`INSERT INTO vane_scim_users(operator_id,issuer,external_id,created_at) SELECT id,?,?,? FROM oa_operators WHERE id=?`,authority.issuer,subject,now,id),
    statement(env,`INSERT INTO oa_external_identities(issuer,subject,operator_id) SELECT ?,?,id FROM oa_operators WHERE id=?`,authority.issuer,subject,id),
    statement(env,"INSERT INTO vane_audit(id,at,actor,action,subject,detail) SELECT ?,?,'scim','team.scim.provision',?,'Viewer created with no sites; owner grant required' WHERE EXISTS(SELECT 1 FROM vane_scim_users WHERE operator_id=?)",uid(),now,id,id),
    statement(env,'DELETE FROM vane_guard'),
   ])
   // Concurrent identical creates converge on the original immutable binding.
   const created=await bySubject(env,authority.issuer,subject);if(!created||created.email!==email)reject(409)
   return made[2]?.results.length?json(resource(created,origin),201,{Location:origin+'/scim/v2/Users/'+encodeURIComponent(created.id)}):json(resource(created,origin))
  }
  if(!id)reject(405)
  const person=await byId(env,authority.issuer,id);if(!person)reject(404)
  if(request.method==='DELETE') {
   if(Number(request.headers.get('content-length')??0)>0||request.body)reject()
   await deactivate(env,authority,person);return new Response(null,{status:204,headers:{'Cache-Control':'no-store'}})
  }
  if(request.method==='PATCH') {
   const input=await read(request);exact(input,['schemas','Operations']);schema(input.schemas,PATCH)
   if(!Array.isArray(input.Operations)||!input.Operations.length)reject()
   for(const operation of input.Operations) {
    if(!record(operation))reject();exact(operation,['op','path','value'])
    if(typeof operation.op!=='string'||operation.op.toLowerCase()!=='replace')reject()
    if(operation.path==='active'){if(operation.value!==false)reject()}
    else {if(operation.path!==undefined||!record(operation.value))reject();exact(operation.value,['active']);if(operation.value.active!==false)reject()}
   }
   return json(resource(await deactivate(env,authority,person),origin))
  }
  reject(405)
 }catch(error){const status=error instanceof Rejected?error.status:500;return json({schemas:[ERROR],status:String(status),detail:'SCIM request rejected.'},status,status===401?{'WWW-Authenticate':'Bearer'}:{})}
}

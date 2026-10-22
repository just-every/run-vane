import { createHmac, timingSafeEqual } from 'node:crypto'
import { rows, statement, uid, type Env } from '../core'

const USER='urn:ietf:params:scim:schemas:core:2.0:User',PATCH='urn:ietf:params:scim:api:messages:2.0:PatchOp',ERROR='urn:ietf:params:scim:api:messages:2.0:Error'
const LIMIT=64*1024
type Person={id:string;email:string;role:string;status:string;external_id?:string|null}
class Rejected extends Error {constructor(public status:number){super('SCIM request rejected.')}}
function reject(status=400):never{throw new Rejected(status)}
const json=(value:unknown,status=200,extra:Record<string,string>={})=>new Response(JSON.stringify(value),{status,headers:{'Content-Type':'application/scim+json','Cache-Control':'no-store','X-Content-Type-Options':'nosniff',...extra}})
const record=(value:unknown):value is Record<string,unknown>=>!!value&&typeof value==='object'&&!Array.isArray(value)
function exact(value:Record<string,unknown>,allowed:string[]) {if(Object.keys(value).some(k=>!allowed.includes(k)))reject()}
function schema(value:unknown,want:string) {if(!Array.isArray(value)||value.length!==1||value[0]!==want)reject()}
function resource(person:Person,origin:string) {return {schemas:[USER],id:person.id,userName:person.email,active:person.status==='active',...(person.external_id?{externalId:person.external_id}:{}),meta:{resourceType:'User',location:origin+'/scim/v2/Users/'+encodeURIComponent(person.id)}}}
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
function authorized(request:Request,env:Env & {VANE_SCIM_TOKEN?:string}) {
 const credential=env.VANE_SCIM_TOKEN,match=/^Bearer ([\x21-\x7e]{1,2048})$/i.exec(request.headers.get('authorization')??'')
 if(!credential||!env.SESSION_SECRET||!match||credential.length>2048)reject(401)
 // A domain-separated fixed-length MAC makes every token comparison constant
 // time, including differing input lengths. Neither bearer is ever persisted.
 const mac=(value:string)=>createHmac('sha256',env.SESSION_SECRET).update('vane:scim:bearer:v1\0').update(value).digest()
 if(!timingSafeEqual(mac(credential),mac(match[1]!)))reject(401)
}
async function byId(env:Env,id:string) {
 if(!id||id.length>255)reject(404)
 return (await rows<Person>(env,"SELECT o.id,o.email,o.role,o.status,s.external_id FROM oa_operators o LEFT JOIN vane_scim_users s ON s.operator_id=o.id WHERE o.id=? AND o.role!='owner'",id))[0]
}
async function deactivate(env:Env,person:Person) {
 const now=Date.now(),guard="EXISTS(SELECT 1 FROM oa_operators WHERE id=? AND role!='owner' AND status='inactive')"
 await env.DB.batch([
  statement(env,"UPDATE oa_operators SET status='inactive' WHERE id=? AND role!='owner' AND status!='inactive'",person.id),
  statement(env,`UPDATE oa_sessions SET revoked_at=COALESCE(revoked_at,?) WHERE operator_id=? AND ${guard}`,now,person.id,person.id),
  statement(env,`UPDATE oa_tokens SET revoked_at=COALESCE(revoked_at,?) WHERE (operator_id=? OR issuer_id=?) AND ${guard}`,now,person.id,person.id,person.id),
  statement(env,`UPDATE oa_credentials SET revoked_at=COALESCE(revoked_at,?) WHERE operator_id=? AND ${guard}`,now,person.id,person.id),
  statement(env,`UPDATE oa_step_up_challenges SET expires_at=0 WHERE operator_id=? AND ${guard}`,person.id,person.id),
  statement(env,`UPDATE vane_api_keys SET revoked_at=COALESCE(revoked_at,?) WHERE created_by=? AND ${guard}`,now,person.id,person.id),
  statement(env,`DELETE FROM vane_push_subscriptions WHERE operator_id=? AND ${guard}`,person.id,person.id),
  statement(env,`INSERT INTO vane_audit(id,at,actor,action,subject,detail) SELECT ?,?,'scim','team.scim.deactivate',?,'access ended' WHERE ${guard}`,uid(),now,person.id,person.id),
 ])
 const current=await byId(env,person.id);if(!current||current.status!=='inactive')reject(409)
 return current
}
/** Narrow SCIM: exact lookup, owner-preauthorized invitation association, and deprovisioning. */
export async function scimResponse(request:Request,env:Env & {VANE_SCIM_TOKEN?:string}):Promise<Response|null> {
 const url=new URL(request.url)
 if(url.pathname!=='/scim/v2'&&!url.pathname.startsWith('/scim/v2/'))return null
 try {
  authorized(request,env)
  const origin=new URL(env.AUTH_ORIGIN).origin
  if(url.origin!==origin||request.headers.get('host')&&request.headers.get('host')!.toLowerCase()!==url.host.toLowerCase())reject(400)
  if(url.pathname==='/scim/v2/ServiceProviderConfig') {
   if(request.method!=='GET'||url.search)reject(405)
   return json({schemas:['urn:ietf:params:scim:schemas:core:2.0:ServiceProviderConfig'],patch:{supported:true},bulk:{supported:false,maxOperations:0,maxPayloadSize:0},filter:{supported:true,maxResults:1},changePassword:{supported:false},sort:{supported:false},etag:{supported:false},authenticationSchemes:[{type:'oauthbearertoken',name:'Bearer token',description:'Installation-owned SCIM credential',primary:true}]})
  }
  const match=/^\/scim\/v2\/Users(?:\/([^/]+))?$/.exec(url.pathname)
  if(!match)reject(404)
  const id=match[1]?decodeURIComponent(match[1]):null
  if(request.method==='GET') {
   if(id){if(url.search)reject();const person=await byId(env,id);if(!person)reject(404);return json(resource(person,origin))}
   if([...url.searchParams.keys()].some(key=>key!=='filter')||url.searchParams.getAll('filter').length!==1)reject()
   const filter=/^userName eq "([^"\\\x00-\x1f]{1,254})"$/.exec(url.searchParams.get('filter')??'');if(!filter)reject()
   const person=(await rows<Person>(env,"SELECT o.id,o.email,o.role,o.status,s.external_id FROM oa_operators o LEFT JOIN vane_scim_users s ON s.operator_id=o.id WHERE o.email=? AND o.role!='owner'",filter[1]!.toLowerCase()))[0]
   const resources=person?[resource(person,origin)]:[]
   return json({schemas:['urn:ietf:params:scim:api:messages:2.0:ListResponse'],totalResults:resources.length,startIndex:1,itemsPerPage:resources.length,Resources:resources})
  }
  if(url.search)reject()
  if(request.method==='POST'&&!id) {
   const input=await read(request);exact(input,['schemas','id','userName','externalId','active']);schema(input.schemas,USER)
   if(typeof input.userName!=='string'||input.userName.length>254||input.active!==undefined&&input.active!==true||input.id!==undefined&&typeof input.id!=='string'||input.externalId!==undefined&&(typeof input.externalId!=='string'||!input.externalId||input.externalId.length>255))reject()
   const email=input.userName.trim().toLowerCase(),now=Date.now()
   const person=(await rows<Person>(env,"SELECT id,email,role,status FROM oa_operators WHERE email=? AND role!='owner' AND status='invited'",email))[0]
   if(!person||input.id!==undefined&&input.id!==person.id)reject(409)
   // Association witnesses an existing, live owner-issued invitation. SCIM
   // cannot activate it: the invited person must still prove identity to Base.
   const mapped=await env.DB.batch([statement(env,`INSERT INTO vane_scim_users(operator_id,external_id,created_at)
    SELECT o.id,?,? FROM oa_operators o WHERE o.id=? AND o.role!='owner' AND o.status='invited'
    AND EXISTS(SELECT 1 FROM oa_tokens t JOIN oa_operators owner ON owner.id=t.issuer_id WHERE t.operator_id=o.id AND t.kind='invite' AND t.operator_version=o.version
     AND t.consumed_at IS NULL AND t.revoked_at IS NULL AND t.expires_at>? AND owner.status='active' AND owner.role='owner' AND owner.version=t.issuer_version
     AND NOT EXISTS(SELECT 1 FROM oa_dev_credentials d WHERE d.credential='oa_tokens' AND d.id=t.id))
    ON CONFLICT DO NOTHING RETURNING operator_id`,input.externalId??null,now,person.id,now),
    statement(env,"INSERT INTO vane_audit(id,at,actor,action,subject,detail) SELECT ?,?,'scim','team.scim.provision',?,'existing invitation associated' WHERE changes()>0",uid(),now,person.id)])
   if(!mapped[0]?.results.length)reject(409)
   return json({...resource(person,origin),...(input.externalId===undefined?{}:{externalId:input.externalId})},201,{Location:origin+'/scim/v2/Users/'+encodeURIComponent(person.id)})
  }
  if(!id)reject(405)
  const person=await byId(env,id);if(!person)reject(404)
  if(request.method==='DELETE') {
   if(Number(request.headers.get('content-length')??0)>0||request.body)reject()
   await deactivate(env,person);return new Response(null,{status:204,headers:{'Cache-Control':'no-store'}})
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
   return json(resource(await deactivate(env,person),origin))
  }
  reject(405)
 }catch(error){const status=error instanceof Rejected?error.status:500;return json({schemas:[ERROR],status:String(status),detail:'SCIM request rejected.'},status,status===401?{'WWW-Authenticate':'Bearer'}:{})}
}

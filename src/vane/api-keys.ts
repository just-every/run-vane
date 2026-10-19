import { allow, digest, inScope, insist, rows, sites, statement, uid, VaneError, type Actor, type Env } from './core'
import { auditStatement } from './audit'
import { clock } from './clock'
// API-001: keys for the Stats API and the Sites API. A stats key reads only its chosen sites; a provisioning key is the
// owner's standing approval for creating sites, goals and shared links. A key is shown once and kept only as SHA-256;
// revoking it, or removing the person who created it, refuses it at once. An events token (INSTALL-008) sends
// server-side and mobile events for its one site.
export type KeyKind = 'stats'|'provisioning'|'events'
export interface ApiKey { id:string; kind:KeyKind; label:string; site_ids:string|null; created_by:string; created_at:number; revoked_at:number|null }
// Published limits: per key, at most 30 requests in each 10-second window and 600 in each clock hour (UTC).
export const RATE_LIMITS={burst:{requests:30,seconds:10},hourly:{requests:600,seconds:3600}} as const
// INSTALL-008 (ct 13:06Z): per events token, at most 100 requests in each 10-second window and 10,000 events in each
// clock hour (UTC).
export const EVENT_LIMITS={burst:{requests:100,seconds:10},events:{events:10000,seconds:3600}} as const
const random=(bytes:number)=>Array.from(crypto.getRandomValues(new Uint8Array(bytes)),b=>b.toString(16).padStart(2,'0')).join('')
export async function createKey(env:Env,actor:Actor,input:any):Promise<string> {
 const kind=String(input.kind??'stats') as KeyKind,label=String(input.label??'').trim();
 insist(kind==='stats'||kind==='provisioning'||kind==='events','key_kind','Choose a Stats API key, an events token or a provisioning key.');
 insist(label.length>0&&label.length<=60&&!/[\u0000-\u001f\u007f<>]/.test(label),'key_label','Name the key in up to 60 characters of plain text.');
 allow(actor,kind==='provisioning'?'owner':'admin');
 let ids:string[]|null=null;
 if(kind!=='provisioning'){
  const known=(await sites(env)).map(s=>s.id);ids=[...new Set(Object.keys(input).filter(key=>key.startsWith('site_')&&input[key]==='on').map(key=>key.slice(5)))];
  insist(ids.length>0&&ids.every(id=>known.includes(id)),'sites','Choose the sites this key may read.');
  insist(kind==='stats'||ids.length===1,'sites','An events token sends events for exactly one site.');
  for(const id of ids)inScope(actor,id);
 }
 const id=uid(),token=({stats:'vane_k_',events:'vane_e_',provisioning:'vane_p_'} as const)[kind]+random(32);
 await env.DB.batch([statement(env,'INSERT INTO vane_api_keys(id,kind,label,site_ids,token_hash,created_by,created_at) VALUES(?,?,?,?,?,?,?)',id,kind,label,ids?JSON.stringify(ids):null,await digest(token),actor.id,clock()),auditStatement(env,actor.id,'apikey.create',id,`${kind} key ${label}${ids?` for ${ids.length} site${ids.length===1?'':'s'}`:''}`)]);
 return token;
}
export async function revokeKey(env:Env,actor:Actor,id:string) {
 allow(actor,'admin');
 const found=(await rows<ApiKey>(env,'SELECT * FROM vane_api_keys WHERE id=? AND revoked_at IS NULL',id))[0];insist(found,'key','This key no longer exists or is already revoked.',404);
 if(found.kind==='provisioning')allow(actor,'owner');else for(const site of JSON.parse(found.site_ids!) as string[])inScope(actor,site);
 await env.DB.batch([statement(env,'UPDATE vane_api_keys SET revoked_at=? WHERE id=? AND revoked_at IS NULL',clock(),id),auditStatement(env,actor.id,'apikey.revoke',id,`${found.kind} key ${found.label}`)]);
}
export async function apiKeys(env:Env,actor:Actor) {
 allow(actor,'admin');
 const list=await rows<ApiKey&{creator:string,today:number|null}>(env,"SELECT k.*,COALESCE(o.display_name,k.created_by) AS creator,(SELECT count FROM vane_api_usage u WHERE u.key_id=k.id AND u.scope='d' AND u.window=?) AS today FROM vane_api_keys k LEFT JOIN oa_operators o ON o.id=k.created_by ORDER BY k.created_at DESC",Math.floor(clock()/86400000));
 return list.filter(k=>actor.access==='owner'||k.kind!=='provisioning'&&(JSON.parse(k.site_ids!) as string[]).every(id=>!actor.sites||actor.sites.includes(id)));
}
export class ApiRefusal extends VaneError { constructor(code:string,message:string,status:number,public retryAfter?:number) { super(code,message,status) } }
// The bearer key of a request, which must be live, of the kind asked and created by a person still active; then one
// request is counted against both windows, and a request over either limit is refused with Retry-After.
export async function keyOf(env:Env,request:Request,kind:KeyKind):Promise<ApiKey> {
 const token=(request.headers.get('authorization')??'').match(/^Bearer (vane_[kpe]_[0-9a-f]{64})$/)?.[1];
 if(!token)throw new ApiRefusal('unauthorized','Send an API key as Authorization: Bearer <key>.',401);
 const found=(await rows<ApiKey>(env,"SELECT k.* FROM vane_api_keys k JOIN oa_operators o ON o.id=k.created_by AND o.status='active' WHERE k.token_hash=? AND k.revoked_at IS NULL",await digest(token)))[0];
 if(!found)throw new ApiRefusal('unauthorized','This API key is unknown or revoked.',401);
 if(found.kind!==kind)throw new ApiRefusal('forbidden',{stats:'Use a Stats API key to read statistics.',events:'Use the site’s events token to send events.',provisioning:'Use a provisioning key to create sites, goals and shared links.'}[kind],403);
 // Each request is kept only as these counts, and the UTC day's count (scope d) is the key's audit of its use.
 const limits=kind==='events'?{burst:EVENT_LIMITS.burst,hourly:{requests:Infinity,seconds:3600}}:RATE_LIMITS;
 const now=clock(),burst=Math.floor(now/(limits.burst.seconds*1000)),hour=Math.floor(now/(limits.hourly.seconds*1000)),today=Math.floor(now/86400000);
 const counted=await env.DB.batch<{count:number}>([['b',burst],['h',hour],['d',today]].map(([scope,window])=>statement(env,'INSERT INTO vane_api_usage(key_id,scope,window,count) VALUES(?,?,?,1) ON CONFLICT(key_id,scope,window) DO UPDATE SET count=count+1 RETURNING count',found.id,scope,window)));
 const [b,h]=counted.map(r=>Number(r.results[0]!.count));
 if(b!>limits.burst.requests)throw new ApiRefusal('rate_limited',`Over ${limits.burst.requests} requests in ${limits.burst.seconds} seconds.`,429,Math.ceil(((burst+1)*limits.burst.seconds*1000-now)/1000));
 if(h!>limits.hourly.requests)throw new ApiRefusal('rate_limited',`Over ${limits.hourly.requests} requests this hour.`,429,Math.ceil(((hour+1)*limits.hourly.seconds*1000-now)/1000));
 return found;
}
export function keySites(key:ApiKey,siteId:string) { if(!(JSON.parse(key.site_ids??'[]') as string[]).includes(siteId))throw new ApiRefusal('forbidden','This key does not cover that site.',403) }

import { operatorAuth } from '../../auth.server'
import { auditStatement } from '../audit'
import { clock } from '../clock'
import { digest, inScope, insist, role, site, statement, uid, type Actor, type Env } from '../core'
import { AUTH_ENDPOINT, CALLBACK_PATH, credentials, exchangeCode, listProperties, SCOPE, REVOKE_ENDPOINT, googleFetch, accessToken } from './google'
import { connection, current, readTokens, sealTokens } from './storage'

const headers={'cache-control':'no-store','referrer-policy':'no-referrer','x-content-type-options':'nosniff'}
const redirect=(url:string)=>new Response(null,{status:303,headers:{...headers,location:url}})
const settings=(env:Env,siteId:string)=>env.AUTH_ORIGIN+'/app/sites/'+encodeURIComponent(siteId)+'?section=settings'
async function nativeSession(request:Request,env:Env,actor:Actor) {
 role(actor);insist(actor.id,'forbidden','Sign in as the owner.',403);
 const session=await operatorAuth(env).getSession(request);
 insist(session&&session.operator.id===actor.id&&session.operator.role==='owner','forbidden','Use the owner’s current native sign-in session.',403);
 return digest(session.id);
}
export async function begin(request:Request,env:Env,actor:Actor,siteId:string):Promise<Response> {
 const sessionHash=await nativeSession(request,env,actor);
 insist(request.method==='POST','method','POST required.',405);
 insist(new URL(request.url).origin===env.AUTH_ORIGIN&&request.headers.get('origin')===env.AUTH_ORIGIN&&request.headers.get('sec-fetch-site')!=='cross-site','origin','Same-origin approval is required.',403);
 inScope(actor,siteId);await site(env,siteId);
 const {client_id}=credentials(env),state=Array.from(crypto.getRandomValues(new Uint8Array(32)),n=>n.toString(16).padStart(2,'0')).join(''),redirectUri=env.AUTH_ORIGIN+CALLBACK_PATH;
 await env.DB.batch([
  statement(env,'DELETE FROM vane_search_oauth_states WHERE expires_at<=? OR site_id=?',clock(),siteId),
  statement(env,'INSERT INTO vane_search_oauth_states(state_hash,site_id,actor_id,session_hash,redirect_uri,expires_at) VALUES(?,?,?,?,?,?)',await digest(state),siteId,actor.id,sessionHash,redirectUri,clock()+600000),
  auditStatement(env,actor.id,'search.connect.begin',siteId,'Owner approved a Google Search Console read-only connection')
 ]);
 const url=new URL(AUTH_ENDPOINT);url.search=new URLSearchParams({client_id,redirect_uri:redirectUri,response_type:'code',scope:SCOPE,access_type:'offline',prompt:'consent',state}).toString();
 return redirect(url.href);
}
export async function callback(request:Request,env:Env,actor:Actor):Promise<Response> {
 const sessionHash=await nativeSession(request,env,actor),url=new URL(request.url);
 insist(request.method==='GET'&&url.origin===env.AUTH_ORIGIN&&url.pathname===CALLBACK_PATH,'search_callback','Invalid Search Console callback.',400);
 const state=url.searchParams.get('state');insist(state&&/^[0-9a-f]{64}$/.test(state),'search_state','The Search Console connection has expired. Connect again.',400);
 // UPDATE RETURNING consumes exactly once before any provider call, including denied consent. The consumed
 // record remains as a fence: a disconnect or a newer begin removes it and prevents in-flight reconnection.
 const stateHash=await digest(state);
 const transaction=await env.DB.prepare('UPDATE vane_search_oauth_states SET consumed_at=? WHERE state_hash=? AND actor_id=? AND session_hash=? AND expires_at>? AND consumed_at IS NULL RETURNING site_id,redirect_uri').bind(clock(),stateHash,actor.id,sessionHash,clock()).first<{site_id:string;redirect_uri:string}>();
 insist(transaction,'search_state','The Search Console connection has expired or was already used. Connect again.',400);
 inScope(actor,transaction.site_id);await site(env,transaction.site_id);
 insist(!url.searchParams.has('error'),'search_consent','Google did not approve the read-only connection.');
 const code=url.searchParams.get('code');insist(code&&code.length<=4096,'search_code','Google did not return an authorization code.');
 const tokens=await exchangeCode(env,code,transaction.redirect_uri);
 const valid=await env.DB.prepare('SELECT 1 FROM vane_search_oauth_states WHERE state_hash=? AND expires_at>? AND consumed_at IS NOT NULL').bind(stateHash,clock()).first();
 insist(valid,'search_state','The Search Console connection was cancelled or expired. Connect again.',409);
 const properties=await listProperties(tokens.access_token),generation=uid(),now=clock();
 await env.DB.batch([
  statement(env,'INSERT INTO vane_search_connections(site_id,generation,sealed_tokens,property,properties_json,connected_by,connected_at,next_sync) SELECT ?,?,?,NULL,?,?,?,? WHERE EXISTS(SELECT 1 FROM vane_search_oauth_states WHERE state_hash=? AND expires_at>? AND consumed_at IS NOT NULL) ON CONFLICT(site_id) DO UPDATE SET generation=excluded.generation,sealed_tokens=excluded.sealed_tokens,property=NULL,properties_json=excluded.properties_json,connected_by=excluded.connected_by,connected_at=excluded.connected_at,last_sync=NULL,next_sync=excluded.next_sync,last_error=NULL,lock_id=NULL,lock_until=NULL',transaction.site_id,generation,await sealTokens(env,transaction.site_id,generation,tokens),JSON.stringify(properties),actor.id,now,now,stateHash,now),
  statement(env,'DELETE FROM vane_search_oauth_states WHERE state_hash=?',stateHash),
  auditStatement(env,actor.id,'search.connect',transaction.site_id,'Read-only OAuth completed; owner must select an allowed property')
 ]);
 insist((await connection(env,transaction.site_id))?.generation===generation,'search_state','The Search Console connection was cancelled or changed. Connect again.',409);
 return redirect(settings(env,transaction.site_id));
}
export async function selectProperty(env:Env,actor:Actor,p:{siteId:string;property:string}):Promise<void> {
 role(actor);inScope(actor,p.siteId);await site(env,p.siteId);
 const c=await connection(env,p.siteId);insist(c,'search_connection','Connect Google Search Console first.');
 const previous=JSON.parse(c.properties_json) as {siteUrl:string}[];
 insist(previous.some(v=>v.siteUrl===p.property),'search_property','Choose a property returned by Google.');
 const allowed=await listProperties(await accessToken(env,c));await current(env,c);
 insist(allowed.some(v=>v.siteUrl===p.property),'search_property','Google no longer permits this property. Connect again.');
 if(c.property===p.property){await statement(env,'UPDATE vane_search_connections SET properties_json=? WHERE site_id=? AND generation=?',JSON.stringify(allowed),p.siteId,c.generation).run();return;}
 // A new generation fences any in-flight read of the previously selected property.
 const generation=uid(),tokens=await readTokens(env,(await connection(env,p.siteId))!);
 await env.DB.batch([
  statement(env,'DELETE FROM vane_search_rows WHERE site_id=? AND EXISTS(SELECT 1 FROM vane_search_connections WHERE site_id=? AND generation=?)',p.siteId,p.siteId,c.generation),
  statement(env,'DELETE FROM vane_search_days WHERE site_id=? AND EXISTS(SELECT 1 FROM vane_search_connections WHERE site_id=? AND generation=?)',p.siteId,p.siteId,c.generation),
  statement(env,'UPDATE vane_search_connections SET generation=?,sealed_tokens=?,property=?,properties_json=?,last_sync=NULL,next_sync=?,last_error=NULL,lock_id=NULL,lock_until=NULL WHERE site_id=? AND generation=?',generation,await sealTokens(env,p.siteId,generation,tokens),p.property,JSON.stringify(allowed),clock(),p.siteId,c.generation),
  auditStatement(env,actor.id,'search.property',p.siteId,'Owner selected an allowed Google Search Console property')
 ]);
 insist((await connection(env,p.siteId))?.generation===generation,'search_connection','The Search Console connection changed. Select the property again.',409);
}
export async function disconnect(env:Env,actor:Actor,siteId:string):Promise<void> {
 role(actor);inScope(actor,siteId);await site(env,siteId);
 const c=await connection(env,siteId);
 // Revoke local access first. A failed remote revocation must never leave a sync credential behind.
 await env.DB.batch([
  statement(env,'DELETE FROM vane_search_connections WHERE site_id=?',siteId),statement(env,'DELETE FROM vane_search_oauth_states WHERE site_id=?',siteId),
  auditStatement(env,actor.id,'search.disconnect',siteId,'Connection and local OAuth credentials removed; scheduled reads stopped')
 ]);
 if(c){const tokens=await readTokens(env,c);await googleFetch(REVOKE_ENDPOINT,{method:'POST',headers:{'content-type':'application/x-www-form-urlencoded'},body:new URLSearchParams({token:tokens.refresh_token})},'token revocation');}
}

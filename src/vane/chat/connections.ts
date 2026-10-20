import { operatorAuth } from '../../auth.server'
import { auditStatement } from '../audit'
import { clock } from '../clock'
import { digest, inScope, insist, role, rows, site, statement, uid, type Actor, type Env } from '../core'
import { publicHttps } from '../warehouse'
import { seal, unseal } from '../sealed'
export const CALLBACK='/api/vane/chat/slack/callback',PURPOSE='vane-chat-v1'
export interface Connection {id:string;site_id:string;provider:'slack'|'teams'|'nook';label:string;channel:string|null;sealed_secret:string;created_by:string;created_at:number}
const redirect=(location:string)=>new Response(null,{status:303,headers:{location,'cache-control':'no-store','referrer-policy':'no-referrer'}})
export const settings=(siteId:string)=>`/app/sites/${encodeURIComponent(siteId)}?section=settings#chat-reports`
export const connections=(env:Env,siteId:string)=>rows<Connection>(env,'SELECT * FROM vane_chat_connections WHERE site_id=? ORDER BY created_at',siteId)
export async function connection(env:Env,actor:Actor,id:string,owner=false) {
 if(owner)role(actor);const c=(await rows<Connection>(env,'SELECT * FROM vane_chat_connections WHERE id=?',id))[0];insist(c,'chat','This chat destination no longer exists.',404);inScope(actor,c.site_id);return c
}
const labelOf=(p:any)=>{const label=String(p.label??'').trim();insist(label.length>0&&label.length<=80&&!/[\r\n<>@]/.test(label),'label','Name this destination in up to 80 plain characters, without an address.');return label}
async function room(env:Env,siteId:string){insist((await connections(env,siteId)).length<10,'chat_limit','A site has at most 10 chat destinations.')}
export async function teams(env:Env,actor:Actor,p:any) {
 role(actor);inScope(actor,String(p.siteId));const value=await site(env,String(p.siteId));await room(env,value.id)
 const endpoint=publicHttps(String(p.endpoint??'').trim(),true).href,label=labelOf(p),id=uid()
 await env.DB.batch([statement(env,'INSERT INTO vane_chat_connections VALUES(?,?,?,?,?,?,?,?)',id,value.id,'teams',label,null,await seal(env,PURPOSE,id,endpoint),actor.id,clock()),auditStatement(env,actor.id,'chat.connect',value.id,'Teams workflow connected')]);return value.id
}
// NOOK-079 accepts only scoped integration credentials, never a person's session cookie.
export async function nook(env:Env,actor:Actor,p:any) {
 role(actor);inScope(actor,String(p.siteId));const value=await site(env,String(p.siteId));await room(env,value.id)
 const origin=publicHttps(String(p.origin??'').trim(),true)
 insist(origin.pathname==='/'&&!origin.search&&!origin.hash,'nook_origin','Enter only your Nook installation origin.')
 const channel=String(p.channel??'').trim(),token=String(p.token??'').trim()
 insist(/^[A-Za-z0-9_-]{1,128}$/.test(channel),'nook_channel','Enter the Nook conversation ID for a channel bound to this token.')
 insist(/^nookit_[A-Za-z0-9_-]{20,200}$/.test(token),'nook_token','Paste the scoped integration token created in Nook’s You → Team → Integration tokens.')
 const id=uid(),label=labelOf(p)
 await env.DB.batch([statement(env,'INSERT INTO vane_chat_connections VALUES(?,?,?,?,?,?,?,?)',id,value.id,'nook',label,channel,await seal(env,PURPOSE,id,JSON.stringify({origin:origin.origin,token})),actor.id,clock()),auditStatement(env,actor.id,'chat.connect',value.id,'Nook NOOK-079 scoped integration token connected')]);return value.id
}
async function native(request:Request,env:Env,actor:Actor) {
 role(actor);const session=await operatorAuth(env).getSession(request);insist(session&&session.operator.id===actor.id&&session.operator.role==='owner','forbidden','Use the owner’s native session.',403);return digest(session.id)
}
export async function begin(request:Request,env:Env,actor:Actor,p:any) {
 const session=await native(request,env,actor),siteId=String(p.siteId);inScope(actor,siteId);await site(env,siteId);await room(env,siteId)
 insist(env.SLACK_CLIENT_ID&&env.SLACK_CLIENT_SECRET,'slack_configuration','Set SLACK_CLIENT_ID and SLACK_CLIENT_SECRET for your Slack app; register the callback shown below.',503)
 const channel=String(p.channel??'').trim();insist(/^[CG][A-Z0-9]{5,30}$/.test(channel),'channel','Enter the Slack channel ID and invite your bot to it.')
 const label=labelOf(p),state=Array.from(crypto.getRandomValues(new Uint8Array(32)),n=>n.toString(16).padStart(2,'0')).join('')
 await env.DB.batch([statement(env,'DELETE FROM vane_chat_states WHERE site_id=? OR expires_at<=?',siteId,clock()),statement(env,'INSERT INTO vane_chat_states(state_hash,site_id,actor_id,session_hash,label,channel,expires_at) VALUES(?,?,?,?,?,?,?)',await digest(state),siteId,actor.id,session,label,channel,clock()+600000),auditStatement(env,actor.id,'chat.oauth.begin',siteId,'Owner approved Slack chat:write only')])
 return 'https://slack.com/oauth/v2/authorize?'+new URLSearchParams({client_id:env.SLACK_CLIENT_ID,scope:'chat:write',redirect_uri:env.AUTH_ORIGIN+CALLBACK,state}).toString()
}
export async function slack(method:string,token:string,body:Record<string,string>) {
 const response=await fetch('https://slack.com/api/'+method,{method:'POST',redirect:'manual',signal:AbortSignal.timeout(15000),headers:{authorization:'Bearer '+token,'content-type':'application/json'},body:JSON.stringify(body)})
 if(!response.ok)return {ok:false,error:'http_'+response.status};const data:any=await response.json();return {ok:data.ok===true,error:['invalid_auth','token_revoked','account_inactive','not_in_channel','channel_not_found','missing_scope','ratelimited'].includes(data.error)?data.error:'provider_refused'}
}
export async function callback(request:Request,env:Env,actor:Actor) {
 const session=await native(request,env,actor),url=new URL(request.url),state=url.searchParams.get('state')??''
 insist(/^[0-9a-f]{64}$/.test(state),'chat_state','This connection expired; connect again.')
 const hash=await digest(state),s=await env.DB.prepare('UPDATE vane_chat_states SET consumed_at=? WHERE state_hash=? AND actor_id=? AND session_hash=? AND expires_at>? AND consumed_at IS NULL RETURNING *').bind(clock(),hash,actor.id,session,clock()).first<any>()
 insist(s,'chat_state','This connection expired or was already used; connect again.');inScope(actor,s.site_id);await site(env,s.site_id);await room(env,s.site_id)
 const code=url.searchParams.get('code');insist(code&&!url.searchParams.has('error')&&code.length<=4096,'slack_consent','Slack did not approve the connection.')
 let data:any;try{const r=await fetch('https://slack.com/api/oauth.v2.access',{method:'POST',redirect:'manual',signal:AbortSignal.timeout(15000),headers:{'content-type':'application/x-www-form-urlencoded'},body:new URLSearchParams({client_id:env.SLACK_CLIENT_ID!,client_secret:env.SLACK_CLIENT_SECRET!,code,redirect_uri:env.AUTH_ORIGIN+CALLBACK})});if(r.ok)data=await r.json()}catch{}
 insist(data?.ok===true&&typeof data.access_token==='string'&&data.token_type==='bot'&&data.scope==='chat:write'&&!data.authed_user?.access_token,'slack_token','Slack must grant a bot token with only chat:write. Configure the app and reconnect.',502)
 const id=uid(),result=await statement(env,'INSERT INTO vane_chat_connections SELECT ?,?,?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM vane_chat_states WHERE state_hash=? AND expires_at>?)',id,s.site_id,'slack',s.label,s.channel,await seal(env,PURPOSE,id,data.access_token),actor.id,clock(),hash,clock()).run()
 if(!result.meta.changes){try{await slack('auth.revoke',data.access_token,{})}catch{};insist(false,'chat_state','The connection was cancelled; reconnect.',409)}
 await statement(env,'DELETE FROM vane_chat_states WHERE state_hash=?',hash).run();await auditStatement(env,actor.id,'chat.connect',s.site_id,'Slack bot connected with chat:write').run();return redirect(settings(s.site_id))
}
export async function disconnect(env:Env,actor:Actor,id:string) {
 const c=await connection(env,actor,id,true);let outcome='credential erased'
 if(c.provider==='slack'){try{const result=await slack('auth.revoke',await unseal(env,PURPOSE,c.id,c.sealed_secret),{});outcome=result.ok?'Slack token revoked; credential erased':'Slack revocation refused ('+result.error+'); local credential erased'}catch{outcome='Slack revocation unconfirmed; local credential erased'}}
 await env.DB.batch([statement(env,'DELETE FROM vane_chat_states WHERE site_id=?',c.site_id),statement(env,'DELETE FROM vane_chat_connections WHERE id=?',id),auditStatement(env,actor.id,'chat.disconnect',c.site_id,outcome)]);return {siteId:c.site_id,outcome}
}

import { insist, statement, VaneError, type Env } from '../core'
import { clock } from '../clock'
import { current, readTokens, sealTokens } from './storage'
import type { Connection, SearchEnv, Tokens } from './types'

// Fixed official endpoints only. The selected property is an encoded path parameter, never a request host.
// Fixed Admin and Data API endpoints; source properties are validated identifiers.
export const AUTH_ENDPOINT='https://accounts.google.com/o/oauth2/v2/auth'
export const TOKEN_ENDPOINT='https://oauth2.googleapis.com/token'
export const REVOKE_ENDPOINT='https://oauth2.googleapis.com/revoke'
export const ADMIN_ENDPOINT='https://analyticsadmin.googleapis.com/v1beta'
export const DATA_ENDPOINT='https://analyticsdata.googleapis.com/v1beta'
export const SCOPE='https://www.googleapis.com/auth/analytics.readonly'
export const CALLBACK_PATH='/api/vane/ga4/callback'
export function credentials(env:SearchEnv) {
 insist(env.GOOGLE_CLIENT_ID&&env.GOOGLE_CLIENT_SECRET,'search_configuration','Configure GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET before connecting Google GA4.',503);
 return {client_id:env.GOOGLE_CLIENT_ID,client_secret:env.GOOGLE_CLIENT_SECRET};
}
export async function googleFetch(url:string,init:RequestInit,label:string):Promise<Response> {
 let response:Response;
 try {response=await fetch(url,{...init,redirect:'manual',signal:AbortSignal.timeout(30000)});}
 catch {throw new VaneError('search_google_unavailable',`Google ${label} could not be reached.`,502);}
 // Never surface Google's body: OAuth and API errors may reflect tokens, codes or source labels.
 insist(response.ok,'search_google_error',`Google ${label} returned HTTP ${response.status}.`,502);
 return response;
}
async function tokenRequest(env:SearchEnv,parameters:Record<string,string>,previousRefresh?:string):Promise<Tokens> {
 const response=await googleFetch(TOKEN_ENDPOINT,{method:'POST',headers:{'content-type':'application/x-www-form-urlencoded'},body:new URLSearchParams({...credentials(env),...parameters})},'token exchange');
 let data:any;try {data=await response.json()}catch {throw new VaneError('search_google_response','Google returned an invalid token response.',502)}
 insist(typeof data.access_token==='string'&&data.access_token&&Number.isFinite(data.expires_in)&&data.expires_in>0,'search_google_response','Google returned an incomplete token response.',502);
 if(data.scope!==undefined)insist(typeof data.scope==='string'&&data.scope.split(/\s+/).filter(Boolean).every((scope:string)=>scope===SCOPE)&&data.scope.includes(SCOPE),'search_scope','Google must grant only the GA4 read-only scope.',502);
 insist(data.token_type===undefined||String(data.token_type).toLowerCase()==='bearer','search_google_response','Google returned an unsupported token type.',502);
 const refresh=typeof data.refresh_token==='string'?data.refresh_token:previousRefresh;
 insist(refresh,'search_offline_access','Google did not grant offline access. Connect again and approve read-only access.');
 return {access_token:data.access_token,refresh_token:refresh,expires_at:clock()+data.expires_in*1000};
}
export const exchangeCode=(env:SearchEnv,code:string,redirectUri:string)=>tokenRequest(env,{code,redirect_uri:redirectUri,grant_type:'authorization_code'});
export async function accessToken(env:Env,c:Connection,lockId?:string):Promise<string> {
 await current(env,c,lockId);
 insist(!c.last_error,'ga4_revoked','Google access stopped. Reconnect GA4 to continue.',409);
 let tokens=await readTokens(env,c);
 if(tokens.expires_at>clock()+60000)return tokens.access_token;
 try {tokens=await tokenRequest(env,{grant_type:'refresh_token',refresh_token:tokens.refresh_token},tokens.refresh_token)} catch {
  await statement(env,'UPDATE vane_ga4_connections SET last_error=? WHERE site_id=? AND generation=?','Google access stopped. Reconnect GA4 to continue.',c.site_id,c.generation).run();
  throw new VaneError('ga4_revoked','Google access stopped. Reconnect GA4 to continue.',409);
 }
 await current(env,c,lockId);
 const sealed=await sealTokens(env,c.site_id,c.generation,tokens);
 await statement(env,'UPDATE vane_ga4_connections SET sealed_tokens=? WHERE site_id=? AND generation=?',sealed,c.site_id,c.generation).run();
 c.sealed_tokens=sealed;
 return tokens.access_token;
}
export async function listProperties(access:string) {
 const properties:{siteUrl:string;displayName:string}[]=[];let token='';const seen=new Set<string>();
 do {
  const url=new URL(ADMIN_ENDPOINT+'/accountSummaries');url.searchParams.set('pageSize','200');if(token)url.searchParams.set('pageToken',token);
  const data:any=await (await googleFetch(url.href,{headers:{authorization:'Bearer '+access}},'GA4 property list')).json();
  insist(Array.isArray(data.accountSummaries??[]),'ga4_properties','Google returned an invalid property list.',502);
  for(const account of data.accountSummaries??[])for(const p of account.propertySummaries??[])if(/^properties\/[1-9]\d*$/.test(p.property))properties.push({siteUrl:p.property,displayName:p.property});
  token=data.nextPageToken??'';insist(typeof token==='string'&&!seen.has(token),'ga4_pagination','Google repeated a property page.',502);if(token)seen.add(token);
 }while(token);
 return properties;
}

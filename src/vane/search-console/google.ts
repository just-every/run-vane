import { insist, statement, VaneError, type Env } from '../core'
import { clock } from '../clock'
import { current, readTokens, sealTokens } from './storage'
import type { Connection, GoogleProperty, GoogleRow, SearchEnv, Tokens } from './types'

// Fixed official endpoints only. The selected property is an encoded path parameter, never a request host.
// Sources: developers.google.com/identity/protocols/oauth2/web-server
// developers.google.com/webmaster-tools/v1/{sites/list,searchanalytics/query}
export const AUTH_ENDPOINT='https://accounts.google.com/o/oauth2/v2/auth'
export const TOKEN_ENDPOINT='https://oauth2.googleapis.com/token'
export const REVOKE_ENDPOINT='https://oauth2.googleapis.com/revoke'
export const SITES_ENDPOINT='https://www.googleapis.com/webmasters/v3/sites'
export const SCOPE='https://www.googleapis.com/auth/webmasters.readonly'
export const CALLBACK_PATH='/api/vane/search-console/callback'
export function credentials(env:SearchEnv) {
 insist(env.GOOGLE_CLIENT_ID&&env.GOOGLE_CLIENT_SECRET,'search_configuration','Configure GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET before connecting Google Search Console.',503);
 return {client_id:env.GOOGLE_CLIENT_ID,client_secret:env.GOOGLE_CLIENT_SECRET};
}
export async function googleFetch(url:string,init:RequestInit,label:string):Promise<Response> {
 let response:Response;
 try {response=await fetch(url,{...init,redirect:'error',signal:AbortSignal.timeout(30000)});}
 catch {throw new VaneError('search_google_unavailable',`Google ${label} could not be reached.`,502);}
 // Never surface Google's body: OAuth and API errors may reflect tokens, codes or source labels.
 insist(response.ok,'search_google_error',`Google ${label} returned HTTP ${response.status}.`,502);
 return response;
}
async function tokenRequest(env:SearchEnv,parameters:Record<string,string>,previousRefresh?:string):Promise<Tokens> {
 const response=await googleFetch(TOKEN_ENDPOINT,{method:'POST',headers:{'content-type':'application/x-www-form-urlencoded'},body:new URLSearchParams({...credentials(env),...parameters})},'token exchange');
 let data:any;try {data=await response.json()}catch {throw new VaneError('search_google_response','Google returned an invalid token response.',502)}
 insist(typeof data.access_token==='string'&&data.access_token&&Number.isFinite(data.expires_in)&&data.expires_in>0,'search_google_response','Google returned an incomplete token response.',502);
 if(data.scope!==undefined)insist(typeof data.scope==='string'&&data.scope.split(/\s+/).filter(Boolean).every((scope:string)=>scope===SCOPE)&&data.scope.includes(SCOPE),'search_scope','Google must grant only the Search Console read-only scope.',502);
 insist(data.token_type===undefined||String(data.token_type).toLowerCase()==='bearer','search_google_response','Google returned an unsupported token type.',502);
 const refresh=typeof data.refresh_token==='string'?data.refresh_token:previousRefresh;
 insist(refresh,'search_offline_access','Google did not grant offline access. Connect again and approve read-only access.');
 return {access_token:data.access_token,refresh_token:refresh,expires_at:clock()+data.expires_in*1000};
}
export const exchangeCode=(env:SearchEnv,code:string,redirectUri:string)=>tokenRequest(env,{code,redirect_uri:redirectUri,grant_type:'authorization_code'});
export async function accessToken(env:Env,c:Connection,lockId?:string):Promise<string> {
 await current(env,c,lockId);
 let tokens=await readTokens(env,c);
 if(tokens.expires_at>clock()+60000)return tokens.access_token;
 tokens=await tokenRequest(env,{grant_type:'refresh_token',refresh_token:tokens.refresh_token},tokens.refresh_token);
 await current(env,c,lockId);
 const sealed=await sealTokens(env,c.site_id,c.generation,tokens);
 await statement(env,'UPDATE vane_search_connections SET sealed_tokens=? WHERE site_id=? AND generation=?',sealed,c.site_id,c.generation).run();
 c.sealed_tokens=sealed;
 return tokens.access_token;
}
export async function listProperties(access:string):Promise<GoogleProperty[]> {
 const response=await googleFetch(SITES_ENDPOINT,{headers:{authorization:'Bearer '+access}},'property list');
 const data:any=await response.json();
 insist(data&&(!data.siteEntry||Array.isArray(data.siteEntry)),'search_google_response','Google returned an invalid property list.',502);
 return (data.siteEntry??[]).filter((p:any)=>typeof p.siteUrl==='string'&&['siteOwner','siteFullUser','siteRestrictedUser'].includes(p.permissionLevel)).map((p:GoogleProperty)=>({siteUrl:p.siteUrl,permissionLevel:p.permissionLevel}));
}
export async function query(env:Env,c:Connection,lockId:string,access:string,from:string,toInclusive:string,dimensions:string[],startRow=0):Promise<GoogleRow[]> {
 await current(env,c,lockId);
 const url=SITES_ENDPOINT+'/'+encodeURIComponent(c.property!)+'/searchAnalytics/query';
 const response=await googleFetch(url,{method:'POST',headers:{authorization:'Bearer '+access,'content-type':'application/json'},body:JSON.stringify({startDate:from,endDate:toInclusive,dimensions,type:'web',dataState:'final',aggregationType:dimensions.includes('page')?'auto':'byProperty',rowLimit:25000,startRow})},'Search Analytics');
 const data:any=await response.json();
 insist(data&&(!data.rows||Array.isArray(data.rows)),'search_google_response','Google returned an invalid Search Analytics response.',502);
 for(const row of data.rows??[])insist(row&&Array.isArray(row.keys)&&row.keys.length===dimensions.length&&row.keys.every((v:unknown)=>typeof v==='string')&&['clicks','impressions','ctr','position'].every(k=>typeof row[k]==='number'&&Number.isFinite(row[k])&&row[k]>=0)&&row.ctr<=1,'search_google_response','Google returned an invalid Search Analytics row.',502);
 return data.rows??[];
}
export async function queryAll(env:Env,c:Connection,lockId:string,access:string,from:string,toInclusive:string,dimensions:string[]):Promise<GoogleRow[]> {
 const all:GoogleRow[]=[];
 // This is source pagination, never a retry. The API itself returns only its top rows.
 for(let startRow=0;;startRow+=25000) {const page=await query(env,c,lockId,access,from,toInclusive,dimensions,startRow);all.push(...page);if(page.length<25000)return all;}
}

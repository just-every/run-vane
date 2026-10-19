import type { Env } from '../core'

export type SearchEnv = Env & { GOOGLE_CLIENT_ID?:string; GOOGLE_CLIENT_SECRET?:string }
export interface GoogleProperty { siteUrl:string; permissionLevel:string }
export interface Tokens { access_token:string; refresh_token:string; expires_at:number }
export interface Connection {
 site_id:string; generation:string; sealed_tokens:string; property:string|null; properties_json:string;
 connected_by:string; connected_at:number; last_sync:number|null; next_sync:number; last_error:string|null;
 lock_id:string|null; lock_until:number|null
}
export interface Metrics { clicks:number; impressions:number; ctr:number; position:number }
export interface GoogleRow extends Metrics { keys?:string[] }
export type Grain='overall'|'query'|'page'|'query_page'
export interface SearchRow extends Metrics { grain:Grain; query:string; page:string; path:string }
export interface SourceDay { site_id:string; day:string; property:string; snapshot_id:string|null; status:'final'|'pending'; checked_at:number; published_at:number|null }
export interface Range { from:string; to:string }

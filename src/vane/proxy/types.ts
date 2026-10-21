import type { Env } from '../core'

export type ProxyMode = 'external' | 'worker'
export interface ProxyConnection {
 id:string
 siteId:string
 mode:ProxyMode
 hostname:string
 siteOrigin:string
 publicPrefix:string
 createdBy:string
 createdAt:number
 rotatedAt:number|null
 revokedAt:number|null
 provider:ProxyProvider|null
}
export interface ProxyProvider {
 kind:'route'|'domain'
 accountId:string
 zoneId:string
 workerName:string
 resourceId:string
 connectedBy:string
 connectedAt:number
}
export interface ConnectionRow {
 id:string; site_id:string; mode:ProxyMode; hostname:string; site_origin:string; public_prefix:string
 credential_hash:string|null; created_by:string; created_at:number; rotated_at:number|null; revoked_at:number|null
 provider_json:string|null
}
export interface CreateProxyConnection {
 siteId:string; mode:ProxyMode; hostname:string; siteOrigin?:string; publicPrefix?:string
}
export interface ProxyIdentity { siteId:string; connectionId:string }
export interface ProxyResolution extends ProxyIdentity { request:Request; publicPrefix:string }
/** Only the installation's existing Worker may be attached; not an owner-supplied arbitrary script. */
export const INSTALLATION_WORKER_NAME='analytics-vane'
export interface CloudflareConnect extends ProxyIdentity {
 token:string; accountId:string; zoneId:string; workerName:string
}
export type ProxyEnv = Env

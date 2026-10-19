import type { Bindings } from '../auth.server'
import { clock } from './clock'
export type Env = Bindings
export interface Actor { id: string; role: string; displayName?: string }
export interface Config { paths:string[]; excludePaths?:string[]; rewrites?:{from:string,to:string}[]; queryKeys?:string[]; sourceRules?:{match:string,name:string}[]; declinedCounter?:boolean; goals:Record<string,string>; scrollGoals?:Record<string,{path:string,depth:number}>; consent:'not-required'|'required'; sampleRate:number; retentionDays:number; signalCounter:boolean; timeZone:string; searchParam?:string; publicReports?:string[]; publicIndexing?:boolean; autoEvents?:string[]; origins?:string[]; currency?:string }
export interface Site { id:string; name:string; origin:string; config_json:string; config:Config; version:number; created_at:number }
export class VaneError extends Error { constructor(public code:string, message:string, public status=400) { super(message) } }
export function insist(condition:unknown, code:string, message:string, status=400):asserts condition { if (!condition) throw new VaneError(code,message,status) }
export function role(actor:Actor, roles=['owner']) { insist(roles.includes(actor.role),'forbidden','This action requires '+roles.join(' or ')+'.',403) }
export const uid = () => crypto.randomUUID()
export const day = (time=clock()) => new Date(time).toISOString().slice(0,10)
export async function rows<T=Record<string,any>>(env:Env,sql:string,...values:any[]):Promise<T[]> { return (await env.DB.prepare(sql).bind(...values).all<T>()).results }
export async function site(env:Env,id:string):Promise<Site> { const value=await env.DB.prepare('SELECT * FROM vane_sites WHERE id=?').bind(id).first<any>(); insist(value,'site_missing','Site not found.',404); return {...value,config:JSON.parse(value.config_json)} }
export async function sites(env:Env) { return (await rows(env,'SELECT s.*,NOT EXISTS(SELECT 1 FROM vane_events e WHERE e.site_id=s.id) AS awaiting FROM vane_sites s ORDER BY s.created_at')).map(({awaiting,...value})=>({...value,config:JSON.parse(value.config_json),awaitingFirstEvent:Boolean(awaiting)})) }
// SITE-001: browser events come from the site's origin or one of its extra allowed origins (www and apex, subdomains).
export function siteOrigin(value:Site,request:Request):string { const origin=request.headers.get('origin')??''; insist([value.origin,...(value.config.origins??[])].includes(origin),'origin','Origin is not registered for this site.',403); return origin }
export const statement=(env:Env,sql:string,...values:any[])=>env.DB.prepare(sql).bind(...values)
export function actorGuard(env:Env,actor:Actor,roles=['owner']) { return statement(env,`INSERT INTO vane_guard(value) SELECT CASE WHEN EXISTS(SELECT 1 FROM oa_operators WHERE id=? AND status='active' AND role IN (${roles.map(()=>'?').join(',')})) THEN 1 ELSE 0 END`,actor.id,...roles) }
export async function atomic(env:Env,actor:Actor,statements:D1PreparedStatement[],roles=['owner']) { role(actor,roles); return env.DB.batch([statement(env,'DELETE FROM vane_guard'),actorGuard(env,actor,roles),...statements,statement(env,'DELETE FROM vane_guard')]) }
export async function digest(value:string) { return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value))),b=>b.toString(16).padStart(2,'0')).join('') }

import { atomic, inScope, insist, role, rows, site, statement, type Actor, type Env } from '../core'
import { auditStatement } from '../audit'
import { pathAllowed, storedPath } from '../paths'

export interface HeatSetting { path:string; enabledAt:number; enabledBy:string }
export async function heatPaths(env:Env,siteId:string):Promise<string[]> {
 return (await rows<{path:string}>(env,'SELECT path FROM vane_heat_pages WHERE site_id=? ORDER BY path',siteId)).map(r=>r.path)
}
export async function heatSetting(env:Env,actor:Actor,siteId:string):Promise<HeatSetting[]> {
 role(actor);inScope(actor,siteId);await site(env,siteId)
 return rows<HeatSetting>(env,'SELECT path,enabled_at AS enabledAt,enabled_by AS enabledBy FROM vane_heat_pages WHERE site_id=? ORDER BY path',siteId)
}
// Explicit owner choice only: no wildcard, automatic discovery, key or administrator write.
export async function configureHeat(env:Env,actor:Actor,input:Record<string,unknown>) {
 role(actor);const siteId=String(input.siteId??'');inScope(actor,siteId)
 insist(Object.keys(input).every(k=>['siteId','path','enabled'].includes(k)),'heat_fields','Choose only the site, exact page path and enabled choice.')
 const value=await site(env,siteId),path=String(input.path??'')
 insist(/^\/[A-Za-z0-9_\-/\.]{0,119}$/.test(path)&&!path.startsWith('//')&&!path.split('/').some(p=>p==='.'||p==='..'),'heat_path','Choose an exact page path without a query, fragment or wildcard.')
 insist(storedPath(value.config,path)===path,'heat_path','Choose a page whose path needs no privacy redaction or rewrite.')
 const enabled=input.enabled===true||input.enabled==='on'
 insist(input.enabled===true||input.enabled===false||input.enabled==='on'||input.enabled==='off','heat_enabled','Choose explicitly whether this page is enabled.')
 if(enabled){insist(pathAllowed(value.config,path),'heat_path','This page is excluded from site collection.');const paths=await heatPaths(env,siteId);insist(paths.includes(path)||paths.length<20,'heat_pages','Choose at most 20 pages per site.')}
 await atomic(env,actor,[
  ...(enabled?[statement(env,'INSERT INTO vane_guard(value) SELECT CASE WHEN EXISTS(SELECT 1 FROM vane_sites WHERE id=? AND version=?) THEN 1 ELSE 0 END',siteId,value.version),statement(env,'INSERT INTO vane_guard(value) SELECT CASE WHEN (SELECT COUNT(*) FROM vane_heat_pages WHERE site_id=?)<20 OR EXISTS(SELECT 1 FROM vane_heat_pages WHERE site_id=? AND path=?) THEN 1 ELSE 0 END',siteId,siteId,path),statement(env,'INSERT INTO vane_heat_pages(site_id,path,enabled_by,enabled_at) VALUES(?,?,?,?) ON CONFLICT(site_id,path) DO UPDATE SET enabled_by=excluded.enabled_by,enabled_at=excluded.enabled_at',siteId,path,actor.id,Date.now())]:[statement(env,'DELETE FROM vane_heat_pages WHERE site_id=? AND path=?',siteId,path)]),
  auditStatement(env,actor.id,'heat.configure',siteId,`${enabled?'enabled':'disabled'} ${path}`),
 ])
 return {siteId,path,enabled}
}

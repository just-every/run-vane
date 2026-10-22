import { clock } from '../clock'
import { consentAccepted } from '../consent'
import { insist, statement, type Env, type Site } from '../core'
import { pathAllowed, storedPath } from '../paths'
import { excludedTraffic } from '../traffic'
import { localDay } from '../visitors'
import { heatGeometry } from './geometry'

// No event ID, page-load ID, visitor hash, selector, label, text or form field enters this door.
export async function collectHeat(request:Request,env:Env,value:Site,payload:any) {
 insist(payload&&typeof payload==='object'&&!Array.isArray(payload)&&[7,8].includes(Object.keys(payload).length)&&Object.keys(payload).every(k=>['siteId','path','x','y','width','consent','kind','geometry'].includes(k))&&payload.kind==='click','heat_fields','A heat click carries only site, page, grid position, viewport width, consent, kind and optional anonymous layout geometry.')
 insist(request.headers.get('origin')===value.origin,'heat_origin','Heatmaps collect only this site’s primary origin.',403)
 insist(request.headers.get('dnt')!=='1'&&request.headers.get('sec-gpc')!=='1','heat_signal','This browser has declined collection.',403)
 insist(consentAccepted(value.config,request,payload.consent),'consent','Consent is required for collection.',403)
 insist(!excludedTraffic(request,value.config,null),'excluded','This traffic is excluded from collection.',403)
 insist(typeof payload.path==='string'&&/^\/[^?#\s]{0,119}$/.test(payload.path)&&storedPath(value.config,payload.path)===payload.path&&pathAllowed(value.config,payload.path),'heat_path','This page cannot be collected.',403)
 for(const [key,max] of [['x',39],['y',99],['width',10000]] as const)insist(Number.isInteger(payload[key])&&payload[key]>=(key==='width'?1:0)&&payload[key]<=max,'heat_grid','Send a valid grid position and viewport width.')
 const geometry=payload.geometry===undefined?null:heatGeometry(payload.geometry)
 // INSERT ... SELECT keeps allowlist refusal and disabling race-safe, with no temporary click event.
 const click=statement(env,'INSERT INTO vane_heat_clicks(site_id,day,path,width,x,y,count) SELECT ?,?,?,?,?,?,1 WHERE EXISTS(SELECT 1 FROM vane_heat_pages WHERE site_id=? AND path=?) ON CONFLICT(site_id,day,path,width,x,y) DO UPDATE SET count=count+1',value.id,localDay(clock(),value.config.timeZone??'UTC'),payload.path,payload.width,payload.x,payload.y,value.id,payload.path)
 const results=await env.DB.batch([click,...(geometry?[statement(env,'INSERT INTO vane_heat_layouts(site_id,day,path,width,geometry_json) SELECT ?,?,?,?,? WHERE EXISTS(SELECT 1 FROM vane_heat_pages WHERE site_id=? AND path=?) ON CONFLICT(site_id,day,path,width) DO UPDATE SET geometry_json=excluded.geometry_json',value.id,localDay(clock(),value.config.timeZone??'UTC'),payload.path,payload.width,JSON.stringify(geometry),value.id,payload.path)]:[])])
 insist(results[0].meta.changes>0,'heat_disabled','The owner has not enabled a heatmap for this page.',403)
}

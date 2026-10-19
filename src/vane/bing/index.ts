import { atomic, inScope, insist, role, rows, site, statement, uid, type Actor, type Env } from '../core'
import { auditStatement } from '../audit'
import { clock } from '../clock'
import { seal, unseal } from '../sealed'
import { BingError, safeFailure, sourceStats, validateProperty } from './api'
import { fold, normalize, pagePath } from './normalize'
import { connection, due, guarded, replacement } from './store'
import type { Aggregate, Connection } from './types'
export { report, queryPaths } from './report'

const PURPOSE='vane-bing-api-key-v1',DAY=86400000
export async function connect(env:Env,actor:Actor,p:{siteId:string;apiKey:string;property:string}):Promise<void> {
 role(actor);inScope(actor,p.siteId);const value=await site(env,p.siteId)
 const property=String(p.property??'').trim(),key=String(p.apiKey??'').trim()
 insist(key.length>0&&key.length<=512&&!/\s/.test(key),'bing_key','Enter the Bing Webmaster Tools API key. It will be sealed and never shown again.')
 let parsed:URL;try{parsed=new URL(property)}catch{throw new BingError('Enter the exact verified Bing property URL.',400)}
 insist(['http:','https:'].includes(parsed.protocol)&&!parsed.username&&!parsed.password&&!parsed.search&&!parsed.hash,'bing_property','Enter the exact verified Bing property URL without credentials, query parameters or fragments.')
 insist([value.origin,...(value.config.origins??[])].includes(parsed.origin),'bing_property','The Bing property must use this site’s origin or one of its configured extra origins.')
 const history=await rows<{property:string}>(env,'SELECT DISTINCT property FROM vane_bing_rows WHERE site_id=?',value.id);
 insist(history.every(row=>row.property===property),'bing_property_history','This site has history from another Bing property. Use that property, or erase its history through the reviewed erasure proposal first.',409);
 await validateProperty(key,property)
 const id=uid(),now=clock(),sealed=await seal(env,PURPOSE,`${value.id}:${id}`,key)
 await atomic(env,actor,[
  statement(env,'INSERT INTO vane_guard(value) SELECT CASE WHEN EXISTS(SELECT 1 FROM vane_sites WHERE id=?) THEN 1 ELSE 0 END',value.id),
  statement(env,`INSERT INTO vane_bing_connections(site_id,id,property,sealed_key,connected_by,connected_at,next_sync_at) VALUES(?,?,?,?,?,?,?)
   ON CONFLICT(site_id) DO UPDATE SET id=excluded.id,property=excluded.property,sealed_key=excluded.sealed_key,connected_by=excluded.connected_by,connected_at=excluded.connected_at,next_sync_at=excluded.next_sync_at,last_attempt_at=NULL,last_sync_at=NULL,sync_id=NULL,error=NULL,query_pages_error=NULL,source_counts=NULL`,value.id,id,property,sealed,actor.id,now,now),
  auditStatement(env,actor.id,'bing.connect',value.id,'Verified Bing Webmaster Tools property connected; API key sealed')
 ])
 await runNow(env,actor,value.id)
}
export async function disconnect(env:Env,actor:Actor,siteId:string):Promise<void> {
 role(actor);inScope(actor,siteId);await site(env,siteId)
 await atomic(env,actor,[statement(env,'DELETE FROM vane_bing_connections WHERE site_id=?',siteId),auditStatement(env,actor.id,'bing.disconnect',siteId,'Bing API key removed; fetched aggregates retained')])
}
async function run(env:Env,config:Connection,now:number):Promise<void> {
 const value=await site(env,config.site_id),syncId=uid()
 await statement(env,'UPDATE vane_bing_connections SET sync_id=?,last_attempt_at=?,next_sync_at=? WHERE site_id=? AND id=?',syncId,now,now+DAY,config.site_id,config.id).run()
 try {
  const key=await unseal(env,PURPOSE,`${config.site_id}:${config.id}`,config.sealed_key)
  const [queries,pages,dates]=await Promise.all([
   sourceStats(key,'GetQueryStats',config.property),sourceStats(key,'GetPageStats',config.property),sourceStats(key,'GetRankAndTrafficStats',config.property)
  ])
  const base=[...normalize(value.config,'query',queries),...normalize(value.config,'page',pages),...normalize(value.config,'date',dates)]
  const queryPages:Aggregate[]=[];let pageFailure:string|null=null
  // GetPageQueryStats identifies both the original page and its terms. The original
  // URL is sent back only to Bing; storage retains the existing redacted path policy.
  for(const page of new Set(pages.map(row=>row.Query))){
   try {
    if(typeof page!=='string')throw new BingError('Bing returned an invalid page label.')
    queryPages.push(...normalize(value.config,'query-page',await sourceStats(key,'GetPageQueryStats',config.property,page),pagePath(value.config,page)))
   }catch(error){pageFailure=safeFailure(error);break}
  }
  await env.DB.batch([
   ...replacement(env,config,syncId,['query','page','date'],base,now),
   ...(pageFailure?[]:replacement(env,config,syncId,['query-page'],fold(queryPages),now)),
   guarded(env,'UPDATE vane_bing_connections SET last_sync_at=?,error=NULL,query_pages_error=?,source_counts=? WHERE site_id=?',config,syncId,now,pageFailure,JSON.stringify({queries:queries.length,pages:pages.length,dates:dates.length,queryPages:pageFailure?null:queryPages.length}),config.site_id),
  ])
  if(pageFailure)throw new BingError(pageFailure)
 }catch(error){
  const message=safeFailure(error)
  await guarded(env,'UPDATE vane_bing_connections SET error=? WHERE site_id=?',config,syncId,message,config.site_id).run()
  throw new BingError(message)
 }
}
export async function runNow(env:Env,actor:Actor,siteId:string):Promise<void> {
 role(actor);inScope(actor,siteId);await site(env,siteId)
 const config=await connection(env,siteId);insist(config,'bing_connection','Connect Bing Webmaster Tools first.',404)
 await run(env,config,clock())
}
export async function sync(env:Env,now=clock()):Promise<void> {
 for(const config of await due(env,now)){
  try {await run(env,config,now)}catch{/* Each connection carries its safe, visible failure; other sites still sync. */}
 }
}

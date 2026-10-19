import { rows, statement, type Env } from '../core'
import type { Aggregate, Connection, Kind } from './types'

export const connection=(env:Env,siteId:string)=>env.DB.prepare('SELECT * FROM vane_bing_connections WHERE site_id=?').bind(siteId).first<Connection>()
const current='EXISTS(SELECT 1 FROM vane_bing_connections c JOIN vane_sites s ON s.id=c.site_id WHERE c.site_id=? AND c.id=? AND c.sync_id=?)'
export const guarded=(env:Env,sql:string,config:Connection,syncId:string,...values:unknown[])=>statement(env,sql+' AND '+current,...values,config.site_id,config.id,syncId)

export function replacement(env:Env,config:Connection,syncId:string,kinds:Kind[],values:Aggregate[],now:number):D1PreparedStatement[] {
 const prepared:D1PreparedStatement[]=[]
 for(const kind of kinds){
  const dates=values.filter(value=>value.kind===kind).map(value=>value.day).sort()
  // Bing returns a bounded source window. Preserve already-observed older history;
  // replace its published date range so revised source values never double count.
  if(dates.length)prepared.push(guarded(env,'DELETE FROM vane_bing_rows WHERE site_id=? AND kind=? AND day>=? AND day<=?',config,syncId,config.site_id,kind,dates[0],dates[dates.length-1]))
 }
 // JSON batches avoid thousands of statements without exceeding SQLite's binding limit.
 for(let start=0;start<values.length;start+=100){
  prepared.push(statement(env,`INSERT INTO vane_bing_rows(site_id,day,kind,query,page,clicks,impressions,position_sum,position_weight,fetched_at)
   SELECT ?,json_extract(j.value,'$.day'),json_extract(j.value,'$.kind'),json_extract(j.value,'$.query'),json_extract(j.value,'$.page'),json_extract(j.value,'$.clicks'),json_extract(j.value,'$.impressions'),json_extract(j.value,'$.position_sum'),json_extract(j.value,'$.position_weight'),?
   FROM json_each(?) j WHERE ${current}
   AND json_extract(j.value,'$.day')>=COALESCE((SELECT MAX(before_day) FROM vane_deletions WHERE site_id=?),'0000-01-01')`,config.site_id,now,JSON.stringify(values.slice(start,start+100)),config.site_id,config.id,syncId,config.site_id))
 }
 return prepared
}
export const due=(env:Env,now:number)=>rows<Connection>(env,'SELECT c.* FROM vane_bing_connections c JOIN vane_sites s ON s.id=c.site_id WHERE c.next_sync_at<=? ORDER BY c.next_sync_at',now)

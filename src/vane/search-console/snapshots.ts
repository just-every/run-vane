import { statement, uid, type Env } from '../core'
import { current, guardValues, liveGuard } from './storage'
import type { Connection, SearchRow } from './types'

export async function pendingDays(env:Env,c:Connection,lockId:string,dates:string[],now:number) {
 for(let i=0;i<dates.length;i+=50) {
  await current(env,c,lockId);
  await env.DB.batch(dates.slice(i,i+50).map(date=>statement(env,`INSERT INTO vane_search_days(site_id,day,property,snapshot_id,status,checked_at,published_at) SELECT ?,?,?,NULL,'pending',?,NULL WHERE ${liveGuard} ON CONFLICT(site_id,day) DO UPDATE SET checked_at=excluded.checked_at WHERE vane_search_days.status='pending'`,c.site_id,date,c.property,now,...guardValues(c,lockId))));
 }
}
export async function publishDay(env:Env,c:Connection,lockId:string,date:string,data:SearchRow[],now:number) {
 const snapshotId=uid();
 try {
  // Staging in modest batches stays within D1's per-statement binding limit. Readers see only the day pointer.
  for(let i=0;i<data.length;i+=50) {
   await current(env,c,lockId);
   await env.DB.batch(data.slice(i,i+50).map(row=>statement(env,`INSERT INTO vane_search_rows(site_id,day,snapshot_id,grain,query,page,path,clicks,impressions,ctr,position) SELECT ?,?,?,?,?,?,?,?,?,?,? WHERE ${liveGuard}`,c.site_id,date,snapshotId,row.grain,row.query,row.page,row.path,row.clicks,row.impressions,row.ctr,row.position,...guardValues(c,lockId))));
  }
  await current(env,c,lockId);
  await statement(env,`INSERT INTO vane_search_days(site_id,day,property,snapshot_id,status,checked_at,published_at) SELECT ?,?,?,?,'final',?,? WHERE ${liveGuard} ON CONFLICT(site_id,day) DO UPDATE SET property=excluded.property,snapshot_id=excluded.snapshot_id,status='final',checked_at=excluded.checked_at,published_at=COALESCE(vane_search_days.published_at,excluded.published_at)`,c.site_id,date,c.property,snapshotId,now,now,...guardValues(c,lockId)).run();
  await statement(env,`DELETE FROM vane_search_rows WHERE site_id=? AND day=? AND snapshot_id<>? AND ${liveGuard}`,c.site_id,date,snapshotId,...guardValues(c,lockId)).run();
 } catch(error) {
  // Delete only this unpublished snapshot; a successfully published pointer remains intact after a later failure.
  await statement(env,'DELETE FROM vane_search_rows WHERE snapshot_id=? AND NOT EXISTS(SELECT 1 FROM vane_search_days WHERE snapshot_id=?)',snapshotId,snapshotId).run();
  throw error;
 }
}

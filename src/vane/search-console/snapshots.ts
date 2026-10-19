import { statement, uid, type Env } from '../core'
import { current, guardValues, liveGuard } from './storage'
import type { Connection, SearchRow } from './types'

export async function pendingDays(env:Env,c:Connection,lockId:string,dates:string[],now:number) {
 for(let i=0;i<dates.length;i+=50) {
  await current(env,c,lockId);
  await env.DB.batch(dates.slice(i,i+50).map(date=>statement(env,`INSERT INTO vane_search_days(site_id,day,property,snapshot_id,status,checked_at,published_at) SELECT ?,?,?,NULL,'pending',?,NULL WHERE ${liveGuard} ON CONFLICT(site_id,day) DO UPDATE SET checked_at=excluded.checked_at WHERE vane_search_days.status='pending'`,c.site_id,date,c.property,now,...guardValues(c,lockId))));
 }
}
export async function publishDays(env:Env,c:Connection,lockId:string,days:{date:string;rows:SearchRow[]}[],now:number) {
 if(!days.length)return;
 const snapshotId=uid(),data=days.flatMap(day=>day.rows.map(row=>({date:day.date,...row})));
 try {
  // Stage bounded SQL batches; readers keep each day's former pointer until publication.
  for(let i=0;i<data.length;i+=50) {
   await current(env,c,lockId);
   await env.DB.batch(data.slice(i,i+50).map(row=>statement(env,`INSERT INTO vane_search_rows(site_id,day,snapshot_id,grain,query,page,path,clicks,impressions,ctr,position) SELECT ?,?,?,?,?,?,?,?,?,?,? WHERE ${liveGuard}`,c.site_id,row.date,snapshotId,row.grain,row.query,row.page,row.path,row.clicks,row.impressions,row.ctr,row.position,...guardValues(c,lockId))));
  }
  for(let i=0;i<days.length;i+=50) {
   await current(env,c,lockId);
   await env.DB.batch(days.slice(i,i+50).map(({date})=>statement(env,`INSERT INTO vane_search_days(site_id,day,property,snapshot_id,status,checked_at,published_at) SELECT ?,?,?,?,'final',?,? WHERE ${liveGuard} ON CONFLICT(site_id,day) DO UPDATE SET property=excluded.property,snapshot_id=excluded.snapshot_id,status='final',checked_at=excluded.checked_at,published_at=COALESCE(vane_search_days.published_at,excluded.published_at)`,c.site_id,date,c.property,snapshotId,now,now,...guardValues(c,lockId))));
  }
 } catch(error) {
  await statement(env,'DELETE FROM vane_search_rows WHERE snapshot_id=? AND NOT EXISTS(SELECT 1 FROM vane_search_days d WHERE d.site_id=vane_search_rows.site_id AND d.day=vane_search_rows.day AND d.snapshot_id=vane_search_rows.snapshot_id)',snapshotId).run();
  throw error;
 }
}

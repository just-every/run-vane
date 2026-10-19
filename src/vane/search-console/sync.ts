import { clock } from '../clock'
import { inScope, insist, role, rows, site, statement, uid, VaneError, type Actor, type Env } from '../core'
import { DAY, dates, oldestDate, rangeOf, shift, sourceToday } from './dates'
import { accessToken, queryAll } from './google'
import { normalizedRows } from './labels'
import { pendingDays, publishDays } from './snapshots'
import { connection, current, guardValues, liveGuard } from './storage'
import type { Connection, GoogleRow, Range, SourceDay } from './types'

async function syncConnection(env:Env,c:Connection,now:number,requested?:Range):Promise<void> {
 insist(c.property,'search_property','Select a Google Search Console property first.');
 const lockId=uid();
 const claimed=await statement(env,'UPDATE vane_search_connections SET lock_id=?,lock_until=? WHERE site_id=? AND generation=? AND (lock_id IS NULL OR lock_until<=?)',lockId,now+3600000,c.site_id,c.generation,now).run();
 insist(claimed.meta.changes===1,'search_sync_busy','A Search Console sync is already running.',409);
 try {
  const value=await site(env,c.site_id),today=sourceToday(now),oldest=oldestDate(now);
  const range=requested??rangeOf(shift(today,c.last_sync===null?-29:-6),shift(today,1),now);
  const wanted=new Set(dates(range));
  // Every unresolved source date remains eligible for the first daily sync after Google publishes it.
  if(!requested)for(const p of await rows<{day:string}>(env,"SELECT day FROM vane_search_days WHERE site_id=? AND status='pending' AND day>=? AND day<=?",c.site_id,oldest,today))wanted.add(p.day);
  const allDates=[...wanted].sort(),from=allDates[0]!,to=allDates[allDates.length-1]!;
  const access=await accessToken(env,c,lockId);
  // A date-only query establishes source publication; absent days are unknown, never fabricated zeroes.
  const summary=await queryAll(env,c,lockId,access,from,to,['date']);
  const byDate=new Map<string,GoogleRow>();
  for(const row of summary){const date=row.keys![0]!;insist(/^\d{4}-\d{2}-\d{2}$/.test(date)&&date>=from&&date<=to&&!byDate.has(date),'search_google_response','Google returned an invalid source date.',502);byDate.set(date,row);}
  const existing=new Map((await rows<SourceDay>(env,'SELECT * FROM vane_search_days WHERE site_id=? AND day>=? AND day<=?',c.site_id,from,to)).map(d=>[d.day,d]));
  const newlyPublished=allDates.filter(date=>byDate.has(date)&&!(existing.get(date)?.status==='final'&&existing.get(date)?.property===c.property));
  const detailMaps:Map<string,GoogleRow[]>[]=[];
  if(newlyPublished.length) {
   // Date stays in every grain. A whole-range source request avoids multiplying 500 historical dates into
   // thousands of Worker subrequests; actual Google pagination is followed for each independent grain.
   const start=newlyPublished[0]!,end=newlyPublished[newlyPublished.length-1]!;
   const details=await Promise.all([
    queryAll(env,c,lockId,access,start,end,['date','query']),
    queryAll(env,c,lockId,access,start,end,['date','page']),
    queryAll(env,c,lockId,access,start,end,['date','query','page'])
   ]);
   for(const detail of details) {
    const map=new Map<string,GoogleRow[]>();
    for(const row of detail) {
     const date=row.keys![0]!;
     insist(date>=start&&date<=end,'search_google_response','Google returned an out-of-range detail date.',502);
     const list=map.get(date)??[];list.push({...row,keys:row.keys!.slice(1)});map.set(date,list);
    }
    detailMaps.push(map);
   }
  }
  await pendingDays(env,c,lockId,allDates.filter(date=>!byDate.has(date)),now);
  await publishDays(env,c,lockId,newlyPublished.map(date=>({date,rows:[...normalizedRows(value,'overall',[byDate.get(date)!]),...normalizedRows(value,'query',detailMaps[0]!.get(date)??[]),...normalizedRows(value,'page',detailMaps[1]!.get(date)??[]),...normalizedRows(value,'query_page',detailMaps[2]!.get(date)??[])]})),now);
  await current(env,c,lockId);
  // Purge only rows with no published pointer under this site's exclusive sync lease.
  await statement(env,`DELETE FROM vane_search_rows WHERE site_id=? AND NOT EXISTS(SELECT 1 FROM vane_search_days d WHERE d.site_id=vane_search_rows.site_id AND d.day=vane_search_rows.day AND d.snapshot_id=vane_search_rows.snapshot_id) AND ${liveGuard}`,c.site_id,...guardValues(c,lockId)).run();
  await statement(env,'UPDATE vane_search_connections SET last_sync=?,next_sync=?,last_error=NULL,lock_id=NULL,lock_until=NULL WHERE site_id=? AND generation=? AND lock_id=?',now,now+DAY,c.site_id,c.generation,lockId).run();
 } catch(error) {
  const message=error instanceof VaneError?error.message:'Google Search Console sync could not complete.';
  await statement(env,'UPDATE vane_search_connections SET next_sync=?,last_error=?,lock_id=NULL,lock_until=NULL WHERE site_id=? AND generation=? AND lock_id=?',now+DAY,message,c.site_id,c.generation,lockId).run();
  throw error;
 }
}
export async function runNow(env:Env,actor:Actor,siteId:string,range?:Range):Promise<void> {
 role(actor);inScope(actor,siteId);await site(env,siteId);
 const now=clock(),c=await connection(env,siteId);insist(c,'search_connection','Connect Google Search Console first.');
 if(range)rangeOf(range.from,range.to,now);
 await syncConnection(env,c,now,range);
}
export async function sync(env:Env,now=clock()):Promise<void> {
 await statement(env,'DELETE FROM vane_search_oauth_states WHERE expires_at<=?',now).run();
 const due=await rows<Connection>(env,'SELECT * FROM vane_search_connections WHERE property IS NOT NULL AND next_sync<=? AND (lock_id IS NULL OR lock_until<=?) ORDER BY next_sync',now,now);
 let failures=0;
 // Independent sites continue even if Google refuses one property's credentials; every failure is durable and surfaced.
 for(const c of due)try {await syncConnection(env,c,now)}catch {failures++}
 if(failures)throw new VaneError('search_sync_failed',`${failures} Google Search Console connection(s) failed to sync. Open site settings for the recorded error.`,502);
}

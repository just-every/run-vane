import { clock } from '../clock'
import { inScope, role, rows, site, type Actor, type Env } from '../core'
import { dates, oldestDate, storedRange, shift, sourceToday } from './dates'
import { connection } from './storage'
import { queryLabel } from './labels'
import type { GoogleProperty, Metrics, SearchEnv, SearchRow, SourceDay } from './types'

function aggregate(data:SearchRow[],grain:SearchRow['grain'],keys:('query'|'page'|'path')[]):(SearchRow&Metrics)[] {
 const map=new Map<string,SearchRow>();
 for(const row of data.filter(r=>r.grain===grain)) {
  const key=JSON.stringify(keys.map(k=>row[k])),prior=map.get(key);
  if(!prior)map.set(key,{...row});
  else {const impressions=prior.impressions+row.impressions;prior.position=impressions?(prior.position*prior.impressions+row.position*row.impressions)/impressions:0;prior.clicks+=row.clicks;prior.impressions=impressions;prior.ctr=impressions?prior.clicks/impressions:0;}
 }
 return [...map.values()].sort((a,b)=>b.clicks-a.clicks||b.impressions-a.impressions||a.query.localeCompare(b.query)||a.page.localeCompare(b.page));
}
// Internal report service helper. The native report door authenticates and scopes its site before calling this.
export async function queryPaths(env:Env,siteId:string,query:string,from:string,to:string):Promise<string[]> {
 storedRange(from,to);await site(env,siteId);
 if(queryLabel(query)!==query)return [];
 const c=await connection(env,siteId);
 if(c&&!c.property)return [];
 const matches=await rows<{path:string}>(env,`SELECT DISTINCT r.path FROM vane_search_rows r JOIN vane_search_days d ON d.snapshot_id=r.snapshot_id AND d.site_id=r.site_id AND d.day=r.day WHERE d.site_id=? AND d.day>=? AND d.day<? AND d.status='final' AND r.grain='query_page' AND r.query=? AND r.path<>''${c?.property?' AND d.property=?':''} ORDER BY r.path`,...(c?.property?[siteId,from,to,query,c.property]:[siteId,from,to,query]));
 return matches.map(r=>r.path);
}
const metrics=(row:Metrics):Metrics=>({clicks:row.clicks,impressions:row.impressions,ctr:row.ctr,position:row.position})
export async function report(env:Env,actor:Actor,siteId:string,from:string,to:string) {
 role(actor,['owner','admin','member']);inScope(actor,siteId);await site(env,siteId);
 const now=clock(),range=storedRange(from,to),c=await connection(env,siteId),canManage=actor.role==='owner',configured=Boolean((env as SearchEnv).GOOGLE_CLIENT_ID&&(env as SearchEnv).GOOGLE_CLIENT_SECRET);
 // A new OAuth grant waits for explicit owner selection; old-property history must not appear as the new source.
 const selected=c?c.property:null,visible=!c||Boolean(selected),propertySql=selected?' AND d.property=?':'',params=selected?[siteId,from,to,selected]:[siteId,from,to];
 const stored=visible?await rows<SourceDay>(env,`SELECT d.* FROM vane_search_days d WHERE d.site_id=? AND d.day>=? AND d.day<?${propertySql} ORDER BY d.day`,...params):[];
 const source=visible?await rows<SearchRow&{day:string}>(env,`SELECT r.* FROM vane_search_rows r JOIN vane_search_days d ON d.snapshot_id=r.snapshot_id AND d.site_id=r.site_id AND d.day=r.day WHERE d.site_id=? AND d.day>=? AND d.day<? AND d.status='final'${propertySql} ORDER BY d.day`,...params):[];
 const storedMap=new Map(stored.map(d=>[d.day,d])),overallDays=new Map(source.filter(r=>r.grain==='overall').map(r=>[r.day,r]));
 const today=sourceToday(now),oldest=oldestDate(now);
 const days=dates(range).map(date=>{
  const d=storedMap.get(date),row=overallDays.get(date);
  const live=date>=oldest&&date<=today;
  const status=d?.status==='final'?'final':live&&(d?.status==='pending'||selected&&date>=shift(today,-3))?'pending':'not-synced';
  return {day:date,status,checkedAt:d?.checked_at??null,publishedAt:d?.published_at??null,...(row?metrics(row):{})};
 });
 const overall=aggregate(source,'overall',[])[0];
 const coverage=visible?(await rows<{firstDate:string|null;lastDate:string|null}>(env,`SELECT MIN(d.day) AS firstDate,MAX(d.day) AS lastDate FROM vane_search_days d WHERE d.site_id=? AND d.status='final'${selected?' AND d.property=?':''}`,...(selected?[siteId,selected]:[siteId])))[0]:null;
 const nextSync=selected?c!.next_sync:null;
 return {
  connection:{status:!c?'disconnected':selected?'connected':'choose-property',property:selected,connectedAt:c?.connected_at??null,lastSync:c?.last_sync??null,nextSync,error:c?.last_error??null,canManage,configured},
  properties:canManage&&c?JSON.parse(c.properties_json) as GoogleProperty[]:[],from,to,timeZone:'America/Los_Angeles',
  overall:overall?metrics(overall):null,days,
  queries:aggregate(source,'query',['query']).map(r=>({query:r.query,...metrics(r)})),
  pages:aggregate(source,'page',['page','path']).map(r=>({page:r.page,path:r.path,...metrics(r)})),
  queryPages:aggregate(source,'query_page',['query','page','path']).map(r=>({query:r.query,page:r.page,path:r.path,...metrics(r)})),
  pendingDates:days.filter(d=>d.status==='pending').map(d=>d.day),nextSync,
  coverage:coverage??{firstDate:null,lastDate:null},
  sourceNote:'Google Search Console web search, finalized source data in Pacific dates. Google typically publishes 2–3 days later. Absent dates remain pending, not zero. Query and page breakdowns are source-limited top rows and can omit anonymized searches; their sums can differ from property totals. CTR is clicks / impressions; position is weighted by source impressions. Page labels omit query strings and redact personal path segments; query labels follow Vane’s privacy rules.'
 };
}

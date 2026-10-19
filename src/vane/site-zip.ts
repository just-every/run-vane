import { aggregateCsvRow, importedReports } from './movein/aggregate-reports'
import { rows, type Env, type Site } from './core'
import { timedFrom } from './visits'
import { sourceNameSql } from './sources'
import { toCsv } from './csv'
import { zip } from './zip'
// API-002: a whole site as a ZIP of CSVs in the layout of Plausible's export (imported_<table>_<first>_<last>.csv,
// one row per site-local date and dimension value). Each file is measured with the visit SQL the dashboard uses
// (METRIC-002/003): visitors are daily-unique hashes, a visit is attributed to its first page load (DASH-004), so
// summing a file's rows over any dates gives the dashboard's figures for them. visit_duration is the visits' total in
// whole seconds and pageviews are the page loads of those visits, as in Plausible's files. Vane collects no location,
// so there is no imported_locations file; direct visits have an empty source, as in Plausible.
const ALL=['0000-01-01','9999-12-31'] as const
const seconds=(ms:unknown)=>Math.round(Number(ms??0)/1000)
type Row=Record<string,unknown>
export async function siteZip(env:Env,value:Site,now:number):Promise<{name:string,bytes:Uint8Array<ArrayBuffer>}> {
 const args=[JSON.stringify([value.id]),ALL[0],ALL[1],null],timed=timedFrom('vane_events'),source=sourceNameSql(value.config.sourceRules,'q.source')
 // Visits grouped by date and the given first-page-load columns (ev holds the browser and system of that load).
 const visits=(columns:Record<string,string>,where='q.starts=1')=>env.DB.prepare(`${timed},vp AS (SELECT day,visitor,visit,COUNT(*) AS pages FROM q GROUP BY day,visitor,visit),
x AS (SELECT q.day,${Object.entries(columns).map(([name,sql])=>`${sql} AS "${name}"`).join(',')},v.visitor,v.visit,v.bounce,v.duration,vp.pages FROM q JOIN v USING(day,visitor,visit) JOIN vp USING(day,visitor,visit) JOIN vane_events ev ON ev.id=q.id WHERE ${where})
SELECT day,${Object.keys(columns).map(name=>`"${name}"`).join(',')},COUNT(DISTINCT visitor) AS visitors,COUNT(*) AS visits,SUM(bounce) AS bounces,SUM(duration) AS duration,SUM(pages) AS pageviews FROM x GROUP BY day,${Object.keys(columns).map(name=>`"${name}"`).join(',')} ORDER BY day,visits DESC`).bind(...args)
 const [days,loads,sources,pages,entries,exits,devices,browsers,systems,custom]=await env.DB.batch<any>([
  env.DB.prepare(`${timed} SELECT day,COUNT(DISTINCT visitor) AS visitors,COUNT(*) AS visits,SUM(bounce) AS bounces,SUM(duration) AS duration FROM v GROUP BY day`).bind(...args),
  // Pageviews per date count every page load, imported ones included, as the dashboard's pageviews do.
  env.DB.prepare(`SELECT day,COUNT(*) AS pageviews FROM (SELECT day FROM vane_events WHERE site_id=?1 AND kind='pageview' UNION ALL SELECT day FROM vane_import_events WHERE site_id=?1 AND kind='pageview') GROUP BY day ORDER BY day`).bind(value.id),
  visits({source:`CASE WHEN ${source}='direct' THEN '' ELSE ${source} END`,referrer:`COALESCE(q.referrer,'')`,utm_source:`COALESCE(q.utm_source,'')`,utm_medium:`COALESCE(q.utm_medium,'')`,utm_campaign:`COALESCE(NULLIF(q.campaign,'none'),'')`,utm_content:`COALESCE(q.utm_content,'')`,utm_term:`COALESCE(q.utm_term,'')`}),
  env.DB.prepare(`${timed} SELECT day,COALESCE(hostname,'') AS hostname,path AS page,COUNT(DISTINCT visitor||' '||visit) AS visits,COUNT(DISTINCT visitor) AS visitors,COUNT(*) AS pageviews FROM q GROUP BY day,hostname,path ORDER BY day,pageviews DESC,page`).bind(...args),
  visits({entry_page:'q.path'}),visits({exit_page:'q.path'},'q.ends=1'),
  visits({device:`COALESCE(ev.device,'')`}),visits({browser:`COALESCE(ev.browser,'')`,browser_version:`COALESCE(ev.browser_version,'')`}),visits({operating_system:`COALESCE(ev.os,'')`,operating_system_version:`COALESCE(ev.os_version,'')`}),
  env.DB.prepare(`SELECT ce.day,ce.name,'' AS link_url,p.path,COUNT(DISTINCT p.visitor) AS visitors,COUNT(*) AS events FROM vane_custom_events ce JOIN vane_events p ON p.id=ce.page_id WHERE ce.site_id=? GROUP BY ce.day,ce.name,p.path ORDER BY ce.day,events DESC,ce.name`).bind(value.id),
 ])
 const totals=new Map<string,Row>(days!.results.map((r:any)=>[r.day,r]))
 const visitorRows=[...new Set([...totals.keys(),...loads!.results.map((r:any)=>r.day as string)])].sort().map(day=>{const t=totals.get(day) as any,l=loads!.results.find((r:any)=>r.day===day) as any;return {date:day,visitors:Number(t?.visitors??0),pageviews:Number(l?.pageviews??0),bounces:Number(t?.bounces??0),visits:Number(t?.visits??0),visit_duration:seconds(t?.duration)}})
 const measured=(rows:any[],columns:string[],names:Record<string,string>={visits:'visits'}):any[]=>rows.map(r=>({date:r.day,...Object.fromEntries(columns.map(c=>[c,r[c]])),visitors:Number(r.visitors),[names.visits!]:Number(r.visits),visit_duration:seconds(r.duration),bounces:Number(r.bounces),pageviews:Number(r.pageviews)}))
 const dates=visitorRows.map(r=>r.date),first=(dates[0]??new Date(now).toISOString().slice(0,10)).replaceAll('-',''),last=(dates.at(-1)??new Date(now).toISOString().slice(0,10)).replaceAll('-','')
 // Each file keeps its header row even when it has no rows, so a reader always sees the declared columns.
 const file=(table:string,columns:string[],rows:Row[])=>({name:`imported_${table}_${first}_${last}.csv`,text:rows.length?toCsv(rows):columns.join(',')+'\r\n'})
 const VISIT=['visitors','visits','visit_duration','bounces','pageviews']
 const files=[
  file('visitors',['date','visitors','pageviews','bounces','visits','visit_duration'],visitorRows),
  file('sources',['date','source','referrer','utm_source','utm_medium','utm_campaign','utm_content','utm_term','pageviews','visitors','visits','visit_duration','bounces'],measured(sources!.results,['source','referrer','utm_source','utm_medium','utm_campaign','utm_content','utm_term']).map(r=>({date:r.date,source:r.source,referrer:r.referrer,utm_source:r.utm_source,utm_medium:r.utm_medium,utm_campaign:r.utm_campaign,utm_content:r.utm_content,utm_term:r.utm_term,pageviews:r.pageviews,visitors:r.visitors,visits:r.visits,visit_duration:r.visit_duration,bounces:r.bounces}))),
  file('pages',['date','hostname','page','visits','visitors','pageviews'],pages!.results.map((r:any)=>({date:r.day,hostname:r.hostname,page:r.page,visits:Number(r.visits),visitors:Number(r.visitors),pageviews:Number(r.pageviews)}))),
  file('entry_pages',['date','entry_page','visitors','entrances','visit_duration','bounces','pageviews'],measured(entries!.results,['entry_page'],{visits:'entrances'})),
  file('exit_pages',['date','exit_page','visitors','visit_exits','visit_duration','bounces','pageviews'],measured(exits!.results,['exit_page'],{visits:'visit_exits'})),
  file('custom_events',['date','name','link_url','path','visitors','events'],custom!.results.map((r:any)=>({date:r.day,name:r.name,link_url:r.link_url,path:r.path,visitors:Number(r.visitors),events:Number(r.events)}))),
  file('devices',['date','device',...VISIT],measured(devices!.results,['device'])),
  file('browsers',['date','browser','browser_version',...VISIT],measured(browsers!.results,['browser','browser_version'])),
  file('operating_systems',['date','operating_system','operating_system_version',...VISIT],measured(systems!.results,['operating_system','operating_system_version'])),
 ]
 const sourceReports=await importedReports(env,[value.id],ALL[0],ALL[1]);
 for(const method of new Set(sourceReports.map(r=>r.report))){const records=sourceReports.filter(r=>r.report===method);files.push({name:`matomo_${method}_${records[0]!.day}_${records.at(-1)!.day}.csv`,text:toCsv(records.map(aggregateCsvRow))})}
 const bingRows=await rows<Record<string,unknown>>(env,'SELECT property,day,kind,query,page,clicks,impressions,CASE WHEN impressions>0 THEN 1.0*clicks/impressions ELSE NULL END AS ctr,CASE WHEN position_weight>0 THEN position_sum/position_weight ELSE NULL END AS position FROM vane_bing_rows WHERE site_id=? ORDER BY day,kind,query,page',value.id);
 if(bingRows.length)files.push({name:'bing_search.csv',text:toCsv(bingRows)});
 const searchRows=await rows<Record<string,unknown>>(env,"SELECT r.day,r.grain,r.query,r.page,r.path,r.clicks,r.impressions,r.ctr,r.position FROM vane_search_rows r JOIN vane_search_days d ON d.site_id=r.site_id AND d.day=r.day AND d.snapshot_id=r.snapshot_id WHERE r.site_id=? AND d.status='final' ORDER BY r.day,r.grain,r.query,r.page",value.id);
 if(searchRows.length)files.push({name:'google_search.csv',text:toCsv(searchRows)});
 return {name:`vane-${value.id}_${first}_${last}.zip`,bytes:zip(files,now)}
}

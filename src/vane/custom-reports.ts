import { visitorKey } from './visitor-key'
import type { Env } from './core'
import { nativePageJoinSql } from './raw/page-joins'
// CONV-002: custom events by name, their properties by event, key and value, and pageview properties by key and
// value, each with its events (or pageviews) and distinct daily visitors, over the report's (possibly filtered,
// DASH-007) page loads: a custom event counts when its page load is in the set.
export async function customReport(env:Env,scope:string,from:string,to:string,events:string) {
 const pages=`(SELECT id,site_id,day,visitor,consented_visitor FROM ${events} WHERE kind='pageview' AND site_id IN (SELECT value FROM json_each(?1)) AND day>=?2 AND day<?3)`,visitors=`COUNT(DISTINCT CASE WHEN p.visitor IS NOT NULL THEN ${visitorKey('p.')} END)`
 const pageJoin=(id:string)=>events==='vane_events'?nativePageJoinSql(id):`JOIN ${pages} p ON p.id=${id}`
 const [names,eventProps,pageProps]=await env.DB.batch<any>([
  env.DB.prepare(`SELECT ce.name AS name,COUNT(*) AS events,${visitors} AS visitors FROM vane_custom_events ce ${pageJoin('ce.page_id')} GROUP BY ce.name ORDER BY events DESC,name`).bind(scope,from,to),
  env.DB.prepare(`SELECT ce.name AS name,pr.key AS key,pr.value AS value,COUNT(*) AS events,${visitors} AS visitors FROM vane_custom_events ce ${pageJoin('ce.page_id')} JOIN vane_event_props pr ON pr.event_id=ce.id GROUP BY 1,2,3 ORDER BY name,key,events DESC,value`).bind(scope,from,to),
  env.DB.prepare(`SELECT pr.key AS key,pr.value AS value,COUNT(*) AS pageviews,${visitors} AS visitors FROM vane_event_props pr ${pageJoin('pr.event_id')} GROUP BY 1,2 ORDER BY key,pageviews DESC,value`).bind(scope,from,to),
 ])
 const n=(rows:any[],fields:string[])=>rows.map(r=>({...r,...Object.fromEntries(fields.map(f=>[f,Number(r[f])]))}))
 return {customEvents:n(names.results,['events','visitors']),eventProps:n(eventProps.results,['events','visitors']),pageProps:n(pageProps.results,['pageviews','visitors'])}
}

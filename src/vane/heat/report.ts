import { inScope, insist, role, rows, site, type Actor, type Env } from '../core'
import { hostOf } from '../paths'
import { heatGeometry, type HeatGeometry } from './geometry'
import { heatSetting, type HeatSetting } from './settings'

export interface HeatCell { x:number; y:number; count:number }
export interface HeatReport {
 siteId:string; origin:string; pages:HeatSetting[]; path:string; from:string; to:string; width:number;
 geometry:HeatGeometry|null; enabled:boolean; clicks:number; cells:HeatCell[];
 scroll:{samples:number; averageScrollDepth:number|null; reached75Share:number|null; bands:{depth:number; count:number; share:number|null}[]}
}
export async function heatReport(env:Env,actor:Actor,input:{siteId:string;path?:string;from:string;to:string;width?:number}):Promise<HeatReport> {
 role(actor);inScope(actor,input.siteId)
 const value=await site(env,input.siteId),pages=await heatSetting(env,actor,input.siteId),path=input.path??pages[0]?.path??'/',width=input.width??1440
 const validDay=(d:string)=>/^\d{4}-\d{2}-\d{2}$/.test(d)&&Number.isFinite(Date.parse(d))&&new Date(d).toISOString().slice(0,10)===d
 insist(validDay(input.from)&&validDay(input.to)&&input.from<input.to,'heat_range','Choose a start date before the exclusive end date.')
 insist(Number.isInteger(width)&&width>=1&&width<=10000,'heat_width','Choose the screenshot viewport width in CSS pixels.')
 insist(/^\/[^?#\s]{0,119}$/.test(path),'heat_path','Choose a page path without a query or fragment.')
 const [cells,layouts,depths]=await Promise.all([
  rows<HeatCell>(env,'SELECT x,y,SUM(count) AS count FROM vane_heat_clicks WHERE site_id=? AND path=? AND day>=? AND day<? AND width=? GROUP BY x,y ORDER BY count DESC,x,y',value.id,path,input.from,input.to,width),
  rows<{geometry_json:string}>(env,'SELECT geometry_json FROM vane_heat_layouts WHERE site_id=? AND path=? AND day>=? AND day<? AND width=? ORDER BY day DESC LIMIT 1',value.id,path,input.from,input.to,width),
  // Exactly METRIC-006: the greatest depth on each page load; NULL (no ping) is not a sample.
  rows<{depth:number;count:number}>(env,"SELECT scroll AS depth,COUNT(*) AS count FROM vane_events WHERE site_id=? AND path=? AND hostname=? AND kind='pageview' AND visitor IS NOT NULL AND at IS NOT NULL AND day>=? AND day<? AND scroll IS NOT NULL GROUP BY scroll ORDER BY scroll",value.id,path,hostOf(value.origin),input.from,input.to),
 ])
 const samples=depths.reduce((n,r)=>n+r.count,0),reached=(d:number)=>depths.reduce((n,r)=>n+(r.depth>=d?r.count:0),0),share=(n:number)=>samples?Math.round(n/samples*1000)/10:null
 return {geometry:layouts.length?heatGeometry(JSON.parse(layouts[0].geometry_json)):null,siteId:value.id,origin:value.origin,pages,path,from:input.from,to:input.to,width,enabled:pages.some(p=>p.path===path),clicks:cells.reduce((n,r)=>n+r.count,0),cells,scroll:{samples,averageScrollDepth:samples?Math.round(depths.reduce((n,r)=>n+r.depth*r.count,0)/samples):null,reached75Share:share(reached(75)),bands:[0,10,20,30,40,50,60,70,75,80,90,100].map(depth=>({depth,count:reached(depth),share:share(reached(depth))}))}}
}

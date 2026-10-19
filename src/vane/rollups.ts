import { atomic, insist, rows, sites, statement, uid, type Actor, type Env, type Site } from './core'
import { auditStatement } from './audit'
import { clock } from './clock'
import { createInsightsService } from './reports'
// DASH-010: a roll-up combines several sites in every report, filter and breakdown. It never de-duplicates people
// across sites: METRIC-001 hashes the site ID into every visitor hash, so visitors and visits are each site's own
// counts summed. Pageviews and goal conversions are exact sums; bounce rate, visit duration and conversion rate are
// recomputed from the combined visits. Ranges use the first member's time zone, and each event keeps its own site's
// local date. Goals are the members' goals by name, and owner grouping rules apply in member order.
export interface Rollup { id:string; name:string; sites:Site[] }
export async function rollups(env:Env):Promise<Rollup[]> {
 const all=await sites(env),list=await rows<{id:string,name:string,site_ids:string}>(env,'SELECT id,name,site_ids FROM vane_rollups ORDER BY created_at')
 // A deleted member site leaves the roll-up; its other members remain.
 return list.map(r=>({id:r.id,name:r.name,sites:(JSON.parse(r.site_ids) as string[]).map(id=>all.find(s=>s.id===id)).filter(Boolean) as Site[]}))
}
export async function rollup(env:Env,id:string):Promise<Rollup> { const value=(await rollups(env)).find(r=>r.id===id);insist(value,'rollup_missing','Roll-up not found.',404);return value }
// Only the owner creates a roll-up; it is recorded in the audit history.
export async function createRollup(env:Env,actor:Actor,input:Record<string,any>):Promise<string> {
 const name=String(input.name??'').trim(),ids=Object.keys(input).filter(key=>key.startsWith('site_')&&input[key]==='on').map(key=>key.slice(5)),known=(await sites(env)).map(s=>s.id)
 insist(name.length>0&&name.length<=80&&!/[<>@]/.test(name),'name','Enter a short roll-up name.')
 insist(ids.length>=2&&ids.length<=20&&ids.every(id=>known.includes(id)),'sites','Choose at least two of your sites.')
 const id=uid();await atomic(env,actor,[statement(env,'INSERT INTO vane_rollups(id,name,site_ids,created_by,created_at) VALUES(?,?,?,?,?)',id,name,JSON.stringify(ids),actor.id,clock()),auditStatement(env,actor.id,'rollup.create',id,`${name}: ${ids.length} sites`)])
 return id
}
// The roll-up reads as one site: the first member's time zone and the members' goals, rules and switches.
export function rollupSite(r:Rollup):Site {
 const first=r.sites[0]!.config,goals=Object.assign({},...r.sites.map(s=>s.config.goals)),scrollGoals=Object.assign({},...r.sites.map(s=>s.config.scrollGoals??{}))
 return {...r.sites[0]!,id:r.id,name:r.name,config:{...first,goals,scrollGoals,origins:[],sourceRules:r.sites.flatMap(s=>s.config.sourceRules??[]),autoEvents:[...new Set(r.sites.flatMap(s=>s.config.autoEvents??[]))],searchParam:r.sites.map(s=>s.config.searchParam).find(Boolean),signalCounter:r.sites.some(s=>s.config.signalCounter)}}
}
// Split by site: every table lists each member's own rows, labelled with the site's name, over the roll-up's dates.
const TABLES:Record<string,string>={sources:'label',campaigns:'label',pages:'label',goalBreakdown:'label',devices:'label',browsers:'label',browserVersions:'label',systems:'label',systemVersions:'label',screens:'label',channels:'label',sourceVisits:'label',referrers:'label',utmSources:'label',utmMediums:'label',utmCampaigns:'label',utmTerms:'label',utmContents:'label',automaticEvents:'label',topPages:'path',entryPages:'path',exitPages:'path',hostnames:'path',sourceReferrers:'source'}
export async function rollupReport(env:Env,r:Rollup,range:Record<string,any>,split:boolean) {
 insist(r.sites.length>0,'rollup_empty','This roll-up has no remaining sites.',404)
 const site=rollupSite(r),report:any=await createInsightsService(env,site,clock(),range as any,r.sites.map(s=>s.id)).list()
 if(!split)return {...report,rollup:{id:r.id,name:r.name,sites:r.sites.map(s=>({id:s.id,name:s.name})),split}}
 const dates={...range,period:null,from:report.from,to:report.to,compare:'custom',compareFrom:report.previousFrom,compareTo:report.previousTo,weekdays:null}
 const parts:any[]=await Promise.all(r.sites.map(s=>createInsightsService(env,{...s,config:{...s.config,goals:site.config.goals,scrollGoals:site.config.scrollGoals}},clock(),dates as any).list()))
 const named=(rows:any[],key:string,i:number)=>rows.map(row=>({...row,[key]:`${r.sites[i]!.name} · ${row[key]}`}))
 for(const [table,key] of Object.entries(TABLES))report[table]=parts.flatMap((p,i)=>named(p[table],key,i))
 report.siteSearch={...report.siteSearch,terms:parts.flatMap((p,i)=>named(p.siteSearch.terms,'term',i)),startPages:parts.flatMap((p,i)=>named(p.siteSearch.startPages,'path',i))}
 return {...report,rollup:{id:r.id,name:r.name,sites:r.sites.map(s=>({id:s.id,name:s.name})),split}}
}

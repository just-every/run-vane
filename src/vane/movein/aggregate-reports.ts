import { visibleImports } from './cutover'
import { rows, site, type Actor, type Env } from '../core'
import { prepare } from '../commands'
import type { AggregateRecord, ImportedDefinition } from './aggregate-types'
import { insist } from '../core'
import { eventName } from '../properties'

export const aggregateCsvRow=(r:AggregateRecord)=>({day:r.day,provider:r.provider,report:r.report,...Object.fromEntries(Object.entries(r.dimensions).map(([k,v])=>['dimension_'+k,v])),...Object.fromEntries(Object.entries(r.metrics).map(([k,v])=>['metric_'+k,v]))})

export async function importedReports(env:Env,siteIds:string[],from:string,to:string):Promise<AggregateRecord[]> {
 const found=await rows<any>(env,`SELECT * FROM ${visibleImports('vane_import_reports')} WHERE site_id IN (SELECT value FROM json_each(?)) AND day>=? AND day<? ORDER BY day,report,id`,JSON.stringify(siteIds),from,to)
 return found.map(r=>({id:r.id,day:r.day,provider:r.provider,report:r.report,dimensions:JSON.parse(r.dimensions_json),metrics:JSON.parse(r.metrics_json),definitions:JSON.parse(r.definitions_json)}))
}
export async function prepareImportedGoal(env:Env,actor:Actor,p:any) {
 const value=await site(env,String(p.siteId)),r=(await rows<{definitions_json:string}>(env,'SELECT definitions_json FROM vane_import_reports WHERE site_id=? AND id=?',value.id,String(p.recordId)))[0]
 insist(r,'import_goal','This imported definition is no longer available.',404)
 const d=(JSON.parse(r.definitions_json) as ImportedDefinition[]).find(d=>d.name===p.name)
 insist(d&&!d.incomplete,'import_goal','Complete the source definition before preparing this goal.')
 const config={...value.config}
 const name=eventName(d.name),event=eventName(d.kind==='pageview'?d.name:d.pattern??d.name)
 insist(!Object.hasOwn(config.goals,name)&&!Object.hasOwn(config.scrollGoals??{},name),'import_goal','A native goal already has this name; review its settings before replacing it.',409)
 config.customGoals={...config.customGoals,[name]:{event,...(d.kind==='pageview'?{path:d.pattern}:{}),revenue:d.kind==='revenue',currency:d.currency,source:'Matomo Goals.getGoals'}}
 return prepare(env,actor,'site.configure',{siteId:value.id,name:value.name,origin:value.origin,config,customGoals:config.customGoals},'app')
}

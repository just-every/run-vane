import { scans } from '../cutover/scan'
import { allow, inScope, insist, rows, site, type Actor, type Config, type Env } from '../core'
import { prepare } from '../commands'
import { eventName } from '../properties'
import { plausibleCurrency } from './plausible-definitions'
import type { PlausibleDefinition, RecoveredDefinition } from './plausible-types'

type DefinitionConfig=Config
export async function importedDefinitions(env:Env,actor:Actor,siteId:string):Promise<RecoveredDefinition[]> {
 allow(actor,'viewer');inScope(actor,siteId);const current=await site(env,siteId);
 const [reports,events]=await Promise.all([rows<any>(env,"SELECT id,provider,definitions_json,metrics_json FROM vane_import_reports WHERE site_id=? AND provider IN ('plausible','matomo') ORDER BY day DESC,id",siteId),rows<{name:string,count:number,revenue_events:number,currencies:string|null}>(env,'SELECT name,COUNT(*) AS count,COUNT(revenue_micros) AS revenue_events,group_concat(DISTINCT currency) AS currencies FROM vane_custom_events WHERE site_id=? GROUP BY name',siteId)]);
 const observed=new Map(events.map(e=>[e.name,e])),by=new Map<string,RecoveredDefinition>();
 for(const r of reports)for(const raw of JSON.parse(r.definitions_json) as any[]){const d:PlausibleDefinition=r.provider==='matomo'?{...raw,source:'Matomo Goals.getGoals',...(['event','revenue'].includes(raw.kind)?{event:raw.pattern??raw.name,pattern:undefined}:{})}:raw;const key=r.provider+':'+(d.kind==='property'?'property:'+d.name:'goal:'+d.name);if(by.has(key))continue;const evidence=observed.get(d.event??d.name),liveEvents=evidence?.count??0,currencies=evidence?.currencies?.split(',')??[];let resolved:PlausibleDefinition=d;if(d.requiresObservation&&liveEvents>0){resolved={...d,incomplete:undefined,kind:evidence!.revenue_events?'revenue':'event',...(evidence!.revenue_events?{currency:currencies.length===1?currencies[0]!:d.currency,currencyConfirmation:true,...(currencies.length!==1?{incomplete:'Matching revenue events use multiple or unknown currencies. Complete the currency explicitly.'}:{})}:{})}}by.set(key,{...resolved,recordId:r.id,liveEvents,...(d.requiresObservation?{liveRevenueCurrencies:currencies}:{}),importedConversions:Number(JSON.parse(r.metrics_json).total_conversions??0)})}
 const pages=(await scans(env,actor,siteId)).flatMap(s=>s.pages);
 return [...by.values()].map(value=>{const d={...value,callSites:pages.flatMap(p=>p.findings.filter(f=>f.name===(value.event??value.name)||value.kind==='property'&&f.properties?.includes(value.name)).map(f=>({url:p.url,at:p.at,kind:f.kind,rewrite:f.rewrite})))};const goal=current.config.customGoals?.[d.name];if(d.kind==='property')return {...d,approved:current.config.propertySources?.[d.name]===d.source};if(goal?.source!==d.source)return d;return {...d,kind:goal.depth?'scroll':goal.path?'pageview':goal.revenue?'revenue':'event',event:goal.path?undefined:goal.event,pattern:goal.path,depth:goal.depth,props:goal.props,currency:goal.currency??d.currency,incomplete:undefined,currencyConfirmation:false,requiresObservation:false,approved:true}})
}
function native(config:DefinitionConfig,d:PlausibleDefinition) {
 if(d.kind==='property'){config.propertyNames=[...new Set([...(config.propertyNames??[]),d.name])];config.propertySources={...config.propertySources,[d.name]:d.source};return}
 insist(!Object.hasOwn(config.goals,d.name)&&!Object.hasOwn(config.scrollGoals??{},d.name)&&!Object.hasOwn(config.customGoals??{},d.name),'import_definition','A native goal already has this name. Review its settings before replacing it.',409);
 config.customGoals={...config.customGoals,[d.name]:{event:d.event??d.name,...(d.pattern?{path:d.pattern}:{}),...(d.depth?{depth:d.depth}:{}),...(d.props?{props:d.props}:{}),revenue:d.kind==='revenue',currency:d.currency,source:d.source}}
}
export async function prepareImportedDefinition(env:Env,actor:Actor,p:any) {
 allow(actor,'analyst');inScope(actor,String(p.siteId));const value=await site(env,String(p.siteId)),definitions=await importedDefinitions(env,actor,value.id),original=definitions.find(d=>d.recordId===p.recordId&&d.name===p.name);insist(original,'import_definition','This imported definition is no longer available.',404);
 let d:PlausibleDefinition={...original};
 if(p.complete===true||p.complete==='on'){
  insist(['event','revenue','pageview','scroll'].includes(p.kind),'import_definition','Choose the completed goal type.');
  d={name:original.name,kind:p.kind,currency:plausibleCurrency(p.currency||original.currency),source:original.source,...(p.kind==='event'||p.kind==='revenue'?{event:eventName(p.event)}:{pattern:String(p.pattern??'')}),...(p.kind==='scroll'?{depth:Number(p.depth)}:{}),...(p.props?{props:typeof p.props==='string'?JSON.parse(p.props):p.props}:{})};
  d={...d,incomplete:undefined,requiresObservation:false,currencyConfirmation:false}
 }
 insist(!d.incomplete,'import_definition','Complete the source definition before preparing it.');
 if(d.currencyConfirmation)insist(p.confirmCurrency===true||p.confirmCurrency==='on','import_currency','Confirm the recovered live revenue currency before preparing the goal.');
 if(d.kind==='revenue'&&p.currency)d.currency=plausibleCurrency(p.currency);
 const config:DefinitionConfig={...value.config};native(config,d);
 return prepare(env,actor,'site.configure',{siteId:value.id,name:value.name,origin:value.origin,config,customGoals:config.customGoals,goals:config.goals,scrollGoals:config.scrollGoals,propertyNames:config.propertyNames,propertySources:config.propertySources},'app')
}
export async function prepareRebuiltFunnel(env:Env,actor:Actor,p:any) {
 allow(actor,'analyst');inScope(actor,String(p.siteId));const value=await site(env,String(p.siteId)),definitions=(await importedDefinitions(env,actor,value.id)).filter(d=>d.kind!=='property'),names=Array.isArray(p.steps)?p.steps.map(String):String(p.steps??'').split(/\r?\n/).map(s=>s.trim()).filter(Boolean);
 insist(names.length>=2&&names.length<=8,'import_funnel','Paste 2 to 8 recovered goal display names in order, one per line.');
 const config:DefinitionConfig={...value.config};
 for(const name of names){const source=config.customGoals?.[name]?.source;const matching=definitions.filter(d=>d.name===name&&(!source||d.source===source));insist(matching.length===1&&!matching[0]!.incomplete,'import_funnel',`Complete the recovered goal “${name}” before rebuilding this funnel.`);const d=matching[0]!;if(!config.customGoals?.[name]&&!config.goals[name]&&!config.scrollGoals?.[name]){if(d.currencyConfirmation)insist(p.confirmCurrency===true||p.confirmCurrency==='on','import_currency','Confirm the export revenue currency before preparing the funnel.');native(config,d)}}
 const funnel={name:String(p.funnelName??'').trim(),steps:names.map((name:string)=>'goal:'+name)},funnels=[...(config.funnels??[]),funnel];config.funnels=funnels;
 return prepare(env,actor,'site.configure',{siteId:value.id,name:value.name,origin:value.origin,config,customGoals:config.customGoals,goals:config.goals,scrollGoals:config.scrollGoals,propertyNames:config.propertyNames,propertySources:config.propertySources,funnels},'app')
}

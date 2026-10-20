import { insist } from '../core'
import { cleanProps, eventName } from '../properties'
import { pathAllowed, storedPath } from '../paths'
import { localDate, plainText } from '../annotations'
import { csvRows } from './csv'
import type { ImportSite, SitePolicy } from './types'
import type { PlausibleDefinition, PlausibleRecord, PlausibleSource } from './plausible-types'

// Dashboard headers and default goal names are defined by Plausible's own exporter:
// https://github.com/plausible/analytics/blob/master/lib/plausible/stats/dashboard/csv_export.ex
// API fields: https://plausible.io/docs/sites-api and https://plausible.io/docs/stats-api
const SOURCES:PlausibleSource[]=['Plausible dashboard conversions.csv','Plausible dashboard custom_props.csv','Plausible Sites API (Stats key)','Plausible Sites API (Enterprise key)']
const numeric=['unique_conversions','total_conversions']
const object=(v:unknown):Record<string,any>=>{insist(v&&typeof v==='object'&&!Array.isArray(v),'plausible','Plausible must return an object.');return v as Record<string,any>}
export const plausibleCurrency=(v:unknown)=>{insist(typeof v==='string'&&Intl.supportedValuesOf('currency').includes(v),'currency','Choose an ISO currency.');return v}
const property=(v:unknown)=>{insist(typeof v==='string'&&/^[a-z0-9_-]{1,40}$/.test(v),'plausible_property','This property name needs completion to meet Vane’s property rules.');return v}
function path(v:unknown,policy:SitePolicy) {
 insist(typeof v==='string'&&/^\/[A-Za-z0-9_\-/*.:]{0,119}$/.test(v),'plausible_path','A recovered goal needs a path or wildcard without queries.');
 const clean=storedPath(policy,v);insist(clean===v&&pathAllowed(policy,v),'plausible_path','The source goal does not fit this site’s path and privacy settings.');return clean
}
function conditions(v:unknown) {
 const input=object(v??{}),clean=cleanProps(input);insist(clean.dropped===0&&clean.kept.length===Object.keys(input).length,'plausible_props','Complete property conditions that Vane’s privacy rules cannot keep.');return Object.fromEntries(clean.kept)
}
function csv(text:unknown) {
 insist(typeof text==='string'&&new TextEncoder().encode(text).length<=2_000_000,'plausible_csv','Choose a CSV file smaller than 2 MB.');
 const [header,...rows]=csvRows(text.replace(/^\uFEFF/,''));insist(header&&new Set(header).size===header.length,'plausible_csv','The CSV needs distinct column headers.');
 insist(rows.length<=500&&rows.every(r=>r.length===header.length),'plausible_csv','Use at most 500 complete CSV rows.');
 return {header,rows:rows.map(r=>Object.fromEntries(header.map((h,i)=>[h,r[i]!])))}
}
function metrics(row:Record<string,string>) {
 const out:Record<string,number>={};for(const key of numeric){const raw=row[key];if(raw===undefined||raw===''||raw==='null')continue;insist(/^-?\d+(?:\.\d+)?$/.test(raw),'plausible_metric','Use unformatted numeric metrics in the dashboard CSV.');const n=Number(raw);insist(Number.isFinite(n)&&Math.abs(n)<=Number.MAX_SAFE_INTEGER&&(key.includes('revenue')||n>=0),'plausible_metric','Invalid source metric.');if(key.endsWith('conversions'))insist(Number.isSafeInteger(n),'plausible_metric','Conversion counts must be integers.');out[key]=n}return out
}
function defaultGoal(name:string,currency:string,policy:SitePolicy):PlausibleDefinition {
 const base={name,currency,source:'Plausible dashboard conversions.csv' as const},scroll=name.match(/^Scroll (\d{1,3})% on (\/.*)$/),page=name.match(/^Visit (\/.*)$/)
 if(scroll){const depth=Number(scroll[1]);insist(depth>=1&&depth<=100,'plausible_depth','Complete the source scroll threshold.');return {...base,kind:'scroll',pattern:path(scroll[2],policy),depth}}
 if(page)return {...base,kind:'pageview',pattern:path(page[1],policy)}
 return {...base,kind:'event',event:name,requiresObservation:true,incomplete:'Confirm the event name with a matching live event, or complete this renamed goal.'}
}
export function normalizePlausible(document:unknown,_site:ImportSite,policy:SitePolicy):PlausibleRecord[]|null {
 const input=document as any;if(!input||!['vane-plausible-dashboard/1','vane-plausible-api/1','vane-plausible-normalized/1'].includes(input.format))return null
 if(input.format==='vane-plausible-normalized/1')return validateRecords(input.records,policy)
 const day=localDate(input.day),currency=plausibleCurrency(input.currency??policy.currency??'USD'),records:PlausibleRecord[]=[]
 const row=(report:PlausibleRecord['report'],definition:PlausibleDefinition,measures:Record<string,number>={})=>records.push({id:'',day,provider:'plausible',report,dimensions:{[report==='Plausible.properties'?'property':'goal']:definition.name},metrics:measures,definitions:[definition]})
 if(input.format==='vane-plausible-dashboard/1'){
  const files=object(input.files),conversions=csv(files['conversions.csv']);insist(conversions.header.includes('name'),'plausible_csv','conversions.csv must have Plausible’s name column.');
  for(const raw of conversions.rows){const name=eventName(raw.name),m=metrics(raw);row('Plausible.conversions',defaultGoal(name,currency,policy),m)}
  if(files['custom_props.csv']!==undefined){const props=csv(files['custom_props.csv']);insist(props.header.includes('property')&&props.header.includes('value'),'plausible_csv','custom_props.csv needs property and value columns.');for(const name of new Set(props.rows.map(r=>property(r.property))))row('Plausible.properties',{name,kind:'property',currency,source:'Plausible dashboard custom_props.csv'})}
 }else{
  insist(input.keyType==='stats'||input.keyType==='enterprise','plausible_key','Choose a Stats API or Enterprise Sites API key.');const source:PlausibleSource=input.keyType==='stats'?'Plausible Sites API (Stats key)':'Plausible Sites API (Enterprise key)'
  const goals=object(input.goals).goals,properties=object(input.properties).custom_properties,revenue=object(input.revenue)
  insist(Array.isArray(goals)&&goals.length<=500&&Array.isArray(properties)&&properties.length<=500&&Array.isArray(revenue.results),'plausible_api','Plausible returned incomplete definitions.');
  const query=object(revenue.query);insist(JSON.stringify(query.dimensions)==='["event:goal"]'&&JSON.stringify(query.metrics)==='["total_revenue"]','plausible_revenue','Read revenue by goal with Stats API v2.');
  const currencies=new Map<string,string>(),revenueRows=new Set<string>(),warnings=revenue.meta?.metric_warnings?.total_revenue,unavailable=Boolean(warnings&&warnings.code!=='no_revenue_goals_matching');for(const r of revenue.results){insist(Array.isArray(r.dimensions)&&r.dimensions.length===1&&Array.isArray(r.metrics)&&r.metrics.length===1,'plausible_revenue','Invalid revenue result.');revenueRows.add(eventName(r.dimensions[0]));if(r.metrics[0]!==null){const money=object(r.metrics[0]);insist(typeof money.value==='number'&&Number.isFinite(money.value),'plausible_revenue','Invalid source revenue.');currencies.set(eventName(r.dimensions[0]),plausibleCurrency(money.currency))}}
  for(const raw of goals){const g=object(raw),name=eventName(g.display_name),props=conditions(g.custom_props),base={name,currency,source,...(Object.keys(props).length?{props}:{})};let definition:PlausibleDefinition;
   if(g.goal_type==='page')definition={...base,kind:'pageview',pattern:path(g.page_path,policy)}
   else if(g.goal_type==='scroll'){const match=name.match(/^Scroll (\d{1,3})% on \/.+$/),depth=match?Number(match[1]):undefined;definition={...base,kind:'scroll',pattern:path(g.page_path,policy),...(depth&&depth<=100?{depth}:{incomplete:'Complete the scroll threshold; Plausible’s listing does not expose it.'})}}
   else {insist(g.goal_type==='event','plausible_goal','Unsupported Plausible goal type.');const event=eventName(g.event_name),money=currencies.get(name);definition={...base,kind:money?'revenue':'event',event,currency:money??currency,...(!money&&(unavailable||!revenueRows.has(name))?{incomplete:'The revenue query did not establish whether this event is a revenue goal. Complete its type and currency.'}:{})}}
   row('Plausible.conversions',definition)
  }
  for(const p of properties){const name=property(object(p).property);row('Plausible.properties',{name,kind:'property',currency,source})}
 }
 return validateRecords(records,policy)
}
function validateRecords(input:unknown,policy:SitePolicy):PlausibleRecord[] {
 insist(Array.isArray(input)&&input.length>0&&input.length<=500,'plausible_rows','Import 1 to 500 definition rows.');
 const found=new Set<string>();return input.map(raw=>{const r=object(raw);insist(r.provider==='plausible'&&['Plausible.conversions','Plausible.properties'].includes(r.report)&&Array.isArray(r.definitions)&&r.definitions.length===1,'plausible_row','Invalid Plausible definition row.');const d=object(r.definitions[0]),name=d.kind==='property'?property(d.name):eventName(d.name);insist(SOURCES.includes(d.source)&&['pageview','scroll','event','revenue','property'].includes(d.kind),'plausible_definition','Invalid recovered definition.');
  const clean:PlausibleDefinition={name,kind:d.kind,currency:plausibleCurrency(d.currency),source:d.source};if(d.pattern!==undefined)clean.pattern=path(d.pattern,policy);if(d.event!==undefined)clean.event=eventName(d.event);if(d.depth!==undefined){insist(Number.isInteger(d.depth)&&d.depth>=1&&d.depth<=100,'plausible_depth','Choose a whole scroll percentage from 1 to 100.');clean.depth=d.depth}if(d.props)clean.props=conditions(d.props)
  insist(d.kind!=='pageview'||clean.pattern,'plausible_definition','A page goal needs its source path.');insist(d.kind!=='scroll'||clean.pattern,'plausible_definition','A scroll goal needs its source path.');insist(!['event','revenue'].includes(d.kind)||clean.event,'plausible_definition','An event goal needs its source event name.');
  if(d.incomplete)clean.incomplete=plainText(d.incomplete,240,'plausible_definition','Use a plain completion reason.');if(d.kind==='scroll'&&!clean.depth)clean.incomplete='Complete the scroll threshold.';
  if(d.source==='Plausible dashboard conversions.csv'&&['event','revenue'].includes(d.kind)){clean.requiresObservation=true;clean.incomplete='Confirm the event name with a matching live event, or complete this renamed goal.';if(d.kind==='revenue')clean.currencyConfirmation=true}
  const key=r.report+':'+name;insist(!found.has(key),'plausible_duplicate','Duplicate source definition.');found.add(key);const measures=object(r.metrics),m:Record<string,number>={};for(const [k,v] of Object.entries(measures)){insist(numeric.includes(k)&&typeof v==='number'&&Number.isFinite(v)&&Math.abs(v)<=Number.MAX_SAFE_INTEGER,'plausible_metric','Invalid definition metric.');m[k]=v}
  return {id:'',day:localDate(r.day),provider:'plausible',report:r.report,dimensions:{[d.kind==='property'?'property':'goal']:name},metrics:m,definitions:[clean]}
 })
}

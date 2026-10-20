import { inScope, insist, role, site as loadSite, type Actor, type Env } from '../core'
import { localDate } from '../annotations'
import { pathAllowed, storedPath } from '../paths'
import { csvRows } from './csv'
import { normalizePlausible, plausibleCurrency } from './plausible-definitions'
import { readPlausible } from './plausible-reader'
import type { AggregateRecord } from './aggregate-types'
import type { ImportSite, SitePolicy } from './types'

// Published dashboard layout (including column overrides), and the public v2 API:
// https://github.com/plausible/analytics/blob/master/lib/plausible/stats/dashboard/csv_export.ex
// https://github.com/plausible/analytics/blob/master/assets/js/dashboard/stats/csv-export/csv-export-body.ts
// https://plausible.io/docs/stats-api
const reports:Record<string,{dimensions:string[],api:string[]}> = {
 visitors:{dimensions:['date'],api:['time:day']},
 pages:{dimensions:['page'],api:['event:page']},
 entry_pages:{dimensions:['entry_page'],api:['visit:entry_page']},
 exit_pages:{dimensions:['exit_page'],api:['visit:exit_page']},
 browsers:{dimensions:['browser'],api:['visit:browser']},
 browser_versions:{dimensions:['browser','browser_version'],api:['visit:browser','visit:browser_version']},
 operating_systems:{dimensions:['os'],api:['visit:os']},
 operating_system_versions:{dimensions:['os','os_version'],api:['visit:os','visit:os_version']},
 devices:{dimensions:['device'],api:['visit:device']},
 channels:{dimensions:['channel'],api:['visit:channel']},
 sources:{dimensions:['source'],api:['visit:source']},
 referrers:{dimensions:['referrer'],api:['visit:referrer']},
 utm_mediums:{dimensions:['utm_medium'],api:['visit:utm_medium']},
 utm_sources:{dimensions:['utm_source'],api:['visit:utm_source']},
 utm_campaigns:{dimensions:['utm_campaign'],api:['visit:utm_campaign']},
 utm_contents:{dimensions:['utm_content'],api:['visit:utm_content']},
 utm_terms:{dimensions:['utm_term'],api:['visit:utm_term']},
 countries:{dimensions:['country'],api:['visit:country_name']},
 regions:{dimensions:['region'],api:['visit:region_name']},
 cities:{dimensions:['city'],api:['visit:city_name']},
 goalHistory:{dimensions:['goal'],api:['event:goal']},
 propertyHistory:{dimensions:['property','value'],api:[]},
}
const API_METRICS=['visitors','visits','pageviews','views_per_visit','bounce_rate','visit_duration','events','scroll_depth','percentage','conversion_rate','group_conversion_rate','average_revenue','total_revenue','time_on_page']
const CSV_METRICS=[...API_METRICS,'exit_rate','unique_conversions','total_conversions','conversions','unique_entrances','total_entrances','unique_exits','total_exits']
const COUNTS=new Set(['visitors','visits','pageviews','events','unique_conversions','total_conversions','conversions','unique_entrances','total_entrances','unique_exits','total_exits'])
const PERCENTAGES=new Set(['bounce_rate','scroll_depth','percentage','conversion_rate','group_conversion_rate','exit_rate'])
const object=(v:unknown):Record<string,any>=>{insist(v&&typeof v==='object'&&!Array.isArray(v),'plausible_history','Use a Plausible report object.');return v as Record<string,any>}
function number(value:unknown,key:string) {
 insist(typeof value==='number'&&Number.isFinite(value)&&Math.abs(value)<=Number.MAX_SAFE_INTEGER&&(key.endsWith('revenue')||value>=0),'plausible_metric','Invalid Plausible history metric.')
 insist(!COUNTS.has(key)||Number.isSafeInteger(value),'plausible_metric','Source counts must be whole numbers.')
 insist(!PERCENTAGES.has(key)||value<=100,'plausible_metric','Source percentages must be between zero and 100.')
 return value
}
function dimension(value:unknown,key:string,policy:SitePolicy) {
 insist(typeof value==='string'&&value.length<=200&&!/[<>@\u0000-\u001f]/.test(value),'plausible_dimension','A source dimension contains private or unsupported text. Choose a privacy-safe source report.')
 insist(!/%40|\b\d[\d ().-]{5,}\d\b/i.test(value)||['date','browser_version','os_version'].includes(key),'plausible_dimension','A source dimension may contain personal data.')
 if(['page','entry_page','exit_page'].includes(key)){
  insist(/^\/(?!\/)[^?#\s]*$/.test(value)&&storedPath(policy,value)===value&&pathAllowed(policy,value),'plausible_path','A source page does not fit this site’s path and privacy settings. Export a matching report.')
 }
 if(key==='property')insist(/^[a-z0-9_-]{1,40}$/.test(value),'plausible_property','Use a property name supported by this site.')
 // Summary dimensions are never a way to smuggle raw query strings into custody.
 insist(!/[?#]/.test(value)&&!/^https?:\/\/[^/]*@/i.test(value),'plausible_dimension','Remove raw URL queries from the source report.')
 return value
}
function csv(text:unknown) {
 insist(typeof text==='string'&&new TextEncoder().encode(text).length<=2_000_000,'plausible_csv','Choose CSV reports smaller than 2 MB.')
 const [header,...rows]=csvRows(text.replace(/^\uFEFF/,''))
 insist(header&&header.length>0&&new Set(header).size===header.length&&rows.length<=500&&rows.every(r=>r.length===header.length),'plausible_csv','Use distinct headers and at most 500 complete rows per CSV.')
 return {header,rows}
}
function make(day:string,name:string,dimensions:Record<string,string>,metrics:Record<string,number>):AggregateRecord {
 return {id:'',day,provider:'plausible',report:'Plausible.'+name,dimensions,metrics,definitions:[]}
}
function validate(raw:unknown,policy:SitePolicy):AggregateRecord {
 const r=object(raw),name=String(r.report).replace(/^Plausible\./,''),spec=reports[name]
 insist(r.provider==='plausible'&&r.report==='Plausible.'+name&&spec&&Array.isArray(r.definitions)&&r.definitions.length===0,'plausible_history','Invalid Plausible history row.')
 const dimensions:Record<string,string>={},metrics:Record<string,number>={}
 for(const [key,value] of Object.entries(object(r.dimensions))){insist([...spec.dimensions,'currency'].includes(key),'plausible_dimension','Unsupported report dimension.');dimensions[key]=key==='currency'?plausibleCurrency(value):dimension(value,key,policy)}
 insist(spec.dimensions.every(key=>Object.hasOwn(dimensions,key)),'plausible_dimension','A report dimension is missing.')
 for(const [key,value] of Object.entries(object(r.metrics))){insist(CSV_METRICS.includes(key),'plausible_metric','Unsupported source metric.');metrics[key]=number(value,key)}
 insist(!Object.keys(metrics).some(k=>k.endsWith('revenue'))||dimensions.currency,'plausible_currency','Revenue needs its source currency.')
 return make(localDate(r.day),name,dimensions,metrics)
}
function dashboard(input:Record<string,any>,sourceSite:ImportSite,policy:SitePolicy) {
 const files=object(input.files),label=localDate(input.day),out:AggregateRecord[]=[]
 for(const [filename,text] of Object.entries(files)){
  const name=filename==='conversions.csv'?'goalHistory':filename==='custom_props.csv'?'propertyHistory':filename.replace(/\.csv$/,'')
  const spec=reports[name];insist(spec&&filename.endsWith('.csv'),'plausible_csv','Use Plausible’s published dashboard CSV filenames.')
  const {header,rows}=csv(text),columns=name==='visitors'?['date']:name==='propertyHistory'?['property','value']:name.endsWith('versions')?['name','version']:['name']
  insist(columns.every((key,i)=>header[i]===key)&&header.length>columns.length&&header.slice(columns.length).every(key=>CSV_METRICS.includes(key)),'plausible_csv','The CSV does not match Plausible’s dashboard column schema.')
  for(const cells of rows){
   const dims:Record<string,string>={},metrics:Record<string,number>={}
   spec.dimensions.forEach((key,i)=>{dims[key]=dimension(cells[i],key,policy)})
   for(let i=columns.length;i<header.length;i++){const raw=cells[i]!,key=header[i]!;if(raw===''||raw==='null')continue;insist(/^-?\d+(?:\.\d+)?$/.test(raw),'plausible_metric','Use Plausible’s unformatted numeric CSV values.');metrics[key]=number(Number(raw),key)}
   insist(!Object.keys(metrics).some(k=>k.endsWith('revenue')),'plausible_currency','Dashboard exports do not establish revenue currency. Read revenue through the Stats API.')
   let day=label;if(name==='visitors'){insist(/^\d{4}-\d{2}-\d{2}(?:[ T]\d{2}:\d{2}:\d{2}(?:Z|[+-]\d{2}:\d{2})?)?$/.test(dims.date!),'plausible_date','Use a dated Plausible time series.');day=localDate(dims.date!.slice(0,10))}
   out.push(make(day,name,dims,metrics))
  }
 }
 // Reuse the established typed definition recovery; history never invents triggers.
 const hasDefinitions=['conversions.csv','custom_props.csv'].some(name=>files[name]!==undefined&&csv(files[name]).rows.length>0)
 if(hasDefinitions)out.push(...normalizePlausible({...input,files:{'conversions.csv':files['conversions.csv']??'name,unique_conversions,total_conversions\n',...(files['custom_props.csv']!==undefined?{'custom_props.csv':files['custom_props.csv']}:{})}},sourceSite,policy)!)
 return out
}
function api(input:Record<string,any>,policy:SitePolicy) {
 insist(Array.isArray(input.queries)&&input.queries.length>0&&input.queries.length<=100,'plausible_history','Use bounded Stats API v2 responses.')
 const out:AggregateRecord[]=[],label=localDate(input.day)
 for(const response of input.queries){
  const result=object(response),query=object(result.query),dims=query.dimensions,keys=query.metrics
  insist(Array.isArray(dims)&&new Set(dims).size===dims.length&&Array.isArray(keys)&&keys.length>0&&new Set(keys).size===keys.length&&keys.every(k=>API_METRICS.includes(k))&&Array.isArray(result.results),'plausible_history','Invalid Stats API v2 result schema.')
  insist(!query.filters?.length,'plausible_history','Import unfiltered source reports so independent groups retain their meaning.')
  const range=query.date_range;insist(Array.isArray(range)&&range.length===2&&range.every((v:unknown)=>typeof v==='string'&&v.slice(0,10)===label),'plausible_date','Read one source day per API import.')
  insist(!query.include?.imports||result.meta?.imports_included!==false,'plausible_history','Plausible could not include imported history in this query.')
  const prop=dims.length===1&&typeof dims[0]==='string'&&dims[0].startsWith('event:props:')?dims[0].slice(12):null
  const match=prop!==null?['propertyHistory',reports.propertyHistory!] as const:Object.entries(reports).find(([,spec])=>spec.api.length===dims.length&&spec.api.every(key=>dims.includes(key)))
  insist(match&&match[0]!=='propertyHistory'||prop!==null,'plausible_dimension','Unsupported Stats API report grouping.')
  const [name,spec]=match!,total=object(result.meta??{}).total_rows
  insist(total===undefined||Number.isSafeInteger(total)&&total>=result.results.length,'plausible_pagination','Invalid source row count.')
  for(const raw of result.results){const row=object(raw);insist(Array.isArray(row.dimensions)&&row.dimensions.length===dims.length&&Array.isArray(row.metrics)&&row.metrics.length===keys.length,'plausible_history','Source dimensions and metrics must align with their query.')
   const dimensions:Record<string,string>={},metrics:Record<string,number>={}
   if(prop!==null){dimensions.property=dimension(prop,'property',policy);dimensions.value=dimension(row.dimensions[0],'value',policy)}
   else spec.api.forEach((key,i)=>{dimensions[spec.dimensions[i]!]=dimension(row.dimensions[dims.indexOf(key)],spec.dimensions[i]!,policy)})
   keys.forEach((key:string,i:number)=>{const value=row.metrics[i];if(value===null)return;if(key.endsWith('revenue')){const money=object(value),currency=plausibleCurrency(money.currency);insist(!dimensions.currency||dimensions.currency===currency,'plausible_currency','A row cannot mix revenue currencies.');dimensions.currency=currency;metrics[key]=number(money.value,key)}else metrics[key]=number(value,key)})
   if(name==='visitors')insist(dimensions.date===label,'plausible_date','The API returned a different source day.')
   out.push(make(label,name,dimensions,metrics))
  }
 }
 return out
}

/** Independent source summaries; never fabricate sessions or add competing breakdowns. */
export function normalizePlausibleHistory(document:unknown,sourceSite:ImportSite,policy:SitePolicy):AggregateRecord[]|null {
 const input=document as any
 if(!input||!['vane-plausible-dashboard/1','vane-plausible-history-api/1','vane-plausible-history-normalized/1'].includes(input.format))return null
 // Preserve existing definition-only imports and their reviewed carries.
 if(input.format==='vane-plausible-dashboard/1'&&!Object.keys(object(input.files)).some(name=>!['conversions.csv','custom_props.csv'].includes(name)))return null
 let records:AggregateRecord[]
 if(input.format==='vane-plausible-history-normalized/1'){
  insist(Array.isArray(input.records),'plausible_history','Use normalized source rows.')
  if(input.records.some((r:any)=>!reports[String(r?.report).replace(/^Plausible\./,'')]))return null
  records=input.records.map((r:unknown)=>validate(r,policy))
 }else{
  records=input.format==='vane-plausible-dashboard/1'?dashboard(input,sourceSite,policy):api(input,policy)
  if(input.definitions&&(input.definitions.goals?.goals?.length||input.definitions.properties?.custom_properties?.length))records.push(...normalizePlausible(input.definitions,sourceSite,policy)!)
 }
 insist(records.length>0&&records.length<=500,'plausible_rows','Import 1 to 500 source report rows. Choose a smaller period or fewer dimensions.')
 return records
}

/** One source-local day, all published dimensions, one-use credentials, no redirects. */
export async function readPlausibleHistory(env:Env,actor:Actor,p:any) {
 role(actor);inScope(actor,String(p.siteId));await loadSite(env,String(p.siteId))
 // This also validates the fixed endpoint, source ID, token and selected key type.
 const definitions=await readPlausible(env,actor,p),day=localDate(p.day),queries:any[]=[]
 const props=definitions.properties.custom_properties.map((v:any)=>object(v).property)
 insist(props.length<=25&&props.every((v:unknown)=>typeof v==='string'&&/^[a-z0-9_-]{1,40}$/.test(v)),'plausible_property','Read at most 25 supported custom properties per import.')
 const specs=Object.entries(reports).filter(([name])=>name!=='propertyHistory').map(([name,spec])=>({name,dimensions:spec.api,metrics:name==='goalHistory'?['visitors','events','conversion_rate','total_revenue','average_revenue']:name==='pages'?['visitors','visits','pageviews','bounce_rate','time_on_page','scroll_depth']:['visitors','visits','pageviews','views_per_visit','bounce_rate','visit_duration']}))
 specs.push(...props.map((key:string)=>({name:'propertyHistory',dimensions:['event:props:'+key],metrics:['visitors','events','percentage']})))
 let budget=0,rowCount=0
 async function read(spec:typeof specs[number]) {
  let offset=0,total:number|undefined
  do{
   const body={site_id:String(p.sourceSite),date_range:[day,day],dimensions:spec.dimensions,metrics:spec.metrics,include:{imports:true,total_rows:true},pagination:{limit:100,offset}}
   let response:Response
   try{response=await fetch('https://plausible.io/api/v2/query',{method:'POST',redirect:'manual',headers:{authorization:'Bearer '+String(p.token),'content-type':'application/json'},body:JSON.stringify(body),signal:AbortSignal.timeout(20000)})}catch{insist(false,'plausible_read','Plausible could not be reached. No credentials were saved.',502)}
   insist(response.ok,'plausible_read','Plausible refused a history query. Nothing was imported; check the key, plan and source site.',502)
   const reader=response.body?.getReader(),chunks:Uint8Array[]=[];let size=0
   if(reader)while(true){const part=await reader.read();if(part.done)break;size+=part.value.length;budget+=part.value.length;if(budget>2_000_000){await reader.cancel();insist(false,'plausible_size','Choose a smaller source; history reads accept at most 2 MB.',413)}chunks.push(part.value)}
   const bytes=new Uint8Array(size);let at=0;for(const chunk of chunks){bytes.set(chunk,at);at+=chunk.length}
   let result:any;try{result=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes))}catch{insist(false,'plausible_read','Plausible did not return a JSON history report.',502)}
   insist(Array.isArray(result.results)&&result.results.length<=100&&result.query&&JSON.stringify(result.query.dimensions)===JSON.stringify(body.dimensions)&&JSON.stringify(result.query.metrics)===JSON.stringify(body.metrics),'plausible_read','Plausible returned a different history query.',502)
   const count=result.meta?.total_rows;insist(Number.isSafeInteger(count)&&count>=offset+result.results.length&&(total===undefined||total===count),'plausible_pagination','Plausible did not return a stable complete row count.',502);total=count
   rowCount+=result.results.length;insist(rowCount<=500,'plausible_size','History exceeds 500 source rows. Choose a smaller source report.',413)
   queries.push(result);offset+=result.results.length
   insist(offset>=count||result.results.length>0,'plausible_pagination','Plausible returned an incomplete report page.',502)
  }while(offset<total!)
 }
 // Bounded parallel reads stay below the provider's request concurrency limits.
 for(let i=0;i<specs.length;i+=4)await Promise.all(specs.slice(i,i+4).map(read))
 return {format:'vane-plausible-history-api/1',day,queries,definitions}
}

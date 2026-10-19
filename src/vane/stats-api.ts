import { insist, site, sites, type Env, type Site } from './core'
import { createInsightsService } from './reports'
import { clock } from './clock'
import { PERIODS } from './periods'
import { FILTER_OPS } from './segments'
import { EVENT_LIMITS, RATE_LIMITS } from './api-keys'
// API-001: the Stats API answers from the same report service as the dashboard, so its figures are the dashboard's.
// A range is the site's local dates; `to` is exclusive in /api/v1/stats as on the dashboard, and inclusive in the
// Plausible-compatible date_range, as Plausible's is.
export const BREAKDOWNS:Record<string,string>={channel:'channels',source:'sourceVisits',referrer:'referrers',utm_source:'utmSources',utm_medium:'utmMediums',utm_campaign:'utmCampaigns',utm_term:'utmTerms',utm_content:'utmContents',device:'devices',browser:'browsers',os:'systems',screen:'screens',page:'topPages',entry_page:'entryPages',exit_page:'exitPages',hostname:'hostnames'}
export const METRICS:Record<string,string>={visitors:'visitors',visits:'visits',pageviews:'pageviews',bounce_rate:'bounceRate',visit_duration:'averageDuration',views_per_visit:'pagesPerVisit',conversion_rate:'conversionRate'}
const PREVIOUS:Record<string,string>={visitors:'previousVisitors',visits:'previousVisits',pageviews:'previousPageviews',bounce_rate:'previousBounceRate'}
export interface StatsQuery { from?:string|null; to?:string|null; period?:string|null; compare?:string|null; compareFrom?:string|null; compareTo?:string|null; filters:string[]; segment?:string|null }
export async function report(env:Env,value:Site,query:StatsQuery) {
 return createInsightsService(env,value,clock(),{from:query.from??null,to:query.to??null,period:query.period??null,compare:query.compare??null,compareFrom:query.compareFrom??null,compareTo:query.compareTo??null,filters:query.filters,segment:query.segment??null}).list() as Promise<any>
}
// A breakdown row's label and its figures, in the shape the dashboard table shows them.
const rowOf=(row:any)=>{const {label,path,key,...rest}=row;return {value:label??path??key,...rest}}
export async function statsV1(env:Env,url:URL) {
 const value=await site(env,url.searchParams.get('site_id')??'');
 const query:StatsQuery={from:url.searchParams.get('from'),to:url.searchParams.get('to'),period:url.searchParams.get('period'),compare:url.searchParams.get('compare'),compareFrom:url.searchParams.get('compare_from'),compareTo:url.searchParams.get('compare_to'),filters:url.searchParams.getAll('filter'),segment:url.searchParams.get('segment')};
 const metrics=(url.searchParams.get('metrics')||'visitors,visits,pageviews,bounce_rate').split(',');
 insist(metrics.every(m=>Object.hasOwn(METRICS,m)),'metrics',`Ask for metrics among ${Object.keys(METRICS).join(', ')}.`);
 const dimension=url.searchParams.get('dimension');insist(!dimension||Object.hasOwn(BREAKDOWNS,dimension),'dimension',`Break down by one of ${Object.keys(BREAKDOWNS).join(', ')}.`);
 const r=await report(env,value,query);
 return {site_id:value.id,from:r.from,to:r.to,time_zone:r.timeZone,compare:{mode:r.compare,from:r.previousFrom,to:r.previousTo},filters:r.filterParams,segment:r.segment,
  results:Object.fromEntries(metrics.map(m=>[m,r[METRICS[m]!]??null])),previous:Object.fromEntries(metrics.filter(m=>PREVIOUS[m]).map(m=>[m,r[PREVIOUS[m]!]])),
  ...(dimension?{dimension,breakdown:(r[BREAKDOWNS[dimension]!] as any[]).map(rowOf)}:{})};
}
// Plausible Stats API v2 compatibility: POST /api/v2/query with site_id (the site's ID or its hostname), metrics,
// date_range, dimensions (at most one), filters ([op, dimension, [value]]) and include.comparisons.
const PLAUSIBLE_DIMENSIONS:Record<string,string>={'visit:channel':'channel','visit:source':'source','visit:referrer':'referrer','visit:utm_source':'utm_source','visit:utm_medium':'utm_medium','visit:utm_campaign':'utm_campaign','visit:utm_term':'utm_term','visit:utm_content':'utm_content','visit:device':'device','visit:browser':'browser','visit:os':'os','visit:screen':'screen','event:page':'page','visit:entry_page':'entry_page','visit:exit_page':'exit_page','event:hostname':'hostname'}
const PLAUSIBLE_FILTERS:Record<string,string>={'visit:channel':'channel','visit:source':'source','visit:referrer':'referrer','visit:utm_source':'utm_source','visit:utm_medium':'utm_medium','visit:utm_campaign':'utm_campaign','visit:utm_term':'utm_term','visit:utm_content':'utm_content','visit:device':'device','visit:browser':'browser','visit:os':'os','visit:screen':'screen','event:page':'page','visit:entry_page':'entry','event:hostname':'hostname','event:goal':'goal'}
const PLAUSIBLE_OPS:Record<string,keyof typeof FILTER_OPS>={is:'is',is_not:'is_not',contains:'contains',contains_not:'not_contains',matches:'matches'}
const PLAUSIBLE_RANGES:Record<string,string>={day:'today','7d':'7d','30d':'30d','month':'month','year':'year','12mo':'12mo','all':'all'}
const DAY=86400000,next=(d:string)=>new Date(Date.parse(d)+DAY).toISOString().slice(0,10),before=(d:string)=>new Date(Date.parse(d)-DAY).toISOString().slice(0,10)
export async function plausibleQuery(env:Env,body:any,canRead:(siteId:string)=>void) {
 insist(body&&typeof body==='object','query','Send a JSON query.');
 const all=await sites(env),value=all.find(s=>s.id===body.site_id||new URL(s.origin).hostname===body.site_id);insist(value,'site_missing','Site not found.',404);canRead(value.id);
 const metrics:string[]=Array.isArray(body.metrics)?body.metrics.map(String):[];insist(metrics.length>0&&metrics.every(m=>Object.hasOwn(METRICS,m)),'metrics',`Ask for metrics among ${Object.keys(METRICS).join(', ')}.`);
 const dimensions:string[]=Array.isArray(body.dimensions)?body.dimensions.map(String):[];insist(dimensions.length<=1&&dimensions.every(d=>Object.hasOwn(PLAUSIBLE_DIMENSIONS,d)),'dimensions',`Use at most one dimension among ${Object.keys(PLAUSIBLE_DIMENSIONS).join(', ')}.`);
 const range=body.date_range,query:StatsQuery={filters:[]};
 if(Array.isArray(range)){insist(range.length===2&&range.every((d:unknown)=>typeof d==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(d)),'date_range','A date_range is [first day, last day], both included.');query.from=range[0];query.to=next(range[1])}
 else{insist(Object.hasOwn(PLAUSIBLE_RANGES,String(range)),'date_range',`Use a date_range among ${Object.keys(PLAUSIBLE_RANGES).join(', ')} or [first day, last day].`);query.period=PLAUSIBLE_RANGES[String(range)]!;insist(Object.hasOwn(PERIODS,query.period),'date_range','Unknown range.')}
 for(const filter of Array.isArray(body.filters)?body.filters:[]){
  const [op,dimension,values]=Array.isArray(filter)?filter:[];
  insist(Object.hasOwn(PLAUSIBLE_OPS,op)&&Object.hasOwn(PLAUSIBLE_FILTERS,dimension)&&Array.isArray(values)&&values.length===1,'filters','Each filter is [is|is_not|contains|contains_not|matches, dimension, [one value]].');
  query.filters.push(`${PLAUSIBLE_FILTERS[dimension]}:${PLAUSIBLE_OPS[op]}:${String(values[0])}`);
 }
 const comparing=body.include?.comparisons;if(comparing){insist(comparing.mode==='previous_period'||comparing.mode==='year_over_year','comparisons','Compare with previous_period or year_over_year.');query.compare=comparing.mode==='previous_period'?'previous':'year'}
 const r=await report(env,value,query),dimension=dimensions[0]?PLAUSIBLE_DIMENSIONS[dimensions[0]]!:null;
 const figures=(source:any)=>metrics.map(m=>source[METRICS[m]!]??null);
 const results=dimension?(r[BREAKDOWNS[dimension]!] as any[]).map(row=>({dimensions:[row.label??row.path],metrics:figures(row)})):[{dimensions:[],metrics:figures(r),...(comparing?{comparison:{dimensions:[],metrics:metrics.map(m=>PREVIOUS[m]?r[PREVIOUS[m]!]:null)}}:{})}];
 return {results,meta:{time_zone:r.timeZone},query:{site_id:body.site_id,metrics,date_range:[r.from,before(r.to)],dimensions,filters:body.filters??[]}};
}
export function openApi(origin:string) {
 const limits=`Per key: ${RATE_LIMITS.burst.requests} requests per ${RATE_LIMITS.burst.seconds}-second window and ${RATE_LIMITS.hourly.requests} per clock hour (UTC); over either, 429 with Retry-After.`;
 const err={description:'Refused, with {error, message}.'};
 return {openapi:'3.1.0',info:{title:'Vane Stats and Sites API',version:'1',description:`Read-only statistics with a site-scoped Stats API key, and site provisioning with an owner's provisioning key, both sent as Authorization: Bearer. ${limits}`},servers:[{url:origin}],
  'x-rate-limits':RATE_LIMITS,'x-event-limits':EVENT_LIMITS,components:{securitySchemes:{key:{type:'http',scheme:'bearer'}}},security:[{key:[]}],
  paths:{
   '/api/v1/stats':{get:{summary:'Totals, an optional breakdown and the compared period, as the dashboard shows them',parameters:[
    {name:'site_id',in:'query',required:true,schema:{type:'string'}},{name:'metrics',in:'query',schema:{type:'string',description:`Comma-separated: ${Object.keys(METRICS).join(', ')}`}},
    {name:'dimension',in:'query',schema:{type:'string',enum:Object.keys(BREAKDOWNS)}},{name:'period',in:'query',schema:{type:'string',enum:Object.keys(PERIODS)}},
    {name:'from',in:'query',schema:{type:'string',format:'date'}},{name:'to',in:'query',schema:{type:'string',format:'date',description:'Exclusive, in the site time zone'}},
    {name:'compare',in:'query',schema:{type:'string',enum:['previous','year','custom']}},{name:'compare_from',in:'query',schema:{type:'string',format:'date'}},{name:'compare_to',in:'query',schema:{type:'string',format:'date'}},
    {name:'filter',in:'query',schema:{type:'array',items:{type:'string',description:`dimension:op:value, op among ${Object.keys(FILTER_OPS).join(', ')}`}},style:'form',explode:true},{name:'segment',in:'query',schema:{type:'string',description:'A saved segment ID'}}],
    responses:{'200':{description:'Statistics'},'400':err,'401':err,'403':err,'429':err}}},
   '/api/v2/query':{post:{summary:'Plausible Stats API v2-compatible query',requestBody:{content:{'application/json':{schema:{type:'object',required:['site_id','metrics','date_range'],properties:{site_id:{type:'string'},metrics:{type:'array',items:{type:'string',enum:Object.keys(METRICS)}},date_range:{oneOf:[{type:'string',enum:Object.keys(PLAUSIBLE_RANGES)},{type:'array',items:{type:'string',format:'date'},description:'First and last day, both included'}]},dimensions:{type:'array',maxItems:1,items:{type:'string',enum:Object.keys(PLAUSIBLE_DIMENSIONS)}},filters:{type:'array'},include:{type:'object'}}}}}},responses:{'200':{description:'Results'},'400':err,'401':err,'403':err,'429':err}}},
   '/api/v1/events':{post:{summary:`Server-side and mobile pageviews and custom events with a site's events token: one event, or {events:[...]} with up to 100, each with the script's fields, type pageview or event, and the visitor's client_ip and user_agent (used in memory only, never stored). An Idempotency-Key header makes a repeat within 24 hours answer the first results again. Per token: ${EVENT_LIMITS.burst.requests} requests per ${EVENT_LIMITS.burst.seconds} seconds and ${EVENT_LIMITS.events.events} events per clock hour (UTC); over either, 429 with Retry-After.`,parameters:[{name:'Idempotency-Key',in:'header',schema:{type:'string',maxLength:200}}],responses:{'200':{description:'Per-event results'},'400':err,'401':err,'403':err,'409':err,'413':err,'429':err}}},
   '/api/v1/mcp':{post:{summary:'Model Context Protocol (Streamable HTTP, one JSON-RPC message per request, JSON answers) with a Stats API key: list_sites and query_stats read; write tools need an agent grant',responses:{'200':{description:'JSON-RPC response'},'202':{description:'Notification accepted'},'401':err,'429':err}}},
   '/api/v1/export-schema.json':{get:{summary:'The scheduled warehouse export’s published schema (no key needed)',security:[],responses:{'200':{description:'Schema'}}}},
   '/api/v1/sites':{post:{summary:'Create a site (provisioning key)',responses:{'201':{description:'Created'},'400':err,'401':err,'403':err,'429':err}}},
   '/api/v1/sites/{site_id}/goals':{post:{summary:'Add a page goal to a site (provisioning key)',responses:{'201':{description:'Created'},'400':err,'401':err,'403':err,'429':err}}},
   '/api/v1/sites/{site_id}/shared-links':{post:{summary:'Create a read-only shared link (provisioning key); its URL is returned once',responses:{'201':{description:'Created'},'400':err,'401':err,'403':err,'429':err}}},
  }};
}

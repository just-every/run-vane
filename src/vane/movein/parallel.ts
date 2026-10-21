import { day, inScope, insist, role, rows, site, type Actor, type Env } from '../core'
import { clock } from '../clock'
import { localMidnight } from '../periods'
import { localDay } from '../visitors'
import { createInsightsService } from '../reports'
import { sourceNameSql } from '../sources'
import { timedFrom } from '../visits'

export const PARALLEL_CAUSES = ['definition', 'bot filtering', 'consent', 'blockers', 'proxy coverage'] as const
type Cause = typeof PARALLEL_CAUSES[number]
type Metric = 'visitors' | 'visits' | 'pageviews' | 'bounceRate' | 'sourceVisitors' | 'goalConversions'
export interface ParallelEvidence { day:string; metric:Metric; label?:string; cause:Cause; detail:string; source:string }
export interface ParallelDifference {
 day:string; metric:Metric; label?:string; vane:number|null; plausible:number|null
 percent:number|null; material:boolean; status:'within threshold'|'owner evidence'|'unmeasured'
 evidence?:ParallelEvidence
}
export interface ParallelReport {
 siteId:string; sourceSite:string; from:string; to:string; timeZone:string; importedOff:true
 source:'Plausible Stats API'|'Plausible Stats API export'; complete:boolean; unresolved:number
 days:{day:string; metrics:ParallelDifference[]; sources:ParallelDifference[]; goals:ParallelDifference[]}[]
 coverage:string; definitions:string[]
}
const specs = [
 {dimensions:['time:day'], metrics:['visitors','visits','pageviews','bounce_rate']},
 {dimensions:['time:day','visit:source'], metrics:['visitors']},
 {dimensions:['time:day','event:goal'], metrics:['events']},
] as const
type Spec = typeof specs[number]
interface Aggregate { day:string; label?:string; metrics:(number|null)[] }
const object = (v:unknown):Record<string,any> => {
 insist(v && typeof v==='object' && !Array.isArray(v),'parallel_document','Use a parallel report object.')
 return v as Record<string,any>
}
function date(v:unknown) {
 insist(typeof v==='string' && /^\d{4}-\d{2}-\d{2}$/.test(v) && Number.isFinite(Date.parse(v)) && day(Date.parse(v))===v,'parallel_date','Choose valid source-local dates.')
 return v
}
function text(v:unknown, max=200) {
 insist(typeof v==='string' && v.trim().length>0 && v.length<=max && !/[<>@\u0000-\u001f\u007f?#]/.test(v),'parallel_text','Use bounded, privacy-safe plain text without personal data, credentials or URL queries.')
 return v.trim()
}
const same = (a:unknown,b:unknown) => JSON.stringify(a)===JSON.stringify(b)
const key = (day:string, metric:Metric, label?:string) => JSON.stringify([day,metric,label??null])
function jsonInput(raw:unknown) {
 if(typeof raw!=='string')return raw
 insist(new TextEncoder().encode(raw).length<=2_000_000,'parallel_size','Choose JSON smaller than 2 MB.',413)
 if(!raw.trim())return undefined
 try{return JSON.parse(raw)}catch{insist(false,'parallel_document','Use valid JSON for source responses and evidence.')}
}

function evidenceOf(raw:unknown, from:string, to:string):Map<string,ParallelEvidence> {
 insist(raw===undefined || Array.isArray(raw),'parallel_evidence','Use an array of evidence entries.')
 const values = (raw??[]) as unknown[]
 insist(values.length<=1000,'parallel_evidence','Use at most 1,000 evidence entries.')
 const found = new Map<string,ParallelEvidence>()
 for(const value of values) {
  const e=object(value),d=date(e.day),metric=e.metric as Metric
  insist(d>=from&&d<to&&['visitors','visits','pageviews','bounceRate','sourceVisitors','goalConversions'].includes(metric),'parallel_evidence','Evidence must identify a metric and day in this report.')
  insist(PARALLEL_CAUSES.includes(e.cause),'parallel_evidence','Choose a known cause: definition, bot filtering, consent, blockers or proxy coverage.')
  const label=e.label===undefined?undefined:text(e.label)
  insist(metric==='sourceVisitors'?label!==undefined:metric==='goalConversions'||label===undefined,'parallel_evidence','Only source and goal evidence can have a label; source evidence needs one.')
  const item:ParallelEvidence={day:d,metric,...(label===undefined?{}:{label}),cause:e.cause,detail:text(e.detail,800),source:text(e.source,400)}
  if(/^https?:/i.test(item.source)) {
   let url:URL|undefined;try{url=new URL(item.source)}catch{}
   insist(url&&url.protocol==='https:'&&!url.username&&!url.password&&!url.search&&!url.hash,'parallel_evidence','Use an https evidence reference without credentials or URL queries.')
  }
  const id=key(d,metric,label);insist(!found.has(id),'parallel_evidence','Each difference can have only one evidence entry.');found.set(id,item)
 }
 return found
}

// Accept only full, unfiltered native source queries. No raw response enters storage or the report.
function page(raw:unknown,spec:Spec,sourceSite:string,from:string,to:string,timeZone:string,offset:number) {
 const result=object(raw),q=object(result.query),meta=object(result.meta),range=q.date_range
 insist(q.site_id===sourceSite&&same(q.dimensions,spec.dimensions)&&same(q.metrics,spec.metrics),'parallel_query','Use the three documented Stats API queries for this source site.')
 insist(q.filters===undefined||same(q.filters,[]),'parallel_query','Parallel reports require unfiltered source queries.')
 insist((q.include?.imports===undefined||q.include.imports===false)&&meta.imports_included!==true,'parallel_query','Exclude imported source history from the parallel run.')
 const last=day(Date.parse(to)-86400000)
 const dated=Array.isArray(range)&&range.length===2&&same(range,[from,last])
 const expanded=Array.isArray(range)&&range.length===2&&range.every((v:unknown)=>typeof v==='string'&&/T/.test(v))&&Date.parse(range[0])===localMidnight(from,timeZone)&&[1,1000].some(ms=>Date.parse(range[1])===localMidnight(to,timeZone)-ms)
 insist(dated||expanded,'parallel_query','Source queries must cover the complete selected local days, with an inclusive final source date.')
 insist(Array.isArray(result.results)&&Number.isSafeInteger(meta.total_rows)&&meta.total_rows>=0&&meta.total_rows<=5000,'parallel_query','Include total_rows in each bounded source query.')
 insist((q.pagination?.offset??0)===offset,'parallel_query','Source query pagination is incomplete or out of order.')
 insist(result.results.length<=5000&&offset+result.results.length<=meta.total_rows,'parallel_query','Source query rows do not match total_rows.')
 const normalized:Aggregate[]=result.results.map((value:unknown)=>{
  const row=object(value)
  insist(Array.isArray(row.dimensions)&&row.dimensions.length===spec.dimensions.length&&Array.isArray(row.metrics)&&row.metrics.length===spec.metrics.length,'parallel_query','A source result has the wrong dimensions or metrics.')
  const d=date(row.dimensions[0]);insist(d>=from&&d<to,'parallel_query','A source row falls outside the parallel run.')
  const label=spec.dimensions.length===2?text(row.dimensions[1]):undefined
  const metrics=row.metrics.map((n:unknown,i:number)=>{
   if(n===null&&spec.metrics[i]==='bounce_rate')return null
   insist(typeof n==='number'&&Number.isFinite(n)&&n>=0&&(spec.metrics[i]==='bounce_rate'?n<=100:Number.isSafeInteger(n)),'parallel_metric','Source counts must be nonnegative integers and bounce rates percentages.')
   return n
  })
  return {day:d,...(label===undefined?{}:{label}),metrics}
 })
 return {rows:normalized,total:meta.total_rows as number}
}

async function readSource(p:Record<string,any>,sourceSite:string,from:string,to:string,timeZone:string) {
 if(p.document!==undefined) {
  insist(p.token===undefined||p.token==='','parallel_document','Choose an export or a one-use API read.')
  const doc=object(p.document)
  insist(new TextEncoder().encode(JSON.stringify(doc)).length<=2_000_000,'parallel_size','Choose a Stats API export smaller than 2 MB.',413)
  insist(doc.format==='vane-plausible-parallel/1'&&doc.sourceSite===sourceSite&&doc.timeZone===timeZone&&Array.isArray(doc.queries)&&doc.queries.length===3,'parallel_document','Use the documented parallel-run Stats API export for this site and timezone.')
  return specs.map((spec,i)=>{const result=page(doc.queries[i],spec,sourceSite,from,to,timeZone,0);insist(result.total===result.rows.length,'parallel_query','Upload all rows for each source query.');return result.rows})
 }
 const token=p.token
 insist(typeof token==='string'&&token.length>=8&&token.length<=512&&!/\s/.test(token),'parallel_token','Enter a one-use Plausible Stats API token. It is never saved.')
 let budget=0
 return Promise.all(specs.map(async spec=>{
  const out:Aggregate[]=[];let total:number|undefined
  do {
   const query={site_id:sourceSite,date_range:[from,day(Date.parse(to)-86400000)],dimensions:spec.dimensions,metrics:spec.metrics,filters:[],include:{imports:false,total_rows:true},pagination:{limit:500,offset:out.length}}
   let response:Response
   try {response=await fetch('https://plausible.io/api/v2/query',{method:'POST',redirect:'manual',headers:{authorization:`Bearer ${token}`,'content-type':'application/json'},body:JSON.stringify(query),signal:AbortSignal.timeout(20000)})}
   catch {insist(false,'parallel_read','Plausible could not be reached. No credentials were saved.',502)}
   insist(response.ok,'parallel_read','Plausible refused the read. Check the source site, key and plan. No credentials were saved.',502)
   const reader=response.body?.getReader(),chunks:Uint8Array[]=[];let size=0
   if(reader)while(true){const r=await reader.read();if(r.done)break;size+=r.value.length;budget+=r.value.length;if(budget>2_000_000){await reader.cancel();insist(false,'parallel_size','Plausible returned more than 2 MB.',413)}chunks.push(r.value)}
   const bytes=new Uint8Array(size);let at=0;for(const chunk of chunks){bytes.set(chunk,at);at+=chunk.length}
   let raw:unknown;try{raw=JSON.parse(new TextDecoder().decode(bytes))}catch{insist(false,'parallel_read','Plausible did not return JSON.',502)}
   const result=page(raw,spec,sourceSite,from,to,timeZone,out.length)
   insist(total===undefined||total===result.total,'parallel_query','Source rows changed during pagination. Export a settled period instead.')
   total=result.total;insist(result.rows.length>0||out.length===total,'parallel_query','Plausible returned an incomplete page.')
   out.push(...result.rows)
  }while(out.length<total!)
  return out
 }))
}

export async function parallelRun(env:Env,actor:Actor,input:unknown):Promise<ParallelReport> {
 role(actor)
 const original=object(input),p:Record<string,any>={...original,document:jsonInput(original.document),evidence:jsonInput(original.evidence)},siteId=String(p.siteId??'');inScope(actor,siteId)
 const value=await site(env,siteId),from=date(p.from),to=date(p.to),timeZone=value.config.timeZone??'UTC'
 insist(Date.parse(to)-Date.parse(from)===14*86400000&&to<=localDay(clock(),timeZone),'parallel_range','Choose exactly 14 complete overlap days; the end date is exclusive.')
 insist(p.timeZone===timeZone,'parallel_timezone','Confirm that Plausible uses the same reporting timezone as this Vane site.')
 insist(p.endpoint===undefined||p.endpoint==='https://plausible.io/api/v2/query','parallel_endpoint','Use only the fixed official Plausible Stats API endpoint.')
 const sourceSite=text(p.sourceSite)
 insist(/^[a-z0-9][a-z0-9.-]{0,252}$/i.test(sourceSite),'parallel_site','Enter the domain site ID shown in Plausible.')
 const evidence=evidenceOf(p.evidence,from,to)
 // The report service supplies native definitions and series, explicitly excluding imports.
 const native=await createInsightsService(env,value,clock(),{from,to,interval:'day',imported:'off'}).list()
 insist(native.series.length===14,'parallel_overlap','The selected range must cover fourteen complete local days. Empty days remain zero; this report does not prove a script was installed.')
 const source=await readSource(p,sourceSite,from,to,timeZone)
 for(const group of source){const seen=new Set<string>();for(const row of group){const id=JSON.stringify([row.day,row.label]);insist(!seen.has(id),'parallel_query','A source query repeats a day and dimension.');seen.add(id)}}
 const scope=JSON.stringify([siteId])
 const [nativeSources,nativeGoals]=await Promise.all([
  rows<{day:string,label:string,n:number}>(env,`${timedFrom('vane_events')} SELECT day,${sourceNameSql(value.config.sourceRules)} AS label,COUNT(DISTINCT visitor) AS n FROM q WHERE starts=1 GROUP BY day,label ORDER BY day,n DESC,label`,scope,from,to,null),
  // Like reports.ts goalBreakdown and series.ts conversions: collect/engage/customEventResponse
  // materialize every matched page, scroll, custom-event and revenue goal here. Raw custom
  // events are a separate report; counting them again would double-count matches and admit non-goals.
  rows<{day:string,label:string,n:number}>(env,"SELECT day,kind AS label,COUNT(*) AS n FROM vane_events WHERE site_id=? AND day>=? AND day<? AND kind!='pageview' GROUP BY day,kind ORDER BY day,kind",siteId,from,to),
 ])
 const used=new Set<string>()
 function compare(d:string,metric:Metric,vane:number|null,plausible:number|null,label?:string):ParallelDifference {
  const percent=vane===null||plausible===null?null:plausible===0?(vane===0?0:null):Math.round((vane-plausible)/plausible*10000)/100
  const material=vane!==null&&plausible!==null&&(plausible===0?vane!==0:Math.abs(vane-plausible)/plausible>0.05)
  const id=key(d,metric,label),entry=evidence.get(id)
  insist(!entry||material,'parallel_evidence','Evidence must identify an actual difference over 5%.')
  if(entry)used.add(id)
  return {day:d,metric,...(label===undefined?{}:{label}),vane,plausible,percent,material,status:vane===null||plausible===null?'unmeasured':!material?'within threshold':entry?'owner evidence':'unmeasured',...(entry?{evidence:entry}:{})}
 }
 const days=native.series.map(bucket=>{
  const d=bucket.key,summary=source[0]!.find(r=>r.day===d),goals=source[2]!.filter(r=>r.day===d),sources=source[1]!.filter(r=>r.day===d)
  const pairs=(metric:'sourceVisitors'|'goalConversions',a:{label:string,n:number}[],b:Aggregate[])=>[...new Set([...a.map(r=>r.label),...b.map(r=>r.label!)])].map(label=>compare(d,metric,Number(a.find(r=>r.label===label)?.n??0),b.find(r=>r.label===label)?.metrics[0]??0,label)).sort((a,b)=>(b.plausible??0)-(a.plausible??0)||(b.vane??0)-(a.vane??0)||a.label!.localeCompare(b.label!))
  return {day:d,metrics:[compare(d,'visitors',bucket.visitors,summary?.metrics[0]??0),compare(d,'visits',bucket.visits,summary?.metrics[1]??0),compare(d,'pageviews',bucket.pageviews,summary?.metrics[2]??0),compare(d,'bounceRate',bucket.bounceRate,summary?.metrics[3]??null),compare(d,'goalConversions',bucket.conversions,goals.reduce((sum,r)=>sum+Number(r.metrics[0]),0))],sources:pairs('sourceVisitors',nativeSources.filter(r=>r.day===d),sources),goals:pairs('goalConversions',nativeGoals.filter(r=>r.day===d),goals)}
 })
 insist(used.size===evidence.size,'parallel_evidence','An evidence entry does not match a material difference in this report.')
 const unresolved=days.flatMap(d=>[...d.metrics,...d.sources,...d.goals]).filter(r=>r.status==='unmeasured').length
 return {siteId,sourceSite,from,to,timeZone,importedOff:true,source:p.document?'Plausible Stats API export':'Plausible Stats API',complete:unresolved===0,unresolved,days,coverage:'Collection coverage, blockers, consent loss and proxy reach are unmeasured. Owner evidence is attributed, not independently verified. Source aggregates are separate; no credentials, evidence or source responses are saved.',definitions:['Differences are (Vane − Plausible) / Plausible; a nonzero Vane value against source zero is material. Bounce rates use relative percent difference, not percentage points.','Vane visitors are daily distinct visitor hashes. Visits use the site’s dated timeout and end at local midnight. Sources use visit-entry visitors and retain each system’s exact labels.','Goal conversions count Vane goal matches and Plausible events grouped by goal. Different goal definitions can count the same underlying event more than once. A missing source dimension in a complete query counts as zero; a missing bounce rate stays unmeasured.','Only explicit owner evidence can explain a difference over 5%. Without it the cause stays unmeasured; no cause is inferred from the counts.']}
}

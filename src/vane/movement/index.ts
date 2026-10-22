import { allow, atomic, inScope, insist, rows, site, statement, uid, type Actor, type Env } from '../core'
import { auditStatement } from '../audit'
import { clock } from '../clock'
import { localDate } from '../annotations'
import { localDay } from '../visitors'
import { createInsightsService } from '../reports'
import { report as searchReport } from '../search-console/report'
import { usHolidays } from '../explain'
import { sourceEvidence, type AggregateEvidence, type EvidenceMetric } from './evidence'
import type { InstrumentationReport } from '../instrumentation'
export interface Citation {label:string;href:string;unit:string;now:number|null;then:number|null;denominatorNow:number|null;denominatorThen:number|null}
export interface Hypothesis {category:'tracking-coverage'|'channel-mix'|'page-behavior'|'external-events';title:string;score:number;confidence:'low'|'medium';evidence:Citation[];disprove:string;limitation:string}
export interface MovementInvestigation {
 id:string;siteId:string;at:number;from:string;to:string;comparedFrom:string;comparedTo:string;timeZone:string
 hypotheses:Hypothesis[];unknown:string[];annotations:{day:string;kind:string;text:string;url?:string}[]
 context:{day:string;label:string}[];statement:string
 sourceCoverage:{metric:EvidenceMetric;nowDays:number;thenDays:number;requiredDays:number;complete:boolean}[]
}
const DAY=86400000
const dates=(from:string,to:string)=>Array.from({length:(Date.parse(to)-Date.parse(from))/DAY},(_,i)=>new Date(Date.parse(from)+i*DAY).toISOString().slice(0,10))
const rate=(a:number,b:number)=>b?a/b:null
const change=(a:number,b:number)=>b?(a-b)/b:null
const scalar=(n:unknown)=>Number(n??0)
const comparable=(list:AggregateEvidence[],metric:EvidenceMetric,wanted:string[])=>{
 const selected=list.filter(r=>r.metric===metric&&wanted.includes(r.day))
 return {complete:wanted.length>0&&selected.length===wanted.length,days:selected.length,n:selected.reduce((a,r)=>a+r.numerator,0),d:selected.reduce((a,r)=>a+r.denominator,0)}
}
export async function movementHistory(env:Env,actor:Actor,siteId:string) {
 allow(actor,'owner');inScope(actor,siteId);await site(env,siteId)
 return (await rows<{report_json:string}>(env,'SELECT report_json FROM vane_movement_investigations WHERE site_id=? ORDER BY at DESC,id LIMIT 10',siteId)).map(r=>JSON.parse(r.report_json) as MovementInvestigation)
}
export async function investigateMovement(env:Env,actor:Actor,p:any):Promise<MovementInvestigation> {
 allow(actor,'owner');const siteId=String(p.siteId??'');inScope(actor,siteId);const value=await site(env,siteId)
 insist(Object.keys(p).every(k=>['siteId','from','to','comparedFrom','comparedTo'].includes(k)),'fields','Choose a site and two date windows only.')
 const from=localDate(p.from),to=localDate(p.to),comparedFrom=localDate(p.comparedFrom),comparedTo=localDate(p.comparedTo),span=Date.parse(to)-Date.parse(from),beforeSpan=Date.parse(comparedTo)-Date.parse(comparedFrom)
 insist(from<to&&comparedFrom<comparedTo&&span<=31*DAY&&span===beforeSpan&&comparedTo<=from,'range','Compare non-overlapping whole-day windows of the same length, from 1 to 31 days.')
 insist(to<=localDay(clock(),value.config.timeZone??'UTC'),'range','Investigate ended local days; today is incomplete.')
 const days=dates(from,to),beforeDays=dates(comparedFrom,comparedTo)
 const report=await createInsightsService(env,value,clock(),{from,to,compare:'custom',compareFrom:comparedFrom,compareTo:comparedTo}).list()
 const [search,beforeSearch,nowEvidence,thenEvidence,instrumentation,exclusions]=await Promise.all([
  searchReport(env,actor,siteId,from,to),searchReport(env,actor,siteId,comparedFrom,comparedTo),sourceEvidence(env,siteId,from,to),sourceEvidence(env,siteId,comparedFrom,comparedTo),
  rows<{report_json:string;at:number}>(env,'SELECT report_json,at FROM vane_instrumentation_runs WHERE site_id=? AND from_day=? AND to_day=? ORDER BY at DESC LIMIT 1',siteId,from,to),
  rows<{day:string;reason:string;n:number}>(env,'SELECT day,reason,SUM(count) AS n FROM vane_exclusions WHERE site_id=? AND ((day>=? AND day<?) OR (day>=? AND day<?)) GROUP BY day,reason',siteId,from,to,comparedFrom,comparedTo),
 ])
 const base=`/app/sites/${encodeURIComponent(siteId)}?${new URLSearchParams({from,to,compare:'custom',compareFrom:comparedFrom,compareTo:comparedTo})}`
 const sourceLink=`/api/vane/movement-evidence?${new URLSearchParams({siteId,from:comparedFrom,to})}`
 const cite=(label:string,unit:string,now:number|null,then:number|null,denominatorNow:number|null,denominatorThen:number|null,href=base):Citation=>({label,unit,now,then,denominatorNow,denominatorThen,href})
 const hypotheses:Hypothesis[]=[],unknown:string[]=['Ranked hypotheses describe consistency with observations, never proven causality. Scores order evidence and are not probabilities.','Blocker share and browser script-execution errors are not measured; collection errors below are server refusals.','Ad-spend changes and numeric Mango-send effects are unavailable; dated campaign annotations are context only.','Seasonality is not established by two windows; holidays are US observed federal dates and may not describe this site’s audience.']
 const sourceCoverage=(['orders','checkout-errors','uptime-failures'] as EvidenceMetric[]).map(metric=>{const a=comparable(nowEvidence,metric,days),b=comparable(thenEvidence,metric,beforeDays);if(!a.complete||!b.complete)unknown.push(`${metric}: ${a.days}/${days.length} current and ${b.days}/${beforeDays.length} compared daily aggregates; missing dates are unknown, not zero.`);return {metric,nowDays:a.days,thenDays:b.days,requiredDays:days.length,complete:a.complete&&b.complete}})
 if(nowEvidence.length||thenEvidence.length)unknown.push('External aggregates are reported by the owner-selected authenticated sender; Vane has not independently verified a Stripe, Shopify, CRM, Spool or Uptime account. No visitor/order identity is reconciled.')
 const orders=comparable(nowEvidence,'orders',days),priorOrders=comparable(thenEvidence,'orders',beforeDays),errors=comparable(nowEvidence,'checkout-errors',days),priorErrors=comparable(thenEvidence,'checkout-errors',beforeDays),uptime=comparable(nowEvidence,'uptime-failures',days),priorUptime=comparable(thenEvidence,'uptime-failures',beforeDays)
 const ordersKnown=orders.complete&&priorOrders.complete,errorsKnown=errors.complete&&priorErrors.complete
 const accepted=cite('Accepted native page loads','pageviews',report.pageviews,report.previousPageviews,report.pageviews,report.previousPageviews,base+'#pages')
 const goals=cite('Native goal events (not server orders)','goal events',report.goals,report.previousGoals,report.pageviews,report.previousPageviews,base+'#goals')
 const excluded=(reason:string,dates:string[])=>exclusions.filter(r=>r.reason===reason&&dates.includes(r.day)).reduce((a,r)=>a+r.n,0)
 const refused=excluded('collection-error',days),priorRefused=excluded('collection-error',beforeDays),declined=excluded('consent-declined',days),priorDeclined=excluded('consent-declined',beforeDays)
 const consentMeasured=value.config.consent==='required'&&value.config.declinedCounter&&value.config.sampleRate===100
 const consentNow=rate(report.pageviews,report.pageviews+declined),consentThen=rate(report.previousPageviews,report.previousPageviews+priorDeclined)
 if(!consentMeasured)unknown.push('Comparable consent rates are unavailable: both an owner-enabled declined counter and unsampled required-consent collection are needed; current settings alone do not establish historical settings.')
 const inspected=instrumentation[0]&&localDay(instrumentation[0].at,value.config.timeZone??'UTC')>=from&&localDay(instrumentation[0].at,value.config.timeZone??'UTC')<to?JSON.parse(instrumentation[0].report_json) as InstrumentationReport:null
 const structural=inspected?.problems.filter(p=>['missing-script','duplicate-script','missing-selector','invalid-selector','misnamed-event'].includes(p.kind))??[]
 const consentDrop=consentMeasured&&consentNow!==null&&consentThen!==null&&consentNow<consentThen/2
 const refusesSurge=refused>=10&&refused>priorRefused*2
 const nativeDrop=(change(report.pageviews,report.previousPageviews)??0)<-.2||(change(report.goals,report.previousGoals)??0)<-.2
 const ordersSteady=ordersKnown&&priorOrders.d>0&&orders.d>0&&Math.abs((rate(orders.n,orders.d)??0)-(rate(priorOrders.n,priorOrders.d)??0))<=.05
 if(structural.length||consentDrop||refusesSurge||nativeDrop&&ordersSteady){
  const facts=[accepted,goals]
  if(ordersKnown)facts.push(cite('Sender-reported completed orders / checkout attempts','completed orders',orders.n,priorOrders.n,orders.d,priorOrders.d,sourceLink))
  if(refusesSurge)facts.push(cite('Server-refused page loads / requests reaching collection','refusals',refused,priorRefused,report.pageviews+refused,report.previousPageviews+priorRefused,base+'#notes'))
  if(consentDrop)facts.push(cite('Accepted / accepted plus declined loads (not total visitors)','accepted loads',report.pageviews,report.previousPageviews,report.pageviews+declined,report.previousPageviews+priorDeclined,base+'#notes'))
  if(structural.length)facts.push(cite('Static instrumentation findings / inspected sitemap pages','findings',structural.length,null,inspected!.inspectedPages??null,null,`/app/sites/${siteId}?section=settings#scan-${inspected!.scanId}`))
  hypotheses.push({category:'tracking-coverage',title:structural.length?'Instrumentation break is consistent with the drop':consentDrop?'Changed consent coverage is consistent with the drop':refusesSurge?'Collection refusals are consistent with the drop':'Native events fell while reported order completion stayed stable',score:structural.length?100:consentDrop||refusesSurge?95:80,confidence:'medium',evidence:facts,disprove:'Exercise the affected deployed pages with consent, inspect actual payloads and compare independent completed orders. Intact payload coverage with the same decline in independent outcomes would weaken this explanation.',limitation:structural.length?structural.map(p=>p.detail).join(' '):'Coverage evidence does not establish the size of total traffic or identify a person.'})
 }
 if(!inspected)unknown.push('No instrumentation investigation was observed inside this exact window; current pages cannot establish a historical tracking break.')
 const searchKnown=search.days.every(d=>d.status==='final')&&beforeSearch.days.every(d=>d.status==='final')&&search.overall!==null&&beforeSearch.overall!==null
 if(!searchKnown)unknown.push(`Finalized Google search coverage is incomplete: ${search.days.filter(d=>d.status==='final').length}/${days.length} current and ${beforeSearch.days.filter(d=>d.status==='final').length}/${beforeDays.length} compared Pacific dates. Query rows are source-limited.`)
 if(searchKnown){
  const drops=search.queries.map(q=>({now:q,then:beforeSearch.queries.find(b=>b.query===q.query)})).filter(q=>q.then&&q.now.clicks<q.then.clicks&&q.now.position>q.then.position+2).sort((a,b)=>(b.then!.clicks-b.now.clicks)-(a.then!.clicks-a.now.clicks))
  if(drops.length){const q=drops[0]!,link=`/api/vane/search-console/report?${new URLSearchParams({siteId,from,to})}`
   hypotheses.push({category:'channel-mix',title:`Organic ranking decline for “${q.now.query}” is consistent with fewer search clicks`,score:85,confidence:'medium',evidence:[cite(`Google query “${q.now.query}” (Pacific dates, source-limited)`,'clicks',q.now.clicks,q.then!.clicks,q.now.impressions,q.then!.impressions,link),cite('Impression-weighted position for that query','position',q.now.position,q.then!.position,q.now.impressions,q.then!.impressions,link),accepted],disprove:'If finalized query positions recover while comparable search clicks do not, investigate demand, result-page changes and query coverage; an experiment or independent observation is needed to establish causality.',limitation:'A position change and a click change are correlated source observations, not proof that ranking caused the traffic change. Google dates are Pacific, while native dates use the site zone.'})
  }
 }
 const sourceMoves=report.sources.filter(r=>r.count!==r.previous).sort((a,b)=>Math.abs(b.count-b.previous)-Math.abs(a.count-a.previous))
 if(sourceMoves[0]){const m=sourceMoves[0];hypotheses.push({category:'channel-mix',title:`${m.label} changed its contribution to accepted traffic`,score:35,confidence:'low',evidence:[cite(`Source ${m.label}`,'pageviews',scalar(m.count),scalar(m.previous),report.pageviews,report.previousPageviews,base+'#sources')],disprove:'Compare this source’s independent delivery/search records and matched weekdays. A tracking or consent change limited to this source would weaken a demand explanation.',limitation:'Source attribution is an observed contribution. It does not explain why the source changed.'})}
 const orderRate=rate(orders.n,orders.d),priorOrderRate=rate(priorOrders.n,priorOrders.d),errorRate=rate(errors.n,errors.d),priorErrorRate=rate(priorErrors.n,priorErrors.d)
 if(ordersKnown&&errorsKnown&&orderRate!==null&&priorOrderRate!==null&&errorRate!==null&&priorErrorRate!==null&&orderRate<priorOrderRate&&errorRate>priorErrorRate){
  hypotheses.push({category:'page-behavior',title:'Checkout failure is consistent with reported errors and fewer completed orders',score:98,confidence:'medium',evidence:[cite('Sender-reported completed orders / checkout attempts','completed orders',orders.n,priorOrders.n,orders.d,priorOrders.d,sourceLink),cite('Sender-reported checkout failures / checkout requests','failed requests',errors.n,priorErrors.n,errors.d,priorErrors.d,sourceLink),goals,accepted],disprove:'Run a controlled checkout and inspect server receipts. Normal checkout error and completion rates, or independent orders that do not fall, would weaken this hypothesis.',limitation:'Both external series are sender-reported daily aggregates. Their correlation corroborates an observed failure; it does not independently establish its cause, provider authenticity or an identity match.'})
 }
 for(const f of report.funnels){const first=f.steps[0]!,last=f.steps.at(-1)!,a=rate(last.visits,first.visits),b=rate(last.previous,first.previous)
  if(a!==null&&b!==null&&a<b-.15)hypotheses.push({category:'page-behavior',title:`Completion fell in the ${f.name} funnel`,score:60,confidence:'low',evidence:[cite(`${f.name}: ${last.label} / ${first.label}`,'visits reaching final step',last.visits,last.previous,first.visits,first.previous,base+'#funnels')],disprove:'Exercise each step with instrumentation intact. A missing or renamed final-step event with stable independent orders would weaken a real checkout-loss explanation.',limitation:'Funnel reach measures tracked steps, not business outcomes or a causal mechanism.'})
 }
 const slow=report.perf.pages.filter(p=>p.lcp!==null&&p.lcp>2500)
 if(slow.length)hypotheses.push({category:'page-behavior',title:'Some measured pages have slow largest contentful paint',score:20,confidence:'low',evidence:slow.slice(0,2).map(p=>cite(`p75 LCP on ${p.label}`,'milliseconds',p.lcp!,null,p.measured,null,base+'#pages')),disprove:'Measure the same pages and devices before and after a controlled speed improvement; no conversion change with comparable coverage would weaken the hypothesis.',limitation:'This is a current nearest-rank p75 over measured loads. No matched prior speed comparison or causal effect has been established.'})
 else unknown.push('No slow measured-page LCP signal was found; absence of performance samples is not evidence that all pages were fast.')
 if(uptime.complete&&priorUptime.complete&&rate(uptime.n,uptime.d)!==null&&uptime.n>priorUptime.n)hypotheses.push({category:'external-events',title:'Reported availability failures overlap this window',score:50,confidence:'low',evidence:[cite('Sender-reported failed / completed availability checks','failed checks',uptime.n,priorUptime.n,uptime.d,priorUptime.d,sourceLink),accepted],disprove:'Compare independently timed outage coverage and unaffected locations. Traffic changing outside the failed-check intervals would weaken this explanation.',limitation:'Daily aggregate overlap does not establish that the failed checks prevented these visits.'})
 const notes=report.annotations.map(a=>({day:a.day,kind:a.kind,text:a.text,...(a.url?{url:a.url}:{})})),external=notes.filter(a=>['incident','campaign','error-spike','maintenance'].includes(a.kind))
 if(external.length)hypotheses.push({category:'external-events',title:'Dated incidents or campaign activity overlap this window',score:10,confidence:'low',evidence:external.map(a=>cite(`${a.day}: ${a.text}`,'dated annotations',1,null,days.length,null,a.url??base+'#notes')),disprove:'Compare precise incident/send timing with unaffected pages and sources. No temporal match or an unaffected comparison group would weaken the hypothesis.',limitation:'Annotations report dated events. They do not establish the size or cause of a traffic change.'})
 if(!report.previousPageviews)unknown.push('The compared period has no accepted page load; a percentage traffic change cannot be established.')
 if(report.annotations.some(a=>a.kind==='settings'||a.kind==='definition'))unknown.push('Settings or metric definitions changed in the window; inspect the dated annotations before treating denominators as comparable.')
 const holidays=Object.assign({},...Array.from(new Set(days.map(d=>Number(d.slice(0,4))))).map(usHolidays)),context=days.filter(d=>holidays[d]).map(day=>({day,label:holidays[day]+' (US observed federal holiday; context only)'}))
 hypotheses.sort((a,b)=>b.score-a.score||a.title.localeCompare(b.title))
 const result:MovementInvestigation={id:uid(),siteId,at:clock(),from,to,comparedFrom,comparedTo,timeZone:value.config.timeZone??'UTC',hypotheses,unknown:[...new Set(unknown)],annotations:notes,context,sourceCoverage,statement:'These are ranked, falsifiable hypotheses from the cited observations. Correlation is not proof of causality. Missing coverage is unknown and is never ranked as a cause.'}
 await atomic(env,actor,[statement(env,'INSERT INTO vane_movement_investigations(id,site_id,actor_id,at,from_day,to_day,compared_from,compared_to,report_json) VALUES(?,?,?,?,?,?,?,?,?)',result.id,siteId,actor.id,result.at,from,to,comparedFrom,comparedTo,JSON.stringify(result)),auditStatement(env,actor.id,'agent.movement',siteId,result.id)])
 return result
}

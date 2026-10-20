import { insist } from '../core'
import { localDate } from '../annotations'
import { pathAllowed, storedPath } from '../paths'
import { eventName } from '../properties'
import { csvRows } from './csv'
import type { AggregateRecord, ImportedDefinition } from './aggregate-types'
import type { ImportSite, SitePolicy } from './types'

// Account-free source exports only. OAuth and token custody require a separate policy decision.
// Data API: https://developers.google.com/analytics/devguides/reporting/data/v1/api-schema
// Admin: https://developers.google.com/analytics/devguides/config/admin/v1/rest/v1beta/properties.keyEvents
const DIMENSIONS = new Set(('date pagePath landingPage pageReferrer browser browserVersion operatingSystem operatingSystemVersion deviceCategory screenResolution country region city sessionDefaultChannelGroup sessionPrimaryChannelGroup sessionSource sessionMedium sessionSourceMedium sessionCampaignName sessionCampaignId sessionManualSource sessionManualMedium sessionManualCampaignName sessionManualCampaignId sessionManualAdContent sessionManualTerm eventName').split(' '))
const METRICS = new Set(('activeUsers totalUsers newUsers sessions engagedSessions screenPageViews screenPageViewsPerSession screenPageViewsPerUser userEngagementDuration averageSessionDuration engagementRate bounceRate eventCount eventCountPerUser eventsPerSession keyEvents sessionKeyEventRate userKeyEventRate totalRevenue purchaseRevenue grossPurchaseRevenue ecommercePurchases transactions totalPurchasers firstTimePurchasers averagePurchaseRevenue averagePurchaseRevenuePerUser averageRevenuePerUser purchaserRate addToCarts checkouts itemsAddedToCart itemsCheckedOut itemsPurchased itemRevenue refundAmount shippingAmount taxAmount').split(' '))
const COUNTS = new Set(('activeUsers totalUsers newUsers sessions engagedSessions screenPageViews eventCount keyEvents ecommercePurchases transactions totalPurchasers firstTimePurchasers addToCarts checkouts itemsAddedToCart itemsCheckedOut itemsPurchased').split(' '))
const UA_DIMENSIONS: Record<string,string> = {'Date':'date','Page':'pagePath','Landing Page':'landingPage','Source':'sessionSource','Medium':'sessionMedium','Source / Medium':'sessionSourceMedium','Default Channel Grouping':'sessionDefaultChannelGroup','Campaign':'sessionCampaignName','Keyword':'sessionManualTerm','Ad Content':'sessionManualAdContent','Country':'country','Region':'region','City':'city','Device Category':'deviceCategory','Browser':'browser','Browser Version':'browserVersion','Operating System':'operatingSystem','Operating System Version':'operatingSystemVersion','Screen Resolution':'screenResolution','Event Category':'eventCategory','Event Action':'eventAction','Event Label':'eventLabel'}
const UA_METRICS: Record<string,string> = {'Users':'users','New Users':'newUsers','Sessions':'sessions','Pageviews':'pageviews','Unique Pageviews':'uniquePageviews','Pages / Session':'pagesPerSession','Bounce Rate':'bounceRate','Avg. Session Duration':'averageSessionDuration','Avg. Time on Page':'averageTimeOnPage','Entrances':'entrances','Exits':'exits','% Exit':'exitRate','Goal Completions':'goalCompletions','Goal Conversion Rate':'goalConversionRate','Goal Value':'goalValue','Transactions':'transactions','Revenue':'revenue','Ecommerce Conversion Rate':'ecommerceConversionRate','Total Events':'totalEvents','Unique Events':'uniqueEvents','Event Value':'eventValue'}
const PROVENANCE = new Set(['sourceProperty','sourceTimeZone','sourceCoverage','currency'])
const object = (v:unknown):Record<string,any> => { insist(v&&typeof v==='object'&&!Array.isArray(v),'ga4_document','Use a Google Analytics source report object.'); return v as Record<string,any> }
const money = (v:unknown) => { insist(typeof v==='string'&&/^[A-Z]{3}$/.test(v),'ga4_currency','Retain the source report currency.'); return v }
const date = (v:unknown) => { insist(typeof v==='string','ga4_date','Use a source-local date.'); return localDate(/^\d{8}$/.test(v)?`${v.slice(0,4)}-${v.slice(4,6)}-${v.slice(6)}`:v) }
function label(value:unknown,key:string,policy:SitePolicy):string {
 insist(typeof value==='string'&&value.length<=200&&!/[<>@\u0000-\u001f\u007f]|%40|[?#]/i.test(value),'ga4_dimension','Remove personal labels and URL queries from source reports.')
 if(key==='date')return date(value)
 if(['pagePath','landingPage','unifiedPagePathScreen'].includes(key)&&value!=='(not set)'){
  insist(/^\/(?!\/)[^\s]*$/.test(value)&&storedPath(policy,value)===value&&pathAllowed(policy,value),'ga4_path','Source paths must fit the site’s privacy and path settings.'); return value
 }
 insist(!/\b\d[\d ().-]{5,}\d\b/.test(value)||['browserVersion','operatingSystemVersion','regionId','cityId','countryId','continentId','subContinentId'].includes(key),'ga4_dimension','Remove personal-looking source labels.')
 if(key==='pageReferrer')insist(!value||value==='(not set)'||/^https?:\/\/[a-z0-9.-]+(?::\d+)?\/?$/i.test(value),'ga4_referrer','Import referring origins without visitor paths or query strings.')
 return value
}
function metric(value:unknown,key:string,type?:string):number {
 insist(typeof value==='number'||typeof value==='string'&&/^-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?$/.test(value),'ga4_metric','Use unformatted numeric source metrics.')
 const result=Number(value)
 insist(Number.isFinite(result)&&Math.abs(result)<=Number.MAX_SAFE_INTEGER&&(result>=0||/revenue|refund|value|amount/i.test(key)),'ga4_metric','Invalid source metric.')
 insist(type!=='TYPE_INTEGER'||Number.isSafeInteger(result),'ga4_metric','Source integer metrics must be whole numbers.')
 return result
}
const reportName = (keys:string[]) => 'GA4.'+(keys.filter(k=>k!=='date').map(k=>k.replace(':','_')).sort().join('_')||'totals')
function sourceProperty(value:unknown) {
 insist(typeof value==='string'&&(/^(?:properties\/[1-9]\d*|UA-\d+-\d+)$/.test(value)),'ga4_property','Retain the source property ID.'); return value
}
function normalizeRecord(value:unknown,policy:SitePolicy):AggregateRecord {
 const r=object(value),dimensions=object(r.dimensions),metrics=object(r.metrics),ua=String(r.report).startsWith('UA.')
 insist(r.provider==='ga4'&&/^((GA4|UA)\.\w+)$/.test(r.report)&&Array.isArray(r.definitions),'ga4_report','Invalid source report row.')
 const clean:Record<string,string>={},measures:Record<string,number>={}
 for(const [key,value] of Object.entries(dimensions)){
  insist(PROVENANCE.has(key)||DIMENSIONS.has(key)||ua&&Object.values(UA_DIMENSIONS).includes(key)||r.report==='GA4.keyEvents'&&['countingMethod','defaultValue'].includes(key),'ga4_dimension','Unsupported source dimension.')
  clean[key]=key==='sourceProperty'?sourceProperty(value):key==='currency'?money(value):label(value,key,policy)
 }
 insist(clean.sourceProperty,'ga4_property','A source property is required.')
 for(const [key,value] of Object.entries(metrics)){
  insist(METRICS.has(key)||ua&&Object.values(UA_METRICS).includes(key)||r.report==='GA4.keyEvents'&&key==='defaultValue','ga4_metric','Unsupported source metric.')
  measures[key]=metric(value,key)
 }
 const day=date(r.day)
 insist(!clean.date||clean.date===day,'ga4_date','The row and report dates must agree.')
 const defs:ImportedDefinition[]=r.report==='GA4.keyEvents'?r.definitions.map((raw:unknown)=>{
  const d=object(raw),name=eventName(d.name)
  insist(name===clean.eventName&&d.event===name&&d.kind==='event'&&d.source==='GA4 Admin keyEvents'&&d.requiresObservation===true&&d.incomplete==='Confirm the matching native event or complete its trigger before proposing this key event.','ga4_definition','Key event triggers require native observation or explicit completion.')
  return {name,event:name,kind:'event',currency:money(d.currency),source:'GA4 Admin keyEvents',requiresObservation:true,incomplete:d.incomplete}
 }):[]
 insist(r.report==='GA4.keyEvents'?defs.length===1:r.definitions.length===0,'ga4_definition','History rows cannot invent native definitions.')
 if(!ua){
  for(const [key,value] of Object.entries(measures)){
   insist(!COUNTS.has(key)||Number.isSafeInteger(value),'ga4_metric','GA4 count metrics must be whole numbers.')
   insist(!['bounceRate','engagementRate','sessionKeyEventRate','userKeyEventRate','purchaserRate'].includes(key)||value<=1,'ga4_metric','GA4 rates must be fractions between zero and one.')
  }
 }
 if(r.report!=='GA4.keyEvents'){
  insist(clean.date===day,'ga4_date','Import daily source reports with a Date dimension.')
  insist(ua?r.report==='UA.history':r.report===reportName(Object.keys(clean).filter(k=>!PROVENANCE.has(k))),'ga4_report','The report name must match its independent grouping.')
 }
 insist(!Object.keys(measures).some(k=>/revenue|refund|amount|goalValue/i.test(k))||clean.currency,'ga4_currency','Monetary measures need their source currency.')
 return {id:'',day,provider:'ga4',report:r.report,dimensions:clean,metrics:measures,definitions:defs}
}
function ga4(input:Record<string,any>,policy:SitePolicy):AggregateRecord[] {
 const property=sourceProperty(input.property),from=date(input.from),to=date(input.to),out:AggregateRecord[]=[]
 insist(property.startsWith('properties/')&&from<=to&&Array.isArray(input.reports)&&Array.isArray(input.keyEvents??[]),'ga4_document','Use dated GA4 Data API reports and optional Admin key events.')
 for(const raw of input.reports){
  const report=object(raw),dh=report.dimensionHeaders,mh=report.metricHeaders
  insist(Array.isArray(dh)&&dh.length>0&&dh.length<=9&&dh.every(h=>h&&typeof h.name==='string'&&(DIMENSIONS.has(h.name)))&&new Set(dh.map(h=>h.name)).size===dh.length&&dh.some(h=>h.name==='date'),'ga4_dimension','Use daily, privacy-safe Data API dimensions.')
  insist(Array.isArray(mh)&&mh.length>0&&mh.length<=10&&mh.every(h=>h&&(METRICS.has(h.name))&&['TYPE_INTEGER','TYPE_FLOAT','TYPE_SECONDS','TYPE_MILLISECONDS','TYPE_MINUTES','TYPE_HOURS','TYPE_STANDARD','TYPE_CURRENCY','TYPE_FEET','TYPE_MILES','TYPE_METERS','TYPE_KILOMETERS'].includes(h.type))&&new Set(mh.map(h=>h.name)).size===mh.length,'ga4_metric','Use supported Data API metric headers.')
  const rows=report.rows??[]
  insist(Array.isArray(rows)&&Number.isSafeInteger(report.rowCount??0)&&(report.rowCount??0)===rows.length,'ga4_pagination','Import every source page; the row count must match the complete report.')
  const meta=object(report.metadata??{}),coverage=[meta.dataLossFromOtherRow?'other-row':'',meta.subjectToThresholding?'thresholded':'',meta.samplingMetadatas?.length?'sampled':'',meta.dataTruncationReasons?.length?'truncated':'',meta.schemaRestrictionResponse?.activeMetricRestrictions?.length?'restricted':''].filter(Boolean).join(',')||'source-reported'
  for(const rawRow of rows){
   const row=object(rawRow)
   insist(Array.isArray(row.dimensionValues)&&row.dimensionValues.length===dh.length&&Array.isArray(row.metricValues)&&row.metricValues.length===mh.length,'ga4_row','Source headers and row values must align.')
   const dimensions:Record<string,string>={sourceProperty:property,sourceCoverage:coverage},metrics:Record<string,number>={}
   if(meta.timeZone!==undefined)dimensions.sourceTimeZone=label(meta.timeZone,'sourceTimeZone',policy)
   if(meta.currencyCode!==undefined)dimensions.currency=money(meta.currencyCode)
   dh.forEach((h:any,i:number)=>dimensions[h.name]=label(object(row.dimensionValues[i]).value,h.name,policy))
   mh.forEach((h:any,i:number)=>metrics[h.name]=metric(object(row.metricValues[i]).value,h.name,h.type))
   const day=dimensions.date!;insist(day>=from&&day<=to,'ga4_date','A source row is outside the chosen inclusive date range.')
   out.push(normalizeRecord({provider:'ga4',day,report:reportName(dh.map(h=>h.name)),dimensions,metrics,definitions:[]},policy))
  }
 }
 for(const raw of input.keyEvents??[]){
  const key=object(raw),name=eventName(key.eventName)
  insist(typeof key.name==='string'&&key.name.startsWith(property+'/keyEvents/')&&/^properties\/\d+\/keyEvents\/[^/]+$/.test(key.name),'ga4_definition','Key events must belong to the selected property.')
  insist(['ONCE_PER_EVENT','ONCE_PER_SESSION','COUNTING_METHOD_UNSPECIFIED'].includes(key.countingMethod),'ga4_definition','Retain the source key event counting method.')
  const sourceCurrencies=[...new Set(input.reports.map((r:any)=>r.metadata?.currencyCode).filter(Boolean))]
  const currency=key.defaultValue?money(object(key.defaultValue).currencyCode):money(input.currency??(sourceCurrencies.length===1?sourceCurrencies[0]:undefined))
  const dimensions:Record<string,string>={sourceProperty:property,eventName:name,countingMethod:key.countingMethod},metrics:Record<string,number>={}
  if(key.defaultValue){dimensions.currency=currency;metrics.defaultValue=metric(key.defaultValue.numericValue,'defaultValue')}
  out.push(normalizeRecord({provider:'ga4',day:to,report:'GA4.keyEvents',dimensions,metrics,definitions:[{name,event:name,kind:'event',currency,source:'GA4 Admin keyEvents',requiresObservation:true,incomplete:'Confirm the matching native event or complete its trigger before proposing this key event.'}]},policy))
 }
 return out
}
function ua(input:Record<string,any>,policy:SitePolicy):AggregateRecord[] {
 const property=sourceProperty(input.property),from=date(input.from),to=date(input.to)
 insist(property.startsWith('UA-')&&from<=to&&typeof input.csv==='string','ua_document','Use a dated Universal Analytics CSV and its source property.')
 const lines=input.csv.replace(/^\uFEFF/,'').split(/\r?\n/).filter((line:string)=>!line.startsWith('#')).join('\n'),[headers,...rows]=csvRows(lines)
 insist(headers&&headers.includes('Date')&&new Set(headers).size===headers.length&&headers.every(h=>Object.hasOwn(UA_DIMENSIONS,h)||Object.hasOwn(UA_METRICS,h))&&headers.some(h=>Object.hasOwn(UA_METRICS,h)),'ua_columns','Choose an unformatted UA daily report with a Date column and supported dimension and metric headers.')
 return rows.map(cells=>{
  insist(cells.length===headers.length,'ua_csv','The CSV row does not match its headers.')
  const dimensions:Record<string,string>={sourceProperty:property,sourceCoverage:'unknown'},metrics:Record<string,number>={}
  headers.forEach((h,i)=>{if(UA_DIMENSIONS[h])dimensions[UA_DIMENSIONS[h]!]=label(cells[i],UA_DIMENSIONS[h]!,policy);else metrics[UA_METRICS[h]!]=metric(cells[i],UA_METRICS[h]!)})
  const day=dimensions.date!;insist(day>=from&&day<=to,'ua_date','A CSV row is outside the chosen inclusive range.')
  if(input.currency!==undefined)dimensions.currency=money(input.currency)
  return normalizeRecord({provider:'ga4',day,report:'UA.history',dimensions,metrics,definitions:[]},policy)
 })
}

/** Sanitized daily source aggregates retain source definitions; they never become native visits. */
export function normalizeGa4(document:unknown,_site:ImportSite,policy:SitePolicy):AggregateRecord[]|null {
 const input=document as any
 if(!input||!['vane-ga4-history/1','vane-ga4-normalized/1','vane-ua-csv/1'].includes(input.format))return null
 insist(new TextEncoder().encode(JSON.stringify(input)).length<=8_000_000,'ga4_size','Import source documents smaller than 8 MB.')
 const records=input.format==='vane-ga4-history/1'?ga4(input,policy):input.format==='vane-ua-csv/1'?ua(input,policy):(()=>{insist(Array.isArray(input.records),'ga4_document','Use normalized source rows.');return input.records.map((r:unknown)=>normalizeRecord(r,policy))})()
 insist(records.length>0&&records.length<=500,'ga4_rows','Import 1 to 500 source report rows per document. Split larger source exports into reviewed documents.')
 return records
}

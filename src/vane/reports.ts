import { importedRanges } from './movein/ranges'
import { consentedReport } from './consented'
import { visitorKey } from './visitor-key'
import { visibleImports } from './movein/cutover'
import { queryPaths as bingQueryPaths } from './bing'
import { queryPaths as googleQueryPaths } from './search-console'
import { aggregateCsvRow, importedReports } from './movein/aggregate-reports'
import { day, insist, rows, type Env, type Site } from './core'
import { clock } from './clock'
import { ENTRY_DIMENSIONS, entryMetrics, pageGroups, visitMetrics } from './visits'
import { searchMetrics } from './search'
import { sourceNameSql } from './sources'
import { filtered, hostFilter } from './hosts'
import { encodeFilter, filterText, parseFilters, segment, keptVisits, segmentStart } from './segments'
import { bucketKey, comparisonRange, COMPARISONS, intervalOf, localMidnight, PERIODS, presetRange, runningCut, upTo, type Comparison, type Period } from './periods'
import { METRICS, timeSeries, type Metric } from './series'
import { journeys, type JourneyMode } from './journeys'
import { funnelReport } from './funnels'
import { perfReport } from './performance'
import { customReport } from './custom-reports'
import { ECOMMERCE, ECOMMERCE_FUNNEL, productReport } from './ecommerce'
import { visitTimeout } from './definitions'
import { annotationsFor } from './annotations'
import { movers, variation, type Explanation } from './explain'
import { convertedSql, revenueTotals } from './revenue'
import { experimentReport } from './experiment-stats'
import { minorDigits } from './ecommerce'
import { locationMetrics, metroPlaces, type LocationLevel } from './locations'
import { metroNaming } from './metro-names'
const columns='id,site_id,day,kind,path,source,campaign,consent,sample_rate,import_job',nativeColumns=columns+',consented_visitor'
// Adapted from Mango insights/service.ts 7f27217b8ce03aeac9cf4eb3fa0c8eb7ebc28d3f:
// repository facts remain separate from their interpretation and time window.
export function createInsightsService(env:Env,value:Site,now=clock(),range?:{from:string|null,to:string|null,journey?:string|null,journeyMode?:string|null,period?:string|null,compare?:string|null,compareFrom?:string|null,compareTo?:string|null,weekdays?:string|null,interval?:string|null,metric?:string|null,group?:string|null,goal?:string|null,host?:string|null,hostOp?:string|null,filters?:string[],segment?:string|null,searchQuery?:string|null,searchProvider?:string|null,imported?:string|null},members?:string[]) {
 // DASH-010: a report covers one site or a roll-up's member sites, bound as a JSON array of site IDs.
 const scope=JSON.stringify(members??[value.id]);
 // IMPORT-007: with imported data off (`imported=off`), imported events and source reports leave every figure, comparison and CSV table of this view.
 const importedOff=range?.imported==='off'
 // DASH-013: a Hostname filter narrows every query below; imported history has no hostname, so it leaves the set.
 const host=hostFilter(range?.hostOp,range?.host),base=filtered('vane_events',host),baseSet=host||importedOff?`(SELECT ${nativeColumns},visitor FROM ${base})`:`(SELECT ${nativeColumns},visitor FROM vane_events UNION ALL SELECT ${columns},NULL AS consented_visitor,NULL AS visitor FROM ${visibleImports('vane_import_events')})`;
 // DASH-007: filters, and a saved segment's filters, narrow the set to the kept visits once the range is known (list below).
 const adHoc=parseFilters(range?.filters??[]);insist(!members||!range?.segment,'segment','Saved segments belong to one site; filter a roll-up with filters.');
 let ev=base,eventSet=host||importedOff?`(SELECT ${nativeColumns},visitor FROM ${ev})`:`(SELECT ${nativeColumns},visitor FROM vane_events UNION ALL SELECT ${columns},NULL AS consented_visitor,NULL AS visitor FROM ${visibleImports('vane_import_events')})`;
 // Days are the site's local dates. Explicit start and end dates make a custom range; otherwise a preset
 // (DASH-002) applies, by default the last seven days ending today.
 const timeZone=value.config.timeZone??'UTC',custom=Boolean(range?.from||range?.to),period=(custom?'custom':range?.period||'7d') as Period|'custom';
 insist(custom||Object.hasOwn(PERIODS,period),'period','Choose one of the preset ranges or a custom range.');
 if(custom)insist(Boolean(range!.from&&range!.to)&&[range!.from,range!.to].every(x=>/^\d{4}-\d{2}-\d{2}$/.test(x!)&&Number.isFinite(Date.parse(x!))&&day(Date.parse(x!))===x),'range','Choose valid start and end dates.');
 const preset=async()=>presetRange(period as Period,now,timeZone,period==='all'?(await rows<{d:string|null}>(env,`SELECT MIN(day) AS d FROM ${baseSet} WHERE site_id IN (SELECT value FROM json_each(?))`,scope))[0]?.d??null:null);
 const metric=(range?.metric||'visitors') as Metric;insist(Object.hasOwn(METRICS,metric),'metric','Chart one of the listed metrics.');
 // Unique visitors: consented identities once per site across the range, plus cookie-free daily uniques.
 const uniques=async(start:string,end:string,events=ev)=>Number((await rows(env,`SELECT COUNT(*) AS n FROM (SELECT DISTINCT ${visitorKey()} AS identity FROM ${events} WHERE site_id IN (SELECT value FROM json_each(?)) AND day>=? AND day<? AND kind='pageview' AND visitor IS NOT NULL)`,scope,start,end))[0].n);
 // CONV-001: converting visitors use the same consented/daily deduplication as unique visitors.
 const converters=(start:string,end:string,events=ev)=>rows<{label:string|null,converters:number}>(env,`SELECT kind AS label,COUNT(*) AS converters FROM (SELECT DISTINCT ${visitorKey()} AS identity,kind FROM ${events} WHERE site_id IN (SELECT value FROM json_each(?)) AND day>=? AND day<? AND kind!='pageview' AND visitor IS NOT NULL) GROUP BY kind UNION ALL SELECT NULL,COUNT(*) FROM (SELECT DISTINCT ${visitorKey()} AS identity FROM ${events} WHERE site_id IN (SELECT value FROM json_each(?)) AND day>=? AND day<? AND kind!='pageview' AND visitor IS NOT NULL)`,scope,start,end,scope,start,end);
 const hosts=(value.config.origins??[]).length>0,sourceName=sourceNameSql(value.config.sourceRules),groups=pageGroups(range?.group),goal=range?.goal||null;
 // DASH-004: a selected goal narrows the conversion rate of the page, channel, source and UTM tables.
 insist(goal===null||Object.hasOwn(value.config.goals,goal)||Object.hasOwn(value.config.customGoals??{},goal)||Object.hasOwn(value.config.scrollGoals??{},goal),'goal','Choose one of the site’s goals.');
 return {async list(){
  const saved=range?.segment?await segment(env,value.id,range.segment):null,extra=adHoc.filter(f=>!saved?.filters.some(s=>s.dimension===f.dimension&&s.op===f.op&&s.value===f.value)),filters=[...(saved?.filters??[]),...extra];
  // CONV-006: revenue sums in the site's currency (a roll-up's first site's), converted only at owner-entered rates.
  const scoped=await rows<{id:string,name:string,config_json:string}>(env,'SELECT id,name,config_json FROM vane_sites WHERE id IN (SELECT value FROM json_each(?)) ORDER BY created_at',scope),currency=value.config.currency??'USD',converted=convertedSql(scoped.map(s=>({id:s.id,config:JSON.parse(s.config_json)})),currency),cents=(n:number)=>Math.round(n*10**minorDigits(currency))/10**minorDigits(currency);
  const bounds=custom?{from:range!.from!,to:range!.to!}:await preset(),start=Date.parse(bounds.from),end=Date.parse(bounds.to);
  insist(start<end&&end-start<=3660*86400000,'range','The end date must follow the start, within ten years.');
  const to=day(end),from=day(start),interval=intervalOf(range?.interval,from,to);
  // DASH-008: the compared period (by default the previous one) feeds every total, breakdown, table and the chart overlay.
  const compare=(range?.compare||'previous') as Comparison;insist(Object.hasOwn(COMPARISONS,compare),'compare','Compare with the previous period, the same period last year or a custom period.');
  if(compare==='custom')insist([range!.compareFrom,range!.compareTo].every(x=>/^\d{4}-\d{2}-\d{2}$/.test(x??'')&&day(Date.parse(x!))===x)&&range!.compareFrom!<range!.compareTo!,'compare','Choose valid start and end dates for the comparison.');
  const weekdays=range?.weekdays==='on',{from:previousFrom,to:previousTo}=comparisonRange(compare,from,to,weekdays,{from:range?.compareFrom??null,to:range?.compareTo??null});
  insist(Date.parse(previousTo)-Date.parse(previousFrom)<=3660*86400000,'compare','The comparison must be within ten years.');intervalOf(interval,previousFrom,previousTo);
  const searchQuery=range?.searchQuery??null,searchProvider=range?.searchProvider??null;
  insist(!searchQuery||['google','bing'].includes(searchProvider??''),'search_query','Choose a connected keyword source.');
  insist(!searchQuery||searchQuery.length<=100,'search_query','Choose one of the source query labels.');
  const entryPaths=searchQuery?await (searchProvider==='bing'?bingQueryPaths:googleQueryPaths)(env,value.id,searchQuery,from,to):undefined;
  let release=async()=>{};
  if(filters.length||entryPaths!==undefined){const kept=await keptVisits(env,scope,filters,segmentStart(from,previousFrom),to>previousTo?to:previousTo,base,value.config.sourceRules,entryPaths);ev=kept.events;release=kept.release;eventSet=`(SELECT ${nativeColumns},visitor FROM ${ev})`}
  try{
  // DASH-008 like with like (periods.ts): with today in the range, the compared period counts up to the same moment of its matching day.
  const cut=runningCut(now,timeZone,from,to,previousFrom),setOf=(events:string,through:string)=>host||importedOff||filters.length||entryPaths!==undefined?`(SELECT ${nativeColumns},visitor FROM ${events})`:`(SELECT ${nativeColumns},visitor FROM ${events} UNION ALL SELECT ${columns},NULL AS consented_visitor,NULL AS visitor FROM ${visibleImports('vane_import_events')} WHERE day<='${through}')`
  const evNow=ev,evThen=cut?upTo(ev,cut.thenDay,cut.thenAt):ev,setNow=eventSet,setThen=cut?setOf(evThen,cut.thenDay):eventSet
  const count=async(start:string,end:string,kind:boolean,set=setNow)=>Number((await rows(env,`SELECT COUNT(*) AS n FROM ${set} WHERE site_id IN (SELECT value FROM json_each(?)) AND day>=? AND day<? AND kind${kind?'=':'!='}'pageview'`,scope,start,end))[0].n);
  // DASH-006: page loads and daily-unique visitors per derived device, browser, operating system and screen class.
  const dimension=(column:string,from:string,to:string,events:string)=>rows<{label:string,visitors:number,pageviews:number}>(env,`SELECT ${column} AS label,COUNT(DISTINCT CASE WHEN visitor IS NOT NULL THEN ${visitorKey()} END) AS visitors,COUNT(*) AS pageviews FROM ${events} WHERE site_id IN (SELECT value FROM json_each(?)) AND day>=? AND day<? AND kind='pageview' AND device IS NOT NULL GROUP BY label ORDER BY pageviews DESC,label`,scope,from,to);
  // Every breakdown row carries its count in the compared period, and lists rows seen in either period.
  const group=async(column:string,goals=false)=>rows<{label:string,count:number,previous:number}>(env,`SELECT label,SUM(n) AS count,SUM(p) AS previous FROM (SELECT ${column} AS label,1 AS n,0 AS p FROM ${setNow} WHERE site_id IN (SELECT value FROM json_each(?5)) AND day>=?1 AND day<?2 AND kind${goals?'!=':'='}'pageview' UNION ALL SELECT ${column},0,1 FROM ${setThen} WHERE site_id IN (SELECT value FROM json_each(?5)) AND day>=?3 AND day<?4 AND kind${goals?'!=':'='}'pageview') GROUP BY label ORDER BY count DESC,previous DESC,label`,from,to,previousFrom,previousTo,scope);
  // The tables measured over visits, devices, searches and automatic events, for one period.
  const tables=async(from:string,to:string,ev:string)=>{const [engagement,devices,browsers,browserVersions,systems,systemVersions,screens,siteSearch,entries,automaticEvents]=await Promise.all([visitMetrics(env,scope,from,to,groups,goal,ev,hosts,converted),dimension('device',from,to,ev),dimension('browser',from,to,ev),dimension("browser||' '||COALESCE(browser_version,'')",from,to,ev),dimension('os',from,to,ev),dimension("os||' '||COALESCE(os_version,'')",from,to,ev),dimension("COALESCE(screen,'Unknown')",from,to,ev),searchMetrics(env,scope,from,to,ev),entryMetrics(env,scope,from,to,goal,sourceName,ev,converted),filters.length?Promise.resolve([] as {kind:string,label:string,count:number}[]):rows<{kind:string,label:string,count:number}>(env,`SELECT kind,prop AS label,COUNT(*) AS count FROM ${filtered('vane_auto_events',host)} WHERE site_id IN (SELECT value FROM json_each(?)) AND day>=? AND day<? GROUP BY kind,prop ORDER BY kind,count DESC,prop`,scope,from,to)]);return {engagement,devices,browsers,browserVersions,systems,systemVersions,screens,siteSearch,entries,automaticEvents}};
  // A table row's change compares its first count column with the same row in the compared period (0 when absent there).
  const withPrevious=<T extends Record<string,any>>(now:T[],then:T[],keys:string[],field:string)=>now.map(row=>({...row,previous:Number(then.find(old=>keys.every(k=>old[k]===row[k]))?.[field]??0)}));
  // DASH-011: the journey through the chosen page, by default the most loaded one.
  const journey=async()=>{const path=range?.journey||(await rows<{path:string}>(env,`SELECT path FROM ${evNow} WHERE site_id IN (SELECT value FROM json_each(?)) AND day>=? AND day<? AND kind='pageview' AND at IS NOT NULL GROUP BY path ORDER BY COUNT(*) DESC,path LIMIT 1`,scope,from,to))[0]?.path;if(!path)return null;const mode=(range?.journeyMode||'page') as JourneyMode,[now,then]=await Promise.all([journeys(env,scope,from,to,evNow,path,mode),journeys(env,scope,previousFrom,previousTo,evThen,path,mode)]);
   // DASH-008: each journey row carries its visits in the compared period.
   const key=(row:{steps:string[]})=>row.steps.join('\u0000');return {...now,previousVisits:then.visits,next:withPrevious(now.next.map(r=>({...r,key:key(r)})),then.next.map(r=>({...r,key:key(r)})),['key'],'visits'),previous:withPrevious(now.previous.map(r=>({...r,key:key(r)})),then.previous.map(r=>({...r,key:key(r)})),['key'],'visits'),nextSteps:withPrevious(now.nextSteps,then.nextSteps,['step'],'reached'),previousSteps:withPrevious(now.previousSteps,then.previousSteps,['step'],'reached')}};
  // CONV-005: a site's funnels over the range and the compared period, with the report's hostname filter (roll-ups have none).
  // PERF-001: p75 page performance by page and device class, each row with its measured page loads then (DASH-008).
  const [perfNow,perfThen]=await Promise.all([perfReport(env,scope,from,to,evNow,hosts),perfReport(env,scope,previousFrom,previousTo,evThen,hosts)]),perf={pages:withPrevious(perfNow.pages,perfThen.pages,['label'],'measured'),devices:withPrevious(perfNow.devices,perfThen.devices,['label'],'measured')};
  // CONV-002: custom events and properties, each row with its count in the compared period (DASH-008).
  const [customNow,customThen]=await Promise.all([customReport(env,scope,from,to,evNow),customReport(env,scope,previousFrom,previousTo,evThen)]),eventTables={customEvents:withPrevious(customNow.customEvents,customThen.customEvents,['name'],'events'),eventProps:withPrevious(customNow.eventProps,customThen.eventProps,['name','key','value'],'events'),pageProps:withPrevious(customNow.pageProps,customThen.pageProps,['key','value'],'pageviews')};
  // CONV-007: the product report, each row with its purchased quantity in the compared period (DASH-008), and the
  // ready-made ecommerce funnel after the site's own funnels once either period has a standard ecommerce event.
  const [productsNow,productsThen]=await Promise.all([productReport(env,scope,from,to,evNow),productReport(env,scope,previousFrom,previousTo,evThen)]),products=withPrevious(productsNow,productsThen,['sku','name','category','currency'],'purchased');
  const shop=[...customNow.customEvents,...customThen.customEvents].some(r=>(ECOMMERCE as readonly string[]).includes(r.name));
  // EXPERIMENT-001: a site's split tests over the range (roll-ups have none).
  const experiments=members?[]:await experimentReport(env,value.id,from,to,evNow,value.config.experiments);
  const funnels=members?[]:await funnelReport(env,scope,{from,to},{from:previousFrom,to:previousTo},evNow,[...(value.config.funnels??[]),...(shop?[ECOMMERCE_FUNNEL]:[])],evThen);
  const [journey_,series,previousSeries,visitors,previousVisitors,pageviews,goals,previousPageviews,previousGoals,current,before,sources,campaigns,pages,goalCounts,converting,signals,coverage,exclusions,deletions]=await Promise.all([journey(),timeSeries(env,scope,from,to,interval,timeZone,setNow,evNow,converted),timeSeries(env,scope,previousFrom,previousTo,interval,timeZone,setThen,evThen,converted),uniques(from,to,evNow),uniques(previousFrom,previousTo,evThen),count(from,to,true),count(from,to,false),count(previousFrom,previousTo,true,setThen),count(previousFrom,previousTo,false,setThen),tables(from,to,evNow),tables(previousFrom,previousTo,evThen),group(sourceName),group('campaign'),group('path'),group('kind',true),converters(from,to,evNow),rows(env,'SELECT COALESCE(SUM(count),0) AS n FROM vane_signals WHERE site_id IN (SELECT value FROM json_each(?)) AND day>=? AND day<?',scope,from,to),rows(env,`SELECT COUNT(*) AS imported,SUM(CASE WHEN sample_rate IS NULL OR consent='unknown' THEN 1 ELSE 0 END) AS unknownCoverage FROM ${setNow} WHERE site_id IN (SELECT value FROM json_each(?)) AND day>=? AND day<? AND import_job IS NOT NULL`,scope,from,to),rows<{reason:string,count:number}>(env,'SELECT reason,SUM(count) AS count FROM vane_exclusions WHERE site_id IN (SELECT value FROM json_each(?)) AND day>=? AND day<? GROUP BY reason ORDER BY reason',scope,from,to),rows<{reason:string,beforeDay:string,at:number}>(env,'SELECT reason,before_day AS beforeDay,at FROM vane_deletions WHERE site_id IN (SELECT value FROM json_each(?)) AND before_day>? ORDER BY at',scope,from)]);
  // DASH-009 (with METRIC-004's definition versions): the annotations dated inside the range, for the charts they affect.
  const annotations=await annotationsFor(env,scoped.map(s=>({id:s.id,name:s.name,config:JSON.parse(s.config_json)})),from,to,Boolean(members)),timeout=members?null:visitTimeout(value.config);
  // REPORT-003: the largest movers with their totals, the range's annotations, coverage that changed, and each day's
  // place against the day-of-week baseline (ranges up to 31 days; the baseline needs the 8 weeks before the range).
  const [daily,firstDay,previousSignals,previousExclusions,previousCoverage]=await Promise.all([
   Date.parse(to)-Date.parse(from)<=31*86400000?timeSeries(env,scope,day(Date.parse(from)-56*86400000),to,'day',timeZone,setNow,evNow):Promise.resolve(null),
   rows<{d:string|null}>(env,`SELECT MIN(day) AS d FROM ${baseSet} WHERE site_id IN (SELECT value FROM json_each(?))`,scope),
   rows(env,'SELECT COALESCE(SUM(count),0) AS n FROM vane_signals WHERE site_id IN (SELECT value FROM json_each(?)) AND day>=? AND day<?',scope,previousFrom,previousTo),
   rows<{reason:string,count:number}>(env,'SELECT reason,SUM(count) AS count FROM vane_exclusions WHERE site_id IN (SELECT value FROM json_each(?)) AND day>=? AND day<? GROUP BY reason',scope,previousFrom,previousTo),
   rows(env,`SELECT COUNT(*) AS imported FROM ${setThen} WHERE site_id IN (SELECT value FROM json_each(?)) AND day>=? AND day<? AND import_job IS NOT NULL`,scope,previousFrom,previousTo)])
  // DASH-005: countries, regions and cities, each visit under its first page load's location, with the selected goal's
  // conversions and rate (CONV-004) and the compared period's visitors; they join the explanation's movers by unique visitors.
  // US metro areas key on the code; names come from the site's approved table now (metro-names.ts), and an unnamed
  // code's observed place (display only, never returned by an API) comes from this range's visits.
  const naming=await metroNaming(env,members??[value.id])
  const [placesNow,placesThen,observedPlaces]=await Promise.all([locationMetrics(env,scope,from,to,goal,evNow,converted,naming),locationMetrics(env,scope,previousFrom,previousTo,goal,evThen,converted,naming),metroPlaces(env,scope,from,to,evNow)])
  const LEVELS:[LocationLevel,string][]=[['countries','Country'],['regions','Region'],['cities','City'],['metros','US metro area']],places=Object.fromEntries(LEVELS.map(([level])=>[level,withPrevious(placesNow[level],placesThen[level],['label','country','region','metro_code'],'visitors')])) as Record<LocationLevel,ReturnType<typeof withPrevious<any>>>
  const placeName=(r:any)=>[r.label,r.region??r.country].filter(Boolean).join(', ')
  const deviceRows=withPrevious(current.devices,before.devices,['label'],'visitors'),channelRows=withPrevious(current.entries.channels,before.entries.channels,['label'],'visits'),named=campaigns.filter(r=>r.label!=='none')
  const reasonsNow=new Map(exclusions.map(r=>[r.reason,Number(r.count)])),reasonsThen=new Map(previousExclusions.map(r=>[r.reason,Number(r.count)]))
  const coverageChanges=[...[...new Set([...reasonsNow.keys(),...reasonsThen.keys()])].sort().map(reason=>({label:reason,now:reasonsNow.get(reason)??0,then:reasonsThen.get(reason)??0})),{label:'privacy-signals',now:Number(signals[0].n),then:Number(previousSignals[0].n)},{label:'imported',now:Number(coverage[0].imported),then:Number(previousCoverage[0].imported)}].filter(c=>c.now!==c.then)
  const closed=daily?Object.fromEntries((await rows<{day:string,label:string}>(env,'SELECT day,label FROM vane_closed_days WHERE site_id IN (SELECT value FROM json_each(?))',scope)).map(r=>[r.day,r.label])):{}
  const explain:Explanation={movers:[
   ...movers('Channel','visits',channelRows.map(r=>({label:r.label,now:r.visits,then:r.previous})),current.engagement.visits,before.engagement.visits),
   ...movers('Page','pageviews',pages.map(r=>({label:r.label,now:Number(r.count),then:Number(r.previous)})),pageviews,previousPageviews),
   ...movers('Campaign','pageviews',named.map(r=>({label:r.label,now:Number(r.count),then:Number(r.previous)})),named.reduce((n,r)=>n+Number(r.count),0),named.reduce((n,r)=>n+Number(r.previous),0)),
   ...movers('Device','unique visitors',deviceRows.map(r=>({label:r.label,now:Number(r.visitors),then:r.previous})),deviceRows.reduce((n,r)=>n+Number(r.visitors),0),deviceRows.reduce((n,r)=>n+r.previous,0)),
   ...LEVELS.flatMap(([level,name])=>movers(name,'unique visitors',places[level].map(r=>({label:placeName(r),now:Number(r.visitors),then:r.previous})),places[level].reduce((n,r)=>n+Number(r.visitors),0),placesThen[level].reduce((n,r)=>n+r.visitors,0))),
  ],annotations,coverage:coverageChanges,variation:daily?variation(daily,from,to,firstDay[0]?.d??null,closed):null};
  const {engagement,devices,browsers,browserVersions,systems,systemVersions,screens,siteSearch,entries,automaticEvents}=current,previousEngagement=before.engagement;
  const dimensions=Object.fromEntries((['devices','browsers','browserVersions','systems','systemVersions','screens'] as const).map(name=>[name,withPrevious(current[name],before[name],['label'],'visitors')]));
  // CONV-004: each device row also carries its visits, conversions and conversion rate (by each visit's first page load).
  dimensions.devices=dimensions.devices!.map(r=>{const v=entries.deviceVisits.find(x=>x.label===r.label);return {...r,visits:v?.visits??0,conversions:v?.conversions??0,conversionRate:v?.conversionRate??null,revenue:v?.revenue??0,currency,revenuePerVisitor:v&&r.visitors?cents(v.revenue/Number(r.visitors)):null}});
  const entryTables=Object.fromEntries((Object.keys(ENTRY_DIMENSIONS) as (keyof typeof ENTRY_DIMENSIONS)[]).map(name=>[name,withPrevious(entries[name],before.entries[name],['label'],'visitors')]));
  const conversionRate=(n:number)=>visitors?Math.round(n/visitors*1000)/10:null,convertersOf=(label:string|null)=>Number(converting.find(r=>r.label===label)?.converters??0);
  const goalBreakdown=goalCounts.map(row=>({...row,converters:convertersOf(row.label),conversionRate:conversionRate(convertersOf(row.label))}));
  // CONV-006: total revenue, orders (events carrying converted revenue), average order value and revenue per visitor,
  // with the compared period's revenue, unconverted revenue by currency and the owner's rates in effect.
  const [money,previousMoney]=await Promise.all([revenueTotals(env,scope,from,to,evNow,converted),revenueTotals(env,scope,previousFrom,previousTo,evThen,converted)]);
  const rates=scoped.filter(s=>(JSON.parse(s.config_json).currency??'USD')===currency).flatMap(s=>(JSON.parse(s.config_json).rates??[]).filter((r:any)=>r.from<to).map((r:any)=>({site:s.name,...r})));
  const revenue={currency,total:money.revenue,previous:previousMoney.revenue,orders:money.orders,previousOrders:previousMoney.orders,averageOrderValue:money.orders?cents(money.revenue/money.orders):null,perVisitor:visitors?cents(money.revenue/visitors):null,sent:money.sent,unconverted:money.unconverted,rates};
  const perVisitor=<T extends {revenue:number,visitors:number}>(r:T)=>({...r,currency,revenuePerVisitor:r.visitors?cents(r.revenue/r.visitors):null});
  for(const name of Object.keys(entryTables))entryTables[name]=(entryTables[name] as any[]).map(perVisitor) as any;
  const locations=Object.fromEntries(LEVELS.map(([level])=>[level,places[level].map(perVisitor)]));
  const difference=pageviews-previousPageviews,{visits,timedPageviews,...visit}=engagement;
  const [topPages,entryPages,exitPages,hostnames]=(['topPages','entryPages','exitPages','hostnames'] as const).map(name=>withPrevious<any>(engagement[name],previousEngagement[name],['path'],'visitors').map(perVisitor));
  // METRIC-002: views per visitor divides the page loads that carry a visitor hash by the daily uniques.
  const ranges=importedOff?[]:await importedRanges(env,members??[value.id],from,to);
  const sourceReports=importedOff?[]:await importedReports(env,members??[value.id],from,to);
  const consented=await consentedReport(env,scope,from,to,evNow,goal);
  return {consented,consentedCohorts:consented.cohorts.flatMap(c=>c.weeks.map(w=>({cohort:c.week,cohortSize:c.visitors,week:w.week+1,activeVisitors:w.returning,retention:w.retention,complete:w.complete}))),consentedAttribution:consented.attribution,searchQuery,searchProvider,importedRanges:ranges,importedOff,importedReports:sourceReports,importedSourceRows:sourceReports.map(aggregateCsvRow),visitors,previousVisitors,visits,previousVisits:previousEngagement.visits,pageviews,previousPageviews,pagesPerVisit:visit.pagesPerVisit,viewsPerVisitor:visitors?Math.round(timedPageviews/visitors*100)/100:null,bounces:visit.bounces,bounceRate:visit.bounceRate,previousBounceRate:previousEngagement.bounceRate,medianDuration:visit.medianDuration,previousMedianDuration:previousEngagement.medianDuration,averageDuration:visit.averageDuration,topPages,entryPages,exitPages,...entryTables,...locations,metroNames:{labels:naming.labels,public:naming.public},metroPlaces:observedPlaces,sourceReferrers:withPrevious(entries.sourceReferrers,before.entries.sourceReferrers,['source','referrer'],'visits'),...dimensions,siteSearch:{...siteSearch,terms:withPrevious(siteSearch.terms,before.siteSearch.terms,['term'],'searches'),startPages:withPrevious(siteSearch.startPages,before.siteSearch.startPages,['path'],'searches')},automaticEvents:withPrevious(automaticEvents,before.automaticEvents,['kind','label'],'count'),converters:convertersOf(null),conversionRate:conversionRate(convertersOf(null)),goal,host,hostnames,...eventTables,products,revenue,experiments,filters:filters.map(f=>({...f,text:filterText(f)})),filterParams:extra.map(encodeFilter),segment:saved?{id:saved.id,name:saved.name}:null,group:groups.map(g=>g.pattern===g.label?g.pattern:`${g.pattern}=${g.label}`).join('\n'),goals,previousGoals,from,to,previousFrom,previousTo,compare,weekdays,timeZone,period,interval,metric,series,previousSeries,running:cut?{...cut,bucket:interval==='hour'?String(Math.floor((cut.at-localMidnight(from,timeZone))/3600000)):bucketKey(interval,cut.day,from,timeZone)}:null,journey:journey_,sources,campaigns,pages,goalBreakdown,imported:Number(coverage[0].imported),privacySignals:Number(signals[0].n),exclusions:exclusions.map(r=>({reason:r.reason,count:Number(r.count)})),deletedHistory:deletions,complete:false,signalCounter:value.config.signalCounter===true,unknownCoverage:Number(coverage[0].unknownCoverage??0),visitTimeout:timeout,annotations,explain,funnels,perf,explanation:`${from} to ${to} (end exclusive, ${timeZone}): ${pageviews} accepted page loads; ${previousFrom} to ${previousTo}: ${previousPageviews}. Difference: ${difference>=0?'+':''}${difference}. Goal events: ${goals}, previously ${previousGoals}. Unique visitors: ${visitors}, previously ${previousVisitors}, consented visitors deduplicated across days within each site, plus daily uniques without a consented identifier. Visits: ${visits}, previously ${previousEngagement.visits}, each a run of one visitor hash's page loads with no gap over ${timeout===null?'each site’s visit timeout':`${timeout} minutes`}${annotations.some(a=>a.kind==='definition')?' (the visit definition changed in this range; see the chart annotations)':''}. Consent exclusions, blockers, sampling, collection limits, imports and deleted history can change these totals. Collection coverage is not measured, so this comparison does not establish a change in total traffic.`};
  }finally{await release()}
 }};
}

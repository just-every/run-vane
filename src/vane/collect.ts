import { paymentReferrer } from './revenue'
import { consentAccepted, consentRequired } from './consent'
import { assignments } from './experiments'
import { day, insist, site, siteOrigin, statement, VaneError, type Env } from './core'
import { tracker } from './tracker'
import { signalResponse } from './privacy-signals'
import { localDay, visitorHash } from './visitors'
import { clock } from './clock'
import { ENGAGED_AFTER_MS, ENGAGEMENT_WINDOW_MS } from './visits'
import { goalApplies } from './goals'
import { deviceOf } from './devices'
import { searchTerm } from './search'
import { hostOf, keptValue, pathAllowed, redactPath, storedPath, visitSource } from './paths'
import { channelOf, webmail } from './channels'
import { countExclusion, declinedResponse } from './exclusions'
import { excludedTraffic } from './traffic'
import { propertiesMatch, cleanProps, droppedStatement, propStatements } from './properties'
export async function collector(request:Request,env:Env):Promise<Response|null> {
 const url=new URL(request.url);
 const signal=await signalResponse(request,env)??await declinedResponse(request,env);if(signal)return signal;
 if(url.pathname==='/vane.js')return new Response(request.method==='HEAD'?null:tracker,{headers:{'content-type':'application/javascript; charset=utf-8','cache-control':'public,max-age=300','x-content-type-options':'nosniff'}});
 const match=url.pathname.match(/^\/api\/vane\/config\/([\w-]+)$/);
 const engage=url.pathname==='/api/vane/engage';
 if(!match&&!engage&&url.pathname!=='/api/vane/collect')return null;
 let cors:Record<string,string>={'vary':'Origin','cache-control':'no-store'};
 try {
  let payload:any;
  if(!match&&request.method!=='OPTIONS') { insist(request.method==='POST','method','POST required.',405); const text=await request.text(); insist(text.length<=8192,'body','Event too large.',413); payload=JSON.parse(text); }
  const id=match?.[1]??payload?.siteId??url.searchParams.get('siteId');
  // Preflight advertises no read privilege and never admits an event.
  if(request.method==='OPTIONS')return new Response(null,{status:204,headers:{...cors,'access-control-allow-origin':request.headers.get('origin')??'null','access-control-allow-methods':'POST','access-control-allow-headers':'content-type','access-control-max-age':'600'}});
  const value=await site(env,String(id));
  const origin=siteOrigin(value,request);cors={...cors,'access-control-allow-origin':origin};
  // The script's configuration door serves only what the script uses (PRIVACY-003: whether this visitor's region
  // requires consent, never the region itself, and the consent manager to read); the owner's excluded addresses and countries
  // (COLLECT-003), goals, funnels and other settings stay in the installation.
  if(match) { insist(request.method==='GET','method','GET required.',405); const c=value.config; return Response.json({consent:consentRequired(c,request)?'required':'not-required',...(c.consentAdapter?{consentAdapter:c.consentAdapter}:{}),sampleRate:c.sampleRate,...(c.declinedCounter?{declinedCounter:true}:{}),autoEvents:c.autoEvents??[],queryKeys:c.queryKeys??[],...(c.searchParam?{searchParam:c.searchParam}:{}),...(c.incumbentCompatibility?{incumbentCompatibility:true,currency:c.currency??'USD'}:{}),eventDefinitions:c.eventDefinitions??[]},{headers:cors}); }
  if(engage) {
   // METRIC-003: a ping names only the site and its own page load, at least 10 seconds and at most
   // 30 minutes after that load; the latest ping marks the page engaged and ends its time.
   // METRIC-006: it carries the deepest scroll reached, and scroll-depth goals count against it.
   insist(Object.keys(payload??{}).every(key=>['id','siteId','scroll'].includes(key))&&/^[a-f0-9-]{36}$/.test(payload.id),'fields','An engagement ping carries only the site and page-load IDs and the scroll depth.');
   insist(Number.isInteger(payload.scroll)&&payload.scroll>=0&&payload.scroll<=100,'scroll','Scroll depth is a whole percentage from 0 to 100.');
   const at=clock(),eventId=value.id+':'+payload.id,load=await env.DB.prepare("SELECT at,path,hostname FROM vane_events WHERE id=? AND kind='pageview'").bind(eventId).first<{at:number|null,path:string,hostname:string|null}>();
   insist(typeof load?.at==='number','page_load','No timed page load has this ID.',404);
   insist(at-load.at>=ENGAGED_AFTER_MS,'engagement','Engagement counts after 10 seconds on the page.',409);
   insist(at-load.at<=ENGAGEMENT_WINDOW_MS,'expired','Engagement more than 30 minutes after its page load is not counted.',409);
   const recovered=Object.entries(value.config.customGoals??{}).filter(([,g])=>g.depth!==undefined),pageProps=recovered.some(([,g])=>g.props)?(await env.DB.prepare('SELECT key,value FROM vane_event_props WHERE event_id=?').bind(eventId).all<{key:string,value:string}>()).results.map(p=>[p.key,p.value] as [string,string]):[];
   const goals=[...Object.entries(value.config.scrollGoals??{}),...recovered.filter(([,g])=>propertiesMatch(g.props,pageProps)).map(([name,g])=>[name,{path:g.path!,depth:g.depth!}] as [string,{path:string;depth:number}])].filter(([,goal])=>goalApplies(goal.path,load.hostname,load.path));
   await env.DB.batch([statement(env,'UPDATE vane_events SET engaged_at=MAX(COALESCE(engaged_at,0),?),scroll=MAX(COALESCE(scroll,0),?) WHERE id=?',at,payload.scroll,eventId),...goals.map(([name,goal])=>statement(env,'INSERT OR IGNORE INTO vane_events(id,site_id,day,kind,path,source,campaign,consent,sample_rate,visitor,at,hostname) SELECT id||?,site_id,day,?,path,source,campaign,consent,sample_rate,visitor,at,hostname FROM vane_events WHERE id=? AND scroll>=?',':'+name,name,eventId,goal.depth))]);
   return Response.json({accepted:true},{status:202,headers:cors});
  }
  insist(payload&&Object.keys(payload).every(key=>['id','siteId','path','source','referrer','campaign','utm','ref','click','query','consent','width','search','props'].includes(key)),'fields','Only the declared anonymous fields are accepted.');
  // COLLECT-002: the page's hostname comes from its verified origin; the path is redacted and rewritten before
  // storage; UTM fields, ref/source and the owner's kept query keys arrive as values, and click IDs only as a flag.
  const utm=payload.utm??{},query=payload.query??{};
  insist(utm&&typeof utm==='object'&&!Array.isArray(utm)&&Object.keys(utm).every(key=>['source','medium','term','content'].includes(key)),'utm','UTM fields are source, medium, term and content; the campaign is its own field.');
  insist(query&&typeof query==='object'&&!Array.isArray(query)&&Object.keys(query).every(key=>(value.config.queryKeys??[]).includes(key)),'query','Only the query parameters this site keeps are accepted.');
  insist(payload.click===undefined||payload.click===true,'click','The paid-click flag is true or absent.');
  insist(typeof payload.path==='string'&&/^\/[^?#\s]{0,1023}$/.test(payload.path),'path','Send the page path without its query or fragment.');
  insist(payload.search===undefined||Boolean(value.config.searchParam)&&typeof payload.search==='string'&&payload.search.trim().length>0&&payload.search.length<=100,'search','Search terms are accepted only for a named site-search parameter, up to 100 characters.');
  insist(payload.width===undefined||Number.isInteger(payload.width)&&payload.width>=0&&payload.width<=10000,'width','The viewport width is a whole number of CSS pixels.');
  insist(/^[a-f0-9-]{36}$/.test(payload.id),'event_id','A fresh UUID identifies each page load.');
  const path=storedPath(value.config,payload.path),utmSource=keptValue(utm.source);
  if(!pathAllowed(value.config,path)){await countExclusion(env,value.id,localDay(clock(),value.config.timeZone??'UTC'),'excluded-path').run();throw new VaneError('path','This path is not collected for this site.',403)}
  // DASH-004: the referring page is kept as its hostname and redacted path, without query or fragment; an
  // Android app referrer (DASH-014) is kept as its app ID only; an
  // email client or webmail referrer is grouped as the source webmail and its address is not kept.
  let referrer:URL|null=null;
  if(payload.referrer!==undefined){try{referrer=new URL(String(payload.referrer))}catch{}insist(referrer&&['http:','https:','android-app:'].includes(referrer.protocol)&&!referrer.username&&!referrer.password&&String(payload.referrer).length<=1100,'referrer','Send the referring page as a web address without credentials.')}
  const own=[value.origin,...(value.config.origins??[])].map(hostOf),refHost=referrer?(referrer.protocol==='android-app:'?'android-app://':'')+referrer.hostname.toLowerCase():payload.source,mail=typeof refHost==='string'&&webmail(refHost),kept=Object.keys(query).sort().flatMap(key=>{const v=keptValue(query[key]);return v===null?[]:[key+'='+v]});
  // COLLECT-003: owner-excluded IPs and countries, bots, data-centre networks and referrer spam are counted by reason and refused.
  const excluded=excludedTraffic(request,value.config,typeof refHost==='string'&&!refHost.startsWith('android-app://')?refHost:null);
  if(excluded){await countExclusion(env,value.id,localDay(clock(),value.config.timeZone??'UTC'),excluded).run();throw new VaneError('excluded',`This traffic is excluded from collection (${excluded}).`,403)}
  const e={hostname:hostOf(origin),path,source:mail&&!utmSource&&!keptValue(payload.ref)?'webmail':visitSource(utmSource,keptValue(payload.ref),refHost,own),referrer:referrer&&referrer.protocol!=='android-app:'&&!mail&&!own.includes(referrer.hostname.toLowerCase())?referrer.hostname.toLowerCase()+redactPath(referrer.pathname||'/'):null,campaign:keptValue(payload.campaign)??'none',utmSource,utmMedium:keptValue(utm.medium),utmTerm:keptValue(utm.term),utmContent:keptValue(utm.content),paidClick:payload.click?1:0,query:kept.length?kept.join('&'):null};
  insist(consentAccepted(value.config,request,payload.consent),'consent','Consent is required for collection.',403);
  const now=clock(),today=localDay(now,value.config.timeZone??'UTC'),eventId=value.id+':'+payload.id,props=cleanProps(payload.props);
  let channel=channelOf(e.source,e.utmMedium,e.paidClick===1);
  // CONV-006: a return from a payment processor keeps the visitor's latest earlier acquisition that day (else direct).
  const payment=!utmSource&&!keptValue(payload.ref)&&paymentReferrer(refHost);
  const prior=await env.DB.prepare('SELECT * FROM vane_events WHERE id=?').bind(eventId).first<any>();
  if(prior) { insist(prior.path===e.path&&(payment||prior.source===e.source)&&prior.campaign===e.campaign,'conflict','Event ID already has different data.',409); return Response.json({accepted:true,duplicate:true},{headers:cors}); }
  const visitor=await visitorHash(env,value,request,today,now),d=deviceOf(request.headers.get('user-agent')??'',payload.width),search=payload.search===undefined?null:searchTerm(payload.search);
  if(payment){const before=await env.DB.prepare("SELECT source,referrer,campaign,utm_source,utm_medium,utm_term,utm_content,paid_click,channel FROM vane_events WHERE site_id=? AND day=? AND visitor=? AND kind='pageview' ORDER BY at DESC,id DESC LIMIT 1").bind(value.id,today,visitor).first<any>();Object.assign(e,{source:before?.source??'direct',referrer:before?.referrer??null,campaign:before?.campaign??'none',utmSource:before?.utm_source??null,utmMedium:before?.utm_medium??null,utmTerm:before?.utm_term??null,utmContent:before?.utm_content??null,paidClick:before?.paid_click??0});channel=before?.channel??channelOf('direct',null,false)}
  const kinds=['pageview',...[...Object.entries(value.config.goals),...Object.entries(value.config.customGoals??{}).filter(([,g])=>g.path&&g.depth===undefined&&propertiesMatch(g.props,props.kept)).map(([name,g])=>[name,g.path!] as [string,string])].filter(([,goal])=>goalApplies(goal,e.hostname,e.path)).map(([name])=>name)];
  const statements=[statement(env,'DELETE FROM vane_guard'),statement(env,'INSERT INTO vane_guard(value) SELECT CASE WHEN EXISTS(SELECT 1 FROM vane_sites WHERE id=? AND version=?) THEN 1 ELSE 0 END',value.id,value.version),statement(env,'INSERT INTO vane_admission(site_id,day,count) VALUES(?,?,1) ON CONFLICT(site_id,day) DO UPDATE SET count=count+1',value.id,today),statement(env,'INSERT INTO vane_guard(value) SELECT CASE WHEN count<=10000 THEN 1 ELSE 0 END FROM vane_admission WHERE site_id=? AND day=?',value.id,today)];
  for(const kind of kinds)statements.push(statement(env,'INSERT INTO vane_events(id,site_id,day,kind,path,source,campaign,consent,sample_rate,visitor,at,device,browser,browser_version,os,os_version,screen,search,hostname,utm_source,utm_medium,utm_term,utm_content,paid_click,query,channel,referrer) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',kind==='pageview'?eventId:eventId+':'+kind,value.id,today,kind,e.path,e.source,e.campaign,payload.consent,value.config.sampleRate,visitor,now,d.device,d.browser,d.browserVersion,d.os,d.osVersion,d.screen,kind==='pageview'?search:null,e.hostname,e.utmSource,e.utmMedium,e.utmTerm,e.utmContent,e.paidClick,e.query,channel,e.referrer));
  // CONV-002: a pageview's properties (INSTALL-007) are stored beside it.
  statements.push(...propStatements(env,eventId,value.id,today,props),...droppedStatement(env,value.id,today,props),statement(env,'DELETE FROM vane_guard'));
  try{await env.DB.batch(statements)}catch { throw new VaneError('admission','Collection changed, the daily limit was reached, or this event was already admitted. Refresh before sending another page load.',409) }
  // EXPERIMENT-001: the page load's variant in each split test running on its page, from its visitor hash.
  const experiments=await assignments(value.config.experiments,visitor,e.hostname,e.path);
  return Response.json({accepted:true,...(experiments?{experiments}:{})},{status:202,headers:cors});
 } catch(error) { const e=error instanceof VaneError?error:new VaneError('invalid_event','Event could not be accepted.'); return Response.json({error:e.code,message:e.message},{status:e.status,headers:cors}); }
}

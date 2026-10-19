import { day, insist, site, statement, VaneError, type Env } from './core'
import { tracker } from './tracker'
import { signalResponse } from './privacy-signals'
import { localDay, visitorHash } from './visitors'
import { clock } from './clock'
import { ENGAGED_AFTER_MS, VISIT_GAP_MS } from './visits'
export async function collector(request:Request,env:Env):Promise<Response|null> {
 const url=new URL(request.url);
 const signal=await signalResponse(request,env);if(signal)return signal;
 if(url.pathname==='/vane.js')return new Response(request.method==='HEAD'?null:tracker,{headers:{'content-type':'application/javascript; charset=utf-8','cache-control':'public,max-age=300','x-content-type-options':'nosniff'}});
 const match=url.pathname.match(/^\/api\/vane\/config\/([\w-]+)$/);
 const engage=url.pathname==='/api/vane/engage';
 if(!match&&!engage&&url.pathname!=='/api/vane/collect')return null;
 let cors:Record<string,string>={'vary':'Origin','cache-control':'no-store'};
 try {
  let payload:any;
  if(!match&&request.method!=='OPTIONS') { insist(request.method==='POST','method','POST required.',405); const text=await request.text(); insist(text.length<=2048,'body','Event too large.',413); payload=JSON.parse(text); }
  const id=match?.[1]??payload?.siteId??url.searchParams.get('siteId');
  // Preflight advertises no read privilege and never admits an event.
  if(request.method==='OPTIONS')return new Response(null,{status:204,headers:{...cors,'access-control-allow-origin':request.headers.get('origin')??'null','access-control-allow-methods':'POST','access-control-allow-headers':'content-type','access-control-max-age':'600'}});
  const value=await site(env,String(id));
  insist(request.headers.get('origin')===value.origin,'origin','Origin is not registered for this site.',403);
  cors={...cors,'access-control-allow-origin':value.origin};
  if(match) { insist(request.method==='GET','method','GET required.',405); return Response.json(value.config,{headers:cors}); }
  if(engage) {
   // METRIC-003: a field-free ping names only the site and its own page load, at least 10 seconds and
   // at most 30 minutes after that load; the latest ping marks the page engaged and ends its time.
   insist(Object.keys(payload??{}).every(key=>['id','siteId'].includes(key))&&/^[a-f0-9-]{36}$/.test(payload.id),'fields','An engagement ping carries only the site and page-load IDs.');
   const at=clock(),eventId=value.id+':'+payload.id,load=await env.DB.prepare("SELECT at FROM vane_events WHERE id=? AND kind='pageview'").bind(eventId).first<{at:number|null}>();
   insist(typeof load?.at==='number','page_load','No timed page load has this ID.',404);
   insist(at-load.at>=ENGAGED_AFTER_MS,'engagement','Engagement counts after 10 seconds on the page.',409);
   insist(at-load.at<=VISIT_GAP_MS,'expired','Engagement more than 30 minutes after its page load is not counted.',409);
   await env.DB.prepare('UPDATE vane_events SET engaged_at=MAX(COALESCE(engaged_at,0),?) WHERE id=?').bind(at,eventId).run();
   return Response.json({accepted:true},{status:202,headers:cors});
  }
  insist(payload&&Object.keys(payload).every(key=>['id','siteId','path','source','campaign','consent'].includes(key)),'fields','Only the declared anonymous fields are accepted.');
  insist(/^[a-f0-9-]{36}$/.test(payload.id),'event_id','A fresh UUID identifies each page load.');
  insist(value.config.paths.includes(payload.path),'path','Path is not approved.');
  insist(['direct','other',...value.config.sources].includes(payload.source),'source','Source is not approved.');
  insist(['none','other',...value.config.campaigns].includes(payload.campaign),'campaign','Campaign is not approved.');
  insist(payload.consent===(value.config.consent==='required'?'granted':'not-required'),'consent','Consent is required for collection.',403);
  const now=clock(),today=localDay(now,value.config.timeZone??'UTC'),eventId=value.id+':'+payload.id;
  const prior=await env.DB.prepare('SELECT * FROM vane_events WHERE id=?').bind(eventId).first<any>();
  if(prior) { insist(prior.path===payload.path&&prior.source===payload.source&&prior.campaign===payload.campaign,'conflict','Event ID already has different data.',409); return Response.json({accepted:true,duplicate:true},{headers:cors}); }
  const visitor=await visitorHash(env,value,request,today,now);
  const kinds=['pageview',...Object.entries(value.config.goals).filter(([,path])=>path===payload.path).map(([name])=>name)];
  const statements=[statement(env,'DELETE FROM vane_guard'),statement(env,'INSERT INTO vane_guard(value) SELECT CASE WHEN EXISTS(SELECT 1 FROM vane_sites WHERE id=? AND version=?) THEN 1 ELSE 0 END',value.id,value.version),statement(env,'INSERT INTO vane_admission(site_id,day,count) VALUES(?,?,1) ON CONFLICT(site_id,day) DO UPDATE SET count=count+1',value.id,today),statement(env,'INSERT INTO vane_guard(value) SELECT CASE WHEN count<=10000 THEN 1 ELSE 0 END FROM vane_admission WHERE site_id=? AND day=?',value.id,today)];
  for(const kind of kinds)statements.push(statement(env,'INSERT INTO vane_events(id,site_id,day,kind,path,source,campaign,consent,sample_rate,visitor,at) VALUES(?,?,?,?,?,?,?,?,?,?,?)',kind==='pageview'?eventId:eventId+':'+kind,value.id,today,kind,payload.path,payload.source,payload.campaign,payload.consent,value.config.sampleRate,visitor,now));
  statements.push(statement(env,'DELETE FROM vane_guard'));
  try{await env.DB.batch(statements)}catch { throw new VaneError('admission','Collection changed, the daily limit was reached, or this event was already admitted. Refresh before sending another page load.',409) }
  return Response.json({accepted:true},{status:202,headers:cors});
 } catch(error) { const e=error instanceof VaneError?error:new VaneError('invalid_event','Event could not be accepted.'); return Response.json({error:e.code,message:e.message},{status:e.status,headers:cors}); }
}

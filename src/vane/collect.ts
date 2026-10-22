import { collectionBatchResponse } from './collection/batch'
import { validatePageview } from './collection/validation'
import { admitPageviews } from './collection/admit'
import { countCollectionRefusal } from './collection/refusal'
import { declinedResponse } from './exclusions'
import { rawEvent, rawEventPredicate } from './raw'
import { collectHeat } from './heat/collect'
import { heatPaths } from './heat/settings'
import { consentedPage } from './consented'
import { consentRequired } from './consent'
import { insist, site, siteOrigin, statement, VaneError, type Env, type Site } from './core'
import { tracker } from './tracker'
import { signalResponse } from './privacy-signals'
import { clock } from './clock'
import { ENGAGED_AFTER_MS, ENGAGEMENT_WINDOW_MS } from './visits'
import { goalApplies } from './goals'
import { propertiesMatch } from './properties'
export async function collector(request:Request,env:Env):Promise<Response|null> {
 const url=new URL(request.url);
 const batch=await collectionBatchResponse(request,env);if(batch)return batch;
 const signal=await signalResponse(request,env)??await declinedResponse(request,env);if(signal)return signal;
 if(url.pathname==='/vane.js')return new Response(request.method==='HEAD'?null:tracker,{headers:{'content-type':'application/javascript; charset=utf-8','cache-control':'public,max-age=300','x-content-type-options':'nosniff'}});
 const match=url.pathname.match(/^\/api\/vane\/config\/([\w-]+)$/);
 const engage=url.pathname==='/api/vane/engage',heat=url.pathname==='/api/vane/heat-click';
 if(!match&&!engage&&!heat&&url.pathname!=='/api/vane/collect')return null;
 let cors:Record<string,string>={'vary':'Origin','cache-control':'no-store'},known:Site|null=null;
 try {
  let payload:any;
  if(!match&&request.method!=='OPTIONS') { insist(request.method==='POST','method','POST required.',405); const text=await request.text(); if(text.length>8192){
    // A well-formed oversized page load still identifies the site's coverage counter, but none of its fields enter custody.
    try{known=await site(env,String(JSON.parse(text)?.siteId??url.searchParams.get('siteId')))}catch{}
    throw new VaneError('body','Event too large.',413);
   } try{payload=JSON.parse(text)}catch{throw new VaneError('json','Send a JSON event.')}
   insist(payload&&typeof payload==='object'&&!Array.isArray(payload),'fields','Send one event object.'); }
  const id=match?.[1]??payload?.siteId??url.searchParams.get('siteId');
  // Preflight advertises no read privilege and never admits an event.
  if(request.method==='OPTIONS')return new Response(null,{status:204,headers:{...cors,'access-control-allow-origin':request.headers.get('origin')??'null','access-control-allow-methods':'POST','access-control-allow-headers':'content-type','access-control-max-age':'600'}});
  const value=await site(env,String(id));known=value;
  const origin=siteOrigin(value,request);cors={...cors,'access-control-allow-origin':origin};
  // The script's configuration door serves only what the script uses (PRIVACY-003: whether this visitor's region
  // requires consent, never the region itself, and the consent manager to read); the owner's excluded addresses and countries
  // (COLLECT-003), goals, funnels and other settings stay in the installation.
  if(match) { insist(request.method==='GET','method','GET required.',405); const c=value.config,pages=origin===value.origin?await heatPaths(env,value.id):[]; return Response.json({consent:consentRequired(c,request)?'required':'not-required',...(c.consentAdapter?{consentAdapter:c.consentAdapter}:{}),sampleRate:c.sampleRate,...(c.consentedVisitors?{consentedVisitors:true,consentLifetimeMonths:c.consentLifetimeMonths??13}:{}),...(c.declinedCounter?{declinedCounter:true}:{}),autoEvents:c.autoEvents??[],queryKeys:c.queryKeys??[],...(c.searchParam?{searchParam:c.searchParam}:{}),...(c.incumbentCompatibility?{incumbentCompatibility:true,currency:c.currency??'USD'}:{}),eventDefinitions:c.eventDefinitions??[],...(pages.length?{heatPaths:pages,heatCaptureOrigin:env.AUTH_ORIGIN}:{})},{headers:cors}); }
  if(heat) {await collectHeat(request,env,value,payload);return Response.json({accepted:true},{status:202,headers:cors});}
  if(engage) {
   // METRIC-003: a ping names only the site and its own page load, at least 10 seconds and at most
   // 30 minutes after that load; the latest ping marks the page engaged and ends its time.
   // METRIC-006: it carries the deepest scroll reached, and scroll-depth goals count against it.
   insist(Object.keys(payload??{}).every(key=>['id','siteId','scroll'].includes(key))&&/^[a-f0-9-]{36}$/.test(payload.id),'fields','An engagement ping carries only the site and page-load IDs and the scroll depth.');
   insist(Number.isInteger(payload.scroll)&&payload.scroll>=0&&payload.scroll<=100,'scroll','Scroll depth is a whole percentage from 0 to 100.');
   const at=clock(),eventId=value.id+':'+payload.id,point=rawEventPredicate(eventId),load=await rawEvent<{kind:string;at:number|null,path:string,hostname:string|null;consented_visitor:string|null;consented_created_at:number|null;consented_expires_at:number|null}>(env,eventId,'kind,at,path,hostname,consented_visitor,consented_created_at,consented_expires_at');
   insist(load?.kind==='pageview'&&typeof load.at==='number','page_load','No timed page load has this ID.',404);
   consentedPage(value.config,request,load,at);
   insist(at-load.at>=ENGAGED_AFTER_MS,'engagement','Engagement counts after 10 seconds on the page.',409);
   insist(at-load.at<=ENGAGEMENT_WINDOW_MS,'expired','Engagement more than 30 minutes after its page load is not counted.',409);
   const recovered=Object.entries(value.config.customGoals??{}).filter(([,g])=>g.depth!==undefined),pageProps=recovered.some(([,g])=>g.props)?(await env.DB.prepare('SELECT key,value FROM vane_event_props WHERE event_id=?').bind(eventId).all<{key:string,value:string}>()).results.map(p=>[p.key,p.value] as [string,string]):[];
   const goals=[...Object.entries(value.config.scrollGoals??{}),...recovered.filter(([,g])=>propertiesMatch(g.props,pageProps)).map(([name,g])=>[name,{path:g.path!,depth:g.depth!}] as [string,{path:string;depth:number}])].filter(([,goal])=>goalApplies(goal.path,load.hostname,load.path));
   await env.DB.batch([statement(env,`UPDATE vane_events SET engaged_at=MAX(COALESCE(engaged_at,0),?),scroll=MAX(COALESCE(scroll,0),?) WHERE ${point.sql}`,at,payload.scroll,...point.values),...goals.map(([name,goal])=>statement(env,`INSERT OR IGNORE INTO vane_events(id,site_id,day,kind,path,source,campaign,consent,sample_rate,visitor,at,hostname,consented_visitor,consented_created_at,consented_expires_at) SELECT id||?,site_id,day,?,path,source,campaign,consent,sample_rate,visitor,at,hostname,consented_visitor,consented_created_at,consented_expires_at FROM vane_events WHERE ${point.sql} AND scroll>=?`,':'+name,name,...point.values,goal.depth))]);
   return Response.json({accepted:true},{status:202,headers:cors});
  }
  const plan=await validatePageview(request,value,origin,payload,clock());
  const [result]=await admitPageviews(request,env,[plan]);
  const {status,...answer}=result!;
  return Response.json(answer,{status,headers:cors});
 } catch(error) {
  const e=error instanceof VaneError?error:new VaneError('collection_failed','Event could not be committed.',500);
  // ALERT-002, COVERAGE-001: a page load of a known site refused as malformed, from an origin the site does not register,
  // or conflicting with an admitted page load is counted as a collection error (site, day, fixed reason class, count).
  if(known&&!match&&!engage&&!heat)await countCollectionRefusal(env,known,e);
  return Response.json({error:e.code,message:e.message},{status:e.status,headers:cors});
 }
}

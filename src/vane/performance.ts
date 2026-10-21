import { consentedPage } from './consented'
import { insist, rows, site, siteOrigin, statement, VaneError, type Env } from './core'
import { clock } from './clock'
import { ENGAGEMENT_WINDOW_MS } from './visits'
// PERF-001: the script reports a page load's largest contentful paint (LCP), interaction to next paint (INP) and load
// time in milliseconds and its cumulative layout shift (CLS) when the page is hidden, naming only the site and its own
// page load, within 30 minutes of the load. The latest report of each figure is kept on the page load. Reports show,
// per page and per device class, the page loads measured and each figure's 75th percentile (nearest rank: the value
// at rank ⌈0.75·n⌉ of the page loads that reported it).
export const PERF_FIELDS={lcp:120000,inp:60000,cls:100,load:120000} as const
export async function perfResponse(request:Request,env:Env):Promise<Response|null> {
 if(new URL(request.url).pathname!=='/api/vane/perf')return null;
 let cors:Record<string,string>={'vary':'Origin','cache-control':'no-store'};
 if(request.method==='OPTIONS')return new Response(null,{status:204,headers:{...cors,'access-control-allow-origin':request.headers.get('origin')??'null','access-control-allow-methods':'POST','access-control-allow-headers':'content-type','access-control-max-age':'600'}});
 try {
  insist(request.method==='POST','method','POST required.',405);
  const text=await request.text();insist(text.length<=512,'body','Report too large.',413);
  const p=JSON.parse(text),value=await site(env,String(p?.siteId));cors={...cors,'access-control-allow-origin':siteOrigin(value,request)};
  const figures=Object.keys(p).filter(k=>Object.hasOwn(PERF_FIELDS,k)) as (keyof typeof PERF_FIELDS)[];
  insist(Object.keys(p).every(k=>['siteId','id',...Object.keys(PERF_FIELDS)].includes(k))&&/^[a-f0-9-]{36}$/.test(p.id)&&figures.length>0,'fields','A performance report carries only the site and page-load IDs and the measured figures.');
  insist(figures.every(k=>typeof p[k]==='number'&&Number.isFinite(p[k])&&p[k]>=0&&p[k]<=PERF_FIELDS[k]&&(k==='cls'||Number.isInteger(p[k]))),'figures','LCP, INP and load time are whole milliseconds and CLS a score from 0 to 100.');
  const eventId=value.id+':'+p.id,load=await env.DB.prepare("SELECT at,consented_visitor,consented_created_at,consented_expires_at FROM vane_events WHERE id=? AND kind='pageview'").bind(eventId).first<{at:number|null;consented_visitor:string|null;consented_created_at:number|null;consented_expires_at:number|null}>();
  insist(typeof load?.at==='number','page_load','No timed page load has this ID.',404);consentedPage(value.config,request,load,clock());insist(clock()-load.at<=ENGAGEMENT_WINDOW_MS,'expired','Performance more than 30 minutes after its page load is not counted.',409);
  await statement(env,'UPDATE vane_events SET lcp=COALESCE(?,lcp),inp=COALESCE(?,inp),cls=COALESCE(?,cls),load_ms=COALESCE(?,load_ms) WHERE id=?',p.lcp??null,p.inp??null,p.cls===undefined?null:Math.round(p.cls*1000)/1000,p.load??null,eventId).run();
  return Response.json({accepted:true},{status:202,headers:cors});
 } catch(error) { const e=error instanceof VaneError?error:new VaneError('invalid_report','Performance could not be accepted.');return Response.json({error:e.code,message:e.message},{status:e.status,headers:cors}) }
}
const p75=(xs:number[])=>{if(!xs.length)return null;const s=[...xs].sort((a,b)=>a-b);return s[Math.ceil(0.75*s.length)-1]!}
export interface PerfRow { label:string; measured:number; lcp:number|null; inp:number|null; cls:number|null; load:number|null; previous?:number }
function summarise(list:any[],key:string):PerfRow[] {
 const by=new Map<string,any[]>();for(const r of list)(by.get(r[key])??by.set(r[key],[]).get(r[key])!).push(r)
 const of=(rs:any[],f:string)=>rs.map(r=>r[f]).filter((v:any)=>v!==null&&v!==undefined).map(Number)
 return [...by.entries()].map(([label,rs])=>({label,measured:rs.length,lcp:p75(of(rs,'lcp')),inp:p75(of(rs,'inp')),cls:p75(of(rs,'cls')),load:p75(of(rs,'load_ms'))})).sort((a,b)=>b.measured-a.measured||a.label.localeCompare(b.label))
}
export async function perfReport(env:Env,scope:string,from:string,to:string,events:string,hosts:boolean) {
 const list=await rows(env,`SELECT ${hosts?"COALESCE(hostname,'')||path":'path'} AS page,COALESCE(device,'unknown') AS device,lcp,inp,cls,load_ms FROM ${events} WHERE site_id IN (SELECT value FROM json_each(?)) AND day>=? AND day<? AND kind='pageview' AND (lcp IS NOT NULL OR inp IS NOT NULL OR cls IS NOT NULL OR load_ms IS NOT NULL)`,scope,from,to)
 return {pages:summarise(list,'page'),devices:summarise(list,'device')}
}

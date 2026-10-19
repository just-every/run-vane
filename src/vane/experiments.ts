import { insist, site, siteOrigin, statement, VaneError, type Env } from './core'
import { consentAccepted } from './consent'
import { clock } from './clock'
import { excludedTraffic } from './traffic'
import { goalApplies } from './goals'
// EXPERIMENT-001: split tests of 2 to 4 variants on a page, defined in the site settings (APPROVE-001) as
// pricing = /pricing > signup : control, cheaper (a page path or pattern with the goals' wildcards, an existing goal,
// then the variants, the first being the control); at most 10. In the cookie-free mode a visitor's variant is
// SHA-256(daily visitor hash + ":" + experiment name), its first four bytes modulo the number of variants, so it is
// stable within the visitor's day and equal across variants in expectation; nothing new is stored for it.
export interface Experiment { name:string; page:string; goal:string; variants:string[] }
const LINE=/^([a-z][a-z0-9-]{0,39})\s*=\s*(\S+)\s*>\s*([a-z][a-z0-9-]{0,39})\s*:\s*(.+)$/
export function cleanExperiments(input:unknown,goals:string[]):Experiment[] {
 const list=Array.isArray(input)?input.map((x:any)=>({name:String(x?.name??''),page:String(x?.page??''),goal:String(x?.goal??''),variants:Array.isArray(x?.variants)?x.variants.map(String):[]})):String(input??'').split('\n').map(l=>l.trim()).filter(Boolean).map(line=>{const m=line.match(LINE);return m?{name:m[1]!,page:m[2]!,goal:m[3]!,variants:m[4]!.split(',').map(v=>v.trim())}:{name:'',page:'',goal:'',variants:[]}})
 insist(list.length<=10&&new Set(list.map(x=>x.name)).size===list.length&&list.every(x=>/^[a-z][a-z0-9-]{0,39}$/.test(x.name)&&/^\/[a-z0-9_\-/*.:]{0,119}$/.test(x.page)&&goals.includes(x.goal)&&x.variants.length>=2&&x.variants.length<=4&&new Set(x.variants).size===x.variants.length&&x.variants.every((v:string)=>/^[a-z0-9][a-z0-9-]{0,29}$/.test(v))),'experiments','Write each split test as pricing = /pricing > signup : control, cheaper: a page path or pattern, one of the site’s goals, then 2 to 4 variant names (the first is the control); at most 10.')
 return list
}
export async function variantOf(visitor:string,experiment:Experiment):Promise<string> {
 const bytes=new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(visitor+':'+experiment.name)))
 return experiment.variants[new DataView(bytes.buffer).getUint32(0)%experiment.variants.length]!
}
// The assignments returned with an accepted page load, for the experiments running on its page.
export async function assignments(experiments:Experiment[]=[],visitor:string,hostname:string|null,path:string):Promise<Record<string,string>|null> {
 const running=experiments.filter(x=>goalApplies(x.page,hostname,path));
 return running.length?Object.fromEntries(await Promise.all(running.map(async x=>[x.name,await variantOf(visitor,x)]))):null
}
// The exposure door: the script reports that it applied the page load's variant. The variant is recomputed from the
// page load's own visitor hash, never taken from the request, and each page load is exposed once per experiment.
export async function exposureResponse(request:Request,env:Env):Promise<Response|null> {
 if(new URL(request.url).pathname!=='/api/vane/exposure')return null;
 let cors:Record<string,string>={'vary':'Origin','cache-control':'no-store'};
 if(request.method==='OPTIONS')return new Response(null,{status:204,headers:{...cors,'access-control-allow-origin':request.headers.get('origin')??'null','access-control-allow-methods':'POST','access-control-allow-headers':'content-type','access-control-max-age':'600'}});
 try {
  insist(request.method==='POST','method','POST required.',405);
  const text=await request.text();insist(text.length<=1024,'body','Exposure too large.',413);
  const payload=JSON.parse(text),value=await site(env,String(payload?.siteId));
  cors={...cors,'access-control-allow-origin':siteOrigin(value,request)};
  insist(Object.keys(payload).every(key=>['page','siteId','experiment','consent'].includes(key))&&/^[a-f0-9-]{36}$/.test(payload.page),'fields','Only the declared exposure fields are accepted.');
  insist(consentAccepted(value.config,request,payload.consent),'consent','Consent is required for collection.',403);
  const excluded=excludedTraffic(request,value.config,null);insist(!excluded,'excluded',`This traffic is excluded from collection (${excluded}).`,403);
  const experiment=(value.config.experiments??[]).find(x=>x.name===payload.experiment);insist(experiment,'experiment','This site runs no such experiment.',404);
  const pageId=value.id+':'+payload.page,load=await env.DB.prepare("SELECT day,visitor,path,hostname FROM vane_events WHERE id=? AND kind='pageview' AND site_id=?").bind(pageId,value.id).first<any>();
  insist(load&&load.visitor&&goalApplies(experiment!.page,load.hostname,load.path),'page_load','No page load of this experiment’s page has this ID.',404);
  const variant=await variantOf(load.visitor,experiment!);
  await env.DB.batch([statement(env,'INSERT OR IGNORE INTO vane_exposures(page_id,site_id,day,experiment,variant,at) VALUES(?,?,?,?,?,?)',pageId,value.id,load.day,experiment!.name,variant,clock())]);
  return Response.json({accepted:true,variant},{status:202,headers:cors});
 } catch(error) { const e=error instanceof VaneError?error:new VaneError('invalid_exposure','Exposure could not be accepted.'); return Response.json({error:e.code,message:e.message},{status:e.status,headers:cors}); }
}

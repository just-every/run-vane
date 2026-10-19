import { insist, site, siteOrigin, statement, VaneError, type Env } from './core'
import { localDay } from './visitors'
import { clock } from './clock'
// COVERAGE-001: page loads that reached Vane but were not collected are counted by reason, with no field
// about the page load. consent-declined: when a site requires consent, the owner may turn on a counter, and
// the script then sends one empty request for a page load whose visitor has not granted consent.
// excluded-path: collection counts each page load it refuses because the site excludes that path.
export const countExclusion=(env:Env,siteId:string,day:string,reason:'consent-declined'|'excluded-path')=>statement(env,'INSERT INTO vane_exclusions(site_id,day,reason,count) VALUES(?,?,?,1) ON CONFLICT(site_id,day,reason) DO UPDATE SET count=count+1 WHERE count<100000',siteId,day,reason)
export async function declinedResponse(request:Request,env:Env):Promise<Response|null> {
 const match=new URL(request.url).pathname.match(/^\/api\/vane\/declined\/([\w-]+)$/);
 if(!match)return null;
 let cors:Record<string,string>={'vary':'Origin','cache-control':'no-store'};
 try {
  insist(request.method==='POST','method','POST required.',405);
  const value=await site(env,match[1]!);
  cors={...cors,'access-control-allow-origin':siteOrigin(value,request)};
  insist(value.config.consent==='required'&&value.config.declinedCounter===true,'declined_counter_off','This site does not count declined consent.',403);
  insist((await request.text())==='','fields','The declined-consent count carries no fields.');
  await countExclusion(env,value.id,localDay(clock(),value.config.timeZone??'UTC'),'consent-declined').run();
  return Response.json({counted:true},{status:202,headers:cors});
 } catch(error) { const e=error instanceof VaneError?error:new VaneError('invalid_count','The count could not be recorded.'); return Response.json({error:e.code,message:e.message},{status:e.status,headers:cors}); }
}

import { role, site, insist, type Actor, type Env } from '../core'
import { publicHttps } from '../warehouse'
import { localDate } from '../annotations'

export const MATOMO_METHODS=['VisitsSummary.get','Actions.get','Actions.getPageUrls','Referrers.getWebsites','Referrers.getCampaigns','UserCountry.getCountry','UserCountry.getRegion','UserCountry.getCity','DevicesDetection.getType','DevicesDetection.getBrowsers','DevicesDetection.getOsFamilies','Goals.get','Goals.getItemsSku'] as const
// IMPORT-005: credentials live only for this request; only aggregate reports are requested.
export async function readMatomo(env:Env,actor:Actor,p:any) {
 role(actor);await site(env,String(p.siteId??''));const url=publicHttps(String(p.endpoint??''),true)
 insist(!url.search,'endpoint','Use the Matomo index.php address without query parameters.')
 const currency=String(p.currency??'').toUpperCase();insist(Intl.supportedValuesOf('currency').includes(currency),'currency','Confirm the Matomo site’s ISO currency.');
 const sourceSite=String(p.sourceSite??''),token=String(p.token??''),day=localDate(p.day)
 insist(/^\d{1,10}$/.test(sourceSite),'source_site','Enter Matomo’s numeric site ID.')
 insist(token.length>=16&&token.length<=256&&!/\s/.test(token),'token','Enter a Matomo Reporting API token; it is used once and never saved.')
 const methods=[...MATOMO_METHODS,'Goals.getGoals'],body=new URLSearchParams({module:'API',method:'API.getBulkRequest',format:'JSON',token_auth:token})
 methods.forEach((method,i)=>body.set(`urls[${i}]`,new URLSearchParams({method,idSite:sourceSite,period:'day',date:day,format:'JSON',filter_limit:'-1',flat:'1',format_metrics:'0',showAllGoalSpecificMetrics:'1'}).toString()))
 let response:Response
 try{response=await fetch(url,{method:'POST',redirect:'manual',headers:{'content-type':'application/x-www-form-urlencoded'},body,signal:AbortSignal.timeout(20000)})}catch{throw new Error('Matomo could not be reached. No credentials or source response were saved.')}
 insist(response.ok,'matomo','Matomo refused the report request. Check the address, site ID and token.',502)
 // Bound the response while reading it, before parsing or custody.
 const reader=response.body?.getReader(),chunks:Uint8Array[]=[];let length=0
 if(reader)while(true){const r=await reader.read();if(r.done)break;length+=r.value.length;if(length>2_000_000){await reader.cancel();insist(false,'matomo_size','Choose a smaller source report; this request accepts at most 2 MB.',413)}chunks.push(r.value)}
 const bytes=new Uint8Array(length);let offset=0;for(const c of chunks){bytes.set(c,offset);offset+=c.length}
 let results:any;try{results=JSON.parse(new TextDecoder().decode(bytes))}catch{insist(false,'matomo','Matomo did not return JSON reports.',502)}
 insist(Array.isArray(results)&&results.length===methods.length&&!results.some(r=>r?.result==='error'),'matomo','Matomo refused one or more reports. Nothing was imported.',502)
 return {format:'vane-matomo-reports/1',day,currency,reports:Object.fromEntries(MATOMO_METHODS.map((m,i)=>[m,results[i]])),goals:results[results.length-1]}
}

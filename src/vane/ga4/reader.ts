import { inScope, insist, role, site, type Actor, type Env } from '../core'
import { localDate } from '../annotations'
import { connection, current } from './storage'
import { accessToken, ADMIN_ENDPOINT, DATA_ENDPOINT, googleFetch } from './google'
const GROUPS=[[],['pagePath'],['landingPage'],['sessionDefaultChannelGroup'],['sessionSource','sessionMedium'],['sessionCampaignName'],['country'],['region'],['city'],['deviceCategory'],['browser'],['operatingSystem'],['eventName']]
const MEASURES=['totalUsers','sessions','screenPageViews','engagedSessions','bounceRate','engagementRate','userEngagementDuration','keyEvents','purchaseRevenue']
export async function readHistory(env:Env,actor:Actor,p:any) {
 role(actor);inScope(actor,p.siteId);await site(env,p.siteId);
 const c=await connection(env,p.siteId);insist(c?.property,'ga4_connection','Connect GA4 and choose a property first.');
 const from=localDate(p.from),to=localDate(p.to);insist(from<=to,'range','Choose an inclusive date range.');
 const reports:any[]=[],keyEvents:any[]=[];let size=0;
 const read=async(url:string,body?:any)=>{
  await current(env,c);const token=await accessToken(env,c);
  const response=await googleFetch(url,{method:body?'POST':'GET',headers:{authorization:'Bearer '+token,'content-type':'application/json'},...(body?{body:JSON.stringify(body)}:{})},'GA4 aggregate read');
  const text=await response.text();size+=new TextEncoder().encode(text).length;insist(size<=8_000_000,'ga4_size','Choose a smaller date range; source reports exceed 8 MB.',413);
  await current(env,c);return JSON.parse(text);
 };
 for(const group of GROUPS){
  let offset=0,combined:any;
  do {
   const page=await read(DATA_ENDPOINT+'/'+c.property+':runReport',{dateRanges:[{startDate:from,endDate:to}],dimensions:['date',...group].map(name=>({name})),metrics:MEASURES.map(name=>({name})),orderBys:['date',...group].map(dimensionName=>({dimension:{dimensionName}})),offset:String(offset),limit:'500',keepEmptyRows:false});
   insist(JSON.stringify(page.dimensionHeaders?.map((h:any)=>h.name))===JSON.stringify(['date',...group])&&JSON.stringify(page.metricHeaders?.map((h:any)=>h.name))===JSON.stringify(MEASURES),'ga4_schema','Google returned different source dimensions or metrics.',502);
   insist(Number.isSafeInteger(page.rowCount)&&page.rowCount>=0&&Array.isArray(page.rows??[]),'ga4_pagination','Google returned an incomplete report.',502);
   if(!combined)combined={...page,rows:[]};
   insist(page.rowCount===combined.rowCount&&JSON.stringify(page.dimensionHeaders)===JSON.stringify(combined.dimensionHeaders)&&JSON.stringify(page.metricHeaders)===JSON.stringify(combined.metricHeaders)&&JSON.stringify(page.metadata)===JSON.stringify(combined.metadata),'ga4_changed','Google changed the report while paging. Preview again.',409);
   const rows=page.rows??[];insist(rows.length<=500&&(rows.length>0||offset===page.rowCount),'ga4_pagination','Google omitted a report page.',502);
   combined.rows.push(...rows);offset+=rows.length;
   insist(offset<=page.rowCount,'ga4_pagination','Google returned excess report rows.',502);
  }while(offset<combined.rowCount);
  reports.push(combined);
 }
 let token='';const seen=new Set<string>();
 do {
  const url=new URL(ADMIN_ENDPOINT+'/'+c.property+'/keyEvents');url.searchParams.set('pageSize','200');if(token)url.searchParams.set('pageToken',token);
  const result=await read(url.href);insist(Array.isArray(result.keyEvents??[]),'ga4_events','Google returned invalid key events.',502);keyEvents.push(...(result.keyEvents??[]));
  token=result.nextPageToken??'';insist(typeof token==='string'&&!seen.has(token),'ga4_pagination','Google repeated a key-event page.',502);if(token)seen.add(token);
 }while(token);
 await current(env,c);
 return {format:'vane-ga4-history/1',property:c.property,from,to,reports,keyEvents};
}

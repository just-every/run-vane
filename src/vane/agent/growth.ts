import { report as searchReport } from '../search-console/report'
import { agentHistoryStamp } from '../agent-fence'
import { atomic, day, uid, insist, rows, statement, type Actor, type Env } from '../core'
import { clock } from '../clock'
import { auditStatement } from '../audit'
import { localDate } from '../annotations'
import { localDay } from '../visitors'
import { createInsightsService } from '../reports'
import { agentSite, draftChange, saveWork } from './drafts'
export const OPPORTUNITIES=['entry-exit','campaign','slow-page','funnel','search'] as const
export async function dismissOpportunity(env:Env,actor:Actor,p:any){const value=await agentSite(env,actor,String(p.siteId??''));insist(OPPORTUNITIES.includes(p.type),'type','Choose an existing opportunity type.');await atomic(env,actor,[statement(env,'INSERT OR IGNORE INTO vane_agent_dismissals(site_id,type,actor,at) VALUES(?,?,?,?)',value.id,p.type,actor.id,clock()),auditStatement(env,actor.id,'agent.dismiss',value.id,p.type)]);return {dismissed:p.type}}
export async function growthBrief(env:Env,actor:Actor,p:any){
 const value=await agentSite(env,actor,String(p.siteId??'')),to=localDate(p.to??localDay(clock(),value.config.timeZone??'UTC')),from=day(Date.parse(to)-7*86400000)
 insist(to<=localDay(clock(),value.config.timeZone??'UTC'),'range','Use an ended local week.')
 const fence={value,stamp:await agentHistoryStamp(env,value.id)}
 const dismissed=new Set((await rows<{type:string}>(env,'SELECT type FROM vane_agent_dismissals WHERE site_id=?',value.id)).map(r=>r.type))
 const saved=(await rows<any>(env,"SELECT * FROM vane_agent_work WHERE site_id=? AND kind='brief' AND from_day=? AND to_day=? ORDER BY at,id LIMIT 1",value.id,from,to))[0]
 const prior=saved?{...saved,...JSON.parse(saved.payload_json)}:undefined
 if(prior)return {...prior,opportunities:prior.opportunities.filter((o:any)=>!dismissed.has(o.type))}
 const r=await createInsightsService(env,value,clock(),{from,to,imported:'off'}).list(),candidates:{type:string;title:string;figures:Record<string,number>;evidence:string}[]=[]
 const channels=(r as typeof r & {channels:{visits:number;conversions:number}[]}).channels??[],siteConversions=channels.reduce((n,c)=>n+c.conversions,0),siteRate=r.visits?Math.round(siteConversions/r.visits*1000)/10:0
 const evidence=`/app/sites/${value.id}?${new URLSearchParams({from,to,imported:'off'})}`
 for(const entry of r.entryPages){const exit=r.exitPages.find(e=>e.path===entry.path);if(entry.visits>=5&&exit&&exit.visits/entry.visits>=.5)candidates.push({type:'entry-exit',title:`Review the next step on ${entry.path}`,figures:{entries:entry.visits,exits:exit.visits},evidence:evidence+'#pages'})}
 for(const c of (r as typeof r & {utmCampaigns:any[]}).utmCampaigns??[])if(c.visits>=5&&c.conversionRate!==null&&r.conversionRate!==null&&c.conversionRate>siteRate)candidates.push({type:'campaign',title:`Review the ${c.label} campaign`,figures:{visits:c.visits,conversions:c.conversions,rate:c.conversionRate,siteRate},evidence:evidence+'#sources'})
 for(const page of r.perf.pages){
  const native=r.topPages.find(p=>p.path===page.label),peers=r.topPages.filter(p=>p.path!==page.label&&p.visits>=5&&r.perf.pages.some(m=>m.label===p.path&&m.measured>=5&&m.lcp!==null&&m.lcp<=2500)),peerVisits=peers.reduce((n,p)=>n+p.visits,0),peerConversions=peers.reduce((n,p)=>n+p.conversions,0),peerRate=peerVisits?Math.round(peerConversions/peerVisits*1000)/10:null;
  if(page.measured>=5&&page.lcp!==null&&page.lcp>2500&&native&&native.visits>=5&&native.conversionRate!==null&&peerRate!==null&&native.conversionRate<peerRate)candidates.push({type:'slow-page',title:`Investigate loading on ${page.label}`,figures:{measured:page.measured,lcpMilliseconds:page.lcp,visits:native.visits,conversions:native.conversions,rate:native.conversionRate,peerVisits,peerConversions,peerRate},evidence:evidence+'#performance'})
 }
 const search=await searchReport(env,actor,value.id,from,to);
 for(const query of search.queries)if(query.position>=4&&query.position<=20&&query.impressions>=100)candidates.push({type:'search',title:`Review search visibility for ${query.query}`,figures:{clicks:query.clicks,impressions:query.impressions,position:query.position,ctr:query.ctr},evidence:evidence+'&'+new URLSearchParams({searchQuery:query.query,searchProvider:'google'})})
 for(const f of r.funnels)for(let i=1;i<f.steps.length;i++){const before=f.steps[i-1]!,step=f.steps[i]!;if(before.visits>=5&&step.visits<before.visits/2)candidates.push({type:'funnel',title:`Review ${f.name}: ${step.label}`,figures:{entered:before.visits,reached:step.visits},evidence:evidence+'#funnels'})}
 const opportunities=[]
 // Prefer one supported candidate per type before filling remaining places.
 const eligible=candidates.filter(c=>!dismissed.has(c.type)),first=[...new Map(eligible.map(c=>[c.type,eligible.find(v=>v.type===c.type)!])).values()],selected=[...first,...eligible.filter(c=>!first.includes(c))].slice(0,5)
 for(const c of selected){
  const draft=await draftChange(env,actor,{siteId:value.id,from,to,title:c.title,target:'github',effect:'Test whether the proposed page change improves native goal conversion.',guardrail:'Keep consent coverage and page performance stable.',measurement:'Use an experiment with an interval; otherwise compare matched weekdays and report coverage uncertainty.'},fence)
  opportunities.push({...c,draftId:draft.id,draft:`/api/vane/agent/work?${new URLSearchParams({siteId:value.id,id:draft.id})}`})
 }
 return saveWork(env,actor,{siteId:value.id,kind:'brief',from,to,payload:{from,to,opportunities,coverage:'Native observed activity and finalized source-limited Search Console aggregates only. Blockers and total audience coverage are unknown; opportunities are hypotheses, not predicted lift.',shortfall:opportunities.length<3?'Fewer than three supported opportunities; missing evidence is not invented.':null}},uid(),fence)
}

// Existing five-minute cron produces the latest ended Monday-to-Monday local week.
// The owner remains the actor; this creates local drafts only and sends nothing.
export async function runGrowthBriefs(env:Env,now:number){
 const owners=await rows<{id:string}>(env,"SELECT id FROM oa_operators WHERE role='owner' AND status='active' ORDER BY id LIMIT 1");if(!owners[0])return;
 const values=await rows<{id:string;config_json:string}>(env,'SELECT id,config_json FROM vane_sites ORDER BY id');
 for(const value of values){const today=localDay(now,JSON.parse(value.config_json).timeZone??'UTC'),weekday=new Date(today+'T00:00:00Z').getUTCDay(),to=day(Date.parse(today)-((weekday+6)%7)*86400000);await growthBrief(env,{id:owners[0].id,role:'owner'},{siteId:value.id,to});}
}

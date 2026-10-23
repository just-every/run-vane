import { agentHistoryStamp } from '../agent-fence'
import { atomic, day, uid, insist, rows, statement, type Actor, type Env } from '../core'
import { clock } from '../clock'
import { auditStatement } from '../audit'
import { localDate } from '../annotations'
import { localDay } from '../visitors'
import { createInsightsService } from '../reports'
import { agentSite, draftChange, saveWork, work } from './drafts'
export const OPPORTUNITIES=['entry-exit','campaign','slow-page','funnel'] as const
export async function dismissOpportunity(env:Env,actor:Actor,p:any){const value=await agentSite(env,actor,String(p.siteId??''));insist(OPPORTUNITIES.includes(p.type),'type','Choose an existing opportunity type.');await atomic(env,actor,[statement(env,'INSERT OR IGNORE INTO vane_agent_dismissals(site_id,type,actor,at) VALUES(?,?,?,?)',value.id,p.type,actor.id,clock()),auditStatement(env,actor.id,'agent.dismiss',value.id,p.type)]);return {dismissed:p.type}}
export async function growthBrief(env:Env,actor:Actor,p:any){
 const value=await agentSite(env,actor,String(p.siteId??'')),to=localDate(p.to??localDay(clock(),value.config.timeZone??'UTC')),from=day(Date.parse(to)-7*86400000)
 insist(to<=localDay(clock(),value.config.timeZone??'UTC'),'range','Use an ended local week.')
 const fence={value,stamp:await agentHistoryStamp(env,value.id)}
 const dismissed=new Set((await rows<{type:string}>(env,'SELECT type FROM vane_agent_dismissals WHERE site_id=?',value.id)).map(r=>r.type))
 const prior=(await work(env,actor,value.id)).find(r=>r.kind==='brief'&&r.from_day===from&&r.to_day===to)
 if(prior)return {...prior,opportunities:prior.opportunities.filter((o:any)=>!dismissed.has(o.type))}
 const r=await createInsightsService(env,value,clock(),{from,to,imported:'off'}).list(),candidates:{type:string;title:string;figures:Record<string,number>;evidence:string}[]=[]
 const channels=(r as typeof r & {channels:{visits:number;conversions:number}[]}).channels??[],siteConversions=channels.reduce((n,c)=>n+c.conversions,0),siteRate=r.visits?Math.round(siteConversions/r.visits*1000)/10:0
 const evidence=`/app/sites/${value.id}?${new URLSearchParams({from,to,imported:'off'})}`
 for(const entry of r.entryPages){const exit=r.exitPages.find(e=>e.path===entry.path);if(entry.visits>=5&&exit&&exit.visits/entry.visits>=.5)candidates.push({type:'entry-exit',title:`Review the next step on ${entry.path}`,figures:{entries:entry.visits,exits:exit.visits},evidence:evidence+'#pages'})}
 for(const c of (r as typeof r & {utmCampaigns:any[]}).utmCampaigns??[])if(c.visits>=5&&c.conversionRate!==null&&r.conversionRate!==null&&c.conversionRate>siteRate)candidates.push({type:'campaign',title:`Review the ${c.label} campaign`,figures:{visits:c.visits,conversions:c.conversions,rate:c.conversionRate,siteRate},evidence:evidence+'#sources'})
 for(const page of r.perf.pages)if(page.measured>=5&&page.lcp!==null&&page.lcp>2500)candidates.push({type:'slow-page',title:`Investigate loading on ${page.label}`,figures:{measured:page.measured,lcpMilliseconds:page.lcp},evidence:evidence+'#performance'})
 for(const f of r.funnels)for(let i=1;i<f.steps.length;i++){const before=f.steps[i-1]!,step=f.steps[i]!;if(before.visits>=5&&step.visits<before.visits/2)candidates.push({type:'funnel',title:`Review ${f.name}: ${step.label}`,figures:{entered:before.visits,reached:step.visits},evidence:evidence+'#funnels'})}
 const opportunities=[]
 for(const c of candidates.filter(c=>!dismissed.has(c.type)).slice(0,5)){
  const draft=await draftChange(env,actor,{siteId:value.id,from,to,title:c.title,target:'github',effect:'Test whether the proposed page change improves native goal conversion.',guardrail:'Keep consent coverage and page performance stable.',measurement:'Use an experiment with an interval; otherwise compare matched weekdays and report coverage uncertainty.'},fence)
  opportunities.push({...c,draftId:draft.id,draft:`/api/vane/agent/work?${new URLSearchParams({siteId:value.id,id:draft.id})}`})
 }
 return saveWork(env,actor,{siteId:value.id,kind:'brief',from,to,payload:{from,to,opportunities,coverage:'Native observed activity only. Blockers and total audience coverage are unknown; opportunities are hypotheses, not predicted lift.',shortfall:opportunities.length<3?'Fewer than three supported opportunities; missing evidence is not invented.':null}},uid(),fence)
}

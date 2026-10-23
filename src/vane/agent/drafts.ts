import { allow, atomic, inScope, insist, rows, site, statement, uid, type Actor, type Env, type Site } from '../core'
import { auditStatement } from '../audit'
import { clock } from '../clock'
import { plainText, localDate } from '../annotations'
import { agentCommitGuard, agentHistoryStamp } from '../agent-fence'
export async function agentSite(env:Env,actor:Actor,id:string){allow(actor,'owner');inScope(actor,id);return site(env,id)}
export async function work(env:Env,actor:Actor,siteId:string,id?:string){await agentSite(env,actor,siteId);return (await rows<any>(env,'SELECT * FROM vane_agent_work WHERE site_id=? AND (? IS NULL OR id=?) ORDER BY at DESC,id LIMIT 100',siteId,id??null,id??null)).map(({payload_json,...r})=>({...r,...JSON.parse(payload_json)}))}
export async function saveWork(env:Env,actor:Actor,p:{siteId:string;kind:string;from:string;to:string;payload:any},id=uid(),fence?:{value:Site;stamp:number}) {
 const value=fence?.value??await agentSite(env,actor,p.siteId),stamp=fence?.stamp??await agentHistoryStamp(env,value.id)
 await atomic(env,actor,[agentCommitGuard(env,value,stamp),statement(env,'INSERT INTO vane_agent_work(id,site_id,kind,from_day,to_day,payload_json,created_by,at) VALUES(?,?,?,?,?,?,?,?)',id,p.siteId,p.kind,p.from,p.to,JSON.stringify(p.payload),actor.id,clock()),auditStatement(env,actor.id,'agent.'+p.kind,p.siteId,id)])
 return {id,siteId:p.siteId,...p.payload}
}
export async function draftChange(env:Env,actor:Actor,p:any,fence?:{value:Site;stamp:number}) {
 await agentSite(env,actor,String(p.siteId??''))
 insist(Object.keys(p).every(k=>['siteId','from','to','title','effect','guardrail','measurement','target'].includes(k)),'fields','Choose only the declared draft fields.')
 const from=localDate(p.from),to=localDate(p.to);insist(from<to,'range','The end follows the start.')
 const text=(v:unknown)=>plainText(v,280,'draft','Use a plain-text draft field of at most 280 characters.')
 const target=String(p.target??'github');insist(['github','pane','webflow','mango','ads'].includes(target),'target','Choose a declared change destination.')
 return saveWork(env,actor,{siteId:String(p.siteId),kind:'draft',from,to,payload:{title:text(p.title),effect:text(p.effect),guardrail:text(p.guardrail),measurement:text(p.measurement),target,state:'draft-only',authority:'No outbound grant. Review this draft with the owner; publishing is unavailable.'}},uid(),fence)
}
// Source authority approved for instrumentation is deliberately not widened to arbitrary copy or budget writes.
export async function refuseShipping(env:Env,actor:Actor,p:any){await agentSite(env,actor,String(p.siteId??''));insist(false,'grant_unavailable','No shipping grant exists for these change drafts. Pane, Webflow, Mango and ad writes are unavailable; instrumentation GitHub approval permits its exact script diff only.',409)}

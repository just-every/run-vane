import { agentHistoryStamp } from '../agent-fence'
import { insist, uid, rows, type Actor, type Env } from '../core'
import { investigateMovement } from '../movement'
import { followAction } from '../follow-up'
import { agentSite, saveWork } from './drafts'
export async function pursueAnomaly(env:Env,actor:Actor,p:any){
 const value=await agentSite(env,actor,String(p.siteId??'')),item=(await rows<any>(env,"SELECT * FROM vane_follow_items WHERE id=? AND site_id=? AND state!='resolved'",String(p.itemId??''),value.id))[0]
 insist(item,'item','Choose an unresolved follow-up item from this site.',404)
 const fence={value,stamp:await agentHistoryStamp(env,value.id)}
 const report=await investigateMovement(env,actor,{siteId:value.id,from:p.from,to:p.to,comparedFrom:p.comparedFrom,comparedTo:p.comparedTo})
 const evidence=await saveWork(env,actor,{siteId:value.id,kind:'pursuit',from:report.comparedFrom,to:report.to,payload:{itemId:item.id,investigationId:report.id,hypotheses:report.hypotheses,unknown:report.unknown,state:'awaiting-person',reason:'A person must confirm resolution. Native event recovery alone cannot establish intact collection coverage.'}},uid(),fence)
 await followAction(env,actor,{operation:'follow.comment',id:item.id,text:`Investigation ${report.id}: ${report.hypotheses[0]?.title??'No supported fault found'}. Evidence: /api/vane/agent/work?siteId=${value.id}&id=${evidence.id}. Awaiting a person; no outbound message was sent.`})
 return evidence
}

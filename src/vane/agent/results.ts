import { agentHistoryStamp } from '../agent-fence'
import { insist, uid, rows, type Actor, type Env } from '../core'
import { localDate } from '../annotations'
import { clock } from '../clock'
import { localDay } from '../visitors'
import { createInsightsService } from '../reports'
import { agentSite, saveWork } from './drafts'
export async function measureChange(env:Env,actor:Actor,p:any){
 const value=await agentSite(env,actor,String(p.siteId??'')),from=localDate(p.from),to=localDate(p.to),comparedFrom=localDate(p.comparedFrom),comparedTo=localDate(p.comparedTo)
 insist(from<to&&comparedFrom<comparedTo&&comparedTo<=from&&Date.parse(to)-Date.parse(from)===Date.parse(comparedTo)-Date.parse(comparedFrom)&&Date.parse(to)-Date.parse(from)<=31*86400000&&new Date(from).getUTCDay()===new Date(comparedFrom).getUTCDay()&&to<=localDay(clock(),value.config.timeZone??'UTC'),'range','Compare ended, non-overlapping matched-weekday windows of equal length, at most 31 days.')
 const fence={value,stamp:await agentHistoryStamp(env,value.id)}
 const fix=(await rows<any>(env,'SELECT * FROM vane_instrumentation_fixes WHERE id=? AND site_id=? AND verified_at IS NOT NULL',String(p.fixId??''),value.id))[0]
 insist(fix&&fix.verified_at<=Date.parse(from+'T00:00:00Z'),'change','A deployed and verified instrumentation fix is required; a local draft is not a shipped change.',409)
 const r=await createInsightsService(env,value,clock(),{from,to,compare:'custom',compareFrom:comparedFrom,compareTo:comparedTo,imported:'off'}).list()
 const experiment=r.experiments.find(e=>e.name===p.experiment),variant=experiment?.variants.find(v=>v.variant===p.variant&&!v.control)
 const coverage=r.explain.coverage,changed=coverage.length>0||r.annotations.some(a=>['settings','definition'].includes(a.kind))
 const verdict=changed||!experiment?'inconclusive because of coverage':!experiment||!variant||experiment.underpowered||experiment.sampleRatioMismatch?'inconclusive because of sample size':variant.verdict==='beats control'?'measured improvement':variant.verdict==='trails control'?'worse':'no detectable change'
 return saveWork(env,actor,{siteId:value.id,kind:'measurement',from:comparedFrom,to,payload:{fixId:fix.id,from,to,comparedFrom,comparedTo,verdict,interval:variant?.differenceInterval??null,coverage,guardrails:{bounceRate:r.bounceRate,previousBounceRate:r.previousBounceRate},recommendation:verdict==='worse'?'Review a revert with the owner.':'Keep under review; no automatic change.',limitation:'Before-and-after observations do not prove causality. Unmeasured blockers remain unknown. Revert authority is unavailable.'}},uid(),fence)
}

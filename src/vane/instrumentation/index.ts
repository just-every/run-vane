import { readGitHubDiff, githubSetting, githubDrafts, githubObservationGuard, rememberGitHubHead, prepareGitHubDraft, type GitHubObservation } from './github'
import { agentHistoryStamp, agentCommitGuard } from '../agent-fence'
import { allow, atomic, inScope, insist, rows, site, statement, uid, type Actor, type Env } from '../core'
import { auditStatement } from '../audit'
import { clock } from '../clock'
import { localDay } from '../visitors'
import { localDate } from '../annotations'
import { prepare } from '../commands'
import { scan, scans } from '../cutover/scan'
import { inspectPage, nativeScriptUrls } from './page'
import { redactPath } from '../paths'
export interface Problem {kind:'missing-script'|'duplicate-script'|'missing-selector'|'invalid-selector'|'silent-event'|'possible-duplicate'|'misnamed-event'|'missing-funnel-step'|'deploy-diff';page?:string;name?:string;detail:string;evidence:string;replacement?:string;target?:string}
export interface InstrumentationReport {
 id:string;siteId:string;at:number;github?:GitHubObservation;scanId:string;siteVersion:number;inspectedPages:number;from:string;to:string;problems:Problem[];unknown:string[]
 draft:{title:string;body:string;changes:{page:string;before:string;after:string}[];state:'draft-only'}
}
const owner=async(env:Env,actor:Actor,siteId:string)=>{allow(actor,'owner');inScope(actor,siteId);return site(env,siteId)}
const path=(url:string)=>redactPath(new URL(url).pathname)
const evidence=(siteId:string,scanId:string)=>`/app/sites/${encodeURIComponent(siteId)}?section=settings#scan-${encodeURIComponent(scanId)}`
export async function instrumentationHistory(env:Env,actor:Actor,siteId:string) {
 await owner(env,actor,siteId)
 const [runs,fixes]=await Promise.all([
  rows<{report_json:string}>(env,'SELECT report_json FROM vane_instrumentation_runs WHERE site_id=? ORDER BY at DESC,id LIMIT 10',siteId),
  rows<any>(env,'SELECT * FROM vane_instrumentation_fixes WHERE site_id=? ORDER BY created_at DESC,id LIMIT 10',siteId),
 ])
 return {github:await githubSetting(env,actor,siteId),githubDrafts:await githubDrafts(env,actor,siteId),runs:runs.map(r=>JSON.parse(r.report_json) as InstrumentationReport),fixes:fixes.map(({draft_json,...f})=>({...f,draft:JSON.parse(draft_json)}))}
}
export async function investigateInstrumentation(env:Env,actor:Actor,p:any):Promise<InstrumentationReport> {
 const value=await owner(env,actor,String(p.siteId??'')),from=localDate(p.from),to=localDate(p.to)
 insist(from<to&&Date.parse(to)-Date.parse(from)<=31*86400000,'range','Investigate between 1 and 31 whole local days.')
 const stamp=await agentHistoryStamp(env,value.id)
 const previous=(await scans(env,actor,value.id)).find(s=>s.state==='complete'&&s.pages.some(p=>p.native))
 const scriptUrls=await nativeScriptUrls(env,value),current=await scan(env,actor,{siteId:value.id,pageLimit:p.pageLimit??50},html=>inspectPage(html,value,scriptUrls))
 let github:GitHubObservation|null=null,githubUnavailable=false
 try{github=await readGitHubDiff(env,actor,value.id)}catch{githubUnavailable=true}
 const problems:Problem[]=[],link=evidence(value.id,current.id)
 for(const page of current.pages) {
  const native=page.native!,pagePath=path(page.url),base=previous?.pages.find(p=>path(p.url)===pagePath)?.native
  if(native.scripts!==1)problems.push({kind:native.scripts?'duplicate-script':'missing-script',page:pagePath,detail:`${native.scripts} matching native script tags on this page; expected one. Static HTML does not prove execution.`,evidence:link})
  for(const d of native.selectors)if(d.matches===0||d.matches===null) {
   const old=base?.controls.find(c=>c.selector===d.target),candidates=old?native.controls.filter(c=>c.tag===old.tag&&c.ordinal===old.ordinal):[]
   const replacement=candidates.length===1&&candidates[0]!.selector!==d.target?candidates[0]!.selector:undefined
   problems.push({kind:d.matches===null?'invalid-selector':'missing-selector',page:pagePath,name:d.name,target:d.target,...(replacement?{replacement}:{}),detail:`${d.name}: ${d.target} ${d.matches===null?'could not be parsed':'matched no element'}${replacement?`; ${replacement} is a structural candidate, not proof of semantic equivalence`:''}.`,evidence:link})
  }
 }
 const [arrivals,loads]=await Promise.all([
  rows<{name:string;n:number;pages:number}>(env,'SELECT name,COUNT(*) AS n,COUNT(DISTINCT page_id) AS pages FROM vane_custom_events WHERE site_id=? AND day>=? AND day<? GROUP BY name',value.id,from,to),
  rows<{n:number}>(env,"SELECT COUNT(*) AS n FROM vane_events WHERE site_id=? AND day>=? AND day<? AND kind='pageview'",value.id,from,to),
 ])
 const declared=[...new Set([...(value.config.eventDefinitions??[]).map(d=>d.name),...Object.values(value.config.customGoals??{}).map(g=>g.event)])]
 const reportLink=`/app/sites/${encodeURIComponent(value.id)}?${new URLSearchParams({from,to})}#goals`
 for(const name of declared) {
  const found=arrivals.find(r=>r.name===name)
  if(!found)problems.push({kind:'silent-event',name,detail:`No ${name} event among ${loads[0]!.n} accepted page loads in this window. Lack of an event alone does not prove a fault.`,evidence:reportLink})
  if(found&&found.n>found.pages)problems.push({kind:'possible-duplicate',name,detail:`${found.n} ${name} events on ${found.pages} distinct page loads; repeated interactions can be legitimate.`,evidence:reportLink})
  for(const other of arrivals.filter(r=>r.name!==name&&r.name.toLowerCase()===name.toLowerCase()))problems.push({kind:'misnamed-event',name:other.name,detail:`${other.n} ${other.name} events arrived; declared spelling is ${name}. Names are case-sensitive.`,evidence:reportLink})
 }
 for(const f of value.config.funnels??[])for(const step of f.steps)if(step.startsWith('event:')&&!declared.includes(step.slice(6).split('[')[0]!))problems.push({kind:'missing-funnel-step',name:f.name,detail:`${f.name} refers to ${step}, which has no declared event definition or goal. It may be supplied by code; its existence is unverified.`,evidence:reportLink})
 for(const file of github?.files??[])problems.push({kind:'deploy-diff',detail:`Mapped source ${file.file}: ${file.status}${file.scriptRemoved?'; a native script line was removed':''}. This is source evidence, not proof of deployment.`,evidence:`https://github.com/${github!.repository}/compare/${github!.previousHead}...${github!.head}`})
 const changes=problems.flatMap(p=>p.kind==='missing-script'?[{page:p.page!,before:'No matching native script',after:`<script defer src="${new URL('/vane.js',env.AUTH_ORIGIN).href}" data-site="${value.id}"></script>`}]:p.kind==='missing-selector'&&p.replacement?[{page:p.page!,before:`${p.name}: ${p.target}`,after:`${p.name}: ${p.target}, ${p.replacement}`}]:[])
 const unknown=[...(current.state!=='complete'?['The crawl failed; no clean-site conclusion is possible.']:[]),...(current.refused?[`${current.refused} sitemap/page requests were refused or exceeded the selected limit; those pages are unverified.`]:[]),'Static HTML cannot prove consent, script execution, blockers or a real user action.',...(githubUnavailable?['The connected GitHub source could not be read; no source diff or source-head assumption is made.']:!github?['GitHub source diffs and PR submission are not connected; the PR remains a local review draft.']:['GitHub source changes are read at the shown full SHA; they do not establish deployment. Opening a draft PR requires a separate explicit owner action after approving the fix.']),'Pane deploy diffs and hand-off are unavailable until INSTALL-004 and AGENT-003 ship.','Server-confirmed outcomes from Stripe, Shopify and CRM are unavailable until CONV-008 is connected.','GTM and Pane fix hand-off are unavailable until INSTALL-005 and AGENT-003 ship.']
 const result:InstrumentationReport={id:uid(),siteId:value.id,at:clock(),...(github?{github}:{}),scanId:current.id,siteVersion:value.version,inspectedPages:current.pages.length,from,to,problems,unknown,draft:{title:'Repair analytics instrumentation',state:'draft-only',changes,body:`Review these structural observations against the deployed source. Preserve consent, event names, properties and the collection field set. ${changes.length} suggested changes; no repository or website has been edited.`}}
 await atomic(env,actor,[agentCommitGuard(env,value,stamp),...(github?[githubObservationGuard(env,value.id,github),rememberGitHubHead(env,value.id,github)]:[]),statement(env,'INSERT INTO vane_instrumentation_runs(id,site_id,actor_id,at,scan_id,from_day,to_day,report_json) VALUES(?,?,?,?,?,?,?,?)',result.id,value.id,actor.id,result.at,current.id,from,to,JSON.stringify(result)),auditStatement(env,actor.id,'agent.instrumentation',value.id,result.id)])
 return result
}
async function runOf(env:Env,siteId:string,id:string):Promise<InstrumentationReport> {
 const row=(await rows<{report_json:string}>(env,'SELECT report_json FROM vane_instrumentation_runs WHERE id=? AND site_id=?',id,siteId))[0]
 insist(row,'instrumentation_run','Choose an investigation for this site.',404);return JSON.parse(row.report_json)
}
export async function prepareInstrumentationFix(env:Env,actor:Actor,p:any) {
 const value=await owner(env,actor,String(p.siteId??'')),run=await runOf(env,value.id,String(p.runId??''))
 insist(run.siteVersion===value.version,'stale','Settings changed since this investigation. Investigate again before preparing a fix.',409)
 insist(p.confirm==='on','review','Confirm that you reviewed the structural candidates against the deployed page.')
 const stamp=await agentHistoryStamp(env,value.id)
 const snapshot=(await scans(env,actor,value.id)).find(s=>s.id===run.scanId)
 insist(snapshot?.state==='complete','scan','A completed retained scan is required; investigate again.',409)
 const replacements=new Map<string,string>()
 for(const problem of run.problems.filter(p=>p.kind==='missing-selector'&&p.replacement)) {
  const prior=replacements.get(problem.target!);insist(!prior||prior===`${problem.target}, ${problem.replacement}`,'ambiguous','Different pages suggest conflicting replacements. Complete the change manually.');replacements.set(problem.target!,`${problem.target}, ${problem.replacement}`)
 }
 const eventDefinitions=(value.config.eventDefinitions??[]).map(d=>({...d,target:replacements.get(d.target)??d.target}))
 insist(run.draft.changes.length>0,'fix','No concrete fix was found. Complete the missing evidence first.')
 // The normal, version-bound owner approval is the sole way this draft changes a collection setting.
 const proposal=await prepare(env,actor,'site.configure',{siteId:value.id,name:value.name,origin:value.origin,config:{...value.config,eventDefinitions}},'command API')
 const id=uid(),at=clock()
 await atomic(env,actor,[agentCommitGuard(env,value,stamp),statement(env,'INSERT INTO vane_instrumentation_fixes(id,site_id,run_id,created_by,created_at,proposal_id,draft_json) VALUES(?,?,?,?,?,?,?)',id,value.id,run.id,actor.id,at,proposal.id,JSON.stringify({...run.draft,github:run.github,problems:run.problems,eventDefinitions})),...(run.github?[githubObservationGuard(env,value.id,run.github),prepareGitHubDraft(env,value.id,id,run.github)]:[]),auditStatement(env,actor.id,'agent.fix.prepare',value.id,`${id}: proposal ${proposal.id}; no outbound edit` )])
 return {id,proposalId:proposal.id,draft:run.draft,state:'awaiting-owner-approval'}
}
export async function verifyInstrumentationFix(env:Env,actor:Actor,p:any) {
 const value=await owner(env,actor,String(p.siteId??''))
 const fix=(await rows<any>(env,'SELECT * FROM vane_instrumentation_fixes WHERE id=? AND site_id=?',String(p.fixId??''),value.id))[0]
 insist(fix,'fix','Choose a fix for this site.',404)
 if(fix.verified_at!==null)return {state:'verified',at:fix.verified_at}
 const proposal=(await rows<any>(env,"SELECT * FROM vane_proposals WHERE id=? AND state='approved'",fix.proposal_id))[0]
 insist(proposal,'approval','The owner must approve the prepared change before verification.',409)
 const payload=JSON.parse(proposal.payload_json)
 insist(payload.version+1===value.version,'stale','Settings changed after this approval. Investigate and prepare a fresh fix.',409)
 const stamp=await agentHistoryStamp(env,value.id)
 const draft=JSON.parse(fix.draft_json),scriptUrls=await nativeScriptUrls(env,value),current=await scan(env,actor,{siteId:value.id,pageLimit:500},html=>inspectPage(html,value,scriptUrls)),missing:string[]=[]
 const deploy=(await rows<{at:number}>(env,"SELECT at FROM vane_annotations WHERE site_id=? AND kind IN ('deploy','release') AND at>? AND at>=? ORDER BY at DESC LIMIT 1",value.id,fix.created_at,proposal.approved_at))[0],deployed=Boolean(deploy),after=Math.max(fix.created_at,Number(proposal.approved_at),deploy?.at??0)
 if(!deployed)missing.push('A deploy or release annotation received after this fix was prepared is required.')
 for(const change of draft.changes as {page:string}[]) {
  const page=current.pages.find(p=>path(p.url)===change.page)
  if(!page?.native||page.native.scripts!==1){missing.push(`${change.page}: exactly one matching script was not observed.`);continue}
  for(const d of page.native.selectors)if(d.matches===0||d.matches===null)missing.push(`${change.page}: ${d.name} still has no usable selector.`)
  const loads=await rows<{n:number}>(env,"SELECT COUNT(*) AS n FROM vane_events WHERE site_id=? AND kind='pageview' AND path=? AND at>?",value.id,change.page,after)
  if(!loads[0]!.n)missing.push(`${change.page}: no accepted page-load payload after approval and deployment.`)
 }
 for(const problem of draft.problems as Problem[])if(problem.kind==='missing-selector'&&problem.replacement) {
  const result=await rows<{n:number}>(env,'SELECT COUNT(*) AS n FROM vane_custom_events c JOIN vane_events e ON e.id=c.page_id AND e.kind=\'pageview\' WHERE c.site_id=? AND e.site_id=? AND c.name=? AND e.path=? AND c.at>? AND e.at>?',value.id,value.id,problem.name,problem.page,after,after)
  if(!result[0]!.n)missing.push(`${problem.page}: no accepted ${problem.name} payload on a new page load after approval and deployment.`)
 }
 if(current.state!=='complete')missing.push('The verification scan failed.')
 await auditStatement(env,actor.id,'agent.fix.verify',value.id,`${fix.id}: ${missing.length?'not verified':'payload and page evidence observed'}`).run()
 if(missing.length)return {state:'unverified',missing,scanId:current.id}
 const at=clock(),annotationId='instrumentation:'+fix.id,pr=(await rows<{pr_url:string}>(env,"SELECT pr_url FROM vane_instrumentation_prs WHERE fix_id=? AND state='published'",fix.id))[0]
 await atomic(env,actor,[agentCommitGuard(env,value,stamp),statement(env,'INSERT INTO vane_guard(value) SELECT CASE WHEN EXISTS(SELECT 1 FROM vane_instrumentation_fixes WHERE id=? AND verified_at IS NULL) THEN 1 ELSE 0 END',fix.id),statement(env,'UPDATE vane_instrumentation_fixes SET verified_at=? WHERE id=? AND verified_at IS NULL',at,fix.id),statement(env,"INSERT OR IGNORE INTO vane_annotations(id,site_id,day,kind,text,url,author,at) VALUES(?,?,?,'settings',?,?,?,?)",annotationId,value.id,localDay(at,value.config.timeZone??'UTC'),`Instrumentation fix verified: ${draft.changes.length} page/selector changes; approved settings, deployed page and new accepted payloads checked.`,pr?.pr_url??null,actor.id,at)])
 return {state:'verified',at,scanId:current.id,annotationId}
}

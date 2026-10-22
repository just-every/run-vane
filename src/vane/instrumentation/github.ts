import { allow, atomic, inScope, insist, rows, site, statement, uid, VaneError, type Actor, type Env } from '../core'
import { auditStatement } from '../audit'
import { clock } from '../clock'
import { seal, unseal } from '../sealed'
import { storedPath } from '../paths'
import { agentHistoryStamp } from '../agent-fence'
import { sourceFile, sourceTree, sourcePlan, templatePath, type Mapping } from './github-source'
export type { Mapping } from './github-source'
const PURPOSE='vane-instrumentation-github-v1',API='https://api.github.com'
interface Connection {active:number;site_id:string;generation:string;repository:string;base_branch:string;mappings_json:string;sealed_token:string;last_head:string|null;created_by:string;created_at:number;credential_kind:string}
export interface GitHubObservation {generation:string;repository:string;branch:string;head:string;previousHead:string|null;files:{file:string;status:string;scriptRemoved:boolean}[]}
const connection=async(env:Env,siteId:string)=>(await rows<Connection>(env,'SELECT * FROM vane_instrumentation_github WHERE site_id=?',siteId))[0]
const sha=(value:unknown):value is string=>typeof value==='string'&&/^[a-f0-9]{40}$/.test(value)
const repoPath=(c:Connection)=>'/repos/'+c.repository.split('/').map(encodeURIComponent).join('/')
const branchPath=(c:Connection)=>repoPath(c)+'/git/ref/heads/'+c.base_branch.split('/').map(encodeURIComponent).join('/')
async function owner(env:Env,actor:Actor,siteId:string){allow(actor,'owner');inScope(actor,siteId);const current=(await rows(env,"SELECT 1 FROM oa_operators WHERE id=? AND role='owner' AND status='active'",actor.id)).length;insist(current,'forbidden','Use the active owner session.',403);return site(env,siteId)}
async function live(env:Env,actor:Actor,c:Connection){await owner(env,actor,c.site_id);const active=await connection(env,c.site_id);insist(active?.generation===c.generation&&active.active===1&&active.created_by===actor.id&&['fine-grained','installation'].includes(active.credential_kind),'github_revoked','The GitHub connection was revoked, replaced or belongs to a former owner; reconnect explicitly.',409)}
// Fixed GitHub host only; never redirects, returns upstream bodies to the UI or persists source/patch bodies.
async function call(c:Connection,token:string,path:string,method='GET',body?:unknown,missing=false):Promise<any> {
 const response=await fetch(API+path,{method,redirect:'manual',headers:{accept:'application/vnd.github+json','x-github-api-version':'2022-11-28','user-agent':'Vane',authorization:'Bearer '+token,...(body?{'content-type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(15000)})
 if(response.headers.get('x-oauth-scopes')?.trim()){await response.body?.cancel();throw new VaneError('github_scope','Classic OAuth or personal tokens are refused. Use a least-privilege GitHub App installation or fine-grained token.',403)}
 if(missing&&response.status===404){await response.body?.cancel();return null}
 if(!response.ok){await response.body?.cancel();throw new VaneError('github_request','GitHub did not complete the source request. No provider body or credential was retained.',502)}
 const text=await response.text();insist(text.length<=2_000_000,'github_size','The GitHub response exceeds the bounded source reader.',502)
 try{return JSON.parse(text)}catch{throw new VaneError('github_response','GitHub returned an unreadable source response.',502)}
}
const tokenOf=(env:Env,c:Connection)=>unseal(env,PURPOSE,c.site_id+':'+c.generation,c.sealed_token)
export async function githubSetting(env:Env,actor:Actor,siteId:string){await owner(env,actor,siteId);const c=await connection(env,siteId);return c?.active===1?{repository:c.repository,branch:c.base_branch,mappings:JSON.parse(c.mappings_json) as Mapping[],canUse:c.created_by===actor.id&&['fine-grained','installation'].includes(c.credential_kind),createdAt:c.created_at}:null}
export async function configureGitHub(env:Env,actor:Actor,p:any) {
 const value=await owner(env,actor,String(p.siteId??''))
 insist(p.enabled==='on'||p.enabled==='off','github_setting','Choose on or off.')
 if(p.enabled==='off'){await atomic(env,actor,[statement(env,'DELETE FROM vane_instrumentation_github WHERE site_id=?',value.id),auditStatement(env,actor.id,'agent.github.disconnect',value.id,'source credential revoked; existing external drafts remain with their owner')]);return}
 insist(['fine-grained','installation'].includes(p.credentialKind)&&p.scopeConfirm==='on','github_scope','Confirm a GitHub App installation or fine-grained token restricted to this repository, contents and pull requests, with no administration, actions/workflows write or secrets permissions.')
 insist(p.confirm==='on','github_consent','Explicitly approve reading this repository and opening individually approved draft PRs.')
 const repository=String(p.repository??''),branch=String(p.branch??'main'),token=String(p.token??'')
 insist(/^[A-Za-z0-9][A-Za-z0-9_.-]{0,99}\/[A-Za-z0-9][A-Za-z0-9_.-]{0,99}$/.test(repository),'github_repository','Choose one GitHub owner/repository.')
 insist(/^[A-Za-z0-9][A-Za-z0-9_./-]{0,99}$/.test(branch)&&!branch.includes('..')&&!branch.endsWith('/')&&!branch.includes('//'),'github_branch','Choose a normal base branch name.')
 insist(token.length>=10&&token.length<=500&&!/\s/.test(token),'github_token','Provide your repository-scoped GitHub credential; it will be sealed and never shown again.')
 const raw=Array.isArray(p.mappings)?p.mappings:String(p.mappings??'').split('\n').filter(Boolean).map(line=>{const at=line.indexOf('=');return {path:line.slice(0,at).trim(),file:line.slice(at+1).trim()}})
 insist(raw.length>=1&&raw.length<=20,'github_mappings','Map 1–20 exact site paths to repository template files.')
 const mappings:Mapping[]=raw.map((m:any)=>{const path=String(m.path??''),file=String(m.file??'');templatePath(file);insist(/^\/[A-Za-z0-9_./-]{0,119}$/.test(path)&&storedPath(value.config,path)===path&&!path.includes('//')&&!path.split('/').some(p=>p==='.'||p==='..'),'github_mapping','Use an exact public site path without personal segments.');insist(/^[A-Za-z0-9_][A-Za-z0-9_./-]{0,239}$/.test(file)&&!file.split('/').some(p=>p==='.'||p==='..')&&!file.includes('//'),'github_mapping','Use a relative repository template file path.');return {path,file}})
 insist(new Set(mappings.map(m=>m.path)).size===mappings.length,'github_mapping','Map each site path once.')
 const generation=uid(),c:Connection={active:0,site_id:value.id,generation,repository,base_branch:branch,mappings_json:JSON.stringify(mappings),sealed_token:'',last_head:null,created_by:actor.id,created_at:clock(),credential_kind:p.credentialKind}
 const sealed=await seal(env,PURPOSE,value.id+':'+generation,token)
 await atomic(env,actor,[statement(env,'INSERT INTO vane_instrumentation_github(site_id,generation,active,repository,base_branch,mappings_json,sealed_token,last_head,created_by,created_at,credential_kind) VALUES(?,?,0,?,?,?,?,NULL,?,?,?) ON CONFLICT(site_id) DO UPDATE SET generation=excluded.generation,active=0,repository=excluded.repository,base_branch=excluded.base_branch,mappings_json=excluded.mappings_json,sealed_token=excluded.sealed_token,last_head=NULL,created_by=excluded.created_by,created_at=excluded.created_at,credential_kind=excluded.credential_kind',value.id,generation,repository,branch,JSON.stringify(mappings),sealed,actor.id,clock(),p.credentialKind),auditStatement(env,actor.id,'agent.github.begin',value.id,'owner explicitly approved a replacement connection; prior source authority revoked')])
 const pending=async()=>{await owner(env,actor,value.id);const found=await connection(env,value.id);insist(found?.generation===generation&&found.active===0,'github_revoked','The pending GitHub connection was cancelled or replaced.',409)}
 try {
  await pending();const repositoryInfo=await call(c,token,repoPath(c));await pending()
  insist(repositoryInfo.full_name?.toLowerCase()===repository.toLowerCase()&&repositoryInfo.permissions?.push===true&&!repositoryInfo.archived&&!repositoryInfo.disabled,'github_authority','Choose an active repository where this credential permits your account to push.',403)
  c.repository=repositoryInfo.full_name
  const ref=await call(c,token,branchPath(c));await pending();insist(sha(ref.object?.sha),'github_head','GitHub did not return a full base commit SHA.',502)
  await atomic(env,actor,[statement(env,'INSERT INTO vane_guard(value) SELECT CASE WHEN EXISTS(SELECT 1 FROM vane_instrumentation_github WHERE site_id=? AND generation=? AND active=0) THEN 1 ELSE 0 END',value.id,generation),statement(env,'UPDATE vane_instrumentation_github SET active=1,repository=? WHERE site_id=? AND generation=? AND active=0',c.repository,value.id,generation),auditStatement(env,actor.id,'agent.github.connect',value.id,'fixed-host source connection verified; each draft PR still requires separate owner approval')])
 } catch(error){await statement(env,'DELETE FROM vane_instrumentation_github WHERE site_id=? AND generation=? AND active=0',value.id,generation).run();throw error}

}
export async function readGitHubDiff(env:Env,actor:Actor,siteId:string):Promise<GitHubObservation|null> {
 const c=await connection(env,siteId);if(!c||c.active!==1)return null;await live(env,actor,c)
 const token=await tokenOf(env,c),ref=await call(c,token,branchPath(c));insist(sha(ref.object?.sha),'github_head','GitHub did not return a full source SHA.',502)
 const head=ref.object.sha,files:GitHubObservation['files']=[],mapped=new Set((JSON.parse(c.mappings_json) as Mapping[]).map(m=>m.file))
 if(c.last_head&&c.last_head!==head){
  // Read only safe, explicitly mapped templates. The compare API includes patches
  // from unmapped .env/key files, so it must never be used by this source reader.
  const read=async(path:string,missing=false)=>{await live(env,actor,c);return call(c,token,path,'GET',undefined,missing)}
  const previousTree=await sourceTree(read,repoPath(c),c.last_head),currentTree=await sourceTree(read,repoPath(c),head)
  for(const file of mapped){
   const before=await sourceFile(read,repoPath(c),file,previousTree),after=await sourceFile(read,repoPath(c),file,currentTree)
   if(before?.sha!==after?.sha)files.push({file,status:!before?'added':!after?'removed':'modified',scriptRemoved:Boolean(before&&/vane\.js|\/script\.js/.test(before.html)&&(!after||!/vane\.js|\/script\.js/.test(after.html)))})
  }
 }
 await live(env,actor,c);return {generation:c.generation,repository:c.repository,branch:c.base_branch,head,previousHead:c.last_head,files}
}
export const githubObservationGuard=(env:Env,siteId:string,o:GitHubObservation)=>statement(env,'INSERT INTO vane_guard(value) SELECT CASE WHEN EXISTS(SELECT 1 FROM vane_instrumentation_github WHERE site_id=? AND generation=? AND active=1) THEN 1 ELSE 0 END',siteId,o.generation)
export const rememberGitHubHead=(env:Env,siteId:string,o:GitHubObservation)=>statement(env,'UPDATE vane_instrumentation_github SET last_head=? WHERE site_id=? AND generation=?',o.head,siteId,o.generation)
export async function prepareGitHubSource(env:Env,actor:Actor,siteId:string,o:GitHubObservation,changes:{page:string;before:string;after:string}[]) {
 const c=await connection(env,siteId);insist(c?.generation===o.generation,'github_revoked','Reconnect and investigate this source again.',409);await live(env,actor,c)
 const token=await tokenOf(env,c),read=async(path:string,missing=false)=>{await live(env,actor,c);return call(c,token,path,'GET',undefined,missing)}
 const plan=await sourcePlan(env,await site(env,siteId),read,repoPath(c),o.head,JSON.parse(c.mappings_json),changes)
 await live(env,actor,c);return {diffHash:plan.diffHash,files:plan.files}
}
export const prepareGitHubDraft=(env:Env,siteId:string,fixId:string,o:GitHubObservation)=>statement(env,"INSERT INTO vane_instrumentation_prs(fix_id,site_id,generation,base_sha,branch,state,created_at,updated_at) VALUES(?,?,?,?,?,'prepared',?,?)",fixId,siteId,o.generation,o.head,'vane/instrumentation-'+fixId,clock(),clock())
export async function githubDrafts(env:Env,actor:Actor,siteId:string){await owner(env,actor,siteId);return rows<any>(env,'SELECT fix_id,branch,state,candidate_sha,pr_url,pr_number FROM vane_instrumentation_prs WHERE site_id=? ORDER BY created_at DESC LIMIT 10',siteId)}
function prUrl(c:Connection,p:any){const expected=`https://github.com/${c.repository}/pull/${p.number}`;insist(Number.isSafeInteger(p.number)&&p.number>0&&p.html_url===expected,'github_pr','GitHub did not return the expected repository PR URL.',502);return expected}
export async function publishGitHubDraft(env:Env,actor:Actor,p:any) {
 const value=await owner(env,actor,String(p.siteId??''));insist(p.confirm==='on','github_publish','Explicitly approve opening this draft PR.')
 const c=await connection(env,value.id);insist(c?.active===1,'github_connection','Connect the repository first.',409);await live(env,actor,c)
 const fix=(await rows<any>(env,'SELECT * FROM vane_instrumentation_fixes WHERE id=? AND site_id=?',String(p.fixId??''),value.id))[0],draft=(await rows<any>(env,'SELECT * FROM vane_instrumentation_prs WHERE fix_id=? AND site_id=?',String(p.fixId??''),value.id))[0]
 insist(fix&&draft&&draft.generation===c.generation,'github_draft','Prepare a fix against this current repository connection.',409)
 const proposal=(await rows<any>(env,"SELECT * FROM vane_proposals WHERE id=? AND state='approved'",fix.proposal_id))[0]
 insist(proposal&&JSON.parse(proposal.payload_json).version+1===value.version,'approval','The owner must approve this version-bound fix before opening a PR; stale settings require a new investigation.',409)
 if(draft.state==='blocked')throw new VaneError('github_preflight','This draft failed source preflight before any external write. Investigate and approve a fresh fix.',409)
 if(draft.state==='published')return {state:'published',url:draft.pr_url,head:draft.candidate_sha}
 const approval=JSON.parse(proposal.payload_json).instrumentationApproval,diffHash=JSON.parse(fix.draft_json).diffHash
 insist(approval&&diffHash&&approval.diffHash===diffHash,'approval','The exact diff needs a new owner approval.',409)
 insist(draft.branch==='vane/instrumentation-'+fix.id&&draft.branch!==c.base_branch,'github_branch','Use this fix’s namespaced branch, never the source branch.',409)
 const token=await tokenOf(env,c),marker='Vane instrumentation fix '+fix.id,stamp=await agentHistoryStamp(env,value.id)
 const ensure=async()=>{await live(env,actor,c);const current=await site(env,value.id);insist(current.version===value.version&&await agentHistoryStamp(env,value.id)===stamp&&(await rows(env,'SELECT 1 FROM vane_instrumentation_fixes WHERE id=? AND draft_json=?',fix.id,fix.draft_json)).length&&(await rows(env,"SELECT 1 FROM vane_proposals WHERE id=? AND state='approved' AND payload_json=?",proposal.id,proposal.payload_json)).length,'github_stale','The fix was erased or settings changed; no further external write is allowed.',409)}
 const record=async(pr:any)=>{const url=prUrl(c,pr);insist(pr.head?.sha===draft.candidate_sha,'github_pr','The draft PR does not point to this fix’s candidate SHA.',409);await ensure();await atomic(env,actor,[statement(env,"UPDATE vane_instrumentation_prs SET state='published',pr_url=?,pr_number=?,updated_at=? WHERE fix_id=? AND generation=?",url,pr.number,clock(),fix.id,c.generation),auditStatement(env,actor.id,'agent.github.pr',value.id,`${fix.id}: draft PR ${pr.number}; source ${draft.candidate_sha}`)]);return {state:'published',url,head:draft.candidate_sha}}
 // A lost provider response is reconciled read-only. Never replay an uncertain mutation or create another branch.
 if(draft.state!=='prepared'){
  await ensure();const list=await call(c,token,repoPath(c)+'/pulls?'+new URLSearchParams({state:'all',head:c.repository.split('/')[0]+':'+draft.branch,base:c.base_branch}));insist(Array.isArray(list),'github_pr','GitHub did not return a draft list.',502)
  const found=list.find(pr=>pr.head?.sha===draft.candidate_sha&&pr.body?.includes(marker));return found?record(found):{state:'uncertain',message:'No matching PR is confirmed. Inspect the source repository; this attempt will not replay a write.'}
 }
 try {await atomic(env,actor,[statement(env,"INSERT INTO vane_guard(value) SELECT CASE WHEN EXISTS(SELECT 1 FROM vane_instrumentation_prs WHERE fix_id=? AND state='prepared') THEN 1 ELSE 0 END",fix.id),statement(env,"UPDATE vane_instrumentation_prs SET state='sending',updated_at=? WHERE fix_id=? AND state='prepared'",clock(),fix.id),auditStatement(env,actor.id,'agent.github.pr.begin',value.id,`${fix.id}: owner explicitly approved draft hand-off at source ${draft.base_sha}`)])}catch{throw new VaneError('github_busy','The draft could not be claimed; refresh and reconcile before retrying.',409)}
 let didMutate=false
 try {
  await ensure();const ref=await call(c,token,branchPath(c));insist(ref.object?.sha===draft.base_sha,'github_stale','The source branch moved. Investigate and approve a new fix; nothing will be force-updated.',409)
  const changes=JSON.parse(fix.draft_json).changes as {page:string;before:string;after:string}[]
  const read=async(path:string,missing=false)=>{await ensure();return call(c,token,path,'GET',undefined,missing)}
  const plan=await sourcePlan(env,value,read,repoPath(c),draft.base_sha,JSON.parse(c.mappings_json),changes)
  insist(plan.diffHash===diffHash,'approval','The diff changed. Its approval is void; investigate and approve a new fix.',409)
  const commit=await read(repoPath(c)+'/git/commits/'+draft.base_sha),tree=plan.tree
  await ensure();const stillCurrent=await call(c,token,branchPath(c));insist(stillCurrent.object?.sha===draft.base_sha,'github_stale','The source branch moved while its templates were read. No source write was made.',409)
  await ensure();didMutate=true;const createdTree=await call(c,token,repoPath(c)+'/git/trees','POST',{base_tree:commit.tree.sha,tree});insist(sha(createdTree.sha),'github_tree','GitHub did not return a candidate tree.',502)
  await ensure();const createdCommit=await call(c,token,repoPath(c)+'/git/commits','POST',{message:marker,tree:createdTree.sha,parents:[draft.base_sha]});insist(sha(createdCommit.sha),'github_commit','GitHub did not return a candidate commit.',502)
  draft.candidate_sha=createdCommit.sha;await statement(env,'UPDATE vane_instrumentation_prs SET candidate_sha=?,updated_at=? WHERE fix_id=? AND generation=?',draft.candidate_sha,clock(),fix.id,c.generation).run()
  await ensure();await call(c,token,repoPath(c)+'/git/refs','POST',{ref:'refs/heads/'+draft.branch,sha:draft.candidate_sha})
  await ensure();const pr=await call(c,token,repoPath(c)+'/pulls','POST',{title:'Repair analytics instrumentation',head:draft.branch,base:c.base_branch,draft:true,body:marker+'\n\nOwner-approved script-only repair in the explicitly mapped HTML templates. The associated no-code selector change uses Vane’s normal owner approval. No metric, consent rule, identifier or collected field is widened. Review and deploy through your own repository workflow; Vane never merges or deploys this PR.'})
  insist(pr.draft===true,'github_pr','GitHub did not confirm a draft PR; reconcile the provider outcome.',502)
  return await record(pr)
 } catch(error){await statement(env,"UPDATE vane_instrumentation_prs SET state=?,updated_at=? WHERE fix_id=? AND state='sending'",didMutate?'uncertain':'blocked',clock(),fix.id).run();throw error instanceof VaneError?error:new VaneError('github_unknown','The provider outcome is uncertain. Reconcile this draft; no mutation will be replayed automatically.',502)}
}

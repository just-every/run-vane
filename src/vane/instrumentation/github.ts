import { allow, atomic, inScope, insist, rows, site, statement, uid, VaneError, type Actor, type Env } from '../core'
import { auditStatement } from '../audit'
import { clock } from '../clock'
import { seal, unseal } from '../sealed'
import { storedPath } from '../paths'
import { agentHistoryStamp } from '../agent-fence'
import { inspectPage, nativeScriptUrls } from './page'
const PURPOSE='vane-instrumentation-github-v1',API='https://api.github.com'
interface Connection {active:number;site_id:string;generation:string;repository:string;base_branch:string;mappings_json:string;sealed_token:string;last_head:string|null;created_by:string;created_at:number}
export interface Mapping {path:string;file:string}
export interface GitHubObservation {generation:string;repository:string;branch:string;head:string;previousHead:string|null;files:{file:string;status:string;scriptRemoved:boolean}[]}
const connection=async(env:Env,siteId:string)=>(await rows<Connection>(env,'SELECT * FROM vane_instrumentation_github WHERE site_id=?',siteId))[0]
const sha=(value:unknown):value is string=>typeof value==='string'&&/^[a-f0-9]{40}$/.test(value)
const repoPath=(c:Connection)=>'/repos/'+c.repository.split('/').map(encodeURIComponent).join('/')
const branchPath=(c:Connection)=>repoPath(c)+'/git/ref/heads/'+c.base_branch.split('/').map(encodeURIComponent).join('/')
async function owner(env:Env,actor:Actor,siteId:string){allow(actor,'owner');inScope(actor,siteId);const current=(await rows(env,"SELECT 1 FROM oa_operators WHERE id=? AND role='owner' AND status='active'",actor.id)).length;insist(current,'forbidden','Use the active owner session.',403);return site(env,siteId)}
async function live(env:Env,actor:Actor,c:Connection){await owner(env,actor,c.site_id);const active=await connection(env,c.site_id);insist(active?.generation===c.generation&&active.active===1,'github_revoked','The GitHub connection was revoked or replaced.',409)}
// Fixed GitHub host only; never redirects, returns upstream bodies to the UI or persists source/patch bodies.
async function call(c:Connection,token:string,path:string,method='GET',body?:unknown,missing=false):Promise<any> {
 const response=await fetch(API+path,{method,redirect:'manual',headers:{accept:'application/vnd.github+json','x-github-api-version':'2022-11-28','user-agent':'Vane',authorization:'Bearer '+token,...(body?{'content-type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(15000)})
 if(missing&&response.status===404){await response.body?.cancel();return null}
 if(!response.ok){await response.body?.cancel();throw new VaneError('github_request','GitHub did not complete the source request. No provider body or credential was retained.',502)}
 const text=await response.text();insist(text.length<=2_000_000,'github_size','The GitHub response exceeds the bounded source reader.',502)
 try{return JSON.parse(text)}catch{throw new VaneError('github_response','GitHub returned an unreadable source response.',502)}
}
const tokenOf=(env:Env,c:Connection)=>unseal(env,PURPOSE,c.site_id+':'+c.generation,c.sealed_token)
export async function githubSetting(env:Env,actor:Actor,siteId:string){await owner(env,actor,siteId);const c=await connection(env,siteId);return c?.active===1?{repository:c.repository,branch:c.base_branch,mappings:JSON.parse(c.mappings_json) as Mapping[],createdAt:c.created_at}:null}
export async function configureGitHub(env:Env,actor:Actor,p:any) {
 const value=await owner(env,actor,String(p.siteId??''))
 insist(p.enabled==='on'||p.enabled==='off','github_setting','Choose on or off.')
 if(p.enabled==='off'){await atomic(env,actor,[statement(env,'DELETE FROM vane_instrumentation_github WHERE site_id=?',value.id),auditStatement(env,actor.id,'agent.github.disconnect',value.id,'source credential revoked; existing external drafts remain with their owner')]);return}
 insist(p.confirm==='on','github_consent','Explicitly approve reading this repository and opening individually approved draft PRs.')
 const repository=String(p.repository??''),branch=String(p.branch??'main'),token=String(p.token??'')
 insist(/^[A-Za-z0-9][A-Za-z0-9_.-]{0,99}\/[A-Za-z0-9][A-Za-z0-9_.-]{0,99}$/.test(repository),'github_repository','Choose one GitHub owner/repository.')
 insist(/^[A-Za-z0-9][A-Za-z0-9_./-]{0,99}$/.test(branch)&&!branch.includes('..')&&!branch.endsWith('/')&&!branch.includes('//'),'github_branch','Choose a normal base branch name.')
 insist(token.length>=10&&token.length<=500&&!/\s/.test(token),'github_token','Provide your repository-scoped GitHub credential; it will be sealed and never shown again.')
 const raw=Array.isArray(p.mappings)?p.mappings:String(p.mappings??'').split('\n').filter(Boolean).map(line=>{const at=line.indexOf('=');return {path:line.slice(0,at).trim(),file:line.slice(at+1).trim()}})
 insist(raw.length>=1&&raw.length<=20,'github_mappings','Map 1–20 exact site paths to repository template files.')
 const mappings:Mapping[]=raw.map((m:any)=>{const path=String(m.path??''),file=String(m.file??'');insist(/^\/[A-Za-z0-9_./-]{0,119}$/.test(path)&&storedPath(value.config,path)===path&&!path.includes('//')&&!path.split('/').some(p=>p==='.'||p==='..'),'github_mapping','Use an exact public site path without personal segments.');insist(/^[A-Za-z0-9_][A-Za-z0-9_./-]{0,239}$/.test(file)&&!file.split('/').some(p=>p==='.'||p==='..')&&!file.includes('//'),'github_mapping','Use a relative repository template file path.');return {path,file}})
 insist(new Set(mappings.map(m=>m.path)).size===mappings.length,'github_mapping','Map each site path once.')
 const generation=uid(),c:Connection={active:0,site_id:value.id,generation,repository,base_branch:branch,mappings_json:JSON.stringify(mappings),sealed_token:'',last_head:null,created_by:actor.id,created_at:clock()}
 const sealed=await seal(env,PURPOSE,value.id+':'+generation,token)
 await atomic(env,actor,[statement(env,'INSERT INTO vane_instrumentation_github(site_id,generation,active,repository,base_branch,mappings_json,sealed_token,last_head,created_by,created_at) VALUES(?,?,0,?,?,?,?,NULL,?,?) ON CONFLICT(site_id) DO UPDATE SET generation=excluded.generation,active=0,repository=excluded.repository,base_branch=excluded.base_branch,mappings_json=excluded.mappings_json,sealed_token=excluded.sealed_token,last_head=NULL,created_by=excluded.created_by,created_at=excluded.created_at',value.id,generation,repository,branch,JSON.stringify(mappings),sealed,actor.id,clock()),auditStatement(env,actor.id,'agent.github.begin',value.id,'owner explicitly approved a replacement connection; prior source authority revoked')])
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
 if(c.last_head&&c.last_head!==head){const diff=await call(c,token,repoPath(c)+'/compare/'+c.last_head+'...'+head);insist(Array.isArray(diff.files)&&diff.files.length<300&&(!diff.total_commits||diff.total_commits<=250),'github_diff','The deploy diff is truncated or too large; review it manually.',409)
  for(const f of diff.files)if(mapped.has(f.filename))files.push({file:f.filename,status:['added','modified','removed','renamed'].includes(f.status)?f.status:'changed',scriptRemoved:typeof f.patch==='string'&&f.patch.split('\n').some((line:string)=>line.startsWith('-')&&!line.startsWith('---')&&/<script\b/i.test(line)&&/vane\.js|\/script\.js/.test(line))})
 }
 await live(env,actor,c);return {generation:c.generation,repository:c.repository,branch:c.base_branch,head,previousHead:c.last_head,files}
}
export const githubObservationGuard=(env:Env,siteId:string,o:GitHubObservation)=>statement(env,'INSERT INTO vane_guard(value) SELECT CASE WHEN EXISTS(SELECT 1 FROM vane_instrumentation_github WHERE site_id=? AND generation=? AND active=1) THEN 1 ELSE 0 END',siteId,o.generation)
export const rememberGitHubHead=(env:Env,siteId:string,o:GitHubObservation)=>statement(env,'UPDATE vane_instrumentation_github SET last_head=? WHERE site_id=? AND generation=?',o.head,siteId,o.generation)
export const prepareGitHubDraft=(env:Env,siteId:string,fixId:string,o:GitHubObservation)=>statement(env,"INSERT INTO vane_instrumentation_prs(fix_id,site_id,generation,base_sha,branch,state,created_at,updated_at) VALUES(?,?,?,?,?,'prepared',?,?)",fixId,siteId,o.generation,o.head,'vane/instrumentation-'+fixId,clock(),clock())
export async function githubDrafts(env:Env,actor:Actor,siteId:string){await owner(env,actor,siteId);return rows<any>(env,'SELECT fix_id,branch,state,candidate_sha,pr_url,pr_number FROM vane_instrumentation_prs WHERE site_id=? ORDER BY created_at DESC LIMIT 10',siteId)}
function prUrl(c:Connection,p:any){const expected=`https://github.com/${c.repository}/pull/${p.number}`;insist(Number.isSafeInteger(p.number)&&p.number>0&&p.html_url===expected,'github_pr','GitHub did not return the expected repository PR URL.',502);return expected}
export async function publishGitHubDraft(env:Env,actor:Actor,p:any) {
 const value=await owner(env,actor,String(p.siteId??''));insist(p.confirm==='on','github_publish','Explicitly approve opening this draft PR.')
 const c=await connection(env,value.id);insist(c?.active===1,'github_connection','Connect the repository first.',409)
 const fix=(await rows<any>(env,'SELECT * FROM vane_instrumentation_fixes WHERE id=? AND site_id=?',String(p.fixId??''),value.id))[0],draft=(await rows<any>(env,'SELECT * FROM vane_instrumentation_prs WHERE fix_id=? AND site_id=?',String(p.fixId??''),value.id))[0]
 insist(fix&&draft&&draft.generation===c.generation,'github_draft','Prepare a fix against this current repository connection.',409)
 const proposal=(await rows<any>(env,"SELECT * FROM vane_proposals WHERE id=? AND state='approved'",fix.proposal_id))[0]
 insist(proposal&&JSON.parse(proposal.payload_json).version+1===value.version,'approval','The owner must approve this version-bound fix before opening a PR; stale settings require a new investigation.',409)
 if(draft.state==='published')return {state:'published',url:draft.pr_url,head:draft.candidate_sha}
 const token=await tokenOf(env,c),marker='Vane instrumentation fix '+fix.id,stamp=await agentHistoryStamp(env,value.id)
 const ensure=async()=>{await live(env,actor,c);const current=await site(env,value.id);insist(current.version===value.version&&await agentHistoryStamp(env,value.id)===stamp&&(await rows(env,'SELECT 1 FROM vane_instrumentation_fixes WHERE id=?',fix.id)).length,'github_stale','The fix was erased or settings changed; no further external write is allowed.',409)}
 const record=async(pr:any)=>{const url=prUrl(c,pr);insist(pr.head?.sha===draft.candidate_sha,'github_pr','The draft PR does not point to this fix’s candidate SHA.',409);await ensure();await atomic(env,actor,[statement(env,"UPDATE vane_instrumentation_prs SET state='published',pr_url=?,pr_number=?,updated_at=? WHERE fix_id=? AND generation=?",url,pr.number,clock(),fix.id,c.generation),auditStatement(env,actor.id,'agent.github.pr',value.id,`${fix.id}: draft PR ${pr.number}; source ${draft.candidate_sha}`)]);return {state:'published',url,head:draft.candidate_sha}}
 // A lost provider response is reconciled read-only. Never replay an uncertain mutation or create another branch.
 if(draft.state!=='prepared'){
  await ensure();const list=await call(c,token,repoPath(c)+'/pulls?'+new URLSearchParams({state:'all',head:c.repository.split('/')[0]+':'+draft.branch,base:c.base_branch}));insist(Array.isArray(list),'github_pr','GitHub did not return a draft list.',502)
  const found=list.find(pr=>pr.head?.sha===draft.candidate_sha&&pr.body?.includes(marker));return found?record(found):{state:'uncertain',message:'No matching PR is confirmed. Inspect the source repository; this attempt will not replay a write.'}
 }
 const claimed=await statement(env,"UPDATE vane_instrumentation_prs SET state='sending',updated_at=? WHERE fix_id=? AND state='prepared'",clock(),fix.id).run();insist(claimed.meta.changes===1,'github_busy','This draft is already being sent; reconcile its outcome instead.',409)
 try {
  await ensure();const ref=await call(c,token,branchPath(c));insist(ref.object?.sha===draft.base_sha,'github_stale','The source branch moved. Investigate and approve a new fix; nothing will be force-updated.',409)
  const changes=JSON.parse(fix.draft_json).changes as {page:string;before:string;after:string}[],mappings=JSON.parse(c.mappings_json) as Mapping[],files=[...new Set(changes.filter(x=>x.before==='No matching native script').map(x=>mappings.find(m=>m.path===x.page)?.file).filter(Boolean))] as string[]
  insist(files.length>0&&files.every(f=>/\.html?$/i.test(f)),'github_template','Map the missing-script pages to HTML templates. Other source languages require manual completion.',409)
  await ensure();const commit=await call(c,token,repoPath(c)+'/git/commits/'+draft.base_sha);insist(sha(commit.tree?.sha),'github_tree','GitHub did not return the source tree.',502)
  await ensure();const baseTree=await call(c,token,repoPath(c)+'/git/trees/'+commit.tree.sha+'?recursive=1');insist(baseTree.truncated===false&&Array.isArray(baseTree.tree),'github_tree','The source tree is truncated; complete the PR manually.',409)
  const tree=[],scriptUrls=await nativeScriptUrls(env,value)
  for(const file of files){await ensure();const content=await call(c,token,repoPath(c)+'/contents/'+file.split('/').map(encodeURIComponent).join('/')+'?ref='+draft.base_sha);insist(content.type==='file'&&content.encoding==='base64'&&typeof content.content==='string'&&content.size<=500_000,'github_file','Use a regular HTML template no larger than 500 KB.',409)
   const entry=baseTree.tree.find((e:any)=>e.path===file);insist(entry?.type==='blob'&&['100644','100755'].includes(entry.mode)&&entry.sha===content.sha,'github_file','The mapped file must be a regular blob at the approved source SHA.',409)
   let html:string;try{const bytes=Uint8Array.from(atob(content.content.replace(/\s/g,'')),c=>c.charCodeAt(0));insist(bytes.length<=500_000,'github_file','Use a template no larger than 500 KB.',409);html=new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(bytes)}catch{throw new VaneError('github_file','The template encoding could not be read.',502)}
   const snippet=`<script defer src="${new URL('/vane.js',env.AUTH_ORIGIN).href}" data-site="${value.id}"></script>`
   insist((await inspectPage(html,value,scriptUrls)).scripts===0,'github_no_change','The mapped source already has this script; investigate the deployed difference manually.',409)
   const at=html.search(/<\/head\s*>/i);insist(at>=0,'github_template','An HTML head closing tag is required for this bounded script-only edit.',409)
   tree.push({path:file,mode:entry.mode,type:'blob',content:html.slice(0,at)+snippet+'\n'+html.slice(at)})
  }
  await ensure();const stillCurrent=await call(c,token,branchPath(c));insist(stillCurrent.object?.sha===draft.base_sha,'github_stale','The source branch moved while its templates were read. No source write was made.',409)
  await ensure();const createdTree=await call(c,token,repoPath(c)+'/git/trees','POST',{base_tree:commit.tree.sha,tree});insist(sha(createdTree.sha),'github_tree','GitHub did not return a candidate tree.',502)
  await ensure();const createdCommit=await call(c,token,repoPath(c)+'/git/commits','POST',{message:marker,tree:createdTree.sha,parents:[draft.base_sha]});insist(sha(createdCommit.sha),'github_commit','GitHub did not return a candidate commit.',502)
  draft.candidate_sha=createdCommit.sha;await statement(env,'UPDATE vane_instrumentation_prs SET candidate_sha=?,updated_at=? WHERE fix_id=? AND generation=?',draft.candidate_sha,clock(),fix.id,c.generation).run()
  await ensure();await call(c,token,repoPath(c)+'/git/refs','POST',{ref:'refs/heads/'+draft.branch,sha:draft.candidate_sha})
  await ensure();const pr=await call(c,token,repoPath(c)+'/pulls','POST',{title:'Repair analytics instrumentation',head:draft.branch,base:c.base_branch,draft:true,body:marker+'\n\nOwner-approved script-only repair in the explicitly mapped HTML templates. The associated no-code selector change uses Vane’s normal owner approval. No metric, consent rule, identifier or collected field is widened. Review and deploy through your own repository workflow; Vane never merges or deploys this PR.'})
  insist(pr.draft===true,'github_pr','GitHub did not confirm a draft PR; reconcile the provider outcome.',502)
  return await record(pr)
 } catch(error){await statement(env,"UPDATE vane_instrumentation_prs SET state='uncertain',updated_at=? WHERE fix_id=? AND state='sending'",clock(),fix.id).run();throw error instanceof VaneError?error:new VaneError('github_unknown','The provider outcome is uncertain. Reconcile this draft; no mutation will be replayed automatically.',502)}
}

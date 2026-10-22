import { digest, insist, type Env, type Site } from '../core'
import { inspectPage, nativeScriptUrls } from './page'

export interface Mapping {path:string;file:string}
export type SourceCall=(path:string)=>Promise<any>
interface SourceFile {sha:string;html:string}
export interface SourceEdit {path:string;mode:string;type:'blob';content:string}
export interface SourcePlan {tree:SourceEdit[];diffHash:string;files:string[]}

// Refuse sensitive and operational paths before any source request, including when a
// directory happens to contain an HTML template. The owner must change these by hand.
export function templatePath(file:string) {
 const parts=file.toLowerCase().split('/'),name=parts.at(-1)??''
 const sensitive=parts.some(p=>/^(?:\.env(?:[.-].*)?|\.git|\.github|\.gitlab|\.circleci|\.ssh|\.aws|\.config|ci|workflows?|deploy(?:ment)?|infrastructure|terraform|secrets?|credentials?|keys?|certs?|certificates?)$/.test(p)||/(?:^|[._-])(?:secrets?|credentials?|keys?|private[-_]?key|api[-_]?key)(?:[._-]|$)/.test(p))
 const operational=/^(?:package(?:-lock)?\.json|pnpm-lock\.yaml|yarn\.lock|bun\.lockb?|deno\.jsonc?|composer\.(?:json|lock)|gemfile(?:\.lock)?|cargo\.(?:toml|lock)|go\.(?:mod|sum)|pyproject\.toml|requirements.*|pipfile.*|poetry\.lock|dockerfile.*|docker-compose.*|compose\.ya?ml|wrangler.*|netlify\.toml|vercel\.json|jenkinsfile.*|\.travis\.yml|id_(?:rsa|dsa|ecdsa|ed25519))$/.test(name)||/\.(?:key|pem|p12|pfx|crt|cer|jks|keystore)$/.test(name)
 insist(!sensitive&&!operational&&/\.html?$/i.test(file),'github_template','Owner must change CI/workflow, deploy, dependency, secret-bearing and non-HTML paths by hand; they cannot enter an agent PR.',409)
}

interface SourceTree {sha:string;tree:{path:string;sha:string;type:string;mode:string}[]}
export async function sourceTree(call:SourceCall,root:string,head:string):Promise<SourceTree> {
 const commit=await call(root+'/git/commits/'+head)
 insist(/^[a-f0-9]{40}$/.test(commit.tree?.sha),'github_tree','GitHub did not return the source tree.',502)
 const tree=await call(root+'/git/trees/'+commit.tree.sha+'?recursive=1')
 insist(tree.truncated===false&&Array.isArray(tree.tree),'github_tree','The source tree is truncated; complete the PR manually.',409)
 return {sha:commit.tree.sha,tree:tree.tree}
}
export async function sourceFile(call:SourceCall,root:string,file:string,tree:SourceTree):Promise<SourceFile|null> {
 templatePath(file)
 const entry=tree.tree.find(e=>e.path===file)
 if(!entry)return null
 // Check mode BEFORE reading bytes. The Contents API resolves an HTML symlink
 // to its target, which could be an unmapped .env or key file.
 insist(entry.type==='blob'&&['100644','100755'].includes(entry.mode)&&/^[a-f0-9]{40}$/.test(entry.sha),'github_file','The mapped template must be a regular file, never a symlink or submodule.',409)
 const content=await call(root+'/git/blobs/'+entry.sha)
 insist(content.encoding==='base64'&&typeof content.content==='string'&&content.size<=500_000&&content.sha===entry.sha,'github_file','Use a regular UTF-8 HTML template no larger than 500 KB.',409)
 const bytes=Uint8Array.from(atob(content.content.replace(/\s/g,'')),c=>c.charCodeAt(0))
 insist(bytes.length<=500_000,'github_file','Use a template no larger than 500 KB.',409)
 let html:string
 try{html=new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(bytes)}catch{insist(false,'github_file','The template encoding could not be read.',502)}
 return {sha:content.sha,html}
}

export async function sourcePlan(env:Env,value:Site,call:SourceCall,root:string,head:string,mappings:Mapping[],changes:{page:string;before:string;after:string}[]):Promise<SourcePlan> {
 const files=[...new Set(changes.filter(x=>x.before==='No matching native script').map(x=>mappings.find(m=>m.path===x.page)?.file).filter((f):f is string=>Boolean(f)))].sort()
 insist(files.length>0,'github_template','Map missing-script pages to safe HTML templates; the owner must complete other source changes by hand.',409)
 files.forEach(templatePath)
 const baseTree=await sourceTree(call,root,head)
 const tree:SourceEdit[]=[],bindings:unknown[]=[],scriptUrls=await nativeScriptUrls(env,value)
 for(const file of files){
  const source=await sourceFile(call,root,file,baseTree),entry=baseTree.tree.find((e:any)=>e.path===file)
  insist(source&&entry?.type==='blob'&&['100644','100755'].includes(entry.mode)&&entry.sha===source.sha,'github_file','The mapped file must be a regular blob at the approved source SHA.',409)
  insist((await inspectPage(source.html,value,scriptUrls)).scripts===0,'github_no_change','The mapped source already has this script; investigate the deployed difference manually.',409)
  const at=source.html.search(/<\/head\s*>/i)
  insist(at>=0,'github_template','An HTML head closing tag is required for this bounded script-only edit.',409)
  const snippet=`<script defer src="${new URL('/vane.js',env.AUTH_ORIGIN).href}" data-site="${value.id}"></script>`
  const content=source.html.slice(0,at)+snippet+'\n'+source.html.slice(at)
  tree.push({path:file,mode:entry.mode,type:'blob',content})
  bindings.push({path:file,mode:entry.mode,before:source.sha,after:await digest(content)})
 }
 // Bind both the exact source edit and the no-code diff. Persist only hashes and paths.
 return {tree,files,diffHash:await digest(JSON.stringify({head,bindings,changes}))}
}

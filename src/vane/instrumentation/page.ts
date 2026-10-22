import { rows, type Env, type Site } from '../core'
import type { EventDefinition } from '../event-definitions'
import { redactPath } from '../paths'
export interface NativePage {
 scripts:number
 selectors:(EventDefinition&{matches:number|null})[]
 controls:{tag:string;ordinal:number;selector:string}[]
}
// Keep structural evidence only: no page body, element text, input value, link destination or script contents.
// Candidate IDs contain words only; identifier-looking values never become a suggested selector.
export async function nativeScriptUrls(env:Env,value:Site):Promise<string[]> {
 const connections=await rows<{hostname:string;public_prefix:string}>(env,'SELECT hostname,public_prefix FROM vane_proxy_connections WHERE site_id=? AND revoked_at IS NULL',value.id)
 return [new URL('/vane.js',env.AUTH_ORIGIN).href,...connections.map(c=>`https://${c.hostname}${c.public_prefix}/script.js`)]
}
export async function inspectPage(html:string,value:Site,scriptUrls:string[]):Promise<NativePage> {
 const native:NativePage={scripts:0,selectors:[],controls:[]},counts=new Map<string,number>()
 const output=new HTMLRewriter().on('script[src]',{element(el){
  try {const u=new URL(el.getAttribute('src')!,value.origin)
   if(!u.username&&!u.password&&scriptUrls.includes(u.origin+u.pathname)&&el.getAttribute('data-site')===value.id)native.scripts++
  } catch {}
 }}).on('button,form,a[id],input[type="submit"]',{element(el){
  const ordinal=counts.get(el.tagName)??0;counts.set(el.tagName,ordinal+1)
  const id=el.getAttribute('id')??''
  if(native.controls.length<40&&/^[A-Za-z][A-Za-z_-]{0,59}$/.test(id)&&redactPath('/'+id)==='/'+id)native.controls.push({tag:el.tagName,ordinal,selector:'#'+id})
 }}).transform(new Response(html,{headers:{'content-type':'text/html'}}))
 await output.arrayBuffer()
 for(const d of value.config.eventDefinitions??[]) {
  if(d.kind==='pageview')continue
  let matches=0
  try {await new HTMLRewriter().on(d.target,{element(){matches++}}).transform(new Response(html,{headers:{'content-type':'text/html'}})).arrayBuffer();native.selectors.push({...d,matches})}
  catch {native.selectors.push({...d,matches:null})}
 }
 return native
}

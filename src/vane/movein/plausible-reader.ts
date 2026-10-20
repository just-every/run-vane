import { inScope, insist, role, site, type Actor, type Env } from '../core'
import { localDate } from '../annotations'


// Tokens exist only during this read. Redirects are refused so credentials cannot follow them.
export async function readPlausible(env:Env,actor:Actor,p:any) {
 role(actor);inScope(actor,String(p.siteId));await site(env,String(p.siteId));
 insist(p.endpoint===undefined||p.endpoint==='https://plausible.io'||p.endpoint==='https://plausible.io/','plausible_endpoint','Read definitions only from the fixed official Plausible endpoint.');const endpoint=new URL('https://plausible.io');
 const token=String(p.token??''),sourceSite=String(p.sourceSite??''),day=localDate(p.day),keyType=p.keyType;
 insist(token.length>=8&&token.length<=512&&!/\s/.test(token),'plausible_token','Enter a Plausible key; it is used once and never saved.');
 insist(sourceSite.length>0&&sourceSite.length<=253&&!/[\s<>@]/.test(sourceSite),'plausible_site','Enter the site ID shown in Plausible.');
 insist(keyType==='stats'||keyType==='enterprise','plausible_key','Choose a Stats API or Enterprise Sites API key.');
 let budget=0;
 async function read(path:string,body?:unknown) {
  const url=new URL(path,endpoint);let response:Response;
  try{response=await fetch(url,{method:body?'POST':'GET',redirect:'manual',headers:{authorization:`Bearer ${token}`,...(body?{'content-type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(20000)})}catch{insist(false,'plausible_read','Plausible could not be reached. No credentials were saved.',502)}
  insist(response.ok,'plausible_read','Plausible refused the read. Check the site, key and plan; no definitions were imported.',502);
  const reader=response.body?.getReader(),chunks:Uint8Array[]=[];let size=0;if(reader)while(true){const r=await reader.read();if(r.done)break;size+=r.value.length;budget+=r.value.length;if(budget>2_000_000){await reader.cancel();insist(false,'plausible_size','Plausible returned more than 2 MB; choose a smaller source.',413)}chunks.push(r.value)}
  const bytes=new Uint8Array(size);let offset=0;for(const c of chunks){bytes.set(c,offset);offset+=c.length}let result:any;try{result=JSON.parse(new TextDecoder().decode(bytes))}catch{insist(false,'plausible_read','Plausible did not return JSON.',502)}return result
 }
 async function list(path:string,key:string) {
  const items:any[]=[],cursors=new Set<string>();let after:string|null=null;
  do{const query=new URLSearchParams({site_id:sourceSite,limit:'100',...(after?{after}:{})}),result=await read(`${path}?${query}`);insist(Array.isArray(result[key]),'plausible_read','Plausible did not return the requested definitions.',502);items.push(...result[key]);insist(items.length<=500,'plausible_size','Read at most 500 definitions per import.');const next=result.meta?.after??null;insist(next===null||typeof next==='string'&&next.length<=1024&&!cursors.has(next),'plausible_pagination','Plausible returned invalid pagination.',502);if(next)cursors.add(next);after=next}while(after);return {[key]:items}
 }
 const [goals,properties,revenue]=await Promise.all([list('/api/v1/sites/goals','goals'),list('/api/v1/sites/custom-props','custom_properties'),read('/api/v2/query',{site_id:sourceSite,date_range:'all',metrics:['total_revenue'],dimensions:['event:goal'],pagination:{limit:10000,offset:0}})]);
 return {format:'vane-plausible-api/1',day,keyType,goals,properties,revenue}
}

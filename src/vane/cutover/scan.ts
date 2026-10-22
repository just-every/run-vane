import { allow, inScope, insist, rows, site, uid, type Actor, type Env } from '../core'
import { clock } from '../clock'
import { auditStatement } from '../audit'
import { findings, type Finding } from './findings'
import { robots } from './robots'
export interface ScanPage {url:string;at:number;findings:Finding[];status?:number;native?:import('../instrumentation/page').NativePage}
export interface Scan {id:string;site_id:string;actor_id:string;at:number;page_limit:number;fetched:number;refused:number;state:string;pages:ScanPage[]}
export async function scans(env:Env,actor:Actor,siteId:string):Promise<Scan[]> {
 allow(actor,'viewer');inScope(actor,siteId);
 return (await rows<any>(env,'SELECT * FROM vane_cutover_scans WHERE site_id=? ORDER BY at DESC,id LIMIT 20',siteId)).map(({findings_json,...scan})=>({...scan,pages:JSON.parse(findings_json)}));
}
const locations=(xml:string)=>[...xml.matchAll(/<loc\b[^>]*>\s*(?:<!\[CDATA\[([\s\S]*?)\]\]>|([^<]*))\s*<\/loc>/gi)].map(m=>(m[1]??m[2]??'').trim().replace(/&amp;/g,'&').replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&quot;/g,'"').replace(/&apos;/g,"'"));
async function body(response:Response) {
 const reader=response.body?.getReader();if(!reader)return '';const parts:Uint8Array[]=[];let size=0;
 try{for(;;){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>2_000_000)throw Error('Response exceeds scan capacity');parts.push(value)}}finally{await reader.cancel()}
 const bytes=new Uint8Array(size);let offset=0;for(const part of parts){bytes.set(part,offset);offset+=part.length}return new TextDecoder().decode(bytes);
}
export async function scan(env:Env,actor:Actor,input:{siteId:string,pageLimit:unknown},inspect?:(html:string)=>Promise<import('../instrumentation/page').NativePage>):Promise<Scan> {
 allow(actor,'admin');inScope(actor,input.siteId);const current=await site(env,input.siteId),limit=Number(input.pageLimit);
 insist(Number.isInteger(limit)&&limit>=1&&limit<=500,'scan_limit','Choose a page limit from 1 to 500.');
 const result:Scan={id:uid(),site_id:current.id,actor_id:actor.id,at:clock(),page_limit:limit,fetched:0,refused:0,state:'running',pages:[]};
 await env.DB.prepare("INSERT INTO vane_cutover_scans(id,site_id,actor_id,at,page_limit,fetched,refused,state,findings_json) VALUES(?,?,?,?,?,0,0,'running','[]')").bind(result.id,current.id,actor.id,result.at,limit).run();
 const origin=new URL(current.origin).origin,valid=(raw:string,base=origin)=>{try{const u=new URL(raw,base);return u.origin===origin&&!u.username&&!u.password&&['http:','https:'].includes(u.protocol)?u:null}catch{return null}};
 let policy=robots('');
 const load=async(url:URL,check=true):Promise<Response>=>{
  if(check&&!policy.allows(url))throw Error('Robots refusal');
  // No browser cookies, authorization, body or redirect credentials are forwarded.
  const r=await fetch(url.href,{redirect:'manual',credentials:'omit',headers:{accept:'text/html, application/xml, text/plain','user-agent':'Vane'},signal:AbortSignal.timeout(10000)});
  if(r.status>=300&&r.status<400){await r.body?.cancel();throw Error('Redirect refused')}
  return r;
 };
 try {
  const robotsResponse=await load(new URL('/robots.txt',origin),false);
  if(robotsResponse.status!==404&&!robotsResponse.ok)throw Error('Robots unavailable');
  policy=robots(robotsResponse.status===404?'':await body(robotsResponse));
  const queue=policy.sitemaps.length?[...policy.sitemaps]:[origin+'/sitemap.xml'],seenMaps=new Set<string>(),seenPages=new Set<string>();
  const script=`<script defer src="${new URL('/vane.js',env.AUTH_ORIGIN).href}" data-site="${current.id}"></script>`;
  for(let index=0;index<queue.length&&seenMaps.size<30;index++) {
   const map=valid(queue[index]!);if(!map){result.refused++;continue}if(seenMaps.has(map.href))continue;seenMaps.add(map.href);
   let xml:string;try{const r=await load(map);if(!r.ok)throw Error('Sitemap unavailable');xml=await body(r)}catch{result.refused++;continue}
   if(/<sitemapindex\b/i.test(xml)){queue.push(...locations(xml));continue}
   if(!/<urlset\b/i.test(xml)){result.refused++;continue}
   for(const raw of locations(xml)) {
    const url=valid(raw,map.href);if(!url){result.refused++;continue}url.hash='';if(seenPages.has(url.href))continue;seenPages.add(url.href);
    if(result.fetched>=limit||!policy.allows(url)){result.refused++;continue}
    result.fetched++;
    try{const r=await load(url);if(!r.ok){await r.body?.cancel();result.refused++;if(inspect)result.pages.push({url:url.href,at:clock(),status:r.status,findings:[]});continue}const html=await body(r);result.pages.push({url:url.href,at:clock(),findings:findings(html,script,current.config.currency??'USD'),...(inspect?{native:await inspect(html)}:{})})}catch{result.refused++}
   }
  }
  result.state='complete';
 } catch {result.refused++;result.state='failed'}
 await env.DB.batch([env.DB.prepare('UPDATE vane_cutover_scans SET fetched=?,refused=?,state=?,findings_json=? WHERE id=?').bind(result.fetched,result.refused,result.state,JSON.stringify(result.pages),result.id),auditStatement(env,actor.id,'install.scan',current.id,`${result.id}: ${result.fetched} pages fetched, ${result.refused} refused`)]);
 return result;
}

import { insist, role, site, VaneError, type Actor, type Env } from './core'
import { eventName } from './properties'
// CONV-009: no-code events, defined in the app as part of the site's settings (so APPROVE-001 applies: administrators
// prepare, the owner approves) and served to the script with its configuration. Each fires the named custom event
// (CONV-002) on the current page load: click (a click on or inside an element matching the CSS selector), submit (a
// form matching it is submitted), visible (a matching element first becomes at least half visible, once per element
// per pageview) or pageview (a pageview, automatic or SPA, whose path matches the pattern with the goal wildcards).
export const DEFINITION_KINDS=['click','submit','visible','pageview'] as const
export interface EventDefinition { name:string; kind:typeof DEFINITION_KINDS[number]; target:string }
const SELECTOR=/^[A-Za-z0-9_\-#.\[\]="':>+~*()^$|, ]{1,200}$/
export function cleanSelector(input:unknown):string {
 const selector=String(input??'').trim();
 insist(SELECTOR.test(selector),'selector','Write a CSS selector such as #book-demo or form.contact, up to 200 characters.');
 return selector;
}
// One per line, name = kind target: Book demo = click #book-demo, Lead = submit form.contact,
// Pricing seen = visible #pricing-table, Docs = pageview /docs/**. At most 20.
export function cleanEventDefinitions(input:unknown):EventDefinition[] {
 const list:EventDefinition[]=(Array.isArray(input)?input.map((d:any)=>({name:d?.name,kind:d?.kind,target:d?.target})):String(input??'').split('\n').map(l=>l.trim()).filter(Boolean).map(line=>{const m=line.match(/^(.*\S)\s*=\s*(click|submit|visible|pageview)\s+(.+)$/);return {name:m?.[1]??'',kind:m?.[2]??'',target:m?.[3]??''} as any}))
 insist(list.length<=20,'event_definitions','Define at most 20 no-code events.');
 return list.map(d=>{
  insist((DEFINITION_KINDS as readonly string[]).includes(d.kind),'event_definitions','Write each no-code event as Book demo = click #book-demo, with click, submit, visible or pageview.');
  const name=eventName(d.name);
  const target=d.kind==='pageview'?String(d.target??'').trim():cleanSelector(d.target);
  if(d.kind==='pageview')insist(/^\/[A-Za-z0-9_\-/*.:]{0,119}$/.test(target),'event_definitions','A pageview event takes a path or pattern such as /docs/**.');
  return {name,kind:d.kind,target};
 });
}
// The preview loads one page of the site from its registered origins (redirects must stay on them; 10 seconds, the
// first 2 MB), with no cookie or visitor data, runs the selector over it and returns the match count and the first
// three matched elements' tag, id, classes and first 80 characters of text. Nothing is stored.
export interface Preview { selector:string; url:string; total:number; matched:{tag:string,id:string|null,classes:string|null,text:string}[] }
export async function previewSelector(env:Env,actor:Actor,input:any):Promise<Preview> {
 role(actor,['owner','admin']);
 const value=await site(env,String(input.siteId)),selector=cleanSelector(input.selector),path=String(input.path||'/').trim(),origins=[value.origin,...(value.config.origins??[])];
 insist(/^\/[^\s#]{0,500}$/.test(path),'path','Preview a page by its path, such as /pricing.');
 let url=new URL(path,value.origin),response:Response|undefined;
 for(let hop=0;hop<=5;hop++){
  response=await fetch(url,{redirect:'manual',headers:{accept:'text/html','user-agent':'Vane event preview'},signal:AbortSignal.timeout(10000)}).catch(()=>{throw new VaneError('unreachable',`The page ${url.href} could not be loaded.`,502)});
  const next=response.headers.get('location');
  if(response.status>=300&&response.status<400&&next){url=new URL(next,url);insist(origins.includes(url.origin),'redirect','The page redirects off the site’s registered origins.',502);continue}
  break;
 }
 insist(response&&response.ok,'unreachable',`The page ${url.href} answered ${response?.status}.`,502);
 const bytes=new Uint8Array(await response.arrayBuffer()).slice(0,2_000_000);
 const matched:Preview['matched']=[];let total=0,open:Preview['matched'][number]|null=null;
 try {
  await new HTMLRewriter().on(selector,{element(el){total++;open=null;if(matched.length<3){open={tag:el.tagName,id:el.getAttribute('id'),classes:el.getAttribute('class'),text:''};matched.push(open)}},text(chunk){if(open&&open.text.length<80)open.text=(open.text+chunk.text).replace(/\s+/g,' ').trimStart().slice(0,80)}}).transform(new Response(bytes,{headers:{'content-type':'text/html'}})).arrayBuffer();
 } catch { throw new VaneError('selector','The page could not be matched against this selector; check its syntax.') }
 for(const m of matched)m.text=m.text.trim();
 return {selector,url:url.href,total,matched};
}

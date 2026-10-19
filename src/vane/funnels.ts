import { insist, type Env } from './core'
import { timedFrom } from './visits'
import { goalApplies } from './goals'
// CONV-005: funnels of 2 to 8 ordered steps within one visit. A step is a page path or pattern with the goals' meaning
// (* within one segment, ** across them, optionally hostname-scoped), goal:<name> (a page load that reached that
// goal) or event:<name>, optionally with one property condition as event:<name>[key=value] (CONV-002). A visit enters at its first page load matching step 1 and reaches step k at its first later page load
// matching step k. Each step shows the visits reaching it, the share of entrants, the share of the step before, the
// drop-off (visits that reached it but not the next step) and the median time from the step before, in seconds.
export interface Funnel { name:string; steps:string[] }
const STEP=/^(?:goal:[a-z][a-z0-9-]{0,39}|event:[A-Za-z0-9 _.-]{1,60}(?:\[[a-z0-9_-]{1,40}=[^\]\n>]{1,100}\])?|(?:[a-z0-9-]+(?:\.[a-z0-9-]+)+)?\/[a-z0-9_\-/*.:]{0,119})$/
export function cleanFunnels(input:unknown,goals:string[]):Funnel[] {
 const list=Array.isArray(input)?input.map((f:any)=>({name:String(f?.name??''),steps:Array.isArray(f?.steps)?f.steps.map(String):[]})):String(input??'').split('\n').map(l=>l.trim()).filter(Boolean).map(line=>{const at=line.indexOf('=');return {name:at>0?line.slice(0,at).trim():'',steps:line.slice(at+1).split('>').map(s=>s.trim()).filter(Boolean)}})
 insist(list.length<=10&&new Set(list.map(f=>f.name)).size===list.length&&list.every(f=>/^[a-z][a-z0-9-]{0,39}$/.test(f.name)&&f.steps.length>=2&&f.steps.length<=8&&f.steps.every((s:string)=>STEP.test(s)&&(!s.startsWith('goal:')||goals.includes(s.slice(5))))),'funnels','Write each funnel as checkout=/product/* > /cart > /checkout > goal:purchase: 2 to 8 steps, each a page path or pattern, goal:<goal name> or event:<event name>, optionally event:<event name>[property=value]; at most 10 funnels.')
 return list
}
interface Load { key:string; at:number; path:string; hostname:string|null; goals:string[]; custom:{name:string,props:Record<string,string>}[] }
// CONV-002: event:Signup is a page load with that custom event, and event:Signup[plan=pro] one whose Signup has plan=pro.
// An event happens on a page, so an event step may be reached on the page load of the step before it.
const eventStep=(step:string)=>{const m=step.match(/^event:([^[]+)(?:\[([^=]+)=(.*)\])?$/)!;return {name:m[1]!.trim(),key:m[2],value:m[3]}}
const matches=(step:string,load:Load)=>{if(step.startsWith('event:')){const e=eventStep(step);return load.custom.some(c=>c.name===e.name&&(e.key===undefined||c.props[e.key]===e.value))}return step.startsWith('goal:')?load.goals.includes(step.slice(5)):goalApplies(step,load.hostname,load.path)}
const median=(xs:number[])=>{if(!xs.length)return null;const s=[...xs].sort((a,b)=>a-b),m=s.length>>1;return Math.round((s.length%2?s[m]!:(s[m-1]!+s[m]!)/2)/1000)}
const share=(part:number,whole:number)=>whole?Math.round(part/whole*1000)/10:null
async function visits(env:Env,scope:string,from:string,to:string,events:string):Promise<Load[][]> {
 const result=await env.DB.prepare(`${timedFrom(events)} SELECT q.day||' '||q.visitor||' '||q.visit AS key,q.at,q.path,q.hostname,(SELECT group_concat(substr(c.id,length(q.id)+2),char(31)) FROM ${events} c WHERE c.id>q.id||':' AND c.id<q.id||';') AS goals,(SELECT json_group_array(json_object('name',ce.name,'props',json((SELECT json_group_object(pr.key,pr.value) FROM vane_event_props pr WHERE pr.event_id=ce.id)))) FROM vane_custom_events ce WHERE ce.page_id=q.id) AS custom FROM q ORDER BY q.day,q.visitor,q.visit,q.at,q.id`).bind(scope,from,to,null).all<any>()
 const by=new Map<string,Load[]>();for(const r of result.results)(by.get(r.key)??by.set(r.key,[]).get(r.key)!).push({key:r.key,at:Number(r.at),path:r.path,hostname:r.hostname,goals:r.goals?String(r.goals).split('\u001f'):[],custom:JSON.parse(r.custom??'[]')})
 return [...by.values()]
}
function walk(funnel:Funnel,all:Load[][]) {
 const reached=funnel.steps.map(()=>0),gaps:number[][]=funnel.steps.map(()=>[]),pages=funnel.steps.map(()=>new Map<string,number>())
 for(const loads of all){let index=-1,previous=0;for(const [k,step] of funnel.steps.entries()){const i=loads.findIndex((load,j)=>(j>index||step.startsWith('event:')&&k>0&&j===index)&&matches(step,load));if(i<0)break;reached[k]!++;if(k)gaps[k]!.push(loads[i]!.at-previous);pages[k]!.set(loads[i]!.path,(pages[k]!.get(loads[i]!.path)??0)+1);index=i;previous=loads[i]!.at}}
 return {reached,gaps,pages}
}
export async function funnelReport(env:Env,scope:string,range:{from:string,to:string},compared:{from:string,to:string},events:string,funnels:Funnel[]) {
 if(!funnels.length)return []
 const [now,then]=await Promise.all([visits(env,scope,range.from,range.to,events),visits(env,scope,compared.from,compared.to,events)])
 return funnels.map(funnel=>{const a=walk(funnel,now),b=walk(funnel,then);return {name:funnel.name,entrants:a.reached[0]!,steps:funnel.steps.map((step,k)=>({step:k+1,label:step,visits:a.reached[k]!,previous:b.reached[k]!,conversionRate:share(a.reached[k]!,a.reached[0]!),stepRate:k?share(a.reached[k]!,a.reached[k-1]!):null,dropOff:k<funnel.steps.length-1?a.reached[k]!-a.reached[k+1]!:null,medianSeconds:k?median(a.gaps[k]!):null,journey:[...a.pages[k]!.entries()].sort((x,y)=>y[1]-x[1]||x[0].localeCompare(y[0]))[0]?.[0]??null}))}})
}

import type { Env } from './core'
import { timedFrom } from './visits'
export interface FunnelLoad {key:string;at:number;path:string;hostname:string|null;goals:string[];custom:{name:string,props:Record<string,string>}[];event:boolean}
// Page steps consume actual page loads. A custom event, including a recovered custom-event
// goal, is a separate ordered step on its page; a source display name is never parsed from an ID.
export async function funnelLoads(env:Env,scope:string,from:string,to:string,events:string):Promise<FunnelLoad[][]> {
 const result=await env.DB.prepare(`${timedFrom(events)} SELECT q.day||' '||q.visitor||' '||q.visit AS key,q.at,q.path,q.hostname,
 (SELECT group_concat(c.kind,char(31)) FROM ${events} c WHERE c.id>q.id||':' AND c.id<q.id||';' AND c.id=q.id||':'||c.kind) AS goals,
 (SELECT json_group_array(json_object('name',ce.name,'at',ce.at,'props',json(ce.props),'goals',ce.goals)) FROM (
  SELECT ce.name,ce.at,
   (SELECT json_group_object(pr.key,pr.value) FROM vane_event_props pr WHERE pr.event_id=ce.id) AS props,
   (SELECT group_concat(c.kind,char(31)) FROM ${events} c WHERE c.id>q.id||':'||substr(ce.id,length(q.site_id)+2)||':goal:' AND c.id<q.id||':'||substr(ce.id,length(q.site_id)+2)||':goal;') AS goals
  FROM vane_custom_events ce WHERE ce.page_id=q.id ORDER BY ce.at,ce.rowid
 )) AS custom FROM q ORDER BY q.day,q.visitor,q.visit,q.at,q.id`).bind(scope,from,to,null).all<any>()
 const names=(s:string|null)=>s?s.split('\u001f'):[],by=new Map<string,(FunnelLoad&{pageOrder:number;eventOrder:number})[]>();let pageOrder=0
 for(const r of result.results){
  const group=by.get(r.key)??[];by.set(r.key,group);const base={key:r.key,path:r.path,hostname:r.hostname,pageOrder:pageOrder++}
  group.push({...base,at:Number(r.at),goals:names(r.goals),custom:[],event:false,eventOrder:0})
  for(const [index,event] of (JSON.parse(r.custom??'[]') as any[]).entries())group.push({...base,at:Number(event.at),goals:names(event.goals),custom:[{name:event.name,props:event.props}],event:true,eventOrder:index+1})
 }
 return [...by.values()].map(loads=>loads.sort((a,b)=>a.at-b.at||a.pageOrder-b.pageOrder||a.eventOrder-b.eventOrder))
}

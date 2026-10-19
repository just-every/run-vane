import { insist, type Env } from './core'
import { timedFrom } from './visits'
// DASH-011: the journeys through a page, in aggregate. A visit passes through the page at its first load of that path
// (an entry journey keeps only visits whose first load is the page). Its next three steps are the page loads that
// follow within the visit, ending at (exit), and its previous three are those before it, starting at (entrance).
// Each step is a page load, so a reload counts as a step. Counts are visits; drop-off at a step is the visits that
// left before it. Journeys follow the report's range and hostname filter; segments (DASH-007) join when they ship.
export const JOURNEY_MODES={page:'Through the page',entry:'Entering at the page'} as const
export type JourneyMode=keyof typeof JOURNEY_MODES
const DEPTH=3
export async function journeys(env:Env,scope:string,from:string,to:string,events:string,path:string,mode:JourneyMode) {
 insist(/^\/[^?#\s]{0,1023}$/.test(path),'journey','Choose a page path, such as /pricing.')
 insist(Object.hasOwn(JOURNEY_MODES,mode),'journey','Choose a journey through the page or entering at it.')
 const near=(sign:number)=>Array.from({length:DEPTH},(_,i)=>`LEFT JOIN s ${sign>0?'n':'p'}${i+1} ON ${sign>0?'n':'p'}${i+1}.day=a.day AND ${sign>0?'n':'p'}${i+1}.visitor=a.visitor AND ${sign>0?'n':'p'}${i+1}.visit=a.visit AND ${sign>0?'n':'p'}${i+1}.step=a.anchor${sign>0?'+':'-'}${i+1}`).join(' ')
 const [steps]=await env.DB.batch<any>([env.DB.prepare(`${timedFrom(events)},
s AS (SELECT day,visitor,visit,path,ROW_NUMBER() OVER (PARTITION BY day,visitor,visit ORDER BY at,id) AS step FROM q),
a AS (SELECT day,visitor,visit,MIN(step) AS anchor FROM s WHERE path=?5 GROUP BY day,visitor,visit${mode==='entry'?' HAVING MIN(step)=1':''})
SELECT n1.path AS n1,n2.path AS n2,n3.path AS n3,p1.path AS p1,p2.path AS p2,p3.path AS p3 FROM a ${near(1)} ${near(-1)}`).bind(scope,from,to,null,path)])
 const visits=steps.results as Record<string,string|null>[]
 // A path lists its steps up to the first missing one, which is the visit's exit (or, backwards, its entrance).
 const route=(row:Record<string,string|null>,prefix:string,end:string)=>{const out:string[]=[];for(let i=1;i<=DEPTH;i++){const p=row[prefix+i];if(p===null||p===undefined){out.push(end);break}out.push(p)}return out}
 const tally=(prefix:string,end:string)=>{const counts=new Map<string,{steps:string[],visits:number}>();for(const row of visits){const steps=route(row,prefix,end),key=steps.join('\u0000');counts.set(key,{steps,visits:(counts.get(key)?.visits??0)+1})}return [...counts.values()].sort((x,y)=>y.visits-x.visits||x.steps.join(' ').localeCompare(y.steps.join(' ')))}
 const depth=(prefix:string)=>Array.from({length:DEPTH},(_,i)=>{const reached=visits.filter(row=>Array.from({length:i},(_,k)=>row[prefix+(k+1)]).every(p=>p!==null)).length,continuing=visits.filter(row=>row[prefix+(i+1)]!==null).length;return {step:i+1,reached,continuing,dropOff:reached-continuing}})
 return {path,mode,visits:visits.length,next:tally('n','(exit)'),previous:tally('p','(entrance)'),nextSteps:depth('n'),previousSteps:depth('p')}
}

import type { Env } from './core'
import type { Experiment } from './experiments'
// EXPERIMENT-001 results over the report's (possibly filtered) page loads. A variant's visitors are the distinct daily
// visitor hashes exposed to it, summed over days; its conversions are those visitor-days reaching the experiment's
// goal at or after their first exposure that day; its rate is conversions over visitors with a 95% Wilson interval.
// Each other variant is compared with the control: the difference in rates with a 95% normal (Wald) interval, and
// the probability that it beats the control, Φ(difference / standard error). The minimum sample is the visitors per
// variant needed to detect a 20% relative lift on the control's rate with 80% power at a two-sided 5% level; until
// every variant has it (or while the control has no conversion) the test is underpowered and no result is called.
// Called, a variant beats (or trails) the control when its difference's interval excludes zero. The sample-ratio
// check compares the variants' visitors with an equal split by a chi-square test and warns below p = 0.01.
const Z=1.959964,POWER=0.841621,LIFT=0.2
const erf=(x:number)=>{const s=Math.sign(x),a=Math.abs(x),t=1/(1+0.3275911*a);return s*(1-((((1.061405429*t-1.453152027)*t+1.421413741)*t-0.284496736)*t+0.254829592)*t*Math.exp(-a*a))}
const phi=(x:number)=>(1+erf(x/Math.SQRT2))/2
const round=(x:number,d=4)=>Math.round(x*10**d)/10**d
export function wilson(c:number,n:number):[number,number]|null { if(!n)return null; const p=c/n,den=1+Z*Z/n,mid=(p+Z*Z/(2*n))/den,half=Z*Math.sqrt(p*(1-p)/n+Z*Z/(4*n*n))/den; return [round(mid-half),round(mid+half)] }
export function minimumSample(p:number):number|null { const q=p*(1+LIFT); if(p<=0||q>=1)return null; return Math.ceil((Z+POWER)**2*(p*(1-p)+q*(1-q))/(q-p)**2) }
// The chi-square survival function for 1 to 3 degrees of freedom (2 to 4 variants).
export function chiSquareP(x:number,df:number):number { const e=1-erf(Math.sqrt(x/2)); return df===1?e:df===2?Math.exp(-x/2):e+Math.sqrt(2*x/Math.PI)*Math.exp(-x/2) }
export function results(experiment:Experiment,counts:Map<string,{visitors:number,conversions:number}>) {
 const rows=experiment.variants.map(v=>({variant:v,...(counts.get(v)??{visitors:0,conversions:0})})),control=rows[0]!,pc=control.visitors?control.conversions/control.visitors:0
 const minimum=minimumSample(pc),underpowered=minimum===null||rows.some(r=>r.visitors<minimum),total=rows.reduce((n,r)=>n+r.visitors,0),expected=total/rows.length
 const chi=expected?rows.reduce((n,r)=>n+(r.visitors-expected)**2/expected,0):0,srmP=expected?chiSquareP(chi,rows.length-1):null
 return {name:experiment.name,page:experiment.page,goal:experiment.goal,minimumSample:minimum,underpowered,sampleRatioP:srmP===null?null:round(srmP,6),sampleRatioMismatch:srmP!==null&&srmP<0.01,variants:rows.map((r,i)=>{
  const p=r.visitors?r.conversions/r.visitors:null,base={variant:r.variant,control:i===0,visitors:r.visitors,conversions:r.conversions,conversionRate:p===null?null:round(p),interval:wilson(r.conversions,r.visitors)}
  if(i===0||p===null||!control.visitors)return {...base,difference:null,differenceInterval:null,probabilityBeatsControl:null,verdict:i===0?'control':'no data'}
  const d=p-pc,se=Math.sqrt(pc*(1-pc)/control.visitors+p*(1-p)/r.visitors),lo=d-Z*se,hi=d+Z*se
  return {...base,difference:round(d),differenceInterval:[round(lo),round(hi)] as [number,number],probabilityBeatsControl:se?round(phi(d/se)):null,verdict:underpowered?'underpowered':lo>0?'beats control':hi<0?'trails control':'no difference'}
 })}
}
export async function experimentReport(env:Env,siteId:string,from:string,to:string,events:string,experiments:Experiment[]=[]) {
 return Promise.all(experiments.map(async x=>{
  const result=await env.DB.prepare(`WITH f AS (SELECT p.day,p.visitor,e.variant,MIN(e.at) AS first FROM vane_exposures e JOIN ${events} p ON p.id=e.page_id WHERE e.site_id=?1 AND e.experiment=?2 AND e.day>=?3 AND e.day<?4 AND p.visitor IS NOT NULL GROUP BY p.day,p.visitor,e.variant)
SELECT variant,COUNT(*) AS visitors,SUM(EXISTS(SELECT 1 FROM ${events} g WHERE g.site_id=?1 AND g.day=f.day AND g.visitor=f.visitor AND g.kind=?5 AND g.at>=f.first)) AS conversions FROM f GROUP BY variant`).bind(siteId,x.name,from,to,x.goal).all<any>()
  return results(x,new Map(result.results.map(r=>[r.variant,{visitors:Number(r.visitors),conversions:Number(r.conversions)}])))
 }))
}

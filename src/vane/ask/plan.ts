import { VaneError, insist, type Site } from '../core'
import { BREAKDOWNS, METRICS } from '../stats-api'
import { PERIODS } from '../periods'
import { DIMENSIONS, FILTER_OPS, dimensionOf } from '../segments'

// AGENT-007: the only thing a model may return. A plan names Stats API parameters and nothing else; Vane validates every
// field against the Stats API's own vocabulary, runs the query itself and never repairs or guesses a field.
export interface AskQuery { metrics:string[]; dimension?:string; period?:string; from?:string; to?:string; compare?:string; filters:string[] }
export type AskPlan =
 |{kind:'query';query:AskQuery}
 |{kind:'clarify';prompt:string;choices:{label:string;query:AskQuery}[]}
 |{kind:'unanswerable';reason:'people'|'causes'|'coverage'|'other';explanation:string}
const refused=(why:string)=>new VaneError('ask_plan',`The model proposed something Vane cannot run (${why}); nothing was run.`,502)
const day=(v:unknown)=>typeof v==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(v)&&new Date(v).toISOString().slice(0,10)===v
const text=(v:unknown,max:number,why:string)=>{if(typeof v!=='string'||!v.trim()||v.length>max||/[\u0000-\u001f\u007f]/.test(v))throw refused(why);return v.trim()}
const only=(value:any,keys:string[],why:string)=>{if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).some(k=>!keys.includes(k)))throw refused(why);return value}
export function queryOf(value:unknown):AskQuery {
 const q=only(value,['metrics','dimension','period','from','to','compare','filters'],'unknown query field')
 const metrics=Array.isArray(q.metrics)?q.metrics:[];if(!metrics.length||metrics.length>4||metrics.some((m:unknown)=>typeof m!=='string'||!Object.hasOwn(METRICS,m)))throw refused('metrics')
 if(q.dimension!==undefined&&(typeof q.dimension!=='string'||!Object.hasOwn(BREAKDOWNS,q.dimension)))throw refused('dimension')
 const ranged=q.from!==undefined||q.to!==undefined
 if(ranged){if(q.period!==undefined||!day(q.from)||!day(q.to)||q.from>=q.to)throw refused('range')}
 else if(typeof q.period!=='string'||!Object.hasOwn(PERIODS,q.period))throw refused('period')
 if(q.compare!==undefined&&!['previous','year'].includes(q.compare))throw refused('compare')
 const filters=Array.isArray(q.filters)?q.filters:[];if(filters.length>5)throw refused('filters')
 for(const f of filters){const [dimension,op,...rest]=typeof f==='string'?f.split(':'):[];if(!dimensionOf(dimension??'')||!Object.hasOwn(FILTER_OPS,op??'')||!rest.join(':').trim())throw refused('filter')}
 return {metrics,...(q.dimension?{dimension:q.dimension}:{}),...(ranged?{from:q.from,to:q.to}:{period:q.period}),...(q.compare?{compare:q.compare}:{}),filters}
}
export function planOf(value:unknown):AskPlan {
 const p=only(value,['kind','query','prompt','choices','reason','explanation'],'unknown field')
 if(p.kind==='query'){only(p,['kind','query'],'unknown field');return {kind:'query',query:queryOf(p.query)}}
 if(p.kind==='clarify'){
  only(p,['kind','prompt','choices'],'unknown field');const choices=Array.isArray(p.choices)?p.choices:[];if(choices.length<2||choices.length>4)throw refused('a clarification offers two to four choices')
  return {kind:'clarify',prompt:text(p.prompt,300,'clarification'),choices:choices.map((c:any)=>{only(c,['label','query'],'unknown field');return {label:text(c.label,120,'choice label'),query:queryOf(c.query)}})}
 }
 if(p.kind==='unanswerable'){only(p,['kind','reason','explanation'],'unknown field');insist(['people','causes','coverage','other'].includes(p.reason),'ask_plan','The model gave no reason class; nothing was run.',502);return {kind:'unanswerable',reason:p.reason,explanation:text(p.explanation,400,'explanation')}}
 throw refused('kind')
}
// What the model is told: Vane's own vocabulary and the owner's declared goal names, never a figure or visitor field.
export function instructions(value:Site,today:string):string {
 const goals=[...new Set([...Object.keys(value.config.goals??{}),...Object.keys(value.config.customGoals??{}),...Object.keys(value.config.scrollGoals??{})])]
 return [
  'You turn one analytics question into a Vane Stats API query. Reply with one JSON object and nothing else.',
  'Query: {"kind":"query","query":{"metrics":[...],"dimension":"...","period":"..."|"from":"YYYY-MM-DD","to":"YYYY-MM-DD","compare":"previous"|"year","filters":["dimension:op:value"]}}. "to" is exclusive.',
  'Ambiguous question: {"kind":"clarify","prompt":"...","choices":[{"label":"...","query":{...}},...]} with two to four choices.',
  'A question the data cannot answer: {"kind":"unanswerable","reason":"people"|"causes"|"coverage"|"other","explanation":"..."}. Vane counts anonymous page loads and goals. It does not know people, it cannot prove causes, and it has nothing outside what it collects.',
  `Metrics: ${Object.keys(METRICS).join(', ')}. Dimensions: ${Object.keys(BREAKDOWNS).join(', ')}. Periods: ${Object.keys(PERIODS).join(', ')}.`,
  `Filter dimensions: ${Object.keys(DIMENSIONS).join(', ')}, or prop.<name>. Filter operators: ${Object.keys(FILTER_OPS).join(', ')}. A goal is filtered as goal:is:<name>.`,
  `Goals declared for this site: ${goals.length?goals.join(', '):'none'}. Today is ${today} in the site's time zone, ${value.config.timeZone}. Revenue and paying customers are reached only through a declared goal.`,
 ].join('\n')
}

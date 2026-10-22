import { insist, rows, site, type Env } from '../core'
import { audit } from '../audit'
import { instructions, planOf, queryOf, type AskQuery } from './plan'
import { run, statsUrl, type AskAnswer } from './answer'
import { propose } from './model'
import { askEnabled } from './settings'
export { askSetting, configureAsk } from './settings'
import { localDay } from '../visitors'
import { clock } from '../clock'

// AGENT-007: a question becomes a validated Stats API query that Vane itself runs. The model receives the question text
// and Vane's vocabulary (see instructions) and never a figure, a visitor field or a page value from the data.
export const ASK_HOURLY_LIMIT=60
export type AskResult =
 |AskAnswer
 |{kind:'clarify';siteId:string;prompt:string;choices:{label:string;query:AskQuery;api:string}[]}
 |{kind:'unanswerable';siteId:string;reason:string;explanation:string}
const EMAIL=/[^\s@]+@[^\s@]+\.[^\s@]+/
export async function ask(env:Env,input:{siteId:string;question?:unknown;query?:unknown;actor:string}):Promise<AskResult> {
 const value=await site(env,input.siteId)
 insist(await askEnabled(env,value.id),'ask_disabled','Questions are off for this site; the owner can turn them on in Ask.',403)
 // A clarifying choice or a repeated query runs without the model: it is the shown Stats API query, validated again.
 if(input.query!==undefined)return run(env,value.id,queryOf(input.query))
 const question=typeof input.question==='string'?input.question.trim():''
 insist(question.length>=3&&question.length<=300&&!/[\u0000-\u001f\u007f]/.test(question),'ask_question','Ask in 3 to 300 characters of plain text.')
 insist(!EMAIL.test(question),'ask_question','Leave email addresses out of a question; Vane never answers about people.')
 const since=Date.now()-3600000
 const [{n}]=await rows<{n:number}>(env,"SELECT COUNT(*) AS n FROM vane_audit WHERE action='ask.question' AND subject=? AND at>=?",value.id,since)
 insist(n<ASK_HOURLY_LIMIT,'ask_limit',`At most ${ASK_HOURLY_LIMIT} questions an hour go to the model provider for one site.`,429)
 // Recorded before the call, because a refused call may still have been billed; the text itself is never stored.
 await audit(env,input.actor,'ask.question',value.id,'question sent to the model provider; its text is not stored')
 const plan=planOf(await propose(env,instructions(value,localDay(clock(),value.config.timeZone)),question))
 if(plan.kind==='query')return run(env,value.id,plan.query)
 if(plan.kind==='clarify')return {kind:'clarify',siteId:value.id,prompt:plan.prompt,choices:plan.choices.map(c=>({label:c.label,query:c.query,api:(u=>u.pathname+u.search)(statsUrl(env.AUTH_ORIGIN,value.id,c.query))}))}
 return {kind:'unanswerable',siteId:value.id,reason:plan.reason,explanation:plan.explanation}
}

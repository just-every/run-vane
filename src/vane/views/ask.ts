import type { AskSetting } from '../ask/settings'
import type { AskResult } from '../ask'
import { METRICS } from '../stats-api'
import { escape, hidden, operation, panel, count } from './html'
import type { ViewData } from './types'

const REASONS:Record<string,string>={people:'it asks about people',causes:'it asks for a cause the data cannot prove',coverage:'it asks about something outside what Vane collects',other:'it is outside what Vane counts'}
const figure=(value:unknown)=>typeof value==='number'?count(Math.round(value*10)/10):value===null||value===undefined?'–':escape(value)
// One horizontal bar per breakdown row for the first metric, with the same figures in the table beneath (MOBILE-001).
function bars(rows:{value:unknown;n:number}[],metric:string):string {
 const top=Math.max(1,...rows.map(r=>r.n)),height=rows.length*28+8
 return `<svg viewBox="0 0 480 ${height}" role="img" aria-label="${escape(metric)} by row, bars scaled to the largest" class="vane-ask-chart" width="100%">${rows.map((r,i)=>`<text x="0" y="${i*28+18}" font-size="12" fill="currentColor">${escape(String(r.value).slice(0,24))}</text><rect x="150" y="${i*28+6}" width="${Math.max(2,Math.round(r.n/top*300))}" height="16" rx="3" fill="currentColor" opacity=".55"/><text x="${150+Math.max(2,Math.round(r.n/top*300))+6}" y="${i*28+18}" font-size="12" fill="currentColor">${figure(r.n)}</text>`).join('')}</svg>`
}
function answer(a:Extract<AskResult,{kind:'answer'}>):string {
 const s=a.stats,rows:any[]=s.breakdown??[],keys=a.query.metrics.filter(m=>rows.some(r=>r[METRICS[m]!]!==undefined))
 const columns=keys.length?keys:rows[0]?Object.keys(rows[0]).filter(k=>typeof rows[0][k]==='number'&&k!=='previous').slice(0,4):[]
 const field=(m:string)=>keys.length?METRICS[m]!:m
 const shown=rows.slice(0,10),first=columns[0]
 const chart=shown.length&&first?bars(shown.map(r=>({value:r.value,n:Number(r[field(first)])||0})),first):''
 const table=rows.length?`<div class="vane-table-scroll"><table><caption>${escape(a.query.dimension??'')} · ${escape(a.range.from)} to ${escape(a.range.to)}</caption><thead><tr><th scope="col">${escape(a.query.dimension??'')}</th>${columns.map(c=>`<th scope="col" class="vane-number">${escape(c)}</th>`).join('')}</tr></thead><tbody>${rows.map(r=>`<tr><th scope="row">${escape(r.value)}</th>${columns.map(c=>`<td class="vane-number">${figure(r[field(c)])}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`:a.query.dimension?'<p>No rows in this range.</p>':''
 const totals=`<div class="vane-table-scroll"><table><caption>Totals · ${escape(a.range.from)} to ${escape(a.range.to)}</caption><thead><tr>${a.query.metrics.map(m=>`<th scope="col" class="vane-number">${escape(m)}</th>`).join('')}</tr></thead><tbody><tr>${a.query.metrics.map(m=>`<td class="vane-number" data-ask-total="${escape(m)}">${figure(s.results[m])}</td>`).join('')}</tr></tbody></table></div>`
 const used=`<dl data-ask-query><dt>Metrics</dt><dd>${escape(a.query.metrics.join(', '))}</dd><dt>Breakdown</dt><dd>${escape(a.query.dimension??'none')}</dd><dt>Range</dt><dd>${escape(a.range.from)} to ${escape(a.range.to)} (end excluded), ${escape(a.range.timeZone)}${a.query.compare?`, compared with the ${a.query.compare==='year'?'same dates a year earlier':'previous period'}`:''}</dd><dt>Filters</dt><dd>${a.filters.length?escape(a.filters.join('; ')):'none'}</dd><dt>Stats API query</dt><dd><code data-ask-api>${escape(a.api)}</code></dd></dl>`
 return panel('Answer',`${used}${chart}${table}${totals}<p class="vane-help">These are the Stats API’s figures for the query above, the same as the dashboard shows for it.</p>`)
}
export function askPage(data:ViewData&{ask?:{setting:AskSetting;result?:AskResult}}):string {
 const a=data.ask;if(!a)return panel('Ask','<p>Questions are not available here.</p>')
 const id=data.site.id,owner=data.actor.role==='owner'
 const form=a.setting.enabled&&a.setting.provider?`<form action="/app/action" method="post">${operation('ask.question',id)}<label>Your question<input name="question" required minlength="3" maxlength="300" placeholder="Which campaigns brought paying customers from Texas last month?" autocomplete="off"></label><button type="submit">Ask</button></form>`:`<p data-ask-off>${a.setting.enabled?'The deployment’s model provider is switched off, so questions cannot be answered.':'Questions are off for this site until the owner turns them on.'}</p>`
 const consent=owner?`<form action="/app/action" method="post">${operation('ask.configure',id)}<label>Questions for this site<select name="enabled"><option value="on"${a.setting.enabled?' selected':''}>On</option><option value="off"${a.setting.enabled?'':' selected'}>Off</option></select></label><button type="submit">Save</button></form>`:''
 const result=a.result
 const outcome=!result?'':result.kind==='answer'?answer(result):result.kind==='clarify'?panel('Which did you mean?',`<p data-ask-clarify>${escape(result.prompt)}</p>${result.choices.map(c=>`<form action="/app/action" method="post">${operation('ask.run',id)}${hidden('query',JSON.stringify(c.query))}<button type="submit">${escape(c.label)}</button></form>`).join('')}`):panel('Vane cannot answer that',`<p data-ask-unanswerable>This question is out of reach because ${escape(REASONS[result.reason]??REASONS.other)}. ${escape(result.explanation)}</p>`)
 return `<div data-ask>${panel('Ask a question',`${form}<p class="vane-help">Ask in plain English. Only your question’s text goes to the model provider the deployment chose, with Vane’s list of metrics, breakdowns and your goal names; no figure, visitor field or page value leaves Vane. The model only chooses a Stats API query, which Vane validates and runs itself. Questions and answers are not stored; each question is recorded in the audit history by who asked and when. Sites ${a.setting.enabled?`enabled by the owner${a.setting.enabledAt?` on ${new Date(a.setting.enabledAt).toISOString().slice(0,10)}`:''}`:'have questions off by default'}.</p>${consent}`)}${outcome}</div>`
}

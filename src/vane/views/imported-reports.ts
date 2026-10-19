import { count, escape, hidden, operation, panel } from './html'
import type { AggregateRecord } from '../movein/aggregate-types'

export function importedReportsPanel(records:AggregateRecord[],siteId?:string,prepare=false) {
 if(!records.length)return ''
 const groups=new Map<string,AggregateRecord[]>()
 for(const r of records){const group=groups.get(r.report)??[];group.push(r);groups.set(r.report,group)}
 const tables=[...groups].map(([report,rows])=>{
  const dimensions=[...new Set(rows.flatMap(r=>Object.keys(r.dimensions)))],metrics=[...new Set(rows.flatMap(r=>Object.keys(r.metrics)))]
  return `<h3>${escape(report)}</h3><div class="vane-table-scroll" role="region" aria-label="${escape(report)} imported report" tabindex="0"><table><caption>Matomo · ${escape(report)}</caption><thead><tr><th scope="col">Date</th>${[...dimensions,...metrics].map(c=>`<th scope="col">${escape(c.replaceAll('_',' '))}</th>`).join('')}</tr></thead><tbody>${rows.map(r=>`<tr><th scope="row">${escape(r.day)}</th>${dimensions.map(k=>`<td>${escape(r.dimensions[k]??'—')}</td>`).join('')}${metrics.map(k=>`<td class="vane-number">${r.metrics[k]===undefined?'—':escape(r.metrics[k])}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`
 }).join('')
 const definitions=[...new Map(records.flatMap(r=>r.definitions.map(d=>[d.name,{...d,recordId:r.id}] as const))).values()]
 const goals=definitions.length?`<h3>Goals from Matomo</h3><ul>${definitions.map(d=>`<li><strong>${escape(d.name)}</strong> · ${escape(d.kind)}${d.pattern?` · ${escape(d.pattern)}`:''} · ${escape(d.currency)}${d.incomplete?` · Needs completion: ${escape(d.incomplete)}`:prepare&&siteId?`<form method="post" action="/app/action">${operation('import.goal.prepare',siteId)}${hidden('recordId',d.recordId)}${hidden('name',d.name)}<button type="submit">Prepare ${escape(d.name)} goal</button></form>`:' · Proposed; review after applying the import.'}</li>`).join('')}</ul>`:''
 return panel('Imported Matomo reports',`<p>${count(records.length)} source report rows. Coverage is unknown. Matomo’s visitors, visits, actions, goal conversions and revenue retain Matomo’s definitions and the source site’s local date. Each table is independent: its totals are never added to another breakdown or converted into individual visits. Revenue uses the confirmed site currency; rates and percentages remain source values. Vane’s native event totals are shown separately. The controls above filter native events; these source tables keep Matomo’s own grouping.</p>${tables}${goals}`)
}

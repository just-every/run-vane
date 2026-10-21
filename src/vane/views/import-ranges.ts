import { escape } from './html'
const names:Record<string,string>={umami:'Umami',simple:'Simple Analytics',posthog:'PostHog',ga4:'Google Analytics 4',plausible:'Plausible',matomo:'Matomo'}
export function importRangeLabels(report:any) {
 const ranges=report.importedRanges??[]
 if(!ranges.length||report.importedOff)return ''
 return `<div data-imported-ranges><p class="vane-help">Imported ranges · coverage unknown. Dates below are inclusive; live collection wins on overlap days.</p><ul>${ranges.map((r:any)=>`<li data-imported-source="${escape(r.provider)}">${escape(names[r.provider]??r.provider)} · ${escape(r.from)} – ${escape(r.to)} · ${r.kind==='events'?'anonymous historical page loads; visitor identities, visit timing and consent were discarded':'source report definitions retained; source visitors, sessions, rates and goals stay separate and are never added to native chart totals'}.</li>`).join('')}</ul></div>`
}

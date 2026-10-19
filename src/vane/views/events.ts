import { change, changeHead, count, escape, panel } from './html'
import { filterCell } from './tables'
import { filterBy } from './filters'
// CONV-002: custom events, their properties and pageview properties; each value filters the report (DASH-007).
export function customPanel(report: any): string {
  const events: any[] = report.customEvents ?? [], eventProps: any[] = report.eventProps ?? [], pageProps: any[] = report.pageProps ?? []
  if (!events.length && !pageProps.length) return ''
  const table = (title: string, heads: string[], rows: string) => `<div class="vane-table-scroll" role="region" aria-label="${escape(title)}" tabindex="0"><table data-custom="${escape(title)}"><caption class="vane-sr-only">${escape(title)}</caption><thead><tr>${heads.map((h, i) => `<th scope="col"${i >= heads.length - 2 ? ' class="vane-number"' : ''}>${escape(h)}</th>`).join('')}${changeHead}</tr></thead><tbody>${rows}</tbody></table></div>`
  const byEvent = events.length ? table('Custom events', ['Event', 'Events', 'Visitors'], events.map(r => `<tr><th scope="row">${filterCell(r.name, filterBy(report, 'event'))}</th><td class="vane-number">${count(r.events)}</td><td class="vane-number">${count(r.visitors)}</td>${change(r.events, r.previous)}</tr>`).join('')) : ''
  const byProp = eventProps.length ? table('Event properties', ['Event', 'Property', 'Value', 'Events', 'Visitors'], eventProps.map(r => `<tr><th scope="row">${escape(r.name)}</th><td>${escape(r.key)}</td><td>${filterCell(r.value, filterBy(report, 'prop.' + r.key))}</td><td class="vane-number">${count(r.events)}</td><td class="vane-number">${count(r.visitors)}</td>${change(r.events, r.previous)}</tr>`).join('')) : ''
  const byPage = pageProps.length ? table('Page properties', ['Property', 'Value', 'Pageviews', 'Visitors'], pageProps.map(r => `<tr><th scope="row">${escape(r.key)}</th><td>${filterCell(r.value, filterBy(report, 'prop.' + r.key))}</td><td class="vane-number">${count(r.pageviews)}</td><td class="vane-number">${count(r.visitors)}</td>${change(r.pageviews, r.previous)}</tr>`).join('')) : ''
  return panel('Custom events and properties', `${byEvent}${byProp}${byPage}<p class="vane-help">Sent with <code>vane('Signup', {props: {plan: 'pro'}})</code>, a <code>vane-event-name=Signup</code> class, <code>vane('pageview', {props})</code> or <code>data-prop-&lt;name&gt;</code> on the script. Values that look like a phone or account number or a web address are dropped and counted under coverage; an event carrying an email address is refused.</p>`)
}

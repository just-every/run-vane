import { count, escape, money, panel } from './html'
import { definition } from './tables'
// CONV-006: total revenue in the site currency with its change, orders, average order value and revenue per visitor,
// revenue as sent in each event's currency, revenue no owner-entered rate converts (listed in its own currency), and
// the rates used, labelled as owner-entered.
export function revenuePanel(report: any, summed = ''): string {
  const r = report.revenue
  if (!r || (!r.orders && !r.previousOrders && !r.unconverted.length)) return ''
  const delta = r.total - r.previous, sign = delta >= 0 ? '+' : '−'
  const sent = `<h3>In each event’s currency</h3><ul data-sent>${r.sent.map((u: any) => `<li>${escape(money(u.amount, u.currency))} sent in ${escape(u.currency)} by ${count(u.orders)} ${u.orders === 1 ? 'event' : 'events'}.</li>`).join('')}</ul>`
  const apart = r.unconverted.length ? `<h3>Not converted</h3><ul data-unconverted>${r.unconverted.map((u: any) => `<li>${escape(money(u.amount, u.currency))} from ${count(u.orders)} ${u.orders === 1 ? 'event' : 'events'}: no exchange rate for ${escape(u.currency)} is in effect, so it is not in the total.</li>`).join('')}</ul>` : ''
  const rates = r.rates.length ? `<h3>Exchange rates (owner-entered)</h3><ul data-rates>${r.rates.map((x: any) => `<li>1 ${escape(x.currency)} = ${escape(x.rate)} ${escape(r.currency)} from ${escape(x.from)}${report.rollup ? `, ${escape(x.site)}` : ''}, entered by the owner; Vane never fetches a rate.</li>`).join('')}</ul>` : ''
  return panel('Revenue', `<div class="vane-metrics"><section class="vane-panel"><h2>Revenue${summed}</h2><p class="vane-metric" data-revenue>${escape(money(r.total, r.currency))}</p><p>${sign}${escape(money(Math.abs(delta), r.currency))} against ${escape(money(r.previous, r.currency))} in the compared period.</p><p class="vane-help">Revenue sent with custom events, in ${escape(r.currency)}.${definition('revenue')}</p></section><section class="vane-panel"><h2>Orders</h2><p class="vane-metric">${count(r.orders)}</p><p class="vane-help">Events carrying converted revenue; previously ${count(r.previousOrders)}.</p></section><section class="vane-panel"><h2>Average order value</h2><p class="vane-metric" data-aov>${r.averageOrderValue === null ? '—' : escape(money(r.averageOrderValue, r.currency))}</p><p class="vane-help">Revenue over orders.</p></section><section class="vane-panel"><h2>Revenue per visitor</h2><p class="vane-metric" data-rpv>${r.perVisitor === null ? '—' : escape(money(r.perVisitor, r.currency))}</p><p class="vane-help">Revenue over unique visitors.</p></section></div>${r.sent.length ? sent : ''}${apart}${rates}`)
}

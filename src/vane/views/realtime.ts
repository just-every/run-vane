import { change, changeHead, changeText, count, escape, panel } from './html'
import type { LiveRow } from '../realtime'
import { metroLabel, ownerNamesNote } from './metro-names'

// DASH-001: the real-time view. The server draws it; the view's one nonce'd script fetches this same page every
// 10 seconds and swaps in the fresh #vane-realtime block, so the numbers move without a reload.
const W = 640, H = 160, PAD = 8
const instant = (now: number, timeZone: string) => new Intl.DateTimeFormat('en-US', { timeZone, hourCycle: 'h23', hour: '2-digit', minute: '2-digit', second: '2-digit', timeZoneName: 'short' }).format(now)

function liveTable(title: string, column: string, rows: LiveRow[], note = ''): string {
  if (!rows.length) return panel(title, '<p class="vane-empty">No current visitors now or 30 minutes earlier.</p>')
  return panel(title, `<div class="vane-table-scroll" role="region" aria-label="${escape(title)}" tabindex="0"><table data-live="${escape(title)}"><caption class="vane-sr-only">${escape(title)}</caption><thead><tr><th scope="col">${escape(column)}</th><th scope="col" class="vane-number">Current visitors</th><th scope="col" class="vane-number">30 minutes earlier</th>${changeHead}</tr></thead><tbody>${rows.map(row => `<tr><th scope="row">${metroLabel(row.label, row.place)}</th><td class="vane-number" data-visitors>${count(row.visitors)}</td><td class="vane-number">${count(row.previous)}</td>${change(row.visitors, row.previous)}</tr>`).join('')}</tbody></table></div>${note}`)
}

function minuteChart(live: any): string {
  const minutes: { label: string; pageviews: number; previousLabel: string; previous: number }[] = live.minutes
  const max = Math.max(0, ...minutes.flatMap(m => [m.pageviews, m.previous])), x = (i: number) => PAD + (i * (W - 2 * PAD)) / 29, y = (v: number) => H - PAD - (max ? (v / max) * (H - 2 * PAD) : 0)
  const line = (values: number[], kind: string) => `<polyline class="${kind}" points="${values.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ')}"/>`
  const title = `Pageviews per minute, ${minutes[0]!.label} to ${minutes[29]!.label} (${live.timeZone})`
  const svg = `<svg class="vane-chart" viewBox="0 0 ${W} ${H}" role="img" aria-labelledby="vane-live-chart-title"><title id="vane-live-chart-title">${escape(title)}</title><line class="vane-chart-axis" x1="0" y1="${H - PAD}" x2="${W}" y2="${H - PAD}"/>${line(minutes.map(m => m.previous), 'vane-chart-compare')}${line(minutes.map(m => m.pageviews), 'vane-chart-line')}${minutes.map((m, i) => `<circle class="vane-chart-point" cx="${x(i).toFixed(1)}" cy="${y(m.pageviews).toFixed(1)}" r="2" data-minute="${escape(m.label)}" data-value="${m.pageviews}"><title>${escape(m.label)}: ${count(m.pageviews)}</title></circle>`).join('')}</svg>`
  const table = `<details class="vane-chart-data"><summary>Data table</summary><div class="vane-table-scroll" role="region" aria-label="Pageviews per minute" tabindex="0"><table><caption>${escape(title)}</caption><thead><tr><th scope="col">Minute</th><th scope="col" class="vane-number">Pageviews</th><th scope="col">30 minutes earlier</th><th scope="col" class="vane-number">Pageviews then</th>${changeHead}</tr></thead><tbody>${minutes.map(m => `<tr><th scope="row">${escape(m.label)}</th><td class="vane-number" data-minute-pageviews>${count(m.pageviews)}</td><td>${escape(m.previousLabel)}</td><td class="vane-number">${count(m.previous)}</td>${change(m.pageviews, m.previous)}</tr>`).join('')}</tbody></table></div></details>`
  return panel('Pageviews per minute', `<figure class="vane-chart-figure">${svg}<figcaption><p class="vane-help"><span class="vane-chart-key"></span> last 30 minutes · <span class="vane-chart-key vane-chart-key-compare"></span> the 30 minutes before. Scale 0 to ${count(max)}; the last minute is still running.</p></figcaption></figure>${table}`)
}

export function realtimePage(live: any): string {
  const visitors = Number(live.currentVisitors) || 0, then = Number(live.previousCurrentVisitors) || 0
  return `<div id="vane-realtime" data-realtime><p class="vane-help" data-updated>Updated ${escape(instant(live.now, live.timeZone))}. Refreshes every 10 seconds without reloading the page.</p><div class="vane-metrics"><section class="vane-panel"><h2>Current visitors</h2><p class="vane-metric" data-current-visitors aria-live="polite">${count(visitors)}</p><p>${count(then)} 30 minutes earlier · ${changeText(visitors, then)}</p><p class="vane-help">Visitors whose latest page load or engagement ping is under 5 minutes old.</p></section><section class="vane-panel"><h2>Pageviews, last 30 minutes</h2><p class="vane-metric" data-live-pageviews>${count(live.pageviews)}</p><p>${count(live.previousPageviews)} in the 30 minutes before · ${changeText(live.pageviews, live.previousPageviews)}</p><p class="vane-help">Page loads in the current minute and the 29 before it.</p></section></div>${minuteChart(live)}<div class="vane-breakdowns">${liveTable('Live pages', 'Page', live.pages)}${liveTable('Live sources', 'Source', live.sources)}${liveTable('Live locations', 'Location', live.locations)}${liveTable('Live US metro areas', 'Metro area', live.metros, live.metros.some((r: LiveRow) => r.metro_name) ? ownerNamesNote(live.metroLabels ?? []) : '')}</div><p class="vane-help">Pages count each current visitor at their latest page load; sources count them under the source of their visit’s first page load; locations count them at the city, region and country of their latest page load. Compared figures are the same window 30 minutes earlier.</p></div>`
}

// The poll asks only this page's own origin (connect-src 'self') with the reader's session.
export const realtimePoll = "setInterval(async()=>{try{const r=await fetch(location.href,{credentials:'same-origin',cache:'no-store'});if(!r.ok)return;const next=new DOMParser().parseFromString(await r.text(),'text/html').getElementById('vane-realtime'),here=document.getElementById('vane-realtime');if(next&&here)here.innerHTML=next.innerHTML}catch{}},10000)"

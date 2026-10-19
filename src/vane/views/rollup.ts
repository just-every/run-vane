import { escape } from './html'
import { reportPage } from './report'
import { rollupSite } from '../rollups'
import type { ViewData } from './types'
// DASH-010: a roll-up's report reads as one site's, with its members, the summed-per-site rule and the split by site.
export function rollupPage(data: ViewData): string {
  const r = data.rollup!
  return `<div class="vane-heading"><div><p class="vane-eyebrow">Roll-up</p><h1>${escape(r.name)}</h1><p>${escape(r.sites.map(s => s.name).join(' + '))}</p></div><a href="/app">All sites</a></div>${reportPage({ ...data, site: rollupSite(r as any) })}`
}

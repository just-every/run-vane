import { reportPage } from './report'
import { rollupSite } from '../rollups'
import type { ViewData } from './types'
// DASH-010: a roll-up's report reads as one site's, with its members, the summed-per-site rule and the split by site.
export function rollupPage(data: ViewData): string {
  const r = data.rollup!
  return reportPage({ ...data, site: rollupSite(r as any) }, { title: r.name, eyebrow: `Roll-up · ${r.sites.map(s => s.name).join(' + ')}` })
}

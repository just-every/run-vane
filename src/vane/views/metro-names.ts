import { canPrepare, count, date, escape, field, operation, panel } from './html'
import { METRO_LIMITS, METRO_STATEMENT, placeText, unnamedMetro, type Place } from '../metro-names'
import type { ViewData } from './types'
// DASH-016: the site's US metro-name table on its settings page. Vane ships no names; an owner or an administrator
// uploads a table the site has the right to use, and the owner approves it under Approvals.
export function metroNamesPanel(data: ViewData): string {
  const site = data.site, table = data.metroTable
  if (!site || !table) return ''
  const named = table.rows > 0
  const summary = `<dl data-metro-table><dt>Source</dt><dd>${named ? escape(table.label) : 'No table approved: every code shows as “Metro NNN (unnamed)”.'}</dd>${named ? `<dt>Approved</dt><dd>${date(table.approvedAt)} by ${escape(table.approver ?? 'someone no longer on the team')}</dd><dt>Names</dt><dd>${count(table.rows)}</dd><dt>Shared links, embeds and public pages</dt><dd>${table.public ? 'Show these names' : 'Show codes only'}</dd>` : ''}<dt>Codes seen without a name</dt><dd data-unnamed-codes>${table.unnamedSeen.length ? escape(table.unnamedSeen.join(', ')) : 'None'}</dd></dl>`
  const upload = canPrepare(data.actor.role) ? `<form action="/app/action" method="post" enctype="multipart/form-data">${operation('metro.prepare', site.id)}<label>Metro-name table (CSV)<input type="file" name="metroNames" accept=".csv,text/csv" required aria-describedby="metro-names-help"></label><span class="vane-help" id="metro-names-help">UTF-8 CSV with the header <code>metro_code,metro_name</code>: 3-digit codes, each once, and names of 1 to ${METRO_LIMITS.name} characters; at most ${count(METRO_LIMITS.rows)} rows and 256 KB.</span>${field('Source of these names', 'label', '', `required maxlength="${METRO_LIMITS.label}"`)}<label class="vane-check"><input type="checkbox" name="statement" value="on" required> ${escape(METRO_STATEMENT)}</label><label class="vane-check"><input type="checkbox" name="public" value="on"> Also show these names on shared links, embeds and public pages</label><button type="submit" class="vane-secondary">Prepare for approval</button></form>${named ? `<form action="/app/action" method="post">${operation('metro.clear', site.id)}<button type="submit" class="vane-secondary">Prepare clearing the names</button></form>` : ''}` : ''
  return `<div id="metro-names">${panel('US metro-area names', `<p>Cloudflare gives each US visit a metro-area (Nielsen DMA®) code but no name, and Vane ships no names. Upload a table you have the right to use (for example, from your own Nielsen DMA® licence). Names apply only after the owner approves them, and replace the whole table everywhere, older data included.</p>${summary}${upload}`)}</div>`
}
// The proposal as the owner reviews it before approving.
export function metroProposal(payload: any): string {
  const p = payload.preview ?? {}, codes = (list: string[] = []) => list.length ? escape(list.join(', ')) : 'None'
  const pairs = (list: { code: string; name?: string; from?: string; to?: string }[] = []) => list.length ? escape(list.map(r => r.from !== undefined ? `${r.code}: ${r.from} → ${r.to}` : `${r.code}: ${r.name}`).join('; ')) : 'None'
  if (payload.clear) return `<dl data-metro-preview><dt>Change</dt><dd>Clear the site’s metro names: every code shows as “Metro NNN (unnamed)” again.</dd><dt>Removed names</dt><dd>${pairs(p.removed)}</dd></dl>`
  return `<dl data-metro-preview><dt>Source</dt><dd>${escape(payload.label)}</dd><dt>Statement</dt><dd>${escape(payload.statement)}</dd><dt>Shared links, embeds and public pages</dt><dd>${payload.public ? 'Show these names' : 'Show codes only'}</dd><dt>Rows</dt><dd>${count(p.rows)}</dd><dt>Added names</dt><dd>${pairs(p.added)}</dd><dt>Changed names</dt><dd>${pairs(p.changed)}</dd><dt>Removed names</dt><dd>${pairs(p.removed)}</dd><dt>Codes seen that it names</dt><dd>${codes(p.seenNamed)}</dd><dt>Codes seen that stay unnamed</dt><dd>${codes(p.seenUnnamed)}</dd><dt>Codes never seen</dt><dd>${codes(p.neverSeen)}</dd></dl>`
}
// A metro row's label: the approved name, or the unnamed code with its observed place (display only).
export const metroLabel = (label: string, place: Place | null | undefined) => `${escape(label)}${place ? `<br><span class="vane-help" data-metro-place>Most visitors: ${escape(placeText(place))}</span>` : ''}`
export const ownerNamesNote = (labels: string[]) => labels.length ? `<p class="vane-help" data-metro-attribution>Metro names: ${escape(labels.join('; '))}, supplied by the site owner.</p>` : ''
export { unnamedMetro }

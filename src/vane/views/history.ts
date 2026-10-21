import { plausibleImportPanel, importedDefinitionsPanel } from './import-definitions'
import { MATOMO_METHODS } from '../movein/matomo-reader'
import { importedReportsPanel } from './imported-reports'
import type { AggregateRecord } from '../movein/aggregate-types'
import { cutoverField, count, escape, hidden, operation, panel } from './html'
import type { ViewData } from './types'
import { storePanel } from './store'

/** The route supplies these reviewed values with its sanitized importCarry. */
export interface ImportPreview {
  aggregates?:AggregateRecord[]
  skipped?:{ day: string; provider: string }[]
  cutover?: string | null
  overlap?: string[]
  fingerprint: string
  count: number
  duplicates?: number
  warnings?: string[]
  errors?: string[]
  rows?: { date: string; path: string; visits: number; source?: string; campaign?: string; goal?: string }[]
}

function preview(data: ViewData): string {
  const item: ImportPreview | undefined = data.importPreview
  if (!item || !data.site || data.actor.role !== 'owner') return ''
  const errors = item.errors ?? []
  const rows = item.rows ?? []
  const details = `<dl><dt>Records in preview</dt><dd>${count(item.count)}</dd>${item.duplicates !== undefined ? `<dt>Duplicate records</dt><dd>${count(item.duplicates)}</dd>` : ''}<dt>Document fingerprint</dt><dd><code>${escape(item.fingerprint)}</code></dd></dl>${item.warnings?.length ? `<ul>${item.warnings.map(warning => `<li>${escape(warning)}</li>`).join('')}</ul>` : ''}${errors.length ? `<div class="vane-error" role="alert"><p>This import needs attention before it can be applied.</p><ul>${errors.map(error => `<li>${escape(error)}</li>`).join('')}</ul></div>` : ''}${rows.length ? `<div class="vane-table-scroll" role="region" aria-label="Import preview records" tabindex="0"><table><caption>Import preview records</caption><thead><tr><th scope="col">Date</th><th scope="col">Path</th><th scope="col">Referring hostname</th><th scope="col">Campaign</th><th scope="col">Goal</th><th scope="col" class="vane-number">Visits (page loads)</th></tr></thead><tbody>${rows.map(row => `<tr><td>${escape(row.date)}</td><th scope="row">${escape(row.path)}</th><td>${escape(row.source ?? '—')}</td><td>${escape(row.campaign ?? '—')}</td><td>${escape(row.goal ?? '—')}</td><td class="vane-number">${count(row.visits)}</td></tr>`).join('')}</tbody></table></div>` : ''}`
  // IMPORT-007: the days another source already holds, left out of this import.
  const sources: Record<string, string> = { ga4: 'Google Analytics 4', plausible: 'Plausible', matomo: 'Matomo' }
  const held = item.skipped?.length ? `<p data-overlap-skipped>These days are already held by another import and are skipped, so nothing counts twice:</p><ul data-overlap-days>${item.skipped.map(s => `<li>${escape(s.day)}: held by ${escape(sources[s.provider] ?? s.provider)}</li>`).join('')}</ul>` : ''
  const cutover=item.cutover?`<p data-import-cutover>Cut-over: ${escape(item.cutover)}. Only earlier imported dates appear in reports; any earlier date with live data uses live data alone. Source reports retain their own definitions and remain separate from native totals. Full imported history remains available for undo and installation archives.</p>${item.overlap?.length?`<p>Live data wins on: ${item.overlap.map(escape).join(', ')}.</p>`:''}`:''
  const apply = data.actor.role === 'owner' && !errors.length && item.fingerprint && data.importCarry
    ? `<form method="post" action="/app/action">${operation('import.apply', data.site.id)}${hidden('document', data.importCarry)}${hidden('fingerprint', item.fingerprint)}<p>Apply the reviewed document to this site. You can undo this import from its journal below.</p><button type="submit">Apply import</button></form>`
    : '<p class="vane-help">Only the owner can apply a validated import.</p>'
  return panel('Review import', details + held + cutover + apply)+importedReportsPanel(item.aggregates??[])
}

function journals(data: ViewData): string {
  const items = data.imports ?? []
  if (!items.length) return panel('Import journal', '<p class="vane-empty">No imports recorded for this site.</p>')
  return panel('Import journal', `<div class="vane-table-scroll" role="region" aria-label="Import journal" tabindex="0"><table><caption class="vane-sr-only">Imports for this site</caption><thead><tr><th scope="col">Import</th><th scope="col">State</th><th scope="col" class="vane-number">Records</th><th scope="col">Journal</th><th scope="col">Action</th></tr></thead><tbody>${items.map(job => `<tr><th scope="row">${escape(job.id)}</th><td>${escape(job.state)}</td><td class="vane-number">${count(job.count)}</td><td><a href="/api/vane/import-journal?siteId=${encodeURIComponent(data.site.id)}&amp;jobId=${encodeURIComponent(job.id)}" download>Download journal<span class="vane-sr-only"> ${escape(job.id)}</span></a></td><td>${data.actor.role === 'owner' && ['applied', 'completed', 'complete', 'undoing'].includes(job.state) ? `<form method="post" action="/app/action">${operation('import.undo', data.site.id)}${hidden('jobId', job.id)}<button class="vane-secondary" type="submit">${job.state==='undoing'?'Continue undo':'Undo import'}<span class="vane-sr-only"> ${escape(job.id)}</span></button></form>` : '—'}</td></tr>`).join('')}</tbody></table></div>`)
}

function exportPanel(): string {
  return panel('Export analytics history', '<p>Download analytics for the whole installation, across all sites, with its history journals. This archive excludes authentication and sign-in data.</p><a class="vane-button vane-secondary" href="/api/vane/export" download>Download installation archive</a>')
}

export function globalHistoryPage(data: ViewData): string {
  if(data.actor.role!=='owner')return panel('Data history','<p>The owner manages imports, exports, restoration and erasure.</p>')
  const restore = data.actor.role !== 'owner' ? '' : data.sites.length
    ? panel('Restore an installation archive', '<p>Restoring requires an installation with no sites. Export your current history before using a fresh installation to restore an archive.</p>')
    : panel('Restore an installation archive', `<p>Restore a whole-installation analytics export into this empty installation. Existing erasure fences prevent older archives from bringing erased history back. Include a later journal if erasures happened after the archive was made, so a fresh store also preserves those erasures.</p><form method="post" action="/app/action" enctype="multipart/form-data">${operation('history.restore')}<label>Installation archive<input type="file" name="archive" required></label><label>Later journal (optional)<input type="file" name="journal"></label><button type="submit">Restore archive</button></form>`)
  const transfer = panel('Transfer a site in', `<p>Add one site with its settings and history from a site archive downloaded on another Vane installation. The site keeps its ID, so its script tag keeps working once it points here.</p><form method="post" action="/app/action" enctype="multipart/form-data">${operation('site.import')}<label>Site archive<input type="file" name="archive" required></label><button type="submit">Transfer site</button></form>`)
  return exportPanel() + storePanel(data) + transfer + restore
}

export function historyPage(data: ViewData): string {
  if (!data.site) return globalHistoryPage(data)
  const owner = data.actor.role === 'owner'
  const imported = owner ? panel('Import a document', `<p>GA4 Data API response documents and dated Universal Analytics CSV documents can be uploaded here. Google OAuth reads are not available yet. <a href="https://github.com/just-every/run-vane/blob/main/docs/history.md">Document formats and definition differences</a>.</p><p>Choose an analytics document to validate and preview before applying it to ${escape(data.site.name)}.</p><form method="post" action="/app/action" enctype="multipart/form-data">${operation('import.preview', data.site.id)}${cutoverField}<label>Analytics document<input type="file" name="document" required></label><button type="submit">Preview import</button></form>`) : ''
  const matomo=owner?panel('Read Matomo history',`<p>Read one day of aggregate reports from Matomo Cloud or your Matomo server. Use its source site’s local date and confirm its currency. The token is used only for this request and never saved. Repeat for other days. Visitor logs are never requested.</p><form method="post" action="/app/action">${operation('import.matomo.preview',data.site.id)}${cutoverField}<label>Matomo Reporting API address<input type="url" name="endpoint" placeholder="https://analytics.example.com/index.php" required></label><label>Matomo site ID<input name="sourceSite" inputmode="numeric" required></label><label>Source date<input type="date" name="day" required></label><label>Source currency<input name="currency" value="${escape(data.site.config.currency??'USD')}" maxlength="3" required></label><label>Reporting API token<input type="password" name="token" autocomplete="off" required></label><button type="submit">Preview Matomo reports</button></form>`):''
  const matomoCsv=owner?panel('Import Matomo report CSV',`<p>Export one day of an unformatted, flat Matomo report (format=CSV, format_metrics=0, translateColumnNames=0, flat=1), then choose its report and source date. Summary CSVs hold one row; breakdown CSVs hold one row per label. Independent reports stay separate.</p><form method="post" action="/app/action" enctype="multipart/form-data">${operation('import.matomo.csv.preview',data.site.id)}${cutoverField}<label>Report<select name="report">${MATOMO_METHODS.map(m=>`<option>${escape(m)}</option>`).join('')}</select></label><label>CSV source date<input type="date" name="day" required></label><label>CSV currency<input name="currency" value="${escape(data.site.config.currency??'USD')}" maxlength="3" required></label><label>Matomo CSV<input type="file" name="document" accept=".csv,text/csv" required></label><button>Preview Matomo CSV</button></form>`):''
  const retention = owner ? panel('Apply retention', `<p>Remove analytics older than the configured retention periods. If imported rows remain beyond those periods, repeat Apply retention until they have all been processed.</p><form method="post" action="/app/action">${operation('history.retention', data.site.id)}<button type="submit">Apply retention</button></form>`) : ''
  const erase = owner ? panel('Erase this site’s history', `<p>Erasure removes analytics for ${escape(data.site.name)}. It records an erasure fence so an older archive cannot resurrect that history. Prepare the request here, then review and approve it in Approvals.</p><form method="post" action="/app/action">${operation('history.erase.prepare', data.site.id)}<button type="submit" class="vane-danger">Prepare history erasure</button></form>`) : ''
  const transfer = owner ? panel('Transfer or delete this site', `<p>Download ${escape(data.site.name)} with its settings and history to transfer it to another Vane installation. Imported rows travel as settled history; their import journal stays in the installation archive.</p><a class="vane-button vane-secondary" href="/api/vane/export?siteId=${encodeURIComponent(data.site.id)}" download>Download site archive</a><p>Deleting the site removes it with all of its history. Prepare the request here; the owner reviews and approves it in Approvals.</p><form method="post" action="/app/action">${operation('site.delete.prepare', data.site.id)}<button type="submit" class="vane-danger">Prepare site deletion</button></form>`) : ''
  return (owner ? exportPanel() : '') + imported + (owner?plausibleImportPanel(data.site.id,data.site.config.currency??'USD'):'') + matomo + matomoCsv + preview(data) + importedDefinitionsPanel(data.importDefinitions??[],data.site.id,owner||data.actor.access==='analyst'||data.actor.role==='admin') + importedReportsPanel(data.report?.importedReports??[],data.site.id,owner) + journals(data) + retention + storePanel(data) + erase + transfer
}

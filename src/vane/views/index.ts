import { heatPage } from './heat'
import { heatScript } from '../heat'
import { agencyPage } from './agency'
import { themeFrame } from '../../base/theme-frame'
import { fontHead } from '../../base/font-head'
import { approvalsPage } from './approvals'
import { auditPage } from './audit'
import { canPrepare, escape } from './html'
import { globalHistoryPage, historyPage } from './history'
import { reportPage } from './report'
import { settingsPage, sitesPage } from './settings'
import { appFooter, appRail } from './shell'
import { scriptCopy } from './script-copy'
import { storeWarning } from './store'
import { rollupPage } from './rollup'
import { teamPage } from './team'
import { apiKeysPage } from './api-keys'
import { realtimePage, realtimePoll } from './realtime'
import { pushPage, pushScript } from './push'
import type { ViewData } from './types'

const browserZone = "document.querySelectorAll('input[data-browser-zone]').forEach(input=>{const zone=Intl.DateTimeFormat().resolvedOptions().timeZone;if(zone)input.value=zone})"

export type { ViewData } from './types'
export type { ImportPreview } from './history'

export async function renderApp(data: ViewData): Promise<Response> {
  const frame = data.reportFrame ?? await themeFrame({ href: '/rer-theme.css', productName: 'Vane' })
  const section = ['report', 'settings', 'history', 'approvals', ...(data.site ? ['realtime','heat'] : ['audit', 'team', 'api', 'alerts', 'agency'])].includes(data.section ?? '') ? data.section! : 'report'
  const site = data.site
  // DASH-002: a new site's time zone starts as the zone the owner's browser reports, such as America/Chicago.
  const zoneFill = !site && !data.rollup && section === 'report' && canPrepare(data.actor.role)
  // DASH-001: only the real-time view may connect, and only to this origin, to refresh itself.
  const heat = Boolean(site && section === 'heat')
  const live = Boolean(site && section === 'realtime')
  // MOBILE-001: only the browser alerts page runs a script that registers the service worker and sends its subscription.
  const alerts = !site && !data.rollup && section === 'alerts'
  const copyNonce = (site && section === 'settings') || zoneFill || live || alerts || heat ? crypto.randomUUID() : ''
  // Every page but the Overview opens with its own heading; a site's pages name the site above it.
  const heading = (title: string, lead = '') => `<div class="vane-heading"><div>${site ? `<p class="vane-eyebrow">${escape(site.name)} · ${escape(site.origin)}</p>` : ''}<h1>${escape(title)}</h1>${lead ? `<p>${escape(lead)}</p>` : ''}</div></div>`
  const content = data.rollup
    ? rollupPage(data)
    : site
    ? section === 'heat' ? `${heading('Heatmaps', 'Aggregate clicks and scroll reach on pages you choose.')}${heatPage(data)}` : section === 'realtime' ? `${heading('Real-time', 'Current visitors and pageviews per minute against 30 minutes earlier.')}${realtimePage(data.live)}` : section === 'settings' ? `${heading('Settings', 'Install the script, share the stats and choose what is counted.')}${settingsPage(data)}` : section === 'history' ? `${heading('History', 'Import, export, retention and erasure for this site.')}${historyPage(data)}` : section === 'approvals' ? `${heading('Approvals', 'Prepared changes take effect once the owner approves them.')}${approvalsPage(data)}` : reportPage(data)
    : section === 'agency' && data.agency ? `${heading('Agency clients')}${agencyPage(data)}` : section === 'history' ? `${heading('Data history')}${globalHistoryPage(data)}` : section === 'approvals' ? `${heading('Approvals')}${approvalsPage(data)}` : section === 'audit' ? `${heading('Audit history')}${auditPage(data)}` : section === 'alerts' ? `${heading('Browser alerts')}${pushPage(data)}` : section === 'api' && data.apiKeys ? `${heading('API keys')}${apiKeysPage(data)}` : section === 'team' && data.people ? `${heading('Team')}${teamPage(data)}` : sitesPage(data)
  const html = `<!doctype html><html lang="en"${frame.htmlClass}><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light"><title>${escape(site?.name ?? data.rollup?.name ?? (section === 'history' ? 'Data history' : section === 'approvals' ? 'Approvals' : section === 'audit' ? 'Audit history' : section === 'alerts' ? 'Browser alerts' : 'Sites'))} · Vane</title>${fontHead}${frame.head}<link rel="stylesheet" href="/vane.css"><link rel="manifest" href="/manifest.webmanifest"></head><body class="vane-app vane-shell${!site && section === 'report' && !data.sites.length ? ' vane-empty-sites' : ''}${(site || data.rollup) && section === 'report' ? ' vane-on-report' : ''}">${appRail(frame.brand, data, section)}<div class="vane-workspace"><main id="main" tabindex="-1">${data.store?.warn ? storeWarning(data.store) : ''}${data.notice ? `<div class="vane-notice" role="status">${escape(data.notice)}</div>` : ''}${data.error ? `<div class="vane-error" role="alert">${escape(data.error)}</div>` : ''}${content}</main>${appFooter}</div>${copyNonce ? `<script nonce="${copyNonce}">${heat ? heatScript : live ? realtimePoll : alerts ? pushScript : zoneFill ? browserZone : scriptCopy}</script>` : ''}</body></html>`
  return new Response(html, { headers: {
    'Content-Type': 'text/html; charset=utf-8',
    'Cache-Control': 'no-store',
    'Content-Security-Policy': `default-src 'none'; ${heat?frame.policy.replace("img-src 'self'", "img-src 'self' data:"):frame.policy}; media-src ${heat?"blob:":"'none'"}; script-src ${copyNonce ? `'nonce-${copyNonce}'` : "'none'"}; connect-src ${live || alerts ? "'self'" : "'none'"}; worker-src ${alerts ? "'self'" : "'none'"}; manifest-src 'self'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'`,
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'same-origin',
  } })
}

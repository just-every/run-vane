import { themeFrame } from '../../base/theme-frame'
import { fontHead } from '../../base/font-head'
import { approvalsPage } from './approvals'
import { auditPage } from './audit'
import { canPrepare, escape, siteLink } from './html'
import { globalHistoryPage, historyPage } from './history'
import { reportPage } from './report'
import { settingsPage, sitesPage } from './settings'
import { appFooter, appHeader } from './shell'
import { scriptCopy } from './script-copy'
import { storeWarning } from './store'
import type { ViewData } from './types'

const browserZone = "document.querySelectorAll('input[data-browser-zone]').forEach(input=>{const zone=Intl.DateTimeFormat().resolvedOptions().timeZone;if(zone)input.value=zone})"

export type { ViewData } from './types'
export type { ImportPreview } from './history'

export async function renderApp(data: ViewData): Promise<Response> {
  const frame = await themeFrame({ href: '/rer-theme.css', productName: 'Vane' })
  const section = ['report', 'settings', 'history', 'approvals', ...(data.site ? [] : ['audit'])].includes(data.section ?? '') ? data.section! : 'report'
  const site = data.site
  // DASH-002: a new site's time zone starts as the zone the owner's browser reports, such as America/Chicago.
  const zoneFill = !site && section === 'report' && canPrepare(data.actor.role)
  const copyNonce = (site && section === 'settings') || zoneFill ? crypto.randomUUID() : ''
  const content = site
    ? `<div class="vane-heading"><div><p class="vane-eyebrow">Site analytics</p><h1>${escape(site.name)}</h1><p>${escape(site.origin)}</p></div><a href="/app">All sites</a></div><nav class="vane-tabs" aria-label="Site sections">${['report', 'settings', 'history', 'approvals'].map(item => `<a href="${siteLink(site.id, item)}"${item === section ? ' aria-current="page"' : ''}>${item[0].toUpperCase() + item.slice(1)}</a>`).join('')}</nav>${section === 'settings' ? settingsPage(data) : section === 'history' ? historyPage(data) : section === 'approvals' ? approvalsPage(data) : reportPage(data)}`
    : section === 'history' ? `<div class="vane-heading"><h1>Data history</h1><a href="/app">All sites</a></div>${globalHistoryPage(data)}` : section === 'approvals' ? `<div class="vane-heading"><h1>Approvals</h1><a href="/app">All sites</a></div>${approvalsPage(data)}` : section === 'audit' ? `<div class="vane-heading"><h1>Audit history</h1><a href="/app">All sites</a></div>${auditPage(data)}` : sitesPage(data)
  const html = `<!doctype html><html lang="en"${frame.htmlClass}><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light"><title>${escape(site?.name ?? (section === 'history' ? 'Data history' : section === 'approvals' ? 'Approvals' : section === 'audit' ? 'Audit history' : 'Sites'))} · Vane</title>${fontHead}${frame.head}<link rel="stylesheet" href="/vane.css"></head><body class="vane-app${!site && section === 'report' && !data.sites.length ? ' vane-empty-sites' : ''}">${appHeader(frame.brand, data.actor)}<main id="main" tabindex="-1">${data.store?.warn ? storeWarning(data.store) : ''}${data.notice ? `<div class="vane-notice" role="status">${escape(data.notice)}</div>` : ''}${data.error ? `<div class="vane-error" role="alert">${escape(data.error)}</div>` : ''}${content}</main>${appFooter}${copyNonce ? `<script nonce="${copyNonce}">${zoneFill ? browserZone : scriptCopy}</script>` : ''}</body></html>`
  return new Response(html, { headers: {
    'Content-Type': 'text/html; charset=utf-8',
    'Cache-Control': 'no-store',
    'Content-Security-Policy': `default-src 'none'; ${frame.policy}; script-src ${copyNonce ? `'nonce-${copyNonce}'` : "'none'"}; connect-src 'none'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'`,
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'same-origin',
  } })
}

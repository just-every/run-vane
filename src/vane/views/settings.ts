import { canPrepare, escape, field, operation, panel, siteLink, textarea } from './html'
import type { ViewData } from './types'
import { copyableScript } from './script-copy'

function select(label: string, name: string, value: number, options: number[]): string {
  return `<label>${escape(label)}<select name="${escape(name)}" aria-label="${escape(label)}" required>${options.map(option => `<option value="${option}"${option === value ? ' selected' : ''}>${option}</option>`).join('')}</select></label>`
}

export function configForm(site?: any): string {
  const config = site?.config ?? {}
  const goals = Object.entries(config.goals ?? {}).map(([name, path]) => `${name}=${path}`).join('\n')
  return `<form action="/app/action" method="post" class="vane-config-form">
    ${operation(site ? 'config.prepare' : 'site.prepare', site?.id)}
    <div class="vane-form-grid">${field('Site name', 'name', site?.name, 'required maxlength="120" autocomplete="organization"')}${field('Website origin', 'origin', site?.origin, 'type="url" required placeholder="https://example.com"')}</div>
    <p class="vane-help">Use the website’s origin, such as https://example.com. Include only paths and labels you intend to measure.</p>
    <div class="vane-form-grid">${textarea('Allowed paths', 'paths', (config.paths ?? []).join('\n'), 'One path per line, for example / or /thanks. Only configured paths are eligible for collection.')}
    ${textarea('Goals', 'goals', goals, 'One goal per line: signup=/thanks. A visit to the configured path records that goal; no extra event script is needed.')}</div>
    <div class="vane-form-grid">${textarea('Campaign labels', 'campaigns', (config.campaigns ?? []).join('\n'), 'One allowed campaign label per line.')}${textarea('Referring hostnames', 'sources', (config.sources ?? []).join('\n'), 'One allowed referring hostname per line, for example example.com.')}</div>
    <div class="vane-collection-options"><label>Consent<select name="consent" aria-label="Consent"><option value="required"${config.consent !== 'not-required' ? ' selected' : ''}>Consent required</option><option value="not-required"${config.consent === 'not-required' ? ' selected' : ''}>Consent not required</option></select></label>
    ${select('Sample rate (%)', 'sampleRate', config.sampleRate ?? 100, [10, 25, 50, 100])}${select('Retention (days)', 'retentionDays', config.retentionDays ?? 90, [30, 90, 365])}</div>
    <p class="vane-help">100% includes every eligible page load. Counts measure page loads, not unique people or sessions.</p>
    <div class="vane-form-footer"><p>Preparing this change sends it to the owner for approval before it takes effect.</p><button type="submit">${site ? 'Prepare settings change' : 'Prepare site'}</button></div>
  </form>`
}

export function sitesPage(data: ViewData): string {
  const listing = data.sites.length ? `<ul class="vane-sites">${data.sites.map(site => `<li><div><a class="vane-site-name" href="${siteLink(site.id)}">${escape(site.name)}</a>${site.awaitingFirstEvent ? ' <span class="vane-badge">Awaiting first event</span>' : ''}<p>${escape(site.origin)}</p></div><a href="${siteLink(site.id)}">Open report<span class="vane-sr-only"> for ${escape(site.name)}</span> →</a></li>`).join('')}</ul>` : '<div class="vane-sites-empty"><svg aria-hidden="true" width="40" height="40" viewBox="0 0 40 40" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M11 5h13l7 7v23H11z"/><path d="M24 5v8h7M16 20h10M16 25h10M16 30h10"/></svg><p class="vane-empty">No sites yet. Prepare a site and have its configuration approved to begin collecting visits.</p></div>'
  return `<div class="vane-heading vane-sites-heading"><div><p class="vane-eyebrow">Analytics</p><h1>Your sites</h1><p>See which pages, sources and campaigns lead to your goals.</p></div></div><div class="vane-sites-layout">${panel('Sites', listing)}${canPrepare(data.actor.role) ? panel('Add a site', configForm()) : '<p>An administrator or owner can prepare a site for collection.</p>'}</div>${(data.proposals ?? []).length ? `<p><a href="/app?section=approvals">Review proposed changes (${data.proposals!.length})</a></p>` : ''}`
}

export function settingsPage(data: ViewData): string {
  const site = data.site
  const snippet = `<script defer src="${data.origin.replace(/\/$/, '')}/vane.js" data-site="${site.id}"></script>`
  const consent = site.config?.consent !== 'not-required'
    ? '<p>This site requires consent. Set <code>window.vaneConsent = true</code> after consent has been granted and before the Vane script runs. Loads without consent are excluded.</p>'
    : '<p>This site is configured to collect eligible page loads without a consent flag.</p>'
  return `<div class="vane-settings-layout">${panel('Install the script', `<p>Add this script to pages on <strong>${escape(site.origin)}</strong>.</p>${copyableScript(snippet)}${consent}${canPrepare(data.actor.role) ? `<form action="/app/action" method="post">${operation('install.verify', site.id)}<p class="vane-help">Verify installation loads ${escape(site.origin)}/ from Vane, checks the script, site ID, origin, Content Security Policy, consent flag and path, then waits up to 60 seconds for a first page load: open the page in another tab while it waits.</p><button type="submit" class="vane-secondary">Verify installation</button></form>` : ''}<p>Conversions come from your configured goal paths. For example, map <code>signup=/thanks</code> to count visits to <code>/thanks</code> as signup conversions.</p>`)}${panel('Collection settings', canPrepare(data.actor.role) ? configForm(site) : `<dl><dt>Allowed paths</dt><dd>${escape((site.config?.paths ?? []).join(', ') || 'None')}</dd><dt>Goals</dt><dd>${escape(Object.entries(site.config?.goals ?? {}).map(([name, path]) => `${name}=${path}`).join(', ') || 'None')}</dd><dt>Campaign labels</dt><dd>${escape((site.config?.campaigns ?? []).join(', ') || 'None')}</dd><dt>Referring hostnames</dt><dd>${escape((site.config?.sources ?? []).join(', ') || 'None')}</dd><dt>Consent</dt><dd>${site.config?.consent !== 'not-required' ? 'Required' : 'Not required'}</dd><dt>Sample rate</dt><dd>${escape(site.config?.sampleRate ?? 100)}%</dd><dt>Retention</dt><dd>${escape(site.config?.retentionDays ?? 90)} days</dd></dl>`, `Configuration version ${site.version ?? 1}. Changes take effect after owner approval.`)}</div>`
}

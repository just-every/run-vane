import { canPrepare, count, escape, siteLink } from './html'
import { icon, type IconName } from './icons'
import { REPORT_GROUPS } from './report'
import type { ViewData } from './types'

// The left rail: the mark, the site switcher with its live count, the site's destinations and the account's.
// Native details keep the switcher and the phone menu working without JavaScript; on a wide screen the menu is
// always open.
const link = (href: string, name: IconName, label: string, current: boolean, extra = '') => `<a href="${escape(href)}"${current ? ' aria-current="page"' : ''}${extra}>${icon(name)}<span>${escape(label)}</span></a>`

export function appRail(brand: string, data: ViewData, section: string): string {
  const actor = data.actor, site = data.site, rollup = data.rollup
  const initial = Array.from(actor.displayName.trim())[0]?.toUpperCase() ?? ''
  const live = site && data.liveVisitors !== undefined ? `<span class="vane-live"><i aria-hidden="true"></i>${count(data.liveVisitors)} ${data.liveVisitors === 1 ? 'visitor' : 'visitors'} now</span>` : rollup ? `<span class="vane-live-quiet">${count(rollup.sites.length)} sites combined</span>` : `<span class="vane-live-quiet">${count(data.sites.length)} ${data.sites.length === 1 ? 'site' : 'sites'}</span>`
  const switcher = `<details class="vane-switcher"><summary><span class="vane-switcher-name">${escape(site?.name ?? rollup?.name ?? 'All sites')}</span>${live}</summary><ul>${data.sites.map(s => `<li><a href="${siteLink(s.id)}"${s.id === site?.id ? ' aria-current="true"' : ''}><strong title="${escape(s.name)}">${escape(s.name)}</strong><small title="${escape(s.origin)}">${escape(s.origin.replace(/^https?:\/\//, ''))}</small></a></li>`).join('')}${(data.rollups ?? []).map(r => `<li><a href="/app/rollups/${encodeURIComponent(r.id)}"${r.id === rollup?.id ? ' aria-current="true"' : ''}><strong>${escape(r.name)}</strong><small>Roll-up</small></a></li>`).join('')}<li><a href="/app"><strong>All sites</strong></a></li></ul></details>`
  // The report's groups are anchors in the Overview's document; elsewhere they open the Overview at that group.
  const base = rollup ? `/app/rollups/${encodeURIComponent(rollup.id)}` : site ? siteLink(site.id) : ''
  const onReport = section === 'report'
  const waiting = (data.proposals ?? []).filter(p => p.state === 'pending' || p.state === 'prepared').length
  const reportLinks = base ? `${link(onReport ? '#main' : base, 'overview', 'Overview', onReport, ' data-group="overview"')}${REPORT_GROUPS.map(([id, label, name, short]) => link(`${onReport ? '' : base}#${id}`, name as IconName, short ?? label, false, ` data-group="${id}"`)).join('')}` : ''
  const siteLinks = site && !rollup ? `${link(siteLink(site.id, 'realtime'), 'realtime', 'Real-time', section === 'realtime')}${link(siteLink(site.id, 'history'), 'history', 'History', section === 'history')}<a href="${siteLink(site.id, 'approvals')}"${section === 'approvals' ? ' aria-current="page"' : ''}>${icon('approvals')}<span>Approvals</span>${waiting ? `<span class="vane-count">${count(waiting)}</span>` : ''}</a>${link(siteLink(site.id, 'settings'), 'settings', 'Settings', section === 'settings')}` : ''
  const everywhere = `${actor.access === 'owner' ? link('/app?section=agency', 'sites', 'Agency clients', !site && section === 'agency') : ''}${link('/app', 'sites', 'All sites', !site && !rollup && section === 'report')}${link('/app?section=history', 'history', 'Data history', !site && section === 'history')}${actor.access === 'owner' || actor.access === 'admin' ? `${link('/app?section=team', 'team', 'Team', !site && section === 'team')}${link('/app?section=api', 'key', 'API keys', !site && section === 'api')}` : ''}${site && !rollup ? '' : `<a href="/app?section=approvals"${!site && section === 'approvals' ? ' aria-current="page"' : ''}>${icon('approvals')}<span>Approvals</span>${waiting ? `<span class="vane-count">${count(waiting)}</span>` : ''}</a>`}${link('/app?section=alerts', 'realtime', 'Browser alerts', !site && section === 'alerts')}${canPrepare(actor.role) ? link('/app?section=audit', 'audit', 'Audit history', !site && section === 'audit') : ''}`
  const person = `<div class="vane-person" aria-label="Signed in"><span class="vane-initial" aria-hidden="true">${escape(initial)}</span><span><strong>${escape(actor.displayName)}</strong><span class="vane-badge">${escape(actor.access ?? actor.role)}</span></span></div>`
  return `<a class="vane-skip" href="#main">Skip to content</a><aside class="vane-rail"><div class="vane-rail-top"><a class="vane-brand" href="/app" aria-label="Vane sites">${brand}</a><details class="vane-menu"><summary aria-label="Menu">${icon('menu')}</summary><div class="vane-menu-body">${data.sites.length || rollup ? switcher : ''}${reportLinks || siteLinks ? `<nav class="vane-nav" aria-label="${escape(site?.name ?? rollup?.name ?? 'Site')}">${reportLinks}${siteLinks}</nav>` : ''}<nav class="vane-nav vane-nav-account" aria-label="Account">${everywhere}</nav>${person}</div></details></div></aside>`
}

export const appFooter = '<footer class="vane-footer">Vane · No cookies, no visitor fingerprinting.</footer>'

import { date, escape, hidden, operation, panel } from './html'
import type { ViewData } from './types'

export const commands: Record<string, string> = {
  'site.prepare': 'Add site', 'site.create': 'Add site',
  'config.prepare': 'Update collection settings', 'site.configure': 'Update collection settings',
  'history.erase.prepare': 'Erase site history', 'history.erase': 'Erase site history',
  'site.delete.prepare': 'Delete site', 'site.delete': 'Delete site',
}

// A proposal's values as the owner reads them: named settings with plain values, never ids or raw JSON.
const LABELS: Record<string, string> = {
  name: 'Site name', origin: 'Address', paths: 'Counted paths', excludePaths: 'Excluded paths', goals: 'Goals', scrollGoals: 'Scroll-depth goals',
  consent: 'Consent', consentRegions: 'Consent regions', consentAdapter: 'Consent manager', sampleRate: 'Sample rate', retentionDays: 'Retention',
  signalCounter: 'Privacy-signal counter', timeZone: 'Time zone', currency: 'Currency', origins: 'Extra allowed addresses', rewrites: 'Rewrite rules',
  sourceRules: 'Source grouping rules', queryKeys: 'Kept query parameters', funnels: 'Funnels', eventDefinitions: 'No-code events', campaigns: 'Campaigns',
  autoEvents: 'Automatic events', searchParam: 'Site search parameter', experiments: 'Split tests', rates: 'Exchange rates', excludeCountries: 'Excluded countries',
}
const label = (key: string) => LABELS[key] ?? key.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/^./, c => c.toUpperCase()).replace(/ ([A-Z])/g, (_, c: string) => ` ${c.toLowerCase()}`)
function plain(key: string, value: unknown): string {
  if (value === null || value === undefined || value === '') return 'None'
  if (typeof value === 'boolean') return value ? 'On' : 'Off'
  if(key==='customGoals'&&typeof value==='object')return Object.entries(value as Record<string,any>).map(([name,g])=>`${name}: ${g.path?`page path equals ${g.path}`:`custom event equals ${g.event}`}${g.revenue?`; revenue required in ${g.currency}`:''}`).join('; ')||'None'
  if (key === 'sampleRate') return `${value}%`
  if (key === 'retentionDays') return `${value} days`
  if (key === 'consent') return value === 'not-required' ? 'Not required' : 'Required'
  if (Array.isArray(value)) return value.length ? value.map(item => item && typeof item === 'object' ? Object.values(item).map(v => Array.isArray(v) ? v.join(' > ') : String(v)).join(' ') : String(item)).join(', ') : 'None'
  if (typeof value === 'object') { const entries = Object.entries(value as Record<string, unknown>); return entries.length ? entries.map(([k, v]) => `${k}: ${v && typeof v === 'object' ? Object.values(v as object).join(' at ') : v}`).join(', ') : 'None' }
  return String(value)
}
function values(data: ViewData, proposal: any): string {
  let parsed: any
  try { parsed = JSON.parse(proposal.payload_json) } catch { return `<p>${escape(proposal.payload_json)}</p>` }
  const site = (data.sites ?? []).find(s => s.id === parsed?.siteId), config = parsed?.config ?? {}
  const rows: [string, string][] = [...(site && !parsed.name ? [['Site', site.name] as [string, string]] : []), ...(['name', 'origin'] as const).filter(k => parsed?.[k] !== undefined).map(k => [label(k), plain(k, parsed[k])] as [string, string])]
  // A settings change lists what differs from the site's settings now first; every value stays one fold away.
  const current = site?.config ?? {}, keys = Object.keys(config), changed = proposal.command.includes('config') || proposal.command === 'site.configure' ? keys.filter(k => JSON.stringify(config[k]) !== JSON.stringify(current[k])) : []
  const list = (pairs: [string, string][]) => `<dl>${pairs.map(([k, v]) => `<dt>${escape(k)}</dt><dd>${escape(v)}</dd>`).join('')}</dl>`
  const all = list([...rows, ...keys.map(k => [label(k), plain(k, config[k])] as [string, string])])
  return changed.length ? `${list(changed.map(k => [`${label(k)}`, `${plain(k, current[k])} → ${plain(k, config[k])}`]))}<details><summary>Every proposed setting</summary>${all}</details>` : all
}

export function approvalsPage(data: ViewData): string {
  const proposals = data.proposals ?? []
  if (!proposals.length) return panel('Approvals', '<p class="vane-empty">No proposed changes to review.</p>')
  return panel('Approvals', `<p>The owner reviews prepared changes before they take effect. Review the full proposed values below before approving.</p><div class="vane-proposals">${proposals.map(proposal => {
    const pending = proposal.state === 'pending' || proposal.state === 'prepared'
    const erase = String(proposal.command).includes('erase') || proposal.command === 'site.delete'
    const person = (name: unknown) => escape(name ?? 'Someone no longer on the team')
    return `<article class="vane-proposal" data-proposal="${escape(proposal.id)}"><div class="vane-row"><h3>${escape(commands[proposal.command] ?? proposal.command)}</h3><span class="vane-badge">${escape(proposal.state)}</span></div><dl><dt>Prepared by</dt><dd>${person(proposal.prepared_name)}</dd><dt>Prepared on</dt><dd>${date(proposal.created_at)}</dd>${proposal.approved_by ? `<dt>Approved by</dt><dd>${person(proposal.approved_name)}</dd><dt>Approved on</dt><dd>${date(proposal.approved_at)}</dd>` : ''}</dl><details${pending ? ' open' : ''}><summary>Proposed values</summary>${values(data, proposal)}</details>${proposal.command === 'site.delete' ? '<p>Approving deletion removes this site, its settings and all of its analytics history, and records a fence so no older archive brings it back. Download a site archive first to transfer it.</p>' : erase ? '<p>Approving erasure removes this site’s analytics history and records a fence against restoring erased data from older archives. Export any history you need first.</p>' : ''}${data.actor.role === 'owner' && pending ? `<div class="vane-actions"><form method="post" action="/app/action">${operation('proposal.approve')}${hidden('id', proposal.id)}<button type="submit"${erase ? ' class="vane-danger"' : ''}>${erase ? 'Approve erasure' : 'Approve change'}</button></form><form method="post" action="/app/action">${operation('proposal.reject')}${hidden('id', proposal.id)}<button class="vane-secondary" type="submit">Reject change</button></form></div>` : pending ? '<p class="vane-help">Waiting for owner approval.</p>' : ''}</article>`
  }).join('')}</div>`)
}

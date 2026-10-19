import { date, escape, hidden, operation, panel } from './html'
import type { ViewData } from './types'

export const commands: Record<string, string> = {
  'site.prepare': 'Add site', 'site.create': 'Add site',
  'config.prepare': 'Update collection settings', 'site.configure': 'Update collection settings',
  'history.erase.prepare': 'Erase site history', 'history.erase': 'Erase site history',
  'site.delete.prepare': 'Delete site', 'site.delete': 'Delete site',
}

function payload(value: unknown): string {
  let parsed = value
  if (typeof value === 'string') {
    try { parsed = JSON.parse(value) } catch { return escape(value) }
  }
  return escape(JSON.stringify(parsed, null, 2))
}

export function approvalsPage(data: ViewData): string {
  const proposals = data.proposals ?? []
  if (!proposals.length) return panel('Approvals', '<p class="vane-empty">No proposed changes to review.</p>')
  return panel('Approvals', `<p>The owner reviews prepared changes before they take effect. Review the full proposed values below before approving.</p><div class="vane-proposals">${proposals.map(proposal => {
    const pending = proposal.state === 'pending' || proposal.state === 'prepared'
    const erase = String(proposal.command).includes('erase') || proposal.command === 'site.delete'
    return `<article class="vane-proposal"><div class="vane-row"><h3>${escape(commands[proposal.command] ?? proposal.command)}</h3><span class="vane-badge">${escape(proposal.state)}</span></div><dl><dt>Proposal</dt><dd>${escape(proposal.id)}</dd><dt>Prepared by</dt><dd>${escape(proposal.prepared_by)}</dd><dt>Prepared on</dt><dd>${date(proposal.created_at)}</dd>${proposal.approved_by ? `<dt>Approved by</dt><dd>${escape(proposal.approved_by)}</dd><dt>Approved on</dt><dd>${date(proposal.approved_at)}</dd>` : ''}</dl><details${pending ? ' open' : ''}><summary>Proposed values</summary><pre class="vane-code"><code>${payload(proposal.payload_json)}</code></pre></details>${proposal.command === 'site.delete' ? '<p>Approving deletion removes this site, its settings and all of its analytics history, and records a fence so no older archive brings it back. Download a site archive first to transfer it.</p>' : erase ? '<p>Approving erasure removes this site’s analytics history and records a fence against restoring erased data from older archives. Export any history you need first.</p>' : ''}${data.actor.role === 'owner' && pending ? `<div class="vane-actions"><form method="post" action="/app/action">${operation('proposal.approve')}${hidden('id', proposal.id)}<button type="submit"${erase ? ' class="vane-danger"' : ''}>${erase ? 'Approve erasure' : 'Approve change'}</button></form><form method="post" action="/app/action">${operation('proposal.reject')}${hidden('id', proposal.id)}<button class="vane-secondary" type="submit">Reject change</button></form></div>` : pending ? '<p class="vane-help">Waiting for owner approval.</p>' : ''}</article>`
  }).join('')}</div>`)
}

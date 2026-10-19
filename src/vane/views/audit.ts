import { escape, panel } from './html'
import { commands } from './approvals'
import type { ViewData } from './types'

// S5: each action by its readable name; the slug stays on the row for scripts (data-action), never as its text.
const ACTIONS: Record<string, string> = {
  'sign-in': 'Signed in', 'agent.prepare': 'Agent prepared a change', 'proposal.prepare': 'Prepared a change', 'proposal.approve': 'Approved a change', 'proposal.reject': 'Rejected a change',
  'settings.change': 'Changed settings', 'site.create': 'Added a site', 'site.delete': 'Deleted a site', 'site.export': 'Downloaded a site archive', 'site.import': 'Imported a site archive',
  'history.erase': 'Erased site history', 'history.export': 'Exported all history', 'history.restore': 'Restored history', 'history.retention': 'Ran retention',
  'import.apply': 'Imported history', 'import.undo': 'Undid an import', 'annotation.add': 'Added a note', 'annotation.delete': 'Deleted a note',
  'annotation-hook.create': 'Created the annotation secret', 'annotation-hook.revoke': 'Revoked the annotation secret', 'annotation-github.create': 'Created the GitHub key', 'annotation-github.revoke': 'Revoked the GitHub key',
  'apikey.create': 'Created an API key', 'apikey.revoke': 'Revoked an API key', 'segment.save': 'Saved a segment', 'segment.delete': 'Deleted a segment', 'rollup.create': 'Created a roll-up',
  'share.create': 'Created a shared link', 'share.revoke': 'Revoked a shared link', 'export.configure': 'Set up the scheduled export', 'export.delete': 'Removed the scheduled export', 'scheduled-export': 'Scheduled export ran',
  'webhook.create': 'Added a webhook', 'webhook.delete': 'Removed a webhook', 'report.subscribe': 'Subscribed to email reports', 'report.unsubscribe': 'Unsubscribed from email reports', 'unsubscribe-link': 'Unsubscribed by email link',
  'team.invite': 'Invited a person', 'team.grant': 'Changed a person’s access', 'team.remove': 'Removed a person', 'team.transfer': 'Transferred ownership',
}
const action = (slug: string) => ACTIONS[slug] ?? slug.replace(/[._-]+/g, ' ').replace(/^./, c => c.toUpperCase())
const when = (at: number) => new Date(at).toLocaleString('en-US', { timeZone: 'UTC', month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' })
const subject = (entry: any) => entry.subjectName ?? (entry.subjectCommand ? commands[entry.subjectCommand] ?? 'A change' : entry.subject === 'installation' ? 'This installation' : /^[0-9a-f-]{20,}$/i.test(String(entry.subject ?? '')) ? '—' : entry.subject)
function detail(text: unknown): string {
  try { const value = JSON.parse(String(text)); if (value && typeof value === 'object') return Object.entries(value).map(([k, v]) => `${k.replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase()}: ${Array.isArray(v) ? v.join(', ') : v && typeof v === 'object' ? Object.values(v).join(', ') : v}`).join('; ') } catch { /* plain text */ }
  return String(text ?? '')
}

export function auditPage(data: ViewData): string {
  const entries = data.audit ?? []
  if (!entries.length) return panel('Audit history', '<p class="vane-empty">No audited actions yet.</p>')
  return panel('Audit history', `<div class="vane-table-scroll" role="region" aria-label="Audit history" tabindex="0"><table data-audit><caption class="vane-sr-only">Audit history</caption><thead><tr><th scope="col">Time (UTC)</th><th scope="col">By</th><th scope="col">Action</th><th scope="col">Subject</th><th scope="col">Detail</th></tr></thead><tbody>${entries.map(entry => `<tr><td>${escape(when(Number(entry.at)))}</td><td>${escape(entry.actorKnown ?? (/^[0-9a-f-]{20,}$/i.test(String(entry.actor)) ? 'Someone no longer on the team' : action(String(entry.actor))))}</td><th scope="row" data-action="${escape(entry.action)}">${escape(action(entry.action))}</th><td>${escape(subject(entry))}</td><td>${escape(detail(entry.detail))}</td></tr>`).join('')}</tbody></table></div>`, 'Every proposal and approval, setting change, import and undo, export, restore, erasure, retention run, sign-in and agent action. Entries survive history erasure and travel in the archive.')
}

import { escape, panel } from './html'
import type { ViewData } from './types'

export function auditPage(data: ViewData): string {
  const entries = data.audit ?? []
  if (!entries.length) return panel('Audit history', '<p class="vane-empty">No audited actions yet.</p>')
  return panel('Audit history', `<div class="vane-table-scroll" role="region" aria-label="Audit history" tabindex="0"><table><caption class="vane-sr-only">Audit history</caption><thead><tr><th scope="col">Time (UTC)</th><th scope="col">Actor</th><th scope="col">Action</th><th scope="col">Subject</th><th scope="col">Detail</th></tr></thead><tbody>${entries.map(entry => `<tr><td>${escape(new Date(Number(entry.at)).toISOString().replace('T', ' ').slice(0, 19))}</td><td>${escape(entry.actorName)}</td><th scope="row">${escape(entry.action)}</th><td>${escape(entry.subject)}</td><td>${escape(entry.detail)}</td></tr>`).join('')}</tbody></table></div>`, 'Every proposal and approval, setting change, import and undo, export, restore, erasure, retention run, sign-in and agent action. Entries survive history erasure and travel in the archive.')
}

import { escape } from './html'
import type { ViewData } from './types'

/** Native details keeps account destinations available on a phone without JavaScript. */
export function appHeader(brand: string, actor: ViewData['actor']): string {
  const initial = Array.from(actor.displayName.trim())[0]?.toUpperCase() ?? ''
  return `<a class="vane-skip" href="#main">Skip to content</a><header class="vane-header"><a class="vane-brand" href="/app" aria-label="Vane sites">${brand}</a><details class="vane-account"><summary aria-label="Account for ${escape(actor.displayName)}">${escape(initial)}</summary><nav aria-label="Account"><span>${escape(actor.displayName)} <span class="vane-badge">${escape(actor.access ?? actor.role)}</span></span><a href="/app?section=history">Data history</a>${actor.access === 'owner' || actor.access === 'admin' ? '<a href="/app?section=team">Team</a><a href="/app?section=api">API keys</a>' : ''}<a href="/app?section=approvals">Approvals</a></nav></details></header>`
}

export const appFooter = '<footer class="vane-footer">Vane · Visits count page loads. No visitor fingerprinting.</footer>'

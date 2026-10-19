import { escape, field, hidden, operation, panel } from './html'
import type { ViewData } from './types'

// API-001: Stats API keys for chosen sites and, for the owner, provisioning keys; a new key is shown once.
export function apiKeysPage(data: ViewData): string {
  const owner = data.actor.access === 'owner', keys = data.apiKeys ?? []
  const created = data.apiToken ? panel('New key', `<p>Copy this key now: it is not shown again.</p><p><code data-api-key>${escape(data.apiToken)}</code></p>`) : ''
  const rows = keys.map(key => `<tr><td>${escape(key.label)}</td><td>${key.kind === 'stats' ? 'Stats (read-only)' : 'Provisioning'}</td><td>${escape(key.site_ids ? (JSON.parse(key.site_ids) as string[]).map(id => data.sites.find(site => site.id === id)?.name ?? id).join(', ') : 'Creates sites')}</td><td>${escape(key.creator)}</td><td class="vane-number">${Number(key.today ?? 0)}</td><td>${key.revoked_at ? 'Revoked' : `<form action="/app/action" method="post">${operation('apikey.revoke')}${hidden('id', key.id)}<button type="submit" class="vane-secondary">Revoke</button></form>`}</td></tr>`).join('')
  const table = keys.length ? `<div class="vane-table-scroll" role="region" aria-label="API keys" tabindex="0"><table><caption class="vane-sr-only">API keys</caption><thead><tr><th scope="col">Name</th><th scope="col">Kind</th><th scope="col">Sites</th><th scope="col">Created by</th><th scope="col" class="vane-number">Requests today (UTC)</th><th scope="col">State</th></tr></thead><tbody>${rows}</tbody></table></div>` : '<p class="vane-empty">No API keys yet.</p>'
  const form = `<form action="/app/action" method="post">${operation('apikey.create')}${field('Key name', 'label', '', 'required maxlength="60"')}<label>Kind<select name="kind">${'<option value="stats">Stats API: read-only, chosen sites</option>'}${owner ? '<option value="provisioning">Provisioning: creates sites, goals and shared links</option>' : ''}</select></label><fieldset><legend>Sites a Stats API key reads</legend>${data.sites.map(site => `<label><input type="checkbox" name="site_${escape(site.id)}"> ${escape(site.name)}</label>`).join('')}</fieldset><button type="submit">Create key</button></form>`
  return `${created}${panel('API keys', table, 'Keys are sent as Authorization: Bearer. The API is described at /api/v1/openapi.json, with its rate limits.')}${panel('Create a key', form)}`
}

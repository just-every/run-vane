import { canPrepare, date, escape, field, hidden, operation, panel } from './html'
import type { ViewData } from './types'
import { WEBHOOK_EVENTS } from '../webhooks'
// API-003: a site's signed webhooks and their delivery log, for owners and administrators. A new signing secret is
// shown once.
export function webhookPanel(data: ViewData): string {
  if (!canPrepare(data.actor.role) || !data.webhooks) return ''
  const site = data.site
  const shown = data.webhookSecret ? `<p role="status">Copy this signing secret now; it is not shown again.</p><p><code data-webhook-secret>${escape(data.webhookSecret)}</code></p>` : ''
  const list = data.webhooks.length ? `<ul data-webhooks>${data.webhooks.map(hook => `<li><code>${escape(hook.url)}</code>: ${escape((JSON.parse(hook.events_json) as string[]).join(', '))}; added ${date(hook.created_at)} <form class="vane-inline-form" action="/app/action" method="post">${operation('webhook.delete')}${hidden('id', hook.id)}<button>Delete</button></form></li>`).join('')}</ul>` : '<p>No webhooks yet.</p>'
  const log = data.webhookLog?.length ? `<div class="vane-table-scroll" role="region" aria-label="Webhook deliveries" tabindex="0"><table data-webhook-log><caption class="vane-sr-only">Webhook deliveries</caption><thead><tr><th scope="col">Time</th><th scope="col">Event</th><th scope="col">Delivery</th><th scope="col" class="vane-number">Attempt</th><th scope="col" class="vane-number">Status</th><th scope="col">Outcome</th></tr></thead><tbody>${data.webhookLog.map(a => `<tr><td>${escape(new Date(a.at).toISOString().replace('T', ' ').slice(0, 16))} UTC</td><td>${escape(a.event)}</td><td><code>${escape(a.delivery_id)}</code></td><td class="vane-number">${a.attempt}</td><td class="vane-number">${a.status ?? '—'}</td><td>${escape(a.outcome)}</td></tr>`).join('')}</tbody></table></div>` : '<p class="vane-empty">No deliveries yet.</p>'
  const form = `<form action="/app/action" method="post">${operation('webhook.create', site.id)}${field('Endpoint', 'url', '', 'type="url" required maxlength="1000" placeholder="https://hooks.example.com/vane"')}<fieldset><legend>Events</legend>${Object.entries(WEBHOOK_EVENTS).map(([key, title]) => `<label class="vane-check"><input type="checkbox" name="event_${escape(key)}" checked> ${escape(title)}</label>`).join('')}</fieldset><button>Add webhook</button></form>`
  return panel('Webhooks', `${shown}${list}${form}<p class="vane-help">Each delivery is a JSON POST signed with <code>Vane-Signature: t=&lt;unix time&gt;,v1=&lt;HMAC-SHA256 of t.body&gt;</code>; <code>Vane-Delivery</code> stays the same on retries. Goal conversions arrive as counts per goal and minute, never per person. A failed delivery is retried after 1, 5 and 30 minutes, 2 and 6 hours.</p><h3>Deliveries</h3>${log}`)
}

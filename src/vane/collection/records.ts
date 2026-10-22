import { isProxied } from '../proxy/ingress'
import { goalApplies } from '../goals'
import { propertiesMatch } from '../properties'
import type { RawRecord } from '../raw'
import type { PreparedPageview } from './context'

export function pageviewRecord(request: Request, plan: PreparedPageview): RawRecord {
 const { event: e, value, payload, today, visitor, now, device: d, geo, identity } = plan
 return { id: plan.eventId, site_id: value.id, day: today, kind: 'pageview', path: e.path, source: e.source, campaign: e.campaign,
  consent: payload.consent, sample_rate: value.config.sampleRate, visitor, at: now, device: d.device, browser: d.browser, browser_version: d.browserVersion,
  os: d.os, os_version: d.osVersion, screen: d.screen, search: plan.search, hostname: e.hostname, utm_source: e.utmSource, utm_medium: e.utmMedium,
  utm_term: e.utmTerm, utm_content: e.utmContent, paid_click: e.paidClick, query: e.query, channel: plan.channel, referrer: e.referrer,
  country: geo.country, region: geo.region, city: geo.city, metro_code: geo.metro_code, consented_visitor: identity?.hash ?? null,
  consented_created_at: identity?.createdAt ?? null, consented_expires_at: identity?.expiresAt ?? null, transport: isProxied(request) ? 'proxy' : 'direct' }
}
export function goalRecords(page: RawRecord, plan: PreparedPageview): RawRecord[] {
 const goals = [...Object.entries(plan.value.config.goals), ...Object.entries(plan.value.config.customGoals ?? {})
  .filter(([, goal]) => goal.path && goal.depth === undefined && propertiesMatch(goal.props, plan.props.kept))
  .map(([name, goal]) => [name, goal.path!] as [string, string])]
 return goals.filter(([, goal]) => goalApplies(goal, plan.event.hostname, plan.event.path)).map(([kind]) => ({ ...page, id: page.id + ':' + kind, kind, search: null }))
}

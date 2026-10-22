import { consentedIdentity } from '../consented'
import { insist, VaneError, type Site } from '../core'
import type { TrafficReason } from '../traffic'
import { cleanProps } from '../properties'
import { channelOf, webmail } from '../channels'
import { hostOf, keptValue, pathAllowed, redactPath, storedPath, visitSource } from '../paths'
import { paymentReferrer } from '../revenue'
import { searchTerm } from '../search'
import { validationContext } from './validation-context'

export class CollectionRefusal extends VaneError {
 constructor(code: string, message: string, status: number, public reason: 'excluded-path' | TrafficReason) { super(code, message, status) }
}

// Validation has no storage side effects. A batch completes this for every
// record before creating salts or preparing any admission writes.
export async function validatePageview(request: Request, value: Site, origin: string, payload: any, now: number, context = validationContext(request, now)) {
 insist(payload && typeof payload === 'object' && !Array.isArray(payload) && Object.keys(payload).every(key => ['id','siteId','path','source','referrer','campaign','utm','ref','click','query','consent','width','search','props','consented'].includes(key)), 'fields', 'Only the declared anonymous fields are accepted.')
 insist(request.headers.get('dnt') !== '1' && request.headers.get('sec-gpc') !== '1', 'privacy_signal', 'Privacy signals stop pageview collection; an enabled counter accepts only its separate field-free request.', 403)
 const utm = payload.utm ?? {}, query = payload.query ?? {}
 insist(utm && typeof utm === 'object' && !Array.isArray(utm) && Object.keys(utm).every(key => ['source','medium','term','content'].includes(key)), 'utm', 'UTM fields are source, medium, term and content; the campaign is its own field.')
 insist(query && typeof query === 'object' && !Array.isArray(query) && Object.keys(query).every(key => (value.config.queryKeys ?? []).includes(key)), 'query', 'Only the query parameters this site keeps are accepted.')
 insist(payload.click === undefined || payload.click === true, 'click', 'The paid-click flag is true or absent.')
 insist(typeof payload.path === 'string' && /^\/[^?#\s]{0,1023}$/.test(payload.path), 'path', 'Send the page path without its query or fragment.')
 insist(payload.search === undefined || Boolean(value.config.searchParam) && typeof payload.search === 'string' && payload.search.trim().length > 0 && payload.search.length <= 100, 'search', 'Search terms are accepted only for a named site-search parameter, up to 100 characters.')
 insist(payload.width === undefined || Number.isInteger(payload.width) && payload.width >= 0 && payload.width <= 10000, 'width', 'The viewport width is a whole number of CSS pixels.')
 insist(typeof payload.id === 'string' && /^[a-f0-9-]{36}$/.test(payload.id), 'event_id', 'A fresh UUID identifies each page load.')
 const path = storedPath(value.config, payload.path), utmSource = keptValue(utm.source)
 if (!pathAllowed(value.config, path)) throw new CollectionRefusal('path', 'This path is not collected for this site.', 403, 'excluded-path')
 let referrer: URL | null = null
 if (payload.referrer !== undefined) {
  try { referrer = new URL(String(payload.referrer)) } catch { /* A malformed address is refused below. */ }
  insist(referrer && ['http:','https:','android-app:'].includes(referrer.protocol) && !referrer.username && !referrer.password && String(payload.referrer).length <= 1100, 'referrer', 'Send the referring page as a web address without credentials.')
 }
 const own = context.ownHosts(value)
 const refHost = referrer ? (referrer.protocol === 'android-app:' ? 'android-app://' : '') + referrer.hostname.toLowerCase() : payload.source
 const mail = typeof refHost === 'string' && webmail(refHost), kept = Object.keys(query).sort().flatMap(key => { const v = keptValue(query[key]); return v === null ? [] : [key + '=' + v] })
 const excluded = context.excluded(value, typeof refHost === 'string' && !refHost.startsWith('android-app://') ? refHost : null)
 if (excluded) throw new CollectionRefusal('excluded', `This traffic is excluded from collection (${excluded}).`, 403, excluded)
 insist(context.consent(value, payload.consent), 'consent', 'Consent is required for collection.', 403)
 const event = { hostname: hostOf(origin), path, source: mail && !utmSource && !keptValue(payload.ref) ? 'webmail' : visitSource(utmSource, keptValue(payload.ref), refHost, own), referrer: referrer && referrer.protocol !== 'android-app:' && !mail && !own.includes(referrer.hostname.toLowerCase()) ? referrer.hostname.toLowerCase() + redactPath(referrer.pathname || '/') : null, campaign: keptValue(payload.campaign) ?? 'none', utmSource, utmMedium: keptValue(utm.medium), utmTerm: keptValue(utm.term), utmContent: keptValue(utm.content), paidClick: payload.click ? 1 : 0, query: kept.length ? kept.join('&') : null }
 const identity = await consentedIdentity(value, request, payload, now)
 return { value, payload, event, identity, now, today: context.today(value), eventId: value.id + ':' + payload.id,
  props: cleanProps(payload.props), device: context.device(payload.width), geo: context.location(), search: payload.search === undefined ? null : searchTerm(payload.search),
  payment: !utmSource && !keptValue(payload.ref) && paymentReferrer(refHost), channel: channelOf(event.source, event.utmMedium, event.paidClick === 1) }
}
export type ValidatedPageview = Awaited<ReturnType<typeof validatePageview>>
export function samePageview(prior: { path: string; source: string; campaign: string }, current: ValidatedPageview) {
 return prior.path === current.event.path && (current.payment || prior.source === current.event.source) && prior.campaign === current.event.campaign
}

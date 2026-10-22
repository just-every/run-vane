import { digest, type Env } from '../core'
import { visitorHash } from '../visitors'
import { channelOf } from '../channels'
import { assignments } from '../experiments'
import type { ValidatedPageview } from './validation'

type Acquisition = Pick<ValidatedPageview['event'], 'source' | 'referrer' | 'campaign' | 'utmSource' | 'utmMedium' | 'utmTerm' | 'utmContent' | 'paidClick'> & { channel: string }
export function collectionContext(request: Request, env: Env) {
 const visitors = new Map<string, Promise<string>>(), acquisitions = new Map<string, { at: number; id: string; data: Acquisition } | null>(), loaded = new Set<string>()
 return { async resolve(plan: ValidatedPageview, observe = true) {
  const { value, today, identity, now } = plan, key = JSON.stringify([value.id, today, identity?.hash ?? null])
  let visitor = visitors.get(key)
  if (!visitor) { visitor = identity ? digest(today + '\0' + identity.hash) : visitorHash(env, value, request, today, now); visitors.set(key, visitor) }
  const hash = await visitor
  if (plan.payment) {
   if (!loaded.has(key)) {
    const prior = await env.DB.prepare("SELECT id,at,source,referrer,campaign,utm_source,utm_medium,utm_term,utm_content,paid_click,channel FROM vane_events WHERE site_id=? AND day=? AND visitor=? AND kind='pageview' ORDER BY at DESC,id DESC LIMIT 1").bind(value.id, today, hash).first<any>()
    const earlier = acquisitions.get(key)
    if (!earlier || prior && (prior.at > earlier.at || prior.at === earlier.at && prior.id > earlier.id)) acquisitions.set(key, prior ? { at: prior.at, id: prior.id, data: { source: prior.source, referrer: prior.referrer, campaign: prior.campaign, utmSource: prior.utm_source, utmMedium: prior.utm_medium, utmTerm: prior.utm_term, utmContent: prior.utm_content, paidClick: prior.paid_click, channel: prior.channel } } : null)
    loaded.add(key)
   }
   const before = acquisitions.get(key)
   Object.assign(plan.event, before?.data ?? { source: 'direct', referrer: null, campaign: 'none', utmSource: null, utmMedium: null, utmTerm: null, utmContent: null, paidClick: 0 })
   plan.channel = before?.data.channel ?? channelOf('direct', null, false)
  }
  const prior = acquisitions.get(key)
  if (observe && (!prior || now > prior.at || now === prior.at && plan.eventId > prior.id)) acquisitions.set(key, { at: now, id: plan.eventId, data: { ...plan.event, channel: plan.channel } })
  return { ...plan, visitor: hash, experiments: await assignments(value.config.experiments, identity?.hash ?? hash, plan.event.hostname, plan.event.path) }
 } }
}
export type PreparedPageview = Awaited<ReturnType<ReturnType<typeof collectionContext>['resolve']>>

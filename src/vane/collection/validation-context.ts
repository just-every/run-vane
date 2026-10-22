import { consentAccepted } from '../consent'
import type { Site } from '../core'
import { deviceOf, type Device } from '../devices'
import { locationOf, type Location } from '../locations'
import { hostOf } from '../paths'
import { excludedTraffic, type TrafficReason } from '../traffic'
import { localDay } from '../visitors'

// Only share within one request and timestamp, using the same immutable Site
// objects. Compute lazily so every record reaches these checks in the same order.
export function validationContext(request: Request, now: number) {
 const hosts = new WeakMap<Site, string[]>(), days = new WeakMap<Site, string>()
 const traffic = new WeakMap<Site, Map<string | null, TrafficReason | null>>()
 const consents = new WeakMap<Site, Map<unknown, boolean>>()
 const devices = new Map<number | undefined, Device>()
 let geo: Location | undefined
 return {
  ownHosts(value: Site) {
   let own = hosts.get(value)
   if (!own) { own = [value.origin, ...(value.config.origins ?? [])].map(hostOf); hosts.set(value, own) }
   return own
  },
  today(value: Site) {
   let day = days.get(value)
   if (day === undefined) { day = localDay(now, value.config.timeZone ?? 'UTC'); days.set(value, day) }
   return day
  },
  excluded(value: Site, referrerHost: string | null) {
   let cache = traffic.get(value)
   if (!cache) { cache = new Map(); traffic.set(value, cache) }
   let reason = cache.get(referrerHost)
   if (reason === undefined) { reason = excludedTraffic(request, value.config, referrerHost); cache.set(referrerHost, reason) }
   return reason
  },
  consent(value: Site, given: unknown) {
   let cache = consents.get(value)
   if (!cache) { cache = new Map(); consents.set(value, cache) }
   let accepted = cache.get(given)
   if (accepted === undefined) { accepted = consentAccepted(value.config, request, given); cache.set(given, accepted) }
   return accepted
  },
  device(width: number | undefined) {
   let device = devices.get(width)
   if (!device) { device = deviceOf(request.headers.get('user-agent') ?? '', width); devices.set(width, device) }
   return device
  },
  location() {
   if (!geo) geo = locationOf(request)
   return geo
  },
 }
}

import { consentAccepted } from '../consent'
import { siteOrigin, type Site } from '../core'
import { channelOf } from '../channels'
import { deviceOf, type Device } from '../devices'
import { locationOf, type Location } from '../locations'
import { hostOf, storedPath } from '../paths'
import { excludedTraffic, type TrafficReason } from '../traffic'
import { localDay } from '../visitors'

// Only share within one request and timestamp, using the same immutable Site
// objects. Compute lazily so every record reaches these checks in the same order.
export function validationContext(request: Request, now: number) {
 const hosts = new WeakMap<Site, string[]>(), days = new WeakMap<Site, string>()
 const paths = new WeakMap<Site, Map<string, string>>(), origins = new WeakMap<Site, string>()
 const originHosts = new Map<string, string>(), channels = new Map<string, string>()
 const traffic = new WeakMap<Site, Map<string | null, TrafficReason | null>>()
 const consents = new WeakMap<Site, Map<unknown, boolean>>()
 const devices = new Map<number | undefined, Device>()
 let geo: Location | undefined
 function hostname(origin: string) {
  let host = originHosts.get(origin)
  if (host === undefined) { host = hostOf(origin); originHosts.set(origin, host) }
  return host
 }
 return {
  hostname,
  origin(value: Site) {
   let origin = origins.get(value)
   if (origin === undefined) { origin = siteOrigin(value, request); origins.set(value, origin) }
   return origin
  },
  ownHosts(value: Site) {
   let own = hosts.get(value)
   if (!own) { own = [value.origin, ...(value.config.origins ?? [])].map(hostname); hosts.set(value, own) }
   return own
  },
  path(value: Site, input: string) {
   let cache = paths.get(value)
   if (!cache) { cache = new Map(); paths.set(value, cache) }
   let path = cache.get(input)
   if (path === undefined) { path = storedPath(value.config, input); cache.set(input, path) }
   return path
  },
  channel(source: string, medium: string | null, paidClick: boolean) {
   const key = JSON.stringify([source, medium, paidClick])
   let channel = channels.get(key)
   if (channel === undefined) { channel = channelOf(source, medium, paidClick); channels.set(key, channel) }
   return channel
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

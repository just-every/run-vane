import { escape, panel } from './html'
import type { ViewData } from './types'
// RETENTION-002: how full the store is against its published capacity (COLLECT-004). From 80%, every app page names
// the two ways to make room: a site's scheduled warehouse export (API-002, in its settings) or a shorter window.
const megabytes = (bytes: number) => `${(bytes / 1048576).toLocaleString('en-US', { maximumFractionDigits: 2 })} MB`

export const storeWarning = (store: NonNullable<ViewData['store']>) => `<div class="vane-error" role="alert" data-store-share="${store.share}">The analytics store is ${escape(store.share.toFixed(1))}% full (${megabytes(store.bytes)} of its ${megabytes(store.limit)} capacity). Before it fills, choose one: a scheduled warehouse export of older events to your own S3 or R2 bucket, or a shorter retention window, both in a site’s settings. Vane never drops or rolls up events to make room.</div>`

export function storePanel(data: ViewData): string {
  const store = data.store
  if (!store) return ''
  return panel('Store capacity', `<p data-store-bytes="${store.bytes}" data-store-limit="${store.limit}">${megabytes(store.bytes)} of ${megabytes(store.limit)} (${escape(store.share.toFixed(1))}%). The capacity is D1’s database size limit on Workers Paid; on Workers Free set VANE_STORE_LIMIT_MB to 500. From 80% every app page warns; Vane never drops or rolls up events to make room.</p>`)
}

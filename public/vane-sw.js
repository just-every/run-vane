// MOBILE-001: the installed app's service worker. It caches nothing; it shows web-push alerts (title, site name and a
// link into this installation) and opens the alert's link when the notification is chosen.
self.addEventListener('install', () => self.skipWaiting())
self.addEventListener('activate', event => event.waitUntil(self.clients.claim()))
self.addEventListener('push', event => {
  let alert = null
  try { alert = event.data ? event.data.json() : null } catch { alert = null }
  if (!alert || typeof alert.title !== 'string') return
  event.waitUntil(self.registration.showNotification(alert.title, { body: String(alert.site ?? ''), data: { link: String(alert.link ?? '/app') }, icon: '/brand/icon-192.png' }))
})
self.addEventListener('notificationclick', event => {
  event.notification.close()
  const link = new URL(event.notification.data?.link ?? '/app', self.location.origin)
  if (link.origin === self.location.origin) event.waitUntil(self.clients.openWindow(link.href))
})

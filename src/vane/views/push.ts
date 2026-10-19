import { date, escape, operation, panel } from './html'
import type { ViewData } from './types'

// MOBILE-001: browser alerts. Turning them on registers the service worker, asks the browser for permission and
// sends its push subscription to this installation; each browser that receives alerts is listed and can be removed.
export function pushPage(data: ViewData): string {
  const browsers = data.pushSubscriptions ?? []
  const status = `<p data-push-status role="status">${browsers.length ? `Alerts are on in ${browsers.length === 1 ? 'one browser' : `${browsers.length} browsers`}.` : 'Alerts are off in every browser.'}</p>`
  const controls = `<div data-push data-key="${escape(data.pushKey ?? '')}"><p>Install Vane from your browser’s menu (Install app or Add to Home Screen) to open it like an app. Alerts carry only the alert, the site name and a link; never visitor data.</p>${status}<p><button type="button" data-push-on>Turn on alerts in this browser</button> <button type="button" data-push-off>Turn off alerts in this browser</button></p></div>`
  const rows = browsers.map(b => `<tr><td>${escape(b.host)}</td><td>${date(b.createdAt)}</td><td><form action="/app/action" method="post">${operation('push.remove')}<input type="hidden" name="id" value="${escape(b.id)}"><button type="submit">Remove</button></form></td></tr>`).join('')
  const table = browsers.length ? `<div class="vane-table-scroll" role="region" aria-label="Browsers with alerts" tabindex="0"><table><caption class="vane-sr-only">Browsers with alerts</caption><thead><tr><th scope="col">Push service</th><th scope="col">Turned on</th><th scope="col">Action</th></tr></thead><tbody>${rows}</tbody></table></div>` : '<p>No browser receives alerts yet.</p>'
  const test = data.sites.length && browsers.length ? panel('Send a test alert', `<form action="/app/action" method="post">${operation('push.test')}<label>Site<select name="siteId">${data.sites.map(s => `<option value="${escape(s.id)}">${escape(s.name)}</option>`).join('')}</select></label><button type="submit">Send a test alert</button></form>`, 'Sent only to your own browsers.') : ''
  return `${panel('This browser', controls)}${panel('Your browsers', table)}${test}`
}

// Runs under the page's nonce. The subscription is sent to this origin only; the browser keeps its private key.
export const pushScript = `(()=>{const box=document.querySelector('[data-push]'),say=t=>{document.querySelector('[data-push-status]').textContent=t};if(!box)return;
const ready=('serviceWorker' in navigator)&&('PushManager' in window)&&('Notification' in window);if(!ready){say('This browser cannot receive alerts.');return}
const key=Uint8Array.from(atob(box.dataset.key.replace(/-/g,'+').replace(/_/g,'/')),c=>c.charCodeAt(0));
box.querySelector('[data-push-on]').addEventListener('click',async()=>{try{const reg=await navigator.serviceWorker.register('/vane-sw.js',{scope:'/'});await navigator.serviceWorker.ready;
if(await Notification.requestPermission()!=='granted'){say('The browser did not allow notifications, so alerts stay off.');return}
const sub=await reg.pushManager.subscribe({userVisibleOnly:true,applicationServerKey:key}),r=await fetch('/api/vane/push/subscribe',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(sub.toJSON())});
if(!r.ok){say('This installation refused the subscription.');return}location.assign('/app?section=alerts&notice='+encodeURIComponent('Alerts are on in this browser.'))}catch(e){say('This browser could not turn on alerts: '+(e&&e.message||e))}});
box.querySelector('[data-push-off]').addEventListener('click',async()=>{const reg=await navigator.serviceWorker.getRegistration('/'),sub=reg&&await reg.pushManager.getSubscription();if(!sub){say('Alerts are already off in this browser.');return}
await fetch('/api/vane/push/unsubscribe',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({endpoint:sub.endpoint})});await sub.unsubscribe();location.assign('/app?section=alerts&notice='+encodeURIComponent('Alerts are off in this browser.'))});})()`

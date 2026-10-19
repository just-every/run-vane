import { oldestDate, sourceToday, shift } from '../search-console/dates'
import { escape, field, hidden, operation, panel, whenUtc } from './html'
import type { ViewData } from './types'
export function searchConnections(data:ViewData & {searchConsole?:any,bing?:any}) {
 if(!data.site)return ''
 const owner=data.actor.role==='owner',google=data.searchConsole,bing=data.bing,id=data.site.id
 let html=''
 if(google){const c=google.connection,today=sourceToday(),end=shift(today,1),from=data.report?.from>=oldestDate()&&data.report.from<=today?data.report.from:shift(today,-29),to=data.report?.to>from&&data.report.to<=end?data.report.to:end
  const status=`<p>${c.status==='connected'?`Connected to ${escape(c.property)}.`:c.status==='choose-property'?'Choose a Search Console property from your Google account.':'Google Search Console is not connected.'}${c.error?` ${escape(c.error)}`:''}</p>`
  const connect=owner&&c.configured&&c.status==='disconnected'?`<form method="post" action="/app/action">${operation('search.google.begin',id)}<button>Connect Google Search Console</button></form>`:''
  const choose=owner&&c.status==='choose-property'?`<form method="post" action="/app/action">${operation('search.google.property',id)}<label>Google property<select name="property" required>${google.properties.map((p:any)=>`<option value="${escape(p.siteUrl)}">${escape(p.siteUrl)} (${escape(p.permissionLevel)})</option>`).join('')}</select></label><button>Use Google property</button></form>`:''
  const controls=owner&&c.status==='connected'?`<form method="post" action="/app/action">${operation('search.google.sync',id)}${field('First Google source date','from',from,'type="date" required')}${field('Google end date (exclusive)','to',to,'type="date" required')}<button>Sync Google range</button></form>`:''
  const disconnect=owner&&c.status!=='disconnected'?`<form method="post" action="/app/action">${operation('search.google.disconnect',id)}<button class="vane-secondary">Disconnect Google</button></form>`:''
  html+=panel('Google Search Console',`${status}<p>Read-only search query and page aggregates. Dates follow Google’s Pacific time. Recent unpublished days stay pending until the next daily check. Google credentials stay out of history archives. Disconnect and same-property reconnect keep fetched history. To change to a different property, first erase its history through the reviewed erasure proposal.</p>${owner&&!c.configured?'<p>Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET on the installation, with /api/vane/search-console/callback as its OAuth callback, to connect.</p>':''}${c.lastSync?`<p>Last checked ${whenUtc(c.lastSync)}; next check ${whenUtc(c.nextSync)}.</p>`:''}${connect}${choose}${controls}${disconnect}`)
 }
 if(bing){const c=bing.connection
  html+=panel('Bing Webmaster Tools',`<p>${c.connected?`Connected to ${escape(c.property)}.`:'Bing is not connected.'}${c.error?` ${escape(c.error)}`:''}</p><p>Only search aggregates are read. Bing’s weekly query/page sets and site totals keep their own source definitions. The API key is sealed and never shown again or archived.</p>${owner&&!c.connected?`<form method="post" action="/app/action">${operation('search.bing.connect',id)}${field('Bing site URL','property',data.site.origin,'type="url" required')}${field('Bing Webmaster API key','apiKey','','type="password" autocomplete="off" required')}<button>Connect Bing</button></form>`:''}${owner&&c.connected?`<form method="post" action="/app/action">${operation('search.bing.sync',id)}<button>Sync Bing now</button></form><form method="post" action="/app/action">${operation('search.bing.disconnect',id)}<button class="vane-secondary">Disconnect Bing</button></form>`:''}${c.lastSyncAt?`<p>Last checked ${whenUtc(c.lastSyncAt)}; next check ${whenUtc(c.nextSyncAt)}.</p>`:''}`)
 }
 return html
}

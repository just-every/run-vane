import type { Site } from './core'
import { retentionPhrase } from './retention'
// PRIVACY-001: what a site collects, derives and discards, its identifiers, salt, retention and processors,
// built from the site's settings, and the privacy-policy text generated from the same inventory. Every
// stored column is listed under the table that holds it, so the stored data can be checked against it.
// Each later capability that stores a field, sets an identifier or connects a processor adds its entry here
// before it ships: consented mode (METRIC-005), longer retention (RETENTION-002), custom events (CONV-002),
// location (DASH-005), Search Console and Bing (SEARCH-001/002), ad platforms (ADS-001), outcome sources
// (CONV-008), Slack/Teams delivery (REPORT-002) and webhooks (API-003).
export interface Field { name:string; table:string; columns:string[]; description:string }
export function inventory(site:Site) {
 const c=site.config,auto=c.autoEvents??[],page='vane_events'
 const fields:Field[]=[
  {name:'Page load',table:page,columns:['id','site_id','day','kind','at'],description:'A random page-load ID, the site, the local day and time, and whether it is a page load or a goal reached on it.'},
  {name:'Page',table:page,columns:['hostname','path'],description:'The page’s hostname and path, with emails, UUIDs, long numbers and tokens replaced and the site’s rewrite rules applied. No query string or page title.'},
  {name:'Source and campaign',table:page,columns:['source','campaign','utm_source','utm_medium','utm_term','utm_content','channel','referrer','paid_click'],description:'The visit’s source and channel, the UTM fields, the referring page without its query, and a paid-click flag; click-ID values are never kept.'},
  ...((c.queryKeys??[]).length?[{name:'Kept query parameters',table:page,columns:['query'],description:`The values of ${c.queryKeys!.join(', ')}, with personal-looking values dropped.`}]:[]),
  {name:'Visitor hash',table:page,columns:['visitor'],description:'A daily hash of the salt, site, IP address and user agent; it cannot be followed across days or sites.'},
  {name:'Engagement',table:page,columns:['engaged_at','scroll'],description:'The latest engagement ping after 10 visible seconds and the deepest scroll reached.'},
  {name:'Device classes',table:page,columns:['device','browser','browser_version','os','os_version','screen'],description:'Device, browser and operating system with versions, and a screen-size class.'},
  {name:'Collection settings',table:page,columns:['consent','sample_rate'],description:'The consent state and sample rate in force for the page load.'},
  ...(c.searchParam?[{name:'Site search',table:page,columns:['search'],description:`The lowercased term of the ${c.searchParam} parameter, up to 100 characters; email-, phone- and URL-like terms are dropped.`}]:[]),
  ...(auto.length?[{name:'Automatic events',table:'vane_auto_events',columns:['id','site_id','day','kind','prop','at','hostname'],description:`One detail per ${auto.map(kind=>({outbound:'outbound link (its destination without query)',download:'file download (its address)','404':'404 page (the missing path)',form:'form submission (the form’s ID or action path, never what was typed)'} as Record<string,string>)[kind]).join(', ')}.`}]:[]),
  {name:'Coverage counts',table:'vane_exclusions',columns:['site_id','day','reason','count'],description:`Daily counts of page loads refused on an excluded path${c.consent==='required'&&c.declinedCounter?' and of page loads without consent':''}; nothing else about them.`},
  ...(c.signalCounter?[{name:'Privacy-signal count',table:'vane_signals',columns:['site_id','day','count'],description:'A daily count of page loads that sent Global Privacy Control or Do Not Track; nothing else about them.'}]:[]),
 ]
 const discarded=['IP address and user agent: used once for the visitor hash and device classes, then discarded','viewport width: turned into the screen-size class','query strings other than kept parameters, URL fragments and page titles: never stored','click-ID values (gclid, fbclid, msclkid): only the paid-click flag is kept']
 const identifiers=['Default mode: no cookie and no browser storage; the server’s visitor hash changes every day.','Consented mode: not offered by this release, so no identifier is stored on any device.']
 const salt=`A random salt per site and day, rotated at midnight in ${c.timeZone??'UTC'} and deleted within 24 hours.`
 const retention=retentionPhrase(c)
 const processors=['Cloudflare (Workers and D1), which hosts this installation']
 return {fields,discarded,identifiers,salt,retention,processors,policyText:policyText(site,auto)}
}
function policyText(site:Site,auto:string[]):string[] {
 const c=site.config
 return [
  `We use Vane, a privacy-focused analytics tool that runs on our own installation hosted by Cloudflare, to understand how ${site.name} is used. It sets no cookies and stores nothing on your device, and it does not track you across sites or across days.`,
  `When you load a page, Vane records the page address without its query string, the referring site, campaign tags, a paid-click flag, your device, browser and operating system types, your screen-size class and how far you scroll. Your IP address and browser identification are used only to compute a daily visitor count and are not stored.${c.searchParam?' Search terms you enter on our site are recorded, except ones that look like an email address or phone number.':''}${auto.length?` Vane also records ${auto.map(kind=>({outbound:'links you follow to other sites',download:'files you download','404':'pages that were not found',form:'which forms you submit (never what you type)'} as Record<string,string>)[kind]).join(', ')}.`:''}`,
  c.consent==='required'?`Vane only records your visit after you give consent.${c.declinedCounter?' If you do not, it only counts that a page load went without consent, with nothing else about it.':''}`:'Vane records visits without asking for consent because it collects no personal data and sets no cookies.',
  `Browsers that send Global Privacy Control or Do Not Track are not tracked${c.signalCounter?'; we only count how many such page loads arrive':''}. Analytics data is kept for ${retentionPhrase(c)} and is never sold or shared for advertising.`,
 ]
}

import { breakdown, count, escape, panel } from './html'
import { conversionTable, dimensionTable, pageTable, percent, tile } from './tables'
// SHARE-002: only the reports the owner chose, for a signed-out reader.
const sections:Record<string,(report:any)=>string>={
 totals:r=>`<div class="vane-metrics">${tile('Unique visitors',count(r.visitors),'Distinct daily visitor hashes, summed over the days.')}${tile('Visits',count(r.visits),'Runs of one visitor hash’s page loads with no gap over 30 minutes.')}${tile('Pageviews',count(r.pageviews),'Accepted page loads.')}${tile('Goal conversions',count(r.goals),`Conversion rate ${percent(r.conversionRate)} of unique visitors.`)}</div>`,
 sources:r=>breakdown('Referring hostnames',r.sources),
 campaigns:r=>breakdown('Campaigns',r.campaigns),
 pages:r=>pageTable('Top pages',r.topPages)+pageTable('Entry pages',r.entryPages)+pageTable('Exit pages',r.exitPages),
 goals:r=>breakdown('Goals',r.goalBreakdown)+conversionTable(r.goalBreakdown),
 devices:r=>[['Devices',r.devices],['Browsers',r.browsers],['Operating systems',r.systems],['Screen sizes',r.screens]].map(([title,rows])=>dimensionTable(title,rows)).join(''),
}
export function publicStats(site:{name:string},keys:string[],report:any):string {
 return `<h1>${escape(site.name)}</h1>${panel('Reporting period',`<p>${escape(report.from)} to ${escape(report.to)} (end exclusive, ${escape(report.timeZone)}).</p>`)}${keys.map(key=>sections[key]!(report)).join('')}<p class="vane-help">Counts come from Vane’s cookie-free collection: <a href="/methodology">how Vane measures</a>.</p>`
}

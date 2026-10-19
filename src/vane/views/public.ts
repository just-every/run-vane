import { breakdown, count, escape, panel } from './html'
import { revenuePanel } from './revenue'
import { conversionTable, dimensionTable, pageTable, percent, tile } from './tables'
// SHARE-002: only the reports the owner chose, for a signed-out reader. Revenue (CONV-006) appears only in the revenue
// report, when the owner chose it; the other reports' rows carry no revenue column.
const bare=(rows:any[]=[])=>rows.map(({revenue,revenuePerVisitor,currency,...row})=>row)
const sections:Record<string,(report:any)=>string>={
 totals:r=>`<div class="vane-metrics">${tile('Unique visitors',count(r.visitors),'Distinct daily visitor hashes, summed over the days.','unique-visitors')}${tile('Visits',count(r.visits),`Runs of one visitor hash’s page loads with no gap over ${r.visitTimeout} minutes.`,'visits')}${tile('Pageviews',count(r.pageviews),'Accepted page loads.','pageviews')}${tile('Goal conversions',count(r.goals),`Conversion rate ${percent(r.conversionRate)} of unique visitors.`,'conversions')}</div>`,
 sources:r=>breakdown('Sources',r.sources),
 campaigns:r=>breakdown('Campaigns',r.campaigns),
 pages:r=>pageTable('Top pages',bare(r.topPages))+pageTable('Entry pages',bare(r.entryPages))+pageTable('Exit pages',bare(r.exitPages)),
 goals:r=>breakdown('Goals',r.goalBreakdown)+conversionTable(r.goalBreakdown),
 devices:r=>[['Devices',r.devices],['Browsers',r.browsers],['Operating systems',r.systems],['Screen sizes',r.screens]].map(([title,rows])=>dimensionTable(title,bare(rows))).join(''),
 revenue:r=>revenuePanel(r)||panel('Revenue','<p class="vane-empty">No revenue recorded in this period or the compared one.</p>'),
}
export function publicStats(site:{name:string},keys:string[],report:any):string {
 return `<h1>${escape(site.name)}</h1>${panel('Reporting period',`<p>${escape(report.from)} to ${escape(report.to)} (end exclusive, ${escape(report.timeZone)}).</p>`)}${keys.map(key=>sections[key]!(report)).join('')}<p class="vane-help">Counts come from Vane’s cookie-free collection: <a href="/methodology">how Vane measures</a>.</p>`
}

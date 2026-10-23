import type { Env } from './core'
import { clock } from './clock'

// HOST-001: measured local native batch collection, 23 October 2026.
// The projection uses published paid-plan rates; it is not a Cloudflare bill.
export const HOSTING_SAMPLE = { pageviews: 100000, requests: 100, rowsRead: 3812803, rowsWritten: 750643, growthBytes: 7512064 }
export async function hostingUse(env: Env) {
 const month = new Date(clock()).toISOString().slice(0, 7)
 const pageviews = Number((await env.DB.prepare("SELECT COALESCE(SUM(n),0) AS n FROM vane_analytics_cells WHERE kind='pageview' AND day>=? AND day<?").bind(month+'-01',month+'-32').first<{n:number}>())?.n ?? 0)
 const bytes = Number((await env.DB.prepare('SELECT 1').run()).meta.size_after)
 const scale = pageviews / HOSTING_SAMPLE.pageviews
 const requests = HOSTING_SAMPLE.requests * scale, reads = HOSTING_SAMPLE.rowsRead * scale, writes = HOSTING_SAMPLE.rowsWritten * scale
 const estimate = 5 + Math.max(0, requests - 10000000) / 1000000 * .30 + Math.max(0, reads - 25000000000) / 1000000 * .001 + Math.max(0, writes - 50000000) / 1000000 + Math.max(0, bytes / 1e9 - 5) * .75
 const raw=env.VANE_WORKER_USAGE_DAY===new Date(clock()).toISOString().slice(0,10)?env.VANE_WORKER_DAILY_REQUESTS:undefined, dailyRequests=raw!==undefined&&/^\d+$/.test(raw)&&Number.isSafeInteger(Number(raw))?Number(raw):null
 const plan=env.VANE_WORKER_PLAN==='free'?'Workers Free':env.VANE_WORKER_PLAN==='paid'?'Workers Paid':'Not reported'
 return {month,pageviews,bytes,estimate,per100k:pageviews?estimate/scale:null,plan,dailyRequests,warn:plan==='Workers Free'&&dailyRequests!==null&&dailyRequests>=80000}
}

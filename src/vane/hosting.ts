import type { Env } from './core'
import { clock } from './clock'
import { HOSTING_SAMPLE, sampleUse, monthlyCost } from './hosting-cost'
export { HOSTING_SAMPLE }
export async function hostingUse(env: Env) {
 const month = new Date(clock()).toISOString().slice(0, 7)
 const pageviews = Number((await env.DB.prepare("SELECT COALESCE(SUM(n),0) AS n FROM vane_analytics_cells WHERE kind='pageview' AND day>=? AND day<?").bind(month+'-01',month+'-32').first<{n:number}>())?.n ?? 0)
 const bytes = Number((await env.DB.prepare('SELECT 1').run()).meta.size_after)
 const scale = pageviews / HOSTING_SAMPLE.pageviews
 const estimate = monthlyCost(sampleUse(pageviews, bytes))
 const raw=env.VANE_WORKER_USAGE_DAY===new Date(clock()).toISOString().slice(0,10)?env.VANE_WORKER_DAILY_REQUESTS:undefined, dailyRequests=raw!==undefined&&/^\d+$/.test(raw)&&Number.isSafeInteger(Number(raw))?Number(raw):null
 const plan=env.VANE_WORKER_PLAN==='free'?'Workers Free':env.VANE_WORKER_PLAN==='paid'?'Workers Paid':'Not reported'
 return {month,pageviews,bytes,estimate,per100k:pageviews?estimate/scale:null,plan,dailyRequests,warn:plan==='Workers Free'&&dailyRequests!==null&&dailyRequests>=80000}
}

// HOST-001: Cloudflare's published Workers Paid and D1 rates, read 23 October 2026, and the usage that 100,000
// native pageviews cost. The projection is not a bill: it prices measured usage at list rates with the account's
// included allowances available and nothing else running in the account.
export type HostingUse = { requests: number; cpuMs: number; rowsRead: number; rowsWritten: number; bytes: number }

export const HOSTING_RATES = {
 monthly: 5,
 requests: { included: 10_000_000, perMillion: 0.30 },
 cpuMs: { included: 30_000_000, perMillion: 0.02 },
 rowsRead: { included: 25_000_000_000, perMillion: 0.001 },
 rowsWritten: { included: 50_000_000, perMillion: 1 },
 gigabytes: { included: 5, perMonth: 0.75 },
}

// Usage per 100,000 pageviews: Cloudflare's own account analytics for a deployed Worker and D1 database that
// collected 1,000,000 native pageviews through the real batch door (docs/hosting-cost.md), all requests and D1
// work in the window included. Storage growth is the database size D1 reports to the app.
export const HOSTING_SAMPLE = { pageviews: 100_000, requests: 102.6, cpuMs: 3100.4, rowsRead: 3_962_652, rowsWritten: 793_151, growthBytes: 7_640_860 }

export function sampleUse(pageviews: number, bytes: number): HostingUse {
 const scale = pageviews / HOSTING_SAMPLE.pageviews
 return { requests: HOSTING_SAMPLE.requests * scale, cpuMs: HOSTING_SAMPLE.cpuMs * scale, rowsRead: HOSTING_SAMPLE.rowsRead * scale, rowsWritten: HOSTING_SAMPLE.rowsWritten * scale, bytes }
}

const over = (used: number, rate: { included: number; perMillion: number }) => Math.max(0, used - rate.included) / 1e6 * rate.perMillion

/** Monthly USD for one account's usage: the plan minimum plus whatever exceeds the included allowances. */
export function monthlyCost(use: HostingUse): number {
 const r = HOSTING_RATES
 return r.monthly + over(use.requests, r.requests) + over(use.cpuMs, r.cpuMs) + over(use.rowsRead, r.rowsRead) + over(use.rowsWritten, r.rowsWritten) + Math.max(0, use.bytes / 1e9 - r.gigabytes.included) * r.gigabytes.perMonth
}

/** USD of the same usage with no minimum and no allowances, so a small load can still be compared with a large one. */
export function usageCost(use: HostingUse): number {
 const r = HOSTING_RATES
 return use.requests / 1e6 * r.requests.perMillion + use.cpuMs / 1e6 * r.cpuMs.perMillion + use.rowsRead / 1e6 * r.rowsRead.perMillion + use.rowsWritten / 1e6 * r.rowsWritten.perMillion + use.bytes / 1e9 * r.gigabytes.perMonth
}

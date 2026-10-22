import { channelOf } from './vane/channels'
import { localDay } from './vane/visitors'
import { localMidnight } from './vane/periods'

// Nine weeks of seeded, repeatable traffic for a demo site: the day-of-week baseline's eight weeks before the range,
// and the range itself. Each visit has a visitor hash, device, browser, source, pages a minute or two apart and
// an engagement ping unless it bounced. One site can lose a page's page loads on one day, as when a deploy drops the
// script from a template: those loads are simply never recorded, and the day after they return.
export interface Traffic {
  siteId: string; timeZone: string; hostname: string; daily: number
  pages: { path: string; weight: number; next: string[] }[]; goal: { name: string; path: string; share: number }
  campaigns: string[]; gap?: { daysAgo: number; path: string }  // gap.path is a prefix: /shop drops /shop and /shop/*
}
type Row = (string | number | null)[]

// Mulberry32: successive draws are independent enough that each day's device, source and page mix holds steady (a plain
// LCG's neighbouring draws are correlated, which swung one week's mobile share from 45% to 29% and read as a fall).
const random = (seed: number) => () => { seed = (seed + 0x6d2b79f5) >>> 0; let t = seed; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296 }
const pick = <T>(next: () => number, items: [T, number][]) => { let roll = next() * items.reduce((n, [, w]) => n + w, 0); for (const [item, w] of items) { roll -= w; if (roll < 0) return item } return items[items.length - 1]![0] }
const DAY = 86400000

// Source hostname (as the collector stores it), UTM medium and share of visits; channels follow the published rules.
const SOURCES: [[string, string | null], number][] = [[['google.com', null], 38], [['direct', null], 24], [['news.ycombinator.com', null], 7], [['newsletter', 'email'], 6], [['slack.com', null], 4], [['instagram.com', null], 6], [['bing.com', null], 4], [['duckduckgo.com', null], 3], [['pinterest.com', null], 4], [['chatgpt.com', null], 4]]
// Device, browser, browser version, OS, OS version, screen class.
const CLIENTS: [[string, string, string, string, string, string], number][] = [
  [['desktop', 'Chrome', 'Chrome 141', 'macOS', 'macOS 15', 'Desktop (1440 px and wider)'], 24], [['desktop', 'Chrome', 'Chrome 141', 'Windows', 'Windows 11', 'Laptop (992–1439 px)'], 14],
  [['desktop', 'Safari', 'Safari 26', 'macOS', 'macOS 15', 'Laptop (992–1439 px)'], 9], [['desktop', 'Edge', 'Edge 141', 'Windows', 'Windows 11', 'Laptop (992–1439 px)'], 5], [['desktop', 'Firefox', 'Firefox 144', 'Windows', 'Windows 11', 'Desktop (1440 px and wider)'], 3],
  [['mobile', 'Safari', 'Safari 26', 'iOS', 'iOS 26.0', 'Mobile (under 576 px)'], 25], [['mobile', 'Chrome', 'Chrome 141', 'Android', 'Android 16', 'Mobile (under 576 px)'], 15], [['tablet', 'Safari', 'Safari 26', 'iPadOS', 'iPadOS 26.0', 'Tablet (576–991 px)'], 5],
]
const COLUMNS = 'id,site_id,day,kind,path,source,campaign,consent,sample_rate,visitor,at,engaged_at,device,browser,browser_version,os,os_version,screen,hostname,utm_source,utm_medium,channel,referrer'

export function demoTraffic(t: Traffic, now: number): Row[] {
  const next = random([...t.siteId].reduce((n, c) => n * 31 + c.charCodeAt(0), 7) >>> 0), rows: Row[] = []
  for (let ago = 62; ago >= 0; ago--) {
    const day = localDay(now - ago * DAY, t.timeZone), midnight = localMidnight(day, t.timeZone), weekday = new Date(`${day}T12:00:00Z`).getUTCDay()
    // Weekdays are busier than weekends; each day varies by up to ±8%. Today counts only what has happened so far.
    const visits = Math.round(t.daily * (weekday === 0 || weekday === 6 ? .68 : 1) * (.92 + next() * .16))
    for (let n = 0; n < visits; n++) {
      // Visits start between 7 am and 11 pm local time.
      const at = midnight + 7 * 3600000 + Math.floor(next() * 16 * 3600000)
      if (at > now - 600000) continue
      const [source, medium] = pick(next, SOURCES), client = pick(next, CLIENTS), visitor = `${t.siteId}-${day}-${n}`
      const campaign = medium === 'email' ? t.campaigns[0]! : source === 'instagram.com' && next() < .5 ? t.campaigns[1] ?? 'none' : 'none'
      const channel = channelOf(source, medium, false), referrer = source === 'direct' || source === 'newsletter' ? null : `${source}/`
      // A visit walks one to four pages; a third of visits bounce without an engagement ping. A visit whose last page
      // leads to the goal path converts at the goal's share, with the goal recorded as the collector records it.
      const visit = (start: number, number: number) => {
        let path = pick(next, t.pages.map(p => [p.path, p.weight] as [string, number])), when = start
        const bounce = next() < .36, steps = bounce ? 1 : 1 + Math.floor(next() * 3.2)
        const record = (id: string, kind: string, where: string, time: number, engaged: number | null) => rows.push([id, t.siteId, localDay(time, t.timeZone), kind, where, source, campaign, 'granted', 100, visitor, time, engaged, ...client, t.hostname, medium ? source : null, medium, channel, referrer])
        for (let step = 0; step < steps; step++) {
          const last = step === steps - 1, id = `${t.siteId}-${day}-${n}-${number}-${step}`
          if (!(t.gap && t.gap.daysAgo === ago && path.startsWith(t.gap.path))) record(id, 'pageview', path, when, !bounce && last ? when + 15000 + Math.floor(next() * 150000) : null)
          const page = t.pages.find(p => p.path === path)!
          if (last) {
            if (!bounce && page.next.includes(t.goal.path) && next() < t.goal.share) { when += 40000 + Math.floor(next() * 120000); const goalId = `${t.siteId}-${day}-${n}-${number}-goal`; record(goalId, 'pageview', t.goal.path, when, when + 20000); record(`${goalId}:${t.goal.name}`, t.goal.name, t.goal.path, when, null) }
            break
          }
          const onward = page.next.filter(p => p !== t.goal.path)
          path = onward.length ? onward[Math.floor(next() * onward.length)]! : path
          when += 30000 + Math.floor(next() * 150000)
        }
      }
      // A sixth of visitors come back two to five hours later for a second visit.
      visit(at, 0)
      if (next() < .17 && at + 5 * 3600000 < now - 600000) visit(at + 2 * 3600000 + Math.floor(next() * 3 * 3600000), 1)
    }
  }
  return rows
}

// Thousands of demo events go in a few statements: each binds one JSON array of rows (well under D1's 2 MB value
// limit) and json_each spreads it into columns.
export function insertRows(db: D1Database, rows: Row[]): D1PreparedStatement[] {
  const columns = COLUMNS.split(','), statements: D1PreparedStatement[] = []
  for (let i = 0; i < rows.length; i += 4000) statements.push(db.prepare(`INSERT OR IGNORE INTO vane_events(${COLUMNS}) SELECT ${columns.map((_, c) => `json_extract(value,'$[${c}]')`).join(',')} FROM json_each(?)`).bind(JSON.stringify(rows.slice(i, i + 4000))))
  return statements
}

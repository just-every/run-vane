import type { Bindings } from './auth.server'
import { cleanSite } from './vane/privacy'
import { localDay } from './vane/visitors'
import { demoTraffic, insertRows } from './demo-traffic'

/** Configured examples use the same privacy rules as a site prepared in the app. */
export async function seedDemo(env: Bindings, { ownerEmail, now }: { ownerEmail: string; now: Date }) {
  const owner = await env.DB.prepare("SELECT id FROM oa_operators WHERE email=? AND role='owner'").bind(ownerEmail).first<{ id: string }>()
  if (!owner) throw new Error('Demo owner is missing')
  const at = now.getTime(), dayMs = 86400000
  // Three US sites with nine weeks of traffic. Fern & Field's shop template lost the Vane script for one day five days
  // ago (a deploy, annotated), so that day sits outside its weekday's normal variation and the day after recovers.
  const examples = [
    { id: 'demo-fern', name: 'Fern & Field', origin: 'https://fernandfield.example', timeZone: 'America/Chicago', daily: 44, goals: { purchase: '/thanks' }, campaigns: ['fall-collection', 'weekend-edit'],
      pages: [{ path: '/', weight: 22, next: ['/shop', '/journal', '/about'] }, { path: '/shop', weight: 24, next: ['/shop/linen-throw', '/shop/stoneware-planter'] }, { path: '/shop/linen-throw', weight: 16, next: ['/thanks', '/shop'] }, { path: '/shop/stoneware-planter', weight: 12, next: ['/thanks', '/shop'] }, { path: '/journal', weight: 7, next: ['/journal/fall-planting-guide', '/shop'] }, { path: '/journal/fall-planting-guide', weight: 14, next: ['/shop', '/journal'] }, { path: '/about', weight: 5, next: ['/shop', '/'] }],
      goal: { name: 'purchase', path: '/thanks', share: .2 }, gap: { daysAgo: 5, path: '/shop' } },
    { id: 'demo-tide', name: 'Tide Studio', origin: 'https://tidestudio.example', timeZone: 'America/Los_Angeles', daily: 24, goals: { enquiry: '/thanks' }, campaigns: ['design-digest', 'studio-notes'],
      pages: [{ path: '/', weight: 40, next: ['/work', '/about'] }, { path: '/work', weight: 25, next: ['/work/harbor-rebrand', '/contact'] }, { path: '/work/harbor-rebrand', weight: 15, next: ['/contact', '/work'] }, { path: '/about', weight: 10, next: ['/contact', '/work'] }, { path: '/contact', weight: 10, next: ['/thanks', '/'] }],
      goal: { name: 'enquiry', path: '/thanks', share: .3 } },
    { id: 'demo-north', name: 'Northline Coffee', origin: 'https://northlinecoffee.example', timeZone: 'America/New_York', daily: 30, goals: { subscribe: '/thanks' }, campaigns: ['morning-ritual', 'fresh-roast'],
      pages: [{ path: '/', weight: 35, next: ['/coffee', '/subscriptions'] }, { path: '/coffee', weight: 25, next: ['/coffee/house-blend', '/subscriptions'] }, { path: '/coffee/house-blend', weight: 20, next: ['/subscriptions', '/coffee'] }, { path: '/subscriptions', weight: 20, next: ['/thanks', '/coffee'] }],
      goal: { name: 'subscribe', path: '/thanks', share: .25 } },
  ]
  const statements: D1PreparedStatement[] = []
  for (const [index, example] of examples.entries()) {
    const { id, name, origin, timeZone, goals, campaigns } = example
    const prepared = cleanSite({ name, origin, timeZone, goals, campaigns, paths: [], consent: 'required', sampleRate: 100, retentionDays: 90 })
    const config = prepared.config
    statements.push(env.DB.prepare('INSERT INTO vane_sites(id,name,origin,config_json,created_at) VALUES(?,?,?,?,?) ON CONFLICT(id) DO NOTHING').bind(id, prepared.name, prepared.origin, JSON.stringify(config), at - (64 + index) * dayMs))
    statements.push(...insertRows(env.DB, demoTraffic({ siteId: id, timeZone, hostname: new URL(origin).hostname, daily: example.daily, pages: example.pages, goal: example.goal, campaigns, gap: example.gap }, at)))
    if (example.gap) {
      const gapDay = localDay(at - example.gap.daysAgo * dayMs, timeZone), backDay = localDay(at - (example.gap.daysAgo - 1) * dayMs, timeZone)
      statements.push(env.DB.prepare('INSERT INTO vane_annotations(id,site_id,day,kind,text,url,author,at) VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(id) DO NOTHING').bind(`${id}-deploy`, id, gapDay, 'deploy', 'Shop template deploy 214', 'https://ci.fernandfield.example/deploys/214', null, at - example.gap.daysAgo * dayMs))
      statements.push(env.DB.prepare('INSERT INTO vane_annotations(id,site_id,day,kind,text,url,author,at) VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(id) DO NOTHING').bind(`${id}-restored`, id, backDay, 'note', 'Vane script restored on the shop template', null, owner.id, at - (example.gap.daysAgo - 1) * dayMs))
    }
    statements.push(env.DB.prepare("INSERT INTO vane_proposals(id,command,payload_json,state,prepared_by,created_at,approved_by,approved_at) VALUES(?,'site.create',?,'approved',?,?,?,?) ON CONFLICT(id) DO NOTHING").bind(`${id}-approved`, JSON.stringify({ ...prepared, siteId: id }), owner.id, at - 65 * dayMs, owner.id, at - 64 * dayMs))
    // One realistic, reviewable settings proposal; the existing site is already collecting.
    if (index === 0) statements.push(env.DB.prepare("INSERT INTO vane_proposals(id,command,payload_json,state,prepared_by,created_at) VALUES(?,'site.configure',?,'pending',?,?) ON CONFLICT(id) DO NOTHING").bind('demo-exclude-previews', JSON.stringify({ ...prepared, siteId: id, version: 1, config: { ...config, excludePaths: ['/preview/**'] } }), owner.id, at - 2 * 3600000))
  }
  statements.push(env.DB.prepare('INSERT INTO oa_first_run(singleton,completed_by,completed_at) VALUES(1,?,?) ON CONFLICT(singleton) DO NOTHING').bind(owner.id, at))
  await env.DB.batch(statements)
}

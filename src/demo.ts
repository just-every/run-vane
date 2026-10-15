import type { Bindings } from './auth.server'
import { cleanSite } from './vane/privacy'

/** Configured examples use the same privacy rules as a site prepared in the app. */
export async function seedDemo(env: Bindings, { ownerEmail, now }: { ownerEmail: string; now: Date }) {
  const owner = await env.DB.prepare("SELECT id FROM oa_operators WHERE email=? AND role='owner'").bind(ownerEmail).first<{ id: string }>()
  if (!owner) throw new Error('Demo owner is missing')
  const at = now.getTime(), dayMs = 86400000
  const examples = [
    { id: 'demo-fern', name: 'Fern & Field', origin: 'https://fernandfield.example', paths: ['/', '/shop', '/journal', '/thanks'], goals: { purchase: '/thanks' }, campaigns: ['spring-collection', 'weekend-edit'] },
    { id: 'demo-tide', name: 'Tide Studio', origin: 'https://tidestudio.example', paths: ['/', '/work', '/about', '/contact', '/thanks'], goals: { enquiry: '/thanks' }, campaigns: ['design-digest', 'studio-notes'] },
    { id: 'demo-north', name: 'Northline Coffee', origin: 'https://northlinecoffee.example', paths: ['/', '/coffee', '/subscriptions', '/thanks'], goals: { subscribe: '/thanks' }, campaigns: ['morning-ritual', 'fresh-roast'] },
  ]
  const statements: D1PreparedStatement[] = []
  for (const [index, example] of examples.entries()) {
    const { id, ...input } = example
    const prepared = cleanSite({ ...input, sources: ['google.com', 'bing.com', 'instagram.com', 'pinterest.com'], consent: 'required', sampleRate: 100, retentionDays: 90 })
    const config = prepared.config
    statements.push(env.DB.prepare('INSERT INTO vane_sites(id,name,origin,config_json,created_at) VALUES(?,?,?,?,?) ON CONFLICT(id) DO NOTHING').bind(id, prepared.name, prepared.origin, JSON.stringify(config), at - (28 + index) * dayMs))
    // Two comparable weeks of accepted page loads, with conversions and varied attribution.
    for (let n = 0; n < 84; n++) {
      const day = new Date(at - (n % 14) * dayMs).toISOString().slice(0, 10)
      const path = config.paths[n % config.paths.length]
      const source = ['google.com', 'direct', 'instagram.com', 'google.com', 'pinterest.com', 'bing.com'][n % 6]
      const campaign = n % 3 === 0 ? config.campaigns[n % 2] : 'none'
      const eventId = `${id}-visit-${n}`
      statements.push(env.DB.prepare('INSERT INTO vane_events(id,site_id,day,kind,path,source,campaign,consent,sample_rate) VALUES(?,?,?,?,?,?,?,?,100) ON CONFLICT(id) DO NOTHING').bind(eventId, id, day, 'pageview', path, source, campaign, 'granted'))
      const goal = Object.entries(config.goals).find(([, goalPath]) => goalPath === path)?.[0]
      if (goal) statements.push(env.DB.prepare('INSERT INTO vane_events(id,site_id,day,kind,path,source,campaign,consent,sample_rate) VALUES(?,?,?,?,?,?,?,?,100) ON CONFLICT(id) DO NOTHING').bind(`${eventId}-goal`, id, day, goal, path, source, campaign, 'granted'))
    }
    statements.push(env.DB.prepare("INSERT INTO vane_proposals(id,command,payload_json,state,prepared_by,created_at,approved_by,approved_at) VALUES(?,'site.create',?,'approved',?,?,?,?) ON CONFLICT(id) DO NOTHING").bind(`${id}-approved`, JSON.stringify({ ...prepared, siteId: id }), owner.id, at - 29 * dayMs, owner.id, at - 28 * dayMs))
    // One realistic, reviewable settings proposal; the existing site is already collecting.
    if (index === 0) statements.push(env.DB.prepare("INSERT INTO vane_proposals(id,command,payload_json,state,prepared_by,created_at) VALUES(?,'site.configure',?,'pending',?,?) ON CONFLICT(id) DO NOTHING").bind('demo-summer-campaign', JSON.stringify({ ...prepared, siteId: id, version: 1, config: { ...config, campaigns: [...config.campaigns, 'summer-preview'] } }), owner.id, at - 2 * 3600000))
  }
  statements.push(env.DB.prepare('INSERT INTO oa_first_run(singleton,completed_by,completed_at) VALUES(1,?,?) ON CONFLICT(singleton) DO NOTHING').bind(owner.id, at))
  await env.DB.batch(statements)
}

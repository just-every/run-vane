import { type Env } from '../core'
import { rawEventPredicate } from '../raw'
import type { ValidatedPageview } from './validation'

export interface ExistingPageview { id: string; path: string; source: string; campaign: string }
export async function existingPageviews(env: Env, plans: ValidatedPageview[]) {
 const ids = [...new Set(plans.map(plan => plan.eventId))], statements: D1PreparedStatement[] = []
 // Each predicate binds site and encoded event ID. Keep well below D1's bound
 // parameter limit and avoid one Worker-to-D1 round trip for every record.
 for (let first = 0; first < ids.length; first += 32) {
  const predicates = ids.slice(first, first + 32).map(id => rawEventPredicate(id))
  statements.push(env.DB.prepare(`SELECT id,path,source,campaign FROM vane_events WHERE ${predicates.map(p => '(' + p.sql + ')').join(' OR ')}`).bind(...predicates.flatMap(p => p.values)))
 }
 const result = await env.DB.batch<ExistingPageview>(statements)
 return new Map(result.flatMap(r => r.results.map(row => [row.id, row] as const)))
}

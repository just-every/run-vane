import { type Env } from '../core'
import { encodeRawId } from '../raw'
import type { ValidatedPageview } from './validation'

export interface ExistingPageview { id: string; path: string; source: string; campaign: string }
export async function existingPageviews(env: Env, plans: ValidatedPageview[]) {
 const wanted = [...new Map(plans.map(plan => [plan.eventId, plan])).values()].map(plan => {
  const token = encodeRawId(plan.value.id, plan.eventId)
  return [plan.eventId, plan.value.id, typeof token === 'string' ? 'text' : 'blob',
   typeof token === 'string' ? token : Array.from(new Uint8Array(token), byte => byte.toString(16).padStart(2, '0')).join('')]
 })
 // Start with the bounded requested IDs and seek each exact physical key.
 // Expanding an OR over the logical history can instead scan that history as
 // it grows. The returned ID is the requested, losslessly encoded stored key.
 const result = await env.DB.prepare(`SELECT json_extract(w.value,'$[0]') AS id,
  json_extract(c.dimensions,'$[0]') AS path,json_extract(c.dimensions,'$[1]') AS source,json_extract(c.dimensions,'$[2]') AS campaign
  FROM json_each(?) w CROSS JOIN vane_raw_occurrences e
  JOIN vane_raw_groups g ON g.group_id=e.group_id JOIN vane_raw_contexts c ON c.context=g.context
  WHERE e.site=(SELECT site FROM vane_raw_sites WHERE site_id=json_extract(w.value,'$[1]'))
   AND e.token=CASE WHEN json_extract(w.value,'$[2]')='blob' THEN unhex(json_extract(w.value,'$[3]')) ELSE json_extract(w.value,'$[3]') END`
 ).bind(JSON.stringify(wanted)).all<ExistingPageview>()
 return new Map(result.results.map(row => [row.id, row]))
}

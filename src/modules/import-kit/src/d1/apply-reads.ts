import type { PlanEntry } from '../types.ts';
import type { D1ImportContext } from './types.ts';
import { jsonChunks, selectKeys } from './sets.ts';

const targetKey = (kind: string, id: string) => JSON.stringify([kind, id]);

/** One publication preflight only. These reads never replace commit guards:
 * absent claims and provenance are still checked in the atomic publication.
 * Existing provenance keeps the ordinary full validation/supersession path. */
export async function publicationReads(entries: PlanEntry[], context: D1ImportContext) {
  const db = context.storage.database;
  const claims = new Map((await selectKeys(db, 'ik_sources', 'identity', entries.map(entry => entry.identity))).map(row => [row.identity, row]));
  const targets = new Map<string, [string, string]>();
  for (const entry of entries) if (!claims.has(entry.identity)) for (const effect of entry.effects) {
    targets.set(targetKey(effect.targetKind, effect.targetId), [effect.targetKind, effect.targetId]);
  }
  const held = new Set<string>();
  // Keep the bounded requested set outside the index probe; SQLite must not
  // scan all provenance in a destination before walking each JSON target.
  for (const chunk of jsonChunks([...targets.values()])) {
    const { results } = await db.prepare(`SELECT p.target_kind,p.target_id FROM json_each(?) wanted CROSS JOIN ik_provenance p
      ON p.destination=? AND p.target_kind=json_extract(wanted.value,'$[0]') AND p.target_id=json_extract(wanted.value,'$[1]') AND p.reversed=0`)
      .bind(chunk, context.destination).all<{ target_kind: string; target_id: string }>();
    for (const row of results) held.add(targetKey(row.target_kind, row.target_id));
  }
  return { claims, hasProvenance: (kind: string, id: string) => held.has(targetKey(kind, id)) };
}

/** Match the publication engine's effect bound before reading ahead. */
export function publicationEntries(entries: PlanEntry[]): PlanEntry[] {
  const selected: PlanEntry[] = [];
  let effects = 0;
  for (const entry of entries) {
    if (selected.length && effects + entry.effects.length > 1000) break;
    if (entry.effects.length > 1000) throw new Error('SOURCE_EFFECT_LIMIT');
    selected.push(entry); effects += entry.effects.length;
  }
  return selected;
}

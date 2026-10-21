import type { PlanEntry, TargetRow } from '../types.ts';
import { readStagedTarget, type NativeStagingScope } from './native-staging-context.ts';
import type { D1ImportContext } from './types.ts';
import { jsonChunks, selectKeys } from './sets.ts';

const targetKey = (kind: string, id: string) => JSON.stringify([kind, id]);

/** One publication preflight only. These reads never replace commit guards:
 * absent claims and provenance are still checked in the atomic publication.
 * Existing provenance keeps the ordinary full validation/supersession path. */
export async function publicationReads(entries: PlanEntry[], context: D1ImportContext) {
  const db = context.storage.database, adapter = context.storage.targets;
  const requested = new Map<string, { kind: string; id: string }>();
  for (const entry of entries) for (const effect of entry.effects) requested.set(targetKey(effect.targetKind, effect.targetId), { kind: effect.targetKind, id: effect.targetId });
  // A staging adapter's earlier native guard capture cannot be replaced by a
  // plain snapshot. All other adapters may supply their real bounded set read.
  let native: Map<string, TargetRow | undefined> | undefined;
  if (adapter.readMany && !(context.maxBatchBytes !== undefined && adapter.stagingRead)) {
    const targets = [...requested.values()], rows = await adapter.readMany(db, context.destination, targets);
    if (rows.length !== targets.length) throw new Error('IMPORT_NATIVE_BATCH_READ_MISMATCH');
    native = new Map(targets.map((target, index) => {
      const row = rows[index];
      if (row && (row.destination !== context.destination || row.targetKind !== target.kind || row.targetId !== target.id)) throw new Error('IMPORT_NATIVE_BATCH_READ_MISMATCH');
      return [targetKey(target.kind, target.id), row];
    }));
  }
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
  return { claims, native, hasProvenance: (kind: string, id: string) => held.has(targetKey(kind, id)) };
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

/** Register the same staged target scope as a scalar adapter read. Every
 * snapshot/absence keeps its ordinary exact native commit predicates. */
export async function readPublicationTarget(context: D1ImportContext, scope: NativeStagingScope, reads: Awaited<ReturnType<typeof publicationReads>>, kind: string, id: string): Promise<TargetRow | undefined> {
  if (!reads.native) return readStagedTarget(context, scope, kind, id);
  const key = targetKey(kind, id);
  if (!reads.native.has(key)) throw new Error('IMPORT_NATIVE_BATCH_READ_MISMATCH');
  const row = reads.native.get(key);
  scope.targets.push({kind, id, present:!!row});
  return row;
}

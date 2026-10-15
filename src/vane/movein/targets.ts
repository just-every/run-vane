import type { D1TargetAdapter, D1Sql, D1Database } from '../../modules/import-kit/d1/types.ts';
import type { TargetRow, Json } from '../../modules/import-kit/types.ts';
import { MoveinError } from './types.ts';

const fields = ['day','kind','path','source','campaign','consent','sample_rate'] as const;
interface StoredEvent { id: string; site_id: string; import_job: string; revision: string; [key: string]: any }
const sql = (sql: string, ...params: unknown[]): D1Sql => ({ sql, params });

export function targetAdapter(applyingJobId?: string): D1TargetAdapter {
  const revisionJobs = new Map<string, string>();
  function row(event: StoredEvent): TargetRow {
    if (!event.revision) throw new MoveinError('IMPORT_EVENT_REVISION_MISSING', 409);
    revisionJobs.set(event.revision, event.import_job);
    return { destination: event.site_id, targetKind: 'analytics-event', targetId: event.id,
      revision: event.revision, value: Object.fromEntries(fields.map(field => [field, event[field]])) as Json };
  }
  function ensureKind(kind: string) { if (kind !== 'analytics-event') throw new MoveinError('UNSUPPORTED_TARGET'); }
  async function list(db: D1Database, destination: string) {
    const result = await db.prepare('SELECT e.*,r.revision FROM vane_import_events e LEFT JOIN vane_import_revisions r ON r.event_id=e.id WHERE e.site_id=? ORDER BY e.id').bind(destination).all<StoredEvent>();
    return result.results.map(row);
  }
  return {
    async read(db, destination, kind, id) {
      ensureKind(kind);
      const result = await db.prepare('SELECT e.*,r.revision FROM vane_import_events e LEFT JOIN vane_import_revisions r ON r.event_id=e.id WHERE e.site_id=? AND e.id=?').bind(destination,id).first<StoredEvent>();
      return result ? row(result) : undefined;
    },
    matches(expected, destination, kind, id) {
      ensureKind(kind);
      if (!expected) return sql('NOT EXISTS(SELECT 1 FROM vane_import_events WHERE id=?) AND NOT EXISTS(SELECT 1 FROM vane_import_revisions WHERE event_id=?)', id,id);
      const job = revisionJobs.get(expected.revision) ?? applyingJobId;
      if (!job) throw new MoveinError('IMPORT_EVENT_JOB_MISSING',409);
      const value = expected.value as Record<string, Json>;
      return sql(`EXISTS(SELECT 1 FROM vane_import_events e JOIN vane_import_revisions r ON r.event_id=e.id WHERE e.id=? AND e.site_id=? AND e.import_job=? AND r.revision=? AND ${fields.map(field => `e.${field} IS ?`).join(' AND ')})`, id, destination, job, expected.revision, ...fields.map(field => value[field]));
    },
    write(expected) {
      ensureKind(expected.targetKind);
      const job = revisionJobs.get(expected.revision) ?? applyingJobId;
      if (!job) throw new MoveinError('IMPORT_EVENT_JOB_MISSING',409);
      revisionJobs.set(expected.revision,job);
      const value = expected.value as Record<string, Json>;
      return [
        sql(`INSERT INTO vane_import_events(id,site_id,import_job,${fields.join(',')}) VALUES(?,?,?,${fields.map(() => '?').join(',')}) ON CONFLICT(id) DO UPDATE SET site_id=excluded.site_id,import_job=excluded.import_job,${fields.map(field => `${field}=excluded.${field}`).join(',')}`, expected.targetId,expected.destination,job,...fields.map(field => value[field])),
        sql('INSERT INTO vane_import_revisions(event_id,revision) VALUES(?,?) ON CONFLICT(event_id) DO UPDATE SET revision=excluded.revision',expected.targetId,expected.revision),
      ];
    },
    remove(destination, kind, id) {
      ensureKind(kind);
      return [sql('DELETE FROM vane_import_revisions WHERE event_id IN (SELECT id FROM vane_import_events WHERE site_id=? AND id=?)',destination,id),sql('DELETE FROM vane_import_events WHERE site_id=? AND id=?',destination,id)];
    },
    list,
    matchesCount(count,destination) { return sql('(SELECT COUNT(*) FROM vane_import_events WHERE site_id=?)=?',destination,count); },
  };
}

import { canonicalJson, sha256 } from '../../modules/import-kit/src/provenance/identity.ts';
import type { DiscardedCounts, ImportSite, SafeEvent, SitePolicy } from './types.ts';
import { MoveinError } from './types.ts';
import { hostOf, keptValue, pathAllowed, storedPath, visitSource } from '../paths';
// IMPORT-006: one CSV page of Simple Analytics' data-point export (Export API, format=csv: a header row of the chosen
// fields, then one page view per row), up to 500 rows. It needs added_iso, path and uuid; referrer_hostname,
// utm_source and utm_campaign are kept when present. The session ID, the unique flag, the query string, the referrer
// path and every other column are counted as discarded and never enter custody.
const kept = new Set(['added_iso','path','uuid','hostname','referrer_hostname','utm_source','utm_campaign']);
function rows(text: string): string[][] {
  const out: string[][] = []; let row: string[] = [], cell = '', quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i]!;
    if (quoted) { if (c === '"' && text[i + 1] === '"') { cell += '"'; i++; } else if (c === '"') quoted = false; else cell += c; continue; }
    if (c === '"' && cell === '') quoted = true; else if (c === ',') { row.push(cell); cell = ''; } else if (c === '\n' || c === '\r') { if (c === '\r' && text[i + 1] === '\n') i++; row.push(cell); out.push(row); row = []; cell = ''; } else cell += c;
  }
  if (cell !== '' || row.length) { row.push(cell); out.push(row); }
  return out.filter(r => r.some(v => v !== ''));
}
export const isSimpleCsv = (input: unknown) => typeof input === 'string' && /^﻿?[a-z_,"]*\badded_iso\b/.test(input.split(/\r?\n/, 1)[0] ?? '');
export function simpleEvents(text: string, site: ImportSite, policy: SitePolicy): { events: SafeEvent[]; discarded: DiscardedCounts } {
  const [head, ...data] = rows(text.replace(/^﻿/, '')), columns = head!.map(c => c.trim());
  if (!['added_iso', 'path', 'uuid'].every(c => columns.includes(c))) throw new MoveinError('SIMPLE_ANALYTICS_CSV_REQUIRES_ADDED_ISO_PATH_UUID');
  if (!data.length || data.length > 500) throw new MoveinError('IMPORT_PAGE_REQUIRES_1_TO_500_EVENTS');
  const discarded: DiscardedCounts = { sessionIds: 0, pageTitles: 0, websiteIds: 0, sourceEventIds: 0, rawQueries: 0, referrerPaths: 0, referrerQueries: 0, excludedPaths: 0, extraFields: 0 };
  const own = [site.origin, ...(policy.origins ?? [])].map(hostOf), events: SafeEvent[] = [];
  data.forEach((cells, index) => {
    const invalid = (code: string): never => { throw new MoveinError(`ROW_${index + 1}_${code}`); };
    if (cells.length !== columns.length) return invalid('COLUMN_COUNT');
    const raw = Object.fromEntries(columns.map((c, i) => [c, cells[i]!]));
    if (!raw.uuid || raw.uuid.length > 256) return invalid('EVENT_ID_REQUIRED');
    const at = Date.parse(raw.added_iso!);
    if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})$/.test(raw.added_iso!) || !Number.isFinite(at)) return invalid('INVALID_TIMESTAMP');
    if (!/^\/(?!\/)[^?#\s]*$/.test(raw.path!)) return invalid('INVALID_PATH');
    discarded.sessionIds += Number(!!raw.session_id);
    discarded.sourceEventIds++;
    discarded.rawQueries += Number(!!raw.query);
    discarded.referrerPaths += Number(!!raw.referrer_path);
    discarded.extraFields += columns.filter(c => !kept.has(c) && !['session_id','query','referrer_path'].includes(c) && raw[c] !== '').length;
    const path = storedPath(policy, raw.path!);
    if (!pathAllowed(policy, path)) { discarded.excludedPaths++; return; }
    const source = visitSource(keptValue(raw.utm_source || null), null, (raw.referrer_hostname ?? '').toLowerCase(), own);
    events.push({ id: sha256(canonicalJson(['vane-simple-analytics-event', site.id, raw.uuid])), day: new Date(at).toISOString().slice(0, 10), kind: 'pageview', path, source, campaign: keptValue(raw.utm_campaign || null) ?? 'none', consent: null, sample_rate: null });
  });
  if (!events.length) throw new MoveinError('IMPORT_PAGE_REQUIRES_1_TO_500_EVENTS');
  return { events, discarded };
}

import { canonicalJson, sha256 } from '../../modules/import-kit/src/provenance/identity.ts';
import type { DiscardedCounts, ImportSite, SafeEvent, SitePolicy } from './types.ts';
import { MoveinError } from './types.ts';
import { goalApplies } from '../goals';
import { hostOf, keptValue, pathAllowed, storedPath, visitSource } from '../paths';
import { csvRows } from './csv.ts';
// IMPORT-006: one page (up to 500 rows) of Umami's database export of the website_event table, as CSV with a header row
// (PostgreSQL `\copy website_event TO ... CSV HEADER`, MySQL's equivalent, or Umami Cloud's data export). It needs
// event_id, created_at, url_path and event_type; the source comes from utm_source, else ref or source in url_query,
// else referrer_domain, and the campaign from utm_campaign. created_at is UTC: a time without an offset, as PostgreSQL
// writes a timestamp column, is read as UTC. An event keeps the identity it has through Umami's events API (IMPORT-001),
// so a row imported both ways counts once. The website, session and visit IDs, the page title, the queries, the
// referrer path and every other column are counted as discarded and never enter custody.
const kept = new Set(['event_id','created_at','url_path','url_query','referrer_domain','event_type','event_name','utm_source','utm_campaign']);
const counted = ['website_id','session_id','visit_id','page_title','referrer_path','referrer_query'];
export const isUmamiCsv = (input: unknown) => typeof input === 'string' && /^﻿?(?=.*\bevent_id\b)(?=.*\burl_path\b)(?=.*\bcreated_at\b)[a-z_,"]*$/.test(input.split(/\r?\n/, 1)[0] ?? '');
export function umamiCsvEvents(text: string, site: ImportSite, policy: SitePolicy): { events: SafeEvent[]; discarded: DiscardedCounts } {
  const [head, ...data] = csvRows(text.replace(/^﻿/, '')), columns = head!.map(c => c.trim());
  if (!['event_id', 'created_at', 'url_path', 'event_type'].every(c => columns.includes(c))) throw new MoveinError('UMAMI_CSV_REQUIRES_EVENT_ID_CREATED_AT_URL_PATH_EVENT_TYPE');
  if (!data.length || data.length > 500) throw new MoveinError('IMPORT_PAGE_REQUIRES_1_TO_500_EVENTS');
  const discarded: DiscardedCounts = { sessionIds: 0, pageTitles: 0, websiteIds: 0, sourceEventIds: 0, rawQueries: 0, referrerPaths: 0, referrerQueries: 0, excludedPaths: 0, extraFields: 0 };
  const own = [site.origin, ...(policy.origins ?? [])].map(hostOf), events: SafeEvent[] = [];
  data.forEach((cells, index) => {
    const invalid = (code: string): never => { throw new MoveinError(`ROW_${index + 1}_${code}`); };
    if (cells.length !== columns.length) return invalid('COLUMN_COUNT');
    const raw = Object.fromEntries(columns.map((c, i) => [c, cells[i]!])) as Record<string, string>;
    if (!raw.event_id || raw.event_id.length > 256) return invalid('EVENT_ID_REQUIRED');
    const match = /^(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?)(Z|[+-]\d{2}(?::?\d{2})?)?$/.exec(raw.created_at ?? '');
    const offset = !match?.[3] || match[3] === 'Z' ? 'Z' : match[3].length === 3 ? `${match[3]}:00` : match[3].includes(':') ? match[3] : `${match[3].slice(0, 3)}:${match[3].slice(3)}`;
    const at = match ? Date.parse(`${match[1]}T${match[2]}${offset}`) : NaN;
    if (!Number.isFinite(at)) return invalid('INVALID_TIMESTAMP');
    if (raw.event_type !== '1' && raw.event_type !== '2') return invalid('UNSUPPORTED_EVENT_TYPE');
    if (!/^\/(?!\/)[^?#\s]*$/.test(raw.url_path ?? '')) return invalid('INVALID_PATH');
    const path = storedPath(policy, raw.url_path!);
    let kind = 'pageview';
    if (raw.event_type === '2') {
      if (!raw.event_name || !Object.hasOwn(policy.goals, raw.event_name) || raw.event_name === 'pageview') return invalid('GOAL_NOT_APPROVED');
      if (!goalApplies(policy.goals[raw.event_name]!, null, path)) return invalid('GOAL_PATH_MISMATCH');
      kind = raw.event_name;
    }
    discarded.sessionIds += Number(!!raw.session_id) + Number(!!raw.visit_id);
    discarded.pageTitles += Number(!!raw.page_title);
    discarded.websiteIds += Number(!!raw.website_id);
    discarded.sourceEventIds++;
    discarded.rawQueries += Number(!!raw.url_query);
    discarded.referrerPaths += Number(!!raw.referrer_path);
    discarded.referrerQueries += Number(!!raw.referrer_query);
    discarded.extraFields += columns.filter(c => !kept.has(c) && !counted.includes(c) && raw[c] !== '').length;
    if (!pathAllowed(policy, path)) { discarded.excludedPaths++; return; }
    const query = raw.url_query ?? '', params = new URLSearchParams(query.startsWith('?') ? query.slice(1) : query);
    const source = visitSource(keptValue(raw.utm_source || params.get('utm_source')), keptValue(params.get('ref') ?? params.get('source')), (raw.referrer_domain ?? '').toLowerCase(), own);
    events.push({ id: sha256(canonicalJson(['vane-umami-event', site.id, raw.event_id])), day: new Date(at).toISOString().slice(0, 10), kind, path, source, campaign: keptValue(raw.utm_campaign || params.get('utm_campaign')) ?? 'none', consent: null, sample_rate: null });
  });
  if (!events.length) throw new MoveinError('IMPORT_PAGE_REQUIRES_1_TO_500_EVENTS');
  return { events, discarded };
}

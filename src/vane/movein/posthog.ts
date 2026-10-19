import { canonicalJson, sha256 } from '../../modules/import-kit/src/provenance/identity.ts';
import type { DiscardedCounts, ImportSite, SafeEvent, SitePolicy } from './types.ts';
import { MoveinError } from './types.ts';
import { hostOf, keptValue, pathAllowed, storedPath, visitSource } from '../paths';
// IMPORT-006: one page of PostHog web events, as PostHog's events API and export return them ({results:[...]}), filtered
// to $pageview. Only the day (UTC), the path, the source and the campaign are kept; the person, session and device IDs,
// the IP address, the title, the full URLs and every other property are counted as discarded and never enter custody.
const known = new Set(['id','uuid','event','timestamp','distinct_id','properties']);
const kept = new Set(['$current_url','$pathname','$referring_domain','utm_source','utm_campaign']);
const identity = ['distinct_id','$session_id','$device_id','$user_id'];
const present = (value: unknown) => value !== undefined && value !== null && value !== '';
export const isPosthogPage = (input: any) => !!input && typeof input === 'object' && !Array.isArray(input) && Array.isArray(input.results) && input.data === undefined;
export function posthogEvents(input: any, site: ImportSite, policy: SitePolicy): { events: SafeEvent[]; discarded: DiscardedCounts } {
  if (!input.results.length || input.results.length > 500) throw new MoveinError('IMPORT_PAGE_REQUIRES_1_TO_500_EVENTS');
  const discarded: DiscardedCounts = { sessionIds: 0, pageTitles: 0, websiteIds: 0, sourceEventIds: 0, rawQueries: 0, referrerPaths: 0, referrerQueries: 0, excludedPaths: 0, extraFields: 0 };
  const own = [site.origin, ...(policy.origins ?? [])].map(hostOf), events: SafeEvent[] = [];
  input.results.forEach((raw: any, index: number) => {
    const invalid = (code: string): never => { throw new MoveinError(`ROW_${index + 1}_${code}`); };
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return invalid('INVALID_EVENT');
    const id = raw.uuid ?? raw.id, p = raw.properties && typeof raw.properties === 'object' && !Array.isArray(raw.properties) ? raw.properties : {};
    if (typeof id !== 'string' || !id || id.length > 256) return invalid('EVENT_ID_REQUIRED');
    if (raw.event !== '$pageview') return invalid('UNSUPPORTED_EVENT_TYPE');
    const at = Date.parse(String(raw.timestamp ?? ''));
    if (typeof raw.timestamp !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})$/.test(raw.timestamp) || !Number.isFinite(at)) return invalid('INVALID_TIMESTAMP');
    let url: URL | null = null; try { url = typeof p.$current_url === 'string' ? new URL(p.$current_url) : null; } catch { url = null; }
    const raw_path = typeof p.$pathname === 'string' ? p.$pathname : url?.pathname ?? '';
    if (!/^\/(?!\/)[^?#\s]*$/.test(raw_path)) return invalid('INVALID_PATH');
    const path = storedPath(policy, raw_path);
    // Every identifier and property beyond the kept ones is counted, then dropped.
    discarded.sessionIds += identity.filter(key => present(key === 'distinct_id' ? raw.distinct_id : p[key])).length;
    discarded.pageTitles += Number(present(p.title ?? p.$title));
    discarded.websiteIds += Number(present(p.token));
    discarded.sourceEventIds++;
    discarded.rawQueries += Number(!!url?.search);
    discarded.referrerPaths += Number(present(p.$referrer) && p.$referrer !== '$direct');
    discarded.extraFields += Object.keys(raw).filter(key => !known.has(key)).length + Object.keys(p).filter(key => !kept.has(key) && !identity.includes(key) && !['title','$title','token','$referrer'].includes(key)).length;
    if (!pathAllowed(policy, path)) { discarded.excludedPaths++; return; }
    const params = url?.searchParams ?? new URLSearchParams(), domain = p.$referring_domain === '$direct' ? '' : String(p.$referring_domain ?? '').toLowerCase();
    const source = visitSource(keptValue(p.utm_source ?? params.get('utm_source')), keptValue(params.get('ref') ?? params.get('source')), domain, own);
    events.push({ id: sha256(canonicalJson(['vane-posthog-event', site.id, id])), day: new Date(at).toISOString().slice(0, 10), kind: 'pageview', path, source, campaign: keptValue(p.utm_campaign ?? params.get('utm_campaign')) ?? 'none', consent: null, sample_rate: null });
  });
  if (!events.length) throw new MoveinError('IMPORT_PAGE_REQUIRES_1_TO_500_EVENTS');
  return { events, discarded };
}

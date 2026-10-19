import { canonicalJson, sha256 } from '../../modules/import-kit/src/provenance/identity.ts';
import type { SourceBundle, ImportMapping, Json } from '../../modules/import-kit/src/types.ts';
import type { DiscardedCounts, ImportSite, SafeEvent, SitePolicy } from './types.ts';
import { MoveinError } from './types.ts';
import { goalMatches } from '../goals';
import { mappingVersion, namespace } from './policy.ts';
import { validateCarry } from './carry.ts';

const known = new Set(['id','websiteId','sessionId','createdAt','urlPath','urlQuery','referrerPath','referrerQuery','referrerDomain','pageTitle','eventType','eventName']);
const present = (value: unknown) => value !== undefined && value !== null && value !== '';
const text = (value: unknown) => typeof value === 'string' ? value : '';

export function normalize(document: unknown, site: ImportSite, policy: SitePolicy) {
  let input: any = document;
  if (typeof document === 'string') {
    if (new TextEncoder().encode(document).length > 2_000_000) throw new MoveinError('DOCUMENT_TOO_LARGE');
    try { input = JSON.parse(document); } catch { throw new MoveinError('INVALID_JSON'); }
  }
  if (input?.format === 'vane-umami-preview/1') {
    const carry = validateCarry(input,policy);
    return normalizedSource(carry.events,carry.discarded,site);
  }
  if (!input || typeof input !== 'object' || !Array.isArray(input.data) || !Number.isSafeInteger(input.count) || input.count < input.data.length || !Number.isSafeInteger(input.page) || input.page < 1 || !Number.isSafeInteger(input.pageSize) || input.pageSize < input.data.length || input.pageSize < 1) throw new MoveinError('UMAMI_EVENTS_PAGE_REQUIRED');
  if (!input.data.length || input.data.length > 500) throw new MoveinError('IMPORT_PAGE_REQUIRES_1_TO_500_EVENTS');
  const discarded: DiscardedCounts = { sessionIds: 0, pageTitles: 0, websiteIds: 0, sourceEventIds: 0, rawQueries: 0, referrerPaths: 0, referrerQueries: 0, unapprovedSources: 0, unapprovedCampaigns: 0, extraFields: 0 };
  const events: SafeEvent[] = input.data.map((raw: any, index: number) => {
    const invalid = (code: string): never => { throw new MoveinError(`ROW_${index + 1}_${code}`); };
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return invalid('INVALID_EVENT');
    if (typeof raw.id !== 'string' || !raw.id || raw.id.length > 256) return invalid('EVENT_ID_REQUIRED');
    if (raw.eventType !== 1 && raw.eventType !== 2) return invalid('UNSUPPORTED_EVENT_TYPE');
    const path = text(raw.urlPath);
    if (!policy.paths.includes(path) || !/^\/(?!\/)[^?#\s]*$/.test(path)) return invalid('PATH_NOT_APPROVED');
    let kind = 'pageview';
    if (raw.eventType === 2) {
      if (typeof raw.eventName !== 'string' || !Object.hasOwn(policy.goals, raw.eventName) || raw.eventName === 'pageview') return invalid('GOAL_NOT_APPROVED');
      if (!goalMatches(policy.goals[raw.eventName]!, path)) return invalid('GOAL_PATH_MISMATCH');
      kind = raw.eventName;
    }
    const created = text(raw.createdAt);
    if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(created) || !Number.isFinite(Date.parse(created))) return invalid('INVALID_TIMESTAMP');
    const day = new Date(created).toISOString().slice(0, 10);
    if (day !== created.slice(0,10)) return invalid('INVALID_TIMESTAMP');
    const domain = text(raw.referrerDomain).toLowerCase();
    const source = !domain ? 'direct' : policy.sources.includes(domain) && /^[a-z0-9.-]+$/.test(domain) ? domain : 'other';
    const query = text(raw.urlQuery);
    const campaignValues = new URLSearchParams(query.startsWith('?') ? query.slice(1) : query).getAll('utm_campaign');
    const token = campaignValues.length === 1 ? campaignValues[0] : '';
    const campaign = campaignValues.length === 0 ? 'none' : token && policy.campaigns.includes(token) && /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,79}$/.test(token) ? token : 'other';
    discarded.sessionIds += Number(present(raw.sessionId));
    discarded.pageTitles += Number(present(raw.pageTitle));
    discarded.websiteIds += Number(present(raw.websiteId));
    discarded.sourceEventIds++;
    discarded.rawQueries += Number(present(raw.urlQuery));
    discarded.referrerPaths += Number(present(raw.referrerPath));
    discarded.referrerQueries += Number(present(raw.referrerQuery));
    discarded.unapprovedSources += Number(source === 'other');
    discarded.unapprovedCampaigns += Number(campaign === 'other');
    discarded.extraFields += Object.keys(raw).filter(key => !known.has(key)).length;
    return { id: sha256(canonicalJson(['vane-umami-event', site.id, raw.id])), day, kind, path, source, campaign, consent: null, sample_rate: null };
  });
  return normalizedSource(events,discarded,site);
}

function normalizedSource(events: SafeEvent[], discarded: DiscardedCounts, site: ImportSite) {
  events.sort((a, b) => a.id.localeCompare(b.id));
  // Only this sanitized, deterministic artifact enters Base's custody boundary.
  const content = canonicalJson({ events, discarded, policyHash: sha256(site.config_json), policyVersion: site.version });
  const artifactHash = sha256(content), name = 'normalized-umami-events.json';
  const source: SourceBundle = {
    artifacts: [{ name, sha256: artifactHash, size: new TextEncoder().encode(content).length }], diagnostics: [],
    records: events.map((event, index) => ({ namespace: namespace(site.id), kind: 'event', sourceId: event.id,
      payload: event as unknown as Json, payloadHash: sha256(canonicalJson(event)), artifactHash,
      location: { artifact: name, row: index + 1 } })),
  };
  return { source, events, discarded };
}
export const mapping: ImportMapping = {
  version: mappingVersion,
  map(record) {
    const event = record.payload as unknown as SafeEvent;
    const { id, ...value } = event;
    return { effects: [{ targetKind: 'analytics-event', targetId: id, value }] };
  },
};

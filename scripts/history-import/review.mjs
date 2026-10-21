import { requireValue } from './common.mjs';

const eventKeys = ['id', 'day', 'kind', 'path', 'source', 'campaign', 'consent', 'sample_rate'];
const discardedKeys = ['sessionIds', 'pageTitles', 'websiteIds', 'sourceEventIds', 'rawQueries',
  'referrerPaths', 'referrerQueries', 'excludedPaths', 'extraFields'];
const countKeys = ['input', 'unique', 'duplicates', 'mapped', 'unmapped', 'rejected', 'effects'];
const nonnegative = value => Number.isSafeInteger(value) && value >= 0;
const exact = (value, keys) => value && typeof value === 'object' && !Array.isArray(value) &&
  Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));

export function reviewedPage(result) {
  const carry = result?.carry;
  requireValue(/^[a-f0-9]{64}$/.test(result?.fingerprint) &&
    exact(carry, ['format', 'events', 'discarded']) && carry.format === 'vane-umami-preview/1' &&
    Array.isArray(carry.events) && carry.events.length > 0 && carry.events.length <= 500,
  'INVALID_PREVIEW_RESPONSE');
  requireValue(exact(carry.discarded, discardedKeys) && discardedKeys.every(key => nonnegative(carry.discarded[key])),
    'INVALID_PREVIEW_RESPONSE');
  for (const event of carry.events) {
    requireValue(exact(event, eventKeys) && /^[a-f0-9]{64}$/.test(event.id) &&
      ['day', 'kind', 'path', 'source', 'campaign'].every(key => typeof event[key] === 'string') &&
      event.consent === null && event.sample_rate === null, 'INVALID_PREVIEW_RESPONSE');
  }
  requireValue(exact(result.counts, [...countKeys, 'byKind']) && countKeys.every(key => nonnegative(result.counts[key])) &&
    exact(result.counts.byKind, ['event']) && nonnegative(result.counts.byKind.event) &&
    result.counts.unmapped === 0 && result.counts.rejected === 0, 'INVALID_PREVIEW_RESPONSE');
  requireValue(exact(result.discarded, discardedKeys) &&
    discardedKeys.every(key => result.discarded[key] === carry.discarded[key]), 'INVALID_PREVIEW_RESPONSE');
  return { carry, fingerprint: result.fingerprint, counts: result.counts, discarded: result.discarded };
}

export function checkHeader(header, format) {
  const columns = header.map(value => value.trim());
  const required = format === 'umami' ? ['event_id', 'created_at', 'url_path', 'event_type'] : ['added_iso', 'path', 'uuid'];
  requireValue(new Set(columns).size === columns.length && required.every(key => columns.includes(key)), 'CSV_FORMAT_MISMATCH');
}

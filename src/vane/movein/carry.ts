import type { SafeEvent, DiscardedCounts, SitePolicy } from './types.ts';
import { MoveinError } from './types.ts';
import { goalMatches } from '../goals';
import { pathAllowed } from '../paths';

const eventKeys = ['id','day','kind','path','source','campaign','consent','sample_rate'];
const discardKeys = ['sessionIds','pageTitles','websiteIds','sourceEventIds','rawQueries','referrerPaths','referrerQueries','excludedPaths','extraFields'];
const exactKeys = (value: unknown, keys: string[]) => value !== null && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value,key));

/** Accept only the sanitized carry that an owner reviewed; never raw private fields. */
export function validateCarry(input: any, policy: SitePolicy): { events: SafeEvent[]; discarded: DiscardedCounts } {
  if (!exactKeys(input,['format','events','discarded']) || input.format !== 'vane-umami-preview/1' || !Array.isArray(input.events) || input.events.length < 1 || input.events.length > 500) throw new MoveinError('INVALID_PREVIEW_CARRY');
  if (!exactKeys(input.discarded,discardKeys) || discardKeys.some(key => !Number.isSafeInteger(input.discarded[key]) || input.discarded[key] < 0)) throw new MoveinError('INVALID_DISCARD_COUNTS');
  const discarded = Object.fromEntries(discardKeys.map(key => [key,input.discarded[key]])) as unknown as DiscardedCounts;
  const events = input.events.map((event: any,index: number): SafeEvent => {
    const fail = (code: string): never => { throw new MoveinError(`ROW_${index + 1}_${code}`); };
    if (!exactKeys(event,eventKeys)) return fail('INVALID_NORMALIZED_EVENT');
    if (typeof event.id !== 'string' || !/^[a-f0-9]{64}$/.test(event.id)) return fail('INVALID_EVENT_ID');
    if (typeof event.day !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(event.day) || !Number.isFinite(Date.parse(event.day)) || new Date(event.day).toISOString().slice(0,10) !== event.day) return fail('INVALID_DAY');
    if (typeof event.path !== 'string' || !/^\/[^?#\s]{0,1023}$/.test(event.path) || !pathAllowed(policy,event.path)) return fail('PATH_NOT_COLLECTED');
    if (typeof event.kind !== 'string' || (event.kind !== 'pageview' && !Object.hasOwn(policy.goals,event.kind))) return fail('GOAL_NOT_APPROVED');
    if (event.kind !== 'pageview' && !goalMatches(policy.goals[event.kind]!,event.path)) return fail('GOAL_PATH_MISMATCH');
    if (typeof event.source !== 'string' || !event.source || event.source.length > 253 || event.source.includes('@')) return fail('INVALID_SOURCE');
    if (typeof event.campaign !== 'string' || !event.campaign || event.campaign.length > 100 || event.campaign.includes('@')) return fail('INVALID_CAMPAIGN');
    if (event.consent !== null || event.sample_rate !== null) return fail('IMPORTED_MEASUREMENT_MUST_BE_UNKNOWN');
    return Object.fromEntries(eventKeys.map(key => [key,event[key]])) as unknown as SafeEvent;
  });
  return { events, discarded };
}

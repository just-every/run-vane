export interface MoveinEnvironment { DB: D1Database }
export interface MoveinActor { id: string; role: string }
export interface SitePolicy {
  paths: string[]; goals: Record<string, string>; campaigns: string[]; sources: string[];
  consent: 'not-required' | 'required'; sampleRate: number; retentionDays: number;
}
export interface ImportSite { id: string; config_json: string; version: number }
export interface SafeEvent {
  id: string; day: string; kind: string; path: string; source: string; campaign: string;
  consent: null; sample_rate: null;
}
export interface DiscardedCounts {
  sessionIds: number; pageTitles: number; websiteIds: number; sourceEventIds: number;
  rawQueries: number; referrerPaths: number; referrerQueries: number;
  unapprovedSources: number; unapprovedCampaigns: number; extraFields: number;
}
export class MoveinError extends Error {
  code: string;
  status: number;
  constructor(code: string, status = 400) { super(code); this.code = code; this.status = status; this.name = 'MoveinError'; }
}

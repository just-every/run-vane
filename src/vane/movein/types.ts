export interface MoveinEnvironment { DB: D1Database }
export interface MoveinActor { id: string; role: string }
import type { Config } from '../core';
export type SitePolicy = Config;
export interface ImportSite { id: string; origin: string; config_json: string; version: number }
export interface SafeEvent {
  id: string; day: string; kind: string; path: string; source: string; campaign: string;
  consent: null; sample_rate: null;
}
export interface DiscardedCounts {
  sessionIds: number; pageTitles: number; websiteIds: number; sourceEventIds: number;
  rawQueries: number; referrerPaths: number; referrerQueries: number;
  excludedPaths: number; extraFields: number;
}
export class MoveinError extends Error {
  code: string;
  status: number;
  constructor(code: string, status = 400) { super(code); this.code = code; this.status = status; this.name = 'MoveinError'; }
}

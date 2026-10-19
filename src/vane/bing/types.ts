export type Kind='query'|'page'|'date'|'query-page'
export interface Connection {
 site_id:string; id:string; property:string; sealed_key:string; connected_by:string; connected_at:number;
 last_attempt_at:number|null; last_sync_at:number|null; next_sync_at:number; error:string|null; query_pages_error:string|null; source_counts:string|null
}
export interface SourceRow {
 Date:unknown; Clicks:unknown; Impressions:unknown; Query?:unknown; AvgImpressionPosition?:unknown
}
export interface Aggregate {
 day:string; kind:Kind; query:string; page:string; clicks:number; impressions:number; position_sum:number; position_weight:number
}
export interface Stored extends Aggregate { property:string; fetched_at:number }
export interface Metrics {clicks:number;impressions:number;ctr:number|null;position:number|null}

export interface ImportedDefinition {
 name:string; kind:'event'|'revenue'|'pageview'; pattern?:string; currency:string; incomplete?:string
}
export interface AggregateRecord {
 id:string; day:string; provider:'matomo'; report:string;
 dimensions:Record<string,string>; metrics:Record<string,number>; definitions:ImportedDefinition[]
}
export const aggregateFields=['day','provider','report','dimensions_json','metrics_json','definitions_json'] as const

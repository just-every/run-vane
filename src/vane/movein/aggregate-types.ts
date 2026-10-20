export interface ImportedDefinition {
 name:string; kind:'event'|'revenue'|'pageview'|'scroll'|'property'; pattern?:string; currency:string; incomplete?:string; event?:string; depth?:number; props?:Record<string,string>; source?:string; requiresObservation?:boolean; currencyConfirmation?:boolean
}
export interface AggregateRecord {
 id:string; day:string; provider:'matomo'|'plausible'; report:string;
 dimensions:Record<string,string>; metrics:Record<string,number>; definitions:ImportedDefinition[]
}
export const aggregateFields=['day','provider','report','dimensions_json','metrics_json','definitions_json'] as const

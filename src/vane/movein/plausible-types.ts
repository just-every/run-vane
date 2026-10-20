export type PlausibleSource = 'Matomo Goals.getGoals' | 'Plausible dashboard conversions.csv' | 'Plausible dashboard custom_props.csv' | 'Plausible Sites API (Stats key)' | 'Plausible Sites API (Enterprise key)'
export interface PlausibleDefinition {
 name:string; kind:'pageview'|'scroll'|'event'|'revenue'|'property'; currency:string;
 pattern?:string; event?:string; depth?:number; props?:Record<string,string>;
 source:PlausibleSource; incomplete?:string; requiresObservation?:boolean; currencyConfirmation?:boolean;
}
export interface PlausibleRecord {
 id:string; day:string; provider:'plausible'; report:'Plausible.conversions'|'Plausible.properties';
 dimensions:Record<string,string>; metrics:Record<string,number>; definitions:PlausibleDefinition[];
}
export interface RecoveredDefinition extends PlausibleDefinition {
 callSites?:{url:string;at:number;kind:string;rewrite:string}[]; recordId:string; liveEvents:number; importedConversions:number; approved?:boolean; liveRevenueCurrencies?:string[];
}

import { insist, type Config } from './core'
// METRIC-004: versioned metric definitions. Today one definition is configurable: the visit timeout, the longest
// gap between one visitor hash's page loads inside a visit (METRIC-002), 30 minutes unless the owner approves
// another whole number of minutes from 15 to 120. Each approved change is a dated definition version that applies
// to whole local days from the day it is approved; earlier days keep the version they were counted under. The
// default is version 1, so the first change is version 2.
export const DEFAULT_VISIT_TIMEOUT=30
export interface DefinitionVersion { metric:'visit-timeout'; from:string; minutes:number; previous:number; approvedAt:number }
export const visitTimeout=(config:Partial<Config>|undefined)=>config?.visitTimeout??DEFAULT_VISIT_TIMEOUT
const minutes=(value:unknown)=>Number.isInteger(value)&&(value as number)>=15&&(value as number)<=120
export function cleanVisitTimeout(input:any):number {
 const value=input.visitTimeout===undefined||input.visitTimeout===''?DEFAULT_VISIT_TIMEOUT:Number(input.visitTimeout);
 insist(minutes(value),'visit_timeout','Choose a visit timeout of 15 to 120 whole minutes.');
 return value;
}
// A site archive (SITE-001) carries its versions; a proposal never sets them (versioned() replaces them on approval).
export function cleanDefinitions(input:unknown):DefinitionVersion[] {
 const list=Array.isArray(input)?input:[];
 insist(list.length<=100&&list.every(v=>v?.metric==='visit-timeout'&&/^\d{4}-\d{2}-\d{2}$/.test(String(v.from))&&minutes(v.minutes)&&minutes(v.previous)&&Number.isSafeInteger(v.approvedAt)),'definitions','Definition versions are dated visit-timeout changes.');
 return list.map(v=>({metric:'visit-timeout',from:v.from,minutes:v.minutes,previous:v.previous,approvedAt:v.approvedAt}));
}
// The configuration an approval stores: the site's earlier versions, plus a new one dated today when the timeout changed.
export function versioned(before:Config|null,next:Config,today:string,at:number):Config {
 const {definitions:_,...rest}=next,history=before?.definitions??[],old=visitTimeout(before??undefined),now=visitTimeout(next);
 const definitions=old===now?history:[...history,{metric:'visit-timeout' as const,from:today,minutes:now,previous:old,approvedAt:at}];
 return {...rest,...(definitions.length?{definitions}:{})};
}
// The visit timeout in milliseconds for a page-load row aliased `row` (it has site_id and day): the latest version
// dated on or before the row's local day, else the default.
export const gapSql=(row:string)=>`(COALESCE((SELECT json_extract(d.value,'$.minutes') FROM vane_sites s,json_each(s.config_json,'$.definitions') d WHERE s.id=${row}.site_id AND json_extract(d.value,'$.metric')='visit-timeout' AND json_extract(d.value,'$.from')<=${row}.day ORDER BY json_extract(d.value,'$.from') DESC,CAST(d.key AS INTEGER) DESC LIMIT 1),${DEFAULT_VISIT_TIMEOUT})*60000)`
// DASH-009: a dated chart annotation; kind is one of ANNOTATION_KINDS (annotations.ts).
export interface Annotation { day:string; kind:string; text:string; site?:string; version?:number; id?:string; url?:string; author?:string }
// DASH-009's definition annotations: every version dated inside the range, named by site in a roll-up.
export function definitionAnnotations(sites:{name:string,config:Config}[],from:string,to:string,named:boolean):Annotation[] {
 return sites.flatMap(site=>(site.config.definitions??[]).map((v,i)=>({v,version:i+2,site}))).filter(({v})=>v.from>=from&&v.from<to).map(({v,version,site})=>({day:v.from,kind:'definition',version,text:`Visit definition v${version}: a visit ends after ${v.minutes} minutes without a page load (was ${v.previous}).`,...(named?{site:site.name}:{})})).sort((a,b)=>a.day.localeCompare(b.day)||a.version-b.version)
}

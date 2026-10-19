import { insist, type Config } from './core'
import { goalMatches, goalPath } from './goals'
import { PUBLIC_REPORTS } from './public-reports'
import { AUTO_EVENTS } from './auto-events'
import { cleanRules } from './paths'
import { cleanSourceRules } from './sources'
// Adapted from Spool origins.ts at 9f75f060a66446f4c9dcf9cafddd0906d7698748.
// An origin limits browser ingestion; it does not authenticate a visitor.
export function browserOrigin(value:unknown):string {
 insist(typeof value==='string'&&value.length>0&&value.length<=1024,'origin','Enter a canonical HTTP(S) origin.');
 let url:URL;try{url=new URL(value)}catch{throw new Error('Enter a canonical HTTP(S) origin.')}
 insist(['http:','https:'].includes(url.protocol)&&!url.username&&!url.password&&url.origin===value&&!url.hostname.includes('*'),'origin','Use an origin without a path, query, credentials or wildcard.');
 return value;
}
const list=(value:unknown)=>Array.isArray(value)?value.map(String):String(value??'').split(/[\n,]/).map(x=>x.trim()).filter(Boolean)
export function cleanConfig(input:any):Config {
 // COLLECT-002: every path is collected unless an optional include list leaves it out or an exclude list names it.
 const paths=[...new Set(list(input.paths))],excludePaths=[...new Set(list(input.excludePaths))],rewrites=cleanRules(input.rewrites),sourceRules=cleanSourceRules(input.sourceRules),queryKeys=[...new Set(list(input.queryKeys).map(key=>key.toLowerCase()))];
 // A goal is a page load of a path (signup=/thanks) or, from METRIC-006's scroll depth, reaching N% of it (deep-read=/journal@75).
 const lines=typeof input.goals==='object'&&!Array.isArray(input.goals)&&input.goals?Object.entries(input.goals).map(([name,path])=>[name,String(path)]):list(input.goals).map(x=>x.split('=').map(v=>v.trim()));
 const scrollLines=input.scrollGoals&&typeof input.scrollGoals==='object'&&!Array.isArray(input.scrollGoals)?Object.entries(input.scrollGoals).map(([name,goal]:[string,any])=>[name,`${goal?.path}@${goal?.depth}`]):[];
 const goals:Record<string,string>={},scrollGoals:Record<string,{path:string,depth:number}>={},names:string[]=[];
 for(const [name,value] of [...lines,...scrollLines]){const scroll=String(value).match(/^(.*)@(\d{1,3})$/);names.push(String(name));if(scroll)scrollGoals[String(name)]={path:scroll[1]!,depth:Number(scroll[2])};else goals[String(name)]=String(value)}
 insist([paths,excludePaths].every(group=>group.length<=50&&group.every(p=>/^\/[A-Za-z0-9_\-/*.:]{0,119}$/.test(p))),'paths','List up to 50 paths or patterns such as /blog/** to include, and up to 50 to exclude, without queries.');
 insist(queryKeys.length<=10&&queryKeys.every(key=>/^[a-z][a-z0-9_-]{0,39}$/.test(key)&&!/^(utm_|ref$|source$|gclid$|fbclid$|msclkid$)/.test(key)),'query_keys','Name up to 10 other query parameters to keep, such as plan; UTM, ref and source are always kept.');
 insist(names.length<=20&&new Set(names).size===names.length&&names.every(name=>/^[a-z][a-z0-9-]{0,39}$/.test(name)&&name!=='pageview')&&[...Object.values(goals),...Object.values(scrollGoals).map(goal=>goal.path)].every(goal=>/^(?:[a-z0-9-]+(?:\.[a-z0-9-]+)+)?\/[a-z0-9_\-/*]{0,119}$/.test(goal)&&(paths.length===0||paths.some(allowed=>goalMatches(goalPath(goal),allowed))))&&Object.values(scrollGoals).every(goal=>goal.depth>=1&&goal.depth<=100),'goals','Use goal-name=/path or a pattern such as /thanks/* (one segment) or /blog/** (any depth) that matches an included path, or add @75 for a scroll depth, and prefix a hostname (blog.example.com/thanks) to count it on that hostname only; one per line.');
 const consent=input.consent??'required',sampleRate=Number(input.sampleRate??100),retentionDays=Number(input.retentionDays??90);
 insist(['required','not-required'].includes(consent),'consent','Choose an explicit consent mode.');
 insist([10,25,50,100].includes(sampleRate),'sample_rate','Choose 10, 25, 50 or 100 percent.');
 insist([30,90,365].includes(retentionDays),'retention','Choose 30, 90 or 365 days.');
 const signalCounter=input.signalCounter===true||input.signalCounter==='on',declinedCounter=input.declinedCounter===true||input.declinedCounter==='on',timeZone=String(input.timeZone||'UTC').trim();
 const searchParam=String(input.searchParam??'').trim();
 insist(searchParam===''||/^[a-z][a-z0-9_-]{0,19}$/.test(searchParam),'search_param','Name the site-search query parameter, such as q, or leave it empty.');
 // SHARE-002: the reports a public stats page shows (none: no public page) and whether search engines may index it.
 const publicReports:string[]=Array.isArray(input.publicReports)?[...new Set<string>(input.publicReports.map(String))]:Object.keys(PUBLIC_REPORTS).filter(key=>input['public_'+key]==='on');
 insist(publicReports.every(key=>Object.hasOwn(PUBLIC_REPORTS,key)),'public_reports','Choose public reports from the listed ones.');
 const publicIndexing=publicReports.length>0&&(input.publicIndexing===true||input.publicIndexing==='on');
 // CONV-003: automatic events the site turns on.
 const autoEvents:string[]=Array.isArray(input.autoEvents)?[...new Set<string>(input.autoEvents.map(String))]:AUTO_EVENTS.filter(kind=>input['auto_'+kind]==='on');
 insist(autoEvents.every(kind=>(AUTO_EVENTS as readonly string[]).includes(kind)),'auto_events','Choose automatic events from outbound, download, 404 and form.');
 // SITE-001: extra allowed origins (such as www beside the apex) and the ISO 4217 currency revenue is reported in.
 const origins=[...new Set(list(input.origins))].map(browserOrigin),currency=String(input.currency||'USD').trim().toUpperCase();
 insist(origins.length<=10,'origins','Allow up to 10 extra origins.');
 insist(/^[A-Z]{3}$/.test(currency)&&Intl.supportedValuesOf('currency').includes(currency),'currency','Choose an ISO 4217 currency code, such as USD or EUR.');
 insist(/^[A-Za-z_]+(?:\/[A-Za-z0-9_+-]+)*$/.test(timeZone)&&(()=>{try{new Intl.DateTimeFormat('en-US',{timeZone}).format(0);return true}catch{return false}})(),'time_zone','Choose an IANA time zone, such as America/New_York.');
 return {paths,...(excludePaths.length?{excludePaths}:{}),...(rewrites.length?{rewrites}:{}),...(queryKeys.length?{queryKeys}:{}),...(sourceRules.length?{sourceRules}:{}),...(declinedCounter?{declinedCounter}:{}),goals,scrollGoals,consent,sampleRate,retentionDays,signalCounter,timeZone,currency,...(origins.length?{origins}:{}),...(searchParam?{searchParam}:{}),...(publicReports.length?{publicReports,publicIndexing}:{}),...(autoEvents.length?{autoEvents}:{})};
}
export function cleanSite(input:any) { const name=String(input.name??'').trim(); insist(name.length>0&&name.length<=80&&!/[<>@]/.test(name),'name','Enter a short site name, without personal details.'); const origin=browserOrigin(input.origin),config=cleanConfig(input.config??input); insist(!config.origins?.includes(origin),'origins','Extra origins must differ from the website origin.'); return {name,origin,config} }

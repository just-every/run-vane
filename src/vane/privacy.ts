import { insist, type Config } from './core'
import { goalMatches } from './goals'
import { PUBLIC_REPORTS } from './public-reports'
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
 const paths=[...new Set(list(input.paths))],campaigns=[...new Set(list(input.campaigns))],sources=[...new Set(list(input.sources))];
 // A goal is a page load of a path (signup=/thanks) or, from METRIC-006's scroll depth, reaching N% of it (deep-read=/journal@75).
 const lines=typeof input.goals==='object'&&!Array.isArray(input.goals)&&input.goals?Object.entries(input.goals).map(([name,path])=>[name,String(path)]):list(input.goals).map(x=>x.split('=').map(v=>v.trim()));
 const scrollLines=input.scrollGoals&&typeof input.scrollGoals==='object'&&!Array.isArray(input.scrollGoals)?Object.entries(input.scrollGoals).map(([name,goal]:[string,any])=>[name,`${goal?.path}@${goal?.depth}`]):[];
 const goals:Record<string,string>={},scrollGoals:Record<string,{path:string,depth:number}>={},names:string[]=[];
 for(const [name,value] of [...lines,...scrollLines]){const scroll=String(value).match(/^(.*)@(\d{1,3})$/);names.push(String(name));if(scroll)scrollGoals[String(name)]={path:scroll[1]!,depth:Number(scroll[2])};else goals[String(name)]=String(value)}
 insist(paths.length>0&&paths.length<=50&&paths.every(p=>/^\/(?:[a-z0-9_-]+\/?)*$/.test(p)&&p.length<=120),'paths','Allow 1–50 static lowercase paths without queries, names or identifiers.');
 insist(campaigns.length<=30&&campaigns.every(c=>/^[a-z][a-z0-9-]{0,39}$/.test(c)),'campaigns','Campaigns must be short lowercase names.');
 insist(sources.length<=30&&sources.every(s=>/^(?:[a-z0-9-]+\.)+[a-z]{2,20}$/.test(s)&&s.length<=80),'sources','Sources must be public referring hostnames.');
 insist(names.length<=20&&new Set(names).size===names.length&&names.every(name=>/^[a-z][a-z0-9-]{0,39}$/.test(name)&&name!=='pageview')&&[...Object.values(goals),...Object.values(scrollGoals).map(goal=>goal.path)].every(path=>/^\/[a-z0-9_\-/*]{0,119}$/.test(path)&&paths.some(allowed=>goalMatches(path,allowed)))&&Object.values(scrollGoals).every(goal=>goal.depth>=1&&goal.depth<=100),'goals','Use goal-name=/path or a pattern such as /thanks* or /blog/** that matches an allowed path, or add @75 for a scroll depth; one per line.');
 const consent=input.consent??'required',sampleRate=Number(input.sampleRate??100),retentionDays=Number(input.retentionDays??90);
 insist(['required','not-required'].includes(consent),'consent','Choose an explicit consent mode.');
 insist([10,25,50,100].includes(sampleRate),'sample_rate','Choose 10, 25, 50 or 100 percent.');
 insist([30,90,365].includes(retentionDays),'retention','Choose 30, 90 or 365 days.');
 const signalCounter=input.signalCounter===true||input.signalCounter==='on',timeZone=String(input.timeZone||'UTC').trim();
 const searchParam=String(input.searchParam??'').trim();
 insist(searchParam===''||/^[a-z][a-z0-9_-]{0,19}$/.test(searchParam),'search_param','Name the site-search query parameter, such as q, or leave it empty.');
 // SHARE-002: the reports a public stats page shows (none: no public page) and whether search engines may index it.
 const publicReports:string[]=Array.isArray(input.publicReports)?[...new Set<string>(input.publicReports.map(String))]:Object.keys(PUBLIC_REPORTS).filter(key=>input['public_'+key]==='on');
 insist(publicReports.every(key=>Object.hasOwn(PUBLIC_REPORTS,key)),'public_reports','Choose public reports from the listed ones.');
 const publicIndexing=publicReports.length>0&&(input.publicIndexing===true||input.publicIndexing==='on');
 insist(/^[A-Za-z_]+(?:\/[A-Za-z0-9_+-]+)*$/.test(timeZone)&&(()=>{try{new Intl.DateTimeFormat('en-US',{timeZone}).format(0);return true}catch{return false}})(),'time_zone','Choose an IANA time zone, such as America/New_York.');
 return {paths,goals,scrollGoals,campaigns,sources,consent,sampleRate,retentionDays,signalCounter,timeZone,...(searchParam?{searchParam}:{}),...(publicReports.length?{publicReports,publicIndexing}:{})};
}
export function cleanSite(input:any) { const name=String(input.name??'').trim(); insist(name.length>0&&name.length<=80&&!/[<>@]/.test(name),'name','Enter a short site name, without personal details.'); return {name,origin:browserOrigin(input.origin),config:cleanConfig(input.config??input)} }

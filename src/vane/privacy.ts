import { insist, type Config } from './core'
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
 const goals:Record<string,string>=typeof input.goals==='object'&&!Array.isArray(input.goals)&&input.goals?{...input.goals}:Object.fromEntries(list(input.goals).map(x=>x.split('=').map(v=>v.trim())));
 insist(paths.length>0&&paths.length<=50&&paths.every(p=>/^\/(?:[a-z0-9_-]+\/?)*$/.test(p)&&p.length<=120),'paths','Allow 1–50 static lowercase paths without queries, names or identifiers.');
 insist(campaigns.length<=30&&campaigns.every(c=>/^[a-z][a-z0-9-]{0,39}$/.test(c)),'campaigns','Campaigns must be short lowercase names.');
 insist(sources.length<=30&&sources.every(s=>/^(?:[a-z0-9-]+\.)+[a-z]{2,20}$/.test(s)&&s.length<=80),'sources','Sources must be public referring hostnames.');
 insist(Object.keys(goals).length<=20&&Object.entries(goals).every(([name,path])=>/^[a-z][a-z0-9-]{0,39}$/.test(name)&&name!=='pageview'&&paths.includes(path)),'goals','Use goal-name=/allowed-path, one per line.');
 const consent=input.consent??'required',sampleRate=Number(input.sampleRate??100),retentionDays=Number(input.retentionDays??90);
 insist(['required','not-required'].includes(consent),'consent','Choose an explicit consent mode.');
 insist([10,25,50,100].includes(sampleRate),'sample_rate','Choose 10, 25, 50 or 100 percent.');
 insist([30,90,365].includes(retentionDays),'retention','Choose 30, 90 or 365 days.');
 return {paths,goals,campaigns,sources,consent,sampleRate,retentionDays};
}
export function cleanSite(input:any) { const name=String(input.name??'').trim(); insist(name.length>0&&name.length<=80&&!/[<>@]/.test(name),'name','Enter a short site name, without personal details.'); return {name,origin:browserOrigin(input.origin),config:cleanConfig(input.config??input)} }

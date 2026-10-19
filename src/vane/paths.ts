import { insist, type Config } from './core'
import { goalMatches } from './goals'
// COLLECT-002: every page is collected; what is stored is decided here, before storage.
// A path segment (percent-decoded) is replaced when it looks personal or unique:
//   :email   it contains @
//   :uuid    it is a UUID (8-4-4-4-12 hexadecimal digits)
//   :number  it contains a run of 6 or more digits (order, account and phone numbers)
//   :token   it is 16 or more characters of letters, digits and - _ . = with a digit, where no part
//            between - _ . is a word of 3 or more letters only (so slugs such as top-10-brews-2024 stay)
// The owner's rewrite rules then run in order and the first match wins: /orders/* = /orders/:id.
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
function segment(raw:string):string {
 let value=raw;try{value=decodeURIComponent(raw)}catch{}
 if(value.includes('@'))return ':email';
 if(UUID.test(value))return ':uuid';
 if(/\d{6,}/.test(value))return ':number';
 if(value.length>=16&&/^[A-Za-z0-9_.=-]+$/.test(value)&&/\d/.test(value)&&!value.split(/[-_.]/).some(part=>/^[A-Za-z]{3,}$/.test(part)))return ':token';
 return raw;
}
export function redactPath(path:string):string { return path.split('/').map(segment).join('/') }
export function storedPath(config:Config,path:string):string {
 const redacted=redactPath(path);
 return (config.rewrites??[]).find(rule=>goalMatches(rule.from,redacted))?.to??redacted;
}
// The include list is optional (empty: every path); an excluded path is never collected.
export const pathAllowed=(config:Config,path:string)=>((config.paths??[]).length===0||config.paths.some(p=>goalMatches(p,path)))&&!(config.excludePaths??[]).some(p=>goalMatches(p,path))

// Kept query values (UTM fields, ref/source, owner-allowed keys) are trimmed and cut to 100 characters;
// a value that looks personal (an email address, a phone or account number, a web address) is dropped.
export function keptValue(value:unknown):string|null {
 if(typeof value!=='string')return null;
 const text=value.trim().slice(0,100);
 return !text||/@|\d[\d\s().-]{5,}\d|https?:|www\./i.test(text)?null:text;
}
// A visit's source: utm_source, else the ref or source parameter, else the referring hostname, else direct.
// A referrer on one of the site's own hostnames is an internal navigation, so it counts as direct.
export function visitSource(utmSource:string|null,ref:string|null,referrer:unknown,own:string[]):string {
 if(utmSource)return utmSource;
 if(ref)return ref;
 const host=typeof referrer==='string'?referrer.toLowerCase():'';
 return (/^(?:[a-z0-9-]+\.)+[a-z0-9-]{2,63}$/.test(host)||/^android-app:\/\/[a-z0-9._]{1,200}$/.test(host))&&host.length<=253&&!own.includes(host)?host:'direct';
}
export const hostOf=(origin:string)=>new URL(origin).hostname.toLowerCase()
export function cleanRules(input:unknown):{from:string,to:string}[] {
 const lines=Array.isArray(input)?input.map((rule:any)=>typeof rule==='string'?rule:`${rule?.from}=${rule?.to}`):String(input??'').split('\n').map(x=>x.trim()).filter(Boolean);
 insist(lines.length<=20,'rewrites','Use at most 20 rewrite rules.');
 return lines.map(line=>{const [from,to]=line.split('=').map(x=>x.trim());insist(/^\/[A-Za-z0-9_\-/*.:]{0,119}$/.test(from??'')&&/^\/[A-Za-z0-9_\-/.:]{0,119}$/.test(to??''),'rewrites','Write each rewrite rule as /orders/*=/orders/:id, one per line.');return {from:from!,to:to!}});
}

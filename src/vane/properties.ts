import { insist, statement, type Env } from './core'
import { keptValue, redactPath } from './paths'
// CONV-002: the properties of a custom event or a pageview: up to 30, keys of 1-40 lowercase letters, digits, _ or -,
// values strings (trimmed, up to 100 characters) or finite numbers. A key or value that looks like an email address
// refuses the whole event; a string value that looks like a phone or account number or a web address is dropped
// (and counted per site and day as a dropped property, COVERAGE-001); every kept string then takes the COLLECT-002
// path redaction (:uuid, :number, :token per segment).
export const MAX_PROPS=30
const EMAIL=/[^\s@]+@[^\s@]+\.[^\s@]+/
export interface Props { kept:[string,string][]; dropped:number }
export function cleanProps(input:unknown):Props {
 if(input===undefined)return {kept:[],dropped:0};
 insist(input&&typeof input==='object'&&!Array.isArray(input),'props','Send properties as an object of names and values.');
 const entries=Object.entries(input as Record<string,unknown>);
 insist(entries.length<=MAX_PROPS,'props',`An event carries at most ${MAX_PROPS} properties.`);
 let dropped=0;const kept:[string,string][]=[];
 for(const [key,raw] of entries){
  insist(/^[a-z0-9_-]{1,40}$/.test(key),'props','Name properties with 1 to 40 lowercase letters, digits, _ or -.');
  insist(typeof raw==='string'||typeof raw==='number'&&Number.isFinite(raw),'props','A property value is a string or a number.');
  if(typeof raw==='number'){kept.push([key,String(raw)]);continue}
  insist(!EMAIL.test(raw),'personal','An event carrying an email address is refused.');
  insist(raw.trim().length>0&&raw.length<=100,'props','A property value has 1 to 100 characters.');
  const value=keptValue(raw);
  if(value===null){dropped++;continue}
  kept.push([key,redactPath(value)]);
 }
 return {kept,dropped};
}
export const propStatements=(env:Env,eventId:string,siteId:string,day:string,props:Props)=>props.kept.map(([key,value])=>statement(env,'INSERT OR IGNORE INTO vane_event_props(event_id,site_id,day,key,value) VALUES(?,?,?,?,?)',eventId,siteId,day,key,value))
export const droppedStatement=(env:Env,siteId:string,day:string,props:Props)=>props.dropped?[statement(env,"INSERT INTO vane_exclusions(site_id,day,reason,count) VALUES(?,?,'dropped-property',?) ON CONFLICT(site_id,day,reason) DO UPDATE SET count=count+excluded.count",siteId,day,props.dropped)]:[]
// A custom event's name: 1 to 60 characters of plain text, never an email address.
export function eventName(input:unknown):string {
 const name=String(input??'').trim();
 insist(name.length>0&&name.length<=60&&!/[\u0000-\u001f\u007f<>]/.test(name)&&name!=='pageview','name','Name the event in up to 60 characters of plain text.');
 insist(!EMAIL.test(name),'personal','An event carrying an email address is refused.');
 return name;
}

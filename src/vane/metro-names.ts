import { allow, atomic, inScope, insist, rows, site, statement, uid, type Actor, type Env } from './core'
import { auditStatement } from './audit'
// DASH-016 (RULINGS.md RL-1; ct ruling 20 Oct 2026 22:31Z, Outcome B): Vane ships no US metro-area (DMA) code-to-name table, because no
// published source licenses one for this MIT repository. A site's metro names come only from its own table: a
// signed-in owner or administrator uploads a UTF-8 CSV with the header metro_code,metro_name (at most 1,000 rows and
// 262,144 bytes) with a source label and the owner's statement; it waits as a proposal, and only the owner's approval
// (APPROVE-001) replaces the site's whole table at once, on every surface and for older data too. Any error refuses
// the whole file, naming its rows (counted from the first row after the header), and changes nothing. There is no
// import from a web address, and no API key, provisioning key or agent command prepares one. Events keep only the
// code; a name is looked up when a report, export or API answer is made. The table is a site setting holding no
// visitor data: it travels with the archive, restore and site transfer, erasure and retention leave it alone, and it
// is never sent anywhere.
export const METRO_STATEMENT='This site may use and show these names under the terms of their source'
export const METRO_LIMITS={rows:1000,bytes:262144,name:100,label:200} as const
export const UNKNOWN_METRO='Unknown metro area',UNKNOWN_LOCATION='Unknown location'
export const unnamedMetro=(code:string)=>`Metro ${code} (unnamed)`
export interface MetroTable { label:string|null; public:boolean; rows:number; version:number; approvedBy:string|null; approver:string|null; approvedAt:number|null }
export interface MetroNaming { names:Map<string,string>; labels:string[]; public:boolean }
export interface Place { city:string|null; region:string|null }
const CONTROL=/[\u0000-\u001f\u007f-\u009f]/
const refuse=(message:string)=>insist(false,'metro_names',`Nothing changed: ${message}`)
// RFC 4180 records: a field in double quotes may hold commas and "" for a quote; records end at CRLF or LF.
function records(text:string):string[][] {
 const out:string[][]=[];let row:string[]=[],field='',quoted=false,closed=false
 for(let i=0;i<text.length;i++){
  const c=text[i]!
  if(quoted){if(c!=='"')field+=c;else if(text[i+1]==='"'){field+='"';i++}else{quoted=false;closed=true};continue}
  if(c==='"'&&field===''&&!closed){quoted=true;continue}
  if(c===','){row.push(field);field='';closed=false;continue}
  if(c==='\n'||(c==='\r'&&text[i+1]==='\n')){if(c==='\r')i++;row.push(field);out.push(row);row=[];field='';closed=false;continue}
  if(closed)refuse(`row ${out.length} has text after a closing quote.`)
  field+=c
 }
 if(quoted)refuse('a quoted field never closes.')
 if(field!==''||row.length||closed){row.push(field);out.push(row)}
 return out
}
export function parseMetroCsv(file:unknown):{code:string,name:string}[] {
 insist(file instanceof Uint8Array&&file.length>0,'metro_names','Nothing changed: choose the CSV file of metro names to upload.')
 if(file.length>METRO_LIMITS.bytes)refuse(`the file is ${file.length} bytes, over the ${METRO_LIMITS.bytes}-byte (256 KB) limit.`)
 let text='';try{text=new TextDecoder('utf-8',{fatal:true}).decode(file)}catch{refuse('the file is not UTF-8 text.')}
 const table=records(text.replace(/^﻿/,'')),header=table.shift()
 if(!header||header.length!==2||header[0]!=='metro_code'||header[1]!=='metro_name')refuse('the first row must be exactly metro_code,metro_name.')
 if(!table.length)refuse('the file names no metro area. Clear the names instead to remove the table.')
 if(table.length>METRO_LIMITS.rows)refuse(`the file has ${table.length} rows, over the ${METRO_LIMITS.rows}-row limit.`)
 const errors:string[]=[],first=new Map<string,number>()
 const names=table.map((record,i)=>{
  const n=i+1,[code='',raw='']=record,name=raw.trim()
  if(record.length!==2){errors.push(`row ${n} has ${record.length} columns, not 2`);return {code,name}}
  if(!/^[0-9]{3}$/.test(code))errors.push(`row ${n}: the code is not exactly 3 digits`)
  else if(first.has(code))errors.push(`row ${n}: code ${code} repeats row ${first.get(code)}`)
  else first.set(code,n)
  if(CONTROL.test(raw))errors.push(`row ${n}: the name holds a control character`)
  else if(!name||[...name].length>METRO_LIMITS.name)errors.push(`row ${n}: a name has 1 to ${METRO_LIMITS.name} characters`)
  else if(/^[=+\-@]/.test(name))errors.push(`row ${n}: a name may not start with =, +, - or @`)
  return {code,name}
 })
 if(errors.length)refuse(errors.slice(0,20).join('; ')+(errors.length>20?`; and ${errors.length-20} more`:'')+'.')
 return names
}
const tableVersion=async(env:Env,siteId:string)=>Number((await rows<{version:number}>(env,'SELECT version FROM vane_metro_tables WHERE site_id=?',siteId))[0]?.version??0)
// The preview the owner reviews before approving: rows; added, changed and removed names against the approved table;
// the codes seen in the site's events that the file names or leaves unnamed; and its codes never seen.
async function preview(env:Env,siteId:string,names:{code:string,name:string}[]) {
 const [current,seen]=await Promise.all([rows<{metro_code:string,metro_name:string}>(env,'SELECT metro_code,metro_name FROM vane_metro_names WHERE site_id=? ORDER BY metro_code',siteId),rows<{c:string}>(env,'SELECT DISTINCT metro_code AS c FROM vane_events WHERE site_id=? AND metro_code IS NOT NULL ORDER BY c',siteId)])
 const now=new Map(current.map(r=>[r.metro_code,r.metro_name])),next=new Map(names.map(r=>[r.code,r.name])),codes=seen.map(r=>r.c)
 return {rows:names.length,added:names.filter(r=>!now.has(r.code)),changed:names.filter(r=>now.has(r.code)&&now.get(r.code)!==r.name).map(r=>({code:r.code,from:now.get(r.code)!,to:r.name})),removed:current.filter(r=>!next.has(r.metro_code)).map(r=>({code:r.metro_code,name:r.metro_name})),seenNamed:codes.filter(c=>next.has(c)),seenUnnamed:codes.filter(c=>!next.has(c)),neverSeen:names.map(r=>r.code).filter(c=>!codes.includes(c)).sort()}
}
// Upload (or clear) on the site's settings page: an owner or an administrator of the site prepares, the owner approves.
export async function prepareMetroNames(env:Env,actor:Actor,p:Record<string,any>,clear=false) {
 allow(actor,'admin');const siteId=String(p.siteId??'');inScope(actor,siteId);await site(env,siteId)
 insist(!Object.keys(p).some(k=>/url/i.test(k)),'metro_names','Nothing changed: upload the CSV file itself. Vane never fetches a metro-name table from a web address.')
 let payload:Record<string,unknown>
 if(clear)payload={siteId,version:await tableVersion(env,siteId),clear:true,preview:await preview(env,siteId,[])}
 else {
  const label=String(p.label??'').trim()
  insist(label&&[...label].length<=METRO_LIMITS.label&&!CONTROL.test(label),'metro_names',`Nothing changed: name the table's source in 1 to ${METRO_LIMITS.label} characters.`)
  insist(p.statement==='on','metro_names',`Nothing changed: confirm “${METRO_STATEMENT}”.`)
  const names=parseMetroCsv(p.metroNames)
  payload={siteId,version:await tableVersion(env,siteId),label,statement:METRO_STATEMENT,public:p.public==='on',names:names.map(r=>[r.code,r.name]),preview:await preview(env,siteId,names)}
 }
 const id=uid()
 await atomic(env,actor,[statement(env,"INSERT INTO vane_proposals(id,command,payload_json,state,prepared_by,created_at) VALUES(?,'metro.names',?,'pending',?,?)",id,JSON.stringify(payload),actor.id,Date.now()),auditStatement(env,actor.id,'proposal.prepare',id,`metro.names for site ${siteId} via app`)],['owner','admin'])
 return {id,siteId}
}
// The owner's approval replaces the whole table in one batch, refused if another approval changed it since preparation.
export async function approveMetroNames(env:Env,actor:Actor,proposal:Record<string,any>,payload:any) {
 const siteId=String(payload.siteId),at=Date.now(),names:[string,string][]=payload.clear?[]:payload.names
 await site(env,siteId)
 insist(await tableVersion(env,siteId)===payload.version,'stale','The site’s metro names changed after this table was prepared; prepare it again.',409)
 await atomic(env,actor,[
  statement(env,"INSERT INTO vane_guard(value) SELECT CASE WHEN EXISTS(SELECT 1 FROM vane_proposals WHERE id=? AND state='pending') THEN 1 ELSE 0 END",proposal.id),
  statement(env,'INSERT INTO vane_guard(value) SELECT CASE WHEN COALESCE((SELECT version FROM vane_metro_tables WHERE site_id=?),0)=? THEN 1 ELSE 0 END',siteId,payload.version),
  statement(env,'DELETE FROM vane_metro_names WHERE site_id=?',siteId),
  statement(env,"INSERT INTO vane_metro_names(site_id,metro_code,metro_name) SELECT ?,json_extract(value,'$[0]'),json_extract(value,'$[1]') FROM json_each(?)",siteId,JSON.stringify(names)),
  statement(env,'INSERT INTO vane_metro_tables(site_id,label,public,rows,version,prepared_by,approved_by,approved_at) VALUES(?,?,?,?,1,?,?,?) ON CONFLICT(site_id) DO UPDATE SET label=excluded.label,public=excluded.public,rows=excluded.rows,version=vane_metro_tables.version+1,prepared_by=excluded.prepared_by,approved_by=excluded.approved_by,approved_at=excluded.approved_at',siteId,payload.clear?null:payload.label,payload.public?1:0,names.length,proposal.prepared_by,actor.id,at),
  statement(env,"UPDATE vane_proposals SET state='approved',approved_by=?,approved_at=? WHERE id=? AND state='pending'",actor.id,at,proposal.id),
  auditStatement(env,actor.id,'proposal.approve',proposal.id,`metro.names for site ${siteId}`),
  auditStatement(env,actor.id,'metro.names',siteId,payload.clear?'cleared; every code shows unnamed':`${names.length} names from ${payload.label}; shared and public pages ${payload.public?'on':'off'}`),
 ])
 return {id:proposal.id,state:'approved',siteId}
}
// The site's approved table as its settings page shows it, with the codes seen in its events that it leaves unnamed.
export async function metroSetting(env:Env,siteId:string):Promise<MetroTable&{unnamedSeen:string[]}> {
 const [meta,unnamed]=await Promise.all([rows<any>(env,'SELECT t.*,o.display_name AS approver FROM vane_metro_tables t LEFT JOIN oa_operators o ON o.id=t.approved_by WHERE t.site_id=?',siteId),rows<{c:string}>(env,'SELECT DISTINCT e.metro_code AS c FROM vane_events e WHERE e.site_id=?1 AND e.metro_code IS NOT NULL AND NOT EXISTS(SELECT 1 FROM vane_metro_names n WHERE n.site_id=?1 AND n.metro_code=e.metro_code) ORDER BY c',siteId)])
 const t=meta[0]
 return {label:t?.label??null,public:Boolean(t?.public),rows:Number(t?.rows??0),version:Number(t?.version??0),approvedBy:t?.approved_by??null,approver:t?.approver??null,approvedAt:t?.approved_at??null,unnamedSeen:unnamed.map(r=>r.c)}
}
// Names for one site, or a roll-up's members in order (the first member's name for a code wins), at answer time.
export async function metroNaming(env:Env,siteIds:string[]):Promise<MetroNaming> {
 const scope=JSON.stringify(siteIds),[names,tables]=await Promise.all([rows<{site_id:string,metro_code:string,metro_name:string}>(env,'SELECT site_id,metro_code,metro_name FROM vane_metro_names WHERE site_id IN (SELECT value FROM json_each(?))',scope),rows<{site_id:string,label:string,public:number}>(env,'SELECT site_id,label,public FROM vane_metro_tables WHERE rows>0 AND site_id IN (SELECT value FROM json_each(?))',scope)])
 const map=new Map<string,string>()
 for(const id of siteIds)for(const r of names)if(r.site_id===id&&!map.has(r.metro_code))map.set(r.metro_code,r.metro_name)
 return {names:map,labels:siteIds.flatMap(id=>tables.filter(t=>t.site_id===id).map(t=>t.label)),public:siteIds.length===1&&tables.some(t=>Boolean(t.public))}
}
// A metro row's key is its 3-digit code, or the Unknown metro area / Unknown location row; its label is the approved
// name, else "Metro NNN (unnamed)".
export function named(key:string,naming:MetroNaming) {
 const code=/^[0-9]{3}$/.test(key)?key:null,name=code?naming.names.get(code)??null:null
 return {label:code?name??unnamedMetro(code):key,metro_code:code,metro_name:name}
}
// The observed place of an unnamed code: the city with the most unique visitors among the metro's visits (ties
// alphabetical) with its region; the region alone when no city is known. Display only: never stored, never put in
// metro_name, never exported and never returned by an API.
export function leadingPlace(groups:{city:string|null,region:string|null,visitors:number}[]):Place|null {
 const order=(a:{visitors:number,key:string},b:{visitors:number,key:string})=>b.visitors-a.visitors||(a.key<b.key?-1:a.key>b.key?1:0)
 const cities=groups.filter(g=>g.city).map(g=>({...g,key:`${g.city}\u0000${g.region??''}`})).sort(order)
 if(cities[0])return {city:cities[0].city,region:cities[0].region}
 const regions=[...groups.filter(g=>g.region).reduce((m,g)=>m.set(g.region!,(m.get(g.region!)??0)+g.visitors),new Map<string,number>())].map(([key,visitors])=>({key,visitors})).sort(order)
 return regions[0]?{city:null,region:regions[0].key}:null
}
export const placeText=(place:Place|null|undefined)=>place?[place.city,place.region].filter(Boolean).join(', '):''

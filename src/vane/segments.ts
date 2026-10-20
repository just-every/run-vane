import { allow, day, inScope, insist, rows, site, statement, uid, type Actor, type Env } from './core'
import { auditStatement } from './audit'
import { clock } from './clock'
import { gapSql } from './definitions'
import { goalMatches } from './goals'
import { sourceNameSql, type SourceRule } from './sources'
// DASH-007: filters and saved segments. A filter keeps or drops whole visits, so every total, table, chart, funnel
// and explanation of a filtered report is computed over the page loads (and their goal events) of the kept visits.
// Acquisition, device and location (DASH-005) dimensions judge each visit's first page load, as the channel and source tables do (DASH-004);
// page, hostname, site-search term and goal dimensions match a visit when any of its page loads matches (is, contains, matches) or when
// none does (is not, does not contain). Filters combine with AND, with the Hostname filter (DASH-013) applied first.
// is and is not compare exactly, and on Page and Entry page they take the goal wildcards (CONV-001); contains and
// does not contain ignore ASCII case; matches is a JavaScript regular expression tested against each distinct value.
// Imported history has no visits and automatic events carry no visit, so a filtered report leaves both out.
// Custom events and their properties, and pageview properties, are dimensions too (CONV-002): a visit matches when any
// of its page loads, or a custom event on one, matches; alerts take a segment with ALERT-001 and the
// versioned Stats API with API-001.
export const FILTER_OPS={is:'is',is_not:'is not',contains:'contains',not_contains:'does not contain',matches:'matches (regex)'} as const
type Op=keyof typeof FILTER_OPS
type Scope='first'|'any'|'goal'|'event'|'prop'
export interface Dimension { label:string; scope:Scope; sql?:(row:string)=>string; key?:string }
const column=(name:string)=>(row:string)=>`${row}.${name}`
export const DIMENSIONS:Record<string,Dimension>={
 channel:{label:'Channel',scope:'first',sql:column('channel')},source:{label:'Source',scope:'first'},referrer:{label:'Referring page',scope:'first',sql:column('referrer')},
 utm_source:{label:'UTM source',scope:'first',sql:column('utm_source')},utm_medium:{label:'UTM medium',scope:'first',sql:column('utm_medium')},utm_campaign:{label:'UTM campaign',scope:'first',sql:row=>`NULLIF(${row}.campaign,'none')`},utm_term:{label:'UTM term',scope:'first',sql:column('utm_term')},utm_content:{label:'UTM content',scope:'first',sql:column('utm_content')},
 entry:{label:'Entry page',scope:'first',sql:column('path')},page:{label:'Page',scope:'any',sql:column('path')},hostname:{label:'Hostname',scope:'any',sql:column('hostname')},goal:{label:'Goal',scope:'goal',sql:column('kind')},search:{label:'Site search term',scope:'any',sql:column('search')},event:{label:'Custom event',scope:'event',sql:column('name')},
 device:{label:'Device',scope:'first',sql:column('device')},browser:{label:'Browser',scope:'first',sql:column('browser')},browser_version:{label:'Browser version',scope:'first',sql:row=>`trim(${row}.browser||' '||COALESCE(${row}.browser_version,''))`},os:{label:'Operating system',scope:'first',sql:column('os')},os_version:{label:'Operating system version',scope:'first',sql:row=>`trim(${row}.os||' '||COALESCE(${row}.os_version,''))`},screen:{label:'Screen size',scope:'first',sql:column('screen')},
 country:{label:'Country',scope:'first',sql:column('country')},region:{label:'Region',scope:'first',sql:column('region')},city:{label:'City',scope:'first',sql:column('city')},metro:{label:'US metro area code',scope:'first',sql:column('metro_code')},
}
// CONV-002: prop.<key> filters by a custom-event or pageview property, as in prop.plan:is:pro.
export const dimensionOf=(name:string):Dimension|undefined=>Object.hasOwn(DIMENSIONS,name)?DIMENSIONS[name]:/^prop\.[a-z0-9_-]{1,40}$/.test(name)?{label:`Property ${name.slice(5)}`,scope:'prop',sql:column('value'),key:name.slice(5)}:undefined
export interface Filter { dimension:string; op:Op; value:string }
export const MAX_FILTERS=10,MAX_MATCHED_VALUES=500
export const filterText=(f:Filter)=>`${dimensionOf(f.dimension)!.label} ${FILTER_OPS[f.op]} ${f.value}`
export const encodeFilter=(f:Filter)=>`${f.dimension}:${f.op}:${f.value}`
// A filter is written dimension:op:value, as in channel:is:Organic Search or page:is_not:/blog/*.
export function parseFilters(input:unknown):Filter[] {
 const list=(Array.isArray(input)?input:String(input??'').split('\n')).map(x=>String(x).trim()).filter(Boolean);
 insist(list.length<=MAX_FILTERS,'filter',`Use at most ${MAX_FILTERS} filters.`);
 const filters=list.map(text=>{
  const [dimension='',op='',...rest]=text.split(':'),value=rest.join(':').trim();
  insist(dimensionOf(dimension)!==undefined&&Object.hasOwn(FILTER_OPS,op)&&value.length>0&&value.length<=200&&!/[\u0000-\u001f\u007f]/.test(value),'filter','Filter by a listed dimension with is, is not, contains, does not contain or matches, and a value of up to 200 characters.');
  if(op==='matches'){let valid=true;try{new RegExp(value)}catch{valid=false}insist(valid,'filter','Write matches as a valid regular expression, such as ^/blog/.');}
  return {dimension,op:op as Op,value};
 });
 return [...new Map(filters.map(f=>[encodeFilter(f),f])).values()];
}
const literal=(value:string)=>`'${value.replace(/'/g,"''")}'`
// A wildcard is or is not on a page, and every matches, is decided in code over the distinct values in the window.
const resolved=(f:Filter)=>f.op==='matches'||(f.op==='is'||f.op==='is_not')&&(f.dimension==='page'||f.dimension==='entry')&&f.value.includes('*')
// The event set of the kept visits over local days [from, to), drawn from `base` (the hostname-filtered events).
// The kept visits are found once per report: the IDs of their page loads and goal events are written to vane_report_kept
// under a fresh report ID, every table reads those events by primary key, and release() deletes them when the report returns.
export async function keptVisits(env:Env,scope:string,filters:Filter[],from:string,to:string,base:string,sourceRules:SourceRule[]=[],entryPaths?:string[]):Promise<{events:string,release:()=>Promise<void>}> {
 const sites=(row:string)=>`${row}.site_id IN (SELECT value FROM json_each(${literal(scope)}))`,days=(row:string)=>`${row}.day>=${literal(from)} AND ${row}.day<${literal(to)}`
 const expr=(f:Filter,row:string)=>f.dimension==='source'?sourceNameSql(sourceRules,`${row}.source`):dimensionOf(f.dimension)!.sql!(row)
 const positive=async(f:Filter,row:string)=>{
  const e=`COALESCE(${expr(f,row)},'')`;
  if(f.op==='contains'||f.op==='not_contains')return `instr(lower(${e}),lower(${literal(f.value)}))>0`;
  if(!resolved(f))return `${e}=${literal(f.value)}`;
  const d=dimensionOf(f.dimension)!,values=(await rows<{v:string|null}>(env,d.scope==='event'?`SELECT DISTINCT x.name AS v FROM vane_custom_events x WHERE ${sites('x')} AND ${days('x')}`:d.scope==='prop'?`SELECT DISTINCT x.value AS v FROM vane_event_props x WHERE ${sites('x')} AND ${days('x')} AND x.key=${literal(d.key!)}`:`SELECT DISTINCT ${expr(f,'x')} AS v FROM ${base} x WHERE ${sites('x')} AND ${days('x')} AND x.kind${f.dimension==='goal'?'<>':'='}'pageview'`)).map(r=>r.v).filter((v):v is string=>v!==null);
  const pattern=f.op==='matches'?new RegExp(f.value):null,kept=values.filter(v=>pattern?pattern.test(v):goalMatches(f.value,v));
  insist(kept.length<=MAX_MATCHED_VALUES,'filter',`The filter matches more than ${MAX_MATCHED_VALUES} values; narrow it.`);
  return kept.length?`${e} IN (${kept.map(literal).join(',')})`:'0';
 };
 const negative=(f:Filter)=>f.op==='is_not'||f.op==='not_contains'
 const flags=await Promise.all(filters.map(async f=>{const d=dimensionOf(f.dimension)!;
  if(d.scope==='goal')return `EXISTS(SELECT 1 FROM ${base} g WHERE g.id>l.id||':' AND g.id<l.id||';' AND ${await positive(f,'g')})`;
  if(d.scope==='event')return `EXISTS(SELECT 1 FROM vane_custom_events ce WHERE ce.page_id=l.id AND ${await positive(f,'ce')})`;
  if(d.scope==='prop')return `EXISTS(SELECT 1 FROM vane_event_props pr WHERE (pr.event_id=l.id OR pr.event_id IN (SELECT ce.id FROM vane_custom_events ce WHERE ce.page_id=l.id)) AND pr.key=${literal(d.key!)} AND ${await positive(f,'pr')})`;
  return positive(f,'l')}))
 if(entryPaths!==undefined)flags.push(`l.channel='Organic Search' AND l.path IN (SELECT value FROM json_each(${literal(JSON.stringify(entryPaths))}))`);
 const having=[...filters.map((f,i)=>dimensionOf(f.dimension)!.scope==='first'?`MAX(CASE WHEN first=1 AND ${negative(f)?'NOT ':''}f${i} THEN 1 ELSE 0 END)=1`:`MAX(f${i})=${negative(f)?0:1}`),...(entryPaths!==undefined?[`MAX(CASE WHEN first=1 AND f${filters.length} THEN 1 ELSE 0 END)=1`]:[])].join(' AND ')
 const report=uid();
 await env.DB.prepare(`INSERT INTO vane_report_kept(report,id,at) SELECT ?,e.id,? FROM ${base} e WHERE ${sites('e')} AND ${days('e')} AND substr(e.id,1,length(e.site_id)+37) IN (WITH s AS (SELECT l.id,l.day,l.visitor,l.at,${flags.map((sql,i)=>`(${sql}) AS f${i}`).join(',')},LAG(l.at) OVER w AS prev_at,${gapSql('l')} AS gap FROM ${base} l WHERE ${sites('l')} AND ${days('l')} AND l.kind='pageview' AND l.visitor IS NOT NULL AND l.at IS NOT NULL WINDOW w AS (PARTITION BY l.day,l.visitor ORDER BY l.at,l.id)),
t AS (SELECT *,CASE WHEN prev_at IS NULL OR at-prev_at>gap THEN 1 ELSE 0 END AS first FROM s),
u AS (SELECT *,SUM(first) OVER (PARTITION BY day,visitor ORDER BY at,id ROWS UNBOUNDED PRECEDING) AS visit FROM t),
k AS (SELECT day,visitor,visit FROM u GROUP BY day,visitor,visit HAVING ${having})
SELECT u.id FROM u JOIN k USING(day,visitor,visit))`).bind(report,clock()).run();
 return {events:`(SELECT e.* FROM vane_report_kept r CROSS JOIN vane_events e ON e.id=r.id WHERE r.report=${literal(report)})`,release:async()=>{await env.DB.prepare('DELETE FROM vane_report_kept WHERE report=?').bind(report).run()}};
}
// A report cut short before release (a Worker stopped mid-request) leaves its rows; the 5-minute cron deletes them after an hour.
export const expireKept=(env:Env,now:number)=>env.DB.prepare('DELETE FROM vane_report_kept WHERE at<?').bind(now-3600000).run()
// The earliest local day a filtered report reads: its range or compared period, less the 8 weeks REPORT-003's baseline needs.
export const segmentStart=(from:string,previousFrom:string)=>day(Date.parse(from<previousFrom?from:previousFrom)-56*86400000)

// Saved segments are a site's named filter sets, shared with its team: every member reads and applies them; the owner
// and administrators save, replace and delete them (TEAM-001's Analyst inherits that), each change in the audit log.
export interface Segment { id:string; name:string; filters:Filter[]; createdBy:string; createdAt:number }
export async function segments(env:Env,siteId:string):Promise<Segment[]> {
 return (await rows<any>(env,'SELECT * FROM vane_segments WHERE site_id=? ORDER BY name',siteId)).map(r=>({id:r.id,name:r.name,filters:parseFilters(JSON.parse(r.filters_json).map(encodeFilter)),createdBy:r.created_by,createdAt:r.created_at}))
}
export async function segment(env:Env,siteId:string,id:string):Promise<Segment> {
 const found=(await segments(env,siteId)).find(s=>s.id===id);insist(found,'segment','This saved segment no longer exists.',404);return found
}
export async function saveSegment(env:Env,actor:Actor,input:any) {
 allow(actor,'analyst');
 const value=await site(env,String(input.siteId)),name=String(input.name??'').trim(),filters=parseFilters(input.filters);
 insist(name.length>0&&name.length<=60&&!/[\u0000-\u001f\u007f<>]/.test(name),'segment_name','Name the segment in up to 60 characters of plain text.');
 insist(filters.length>0,'filter','Add at least one filter before saving a segment.');
 insist(Number((await rows(env,'SELECT COUNT(*) AS n FROM vane_segments WHERE site_id=? AND name<>?',value.id,name))[0].n)<50,'segment','A site keeps at most 50 saved segments.');
 const existing=(await rows<{id:string}>(env,'SELECT id FROM vane_segments WHERE site_id=? AND name=?',value.id,name))[0],id=existing?.id??uid();
 await env.DB.batch([statement(env,'INSERT INTO vane_segments(id,site_id,name,filters_json,created_by,created_at) VALUES(?,?,?,?,?,?) ON CONFLICT(site_id,name) DO UPDATE SET filters_json=excluded.filters_json,created_by=excluded.created_by,created_at=excluded.created_at',id,value.id,name,JSON.stringify(filters),actor.id,clock()),auditStatement(env,actor.id,existing?'segment.replace':'segment.save',value.id,`segment ${name}: ${filters.map(filterText).join('; ')}`)]);
 return {siteId:value.id,id};
}
export async function deleteSegment(env:Env,actor:Actor,id:string) {
 allow(actor,'analyst');
 const found=(await rows<{site_id:string,name:string}>(env,'SELECT site_id,name FROM vane_segments WHERE id=?',id))[0];insist(found,'segment','This saved segment no longer exists.',404);inScope(actor,found.site_id);
 await env.DB.batch([statement(env,'DELETE FROM vane_segments WHERE id=?',id),auditStatement(env,actor.id,'segment.delete',found.site_id,`segment ${found.name}`)]);
 return found.site_id;
}

import { insist } from './core'
// DASH-013: the Hostname filter (is, is not, contains, or matches with * wildcards such as *.example.com)
// narrows every report and the Stats API answer. Hostnames are stored lowercased without a port, so values are
// compared lowercased. Rows without a hostname (imported history and page loads collected before hostnames
// were stored) never match a hostname filter, and the field-free privacy-signal count stays site-wide.
export interface HostFilter { op:'is'|'is_not'|'contains'|'matches'; value:string }
export function hostFilter(op:string|null|undefined,value:string|null|undefined):HostFilter|null {
 const v=String(value??'').trim().toLowerCase(),o=op||'is';
 if(!v)return null;
 insist(['is','is_not','contains','matches'].includes(o)&&/^[a-z0-9*.-]{1,253}$/.test(v)&&(o==='matches'||!v.includes('*')),'hostname','Filter by a hostname such as blog.example.com; use matches for a wildcard such as *.example.com.');
 return {op:o as HostFilter['op'],value:v};
}
// The value matched the pattern above, which admits no quote, so it is inlined as a literal.
export function hostCondition(filter:HostFilter|null,column='hostname'):string {
 if(!filter)return '1';
 const v=`'${filter.value}'`;
 return {is:`${column}=${v}`,is_not:`${column}<>${v}`,contains:`instr(${column},${v})>0`,matches:`${column} GLOB ${v}`}[filter.op];
}
export const filtered=(table:string,filter:HostFilter|null)=>filter?`(SELECT * FROM ${table} WHERE ${hostCondition(filter)})`:table

import type { Env } from '../../core'
import { unpackedIdSql } from '../../raw/schema'
import { refreshVisitFacts } from './maintenance'
import { dimension } from './sql'

export interface JourneyRow {
 n1:string|null; n2:string|null; n3:string|null
 p1:string|null; p2:string|null; p3:string|null
 n:number
}

// Fetch one candidate per metadata group before ordering across groups. A
// canonical chain seeks the indexed four-byte token prefix, then resolves every
// prefix tie using the full token. Legacy chains use decoded logical-ID order.
function candidate(point:string,after:boolean,canonical:boolean,timestamp:string,relative=false,path=false) {
 const direction=after?'ASC':'DESC',comparison=after?'>':'<'
 const key=(alias:string)=>canonical?`${alias}.token`:unpackedIdSql(`${alias}.token`,`${point}.site_id`)
 const order=(alias:string)=>canonical?`substr(${alias}.token,1,4) ${direction},${alias}.token ${direction}`:`${key(alias)} ${direction}`
 return `(SELECT e.raw_id FROM vane_raw_groups g
  ${path?'CROSS JOIN vane_raw_contexts c ON c.context=g.context':''}
  CROSS JOIN vane_raw_occurrences e ON e.raw_id=(
   SELECT occurrence.raw_id FROM vane_raw_occurrences occurrence WHERE occurrence.group_id=g.group_id
   ${relative?`${canonical?`AND substr(occurrence.token,1,4)${comparison}=substr(${point}.token,1,4)`:''} AND ${key('occurrence')}${comparison}${point}.${canonical?'token':'id'}`:''}
   ORDER BY ${order('occurrence')} LIMIT 1)
  WHERE g.visit_id=${point}.visit AND g.at_offset=${timestamp} ${path?`AND ${dimension('path')}=?4`:''}
  ORDER BY ${key('e')} ${direction} LIMIT 1)`
}

function orderedNeighbor(point:string,after:boolean,canonical:boolean) {
 const comparison=after?'>':'<',extreme=after?'MIN':'MAX'
 const timestamp=`(SELECT ${extreme}(bucket.at_offset) FROM vane_raw_groups bucket
  WHERE bucket.visit_id=${point}.visit AND bucket.at_offset${comparison}${point}.at_offset
  AND EXISTS(SELECT 1 FROM vane_raw_occurrences occurrence WHERE occurrence.group_id=bucket.group_id))`
 return `COALESCE(${candidate(point,after,canonical,`${point}.at_offset`,true)},${candidate(point,after,canonical,timestamp)})`
}

function neighbor(point:string,after:boolean) {
 return `CASE WHEN ${point}.raw_id IS NOT NULL THEN
  CASE WHEN ${point}.legacy=0 THEN ${orderedNeighbor(point,after,true)}
   ELSE ${orderedNeighbor(point,after,false)} END END`
}

function point(name:string) {
 return `${name} AS MATERIALIZED (
  SELECT a.visit,a.site_id,a.legacy,e.raw_id,e.token,g.at_offset,${unpackedIdSql('e.token','a.site_id')} AS id,${dimension('path')} AS path
  FROM ${name}_ids a LEFT JOIN vane_raw_occurrences e ON e.raw_id=a.raw_id
  LEFT JOIN vane_raw_groups g ON g.group_id=e.group_id LEFT JOIN vane_raw_contexts c ON c.context=g.context)`
}

// Native whole-day membership already carries the exact visit partition.
// Only its first matching page and six neighbors are needed, rather than
// reconstructing and numbering every page in the reporting period again.
export async function readJourneyRows(env:Env,scope:string,from:string,to:string,path:string,entry:boolean):Promise<JourneyRow[]> {
 await refreshVisitFacts(env,scope,from,to)
 const range="s.site_id IN (SELECT value FROM json_each(?1)) AND f.day>=?2 AND f.day<?3"
 // Every timed text-ID page marks this whole site/day/visitor chain legacy,
 // including bulk admission, restore and rewrites. Refresh above repairs its
 // membership; the flag then selects decoded ordering for all of its visits.
 const legacy='EXISTS(SELECT 1 FROM vane_visit_legacy l WHERE l.site=f.site AND l.day=f.day AND l.visitor=f.visitor)'
 const anchors=entry?`anchor_ids AS MATERIALIZED (
  SELECT f.visit,s.site_id,${legacy} AS legacy,e.raw_id FROM vane_raw_sites s
  CROSS JOIN vane_visit_facts f ON f.site=s.site
  CROSS JOIN vane_raw_occurrences e ON e.raw_id=f.first_raw
  CROSS JOIN vane_raw_groups g ON g.group_id=e.group_id
  CROSS JOIN vane_raw_contexts c ON c.context=g.context
  WHERE ${range} AND ${dimension('path')}=?4
 )`:`buckets AS MATERIALIZED (
  SELECT f.visit,s.site_id,${legacy} AS legacy,MIN(g.at_offset) AS at_offset FROM vane_raw_sites s
  CROSS JOIN vane_visit_facts f ON f.site=s.site
  CROSS JOIN vane_raw_groups g ON g.visit_id=f.visit
  CROSS JOIN vane_raw_contexts c ON c.context=g.context
  WHERE ${range} AND ${dimension('path')}=?4 AND g.at_offset IS NOT NULL
  AND EXISTS(SELECT 1 FROM vane_raw_occurrences e WHERE e.group_id=g.group_id)
  GROUP BY f.visit,s.site_id
 ), anchor_ids AS MATERIALIZED (
  SELECT b.visit,b.site_id,b.legacy,CASE WHEN b.legacy=0 THEN ${candidate('b',true,true,'b.at_offset',false,true)}
   ELSE ${candidate('b',true,false,'b.at_offset',false,true)} END AS raw_id FROM buckets b
 )`
 const neighbors=(['n','p'] as const).flatMap(prefix=>Array.from({length:3},(_,i)=>{
  const name=prefix+(i+1),previous=i?prefix+i:'anchor'
  return `${name}_ids AS MATERIALIZED (
   SELECT a.visit,a.site_id,a.legacy,${neighbor('a',prefix==='n')} AS raw_id FROM ${previous} a
  ), ${point(name)}`
 }))
 const names=['n1','n2','n3','p1','p2','p3']
 const result=await env.DB.prepare(`WITH ${anchors},${point('anchor')},${neighbors.join(',')}
  SELECT ${names.map(name=>`${name}.path AS ${name}`).join(',')},COUNT(*) AS n FROM anchor a
  ${names.map(name=>`LEFT JOIN ${name} ON ${name}.visit=a.visit`).join(' ')}
  GROUP BY ${names.map(name=>`${name}.path`).join(',')}`).bind(scope,from,to,path).all<JourneyRow>()
 return result.results
}

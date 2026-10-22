import { RAW_COLUMNS, packedIdSql, rawColumnSql } from './schema'

// Keep the page alias available to revenue expressions, but enter the physical
// occurrence table through its (site,token) key after the small referring table.
// This subquery is flattenable; CROSS JOIN fixes that lookup order. Scope and
// dates belong to the referenced page, rather than its custom event or property.
export function nativePageJoinSql(pageId:string) {
 const columns=RAW_COLUMNS.map(name=>`${name==='at'?'g.at_offset+coalesce(unixepoch(c.day)*1000,0)':rawColumnSql(name)} AS ${name}`).join(',')
 return `CROSS JOIN (SELECT ${columns},e.token AS _token FROM vane_raw_sites s
 CROSS JOIN vane_raw_occurrences e ON e.site=s.site
 CROSS JOIN vane_raw_groups g ON g.group_id=e.group_id
 CROSS JOIN vane_raw_contexts c ON c.context=g.context
 LEFT JOIN vane_raw_identities vi ON vi.identity=c.visitor
 LEFT JOIN vane_raw_identities ci ON ci.identity=c.consented_visitor
 LEFT JOIN vane_raw_details d ON d.raw_id=e.raw_id) p
 ON p._token=${packedIdSql(pageId,'p.site_id')} AND p.kind='pageview'
 AND p.site_id IN (SELECT value FROM json_each(?1)) AND p.day>=?2 AND p.day<?3`
}

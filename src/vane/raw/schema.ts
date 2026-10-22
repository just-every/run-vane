// Lossless storage representation. None of these dimensions changes identity scope.
export const RAW_DIMENSIONS = [
 'path','source','campaign','hostname','device','browser','browser_version','os','os_version','screen',
 'channel','referrer','utm_source','utm_medium','utm_term','utm_content','country','region','city','metro_code',
 'search','transport','consent','sample_rate','import_job','paid_click','query',
] as const
export const RAW_COLUMNS = [
 'id','site_id','day','kind','path','source','campaign','consent','sample_rate','import_job','visitor','at',
 'engaged_at','scroll','device','browser','browser_version','os','os_version','screen','search','hostname',
 'utm_source','utm_medium','utm_term','utm_content','paid_click','query','channel','referrer','lcp','inp','cls',
 'load_ms','country','region','city','metro_code','consented_visitor','consented_created_at','consented_expires_at','transport',
] as const
export const DETAIL_COLUMNS = ['engaged_at','scroll','lcp','inp','cls','load_ms'] as const
export const RAW_TABLES = ['vane_raw_sites','vane_raw_identities','vane_raw_contexts','vane_raw_events','vane_raw_details'] as const
export const dimensionsSql = (prefix='') => `json_array(${RAW_DIMENSIONS.map(name=>prefix+name).join(',')})`
export const packedHashSql = (value:string) => `CASE WHEN length(${value})=64 AND ${value} NOT GLOB '*[^0-9a-f]*' THEN unhex(${value}) ELSE ${value} END`
export const unpackedHashSql = (value:string) => `CASE WHEN typeof(${value})='blob' THEN lower(hex(${value})) ELSE ${value} END`
export function packedIdSql(id:string, site:string) {
 const uuid=`substr(${id},length(${site})+2,36)`,hex=`replace(${uuid},'-','')`
 const canonical=`substr(${id},1,length(${site})+1)=${site}||':' AND length(${uuid})=36 AND length(${hex})=32 AND ${hex} NOT GLOB '*[^0-9a-f]*' AND substr(${uuid},9,1)='-' AND substr(${uuid},14,1)='-' AND substr(${uuid},19,1)='-' AND substr(${uuid},24,1)='-'`
 return `CASE WHEN ${canonical} THEN unhex(${hex}||hex(substr(${id},length(${site})+38))) ELSE ${id} END`
}
export function unpackedIdSql(token='e.token',site='s.site_id') {
 const h=`lower(hex(substr(${token},1,16)))`
 return `CASE WHEN typeof(${token})='blob' THEN ${site}||':'||substr(${h},1,8)||'-'||substr(${h},9,4)||'-'||substr(${h},13,4)||'-'||substr(${h},17,4)||'-'||substr(${h},21,12)||CAST(substr(${token},17) AS TEXT) ELSE ${token} END`
}
export const rawJoinSql = `vane_raw_events e JOIN vane_raw_contexts c ON c.context=e.context JOIN vane_raw_sites s ON s.site=e.site LEFT JOIN vane_raw_identities vi ON vi.identity=c.visitor LEFT JOIN vane_raw_identities ci ON ci.identity=c.consented_visitor LEFT JOIN vane_raw_details d ON d.raw_id=e.raw_id`
export const rawColumnSql = (name:typeof RAW_COLUMNS[number]):string => {
 const dimension=RAW_DIMENSIONS.indexOf(name as typeof RAW_DIMENSIONS[number])
 if(dimension>=0)return `json_extract(c.dimensions,'$[${dimension}]')`
 if((DETAIL_COLUMNS as readonly string[]).includes(name))return `d.${name}`
 if(name==='id')return unpackedIdSql()
 if(name==='site_id')return 's.site_id'
 if(name==='visitor')return unpackedHashSql('vi.value')
 if(name==='consented_visitor')return unpackedHashSql('ci.value')
 if(name==='at')return 'e.at_offset+coalesce(unixepoch(c.day)*1000,0)'
 return 'c.'+name
}
export const rawSelectSql = `SELECT ${RAW_COLUMNS.map(name=>`${rawColumnSql(name)} AS ${name}`).join(',')},e.raw_id AS _raw_id FROM ${rawJoinSql}`
export const contextColumns = 'site,day,kind,dimensions,visitor,consented_visitor,consented_created_at,consented_expires_at'
export function contextValuesSql(prefix:string) {
 return [`(SELECT site FROM vane_raw_sites WHERE site_id=${prefix}site_id)`,prefix+'day',prefix+'kind',dimensionsSql(prefix),
  `(SELECT identity FROM vane_raw_identities WHERE value=${packedHashSql(prefix+'visitor')})`,
  `(SELECT identity FROM vane_raw_identities WHERE value=${packedHashSql(prefix+'consented_visitor')})`,
  prefix+'consented_created_at',prefix+'consented_expires_at']
}
export function contextMatchSql(values:string[]) {
 return contextColumns.split(',').map((name,i)=>`${name} IS ${values[i]}`).join(' AND ')
}

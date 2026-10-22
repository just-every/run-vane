// Raw occurrence maintenance runs on the actual table, so INSERT OR IGNORE and
// failed batches cannot increment analytical counts for an uninserted view row.
import { unpackedHashSql } from './schema.ts'
const source=(prefix:string)=>`SELECT s.site_id,c.day,c.kind,json_remove(c.dimensions,'$[26]','$[25]') AS cell,
 CASE WHEN c.consented_visitor IS NOT NULL THEN s.site_id||' c '||${unpackedHashSql('ci.value')} ELSE s.site_id||' d '||c.day||' '||${unpackedHashSql('vi.value')} END AS identity,
 c.visitor,${prefix}.at_offset IS NOT NULL AS timed,c.consented_visitor IS NOT NULL AS consented
 FROM vane_raw_contexts c JOIN vane_raw_sites s ON s.site=c.site
 LEFT JOIN vane_raw_identities vi ON vi.identity=c.visitor LEFT JOIN vane_raw_identities ci ON ci.identity=c.consented_visitor
 WHERE c.context=${prefix}.context`
const add=(prefix:string)=>`INSERT INTO vane_analytics_cells(site_id,day,kind,cell,n,timed,consented)
 SELECT site_id,day,kind,cell,1,timed,consented FROM (${source(prefix)}) WHERE 1
 ON CONFLICT(site_id,day,kind,cell) DO UPDATE SET n=n+1,timed=timed+excluded.timed,consented=consented+excluded.consented;
 INSERT INTO vane_analytics_identities(site_id,day,kind,cell,identity,n)
 SELECT site_id,day,kind,cell,identity,1 FROM (${source(prefix)}) WHERE visitor IS NOT NULL
 ON CONFLICT(site_id,day,kind,cell,identity) DO UPDATE SET n=n+1;`
const remove=(prefix:string)=>{
 const match=`(site_id,day,kind,cell)=(SELECT site_id,day,kind,cell FROM (${source(prefix)}))`
 return `UPDATE vane_analytics_identities SET n=n-1 WHERE ${match} AND identity=(SELECT identity FROM (${source(prefix)})) AND (SELECT visitor FROM (${source(prefix)})) IS NOT NULL;
 DELETE FROM vane_analytics_identities WHERE ${match} AND n=0;
 UPDATE vane_analytics_cells SET n=n-1,timed=timed-(${prefix}.at_offset IS NOT NULL),consented=consented-(SELECT consented FROM (${source(prefix)})) WHERE ${match};
 DELETE FROM vane_analytics_cells WHERE ${match} AND n=0;`
}
const gc=(prefix:string)=>`DELETE FROM vane_raw_contexts WHERE context=${prefix}.context AND NOT EXISTS(SELECT 1 FROM vane_raw_events WHERE context=${prefix}.context);`
export const analyticalTriggers=`CREATE TRIGGER vane_raw_analytics_insert AFTER INSERT ON vane_raw_events BEGIN
 ${add('NEW')}
END;
CREATE TRIGGER vane_raw_analytics_delete AFTER DELETE ON vane_raw_events BEGIN
 ${remove('OLD')}
 ${gc('OLD')}
END;
CREATE TRIGGER vane_raw_analytics_update AFTER UPDATE OF context,at_offset ON vane_raw_events
WHEN NEW.context IS NOT OLD.context OR NEW.at_offset IS NOT OLD.at_offset BEGIN
 ${remove('OLD')}
 ${add('NEW')}
 ${gc('OLD')}
END;`

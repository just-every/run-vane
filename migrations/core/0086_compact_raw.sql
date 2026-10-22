-- Lossless native rows. Every accepted occurrence remains an individual row.
-- The original logical schema is exposed by vane_events; _raw_id is an internal
-- indexed key, never an exported identifier. No truncation or synthetic weights.
DROP TRIGGER vane_analytics_insert;
DROP TRIGGER vane_analytics_update;
DROP TRIGGER vane_analytics_delete;
ALTER TABLE vane_events RENAME TO vane_raw_previous;
CREATE TABLE vane_raw_sites(site INTEGER PRIMARY KEY,site_id TEXT NOT NULL UNIQUE REFERENCES vane_sites(id));
CREATE TABLE vane_raw_identities(identity INTEGER PRIMARY KEY,value BLOB NOT NULL UNIQUE);
CREATE TABLE vane_raw_contexts(
 context INTEGER PRIMARY KEY,site INTEGER NOT NULL REFERENCES vane_raw_sites(site),day TEXT NOT NULL,kind TEXT NOT NULL,
 dimensions TEXT NOT NULL CHECK(json_valid(dimensions) AND json_array_length(dimensions)=27
  AND json_extract(dimensions,'$[0]') IS NOT NULL AND json_extract(dimensions,'$[1]') IS NOT NULL
  AND json_extract(dimensions,'$[2]') IS NOT NULL AND json_extract(dimensions,'$[22]') IS NOT NULL
  AND (json_extract(dimensions,'$[21]') IS NULL OR json_extract(dimensions,'$[21]') IN ('direct','proxy'))),
 visitor INTEGER REFERENCES vane_raw_identities(identity),consented_visitor INTEGER REFERENCES vane_raw_identities(identity),
 consented_created_at INTEGER,consented_expires_at INTEGER
);
CREATE UNIQUE INDEX vane_raw_context_unique ON vane_raw_contexts(site,day,kind,dimensions,coalesce(visitor,-1),coalesce(consented_visitor,-1),(consented_created_at IS NULL),coalesce(consented_created_at,0),(consented_expires_at IS NULL),coalesce(consented_expires_at,0));
CREATE INDEX vane_raw_context_range ON vane_raw_contexts(site,day,visitor);
CREATE INDEX vane_raw_context_consented ON vane_raw_contexts(consented_visitor) WHERE consented_visitor IS NOT NULL;
CREATE INDEX vane_raw_context_visitor ON vane_raw_contexts(visitor) WHERE visitor IS NOT NULL;
CREATE TABLE vane_raw_events(
 raw_id INTEGER PRIMARY KEY,site INTEGER NOT NULL REFERENCES vane_raw_sites(site),token BLOB NOT NULL,
 context INTEGER NOT NULL REFERENCES vane_raw_contexts(context),at_offset INTEGER,visit_id INTEGER,
 UNIQUE(site,token)
);
CREATE INDEX vane_raw_events_context_time ON vane_raw_events(context,at_offset,token);
CREATE INDEX vane_raw_events_visit ON vane_raw_events(visit_id) WHERE visit_id IS NOT NULL;
CREATE UNIQUE INDEX vane_raw_events_opaque ON vane_raw_events(token) WHERE typeof(token)='text';
CREATE TABLE vane_raw_details(
 raw_id INTEGER PRIMARY KEY REFERENCES vane_raw_events(raw_id) ON DELETE CASCADE,
 engaged_at INTEGER,scroll INTEGER,lcp INTEGER,inp INTEGER,cls REAL,load_ms INTEGER
);
CREATE VIEW vane_events AS SELECT  CASE  WHEN typeof(e.token)='blob' THEN s.site_id||':'||substr(lower(hex(substr(e.token,1,16))),1,8)||'-'||substr(lower(hex(substr(e.token,1,16))),9,4)||'-'||substr(lower(hex(substr(e.token,1,16))),13,4)||'-'||substr(lower(hex(substr(e.token,1,16))),17,4)||'-'||substr(lower(hex(substr(e.token,1,16))),21,12)||CAST(substr(e.token,17) AS TEXT) ELSE e.token  END  AS id,s.site_id AS site_id,c.day AS day,c.kind AS kind,json_extract(c.dimensions,'$[0]') AS path,json_extract(c.dimensions,'$[1]') AS source,json_extract(c.dimensions,'$[2]') AS campaign,json_extract(c.dimensions,'$[22]') AS consent,json_extract(c.dimensions,'$[23]') AS sample_rate,json_extract(c.dimensions,'$[24]') AS import_job, CASE  WHEN typeof(vi.value)='blob' THEN lower(hex(vi.value)) ELSE vi.value  END  AS visitor,e.at_offset+coalesce(unixepoch(c.day)*1000,0) AS at,d.engaged_at AS engaged_at,d.scroll AS scroll,json_extract(c.dimensions,'$[4]') AS device,json_extract(c.dimensions,'$[5]') AS browser,json_extract(c.dimensions,'$[6]') AS browser_version,json_extract(c.dimensions,'$[7]') AS os,json_extract(c.dimensions,'$[8]') AS os_version,json_extract(c.dimensions,'$[9]') AS screen,json_extract(c.dimensions,'$[20]') AS search,json_extract(c.dimensions,'$[3]') AS hostname,json_extract(c.dimensions,'$[12]') AS utm_source,json_extract(c.dimensions,'$[13]') AS utm_medium,json_extract(c.dimensions,'$[14]') AS utm_term,json_extract(c.dimensions,'$[15]') AS utm_content,json_extract(c.dimensions,'$[25]') AS paid_click,json_extract(c.dimensions,'$[26]') AS query,json_extract(c.dimensions,'$[10]') AS channel,json_extract(c.dimensions,'$[11]') AS referrer,d.lcp AS lcp,d.inp AS inp,d.cls AS cls,d.load_ms AS load_ms,json_extract(c.dimensions,'$[16]') AS country,json_extract(c.dimensions,'$[17]') AS region,json_extract(c.dimensions,'$[18]') AS city,json_extract(c.dimensions,'$[19]') AS metro_code, CASE  WHEN typeof(ci.value)='blob' THEN lower(hex(ci.value)) ELSE ci.value  END  AS consented_visitor,c.consented_created_at AS consented_created_at,c.consented_expires_at AS consented_expires_at,json_extract(c.dimensions,'$[21]') AS transport,e.raw_id AS _raw_id FROM vane_raw_events e JOIN vane_raw_contexts c ON c.context=e.context JOIN vane_raw_sites s ON s.site=e.site LEFT JOIN vane_raw_identities vi ON vi.identity=c.visitor LEFT JOIN vane_raw_identities ci ON ci.identity=c.consented_visitor LEFT JOIN vane_raw_details d ON d.raw_id=e.raw_id;
CREATE TRIGGER vane_raw_insert INSTEAD OF INSERT ON vane_events BEGIN
 INSERT OR IGNORE INTO vane_raw_sites(site_id) SELECT NEW.site_id WHERE NOT EXISTS(SELECT 1 FROM vane_raw_events WHERE site=(SELECT site FROM vane_raw_sites WHERE site_id=NEW.site_id) AND token= CASE  WHEN substr(NEW.id,1,length(NEW.site_id)+1)=NEW.site_id||':' AND length(substr(NEW.id,length(NEW.site_id)+2,36))=36 AND length(replace(substr(NEW.id,length(NEW.site_id)+2,36),'-',''))=32 AND replace(substr(NEW.id,length(NEW.site_id)+2,36),'-','') NOT GLOB '*[^0-9a-f]*' AND substr(substr(NEW.id,length(NEW.site_id)+2,36),9,1)='-' AND substr(substr(NEW.id,length(NEW.site_id)+2,36),14,1)='-' AND substr(substr(NEW.id,length(NEW.site_id)+2,36),19,1)='-' AND substr(substr(NEW.id,length(NEW.site_id)+2,36),24,1)='-' THEN unhex(replace(substr(NEW.id,length(NEW.site_id)+2,36),'-','')||hex(substr(NEW.id,length(NEW.site_id)+38))) ELSE NEW.id  END );
 INSERT OR IGNORE INTO vane_raw_identities(value) SELECT  CASE  WHEN length(NEW.visitor)=64 AND NEW.visitor NOT GLOB '*[^0-9a-f]*' THEN unhex(NEW.visitor) ELSE NEW.visitor  END  WHERE NEW.visitor IS NOT NULL AND NOT EXISTS(SELECT 1 FROM vane_raw_events WHERE site=(SELECT site FROM vane_raw_sites WHERE site_id=NEW.site_id) AND token= CASE  WHEN substr(NEW.id,1,length(NEW.site_id)+1)=NEW.site_id||':' AND length(substr(NEW.id,length(NEW.site_id)+2,36))=36 AND length(replace(substr(NEW.id,length(NEW.site_id)+2,36),'-',''))=32 AND replace(substr(NEW.id,length(NEW.site_id)+2,36),'-','') NOT GLOB '*[^0-9a-f]*' AND substr(substr(NEW.id,length(NEW.site_id)+2,36),9,1)='-' AND substr(substr(NEW.id,length(NEW.site_id)+2,36),14,1)='-' AND substr(substr(NEW.id,length(NEW.site_id)+2,36),19,1)='-' AND substr(substr(NEW.id,length(NEW.site_id)+2,36),24,1)='-' THEN unhex(replace(substr(NEW.id,length(NEW.site_id)+2,36),'-','')||hex(substr(NEW.id,length(NEW.site_id)+38))) ELSE NEW.id  END );
 INSERT OR IGNORE INTO vane_raw_identities(value) SELECT  CASE  WHEN length(NEW.consented_visitor)=64 AND NEW.consented_visitor NOT GLOB '*[^0-9a-f]*' THEN unhex(NEW.consented_visitor) ELSE NEW.consented_visitor  END  WHERE NEW.consented_visitor IS NOT NULL AND NOT EXISTS(SELECT 1 FROM vane_raw_events WHERE site=(SELECT site FROM vane_raw_sites WHERE site_id=NEW.site_id) AND token= CASE  WHEN substr(NEW.id,1,length(NEW.site_id)+1)=NEW.site_id||':' AND length(substr(NEW.id,length(NEW.site_id)+2,36))=36 AND length(replace(substr(NEW.id,length(NEW.site_id)+2,36),'-',''))=32 AND replace(substr(NEW.id,length(NEW.site_id)+2,36),'-','') NOT GLOB '*[^0-9a-f]*' AND substr(substr(NEW.id,length(NEW.site_id)+2,36),9,1)='-' AND substr(substr(NEW.id,length(NEW.site_id)+2,36),14,1)='-' AND substr(substr(NEW.id,length(NEW.site_id)+2,36),19,1)='-' AND substr(substr(NEW.id,length(NEW.site_id)+2,36),24,1)='-' THEN unhex(replace(substr(NEW.id,length(NEW.site_id)+2,36),'-','')||hex(substr(NEW.id,length(NEW.site_id)+38))) ELSE NEW.id  END );
 INSERT OR IGNORE INTO vane_raw_contexts(site,day,kind,dimensions,visitor,consented_visitor,consented_created_at,consented_expires_at) SELECT (SELECT site FROM vane_raw_sites WHERE site_id=NEW.site_id),NEW.day,NEW.kind,json_array(NEW.path,NEW.source,NEW.campaign,NEW.hostname,NEW.device,NEW.browser,NEW.browser_version,NEW.os,NEW.os_version,NEW.screen,NEW.channel,NEW.referrer,NEW.utm_source,NEW.utm_medium,NEW.utm_term,NEW.utm_content,NEW.country,NEW.region,NEW.city,NEW.metro_code,NEW.search,NEW.transport,NEW.consent,NEW.sample_rate,NEW.import_job,NEW.paid_click,NEW.query),(SELECT identity FROM vane_raw_identities WHERE value= CASE  WHEN length(NEW.visitor)=64 AND NEW.visitor NOT GLOB '*[^0-9a-f]*' THEN unhex(NEW.visitor) ELSE NEW.visitor  END ),(SELECT identity FROM vane_raw_identities WHERE value= CASE  WHEN length(NEW.consented_visitor)=64 AND NEW.consented_visitor NOT GLOB '*[^0-9a-f]*' THEN unhex(NEW.consented_visitor) ELSE NEW.consented_visitor  END ),NEW.consented_created_at,NEW.consented_expires_at WHERE NOT EXISTS(SELECT 1 FROM vane_raw_events WHERE site=(SELECT site FROM vane_raw_sites WHERE site_id=NEW.site_id) AND token= CASE  WHEN substr(NEW.id,1,length(NEW.site_id)+1)=NEW.site_id||':' AND length(substr(NEW.id,length(NEW.site_id)+2,36))=36 AND length(replace(substr(NEW.id,length(NEW.site_id)+2,36),'-',''))=32 AND replace(substr(NEW.id,length(NEW.site_id)+2,36),'-','') NOT GLOB '*[^0-9a-f]*' AND substr(substr(NEW.id,length(NEW.site_id)+2,36),9,1)='-' AND substr(substr(NEW.id,length(NEW.site_id)+2,36),14,1)='-' AND substr(substr(NEW.id,length(NEW.site_id)+2,36),19,1)='-' AND substr(substr(NEW.id,length(NEW.site_id)+2,36),24,1)='-' THEN unhex(replace(substr(NEW.id,length(NEW.site_id)+2,36),'-','')||hex(substr(NEW.id,length(NEW.site_id)+38))) ELSE NEW.id  END );
 INSERT INTO vane_raw_events(site,token,context,at_offset)
 VALUES((SELECT site FROM vane_raw_sites WHERE site_id=NEW.site_id), CASE  WHEN substr(NEW.id,1,length(NEW.site_id)+1)=NEW.site_id||':' AND length(substr(NEW.id,length(NEW.site_id)+2,36))=36 AND length(replace(substr(NEW.id,length(NEW.site_id)+2,36),'-',''))=32 AND replace(substr(NEW.id,length(NEW.site_id)+2,36),'-','') NOT GLOB '*[^0-9a-f]*' AND substr(substr(NEW.id,length(NEW.site_id)+2,36),9,1)='-' AND substr(substr(NEW.id,length(NEW.site_id)+2,36),14,1)='-' AND substr(substr(NEW.id,length(NEW.site_id)+2,36),19,1)='-' AND substr(substr(NEW.id,length(NEW.site_id)+2,36),24,1)='-' THEN unhex(replace(substr(NEW.id,length(NEW.site_id)+2,36),'-','')||hex(substr(NEW.id,length(NEW.site_id)+38))) ELSE NEW.id  END ,(SELECT context FROM vane_raw_contexts WHERE site IS (SELECT site FROM vane_raw_sites WHERE site_id=NEW.site_id) AND day IS NEW.day AND kind IS NEW.kind AND dimensions IS json_array(NEW.path,NEW.source,NEW.campaign,NEW.hostname,NEW.device,NEW.browser,NEW.browser_version,NEW.os,NEW.os_version,NEW.screen,NEW.channel,NEW.referrer,NEW.utm_source,NEW.utm_medium,NEW.utm_term,NEW.utm_content,NEW.country,NEW.region,NEW.city,NEW.metro_code,NEW.search,NEW.transport,NEW.consent,NEW.sample_rate,NEW.import_job,NEW.paid_click,NEW.query) AND visitor IS (SELECT identity FROM vane_raw_identities WHERE value= CASE  WHEN length(NEW.visitor)=64 AND NEW.visitor NOT GLOB '*[^0-9a-f]*' THEN unhex(NEW.visitor) ELSE NEW.visitor  END ) AND consented_visitor IS (SELECT identity FROM vane_raw_identities WHERE value= CASE  WHEN length(NEW.consented_visitor)=64 AND NEW.consented_visitor NOT GLOB '*[^0-9a-f]*' THEN unhex(NEW.consented_visitor) ELSE NEW.consented_visitor  END ) AND consented_created_at IS NEW.consented_created_at AND consented_expires_at IS NEW.consented_expires_at),NEW.at-coalesce(unixepoch(NEW.day)*1000,0));
 INSERT INTO vane_raw_details(raw_id,engaged_at,scroll,lcp,inp,cls,load_ms)
 SELECT (SELECT raw_id FROM vane_raw_events WHERE site=(SELECT site FROM vane_raw_sites WHERE site_id=NEW.site_id) AND token= CASE  WHEN substr(NEW.id,1,length(NEW.site_id)+1)=NEW.site_id||':' AND length(substr(NEW.id,length(NEW.site_id)+2,36))=36 AND length(replace(substr(NEW.id,length(NEW.site_id)+2,36),'-',''))=32 AND replace(substr(NEW.id,length(NEW.site_id)+2,36),'-','') NOT GLOB '*[^0-9a-f]*' AND substr(substr(NEW.id,length(NEW.site_id)+2,36),9,1)='-' AND substr(substr(NEW.id,length(NEW.site_id)+2,36),14,1)='-' AND substr(substr(NEW.id,length(NEW.site_id)+2,36),19,1)='-' AND substr(substr(NEW.id,length(NEW.site_id)+2,36),24,1)='-' THEN unhex(replace(substr(NEW.id,length(NEW.site_id)+2,36),'-','')||hex(substr(NEW.id,length(NEW.site_id)+38))) ELSE NEW.id  END ),NEW.engaged_at,NEW.scroll,NEW.lcp,NEW.inp,NEW.cls,NEW.load_ms WHERE (changes()>0) AND (NEW.engaged_at IS NOT NULL OR NEW.scroll IS NOT NULL OR NEW.lcp IS NOT NULL OR NEW.inp IS NOT NULL OR NEW.cls IS NOT NULL OR NEW.load_ms IS NOT NULL)
 ON CONFLICT(raw_id) DO UPDATE SET engaged_at=excluded.engaged_at,scroll=excluded.scroll,lcp=excluded.lcp,inp=excluded.inp,cls=excluded.cls,load_ms=excluded.load_ms;
 END ;
CREATE TRIGGER vane_raw_update INSTEAD OF UPDATE ON vane_events BEGIN
 INSERT OR IGNORE INTO vane_raw_sites(site_id) SELECT NEW.site_id WHERE 1;
 INSERT OR IGNORE INTO vane_raw_identities(value) SELECT  CASE  WHEN length(NEW.visitor)=64 AND NEW.visitor NOT GLOB '*[^0-9a-f]*' THEN unhex(NEW.visitor) ELSE NEW.visitor  END  WHERE NEW.visitor IS NOT NULL AND 1;
 INSERT OR IGNORE INTO vane_raw_identities(value) SELECT  CASE  WHEN length(NEW.consented_visitor)=64 AND NEW.consented_visitor NOT GLOB '*[^0-9a-f]*' THEN unhex(NEW.consented_visitor) ELSE NEW.consented_visitor  END  WHERE NEW.consented_visitor IS NOT NULL AND 1;
 INSERT OR IGNORE INTO vane_raw_contexts(site,day,kind,dimensions,visitor,consented_visitor,consented_created_at,consented_expires_at) SELECT (SELECT site FROM vane_raw_sites WHERE site_id=NEW.site_id),NEW.day,NEW.kind,json_array(NEW.path,NEW.source,NEW.campaign,NEW.hostname,NEW.device,NEW.browser,NEW.browser_version,NEW.os,NEW.os_version,NEW.screen,NEW.channel,NEW.referrer,NEW.utm_source,NEW.utm_medium,NEW.utm_term,NEW.utm_content,NEW.country,NEW.region,NEW.city,NEW.metro_code,NEW.search,NEW.transport,NEW.consent,NEW.sample_rate,NEW.import_job,NEW.paid_click,NEW.query),(SELECT identity FROM vane_raw_identities WHERE value= CASE  WHEN length(NEW.visitor)=64 AND NEW.visitor NOT GLOB '*[^0-9a-f]*' THEN unhex(NEW.visitor) ELSE NEW.visitor  END ),(SELECT identity FROM vane_raw_identities WHERE value= CASE  WHEN length(NEW.consented_visitor)=64 AND NEW.consented_visitor NOT GLOB '*[^0-9a-f]*' THEN unhex(NEW.consented_visitor) ELSE NEW.consented_visitor  END ),NEW.consented_created_at,NEW.consented_expires_at WHERE 1;
 UPDATE vane_raw_events SET site=(SELECT site FROM vane_raw_sites WHERE site_id=NEW.site_id),token= CASE  WHEN substr(NEW.id,1,length(NEW.site_id)+1)=NEW.site_id||':' AND length(substr(NEW.id,length(NEW.site_id)+2,36))=36 AND length(replace(substr(NEW.id,length(NEW.site_id)+2,36),'-',''))=32 AND replace(substr(NEW.id,length(NEW.site_id)+2,36),'-','') NOT GLOB '*[^0-9a-f]*' AND substr(substr(NEW.id,length(NEW.site_id)+2,36),9,1)='-' AND substr(substr(NEW.id,length(NEW.site_id)+2,36),14,1)='-' AND substr(substr(NEW.id,length(NEW.site_id)+2,36),19,1)='-' AND substr(substr(NEW.id,length(NEW.site_id)+2,36),24,1)='-' THEN unhex(replace(substr(NEW.id,length(NEW.site_id)+2,36),'-','')||hex(substr(NEW.id,length(NEW.site_id)+38))) ELSE NEW.id  END ,context=(SELECT context FROM vane_raw_contexts WHERE site IS (SELECT site FROM vane_raw_sites WHERE site_id=NEW.site_id) AND day IS NEW.day AND kind IS NEW.kind AND dimensions IS json_array(NEW.path,NEW.source,NEW.campaign,NEW.hostname,NEW.device,NEW.browser,NEW.browser_version,NEW.os,NEW.os_version,NEW.screen,NEW.channel,NEW.referrer,NEW.utm_source,NEW.utm_medium,NEW.utm_term,NEW.utm_content,NEW.country,NEW.region,NEW.city,NEW.metro_code,NEW.search,NEW.transport,NEW.consent,NEW.sample_rate,NEW.import_job,NEW.paid_click,NEW.query) AND visitor IS (SELECT identity FROM vane_raw_identities WHERE value= CASE  WHEN length(NEW.visitor)=64 AND NEW.visitor NOT GLOB '*[^0-9a-f]*' THEN unhex(NEW.visitor) ELSE NEW.visitor  END ) AND consented_visitor IS (SELECT identity FROM vane_raw_identities WHERE value= CASE  WHEN length(NEW.consented_visitor)=64 AND NEW.consented_visitor NOT GLOB '*[^0-9a-f]*' THEN unhex(NEW.consented_visitor) ELSE NEW.consented_visitor  END ) AND consented_created_at IS NEW.consented_created_at AND consented_expires_at IS NEW.consented_expires_at),at_offset=NEW.at-coalesce(unixepoch(NEW.day)*1000,0) WHERE raw_id=OLD._raw_id;
 INSERT INTO vane_raw_details(raw_id,engaged_at,scroll,lcp,inp,cls,load_ms)
 SELECT OLD._raw_id,NEW.engaged_at,NEW.scroll,NEW.lcp,NEW.inp,NEW.cls,NEW.load_ms WHERE (1) AND (NEW.engaged_at IS NOT NULL OR NEW.scroll IS NOT NULL OR NEW.lcp IS NOT NULL OR NEW.inp IS NOT NULL OR NEW.cls IS NOT NULL OR NEW.load_ms IS NOT NULL)
 ON CONFLICT(raw_id) DO UPDATE SET engaged_at=excluded.engaged_at,scroll=excluded.scroll,lcp=excluded.lcp,inp=excluded.inp,cls=excluded.cls,load_ms=excluded.load_ms;
 DELETE FROM vane_raw_details WHERE raw_id=OLD._raw_id AND NEW.engaged_at IS NULL AND NEW.scroll IS NULL AND NEW.lcp IS NULL AND NEW.inp IS NULL AND NEW.cls IS NULL AND NEW.load_ms IS NULL;
 END ;
CREATE TRIGGER vane_raw_delete INSTEAD OF DELETE ON vane_events BEGIN
 DELETE FROM vane_raw_events WHERE raw_id=OLD._raw_id;
 END ;
-- Keep complete logical values while upgrading pre-existing installations.
INSERT INTO vane_events(id,site_id,day,kind,path,source,campaign,consent,sample_rate,import_job,visitor,at,engaged_at,scroll,device,browser,browser_version,os,os_version,screen,search,hostname,utm_source,utm_medium,utm_term,utm_content,paid_click,query,channel,referrer,lcp,inp,cls,load_ms,country,region,city,metro_code,consented_visitor,consented_created_at,consented_expires_at,transport) SELECT id,site_id,day,kind,path,source,campaign,consent,sample_rate,import_job,visitor,at,engaged_at,scroll,device,browser,browser_version,os,os_version,screen,search,hostname,utm_source,utm_medium,utm_term,utm_content,paid_click,query,channel,referrer,lcp,inp,cls,load_ms,country,region,city,metro_code,consented_visitor,consented_created_at,consented_expires_at,transport FROM vane_raw_previous;
DROP TABLE vane_raw_previous;
-- 0085 already materialized these exact occurrences. Triggers start only after
-- the migration copy, so the copy cannot double count them.
CREATE TRIGGER vane_raw_analytics_insert AFTER INSERT ON vane_raw_events BEGIN
 INSERT INTO vane_analytics_cells(site_id,day,kind,cell,n,timed,consented)
 SELECT site_id,day,kind,cell,1,timed,consented FROM (SELECT s.site_id,c.day,c.kind,json_remove(c.dimensions,'$[26]','$[25]') AS cell,
  CASE  WHEN c.consented_visitor IS NOT NULL THEN s.site_id||' c '|| CASE  WHEN typeof(ci.value)='blob' THEN lower(hex(ci.value)) ELSE ci.value  END  ELSE s.site_id||' d '||c.day||' '|| CASE  WHEN typeof(vi.value)='blob' THEN lower(hex(vi.value)) ELSE vi.value  END   END  AS identity,
 c.visitor,NEW.at_offset IS NOT NULL AS timed,c.consented_visitor IS NOT NULL AS consented
 FROM vane_raw_contexts c JOIN vane_raw_sites s ON s.site=c.site
 LEFT JOIN vane_raw_identities vi ON vi.identity=c.visitor LEFT JOIN vane_raw_identities ci ON ci.identity=c.consented_visitor
 WHERE c.context=NEW.context) WHERE 1
 ON CONFLICT(site_id,day,kind,cell) DO UPDATE SET n=n+1,timed=timed+excluded.timed,consented=consented+excluded.consented;
 INSERT INTO vane_analytics_identities(site_id,day,kind,cell,identity,n)
 SELECT site_id,day,kind,cell,identity,1 FROM (SELECT s.site_id,c.day,c.kind,json_remove(c.dimensions,'$[26]','$[25]') AS cell,
  CASE  WHEN c.consented_visitor IS NOT NULL THEN s.site_id||' c '|| CASE  WHEN typeof(ci.value)='blob' THEN lower(hex(ci.value)) ELSE ci.value  END  ELSE s.site_id||' d '||c.day||' '|| CASE  WHEN typeof(vi.value)='blob' THEN lower(hex(vi.value)) ELSE vi.value  END   END  AS identity,
 c.visitor,NEW.at_offset IS NOT NULL AS timed,c.consented_visitor IS NOT NULL AS consented
 FROM vane_raw_contexts c JOIN vane_raw_sites s ON s.site=c.site
 LEFT JOIN vane_raw_identities vi ON vi.identity=c.visitor LEFT JOIN vane_raw_identities ci ON ci.identity=c.consented_visitor
 WHERE c.context=NEW.context) WHERE visitor IS NOT NULL
 ON CONFLICT(site_id,day,kind,cell,identity) DO UPDATE SET n=n+1;
 END ;
CREATE TRIGGER vane_raw_analytics_delete AFTER DELETE ON vane_raw_events BEGIN
 UPDATE vane_analytics_identities SET n=n-1 WHERE (site_id,day,kind,cell)=(SELECT site_id,day,kind,cell FROM (SELECT s.site_id,c.day,c.kind,json_remove(c.dimensions,'$[26]','$[25]') AS cell,
  CASE  WHEN c.consented_visitor IS NOT NULL THEN s.site_id||' c '|| CASE  WHEN typeof(ci.value)='blob' THEN lower(hex(ci.value)) ELSE ci.value  END  ELSE s.site_id||' d '||c.day||' '|| CASE  WHEN typeof(vi.value)='blob' THEN lower(hex(vi.value)) ELSE vi.value  END   END  AS identity,
 c.visitor,OLD.at_offset IS NOT NULL AS timed,c.consented_visitor IS NOT NULL AS consented
 FROM vane_raw_contexts c JOIN vane_raw_sites s ON s.site=c.site
 LEFT JOIN vane_raw_identities vi ON vi.identity=c.visitor LEFT JOIN vane_raw_identities ci ON ci.identity=c.consented_visitor
 WHERE c.context=OLD.context)) AND identity=(SELECT identity FROM (SELECT s.site_id,c.day,c.kind,json_remove(c.dimensions,'$[26]','$[25]') AS cell,
  CASE  WHEN c.consented_visitor IS NOT NULL THEN s.site_id||' c '|| CASE  WHEN typeof(ci.value)='blob' THEN lower(hex(ci.value)) ELSE ci.value  END  ELSE s.site_id||' d '||c.day||' '|| CASE  WHEN typeof(vi.value)='blob' THEN lower(hex(vi.value)) ELSE vi.value  END   END  AS identity,
 c.visitor,OLD.at_offset IS NOT NULL AS timed,c.consented_visitor IS NOT NULL AS consented
 FROM vane_raw_contexts c JOIN vane_raw_sites s ON s.site=c.site
 LEFT JOIN vane_raw_identities vi ON vi.identity=c.visitor LEFT JOIN vane_raw_identities ci ON ci.identity=c.consented_visitor
 WHERE c.context=OLD.context)) AND (SELECT visitor FROM (SELECT s.site_id,c.day,c.kind,json_remove(c.dimensions,'$[26]','$[25]') AS cell,
  CASE  WHEN c.consented_visitor IS NOT NULL THEN s.site_id||' c '|| CASE  WHEN typeof(ci.value)='blob' THEN lower(hex(ci.value)) ELSE ci.value  END  ELSE s.site_id||' d '||c.day||' '|| CASE  WHEN typeof(vi.value)='blob' THEN lower(hex(vi.value)) ELSE vi.value  END   END  AS identity,
 c.visitor,OLD.at_offset IS NOT NULL AS timed,c.consented_visitor IS NOT NULL AS consented
 FROM vane_raw_contexts c JOIN vane_raw_sites s ON s.site=c.site
 LEFT JOIN vane_raw_identities vi ON vi.identity=c.visitor LEFT JOIN vane_raw_identities ci ON ci.identity=c.consented_visitor
 WHERE c.context=OLD.context)) IS NOT NULL;
 DELETE FROM vane_analytics_identities WHERE (site_id,day,kind,cell)=(SELECT site_id,day,kind,cell FROM (SELECT s.site_id,c.day,c.kind,json_remove(c.dimensions,'$[26]','$[25]') AS cell,
  CASE  WHEN c.consented_visitor IS NOT NULL THEN s.site_id||' c '|| CASE  WHEN typeof(ci.value)='blob' THEN lower(hex(ci.value)) ELSE ci.value  END  ELSE s.site_id||' d '||c.day||' '|| CASE  WHEN typeof(vi.value)='blob' THEN lower(hex(vi.value)) ELSE vi.value  END   END  AS identity,
 c.visitor,OLD.at_offset IS NOT NULL AS timed,c.consented_visitor IS NOT NULL AS consented
 FROM vane_raw_contexts c JOIN vane_raw_sites s ON s.site=c.site
 LEFT JOIN vane_raw_identities vi ON vi.identity=c.visitor LEFT JOIN vane_raw_identities ci ON ci.identity=c.consented_visitor
 WHERE c.context=OLD.context)) AND n=0;
 UPDATE vane_analytics_cells SET n=n-1,timed=timed-(OLD.at_offset IS NOT NULL),consented=consented-(SELECT consented FROM (SELECT s.site_id,c.day,c.kind,json_remove(c.dimensions,'$[26]','$[25]') AS cell,
  CASE  WHEN c.consented_visitor IS NOT NULL THEN s.site_id||' c '|| CASE  WHEN typeof(ci.value)='blob' THEN lower(hex(ci.value)) ELSE ci.value  END  ELSE s.site_id||' d '||c.day||' '|| CASE  WHEN typeof(vi.value)='blob' THEN lower(hex(vi.value)) ELSE vi.value  END   END  AS identity,
 c.visitor,OLD.at_offset IS NOT NULL AS timed,c.consented_visitor IS NOT NULL AS consented
 FROM vane_raw_contexts c JOIN vane_raw_sites s ON s.site=c.site
 LEFT JOIN vane_raw_identities vi ON vi.identity=c.visitor LEFT JOIN vane_raw_identities ci ON ci.identity=c.consented_visitor
 WHERE c.context=OLD.context)) WHERE (site_id,day,kind,cell)=(SELECT site_id,day,kind,cell FROM (SELECT s.site_id,c.day,c.kind,json_remove(c.dimensions,'$[26]','$[25]') AS cell,
  CASE  WHEN c.consented_visitor IS NOT NULL THEN s.site_id||' c '|| CASE  WHEN typeof(ci.value)='blob' THEN lower(hex(ci.value)) ELSE ci.value  END  ELSE s.site_id||' d '||c.day||' '|| CASE  WHEN typeof(vi.value)='blob' THEN lower(hex(vi.value)) ELSE vi.value  END   END  AS identity,
 c.visitor,OLD.at_offset IS NOT NULL AS timed,c.consented_visitor IS NOT NULL AS consented
 FROM vane_raw_contexts c JOIN vane_raw_sites s ON s.site=c.site
 LEFT JOIN vane_raw_identities vi ON vi.identity=c.visitor LEFT JOIN vane_raw_identities ci ON ci.identity=c.consented_visitor
 WHERE c.context=OLD.context));
 DELETE FROM vane_analytics_cells WHERE (site_id,day,kind,cell)=(SELECT site_id,day,kind,cell FROM (SELECT s.site_id,c.day,c.kind,json_remove(c.dimensions,'$[26]','$[25]') AS cell,
  CASE  WHEN c.consented_visitor IS NOT NULL THEN s.site_id||' c '|| CASE  WHEN typeof(ci.value)='blob' THEN lower(hex(ci.value)) ELSE ci.value  END  ELSE s.site_id||' d '||c.day||' '|| CASE  WHEN typeof(vi.value)='blob' THEN lower(hex(vi.value)) ELSE vi.value  END   END  AS identity,
 c.visitor,OLD.at_offset IS NOT NULL AS timed,c.consented_visitor IS NOT NULL AS consented
 FROM vane_raw_contexts c JOIN vane_raw_sites s ON s.site=c.site
 LEFT JOIN vane_raw_identities vi ON vi.identity=c.visitor LEFT JOIN vane_raw_identities ci ON ci.identity=c.consented_visitor
 WHERE c.context=OLD.context)) AND n=0;
 DELETE FROM vane_raw_contexts WHERE context=OLD.context AND NOT EXISTS(SELECT 1 FROM vane_raw_events WHERE context=OLD.context);
 END ;
CREATE TRIGGER vane_raw_analytics_update AFTER UPDATE OF context,at_offset ON vane_raw_events
WHEN NEW.context IS NOT OLD.context OR NEW.at_offset IS NOT OLD.at_offset BEGIN
 UPDATE vane_analytics_identities SET n=n-1 WHERE (site_id,day,kind,cell)=(SELECT site_id,day,kind,cell FROM (SELECT s.site_id,c.day,c.kind,json_remove(c.dimensions,'$[26]','$[25]') AS cell,
  CASE  WHEN c.consented_visitor IS NOT NULL THEN s.site_id||' c '|| CASE  WHEN typeof(ci.value)='blob' THEN lower(hex(ci.value)) ELSE ci.value  END  ELSE s.site_id||' d '||c.day||' '|| CASE  WHEN typeof(vi.value)='blob' THEN lower(hex(vi.value)) ELSE vi.value  END   END  AS identity,
 c.visitor,OLD.at_offset IS NOT NULL AS timed,c.consented_visitor IS NOT NULL AS consented
 FROM vane_raw_contexts c JOIN vane_raw_sites s ON s.site=c.site
 LEFT JOIN vane_raw_identities vi ON vi.identity=c.visitor LEFT JOIN vane_raw_identities ci ON ci.identity=c.consented_visitor
 WHERE c.context=OLD.context)) AND identity=(SELECT identity FROM (SELECT s.site_id,c.day,c.kind,json_remove(c.dimensions,'$[26]','$[25]') AS cell,
  CASE  WHEN c.consented_visitor IS NOT NULL THEN s.site_id||' c '|| CASE  WHEN typeof(ci.value)='blob' THEN lower(hex(ci.value)) ELSE ci.value  END  ELSE s.site_id||' d '||c.day||' '|| CASE  WHEN typeof(vi.value)='blob' THEN lower(hex(vi.value)) ELSE vi.value  END   END  AS identity,
 c.visitor,OLD.at_offset IS NOT NULL AS timed,c.consented_visitor IS NOT NULL AS consented
 FROM vane_raw_contexts c JOIN vane_raw_sites s ON s.site=c.site
 LEFT JOIN vane_raw_identities vi ON vi.identity=c.visitor LEFT JOIN vane_raw_identities ci ON ci.identity=c.consented_visitor
 WHERE c.context=OLD.context)) AND (SELECT visitor FROM (SELECT s.site_id,c.day,c.kind,json_remove(c.dimensions,'$[26]','$[25]') AS cell,
  CASE  WHEN c.consented_visitor IS NOT NULL THEN s.site_id||' c '|| CASE  WHEN typeof(ci.value)='blob' THEN lower(hex(ci.value)) ELSE ci.value  END  ELSE s.site_id||' d '||c.day||' '|| CASE  WHEN typeof(vi.value)='blob' THEN lower(hex(vi.value)) ELSE vi.value  END   END  AS identity,
 c.visitor,OLD.at_offset IS NOT NULL AS timed,c.consented_visitor IS NOT NULL AS consented
 FROM vane_raw_contexts c JOIN vane_raw_sites s ON s.site=c.site
 LEFT JOIN vane_raw_identities vi ON vi.identity=c.visitor LEFT JOIN vane_raw_identities ci ON ci.identity=c.consented_visitor
 WHERE c.context=OLD.context)) IS NOT NULL;
 DELETE FROM vane_analytics_identities WHERE (site_id,day,kind,cell)=(SELECT site_id,day,kind,cell FROM (SELECT s.site_id,c.day,c.kind,json_remove(c.dimensions,'$[26]','$[25]') AS cell,
  CASE  WHEN c.consented_visitor IS NOT NULL THEN s.site_id||' c '|| CASE  WHEN typeof(ci.value)='blob' THEN lower(hex(ci.value)) ELSE ci.value  END  ELSE s.site_id||' d '||c.day||' '|| CASE  WHEN typeof(vi.value)='blob' THEN lower(hex(vi.value)) ELSE vi.value  END   END  AS identity,
 c.visitor,OLD.at_offset IS NOT NULL AS timed,c.consented_visitor IS NOT NULL AS consented
 FROM vane_raw_contexts c JOIN vane_raw_sites s ON s.site=c.site
 LEFT JOIN vane_raw_identities vi ON vi.identity=c.visitor LEFT JOIN vane_raw_identities ci ON ci.identity=c.consented_visitor
 WHERE c.context=OLD.context)) AND n=0;
 UPDATE vane_analytics_cells SET n=n-1,timed=timed-(OLD.at_offset IS NOT NULL),consented=consented-(SELECT consented FROM (SELECT s.site_id,c.day,c.kind,json_remove(c.dimensions,'$[26]','$[25]') AS cell,
  CASE  WHEN c.consented_visitor IS NOT NULL THEN s.site_id||' c '|| CASE  WHEN typeof(ci.value)='blob' THEN lower(hex(ci.value)) ELSE ci.value  END  ELSE s.site_id||' d '||c.day||' '|| CASE  WHEN typeof(vi.value)='blob' THEN lower(hex(vi.value)) ELSE vi.value  END   END  AS identity,
 c.visitor,OLD.at_offset IS NOT NULL AS timed,c.consented_visitor IS NOT NULL AS consented
 FROM vane_raw_contexts c JOIN vane_raw_sites s ON s.site=c.site
 LEFT JOIN vane_raw_identities vi ON vi.identity=c.visitor LEFT JOIN vane_raw_identities ci ON ci.identity=c.consented_visitor
 WHERE c.context=OLD.context)) WHERE (site_id,day,kind,cell)=(SELECT site_id,day,kind,cell FROM (SELECT s.site_id,c.day,c.kind,json_remove(c.dimensions,'$[26]','$[25]') AS cell,
  CASE  WHEN c.consented_visitor IS NOT NULL THEN s.site_id||' c '|| CASE  WHEN typeof(ci.value)='blob' THEN lower(hex(ci.value)) ELSE ci.value  END  ELSE s.site_id||' d '||c.day||' '|| CASE  WHEN typeof(vi.value)='blob' THEN lower(hex(vi.value)) ELSE vi.value  END   END  AS identity,
 c.visitor,OLD.at_offset IS NOT NULL AS timed,c.consented_visitor IS NOT NULL AS consented
 FROM vane_raw_contexts c JOIN vane_raw_sites s ON s.site=c.site
 LEFT JOIN vane_raw_identities vi ON vi.identity=c.visitor LEFT JOIN vane_raw_identities ci ON ci.identity=c.consented_visitor
 WHERE c.context=OLD.context));
 DELETE FROM vane_analytics_cells WHERE (site_id,day,kind,cell)=(SELECT site_id,day,kind,cell FROM (SELECT s.site_id,c.day,c.kind,json_remove(c.dimensions,'$[26]','$[25]') AS cell,
  CASE  WHEN c.consented_visitor IS NOT NULL THEN s.site_id||' c '|| CASE  WHEN typeof(ci.value)='blob' THEN lower(hex(ci.value)) ELSE ci.value  END  ELSE s.site_id||' d '||c.day||' '|| CASE  WHEN typeof(vi.value)='blob' THEN lower(hex(vi.value)) ELSE vi.value  END   END  AS identity,
 c.visitor,OLD.at_offset IS NOT NULL AS timed,c.consented_visitor IS NOT NULL AS consented
 FROM vane_raw_contexts c JOIN vane_raw_sites s ON s.site=c.site
 LEFT JOIN vane_raw_identities vi ON vi.identity=c.visitor LEFT JOIN vane_raw_identities ci ON ci.identity=c.consented_visitor
 WHERE c.context=OLD.context)) AND n=0;
 INSERT INTO vane_analytics_cells(site_id,day,kind,cell,n,timed,consented)
 SELECT site_id,day,kind,cell,1,timed,consented FROM (SELECT s.site_id,c.day,c.kind,json_remove(c.dimensions,'$[26]','$[25]') AS cell,
  CASE  WHEN c.consented_visitor IS NOT NULL THEN s.site_id||' c '|| CASE  WHEN typeof(ci.value)='blob' THEN lower(hex(ci.value)) ELSE ci.value  END  ELSE s.site_id||' d '||c.day||' '|| CASE  WHEN typeof(vi.value)='blob' THEN lower(hex(vi.value)) ELSE vi.value  END   END  AS identity,
 c.visitor,NEW.at_offset IS NOT NULL AS timed,c.consented_visitor IS NOT NULL AS consented
 FROM vane_raw_contexts c JOIN vane_raw_sites s ON s.site=c.site
 LEFT JOIN vane_raw_identities vi ON vi.identity=c.visitor LEFT JOIN vane_raw_identities ci ON ci.identity=c.consented_visitor
 WHERE c.context=NEW.context) WHERE 1
 ON CONFLICT(site_id,day,kind,cell) DO UPDATE SET n=n+1,timed=timed+excluded.timed,consented=consented+excluded.consented;
 INSERT INTO vane_analytics_identities(site_id,day,kind,cell,identity,n)
 SELECT site_id,day,kind,cell,identity,1 FROM (SELECT s.site_id,c.day,c.kind,json_remove(c.dimensions,'$[26]','$[25]') AS cell,
  CASE  WHEN c.consented_visitor IS NOT NULL THEN s.site_id||' c '|| CASE  WHEN typeof(ci.value)='blob' THEN lower(hex(ci.value)) ELSE ci.value  END  ELSE s.site_id||' d '||c.day||' '|| CASE  WHEN typeof(vi.value)='blob' THEN lower(hex(vi.value)) ELSE vi.value  END   END  AS identity,
 c.visitor,NEW.at_offset IS NOT NULL AS timed,c.consented_visitor IS NOT NULL AS consented
 FROM vane_raw_contexts c JOIN vane_raw_sites s ON s.site=c.site
 LEFT JOIN vane_raw_identities vi ON vi.identity=c.visitor LEFT JOIN vane_raw_identities ci ON ci.identity=c.consented_visitor
 WHERE c.context=NEW.context) WHERE visitor IS NOT NULL
 ON CONFLICT(site_id,day,kind,cell,identity) DO UPDATE SET n=n+1;
 DELETE FROM vane_raw_contexts WHERE context=OLD.context AND NOT EXISTS(SELECT 1 FROM vane_raw_events WHERE context=OLD.context);
 END ;
CREATE TRIGGER vane_raw_context_gc AFTER DELETE ON vane_raw_contexts BEGIN
 DELETE FROM vane_raw_identities WHERE identity IN (OLD.visitor,OLD.consented_visitor)
 AND NOT EXISTS(SELECT 1 FROM vane_raw_contexts WHERE visitor=identity OR consented_visitor=identity);
 DELETE FROM vane_raw_sites WHERE site=OLD.site AND NOT EXISTS(SELECT 1 FROM vane_raw_contexts WHERE site=OLD.site) AND NOT EXISTS(SELECT 1 FROM vane_raw_events WHERE site=OLD.site);
 END ;

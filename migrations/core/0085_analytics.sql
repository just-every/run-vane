-- COLLECT-004: exact native whole-day occurrence cells and identity reference
-- counts. Compression depends on actual dimension/identity cardinality; this
-- never discards raw rows, approximates visitors, or answers visit metrics.
CREATE TABLE vane_analytics_cells(
 site_id TEXT NOT NULL REFERENCES vane_sites(id) ON DELETE CASCADE,
 day TEXT NOT NULL, kind TEXT NOT NULL, cell TEXT NOT NULL,
 n INTEGER NOT NULL CHECK(n>=0), timed INTEGER NOT NULL CHECK(timed>=0), consented INTEGER NOT NULL CHECK(consented>=0),
 PRIMARY KEY(site_id,day,kind,cell)
) WITHOUT ROWID;
CREATE TABLE vane_analytics_identities(
 site_id TEXT NOT NULL REFERENCES vane_sites(id) ON DELETE CASCADE,
 day TEXT NOT NULL, kind TEXT NOT NULL, cell TEXT NOT NULL, identity TEXT NOT NULL,
 n INTEGER NOT NULL CHECK(n>=0),
 PRIMARY KEY(site_id,day,kind,cell,identity)
) WITHOUT ROWID;
CREATE INDEX vane_analytics_identity_range ON vane_analytics_identities(site_id,day,kind,identity);

-- Existing native history is materialized in the migration transaction.
INSERT INTO vane_analytics_cells(site_id,day,kind,cell,n,timed,consented)
SELECT site_id,day,kind,json_array(path,source,campaign,hostname,device,browser,browser_version,os,os_version,screen,channel,referrer,utm_source,utm_medium,utm_term,utm_content,country,region,city,metro_code,search,transport,consent,sample_rate,import_job),COUNT(*),SUM(at IS NOT NULL),SUM(consented_visitor IS NOT NULL)
FROM vane_events GROUP BY site_id,day,kind,json_array(path,source,campaign,hostname,device,browser,browser_version,os,os_version,screen,channel,referrer,utm_source,utm_medium,utm_term,utm_content,country,region,city,metro_code,search,transport,consent,sample_rate,import_job);
INSERT INTO vane_analytics_identities(site_id,day,kind,cell,identity,n)
SELECT site_id,day,kind,json_array(path,source,campaign,hostname,device,browser,browser_version,os,os_version,screen,channel,referrer,utm_source,utm_medium,utm_term,utm_content,country,region,city,metro_code,search,transport,consent,sample_rate,import_job),CASE WHEN consented_visitor IS NOT NULL THEN site_id||' c '||consented_visitor ELSE site_id||' d '||day||' '||visitor END,COUNT(*)
FROM vane_events WHERE visitor IS NOT NULL GROUP BY site_id,day,kind,json_array(path,source,campaign,hostname,device,browser,browser_version,os,os_version,screen,channel,referrer,utm_source,utm_medium,utm_term,utm_content,country,region,city,metro_code,search,transport,consent,sample_rate,import_job),CASE WHEN consented_visitor IS NOT NULL THEN site_id||' c '||consented_visitor ELSE site_id||' d '||day||' '||visitor END;

CREATE TRIGGER vane_analytics_insert AFTER INSERT ON vane_events BEGIN
  INSERT INTO vane_analytics_cells(site_id,day,kind,cell,n,timed,consented)
  VALUES(NEW.site_id,NEW.day,NEW.kind,json_array(NEW.path,NEW.source,NEW.campaign,NEW.hostname,NEW.device,NEW.browser,NEW.browser_version,NEW.os,NEW.os_version,NEW.screen,NEW.channel,NEW.referrer,NEW.utm_source,NEW.utm_medium,NEW.utm_term,NEW.utm_content,NEW.country,NEW.region,NEW.city,NEW.metro_code,NEW.search,NEW.transport,NEW.consent,NEW.sample_rate,NEW.import_job),1,NEW.at IS NOT NULL,NEW.consented_visitor IS NOT NULL)
  ON CONFLICT(site_id,day,kind,cell) DO UPDATE SET n=n+1,timed=timed+excluded.timed,consented=consented+excluded.consented;
  INSERT INTO vane_analytics_identities(site_id,day,kind,cell,identity,n)
  SELECT NEW.site_id,NEW.day,NEW.kind,json_array(NEW.path,NEW.source,NEW.campaign,NEW.hostname,NEW.device,NEW.browser,NEW.browser_version,NEW.os,NEW.os_version,NEW.screen,NEW.channel,NEW.referrer,NEW.utm_source,NEW.utm_medium,NEW.utm_term,NEW.utm_content,NEW.country,NEW.region,NEW.city,NEW.metro_code,NEW.search,NEW.transport,NEW.consent,NEW.sample_rate,NEW.import_job),CASE WHEN NEW.consented_visitor IS NOT NULL THEN NEW.site_id||' c '||NEW.consented_visitor ELSE NEW.site_id||' d '||NEW.day||' '||NEW.visitor END,1 WHERE NEW.visitor IS NOT NULL
  ON CONFLICT(site_id,day,kind,cell,identity) DO UPDATE SET n=n+1;
END;
CREATE TRIGGER vane_analytics_delete AFTER DELETE ON vane_events BEGIN
  UPDATE vane_analytics_identities SET n=n-1 WHERE site_id=OLD.site_id AND day=OLD.day AND kind=OLD.kind AND cell=json_array(OLD.path,OLD.source,OLD.campaign,OLD.hostname,OLD.device,OLD.browser,OLD.browser_version,OLD.os,OLD.os_version,OLD.screen,OLD.channel,OLD.referrer,OLD.utm_source,OLD.utm_medium,OLD.utm_term,OLD.utm_content,OLD.country,OLD.region,OLD.city,OLD.metro_code,OLD.search,OLD.transport,OLD.consent,OLD.sample_rate,OLD.import_job) AND identity=(CASE WHEN OLD.consented_visitor IS NOT NULL THEN OLD.site_id||' c '||OLD.consented_visitor ELSE OLD.site_id||' d '||OLD.day||' '||OLD.visitor END) AND OLD.visitor IS NOT NULL;
  DELETE FROM vane_analytics_identities WHERE site_id=OLD.site_id AND day=OLD.day AND kind=OLD.kind AND cell=json_array(OLD.path,OLD.source,OLD.campaign,OLD.hostname,OLD.device,OLD.browser,OLD.browser_version,OLD.os,OLD.os_version,OLD.screen,OLD.channel,OLD.referrer,OLD.utm_source,OLD.utm_medium,OLD.utm_term,OLD.utm_content,OLD.country,OLD.region,OLD.city,OLD.metro_code,OLD.search,OLD.transport,OLD.consent,OLD.sample_rate,OLD.import_job) AND n=0;
  UPDATE vane_analytics_cells SET n=n-1,timed=timed-(OLD.at IS NOT NULL),consented=consented-(OLD.consented_visitor IS NOT NULL) WHERE site_id=OLD.site_id AND day=OLD.day AND kind=OLD.kind AND cell=json_array(OLD.path,OLD.source,OLD.campaign,OLD.hostname,OLD.device,OLD.browser,OLD.browser_version,OLD.os,OLD.os_version,OLD.screen,OLD.channel,OLD.referrer,OLD.utm_source,OLD.utm_medium,OLD.utm_term,OLD.utm_content,OLD.country,OLD.region,OLD.city,OLD.metro_code,OLD.search,OLD.transport,OLD.consent,OLD.sample_rate,OLD.import_job);
  DELETE FROM vane_analytics_cells WHERE site_id=OLD.site_id AND day=OLD.day AND kind=OLD.kind AND cell=json_array(OLD.path,OLD.source,OLD.campaign,OLD.hostname,OLD.device,OLD.browser,OLD.browser_version,OLD.os,OLD.os_version,OLD.screen,OLD.channel,OLD.referrer,OLD.utm_source,OLD.utm_medium,OLD.utm_term,OLD.utm_content,OLD.country,OLD.region,OLD.city,OLD.metro_code,OLD.search,OLD.transport,OLD.consent,OLD.sample_rate,OLD.import_job) AND n=0;
END;
CREATE TRIGGER vane_analytics_update AFTER UPDATE OF site_id,day,kind,visitor,consented_visitor,at,path,source,campaign,hostname,device,browser,browser_version,os,os_version,screen,channel,referrer,utm_source,utm_medium,utm_term,utm_content,country,region,city,metro_code,search,transport,consent,sample_rate,import_job ON vane_events BEGIN
  UPDATE vane_analytics_identities SET n=n-1 WHERE site_id=OLD.site_id AND day=OLD.day AND kind=OLD.kind AND cell=json_array(OLD.path,OLD.source,OLD.campaign,OLD.hostname,OLD.device,OLD.browser,OLD.browser_version,OLD.os,OLD.os_version,OLD.screen,OLD.channel,OLD.referrer,OLD.utm_source,OLD.utm_medium,OLD.utm_term,OLD.utm_content,OLD.country,OLD.region,OLD.city,OLD.metro_code,OLD.search,OLD.transport,OLD.consent,OLD.sample_rate,OLD.import_job) AND identity=(CASE WHEN OLD.consented_visitor IS NOT NULL THEN OLD.site_id||' c '||OLD.consented_visitor ELSE OLD.site_id||' d '||OLD.day||' '||OLD.visitor END) AND OLD.visitor IS NOT NULL;
  DELETE FROM vane_analytics_identities WHERE site_id=OLD.site_id AND day=OLD.day AND kind=OLD.kind AND cell=json_array(OLD.path,OLD.source,OLD.campaign,OLD.hostname,OLD.device,OLD.browser,OLD.browser_version,OLD.os,OLD.os_version,OLD.screen,OLD.channel,OLD.referrer,OLD.utm_source,OLD.utm_medium,OLD.utm_term,OLD.utm_content,OLD.country,OLD.region,OLD.city,OLD.metro_code,OLD.search,OLD.transport,OLD.consent,OLD.sample_rate,OLD.import_job) AND n=0;
  UPDATE vane_analytics_cells SET n=n-1,timed=timed-(OLD.at IS NOT NULL),consented=consented-(OLD.consented_visitor IS NOT NULL) WHERE site_id=OLD.site_id AND day=OLD.day AND kind=OLD.kind AND cell=json_array(OLD.path,OLD.source,OLD.campaign,OLD.hostname,OLD.device,OLD.browser,OLD.browser_version,OLD.os,OLD.os_version,OLD.screen,OLD.channel,OLD.referrer,OLD.utm_source,OLD.utm_medium,OLD.utm_term,OLD.utm_content,OLD.country,OLD.region,OLD.city,OLD.metro_code,OLD.search,OLD.transport,OLD.consent,OLD.sample_rate,OLD.import_job);
  DELETE FROM vane_analytics_cells WHERE site_id=OLD.site_id AND day=OLD.day AND kind=OLD.kind AND cell=json_array(OLD.path,OLD.source,OLD.campaign,OLD.hostname,OLD.device,OLD.browser,OLD.browser_version,OLD.os,OLD.os_version,OLD.screen,OLD.channel,OLD.referrer,OLD.utm_source,OLD.utm_medium,OLD.utm_term,OLD.utm_content,OLD.country,OLD.region,OLD.city,OLD.metro_code,OLD.search,OLD.transport,OLD.consent,OLD.sample_rate,OLD.import_job) AND n=0;
  INSERT INTO vane_analytics_cells(site_id,day,kind,cell,n,timed,consented)
  VALUES(NEW.site_id,NEW.day,NEW.kind,json_array(NEW.path,NEW.source,NEW.campaign,NEW.hostname,NEW.device,NEW.browser,NEW.browser_version,NEW.os,NEW.os_version,NEW.screen,NEW.channel,NEW.referrer,NEW.utm_source,NEW.utm_medium,NEW.utm_term,NEW.utm_content,NEW.country,NEW.region,NEW.city,NEW.metro_code,NEW.search,NEW.transport,NEW.consent,NEW.sample_rate,NEW.import_job),1,NEW.at IS NOT NULL,NEW.consented_visitor IS NOT NULL)
  ON CONFLICT(site_id,day,kind,cell) DO UPDATE SET n=n+1,timed=timed+excluded.timed,consented=consented+excluded.consented;
  INSERT INTO vane_analytics_identities(site_id,day,kind,cell,identity,n)
  SELECT NEW.site_id,NEW.day,NEW.kind,json_array(NEW.path,NEW.source,NEW.campaign,NEW.hostname,NEW.device,NEW.browser,NEW.browser_version,NEW.os,NEW.os_version,NEW.screen,NEW.channel,NEW.referrer,NEW.utm_source,NEW.utm_medium,NEW.utm_term,NEW.utm_content,NEW.country,NEW.region,NEW.city,NEW.metro_code,NEW.search,NEW.transport,NEW.consent,NEW.sample_rate,NEW.import_job),CASE WHEN NEW.consented_visitor IS NOT NULL THEN NEW.site_id||' c '||NEW.consented_visitor ELSE NEW.site_id||' d '||NEW.day||' '||NEW.visitor END,1 WHERE NEW.visitor IS NOT NULL
  ON CONFLICT(site_id,day,kind,cell,identity) DO UPDATE SET n=n+1;
END;

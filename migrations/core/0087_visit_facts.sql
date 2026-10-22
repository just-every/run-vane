-- COLLECT-004 exact native visit facts. Raw rows retain their own visit_id;
-- there is no duplicate occurrence/membership table. Frequency rows count real
-- occurrences, never statistical weights. Every reader refreshes invalidated
-- chains transactionally before returning facts. Capacity remains measurable.
CREATE INDEX vane_raw_contexts_visit_chain ON vane_raw_contexts(site,day,visitor,kind);
CREATE TABLE vane_visit_facts(
 visit INTEGER PRIMARY KEY AUTOINCREMENT,
 site INTEGER NOT NULL REFERENCES vane_raw_sites(site) ON DELETE CASCADE,
 day TEXT NOT NULL,visitor INTEGER NOT NULL,
 first_raw INTEGER REFERENCES vane_raw_events(raw_id) ON DELETE SET NULL,
 last_raw INTEGER REFERENCES vane_raw_events(raw_id) ON DELETE SET NULL,
 started INTEGER NOT NULL,last_at INTEGER NOT NULL,last_signal INTEGER NOT NULL,
 pages INTEGER NOT NULL,engaged INTEGER NOT NULL,identity TEXT NOT NULL,first_on_page INTEGER NOT NULL
);
CREATE INDEX vane_visit_facts_range ON vane_visit_facts(site,day,visitor);
CREATE INDEX vane_visit_facts_first ON vane_visit_facts(first_raw);
CREATE TABLE vane_visit_page_frequencies(
 visit INTEGER NOT NULL REFERENCES vane_visit_facts(visit) ON DELETE CASCADE,
 context INTEGER NOT NULL REFERENCES vane_raw_contexts(context) ON DELETE CASCADE,
 on_page INTEGER NOT NULL,scroll INTEGER NOT NULL,n INTEGER NOT NULL,
 PRIMARY KEY(visit,context,on_page,scroll)
) WITHOUT ROWID;
CREATE TABLE vane_visit_duration_frequencies(
 site INTEGER NOT NULL REFERENCES vane_raw_sites(site) ON DELETE CASCADE,day TEXT NOT NULL,duration INTEGER NOT NULL,n INTEGER NOT NULL,
 PRIMARY KEY(site,day,duration)
) WITHOUT ROWID;
CREATE TABLE vane_visit_days(
 site INTEGER NOT NULL REFERENCES vane_raw_sites(site) ON DELETE CASCADE,day TEXT NOT NULL,
 visits INTEGER NOT NULL,pageviews INTEGER NOT NULL,bounces INTEGER NOT NULL,duration_sum INTEGER NOT NULL,
 PRIMARY KEY(site,day)
) WITHOUT ROWID;
CREATE TABLE vane_visit_dirty(
 site INTEGER NOT NULL REFERENCES vane_raw_sites(site) ON DELETE CASCADE,day TEXT NOT NULL,visitor INTEGER NOT NULL,
 PRIMARY KEY(site,day,visitor)
) WITHOUT ROWID;
CREATE TABLE vane_visit_legacy(
 site INTEGER NOT NULL REFERENCES vane_raw_sites(site) ON DELETE CASCADE,day TEXT NOT NULL,visitor INTEGER NOT NULL,
 PRIMARY KEY(site,day,visitor)
) WITHOUT ROWID;
CREATE TABLE vane_visit_performance(
 context INTEGER NOT NULL REFERENCES vane_raw_contexts(context) ON DELETE CASCADE,
 metric TEXT NOT NULL,value REAL NOT NULL,n INTEGER NOT NULL,PRIMARY KEY(context,metric,value)
) WITHOUT ROWID;
CREATE TABLE vane_visit_measured(
 context INTEGER PRIMARY KEY REFERENCES vane_raw_contexts(context) ON DELETE CASCADE,n INTEGER NOT NULL
) WITHOUT ROWID;
CREATE TABLE vane_visit_work(
 raw_id INTEGER PRIMARY KEY,action TEXT NOT NULL,prev INTEGER,next INTEGER,
 left_visit INTEGER,right_visit INTEGER,visit INTEGER,old_on_page INTEGER,gap INTEGER,
 old_engaged INTEGER,old_scroll INTEGER,new_engaged INTEGER,new_scroll INTEGER
);
CREATE TABLE vane_visit_rebuild(site INTEGER NOT NULL,day TEXT NOT NULL,visitor INTEGER NOT NULL,PRIMARY KEY(site,day,visitor)) WITHOUT ROWID;
CREATE TABLE vane_visit_rebuild_pages(
 raw_id INTEGER PRIMARY KEY,context INTEGER NOT NULL,run INTEGER NOT NULL,at INTEGER NOT NULL,id TEXT NOT NULL,
 engaged_at INTEGER,scroll INTEGER,identity TEXT NOT NULL,on_page INTEGER NOT NULL,first INTEGER NOT NULL,last INTEGER NOT NULL
);

CREATE VIEW vane_visit_raw AS SELECT e.raw_id,e.site,e.context,e.token,e.visit_id,e.at_offset,c.day,c.kind,c.visitor,
 s.site_id,e.at_offset+unixepoch(c.day)*1000 AS at,d.engaged_at,d.scroll,CASE WHEN c.consented_visitor IS NOT NULL THEN s.site_id||' c '||(CASE WHEN typeof(ci.value)='blob' THEN lower(hex(ci.value)) ELSE ci.value END) ELSE s.site_id||' d '||c.day||' '||(CASE WHEN typeof(vi.value)='blob' THEN lower(hex(vi.value)) ELSE vi.value END) END AS identity,CASE WHEN typeof(e.token)='blob' THEN s.site_id||':'||substr(lower(hex(substr(e.token,1,16))),1,8)||'-'||substr(lower(hex(substr(e.token,1,16))),9,4)||'-'||substr(lower(hex(substr(e.token,1,16))),13,4)||'-'||substr(lower(hex(substr(e.token,1,16))),17,4)||'-'||substr(lower(hex(substr(e.token,1,16))),21,12)||CAST(substr(e.token,17) AS TEXT) ELSE e.token END AS id
 FROM vane_raw_events e JOIN vane_raw_contexts c ON c.context=e.context JOIN vane_raw_sites s ON s.site=e.site
 LEFT JOIN vane_raw_details d ON d.raw_id=e.raw_id LEFT JOIN vane_raw_identities vi ON vi.identity=c.visitor LEFT JOIN vane_raw_identities ci ON ci.identity=c.consented_visitor;

CREATE VIEW vane_visit_work_values AS SELECT w.*,r.site,r.context,r.day,r.visitor,r.at,r.at_offset,r.token,r.identity,
 p.at AS prev_at,p.context AS prev_context,p.engaged_at AS prev_engaged,p.scroll AS prev_scroll,p.visit_id AS prev_visit,
 n.at AS next_at,n.visit_id AS next_visit
 FROM vane_visit_work w JOIN vane_visit_raw r ON r.raw_id=w.raw_id LEFT JOIN vane_visit_raw p ON p.raw_id=w.prev LEFT JOIN vane_visit_raw n ON n.raw_id=w.next;

CREATE TRIGGER vane_visit_facts_insert AFTER INSERT ON vane_visit_facts BEGIN
INSERT INTO vane_visit_duration_frequencies(site,day,duration,n) SELECT NEW.site,NEW.day,NEW.last_signal-NEW.started,1 WHERE NEW.pages>0
 ON CONFLICT(site,day,duration) DO UPDATE SET n=n+1;
 INSERT INTO vane_visit_days(site,day,visits,pageviews,bounces,duration_sum) SELECT NEW.site,NEW.day,1,NEW.pages,(NEW.pages=1 AND NEW.engaged=0),NEW.last_signal-NEW.started WHERE NEW.pages>0
 ON CONFLICT(site,day) DO UPDATE SET visits=visits+1,pageviews=pageviews+excluded.pageviews,bounces=bounces+excluded.bounces,duration_sum=duration_sum+excluded.duration_sum;
END;

CREATE TRIGGER vane_visit_facts_update AFTER UPDATE ON vane_visit_facts BEGIN
UPDATE vane_visit_duration_frequencies SET n=n-1 WHERE site=OLD.site AND day=OLD.day AND duration=OLD.last_signal-OLD.started AND OLD.pages>0;
 DELETE FROM vane_visit_duration_frequencies WHERE site=OLD.site AND day=OLD.day AND n=0;
 UPDATE vane_visit_days SET visits=visits-1,pageviews=pageviews-OLD.pages,bounces=bounces-(OLD.pages=1 AND OLD.engaged=0),duration_sum=duration_sum-(OLD.last_signal-OLD.started) WHERE site=OLD.site AND day=OLD.day AND OLD.pages>0;
 DELETE FROM vane_visit_days WHERE site=OLD.site AND day=OLD.day AND visits=0;
INSERT INTO vane_visit_duration_frequencies(site,day,duration,n) SELECT NEW.site,NEW.day,NEW.last_signal-NEW.started,1 WHERE NEW.pages>0
 ON CONFLICT(site,day,duration) DO UPDATE SET n=n+1;
 INSERT INTO vane_visit_days(site,day,visits,pageviews,bounces,duration_sum) SELECT NEW.site,NEW.day,1,NEW.pages,(NEW.pages=1 AND NEW.engaged=0),NEW.last_signal-NEW.started WHERE NEW.pages>0
 ON CONFLICT(site,day) DO UPDATE SET visits=visits+1,pageviews=pageviews+excluded.pageviews,bounces=bounces+excluded.bounces,duration_sum=duration_sum+excluded.duration_sum;
END;

CREATE TRIGGER vane_visit_facts_delete AFTER DELETE ON vane_visit_facts BEGIN
UPDATE vane_visit_duration_frequencies SET n=n-1 WHERE site=OLD.site AND day=OLD.day AND duration=OLD.last_signal-OLD.started AND OLD.pages>0;
 DELETE FROM vane_visit_duration_frequencies WHERE site=OLD.site AND day=OLD.day AND n=0;
 UPDATE vane_visit_days SET visits=visits-1,pageviews=pageviews-OLD.pages,bounces=bounces-(OLD.pages=1 AND OLD.engaged=0),duration_sum=duration_sum-(OLD.last_signal-OLD.started) WHERE site=OLD.site AND day=OLD.day AND OLD.pages>0;
 DELETE FROM vane_visit_days WHERE site=OLD.site AND day=OLD.day AND visits=0;
END;

CREATE TRIGGER vane_visit_append AFTER INSERT ON vane_visit_work WHEN NEW.action='insert' BEGIN
 UPDATE vane_visit_work SET prev=(SELECT (SELECT candidate.raw_id FROM vane_raw_contexts cx JOIN vane_raw_events candidate ON candidate.raw_id=(
 SELECT x.raw_id FROM vane_raw_events x WHERE x.context=cx.context AND (x.at_offset,x.token)<(r.at_offset,r.token)
 ORDER BY x.at_offset DESC,x.token DESC LIMIT 1)
 WHERE cx.site=r.site AND cx.day=r.day AND cx.visitor=r.visitor AND cx.kind='pageview'
 ORDER BY candidate.at_offset DESC,candidate.token DESC LIMIT 1) FROM vane_visit_raw r WHERE r.raw_id=NEW.raw_id),next=(SELECT (SELECT candidate.raw_id FROM vane_raw_contexts cx JOIN vane_raw_events candidate ON candidate.raw_id=(
 SELECT x.raw_id FROM vane_raw_events x WHERE x.context=cx.context AND (x.at_offset,x.token)>(r.at_offset,r.token)
 ORDER BY x.at_offset ASC,x.token ASC LIMIT 1)
 WHERE cx.site=r.site AND cx.day=r.day AND cx.visitor=r.visitor AND cx.kind='pageview'
 ORDER BY candidate.at_offset ASC,candidate.token ASC LIMIT 1) FROM vane_visit_raw r WHERE r.raw_id=NEW.raw_id),gap=(SELECT (COALESCE((SELECT json_extract(d.value,'$.minutes') FROM vane_sites s,json_each(s.config_json,'$.definitions') d WHERE s.id=r.site_id AND json_extract(d.value,'$.metric')='visit-timeout' AND json_extract(d.value,'$.from')<=r.day ORDER BY json_extract(d.value,'$.from') DESC,CAST(d.key AS INTEGER) DESC LIMIT 1),30)*60000) FROM vane_visit_raw r WHERE r.raw_id=NEW.raw_id) WHERE raw_id=NEW.raw_id;
 UPDATE vane_visit_work SET left_visit=CASE WHEN (SELECT prev FROM vane_visit_work_values WHERE raw_id=NEW.raw_id) IS NOT NULL AND (SELECT at FROM vane_visit_work_values WHERE raw_id=NEW.raw_id)-(SELECT prev_at FROM vane_visit_work_values WHERE raw_id=NEW.raw_id)<=(SELECT gap FROM vane_visit_work_values WHERE raw_id=NEW.raw_id) THEN (SELECT prev_visit FROM vane_visit_work_values WHERE raw_id=NEW.raw_id) END,right_visit=CASE WHEN (SELECT next FROM vane_visit_work_values WHERE raw_id=NEW.raw_id) IS NOT NULL AND (SELECT next_at FROM vane_visit_work_values WHERE raw_id=NEW.raw_id)-(SELECT at FROM vane_visit_work_values WHERE raw_id=NEW.raw_id)<=(SELECT gap FROM vane_visit_work_values WHERE raw_id=NEW.raw_id) THEN (SELECT next_visit FROM vane_visit_work_values WHERE raw_id=NEW.raw_id) END,
 old_on_page=CASE WHEN (SELECT prev FROM vane_visit_work_values WHERE raw_id=NEW.raw_id) IS NOT NULL AND (SELECT next FROM vane_visit_work_values WHERE raw_id=NEW.raw_id) IS NOT NULL AND (SELECT next_at FROM vane_visit_work_values WHERE raw_id=NEW.raw_id)-(SELECT prev_at FROM vane_visit_work_values WHERE raw_id=NEW.raw_id)<=(SELECT gap FROM vane_visit_work_values WHERE raw_id=NEW.raw_id) THEN (SELECT next_at FROM vane_visit_work_values WHERE raw_id=NEW.raw_id)-(SELECT prev_at FROM vane_visit_work_values WHERE raw_id=NEW.raw_id) ELSE COALESCE((SELECT prev_engaged FROM vane_visit_work_values WHERE raw_id=NEW.raw_id)-(SELECT prev_at FROM vane_visit_work_values WHERE raw_id=NEW.raw_id),0) END WHERE raw_id=NEW.raw_id;
 UPDATE vane_visit_page_frequencies SET n=n-1 WHERE visit=(SELECT prev_visit FROM vane_visit_work_values WHERE raw_id=NEW.raw_id) AND context=(SELECT prev_context FROM vane_visit_work_values WHERE raw_id=NEW.raw_id) AND on_page=(SELECT old_on_page FROM vane_visit_work_values WHERE raw_id=NEW.raw_id) AND scroll=COALESCE((SELECT prev_scroll FROM vane_visit_work_values WHERE raw_id=NEW.raw_id),-1) AND (SELECT prev FROM vane_visit_work_values WHERE raw_id=NEW.raw_id) IS NOT NULL;
 DELETE FROM vane_visit_page_frequencies WHERE visit=(SELECT prev_visit FROM vane_visit_work_values WHERE raw_id=NEW.raw_id) AND n=0;
 INSERT INTO vane_visit_page_frequencies(visit,context,on_page,scroll,n)
 SELECT (SELECT left_visit FROM vane_visit_work_values WHERE raw_id=NEW.raw_id),context,on_page,scroll,n FROM vane_visit_page_frequencies WHERE visit=(SELECT right_visit FROM vane_visit_work_values WHERE raw_id=NEW.raw_id) AND (SELECT left_visit FROM vane_visit_work_values WHERE raw_id=NEW.raw_id) IS NOT NULL AND (SELECT right_visit FROM vane_visit_work_values WHERE raw_id=NEW.raw_id) IS NOT NULL AND (SELECT left_visit FROM vane_visit_work_values WHERE raw_id=NEW.raw_id)!=(SELECT right_visit FROM vane_visit_work_values WHERE raw_id=NEW.raw_id)
 ON CONFLICT(visit,context,on_page,scroll) DO UPDATE SET n=n+excluded.n;
 UPDATE vane_visit_facts SET pages=pages+(SELECT pages FROM vane_visit_facts WHERE visit=(SELECT right_visit FROM vane_visit_work_values WHERE raw_id=NEW.raw_id)),
 engaged=engaged+(SELECT engaged FROM vane_visit_facts WHERE visit=(SELECT right_visit FROM vane_visit_work_values WHERE raw_id=NEW.raw_id)),
 last_at=(SELECT last_at FROM vane_visit_facts WHERE visit=(SELECT right_visit FROM vane_visit_work_values WHERE raw_id=NEW.raw_id)),last_raw=(SELECT last_raw FROM vane_visit_facts WHERE visit=(SELECT right_visit FROM vane_visit_work_values WHERE raw_id=NEW.raw_id)),
 last_signal=MAX(last_signal,(SELECT last_signal FROM vane_visit_facts WHERE visit=(SELECT right_visit FROM vane_visit_work_values WHERE raw_id=NEW.raw_id))),identity=MAX(identity,(SELECT identity FROM vane_visit_facts WHERE visit=(SELECT right_visit FROM vane_visit_work_values WHERE raw_id=NEW.raw_id)))
 WHERE visit=(SELECT left_visit FROM vane_visit_work_values WHERE raw_id=NEW.raw_id) AND (SELECT left_visit FROM vane_visit_work_values WHERE raw_id=NEW.raw_id) IS NOT NULL AND (SELECT right_visit FROM vane_visit_work_values WHERE raw_id=NEW.raw_id) IS NOT NULL AND (SELECT left_visit FROM vane_visit_work_values WHERE raw_id=NEW.raw_id)!=(SELECT right_visit FROM vane_visit_work_values WHERE raw_id=NEW.raw_id);
 UPDATE vane_raw_events SET visit_id=(SELECT left_visit FROM vane_visit_work_values WHERE raw_id=NEW.raw_id) WHERE visit_id=(SELECT right_visit FROM vane_visit_work_values WHERE raw_id=NEW.raw_id) AND (SELECT left_visit FROM vane_visit_work_values WHERE raw_id=NEW.raw_id) IS NOT NULL AND (SELECT right_visit FROM vane_visit_work_values WHERE raw_id=NEW.raw_id) IS NOT NULL AND (SELECT left_visit FROM vane_visit_work_values WHERE raw_id=NEW.raw_id)!=(SELECT right_visit FROM vane_visit_work_values WHERE raw_id=NEW.raw_id);
 DELETE FROM vane_visit_facts WHERE visit=(SELECT right_visit FROM vane_visit_work_values WHERE raw_id=NEW.raw_id) AND (SELECT left_visit FROM vane_visit_work_values WHERE raw_id=NEW.raw_id) IS NOT NULL AND (SELECT right_visit FROM vane_visit_work_values WHERE raw_id=NEW.raw_id) IS NOT NULL AND (SELECT left_visit FROM vane_visit_work_values WHERE raw_id=NEW.raw_id)!=(SELECT right_visit FROM vane_visit_work_values WHERE raw_id=NEW.raw_id);
 INSERT INTO vane_visit_facts(site,day,visitor,first_raw,last_raw,started,last_at,last_signal,pages,engaged,identity,first_on_page)
 SELECT site,day,visitor,raw_id,raw_id,at,at,at,0,0,identity,0 FROM vane_visit_work_values WHERE raw_id=NEW.raw_id AND left_visit IS NULL AND right_visit IS NULL;
 UPDATE vane_visit_work SET visit=COALESCE(left_visit,right_visit,last_insert_rowid()) WHERE raw_id=NEW.raw_id;
 UPDATE vane_raw_events SET visit_id=(SELECT visit FROM vane_visit_work_values WHERE raw_id=NEW.raw_id) WHERE raw_id=NEW.raw_id;
 INSERT INTO vane_visit_page_frequencies(visit,context,on_page,scroll,n) SELECT (SELECT visit FROM vane_visit_work_values WHERE raw_id=NEW.raw_id),(SELECT context FROM vane_visit_work_values WHERE raw_id=NEW.raw_id),CASE WHEN (SELECT next FROM vane_visit_work_values WHERE raw_id=NEW.raw_id) IS NOT NULL AND (SELECT next_at FROM vane_visit_work_values WHERE raw_id=NEW.raw_id)-(SELECT at FROM vane_visit_work_values WHERE raw_id=NEW.raw_id)<=(SELECT gap FROM vane_visit_work_values WHERE raw_id=NEW.raw_id) THEN (SELECT next_at FROM vane_visit_work_values WHERE raw_id=NEW.raw_id)-(SELECT at FROM vane_visit_work_values WHERE raw_id=NEW.raw_id) ELSE COALESCE((SELECT new_engaged FROM vane_visit_work_values WHERE raw_id=NEW.raw_id)-(SELECT at FROM vane_visit_work_values WHERE raw_id=NEW.raw_id),0) END,COALESCE((SELECT new_scroll FROM vane_visit_work_values WHERE raw_id=NEW.raw_id),-1),1 WHERE 1
 ON CONFLICT(visit,context,on_page,scroll) DO UPDATE SET n=n+1;
 INSERT INTO vane_visit_page_frequencies(visit,context,on_page,scroll,n) SELECT (SELECT prev_visit FROM vane_visit_work_values WHERE raw_id=NEW.raw_id),(SELECT prev_context FROM vane_visit_work_values WHERE raw_id=NEW.raw_id),CASE WHEN (SELECT prev FROM vane_visit_work_values WHERE raw_id=NEW.raw_id) IS NOT NULL AND (SELECT at FROM vane_visit_work_values WHERE raw_id=NEW.raw_id)-(SELECT prev_at FROM vane_visit_work_values WHERE raw_id=NEW.raw_id)<=(SELECT gap FROM vane_visit_work_values WHERE raw_id=NEW.raw_id) THEN (SELECT at FROM vane_visit_work_values WHERE raw_id=NEW.raw_id)-(SELECT prev_at FROM vane_visit_work_values WHERE raw_id=NEW.raw_id) ELSE (SELECT old_on_page FROM vane_visit_work_values WHERE raw_id=NEW.raw_id) END,COALESCE((SELECT prev_scroll FROM vane_visit_work_values WHERE raw_id=NEW.raw_id),-1),1 WHERE (SELECT prev FROM vane_visit_work_values WHERE raw_id=NEW.raw_id) IS NOT NULL
 ON CONFLICT(visit,context,on_page,scroll) DO UPDATE SET n=n+1;
 UPDATE vane_visit_facts SET pages=pages+1,engaged=engaged+((SELECT new_engaged FROM vane_visit_work_values WHERE raw_id=NEW.raw_id) IS NOT NULL),
 first_on_page=CASE WHEN ((SELECT at FROM vane_visit_work_values WHERE raw_id=NEW.raw_id),(SELECT token FROM vane_visit_work_values WHERE raw_id=NEW.raw_id))<(SELECT at,token FROM vane_visit_raw WHERE raw_id=first_raw) OR pages=0 THEN CASE WHEN (SELECT next FROM vane_visit_work_values WHERE raw_id=NEW.raw_id) IS NOT NULL AND (SELECT next_at FROM vane_visit_work_values WHERE raw_id=NEW.raw_id)-(SELECT at FROM vane_visit_work_values WHERE raw_id=NEW.raw_id)<=(SELECT gap FROM vane_visit_work_values WHERE raw_id=NEW.raw_id) THEN (SELECT next_at FROM vane_visit_work_values WHERE raw_id=NEW.raw_id)-(SELECT at FROM vane_visit_work_values WHERE raw_id=NEW.raw_id) ELSE COALESCE((SELECT new_engaged FROM vane_visit_work_values WHERE raw_id=NEW.raw_id)-(SELECT at FROM vane_visit_work_values WHERE raw_id=NEW.raw_id),0) END
 WHEN first_raw=(SELECT prev FROM vane_visit_work_values WHERE raw_id=NEW.raw_id) AND (SELECT prev FROM vane_visit_work_values WHERE raw_id=NEW.raw_id) IS NOT NULL AND (SELECT at FROM vane_visit_work_values WHERE raw_id=NEW.raw_id)-(SELECT prev_at FROM vane_visit_work_values WHERE raw_id=NEW.raw_id)<=(SELECT gap FROM vane_visit_work_values WHERE raw_id=NEW.raw_id) THEN (SELECT at FROM vane_visit_work_values WHERE raw_id=NEW.raw_id)-(SELECT prev_at FROM vane_visit_work_values WHERE raw_id=NEW.raw_id) ELSE first_on_page END,
 first_raw=CASE WHEN ((SELECT at FROM vane_visit_work_values WHERE raw_id=NEW.raw_id),(SELECT token FROM vane_visit_work_values WHERE raw_id=NEW.raw_id))<(SELECT at,token FROM vane_visit_raw WHERE raw_id=first_raw) THEN NEW.raw_id ELSE first_raw END,
 last_raw=CASE WHEN ((SELECT at FROM vane_visit_work_values WHERE raw_id=NEW.raw_id),(SELECT token FROM vane_visit_work_values WHERE raw_id=NEW.raw_id))>(SELECT at,token FROM vane_visit_raw WHERE raw_id=last_raw) THEN NEW.raw_id ELSE last_raw END,
 started=MIN(started,(SELECT at FROM vane_visit_work_values WHERE raw_id=NEW.raw_id)),last_at=MAX(last_at,(SELECT at FROM vane_visit_work_values WHERE raw_id=NEW.raw_id)),last_signal=MAX(last_signal,(SELECT at FROM vane_visit_work_values WHERE raw_id=NEW.raw_id),COALESCE((SELECT new_engaged FROM vane_visit_work_values WHERE raw_id=NEW.raw_id),(SELECT at FROM vane_visit_work_values WHERE raw_id=NEW.raw_id))),identity=MAX(identity,(SELECT identity FROM vane_visit_work_values WHERE raw_id=NEW.raw_id))
 WHERE visit=(SELECT visit FROM vane_visit_work_values WHERE raw_id=NEW.raw_id);
 DELETE FROM vane_visit_work WHERE raw_id=NEW.raw_id;
END;

CREATE TRIGGER vane_visit_detail_change AFTER INSERT ON vane_visit_work WHEN NEW.action='detail' BEGIN
 UPDATE vane_visit_work SET next=(SELECT (SELECT candidate.raw_id FROM vane_raw_contexts cx JOIN vane_raw_events candidate ON candidate.raw_id=(
 SELECT x.raw_id FROM vane_raw_events x WHERE x.context=cx.context AND (x.at_offset,x.token)>(r.at_offset,r.token)
 ORDER BY x.at_offset ASC,x.token ASC LIMIT 1)
 WHERE cx.site=r.site AND cx.day=r.day AND cx.visitor=r.visitor AND cx.kind='pageview'
 ORDER BY candidate.at_offset ASC,candidate.token ASC LIMIT 1) FROM vane_visit_raw r WHERE r.raw_id=NEW.raw_id),gap=(SELECT (COALESCE((SELECT json_extract(d.value,'$.minutes') FROM vane_sites s,json_each(s.config_json,'$.definitions') d WHERE s.id=r.site_id AND json_extract(d.value,'$.metric')='visit-timeout' AND json_extract(d.value,'$.from')<=r.day ORDER BY json_extract(d.value,'$.from') DESC,CAST(d.key AS INTEGER) DESC LIMIT 1),30)*60000) FROM vane_visit_raw r WHERE r.raw_id=NEW.raw_id),visit=(SELECT visit_id FROM vane_raw_events WHERE raw_id=NEW.raw_id) WHERE raw_id=NEW.raw_id;
 UPDATE vane_visit_work SET old_on_page=CASE WHEN (SELECT next FROM vane_visit_work_values WHERE raw_id=NEW.raw_id) IS NOT NULL AND (SELECT next_at FROM vane_visit_work_values WHERE raw_id=NEW.raw_id)-(SELECT at FROM vane_visit_work_values WHERE raw_id=NEW.raw_id)<=(SELECT gap FROM vane_visit_work_values WHERE raw_id=NEW.raw_id) THEN (SELECT next_at FROM vane_visit_work_values WHERE raw_id=NEW.raw_id)-(SELECT at FROM vane_visit_work_values WHERE raw_id=NEW.raw_id) ELSE COALESCE(old_engaged-(SELECT at FROM vane_visit_work_values WHERE raw_id=NEW.raw_id),0) END WHERE raw_id=NEW.raw_id;
 UPDATE vane_visit_page_frequencies SET n=n-1 WHERE visit=(SELECT visit FROM vane_visit_work_values WHERE raw_id=NEW.raw_id) AND context=(SELECT context FROM vane_visit_work_values WHERE raw_id=NEW.raw_id) AND on_page=(SELECT old_on_page FROM vane_visit_work_values WHERE raw_id=NEW.raw_id) AND scroll=COALESCE((SELECT old_scroll FROM vane_visit_work_values WHERE raw_id=NEW.raw_id),-1) AND 1;
 DELETE FROM vane_visit_page_frequencies WHERE visit=(SELECT visit FROM vane_visit_work_values WHERE raw_id=NEW.raw_id) AND n=0;
 INSERT INTO vane_visit_page_frequencies(visit,context,on_page,scroll,n) SELECT (SELECT visit FROM vane_visit_work_values WHERE raw_id=NEW.raw_id),(SELECT context FROM vane_visit_work_values WHERE raw_id=NEW.raw_id),CASE WHEN (SELECT next FROM vane_visit_work_values WHERE raw_id=NEW.raw_id) IS NOT NULL AND (SELECT next_at FROM vane_visit_work_values WHERE raw_id=NEW.raw_id)-(SELECT at FROM vane_visit_work_values WHERE raw_id=NEW.raw_id)<=(SELECT gap FROM vane_visit_work_values WHERE raw_id=NEW.raw_id) THEN (SELECT next_at FROM vane_visit_work_values WHERE raw_id=NEW.raw_id)-(SELECT at FROM vane_visit_work_values WHERE raw_id=NEW.raw_id) ELSE COALESCE((SELECT new_engaged FROM vane_visit_work_values WHERE raw_id=NEW.raw_id)-(SELECT at FROM vane_visit_work_values WHERE raw_id=NEW.raw_id),0) END,COALESCE((SELECT new_scroll FROM vane_visit_work_values WHERE raw_id=NEW.raw_id),-1),1 WHERE 1
 ON CONFLICT(visit,context,on_page,scroll) DO UPDATE SET n=n+1;
 UPDATE vane_visit_facts SET engaged=engaged+((SELECT new_engaged FROM vane_visit_work_values WHERE raw_id=NEW.raw_id) IS NOT NULL)-((SELECT old_engaged FROM vane_visit_work_values WHERE raw_id=NEW.raw_id) IS NOT NULL),
 first_on_page=CASE WHEN first_raw=NEW.raw_id THEN CASE WHEN (SELECT next FROM vane_visit_work_values WHERE raw_id=NEW.raw_id) IS NOT NULL AND (SELECT next_at FROM vane_visit_work_values WHERE raw_id=NEW.raw_id)-(SELECT at FROM vane_visit_work_values WHERE raw_id=NEW.raw_id)<=(SELECT gap FROM vane_visit_work_values WHERE raw_id=NEW.raw_id) THEN (SELECT next_at FROM vane_visit_work_values WHERE raw_id=NEW.raw_id)-(SELECT at FROM vane_visit_work_values WHERE raw_id=NEW.raw_id) ELSE COALESCE((SELECT new_engaged FROM vane_visit_work_values WHERE raw_id=NEW.raw_id)-(SELECT at FROM vane_visit_work_values WHERE raw_id=NEW.raw_id),0) END ELSE first_on_page END,
 last_signal=CASE WHEN (SELECT old_engaged FROM vane_visit_work_values WHERE raw_id=NEW.raw_id)=last_signal AND COALESCE((SELECT new_engaged FROM vane_visit_work_values WHERE raw_id=NEW.raw_id),0)<(SELECT old_engaged FROM vane_visit_work_values WHERE raw_id=NEW.raw_id) THEN
 (SELECT MAX(MAX(r.at,COALESCE(CASE WHEN r.raw_id=NEW.raw_id THEN (SELECT new_engaged FROM vane_visit_work_values WHERE raw_id=NEW.raw_id) ELSE r.engaged_at END,r.at))) FROM vane_visit_raw r WHERE r.visit_id=vane_visit_facts.visit)
 ELSE MAX(last_signal,COALESCE((SELECT new_engaged FROM vane_visit_work_values WHERE raw_id=NEW.raw_id),(SELECT at FROM vane_visit_work_values WHERE raw_id=NEW.raw_id))) END WHERE visit=(SELECT visit FROM vane_visit_work_values WHERE raw_id=NEW.raw_id);
 DELETE FROM vane_visit_work WHERE raw_id=NEW.raw_id;
END;

CREATE TRIGGER vane_visit_raw_insert AFTER INSERT ON vane_raw_events WHEN NEW.at_offset IS NOT NULL BEGIN
 INSERT OR IGNORE INTO vane_visit_legacy(site,day,visitor) SELECT site,day,visitor FROM vane_raw_contexts WHERE context=NEW.context AND kind='pageview' AND visitor IS NOT NULL AND typeof(NEW.token)!='blob';
 INSERT OR IGNORE INTO vane_visit_dirty(site,day,visitor) SELECT c.site,c.day,c.visitor FROM vane_raw_contexts c JOIN vane_visit_legacy l USING(site,day,visitor) WHERE c.context=NEW.context AND c.kind='pageview' AND c.visitor IS NOT NULL;
 INSERT INTO vane_visit_work(raw_id,action,new_engaged,new_scroll) SELECT r.raw_id,'insert',r.engaged_at,r.scroll FROM vane_visit_raw r WHERE r.raw_id=NEW.raw_id AND r.kind='pageview' AND r.visitor IS NOT NULL
 AND NOT EXISTS(SELECT 1 FROM vane_visit_dirty d WHERE d.site=r.site AND d.day=r.day AND d.visitor=r.visitor);
END;
CREATE TRIGGER vane_visit_raw_delete BEFORE DELETE ON vane_raw_events BEGIN
 INSERT OR IGNORE INTO vane_visit_dirty(site,day,visitor) SELECT site,day,visitor FROM vane_raw_contexts WHERE context=OLD.context AND kind='pageview' AND visitor IS NOT NULL;
 DELETE FROM vane_raw_details WHERE raw_id=OLD.raw_id;
END;
CREATE TRIGGER vane_visit_raw_rewrite BEFORE UPDATE OF context,at_offset ON vane_raw_events WHEN OLD.context IS NOT NEW.context OR OLD.at_offset IS NOT NEW.at_offset BEGIN
 INSERT OR IGNORE INTO vane_visit_dirty(site,day,visitor) SELECT site,day,visitor FROM vane_raw_contexts WHERE context IN (OLD.context,NEW.context) AND kind='pageview' AND visitor IS NOT NULL;
END;
CREATE TRIGGER vane_visit_raw_rewritten AFTER UPDATE OF context,at_offset ON vane_raw_events WHEN OLD.context IS NOT NEW.context OR OLD.at_offset IS NOT NEW.at_offset BEGIN
 UPDATE vane_raw_events SET visit_id=NULL WHERE raw_id=NEW.raw_id;
END;
CREATE TRIGGER vane_visit_definitions AFTER UPDATE OF config_json ON vane_sites WHEN json_extract(OLD.config_json,'$.definitions') IS NOT json_extract(NEW.config_json,'$.definitions') BEGIN
 INSERT OR IGNORE INTO vane_visit_dirty(site,day,visitor)
 SELECT c.site,c.day,c.visitor FROM vane_raw_contexts c JOIN vane_raw_sites s ON s.site=c.site WHERE s.site_id=NEW.id AND c.kind='pageview' AND c.visitor IS NOT NULL
 AND c.day>=(SELECT MIN(json_extract(value,'$.from')) FROM (SELECT value FROM json_each(OLD.config_json,'$.definitions') WHERE value NOT IN (SELECT value FROM json_each(NEW.config_json,'$.definitions')) UNION ALL SELECT value FROM json_each(NEW.config_json,'$.definitions') WHERE value NOT IN (SELECT value FROM json_each(OLD.config_json,'$.definitions'))));
END;

CREATE TRIGGER vane_visit_rebuild_chain AFTER INSERT ON vane_visit_rebuild BEGIN
 DELETE FROM vane_visit_facts WHERE site=NEW.site AND day=NEW.day AND visitor=NEW.visitor;
 INSERT INTO vane_visit_rebuild_pages(raw_id,context,run,at,id,engaged_at,scroll,identity,on_page,first,last)
 SELECT raw_id,context,MIN(raw_id) OVER (PARTITION BY run),at,id,engaged_at,scroll,identity,
 CASE WHEN next_at IS NOT NULL AND next_at-at<=gap THEN next_at-at ELSE COALESCE(engaged_at-at,0) END,first,CASE WHEN next_at IS NULL OR next_at-at>gap THEN 1 ELSE 0 END
 FROM (SELECT *,SUM(first) OVER (ORDER BY at,id ROWS UNBOUNDED PRECEDING) AS run FROM (
 SELECT *,CASE WHEN prev_at IS NULL OR at-prev_at>gap THEN 1 ELSE 0 END AS first FROM (
 SELECT r.*,(COALESCE((SELECT json_extract(d.value,'$.minutes') FROM vane_sites s,json_each(s.config_json,'$.definitions') d WHERE s.id=r.site_id AND json_extract(d.value,'$.metric')='visit-timeout' AND json_extract(d.value,'$.from')<=r.day ORDER BY json_extract(d.value,'$.from') DESC,CAST(d.key AS INTEGER) DESC LIMIT 1),30)*60000) AS gap,LAG(at) OVER (ORDER BY at,id) AS prev_at,LEAD(at) OVER (ORDER BY at,id) AS next_at FROM vane_visit_raw r
 WHERE r.site=NEW.site AND r.day=NEW.day AND r.visitor=NEW.visitor AND r.kind='pageview' AND r.at IS NOT NULL)));
 INSERT INTO vane_visit_facts(site,day,visitor,first_raw,last_raw,started,last_at,last_signal,pages,engaged,identity,first_on_page)
 SELECT NEW.site,NEW.day,NEW.visitor,MAX(CASE WHEN first=1 THEN raw_id END),MAX(CASE WHEN last=1 THEN raw_id END),MIN(at),MAX(at),MAX(MAX(at,COALESCE(engaged_at,at))),COUNT(*),SUM(engaged_at IS NOT NULL),MAX(identity),MAX(CASE WHEN first=1 THEN on_page END)
 FROM vane_visit_rebuild_pages GROUP BY run;
 UPDATE vane_raw_events SET visit_id=(SELECT f.visit FROM vane_visit_rebuild_pages p JOIN vane_visit_rebuild_pages anchor ON anchor.run=p.run AND anchor.first=1 JOIN vane_visit_facts f ON f.first_raw=anchor.raw_id WHERE p.raw_id=vane_raw_events.raw_id)
 WHERE raw_id IN (SELECT raw_id FROM vane_visit_rebuild_pages);
 INSERT INTO vane_visit_page_frequencies(visit,context,on_page,scroll,n)
 SELECT e.visit_id,p.context,p.on_page,COALESCE(p.scroll,-1),COUNT(*) FROM vane_visit_rebuild_pages p JOIN vane_raw_events e ON e.raw_id=p.raw_id GROUP BY e.visit_id,p.context,p.on_page,COALESCE(p.scroll,-1);
 DELETE FROM vane_visit_rebuild_pages;
 DELETE FROM vane_visit_dirty WHERE site=NEW.site AND day=NEW.day AND visitor=NEW.visitor;
 DELETE FROM vane_visit_rebuild WHERE site=NEW.site AND day=NEW.day AND visitor=NEW.visitor;
END;

CREATE TRIGGER vane_visit_details_insert AFTER INSERT ON vane_raw_details BEGIN
INSERT INTO vane_visit_performance(context,metric,value,n) SELECT e.context,'lcp',NEW.lcp,1 FROM vane_raw_events e JOIN vane_raw_contexts c ON c.context=e.context WHERE e.raw_id=NEW.raw_id AND c.kind='pageview' AND NEW.lcp IS NOT NULL ON CONFLICT(context,metric,value) DO UPDATE SET n=n+1;
INSERT INTO vane_visit_performance(context,metric,value,n) SELECT e.context,'inp',NEW.inp,1 FROM vane_raw_events e JOIN vane_raw_contexts c ON c.context=e.context WHERE e.raw_id=NEW.raw_id AND c.kind='pageview' AND NEW.inp IS NOT NULL ON CONFLICT(context,metric,value) DO UPDATE SET n=n+1;
INSERT INTO vane_visit_performance(context,metric,value,n) SELECT e.context,'cls',NEW.cls,1 FROM vane_raw_events e JOIN vane_raw_contexts c ON c.context=e.context WHERE e.raw_id=NEW.raw_id AND c.kind='pageview' AND NEW.cls IS NOT NULL ON CONFLICT(context,metric,value) DO UPDATE SET n=n+1;
INSERT INTO vane_visit_performance(context,metric,value,n) SELECT e.context,'load',NEW.load_ms,1 FROM vane_raw_events e JOIN vane_raw_contexts c ON c.context=e.context WHERE e.raw_id=NEW.raw_id AND c.kind='pageview' AND NEW.load_ms IS NOT NULL ON CONFLICT(context,metric,value) DO UPDATE SET n=n+1;
INSERT INTO vane_visit_measured(context,n) SELECT e.context,1 FROM vane_raw_events e JOIN vane_raw_contexts c ON c.context=e.context WHERE e.raw_id=NEW.raw_id AND c.kind='pageview' AND (NEW.lcp IS NOT NULL OR NEW.inp IS NOT NULL OR NEW.cls IS NOT NULL OR NEW.load_ms IS NOT NULL) ON CONFLICT(context) DO UPDATE SET n=n+1;
INSERT INTO vane_visit_work(raw_id,action,old_engaged,old_scroll,new_engaged,new_scroll)
 SELECT r.raw_id,'detail',NULL,NULL,NEW.engaged_at,NEW.scroll FROM vane_visit_raw r
 WHERE r.raw_id=NEW.raw_id AND r.visit_id IS NOT NULL AND r.kind='pageview' AND r.at IS NOT NULL AND r.visitor IS NOT NULL
 AND NOT EXISTS(SELECT 1 FROM vane_visit_dirty d WHERE d.site=r.site AND d.day=r.day AND d.visitor=r.visitor)
 AND (NULL IS NOT NEW.engaged_at OR NULL IS NOT NEW.scroll);
END;

CREATE TRIGGER vane_visit_details_update AFTER UPDATE ON vane_raw_details BEGIN
UPDATE vane_visit_performance SET n=n-1 WHERE context=(SELECT context FROM vane_raw_events WHERE raw_id=OLD.raw_id) AND metric='lcp' AND value=OLD.lcp;
UPDATE vane_visit_performance SET n=n-1 WHERE context=(SELECT context FROM vane_raw_events WHERE raw_id=OLD.raw_id) AND metric='inp' AND value=OLD.inp;
UPDATE vane_visit_performance SET n=n-1 WHERE context=(SELECT context FROM vane_raw_events WHERE raw_id=OLD.raw_id) AND metric='cls' AND value=OLD.cls;
UPDATE vane_visit_performance SET n=n-1 WHERE context=(SELECT context FROM vane_raw_events WHERE raw_id=OLD.raw_id) AND metric='load' AND value=OLD.load_ms;
DELETE FROM vane_visit_performance WHERE context=(SELECT context FROM vane_raw_events WHERE raw_id=OLD.raw_id) AND n=0;
UPDATE vane_visit_measured SET n=n-1 WHERE context=(SELECT context FROM vane_raw_events WHERE raw_id=OLD.raw_id) AND (OLD.lcp IS NOT NULL OR OLD.inp IS NOT NULL OR OLD.cls IS NOT NULL OR OLD.load_ms IS NOT NULL);
DELETE FROM vane_visit_measured WHERE context=(SELECT context FROM vane_raw_events WHERE raw_id=OLD.raw_id) AND n=0;
INSERT INTO vane_visit_performance(context,metric,value,n) SELECT e.context,'lcp',NEW.lcp,1 FROM vane_raw_events e JOIN vane_raw_contexts c ON c.context=e.context WHERE e.raw_id=NEW.raw_id AND c.kind='pageview' AND NEW.lcp IS NOT NULL ON CONFLICT(context,metric,value) DO UPDATE SET n=n+1;
INSERT INTO vane_visit_performance(context,metric,value,n) SELECT e.context,'inp',NEW.inp,1 FROM vane_raw_events e JOIN vane_raw_contexts c ON c.context=e.context WHERE e.raw_id=NEW.raw_id AND c.kind='pageview' AND NEW.inp IS NOT NULL ON CONFLICT(context,metric,value) DO UPDATE SET n=n+1;
INSERT INTO vane_visit_performance(context,metric,value,n) SELECT e.context,'cls',NEW.cls,1 FROM vane_raw_events e JOIN vane_raw_contexts c ON c.context=e.context WHERE e.raw_id=NEW.raw_id AND c.kind='pageview' AND NEW.cls IS NOT NULL ON CONFLICT(context,metric,value) DO UPDATE SET n=n+1;
INSERT INTO vane_visit_performance(context,metric,value,n) SELECT e.context,'load',NEW.load_ms,1 FROM vane_raw_events e JOIN vane_raw_contexts c ON c.context=e.context WHERE e.raw_id=NEW.raw_id AND c.kind='pageview' AND NEW.load_ms IS NOT NULL ON CONFLICT(context,metric,value) DO UPDATE SET n=n+1;
INSERT INTO vane_visit_measured(context,n) SELECT e.context,1 FROM vane_raw_events e JOIN vane_raw_contexts c ON c.context=e.context WHERE e.raw_id=NEW.raw_id AND c.kind='pageview' AND (NEW.lcp IS NOT NULL OR NEW.inp IS NOT NULL OR NEW.cls IS NOT NULL OR NEW.load_ms IS NOT NULL) ON CONFLICT(context) DO UPDATE SET n=n+1;
INSERT INTO vane_visit_work(raw_id,action,old_engaged,old_scroll,new_engaged,new_scroll)
 SELECT r.raw_id,'detail',OLD.engaged_at,OLD.scroll,NEW.engaged_at,NEW.scroll FROM vane_visit_raw r
 WHERE r.raw_id=NEW.raw_id AND r.visit_id IS NOT NULL AND r.kind='pageview' AND r.at IS NOT NULL AND r.visitor IS NOT NULL
 AND NOT EXISTS(SELECT 1 FROM vane_visit_dirty d WHERE d.site=r.site AND d.day=r.day AND d.visitor=r.visitor)
 AND (OLD.engaged_at IS NOT NEW.engaged_at OR OLD.scroll IS NOT NEW.scroll);
END;

CREATE TRIGGER vane_visit_details_delete BEFORE DELETE ON vane_raw_details BEGIN
UPDATE vane_visit_performance SET n=n-1 WHERE context=(SELECT context FROM vane_raw_events WHERE raw_id=OLD.raw_id) AND metric='lcp' AND value=OLD.lcp;
UPDATE vane_visit_performance SET n=n-1 WHERE context=(SELECT context FROM vane_raw_events WHERE raw_id=OLD.raw_id) AND metric='inp' AND value=OLD.inp;
UPDATE vane_visit_performance SET n=n-1 WHERE context=(SELECT context FROM vane_raw_events WHERE raw_id=OLD.raw_id) AND metric='cls' AND value=OLD.cls;
UPDATE vane_visit_performance SET n=n-1 WHERE context=(SELECT context FROM vane_raw_events WHERE raw_id=OLD.raw_id) AND metric='load' AND value=OLD.load_ms;
DELETE FROM vane_visit_performance WHERE context=(SELECT context FROM vane_raw_events WHERE raw_id=OLD.raw_id) AND n=0;
UPDATE vane_visit_measured SET n=n-1 WHERE context=(SELECT context FROM vane_raw_events WHERE raw_id=OLD.raw_id) AND (OLD.lcp IS NOT NULL OR OLD.inp IS NOT NULL OR OLD.cls IS NOT NULL OR OLD.load_ms IS NOT NULL);
DELETE FROM vane_visit_measured WHERE context=(SELECT context FROM vane_raw_events WHERE raw_id=OLD.raw_id) AND n=0;
INSERT INTO vane_visit_work(raw_id,action,old_engaged,old_scroll,new_engaged,new_scroll)
 SELECT r.raw_id,'detail',OLD.engaged_at,OLD.scroll,NULL,NULL FROM vane_visit_raw r
 WHERE r.raw_id=OLD.raw_id AND r.visit_id IS NOT NULL AND r.kind='pageview' AND r.at IS NOT NULL AND r.visitor IS NOT NULL
 AND NOT EXISTS(SELECT 1 FROM vane_visit_dirty d WHERE d.site=r.site AND d.day=r.day AND d.visitor=r.visitor)
 AND (OLD.engaged_at IS NOT NULL OR OLD.scroll IS NOT NULL);
END;

CREATE TRIGGER vane_visit_perf_context_before BEFORE UPDATE OF context ON vane_raw_events WHEN OLD.context IS NOT NEW.context BEGIN
UPDATE vane_visit_performance SET n=n-1 WHERE context=(SELECT context FROM vane_raw_events WHERE raw_id=OLD.raw_id) AND metric='lcp' AND value=(SELECT lcp FROM vane_raw_details WHERE raw_id=OLD.raw_id);
UPDATE vane_visit_performance SET n=n-1 WHERE context=(SELECT context FROM vane_raw_events WHERE raw_id=OLD.raw_id) AND metric='inp' AND value=(SELECT inp FROM vane_raw_details WHERE raw_id=OLD.raw_id);
UPDATE vane_visit_performance SET n=n-1 WHERE context=(SELECT context FROM vane_raw_events WHERE raw_id=OLD.raw_id) AND metric='cls' AND value=(SELECT cls FROM vane_raw_details WHERE raw_id=OLD.raw_id);
UPDATE vane_visit_performance SET n=n-1 WHERE context=(SELECT context FROM vane_raw_events WHERE raw_id=OLD.raw_id) AND metric='load' AND value=(SELECT load_ms FROM vane_raw_details WHERE raw_id=OLD.raw_id);
DELETE FROM vane_visit_performance WHERE context=(SELECT context FROM vane_raw_events WHERE raw_id=OLD.raw_id) AND n=0;
UPDATE vane_visit_measured SET n=n-1 WHERE context=(SELECT context FROM vane_raw_events WHERE raw_id=OLD.raw_id) AND ((SELECT lcp FROM vane_raw_details WHERE raw_id=OLD.raw_id) IS NOT NULL OR (SELECT inp FROM vane_raw_details WHERE raw_id=OLD.raw_id) IS NOT NULL OR (SELECT cls FROM vane_raw_details WHERE raw_id=OLD.raw_id) IS NOT NULL OR (SELECT load_ms FROM vane_raw_details WHERE raw_id=OLD.raw_id) IS NOT NULL);
DELETE FROM vane_visit_measured WHERE context=(SELECT context FROM vane_raw_events WHERE raw_id=OLD.raw_id) AND n=0;
END;

CREATE TRIGGER vane_visit_perf_context_after AFTER UPDATE OF context ON vane_raw_events WHEN OLD.context IS NOT NEW.context BEGIN
INSERT INTO vane_visit_performance(context,metric,value,n) SELECT e.context,'lcp',(SELECT lcp FROM vane_raw_details WHERE raw_id=NEW.raw_id),1 FROM vane_raw_events e JOIN vane_raw_contexts c ON c.context=e.context WHERE e.raw_id=NEW.raw_id AND c.kind='pageview' AND (SELECT lcp FROM vane_raw_details WHERE raw_id=NEW.raw_id) IS NOT NULL ON CONFLICT(context,metric,value) DO UPDATE SET n=n+1;
INSERT INTO vane_visit_performance(context,metric,value,n) SELECT e.context,'inp',(SELECT inp FROM vane_raw_details WHERE raw_id=NEW.raw_id),1 FROM vane_raw_events e JOIN vane_raw_contexts c ON c.context=e.context WHERE e.raw_id=NEW.raw_id AND c.kind='pageview' AND (SELECT inp FROM vane_raw_details WHERE raw_id=NEW.raw_id) IS NOT NULL ON CONFLICT(context,metric,value) DO UPDATE SET n=n+1;
INSERT INTO vane_visit_performance(context,metric,value,n) SELECT e.context,'cls',(SELECT cls FROM vane_raw_details WHERE raw_id=NEW.raw_id),1 FROM vane_raw_events e JOIN vane_raw_contexts c ON c.context=e.context WHERE e.raw_id=NEW.raw_id AND c.kind='pageview' AND (SELECT cls FROM vane_raw_details WHERE raw_id=NEW.raw_id) IS NOT NULL ON CONFLICT(context,metric,value) DO UPDATE SET n=n+1;
INSERT INTO vane_visit_performance(context,metric,value,n) SELECT e.context,'load',(SELECT load_ms FROM vane_raw_details WHERE raw_id=NEW.raw_id),1 FROM vane_raw_events e JOIN vane_raw_contexts c ON c.context=e.context WHERE e.raw_id=NEW.raw_id AND c.kind='pageview' AND (SELECT load_ms FROM vane_raw_details WHERE raw_id=NEW.raw_id) IS NOT NULL ON CONFLICT(context,metric,value) DO UPDATE SET n=n+1;
INSERT INTO vane_visit_measured(context,n) SELECT e.context,1 FROM vane_raw_events e JOIN vane_raw_contexts c ON c.context=e.context WHERE e.raw_id=NEW.raw_id AND c.kind='pageview' AND ((SELECT lcp FROM vane_raw_details WHERE raw_id=NEW.raw_id) IS NOT NULL OR (SELECT inp FROM vane_raw_details WHERE raw_id=NEW.raw_id) IS NOT NULL OR (SELECT cls FROM vane_raw_details WHERE raw_id=NEW.raw_id) IS NOT NULL OR (SELECT load_ms FROM vane_raw_details WHERE raw_id=NEW.raw_id) IS NOT NULL) ON CONFLICT(context) DO UPDATE SET n=n+1;
END;

INSERT OR IGNORE INTO vane_visit_dirty(site,day,visitor) SELECT site,day,visitor FROM vane_raw_contexts WHERE kind='pageview' AND visitor IS NOT NULL;
INSERT OR IGNORE INTO vane_visit_legacy(site,day,visitor) SELECT c.site,c.day,c.visitor FROM vane_raw_contexts c JOIN vane_raw_events e ON e.context=c.context WHERE c.kind='pageview' AND c.visitor IS NOT NULL AND typeof(e.token)!='blob';

INSERT INTO vane_visit_performance(context,metric,value,n) SELECT e.context,'lcp',d.lcp,COUNT(*) FROM vane_raw_details d JOIN vane_raw_events e ON e.raw_id=d.raw_id JOIN vane_raw_contexts c ON c.context=e.context WHERE c.kind='pageview' AND d.lcp IS NOT NULL GROUP BY e.context,d.lcp;

INSERT INTO vane_visit_performance(context,metric,value,n) SELECT e.context,'inp',d.inp,COUNT(*) FROM vane_raw_details d JOIN vane_raw_events e ON e.raw_id=d.raw_id JOIN vane_raw_contexts c ON c.context=e.context WHERE c.kind='pageview' AND d.inp IS NOT NULL GROUP BY e.context,d.inp;

INSERT INTO vane_visit_performance(context,metric,value,n) SELECT e.context,'cls',d.cls,COUNT(*) FROM vane_raw_details d JOIN vane_raw_events e ON e.raw_id=d.raw_id JOIN vane_raw_contexts c ON c.context=e.context WHERE c.kind='pageview' AND d.cls IS NOT NULL GROUP BY e.context,d.cls;

INSERT INTO vane_visit_performance(context,metric,value,n) SELECT e.context,'load',d.load_ms,COUNT(*) FROM vane_raw_details d JOIN vane_raw_events e ON e.raw_id=d.raw_id JOIN vane_raw_contexts c ON c.context=e.context WHERE c.kind='pageview' AND d.load_ms IS NOT NULL GROUP BY e.context,d.load_ms;

INSERT INTO vane_visit_measured(context,n) SELECT e.context,COUNT(*) FROM vane_raw_details d JOIN vane_raw_events e ON e.raw_id=d.raw_id JOIN vane_raw_contexts c ON c.context=e.context WHERE c.kind='pageview' AND (d.lcp IS NOT NULL OR d.inp IS NOT NULL OR d.cls IS NOT NULL OR d.load_ms IS NOT NULL) GROUP BY e.context;

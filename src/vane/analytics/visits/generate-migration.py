"""Regenerate the additive 0087 SQL after changing this materialization schema."""
from pathlib import Path
import re

parts = []
def emit(sql): parts.append(sql.strip())

def hash_sql(value):
 return f"CASE WHEN typeof({value})='blob' THEN lower(hex({value})) ELSE {value} END"
h="lower(hex(substr(e.token,1,16)))"
logical_id=f"CASE WHEN typeof(e.token)='blob' THEN s.site_id||':'||substr({h},1,8)||'-'||substr({h},9,4)||'-'||substr({h},13,4)||'-'||substr({h},17,4)||'-'||substr({h},21,12)||CAST(substr(e.token,17) AS TEXT) ELSE e.token END"
identity=f"CASE WHEN c.consented_visitor IS NOT NULL THEN s.site_id||' c '||({hash_sql('ci.value')}) ELSE s.site_id||' d '||c.day||' '||({hash_sql('vi.value')}) END"
gap="(COALESCE((SELECT json_extract(d.value,'$.minutes') FROM vane_sites s,json_each(s.config_json,'$.definitions') d WHERE s.id=r.site_id AND json_extract(d.value,'$.metric')='visit-timeout' AND json_extract(d.value,'$.from')<=r.day ORDER BY json_extract(d.value,'$.from') DESC,CAST(d.key AS INTEGER) DESC LIMIT 1),30)*60000)"

emit('''-- COLLECT-004 exact native visit facts. Raw rows retain their own visit_id;
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
);''')
emit(f'''CREATE VIEW vane_visit_raw AS SELECT e.raw_id,e.site,e.context,e.token,e.visit_id,e.at_offset,c.day,c.kind,c.visitor,
 s.site_id,e.at_offset+unixepoch(c.day)*1000 AS at,d.engaged_at,d.scroll,{identity} AS identity,{logical_id} AS id
 FROM vane_raw_events e JOIN vane_raw_contexts c ON c.context=e.context JOIN vane_raw_sites s ON s.site=e.site
 LEFT JOIN vane_raw_details d ON d.raw_id=e.raw_id LEFT JOIN vane_raw_identities vi ON vi.identity=c.visitor LEFT JOIN vane_raw_identities ci ON ci.identity=c.consented_visitor;''')
emit('''CREATE VIEW vane_visit_work_values AS SELECT w.*,r.site,r.context,r.day,r.visitor,r.at,r.at_offset,r.token,r.identity,
 p.at AS prev_at,p.context AS prev_context,p.engaged_at AS prev_engaged,p.scroll AS prev_scroll,p.visit_id AS prev_visit,
 n.at AS next_at,n.visit_id AS next_visit
 FROM vane_visit_work w JOIN vane_visit_raw r ON r.raw_id=w.raw_id LEFT JOIN vane_visit_raw p ON p.raw_id=w.prev LEFT JOIN vane_visit_raw n ON n.raw_id=w.next;''')

# A fact update removes its old contribution then adds its new contribution.
def fact_remove(prefix):
 return f'''UPDATE vane_visit_duration_frequencies SET n=n-1 WHERE site={prefix}.site AND day={prefix}.day AND duration={prefix}.last_signal-{prefix}.started AND {prefix}.pages>0;
 DELETE FROM vane_visit_duration_frequencies WHERE site={prefix}.site AND day={prefix}.day AND n=0;
 UPDATE vane_visit_days SET visits=visits-1,pageviews=pageviews-{prefix}.pages,bounces=bounces-({prefix}.pages=1 AND {prefix}.engaged=0),duration_sum=duration_sum-({prefix}.last_signal-{prefix}.started) WHERE site={prefix}.site AND day={prefix}.day AND {prefix}.pages>0;
 DELETE FROM vane_visit_days WHERE site={prefix}.site AND day={prefix}.day AND visits=0;'''
def fact_add(prefix):
 return f'''INSERT INTO vane_visit_duration_frequencies(site,day,duration,n) SELECT {prefix}.site,{prefix}.day,{prefix}.last_signal-{prefix}.started,1 WHERE {prefix}.pages>0
 ON CONFLICT(site,day,duration) DO UPDATE SET n=n+1;
 INSERT INTO vane_visit_days(site,day,visits,pageviews,bounces,duration_sum) SELECT {prefix}.site,{prefix}.day,1,{prefix}.pages,({prefix}.pages=1 AND {prefix}.engaged=0),{prefix}.last_signal-{prefix}.started WHERE {prefix}.pages>0
 ON CONFLICT(site,day) DO UPDATE SET visits=visits+1,pageviews=pageviews+excluded.pageviews,bounces=bounces+excluded.bounces,duration_sum=duration_sum+excluded.duration_sum;'''
for action, body in [('INSERT',fact_add('NEW')),('UPDATE',fact_remove('OLD')+'\n'+fact_add('NEW')),('DELETE',fact_remove('OLD'))]:
 emit(f'CREATE TRIGGER vane_visit_facts_{action.lower()} AFTER {action} ON vane_visit_facts BEGIN\n{body}\nEND;')

def neighbor(sign):
 cmp,order=('<','DESC') if sign<0 else ('>','ASC')
 return f'''(SELECT candidate.raw_id FROM vane_raw_contexts cx JOIN vane_raw_events candidate ON candidate.raw_id=(
 SELECT x.raw_id FROM vane_raw_events x WHERE x.context=cx.context AND (x.at_offset,x.token){cmp}(r.at_offset,r.token)
 ORDER BY x.at_offset {order},x.token {order} LIMIT 1)
 WHERE cx.site=r.site AND cx.day=r.day AND cx.visitor=r.visitor AND cx.kind='pageview'
 ORDER BY candidate.at_offset {order},candidate.token {order} LIMIT 1)'''
# Scalar work access remains current after updates to the queue row.
def w(col): return f'(SELECT {col} FROM vane_visit_work_values WHERE raw_id=NEW.raw_id)'
def freq_remove(visit,context,onpage,scroll,condition='1'):
 return f'''UPDATE vane_visit_page_frequencies SET n=n-1 WHERE visit={visit} AND context={context} AND on_page={onpage} AND scroll=COALESCE({scroll},-1) AND {condition};
 DELETE FROM vane_visit_page_frequencies WHERE visit={visit} AND n=0;'''
def freq_add(visit,context,onpage,scroll,condition='1'):
 return f'''INSERT INTO vane_visit_page_frequencies(visit,context,on_page,scroll,n) SELECT {visit},{context},{onpage},COALESCE({scroll},-1),1 WHERE {condition}
 ON CONFLICT(visit,context,on_page,scroll) DO UPDATE SET n=n+1;'''
connected_prev=f"{w('prev')} IS NOT NULL AND {w('at')}-{w('prev_at')}<={w('gap')}"
connected_next=f"{w('next')} IS NOT NULL AND {w('next_at')}-{w('at')}<={w('gap')}"
new_onpage=f"CASE WHEN {connected_next} THEN {w('next_at')}-{w('at')} ELSE COALESCE({w('new_engaged')}-{w('at')},0) END"
merge=f"{w('left_visit')} IS NOT NULL AND {w('right_visit')} IS NOT NULL AND {w('left_visit')}!={w('right_visit')}"
emit(f'''CREATE TRIGGER vane_visit_append AFTER INSERT ON vane_visit_work WHEN NEW.action='insert' BEGIN
 UPDATE vane_visit_work SET prev={neighbor(-1)},next={neighbor(1)},gap={gap} FROM vane_visit_raw r WHERE vane_visit_work.raw_id=NEW.raw_id AND r.raw_id=NEW.raw_id;
 UPDATE vane_visit_work SET left_visit=CASE WHEN {connected_prev} THEN {w('prev_visit')} END,right_visit=CASE WHEN {connected_next} THEN {w('next_visit')} END,
 old_on_page=CASE WHEN {w('prev')} IS NOT NULL AND {w('next')} IS NOT NULL AND {w('next_at')}-{w('prev_at')}<={w('gap')} THEN {w('next_at')}-{w('prev_at')} ELSE COALESCE({w('prev_engaged')}-{w('prev_at')},0) END WHERE raw_id=NEW.raw_id;
 {freq_remove(w('prev_visit'),w('prev_context'),w('old_on_page'),w('prev_scroll'),w('prev')+' IS NOT NULL')}
 INSERT INTO vane_visit_page_frequencies(visit,context,on_page,scroll,n)
 SELECT {w('left_visit')},context,on_page,scroll,n FROM vane_visit_page_frequencies WHERE visit={w('right_visit')} AND {merge}
 ON CONFLICT(visit,context,on_page,scroll) DO UPDATE SET n=n+excluded.n;
 UPDATE vane_visit_facts SET pages=pages+(SELECT pages FROM vane_visit_facts WHERE visit={w('right_visit')}),
 engaged=engaged+(SELECT engaged FROM vane_visit_facts WHERE visit={w('right_visit')}),
 last_at=(SELECT last_at FROM vane_visit_facts WHERE visit={w('right_visit')}),last_raw=(SELECT last_raw FROM vane_visit_facts WHERE visit={w('right_visit')}),
 last_signal=MAX(last_signal,(SELECT last_signal FROM vane_visit_facts WHERE visit={w('right_visit')})),identity=MAX(identity,(SELECT identity FROM vane_visit_facts WHERE visit={w('right_visit')}))
 WHERE visit={w('left_visit')} AND {merge};
 UPDATE vane_raw_events SET visit_id={w('left_visit')} WHERE visit_id={w('right_visit')} AND {merge};
 DELETE FROM vane_visit_facts WHERE visit={w('right_visit')} AND {merge};
 INSERT INTO vane_visit_facts(site,day,visitor,first_raw,last_raw,started,last_at,last_signal,pages,engaged,identity,first_on_page)
 SELECT site,day,visitor,raw_id,raw_id,at,at,at,0,0,identity,0 FROM vane_visit_work_values WHERE raw_id=NEW.raw_id AND left_visit IS NULL AND right_visit IS NULL;
 UPDATE vane_visit_work SET visit=COALESCE(left_visit,right_visit,last_insert_rowid()) WHERE raw_id=NEW.raw_id;
 UPDATE vane_raw_events SET visit_id={w('visit')} WHERE raw_id=NEW.raw_id;
 {freq_add(w('visit'),w('context'),new_onpage,w('new_scroll'))}
 {freq_add(w('prev_visit'),w('prev_context'),f"CASE WHEN {connected_prev} THEN {w('at')}-{w('prev_at')} ELSE {w('old_on_page')} END",w('prev_scroll'),w('prev')+' IS NOT NULL')}
 UPDATE vane_visit_facts SET pages=pages+1,engaged=engaged+({w('new_engaged')} IS NOT NULL),
 first_on_page=CASE WHEN ({w('at')},{w('token')})<(SELECT at,token FROM vane_visit_raw WHERE raw_id=first_raw) OR pages=0 THEN {new_onpage}
 WHEN first_raw={w('prev')} AND {connected_prev} THEN {w('at')}-{w('prev_at')} ELSE first_on_page END,
 first_raw=CASE WHEN ({w('at')},{w('token')})<(SELECT at,token FROM vane_visit_raw WHERE raw_id=first_raw) THEN NEW.raw_id ELSE first_raw END,
 last_raw=CASE WHEN ({w('at')},{w('token')})>(SELECT at,token FROM vane_visit_raw WHERE raw_id=last_raw) THEN NEW.raw_id ELSE last_raw END,
 started=MIN(started,{w('at')}),last_at=MAX(last_at,{w('at')}),last_signal=MAX(last_signal,{w('at')},COALESCE({w('new_engaged')},{w('at')})),identity=MAX(identity,{w('identity')})
 WHERE visit={w('visit')};
 DELETE FROM vane_visit_work WHERE raw_id=NEW.raw_id;
END;''')
# SQLite disallows UPDATE FROM in some older edge builds: keep all joins scalar.
parts[-1]=parts[-1].replace(f"UPDATE vane_visit_work SET prev={neighbor(-1)},next={neighbor(1)},gap={gap} FROM vane_visit_raw r WHERE vane_visit_work.raw_id=NEW.raw_id AND r.raw_id=NEW.raw_id;",f"UPDATE vane_visit_work SET prev=(SELECT {neighbor(-1)} FROM vane_visit_raw r WHERE r.raw_id=NEW.raw_id),next=(SELECT {neighbor(1)} FROM vane_visit_raw r WHERE r.raw_id=NEW.raw_id),gap=(SELECT {gap} FROM vane_visit_raw r WHERE r.raw_id=NEW.raw_id) WHERE raw_id=NEW.raw_id;")

emit(f'''CREATE TRIGGER vane_visit_detail_change AFTER INSERT ON vane_visit_work WHEN NEW.action='detail' BEGIN
 UPDATE vane_visit_work SET next=(SELECT {neighbor(1)} FROM vane_visit_raw r WHERE r.raw_id=NEW.raw_id),gap=(SELECT {gap} FROM vane_visit_raw r WHERE r.raw_id=NEW.raw_id),visit=(SELECT visit_id FROM vane_raw_events WHERE raw_id=NEW.raw_id) WHERE raw_id=NEW.raw_id;
 UPDATE vane_visit_work SET old_on_page=CASE WHEN {connected_next} THEN {w('next_at')}-{w('at')} ELSE COALESCE(old_engaged-{w('at')},0) END WHERE raw_id=NEW.raw_id;
 {freq_remove(w('visit'),w('context'),w('old_on_page'),w('old_scroll'))}
 {freq_add(w('visit'),w('context'),new_onpage,w('new_scroll'))}
 UPDATE vane_visit_facts SET engaged=engaged+({w('new_engaged')} IS NOT NULL)-({w('old_engaged')} IS NOT NULL),
 first_on_page=CASE WHEN first_raw=NEW.raw_id THEN {new_onpage} ELSE first_on_page END,
 last_signal=CASE WHEN {w('old_engaged')}=last_signal AND COALESCE({w('new_engaged')},0)<{w('old_engaged')} THEN
 (SELECT MAX(MAX(r.at,COALESCE(CASE WHEN r.raw_id=NEW.raw_id THEN {w('new_engaged')} ELSE r.engaged_at END,r.at))) FROM vane_visit_raw r WHERE r.visit_id=vane_visit_facts.visit)
 ELSE MAX(last_signal,COALESCE({w('new_engaged')},{w('at')})) END WHERE visit={w('visit')};
 DELETE FROM vane_visit_work WHERE raw_id=NEW.raw_id;
END;''')

# Insert classification is cheap unless a prior exceptional mutation invalidated
# this chain. Legacy TEXT identifiers use their original logical order on rebuild.
emit('''CREATE TRIGGER vane_visit_raw_insert AFTER INSERT ON vane_raw_events WHEN NEW.at_offset IS NOT NULL BEGIN
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
END;''')

# Rebuild one dirty chain in a transaction. This is never the append/tie path.
emit(f'''CREATE TRIGGER vane_visit_rebuild_chain AFTER INSERT ON vane_visit_rebuild BEGIN
 DELETE FROM vane_visit_facts WHERE site=NEW.site AND day=NEW.day AND visitor=NEW.visitor;
 INSERT INTO vane_visit_rebuild_pages(raw_id,context,run,at,id,engaged_at,scroll,identity,on_page,first,last)
 SELECT raw_id,context,MIN(raw_id) OVER (PARTITION BY run),at,id,engaged_at,scroll,identity,
 CASE WHEN next_at IS NOT NULL AND next_at-at<=gap THEN next_at-at ELSE COALESCE(engaged_at-at,0) END,first,CASE WHEN next_at IS NULL OR next_at-at>gap THEN 1 ELSE 0 END
 FROM (SELECT *,SUM(first) OVER (ORDER BY at,id ROWS UNBOUNDED PRECEDING) AS run FROM (
 SELECT *,CASE WHEN prev_at IS NULL OR at-prev_at>gap THEN 1 ELSE 0 END AS first FROM (
 SELECT r.*,{gap} AS gap,LAG(at) OVER (ORDER BY at,id) AS prev_at,LEAD(at) OVER (ORDER BY at,id) AS next_at FROM vane_visit_raw r
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
END;''')

# Performance populations are independent of visit timeout and membership.
fields={'lcp':'lcp','inp':'inp','cls':'cls','load_ms':'load'}
def perf_remove(prefix):
 sql=[]
 for col,metric in fields.items():
  sql.append(f"UPDATE vane_visit_performance SET n=n-1 WHERE context=(SELECT context FROM vane_raw_events WHERE raw_id={prefix}.raw_id) AND metric='{metric}' AND value={prefix}.{col};")
 sql.append(f"DELETE FROM vane_visit_performance WHERE context=(SELECT context FROM vane_raw_events WHERE raw_id={prefix}.raw_id) AND n=0;")
 condition=' OR '.join(f'{prefix}.{col} IS NOT NULL' for col in fields)
 sql.append(f"UPDATE vane_visit_measured SET n=n-1 WHERE context=(SELECT context FROM vane_raw_events WHERE raw_id={prefix}.raw_id) AND ({condition});")
 sql.append(f"DELETE FROM vane_visit_measured WHERE context=(SELECT context FROM vane_raw_events WHERE raw_id={prefix}.raw_id) AND n=0;")
 return '\n'.join(sql)
def perf_add(prefix):
 sql=[]
 for col,metric in fields.items():
  sql.append(f"INSERT INTO vane_visit_performance(context,metric,value,n) SELECT e.context,'{metric}',{prefix}.{col},1 FROM vane_raw_events e JOIN vane_raw_contexts c ON c.context=e.context WHERE e.raw_id={prefix}.raw_id AND c.kind='pageview' AND {prefix}.{col} IS NOT NULL ON CONFLICT(context,metric,value) DO UPDATE SET n=n+1;")
 condition=' OR '.join(f'{prefix}.{col} IS NOT NULL' for col in fields)
 sql.append(f"INSERT INTO vane_visit_measured(context,n) SELECT e.context,1 FROM vane_raw_events e JOIN vane_raw_contexts c ON c.context=e.context WHERE e.raw_id={prefix}.raw_id AND c.kind='pageview' AND ({condition}) ON CONFLICT(context) DO UPDATE SET n=n+1;")
 return '\n'.join(sql)
def detail_work(action):
 old='OLD' if action!='INSERT' else None
 new='NEW' if action!='DELETE' else None
 raw=(new or old)+'.raw_id'
 value=lambda p,c: p+'.'+c if p else 'NULL'
 return f"""INSERT INTO vane_visit_work(raw_id,action,old_engaged,old_scroll,new_engaged,new_scroll)
 SELECT r.raw_id,'detail',{value(old,'engaged_at')},{value(old,'scroll')},{value(new,'engaged_at')},{value(new,'scroll')} FROM vane_visit_raw r
 WHERE r.raw_id={raw} AND r.visit_id IS NOT NULL AND r.kind='pageview' AND r.at IS NOT NULL AND r.visitor IS NOT NULL
 AND NOT EXISTS(SELECT 1 FROM vane_visit_dirty d WHERE d.site=r.site AND d.day=r.day AND d.visitor=r.visitor)
 AND ({value(old,'engaged_at')} IS NOT {value(new,'engaged_at')} OR {value(old,'scroll')} IS NOT {value(new,'scroll')});"""
for action in ['INSERT','UPDATE','DELETE']:
 timing='BEFORE' if action=='DELETE' else 'AFTER'
 body=(perf_remove('OLD')+'\n' if action!='INSERT' else '')+(perf_add('NEW')+'\n' if action!='DELETE' else '')+detail_work(action)
 emit(f'CREATE TRIGGER vane_visit_details_{action.lower()} {timing} {action} ON vane_raw_details BEGIN\n{body}\nEND;')
# On a context move, old values must leave the old performance population before
# raw-context GC runs; new values are added using NEW.context afterwards.
emit('''CREATE TRIGGER vane_visit_perf_context_before BEFORE UPDATE OF context ON vane_raw_events WHEN OLD.context IS NOT NEW.context BEGIN
'''+perf_remove('OLD').replace('OLD.lcp','(SELECT lcp FROM vane_raw_details WHERE raw_id=OLD.raw_id)').replace('OLD.inp','(SELECT inp FROM vane_raw_details WHERE raw_id=OLD.raw_id)').replace('OLD.cls','(SELECT cls FROM vane_raw_details WHERE raw_id=OLD.raw_id)').replace('OLD.load_ms','(SELECT load_ms FROM vane_raw_details WHERE raw_id=OLD.raw_id)')+'''
END;''')
emit('''CREATE TRIGGER vane_visit_perf_context_after AFTER UPDATE OF context ON vane_raw_events WHEN OLD.context IS NOT NEW.context BEGIN
'''+perf_add('NEW').replace('NEW.lcp','(SELECT lcp FROM vane_raw_details WHERE raw_id=NEW.raw_id)').replace('NEW.inp','(SELECT inp FROM vane_raw_details WHERE raw_id=NEW.raw_id)').replace('NEW.cls','(SELECT cls FROM vane_raw_details WHERE raw_id=NEW.raw_id)').replace('NEW.load_ms','(SELECT load_ms FROM vane_raw_details WHERE raw_id=NEW.raw_id)')+'''
END;''')
# Initial history is queued, not silently omitted. Performance can aggregate all
# existing detail rows in one pass while migration holds the transaction.
emit('''INSERT OR IGNORE INTO vane_visit_dirty(site,day,visitor) SELECT site,day,visitor FROM vane_raw_contexts WHERE kind='pageview' AND visitor IS NOT NULL;
INSERT OR IGNORE INTO vane_visit_legacy(site,day,visitor) SELECT c.site,c.day,c.visitor FROM vane_raw_contexts c JOIN vane_raw_events e ON e.context=c.context WHERE c.kind='pageview' AND c.visitor IS NOT NULL AND typeof(e.token)!='blob';''')
for col,metric in fields.items():
 emit(f"INSERT INTO vane_visit_performance(context,metric,value,n) SELECT e.context,'{metric}',d.{col},COUNT(*) FROM vane_raw_details d JOIN vane_raw_events e ON e.raw_id=d.raw_id JOIN vane_raw_contexts c ON c.context=e.context WHERE c.kind='pageview' AND d.{col} IS NOT NULL GROUP BY e.context,d.{col};")
emit("INSERT INTO vane_visit_measured(context,n) SELECT e.context,COUNT(*) FROM vane_raw_details d JOIN vane_raw_events e ON e.raw_id=d.raw_id JOIN vane_raw_contexts c ON c.context=e.context WHERE c.kind='pageview' AND (d.lcp IS NOT NULL OR d.inp IS NOT NULL OR d.cls IS NOT NULL OR d.load_ms IS NOT NULL) GROUP BY e.context;")
root=Path(__file__).resolve().parents[4]
(root/'migrations/core/0087_visit_facts.sql').write_text(re.sub(r'\b(CASE|END)\b',r' \1 ','\n\n'.join(parts))+'\n')

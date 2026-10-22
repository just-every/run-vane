// Source for 0086. Regenerate the checked-in SQL after changing this module.
import { RAW_COLUMNS, DETAIL_COLUMNS, contextColumns, contextValuesSql, contextMatchSql, packedHashSql, packedIdSql, rawSelectSql } from './schema.ts'
import { analyticalTriggers } from './triggers.ts'
const values=contextValuesSql('NEW.'),context=`(SELECT context FROM vane_raw_contexts WHERE ${contextMatchSql(values)})`
const key=(prefix:string)=>`site=(SELECT site FROM vane_raw_sites WHERE site_id=${prefix}site_id) AND token=${packedIdSql(prefix+'id',prefix+'site_id')}`
const absent=`NOT EXISTS(SELECT 1 FROM vane_raw_events WHERE ${key('NEW.')})`
const normalization=(gate:string)=>`INSERT OR IGNORE INTO vane_raw_sites(site_id) SELECT NEW.site_id WHERE ${gate};
 INSERT OR IGNORE INTO vane_raw_identities(value) SELECT ${packedHashSql('NEW.visitor')} WHERE NEW.visitor IS NOT NULL AND ${gate};
 INSERT OR IGNORE INTO vane_raw_identities(value) SELECT ${packedHashSql('NEW.consented_visitor')} WHERE NEW.consented_visitor IS NOT NULL AND ${gate};
 INSERT OR IGNORE INTO vane_raw_contexts(${contextColumns}) SELECT ${values.join(',')} WHERE ${gate};`
const detail=(lookup:string,gate='1')=>`INSERT INTO vane_raw_details(raw_id,${DETAIL_COLUMNS.join(',')})
 SELECT ${lookup},${DETAIL_COLUMNS.map(name=>'NEW.'+name).join(',')} WHERE (${gate}) AND (${DETAIL_COLUMNS.map(name=>'NEW.'+name+' IS NOT NULL').join(' OR ')})
 ON CONFLICT(raw_id) DO UPDATE SET ${DETAIL_COLUMNS.map(name=>name+'=excluded.'+name).join(',')};`
export const compactRawMigration=`-- Lossless native rows. Every accepted occurrence remains an individual row.
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
CREATE VIEW vane_events AS ${rawSelectSql};
CREATE TRIGGER vane_raw_insert INSTEAD OF INSERT ON vane_events BEGIN
 ${normalization(absent)}
 INSERT INTO vane_raw_events(site,token,context,at_offset)
 VALUES((SELECT site FROM vane_raw_sites WHERE site_id=NEW.site_id),${packedIdSql('NEW.id','NEW.site_id')},${context},NEW.at-coalesce(unixepoch(NEW.day)*1000,0));
 ${detail(`(SELECT raw_id FROM vane_raw_events WHERE ${key('NEW.')})`,'changes()>0')}
END;
CREATE TRIGGER vane_raw_update INSTEAD OF UPDATE ON vane_events BEGIN
 ${normalization('1')}
 UPDATE vane_raw_events SET site=(SELECT site FROM vane_raw_sites WHERE site_id=NEW.site_id),token=${packedIdSql('NEW.id','NEW.site_id')},context=${context},at_offset=NEW.at-coalesce(unixepoch(NEW.day)*1000,0) WHERE raw_id=OLD._raw_id;
 ${detail('OLD._raw_id')}
 DELETE FROM vane_raw_details WHERE raw_id=OLD._raw_id AND ${DETAIL_COLUMNS.map(name=>'NEW.'+name+' IS NULL').join(' AND ')};
END;
CREATE TRIGGER vane_raw_delete INSTEAD OF DELETE ON vane_events BEGIN
 DELETE FROM vane_raw_events WHERE raw_id=OLD._raw_id;
END;
-- Keep complete logical values while upgrading pre-existing installations.
INSERT INTO vane_events(${RAW_COLUMNS.join(',')}) SELECT ${RAW_COLUMNS.join(',')} FROM vane_raw_previous;
DROP TABLE vane_raw_previous;
-- 0085 already materialized these exact occurrences. Triggers start only after
-- the migration copy, so the copy cannot double count them.
${analyticalTriggers}
CREATE TRIGGER vane_raw_context_gc AFTER DELETE ON vane_raw_contexts BEGIN
 DELETE FROM vane_raw_identities WHERE identity IN (OLD.visitor,OLD.consented_visitor)
 AND NOT EXISTS(SELECT 1 FROM vane_raw_contexts WHERE visitor=identity OR consented_visitor=identity);
 DELETE FROM vane_raw_sites WHERE site=OLD.site AND NOT EXISTS(SELECT 1 FROM vane_raw_contexts WHERE site=OLD.site) AND NOT EXISTS(SELECT 1 FROM vane_raw_events WHERE site=OLD.site);
END;
`

import { site, statement, uid, VaneError, type Env } from '../core'
import { encodeRawId, rawInsertManyStatement, rawNormalizeManyGroupsStatement, rawNormalizeStatements, type RawRecord } from '../raw'
import { RAW_DIMENSIONS } from '../raw/schema'
import { bulkOccurrences } from '../analytics/bulk'
import { beginBulkVisits, finishBulkVisits } from '../analytics/visits/bulk'
import { collectionContext, type PreparedPageview } from './context'
import { existingPageviews } from './existing'
import { IndexedCollectionError } from './error'
import { pageviewRecord, goalRecords } from './records'
import { samePageview, type ValidatedPageview } from './validation'

export interface PageviewResult { accepted: true; duplicate?: true; experiments?: Record<string, string>; status: 200 | 202 }
function conflict() { return new VaneError('conflict', 'Event ID already has different data.', 409) }

// All record validation precedes this function. Dictionary interning, actual
// insertion decisions, child rows and counters share the same transaction.
export async function admitPageviews(request: Request, env: Env, validated: ValidatedPageview[]): Promise<PageviewResult[]> {
 const existing = await existingPageviews(env, validated), seen = new Map<string, ValidatedPageview>()
 for (let index = 0; index < validated.length; index++) {
  const plan = validated[index]!, prior = existing.get(plan.eventId) ?? seen.get(plan.eventId)?.event
  if (prior && !samePageview(prior, plan)) throw new IndexedCollectionError(conflict(), index)
  seen.set(plan.eventId, plan)
 }
 const context = collectionContext(request, env), prepared: PreparedPageview[] = [], observed = new Set<string>()
 for (const plan of validated) {
  prepared.push(await context.resolve(plan, !existing.has(plan.eventId) && !observed.has(plan.eventId)))
  observed.add(plan.eventId)
 }
 const batchId = uid(), statements: D1PreparedStatement[] = [statement(env, 'DELETE FROM vane_guard')]
 const pages = prepared.map(plan => pageviewRecord(request, plan)), contexts = new Map<string, { record: RawRecord; ids: Set<string> }>()
 for (const page of pages) {
  // Exactly the values interned by raw/store.ts: no assumed similarity based
  // on batch position, event count, path alone, or a scale fixture.
  const key = JSON.stringify([page.site_id, page.day, page.kind, RAW_DIMENSIONS.map(name => page[name] ?? null), page.visitor ?? null,
   page.consented_visitor ?? null, page.consented_created_at ?? null, page.consented_expires_at ?? null])
  let group = contexts.get(key)
  if (!group) { group = { record: page, ids: new Set() }; contexts.set(key, group) }
  group.ids.add(page.id)
 }
 for (const { record, ids } of contexts.values()) {
  const tokens = [...ids].map(id => {
   const token = encodeRawId(record.site_id, id)
   return typeof token === 'string' ? ['text', token] : ['blob', Array.from(new Uint8Array(token), byte => byte.toString(16).padStart(2, '0')).join('')]
  })
  // Bind the actual IDs as one bounded JSON set, keeping D1's parameter count
  // small even for 100 members. Every lookup uses the physical (site,token)
  // index. A first member that won a race cannot suppress another new member's
  // required context, and an entirely duplicated group interns nothing.
  const when = { sql: `EXISTS(SELECT 1 FROM json_each(?) wanted WHERE NOT EXISTS(
   SELECT 1 FROM vane_raw_events WHERE site=(SELECT site FROM vane_raw_sites WHERE site_id=?) AND token=
   CASE WHEN json_extract(wanted.value,'$[0]')='blob' THEN unhex(json_extract(wanted.value,'$[1]')) ELSE json_extract(wanted.value,'$[1]') END))`, values: [JSON.stringify(tokens), record.site_id] }
  statements.push(...rawNormalizeStatements(env, record, when))
 }
 // A single transaction guard rechecks every site version and existing ID.
 // Read the indexed physical row and only the three conflict dimensions rather
 // than expanding the compatibility view for each input.
 const checks = JSON.stringify(prepared.map(plan => {
  const token = encodeRawId(plan.value.id, plan.eventId)
  return { site: plan.value.id, version: plan.value.version, id: plan.eventId,
   token: typeof token === 'string' ? ['text', token] : ['blob', Array.from(new Uint8Array(token), byte => byte.toString(16).padStart(2, '0')).join('')],
   path: plan.event.path, source: plan.event.source, campaign: plan.event.campaign, payment: plan.payment ? 1 : 0 }
 }))
 const tokenSql = "CASE WHEN json_extract(row.value,'$.token[0]')='blob' THEN unhex(json_extract(row.value,'$.token[1]')) ELSE json_extract(row.value,'$.token[1]') END"
 const physicalSite = "(SELECT site FROM vane_raw_sites WHERE site_id=json_extract(row.value,'$.site'))"
 statements.push(statement(env, `INSERT INTO vane_guard(value) SELECT CASE WHEN NOT EXISTS(
  SELECT 1 FROM json_each(?) row WHERE NOT EXISTS(
   SELECT 1 FROM vane_sites WHERE id=json_extract(row.value,'$.site') AND version=json_extract(row.value,'$.version')
  ) OR EXISTS(SELECT 1 FROM vane_raw_events e JOIN vane_raw_contexts c ON c.context=e.context
   WHERE e.site=${physicalSite} AND e.token=${tokenSql} AND NOT(
    json_extract(c.dimensions,'$[0]')=json_extract(row.value,'$.path') AND
    (json_extract(row.value,'$.payment') OR json_extract(c.dimensions,'$[1]')=json_extract(row.value,'$.source')) AND
    json_extract(c.dimensions,'$[2]')=json_extract(row.value,'$.campaign')))
 ) THEN 1 ELSE 0 END`, checks))
 // Reserve only absent physical IDs, with the first input winning duplicates.
 // These scratch rows and the physical INSERT are in the same D1 transaction;
 // no concurrent admission can intervene. The immediate count guard turns any
 // ignored insertion into rollback before goals, properties, or counters run.
 statements.push(statement(env, `INSERT INTO vane_collection_batch_admitted(batch_id,record_index,record_id)
  SELECT ?,MIN(CAST(row.key AS INTEGER)),json_extract(row.value,'$.id') FROM json_each(?) row
  WHERE NOT EXISTS(SELECT 1 FROM vane_raw_events WHERE site=${physicalSite} AND token=${tokenSql})
  GROUP BY json_extract(row.value,'$.site'),${tokenSql}`, batchId, checks))
 statements.push(...beginBulkVisits(env))
 statements.push(rawNormalizeManyGroupsStatement(env, pages, {
  sql: 'EXISTS(SELECT 1 FROM vane_collection_batch_admitted WHERE batch_id=? AND record_index=CAST(row.key AS INTEGER))', values: [batchId],
 }))
 statements.push(rawInsertManyStatement(env, pages, {
  sql: 'EXISTS(SELECT 1 FROM vane_collection_batch_admitted WHERE batch_id=? AND record_index=CAST(row.key AS INTEGER))', values: [batchId],
 }))
 statements.push(statement(env, `INSERT INTO vane_guard(value)
  SELECT CASE WHEN changes()=(SELECT COUNT(*) FROM vane_collection_batch_admitted WHERE batch_id=?) THEN 1 ELSE 0 END`, batchId))
 statements.push(...bulkOccurrences(env), ...finishBulkVisits(env))
 const goals = prepared.flatMap((plan, index) => goalRecords(pages[index]!, plan).map(record => ({ index, record })))
 if (goals.length) {
  const columns = Object.keys(goals[0]!.record), values = goals.map(({ index, record }) => [...columns.map(column => record[column as keyof RawRecord] ?? null), index])
  statements.push(statement(env, `INSERT OR IGNORE INTO vane_events(${columns.join(',')})
   SELECT ${columns.map((_, i) => `json_extract(row.value,'$[${i}]')`).join(',')} FROM json_each(?) row
   JOIN vane_collection_batch_admitted a ON a.batch_id=? AND a.record_index=json_extract(row.value,'$[${columns.length}]')`, JSON.stringify(values), batchId))
 }
 const metadata = JSON.stringify(prepared.map((plan, index) => ({ index, site: plan.value.id, day: plan.today, dropped: plan.props.dropped })))
 const admitted = `FROM json_each(?) row JOIN vane_collection_batch_admitted a ON a.batch_id=? AND a.record_index=json_extract(row.value,'$.index')`
 statements.push(statement(env, `INSERT INTO vane_admission(site_id,day,count)
  SELECT json_extract(row.value,'$.site'),json_extract(row.value,'$.day'),COUNT(*) ${admitted} WHERE 1 GROUP BY 1,2
  ON CONFLICT(site_id,day) DO UPDATE SET count=count+excluded.count`, metadata, batchId))
 const properties = prepared.flatMap((plan, index) => plan.props.kept.map(([key, value]) => ({ index, id: plan.eventId, site: plan.value.id, day: plan.today, key, value })))
 if (properties.length) statements.push(statement(env, `INSERT OR IGNORE INTO vane_event_props(event_id,site_id,day,key,value)
  SELECT json_extract(row.value,'$.id'),json_extract(row.value,'$.site'),json_extract(row.value,'$.day'),json_extract(row.value,'$.key'),json_extract(row.value,'$.value')
  ${admitted}`, JSON.stringify(properties), batchId))
 if (prepared.some(plan => plan.props.dropped)) statements.push(statement(env, `INSERT INTO vane_exclusions(site_id,day,reason,count)
  SELECT json_extract(row.value,'$.site'),json_extract(row.value,'$.day'),'dropped-property',SUM(json_extract(row.value,'$.dropped'))
  ${admitted} WHERE json_extract(row.value,'$.dropped')>0 GROUP BY 1,2
  ON CONFLICT(site_id,day,reason) DO UPDATE SET count=count+excluded.count`, metadata, batchId))
 const resultIndex = statements.length
 statements.push(statement(env, 'SELECT record_index FROM vane_collection_batch_admitted WHERE batch_id=? ORDER BY record_index', batchId),
  statement(env, 'DELETE FROM vane_collection_batch_admitted WHERE batch_id=?', batchId), statement(env, 'DELETE FROM vane_guard'))
 let result: D1Result<any>[]
 try { result = await env.DB.batch(statements) } catch (error) {
  // Identify business conflicts without retrying writes or interpreting an
  // unrelated database failure as successful duplicate admission.
  const sites = new Map<string, Awaited<ReturnType<typeof site>>>()
  for (let index = 0; index < prepared.length; index++) {
   const plan = prepared[index]!
   if (!sites.has(plan.value.id)) sites.set(plan.value.id, await site(env, plan.value.id))
   if (sites.get(plan.value.id)!.version !== plan.value.version) throw new IndexedCollectionError(new VaneError('admission', 'Collection changed before this batch could be admitted. Refresh the site configuration.', 409), index)
  }
  const current = await existingPageviews(env, prepared)
  for (let index = 0; index < prepared.length; index++) {
   const prior = current.get(prepared[index]!.eventId)
   if (prior && !samePageview(prior, prepared[index]!)) throw new IndexedCollectionError(conflict(), index)
  }
  throw error
 }
 const newlyAdmitted = new Set<number>(result[resultIndex]!.results.map(row => Number(row.record_index)))
 return prepared.map((plan, index): PageviewResult => newlyAdmitted.has(index)
  ? { accepted: true, status: 202, ...(plan.experiments ? { experiments: plan.experiments } : {}) }
  : { accepted: true, duplicate: true, status: 200 })
}

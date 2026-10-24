import { rows, type Env } from '../core'
import { sourceNameSql, type SourceRule } from '../sources'

interface OccurrenceRange { set:string; from:string; to:string }

// Classification depends on the raw source alone. Aggregate its counts before
// applying the owner's rules and the maintained names, once per distinct source.
export function sourceCounts(env:Env,scope:string,current:OccurrenceRange,previous:OccurrenceRange,rules:SourceRule[]=[]) {
 return rows<{label:string;count:number;previous:number}>(env,`WITH source_counts AS MATERIALIZED (
  SELECT source,SUM(n) AS n,SUM(p) AS p FROM (
   SELECT source,occurrence_count AS n,0 AS p FROM ${current.set}
   WHERE site_id IN (SELECT value FROM json_each(?5)) AND day>=?1 AND day<?2 AND kind='pageview'
   UNION ALL
   SELECT source,0 AS n,occurrence_count AS p FROM ${previous.set}
   WHERE site_id IN (SELECT value FROM json_each(?5)) AND day>=?3 AND day<?4 AND kind='pageview'
  ) GROUP BY source
 ) SELECT ${sourceNameSql(rules)} AS label,SUM(n) AS count,SUM(p) AS previous
 FROM source_counts GROUP BY 1 ORDER BY count DESC,previous DESC,label`,
 current.from,current.to,previous.from,previous.to,scope)
}

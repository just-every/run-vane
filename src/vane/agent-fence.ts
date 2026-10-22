import { rows, statement, type Env, type Site } from './core'
// An investigation may span slow public-page reads. Never publish its pre-erasure aggregates, stale settings or
// a verified-fix annotation if the owner changes/erases that site while the investigation is in flight.
export async function agentHistoryStamp(env:Env,siteId:string):Promise<number> {
 return Number((await rows<{n:number}>(env,'SELECT COUNT(*) AS n FROM vane_deletions WHERE site_id=?',siteId))[0]!.n)
}
export function agentCommitGuard(env:Env,value:Site,stamp:number) {
 return statement(env,'INSERT INTO vane_guard(value) SELECT CASE WHEN EXISTS(SELECT 1 FROM vane_sites WHERE id=? AND version=?) AND (SELECT COUNT(*) FROM vane_deletions WHERE site_id=?)=? THEN 1 ELSE 0 END',value.id,value.version,value.id,stamp)
}

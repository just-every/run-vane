import { insist, rows, type Env } from '../core'
import { seal, unseal } from '../sealed'
import type { Connection, Tokens } from './types'

const PURPOSE='vane-search-console-tokens-v1'
export const connection=async(env:Env,siteId:string)=>(await rows<Connection>(env,'SELECT * FROM vane_search_connections WHERE site_id=?',siteId))[0];
export const sealTokens=(env:Env,siteId:string,generation:string,tokens:Tokens)=>seal(env,PURPOSE,siteId+':'+generation,JSON.stringify(tokens))
export const readTokens=async(env:Env,c:Connection):Promise<Tokens>=>JSON.parse(await unseal(env,PURPOSE,c.site_id+':'+c.generation,c.sealed_tokens))
export async function current(env:Env,c:Connection,lockId?:string) {
 const found=await connection(env,c.site_id);
 insist(found&&found.generation===c.generation&&(!lockId||found.lock_id===lockId),'search_disconnected','Search Console was disconnected or changed during this sync.',409);
 return found;
}
export const liveGuard='EXISTS(SELECT 1 FROM vane_search_connections WHERE site_id=? AND generation=? AND lock_id=?)'
export const guardValues=(c:Connection,lockId:string)=>[c.site_id,c.generation,lockId]

export const sourceDayGuard=liveGuard+" AND ?>=COALESCE((SELECT MAX(before_day) FROM vane_deletions WHERE site_id=?),'0000-01-01')"
export const sourceDayValues=(c:Connection,lockId:string,date:string)=>[...guardValues(c,lockId),date,c.site_id]

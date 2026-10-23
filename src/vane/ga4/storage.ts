import { insist, rows, type Env } from '../core'
import { seal, unseal } from '../sealed'
import type { Connection, Tokens } from './types'

const PURPOSE='vane-ga4-tokens-v1'
export const connection=async(env:Env,siteId:string)=>(await rows<Connection>(env,'SELECT * FROM vane_ga4_connections WHERE site_id=?',siteId))[0];
export const sealTokens=(env:Env,siteId:string,generation:string,tokens:Tokens)=>seal(env,PURPOSE,siteId+':'+generation,JSON.stringify(tokens))
export const readTokens=async(env:Env,c:Connection):Promise<Tokens>=>JSON.parse(await unseal(env,PURPOSE,c.site_id+':'+c.generation,c.sealed_tokens))
export async function current(env:Env,c:Connection,lockId?:string) {
 const found=await connection(env,c.site_id);
 insist(found&&found.generation===c.generation&&(!lockId||found.lock_id===lockId),'search_disconnected','GA4 was disconnected or changed during this sync.',409);
 return found;
}

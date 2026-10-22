import { createPortability } from '@runeditrun/rer/modules/portability'
import type { Env } from './core'
import type { D1Sql } from '../modules/import-kit/src/d1/types'

/** Commit Base's archive checkpoint with native and import-custody deletion. */
export async function deletionFence(env:Env):Promise<D1Sql[]> {
 // Installation-local sign-in authority is outside analytics custody. Its
 // operator FKs must not enter a catalogue that excludes native identity.
 const service=await createPortability({db:env.DB,policy:{product:'analytics/vane',excludeTables:['vane_security_%','vane_totp_%','vane_second_step_%','vane_saml_%','vane_scim_%']}});
 const prepared=[...await service.redactionStatements(),...await service.invalidateTransfersStatements()];
 return prepared.map(item=>{const value=item as unknown as {statement:string;params:unknown[]};if(typeof value.statement!=='string'||!Array.isArray(value.params))throw new Error('Invalid D1 statement adapter');return {sql:value.statement,params:value.params}});
}

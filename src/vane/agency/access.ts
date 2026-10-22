import { rows, type Env } from '../core'

// A client boundary is resolved on every request, independently of legacy/all-site grants.
// Empty clients yield [] (never NULL, whose meaning is every site).
export async function clientScope(env:Env,operatorId:string):Promise<string[]|null> {
 const membership=(await rows<{client_id:string}>(env,'SELECT client_id FROM vane_agency_members WHERE operator_id=?',operatorId))[0]
 return membership?(await rows<{site_id:string}>(env,'SELECT a.site_id FROM vane_agency_sites a JOIN vane_sites s ON s.id=a.site_id WHERE a.client_id=?',membership.client_id)).map(s=>s.site_id):null
}

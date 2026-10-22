import { insist, rows, sites, statement, type Access, type Actor, type Env } from './core'
import { auditStatement } from './audit'
import { operatorAuth } from '../auth.server'
import { clientScope } from './agency/access'
// TEAM-001: Vane's per-person access on top of Base's accounts. Base holds the person, the email invitation, the
// account role (owner, admin or member), deactivation and the owner-only role change; Vane keeps, per operator, the
// Vane role a member holds (analyst or viewer) and the sites an admin or member may open (NULL: every site).
// An owner always holds every site. A member with no grant (invited before TEAM-001) is a viewer of every site (ct 11:47Z).
export interface Grant { operator_id:string; role:Access; site_ids:string|null }
export async function teamActor(env:Env,operator:{id:string;role:string;displayName?:string}):Promise<Actor> {
 if(operator.role==='owner')return {...operator,access:'owner',sites:null};
 const clientSites=await clientScope(env,operator.id);
 if(clientSites!==null)return {...operator,access:'viewer',sites:clientSites};
 const grant=(await rows<Grant>(env,'SELECT * FROM vane_grants WHERE operator_id=?',operator.id))[0];
 const sites=grant?.site_ids?JSON.parse(grant.site_ids) as string[]:null;
 return {...operator,access:operator.role==='admin'?'admin':grant?.role==='analyst'?'analyst':'viewer',sites};
}
const ROLES:Record<string,{base:'admin'|'member',access:Access}>={admin:{base:'admin',access:'admin'},analyst:{base:'member',access:'analyst'},viewer:{base:'member',access:'viewer'}};
// The chosen sites (site_<id>=on) or the whole installation (scope=all). An admin grants only within their own sites,
// and only the owner or an installation-wide admin grants the whole installation.
async function chosenSites(env:Env,actor:Actor,input:any):Promise<string[]|null> {
 if(input.scope==='all'){insist(!actor.sites,'forbidden','Only the owner or an installation-wide admin grants every site.',403);return null}
 const known=(await sites(env)).map(s=>s.id),ids=[...new Set(Object.keys(input).filter(key=>key.startsWith('site_')&&input[key]==='on').map(key=>key.slice(5)))];
 insist(ids.length>0&&ids.every(id=>known.includes(id)),'sites','Choose the sites this person may open, or the whole installation.');
 insist(ids.every(id=>!actor.sites||actor.sites.includes(id)),'forbidden','You can grant only sites you can open.',403);
 return ids;
}
function grantable(actor:Actor,role:string) {
 insist(Object.hasOwn(ROLES,role),'role','Choose admin, analyst or viewer.');
 insist(actor.access==='owner'||actor.access==='admin'&&role!=='admin','forbidden','Only the owner invites or changes an admin.',403);
}
const grantSql=(env:Env,actor:Actor,operatorId:string,role:string,ids:string[]|null)=>statement(env,'INSERT INTO vane_grants(operator_id,role,site_ids,granted_by,granted_at) VALUES(?,?,?,?,?) ON CONFLICT(operator_id) DO UPDATE SET role=excluded.role,site_ids=excluded.site_ids,granted_by=excluded.granted_by,granted_at=excluded.granted_at',operatorId,role,ids?JSON.stringify(ids):null,actor.id,Date.now());
const scopeText=(ids:string[]|null)=>ids?`sites ${ids.join(', ')}`:'every site';
// Base sends the invitation email and records the person; the grant is written only once Base has accepted it.
export async function invite(env:Env,actor:Actor,request:Request,input:any) {
 const role=String(input.role??''),email=String(input.email??'').trim().toLowerCase();grantable(actor,role);
 const ids=await chosenSites(env,actor,input);
 await operatorAuth(env).invite(request,{email,role:ROLES[role]!.base,displayName:String(input.displayName??'').trim()||email.split('@')[0]});
 const person=(await rows<{id:string}>(env,'SELECT id FROM oa_operators WHERE email=?',email))[0];insist(person,'invite','The invitation was not recorded.',409);
 await env.DB.batch([grantSql(env,actor,person.id,role,ids),auditStatement(env,actor.id,'team.invite',person.id,`${role} for ${scopeText(ids)}`)]);
}
async function person(env:Env,actor:Actor,operatorId:string) {
 const found=(await rows<{id:string,role:string,status:string,email:string}>(env,'SELECT id,role,status,email FROM oa_operators WHERE id=?',operatorId))[0];
 insist(found&&found.role!=='owner','person','Choose a team member who is not the owner.',404);
 // A site-scoped admin manages only people whose every site they can open.
 const held=await teamActor(env,{id:found.id,role:found.role});
 insist(actor.access==='owner'||found.role==='member'&&(!actor.sites||held.sites&&held.sites.every(id=>actor.sites!.includes(id))),'forbidden','You can manage only members within your sites.',403);
 return found;
}
// A member's Vane role and sites change at once; an admin's sites change at once (the Base role stays as it is).
export async function regrant(env:Env,actor:Actor,input:any) {
 const found=await person(env,actor,String(input.operatorId??'')),role=found.role==='admin'?'admin':String(input.role??'');
 insist(actor.access==='owner'||!(await rows(env,'SELECT 1 FROM vane_scim_users WHERE operator_id=?',found.id)).length,'forbidden','Only the owner grants site access to a SCIM-provisioned person.',403);
 insist(await clientScope(env,found.id)===null,'client_access','Manage client membership in Agency clients; client users remain Viewers of their client’s sites.');
 insist(found.role==='admin'||role!=='admin','role','Make a member an admin through an invitation by the owner.');grantable(actor,role);
 const ids=await chosenSites(env,actor,input);
 await env.DB.batch([grantSql(env,actor,found.id,role,ids),auditStatement(env,actor.id,'team.grant',found.id,`${role} for ${scopeText(ids)}`)]);
}
// Removal is Base's deactivation: every session and sign-in link of the person ends at once.
export async function remove(env:Env,actor:Actor,request:Request,operatorId:string) {
 const found=await person(env,actor,operatorId);
 if(found.status==='invited')await operatorAuth(env).cancelInvitation(request,found.id);else await operatorAuth(env).setOperatorStatus(request,found.id,'inactive');
 await env.DB.batch([statement(env,'DELETE FROM vane_grants WHERE operator_id=?',found.id),statement(env,'DELETE FROM vane_push_subscriptions WHERE operator_id=?',found.id),auditStatement(env,actor.id,'team.remove',found.id,'access ended')]);
}
// Ownership moves only on the current owner's confirmation: the owner types the new owner's email address, and Base's
// owner-role change asks for a fresh sign-in proof. The new owner holds every site; the former owner becomes an admin.
export async function transferOwnership(env:Env,actor:Actor,request:Request,input:any) {
 insist(actor.access==='owner','forbidden','Only the owner transfers ownership.',403);
 const found=(await rows<{id:string,email:string,status:string}>(env,"SELECT id,email,status FROM oa_operators WHERE id=? AND role!='owner'",String(input.operatorId??'')))[0];
 insist(found&&found.status==='active','person','Choose an active team member to receive ownership.',404);
 insist(String(input.confirm??'').trim().toLowerCase()===found.email.toLowerCase(),'confirm','Type the new owner’s email address to confirm the transfer.');
 const auth=operatorAuth(env);
 await auth.setRole(request,found.id,'owner');
 await env.DB.batch([statement(env,'DELETE FROM vane_grants WHERE operator_id=?',found.id),auditStatement(env,actor.id,'team.transfer',found.id,'ownership transferred')]);
 await auth.setRole(request,actor.id,'admin');
}
export async function team(env:Env,actor:Actor) {
 insist(actor.access==='owner'||actor.access==='admin','forbidden','This page requires owner or admin.',403);
 const people=await rows<{id:string,email:string,display_name:string,role:string,status:string,grant_role:string|null,site_ids:string|null}>(env,"SELECT o.id,o.email,o.display_name,o.role,o.status,g.role AS grant_role,g.site_ids FROM oa_operators o LEFT JOIN vane_grants g ON g.operator_id=o.id WHERE o.status!='inactive' ORDER BY o.created_at,o.id");
 return (await Promise.all(people.map(async p=>{const actor=await teamActor(env,p);return {id:p.id,email:p.email,name:p.display_name,status:p.status,access:actor.access!,sites:actor.sites??null}})))
  .filter(p=>!actor.sites||p.access!=='owner'&&p.sites&&p.sites.every(id=>actor.sites!.includes(id)));
}

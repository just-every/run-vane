import { insist, rows, site, type Actor, type Env } from './core'
import { decide, prepare } from './commands'
import { createShareLink } from './share'
import type { ApiKey } from './api-keys'
// API-001: the Sites API. A provisioning key is created by the owner and acts as the owner's standing approval: each
// site, goal or shared link it asks for is prepared and approved at once in the owner's name, through the same
// proposal and audit path the app uses (the audit names it key:<label>). It stops working when its creator is no longer the owner.
async function ownerOf(env:Env,key:ApiKey):Promise<Actor> {
 const owner=(await rows<{id:string,role:string}>(env,"SELECT id,role FROM oa_operators WHERE id=? AND status='active' AND role='owner'",key.created_by))[0];
 insist(owner,'forbidden','This provisioning key’s creator is no longer the owner.',403);
 return {id:owner.id,role:'owner',access:'owner',sites:null};
}
const via=(key:ApiKey)=>`key:${key.label}` as const
export async function provisionSite(env:Env,key:ApiKey,input:any) {
 const actor=await ownerOf(env,key),proposal=await prepare(env,actor,'site.create',input??{},via(key));
 await decide(env,actor,proposal.id,true);
 return {site_id:proposal.payload.siteId,name:proposal.payload.name,origin:proposal.payload.origin};
}
export async function provisionGoal(env:Env,key:ApiKey,siteId:string,input:any) {
 const actor=await ownerOf(env,key),value=await site(env,siteId),name=String(input?.name??''),path=String(input?.path??'');
 insist(!Object.hasOwn(value.config.goals,name)&&!Object.hasOwn(value.config.scrollGoals??{},name),'goals','This site already has a goal with that name.',409);
 const proposal=await prepare(env,actor,'site.configure',{siteId,name:value.name,origin:value.origin,config:{...value.config,goals:{...value.config.goals,[name]:path}}},via(key));
 await decide(env,actor,proposal.id,true);
 return {site_id:siteId,goal:{name,path}};
}
export async function provisionSharedLink(env:Env,key:ApiKey,siteId:string,input:any,origin:string) {
 const actor=await ownerOf(env,key),created=await createShareLink(env,actor,{...(input??{}),siteId});
 return {site_id:siteId,url:origin.replace(/\/$/,'')+created.path};
}

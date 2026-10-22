import { atomic, insist, role, rows, site, statement, uid, type Actor, type Env } from '../core'
import { auditStatement } from '../audit'
import { invite } from '../team'
import type { Brand } from './branding'

export interface Client {id:string;name:string;created_at:number}
export async function agencyData(env:Env,actor:Actor) {
 role(actor)
 const [clients,members,assignments,brands]=await Promise.all([
  rows<Client>(env,'SELECT * FROM vane_agency_clients ORDER BY created_at,id'),
  rows<{operator_id:string;client_id:string;email:string;status:string}>(env,"SELECT m.*,o.email,o.status FROM vane_agency_members m JOIN oa_operators o ON o.id=m.operator_id WHERE o.status!='inactive'"),
  rows<{site_id:string;client_id:string}>(env,'SELECT * FROM vane_agency_sites'),
  rows<Brand>(env,'SELECT * FROM vane_agency_brands')])
 return {clients,members,assignments,brands}
}
const label=(value:unknown)=>{const text=String(value??'').trim();insist(text.length>0&&text.length<=80&&!/[<>\u0000-\u001f\u007f]/.test(text),'agency_name','Use 1 to 80 plain-text characters.');return text}
async function client(env:Env,id:string) {const found=(await rows<Client>(env,'SELECT * FROM vane_agency_clients WHERE id=?',id))[0];insist(found,'client','Choose an existing client.',404);return found}
async function brandId(env:Env,value:unknown) {const id=String(value??'agency');if(id!=='agency')await client(env,id);return id}
export async function agencyAction(env:Env,actor:Actor,request:Request,p:any) {
 role(actor)
 const operation=String(p.operation??'')
 if(operation==='agency.client.create') {
  const id=uid(),name=label(p.name)
  await atomic(env,actor,[statement(env,'INSERT INTO vane_agency_clients VALUES(?,?,?)',id,name,Date.now()),auditStatement(env,actor.id,'agency.client.create',id,name)])
 } else if(operation==='agency.site.assign') {
  const siteId=String(p.siteId??''),id=String(p.clientId??'');await site(env,siteId);if(id)await client(env,id)
  await atomic(env,actor,[id?statement(env,'INSERT INTO vane_agency_sites VALUES(?,?) ON CONFLICT(site_id) DO UPDATE SET client_id=excluded.client_id',siteId,id):statement(env,'DELETE FROM vane_agency_sites WHERE site_id=?',siteId),
   // Existing alert/follow-up recipients use the native Vane grant projection. Keep it
   // synchronized in this same transaction, including [] for an emptied client.
   statement(env,'UPDATE vane_grants SET site_ids=(SELECT json_group_array(site_id) FROM vane_agency_sites WHERE client_id=(SELECT client_id FROM vane_agency_members WHERE operator_id=vane_grants.operator_id)) WHERE operator_id IN (SELECT operator_id FROM vane_agency_members)'),
   auditStatement(env,actor.id,'agency.site.assign',siteId,id||'unassigned')])
 } else if(operation==='agency.invite') {
  const id=String(p.clientId??'');await client(env,id)
  const ids=(await rows<{site_id:string}>(env,'SELECT a.site_id FROM vane_agency_sites a JOIN vane_sites s ON s.id=a.site_id WHERE a.client_id=?',id)).map(s=>s.site_id)
  insist(ids.length,'client_sites','Assign a site before inviting a client user.')
  // Client users are bounded viewers. Base owns the ordinary invitation and session lifecycle.
  await invite(env,actor,request,{email:p.email,displayName:p.displayName,role:'viewer',scope:'chosen',...Object.fromEntries(ids.map(s=>['site_'+s,'on']))})
  const person=(await rows<{id:string}>(env,'SELECT id FROM oa_operators WHERE email=?',String(p.email??'').trim().toLowerCase()))[0]!
  await atomic(env,actor,[statement(env,'INSERT INTO vane_agency_members VALUES(?,?) ON CONFLICT(operator_id) DO UPDATE SET client_id=excluded.client_id',person.id,id),auditStatement(env,actor.id,'agency.user.assign',person.id,id)])
 } else if(operation==='agency.brand.save') {
  const id=await brandId(env,p.brandId),name=label(p.name),accent=String(p.accent??''),background=String(p.background??'')
  insist(/^#[0-9a-f]{6}$/i.test(accent)&&/^#[0-9a-f]{6}$/i.test(background),'agency_colors','Choose six-digit hexadecimal colors.')
  let origin=String(p.customOrigin??'').trim()||null
  if(origin){let url:URL;try{url=new URL(origin)}catch{insist(false,'agency_domain','Enter an https origin, without a path.')}insist(url!.protocol==='https:'&&url!.origin===origin&&!url!.username&&!url!.password&&!url!.port&&/^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}$/i.test(url!.hostname),'agency_domain','Enter an https hostname, without credentials, port, path or query.');origin=url!.origin
   insist(origin!==new URL(env.AUTH_ORIGIN).origin,'agency_domain','The installation origin is already in use.')
   insist(p.domainAttestation==='on','agency_domain','Confirm you control this hostname and have attached it to this Worker.')
   insist(!(await rows(env,'SELECT 1 FROM vane_agency_brands WHERE custom_origin=? AND id!=?',origin,id)).length,'agency_domain','This domain already belongs to another brand.',409)
   insist(!(await rows(env,'SELECT 1 FROM vane_proxy_connections WHERE hostname=? AND revoked_at IS NULL',url!.hostname)).length,'agency_domain','This hostname is already a collection proxy.',409)
  }
  const enabled=p.enabled==='on'?1:0
  await atomic(env,actor,[statement(env,'INSERT INTO vane_agency_brands(id,name,accent,background,custom_origin,enabled,updated_at) VALUES(?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name,accent=excluded.accent,background=excluded.background,custom_origin=excluded.custom_origin,enabled=excluded.enabled,updated_at=excluded.updated_at',id,name,accent,background,origin,enabled,Date.now()),auditStatement(env,actor.id,'agency.brand.save',id,`branding ${enabled?'enabled':'disabled'}${origin?'; custom hostname configured':''}`)])
 } else if(operation==='agency.logo.clear') {
  const id=await brandId(env,p.brandId)
  await atomic(env,actor,[statement(env,'UPDATE vane_agency_brands SET logo_id=NULL,updated_at=? WHERE id=?',Date.now(),id),statement(env,'DELETE FROM vane_agency_logos WHERE brand_id=?',id),auditStatement(env,actor.id,'agency.logo.clear',id,'Logo removed')])
 } else insist(false,'agency_operation','Choose an agency action.')
}

// A bounded multipart upload; no URL fetching, SVG, HTML or caller-supplied content type is trusted.
export async function uploadLogo(env:Env,actor:Actor,request:Request) {
 role(actor)
 const reader=request.body?.getReader(),chunks:Uint8Array[]=[];let length=0
 if(reader)while(true){const part=await reader.read();if(part.done)break;length+=part.value.length;insist(length<=280000,'agency_logo','Logo upload is limited to 256 KB plus form fields.',413);chunks.push(part.value)}
 const body=new Uint8Array(length);let offset=0;for(const chunk of chunks){body.set(chunk,offset);offset+=chunk.length}
 const form=await new Response(body,{headers:{'content-type':request.headers.get('content-type')??''}}).formData()
 const id=await brandId(env,form.get('brandId')),file=form.get('logo')
 insist(file&&typeof file!=='string'&&file.size>0&&file.size<=262144,'agency_logo','Choose a PNG, JPEG or WebP image up to 256 KB.')
 const bytes=new Uint8Array(await file.arrayBuffer()),prefix=Array.from(bytes.slice(0,12)),text=new TextDecoder('ascii').decode(bytes.slice(0,12))
 const mime=prefix.slice(0,8).join(',')==='137,80,78,71,13,10,26,10'?'image/png':prefix[0]===255&&prefix[1]===216&&prefix[2]===255?'image/jpeg':text.startsWith('RIFF')&&text.slice(8,12)==='WEBP'?'image/webp':null
 insist(mime,'agency_logo','Upload a PNG, JPEG or WebP image; SVG and markup are refused.')
 insist((await rows(env,'SELECT 1 FROM vane_agency_brands WHERE id=?',id)).length,'agency_brand','Save this brand before uploading a logo.')
 const logoId=uid()
 await atomic(env,actor,[statement(env,'DELETE FROM vane_agency_logos WHERE brand_id=?',id),statement(env,'INSERT INTO vane_agency_logos VALUES(?,?,?,?)',logoId,id,mime,bytes.buffer),statement(env,'UPDATE vane_agency_brands SET logo_id=?,updated_at=? WHERE id=?',logoId,Date.now(),id),auditStatement(env,actor.id,'agency.logo.upload',id,`${mime}, ${bytes.length} bytes`)])
 return logoId
}

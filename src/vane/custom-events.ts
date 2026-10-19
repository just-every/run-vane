import { insist, site, siteOrigin, statement, VaneError, type Env } from './core'
import { consentAccepted } from './consent'
import { clock } from './clock'
import { excludedTraffic } from './traffic'
import { cleanProps, droppedStatement, eventName, propStatements } from './properties'
import { cleanLines, lineStatements, minorDigits } from './ecommerce'
import { cleanRevenue, MICROS } from './revenue'
// CONV-002: a custom event, sent with vane('Signup', {props}) or by a vane-event-name=Signup class, names the page load it
// happened on (its ID as the script sent it), so it belongs to that page load's visitor, day and visit; no IP address
// or user agent is read for it. It is accepted from the site's registered origin with consent as configured, once
// per event ID, and refused for excluded traffic (COLLECT-003) without a second count. CONV-007: the standard
// ecommerce events also carry product lines and their currency. CONV-006: any custom event may carry revenue as
// {amount, currency}; a Purchase with product lines and no revenue carries the lines' total (units times unit price).
export async function customEventResponse(request:Request,env:Env):Promise<Response|null> {
 if(new URL(request.url).pathname!=='/api/vane/custom')return null;
 let cors:Record<string,string>={'vary':'Origin','cache-control':'no-store'};
 if(request.method==='OPTIONS')return new Response(null,{status:204,headers:{...cors,'access-control-allow-origin':request.headers.get('origin')??'null','access-control-allow-methods':'POST','access-control-allow-headers':'content-type','access-control-max-age':'600'}});
 try {
  insist(request.method==='POST','method','POST required.',405);
  const text=await request.text();insist(text.length<=8192,'body','Event too large.',413);
  const payload=JSON.parse(text),value=await site(env,String(payload?.siteId));
  const origin=siteOrigin(value,request);cors={...cors,'access-control-allow-origin':origin};
  insist(Object.keys(payload).every(key=>['id','siteId','page','name','props','items','currency','revenue','consent'].includes(key))&&/^[a-f0-9-]{36}$/.test(payload.id)&&/^[a-f0-9-]{36}$/.test(payload.page),'fields','Only the declared custom-event fields are accepted.');
  insist(consentAccepted(value.config,request,payload.consent),'consent','Consent is required for collection.',403);
  const excluded=excludedTraffic(request,value.config,null);insist(!excluded,'excluded',`This traffic is excluded from collection (${excluded}).`,403);
  const name=eventName(payload.name),props=cleanProps(payload.props),{lines,currency}=cleanLines(name,payload.items,payload.currency),revenue=cleanRevenue(payload.revenue)??(name==='Purchase'&&lines.length?{micros:lines.reduce((n,l)=>n+l.quantity*l.priceMinor,0)*MICROS/10**minorDigits(currency!),currency:currency!}:null),id=value.id+':'+payload.id,pageId=value.id+':'+payload.page;
  const page=await env.DB.prepare("SELECT day FROM vane_events WHERE id=? AND kind='pageview' AND site_id=?").bind(pageId,value.id).first<{day:string}>();
  insist(page,'page_load','No page load of this site has this ID.',404);
  if(await env.DB.prepare('SELECT 1 FROM vane_custom_events WHERE id=?').bind(id).first())return Response.json({accepted:true,duplicate:true},{headers:cors});
  await env.DB.batch([statement(env,'INSERT OR IGNORE INTO vane_custom_events(id,site_id,day,page_id,name,at,revenue_micros,currency) VALUES(?,?,?,?,?,?,?,?)',id,value.id,page.day,pageId,name,clock(),revenue?.micros??null,revenue?.currency??null),...propStatements(env,id,value.id,page.day,props),...lineStatements(env,id,value.id,page.day,lines,currency),...droppedStatement(env,value.id,page.day,props)]);
  return Response.json({accepted:true},{status:202,headers:cors});
 } catch(error) { const e=error instanceof VaneError?error:new VaneError('invalid_event','Event could not be accepted.'); return Response.json({error:e.code,message:e.message},{status:e.status,headers:cors}); }
}

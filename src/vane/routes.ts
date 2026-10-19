import { operatorAuth, runtimeBindings, type Bindings } from '../auth.server'
import { everySite, inScope, insist, role, rows, site, sites, VaneError, type Actor } from './core'
import { invite, regrant, remove, team, teamActor, transferOwnership } from './team'
import { apiKeys, createKey, revokeKey } from './api-keys'
import { csvTables, toCsv } from './csv'
import { siteZip } from './site-zip'
import { deleteExport, exportOf, runExportNow, saveExport } from './warehouse'
import { createWebhook, deleteWebhook, deliveryLog, webhooks } from './webhooks'
import { reportSends, reportSubscriptions, subscribe, unsubscribe } from './email-reports'
import { eventsConnected, mailStops } from './mail-events'
import { alertLog, createAlert, deleteAlert, siteAlerts } from './traffic-alerts'
import { createInsightsService } from './reports'
import { prepare } from './commands'
import { preview, journal, MoveinError } from './movein/index'
import { apply, auditLog, exportHistory, restoreHistory, undo } from './audit'
import { renderApp, type ViewData } from './views/index'
import { input } from './input'
import { action } from './actions'
import { verifyInstallation } from './install-check'
import { clock } from './clock'
import { exportSite, importSite } from './transfer'
import { inventory } from './inventory'
import { storeUse } from './capacity'
import { createRollup, rollup, rollupReport, rollups } from './rollups'
import { overview } from './overview'
import { currentVisitors, realtime } from './realtime'
import { saveSegment, segments } from './segments'
import { previewSelector } from './event-definitions'
import { shareLinks } from './share'
import { pushSubscriptions, subscribePush, testPush, unsubscribePush, vapidKey } from './push'
import { AuthError } from '../modules/operator-auth/index.mjs'
const ACCOUNT_REFUSALS:Record<string,string>={forbidden:'Your role cannot make this team change.',invitation_conflict:'This email address already belongs to a team member or a pending invitation.',step_up_required:'Confirm it is you first: sign in again, then repeat the ownership transfer within a few minutes.',last_owner:'The installation keeps one owner.',invalid_email:'Enter a valid email address.'};
const headers={'cache-control':'no-store','x-content-type-options':'nosniff','referrer-policy':'same-origin'};
const json=(value:unknown,status=200)=>Response.json(value,{status,headers});
const redirect=(path:string)=>new Response(null,{status:303,headers:{...headers,location:path}});
export async function vaneResponse(request:Request,original:Bindings):Promise<Response|null> {
 const url=new URL(request.url),path=url.pathname;
 if(path!=='/app'&&!path.startsWith('/app/')&&!path.startsWith('/api/vane/'))return null;
 const env=runtimeBindings(original);
 const range={from:url.searchParams.get('from'),to:url.searchParams.get('to'),journey:url.searchParams.get('journey'),journeyMode:url.searchParams.get('journeyMode'),period:url.searchParams.get('period'),compare:url.searchParams.get('compare'),compareFrom:url.searchParams.get('compareFrom'),compareTo:url.searchParams.get('compareTo'),weekdays:url.searchParams.get('weekdays'),interval:url.searchParams.get('interval'),metric:url.searchParams.get('metric'),group:url.searchParams.get('group'),goal:url.searchParams.get('goal'),host:url.searchParams.get('host'),hostOp:url.searchParams.get('hostOp'),filters:[...url.searchParams.getAll('filter'),...(url.searchParams.get('filterValue')?[`${url.searchParams.get('filterDimension')==='prop'?'prop.'+url.searchParams.get('filterKey'):url.searchParams.get('filterDimension')}:${url.searchParams.get('filterOp')}:${url.searchParams.get('filterValue')}`]:[])],segment:url.searchParams.get('segment')};
 let actor:Actor|undefined;
 const open=(id:string)=>!actor!.sites||actor!.sites.includes(id);
 const visibleProposals=(list:any[])=>list.filter(p=>open(JSON.parse(p.payload_json).siteId));
 const scopedRollup=async(id:string)=>{const r=await rollup(env,id);for(const s of r.sites)inScope(actor!,s.id);return r};
 async function view(siteId?:string,extra:Partial<ViewData>={}) {
  const selected=siteId?await site(env,siteId):undefined;
  const proposals=actor!.role==='member'?[]:visibleProposals(await rows(env,'SELECT p.*,po.display_name AS prepared_name,ao.display_name AS approved_name FROM vane_proposals p LEFT JOIN oa_operators po ON po.id=p.prepared_by LEFT JOIN oa_operators ao ON ao.id=p.approved_by ORDER BY p.created_at DESC LIMIT 100'));
  // An error page passes section undefined, so a refused section is not rendered again.
  const asked='section' in extra?extra.section:url.searchParams.get('section');
  const audit=!selected&&asked==='audit'?(everySite(actor!),await auditLog(env,actor!)):undefined;
  const people=!selected&&asked==='team'?await team(env,actor!):undefined;
  const keys=!selected&&asked==='api'?await apiKeys(env,actor!):undefined;
  const push=!selected&&asked==='alerts'?{pushKey:await vapidKey(env),pushSubscriptions:await pushSubscriptions(env,actor!)}:{};
  const imports=selected&&actor!.role==='owner'?await rows(env,'SELECT j.id,j.state,(SELECT COUNT(*) FROM ik_provenance p WHERE p.job_id=j.id) AS count FROM ik_jobs j JOIN vane_import_approvals a ON a.job_id=j.id WHERE a.site_id=? ORDER BY a.approved_at DESC',selected.id):[];
  const all=(await sites(env)).filter(s=>open(s.id)),list=!selected&&!extra.rollup&&!extra.error&&(url.searchParams.get('section')??'report')==='report'?await overview(env,all,clock(),{period:url.searchParams.get('period'),sort:url.searchParams.get('sort'),q:url.searchParams.get('q')}):undefined;
  const live=selected&&url.searchParams.get('section')==='realtime';
  const settings=selected&&(extra.section??url.searchParams.get('section'))==='settings',hook=settings?(await rows<{created_at:number}>(env,'SELECT created_at FROM vane_annotation_hooks WHERE site_id=?',selected.id))[0]??null:undefined,github=settings?(await rows<{created_at:number}>(env,'SELECT created_at FROM vane_github_keys WHERE site_id=?',selected.id))[0]??null:undefined,warehouse=settings&&actor!.role==='owner'?await exportOf(env,selected.id):undefined,hooks=settings&&['owner','admin'].includes(actor!.role)?{webhooks:await webhooks(env,selected.id),webhookLog:await deliveryLog(env,selected.id)}:{},reports=settings?{reportSubscriptions:(await reportSubscriptions(env,selected.id)).filter(s=>['owner','admin'].includes(actor!.role)||s.operator_id===actor!.id),reportSends:['owner','admin'].includes(actor!.role)?await reportSends(env,selected.id):[],mailEvents:eventsConnected(env)}:{};if(reports.reportSubscriptions)(reports as any).mailStops=await mailStops(env,reports.reportSubscriptions.map(s=>s.email));if(settings&&(['owner','admin'].includes(actor!.role)||actor!.access==='analyst'))Object.assign(reports,{alerts:await siteAlerts(env,selected.id),alertLog:await alertLog(env,selected.id)});
  return renderApp({actor:actor as ViewData['actor'],origin:env.AUTH_ORIGIN,store:await storeUse(env),sites:all,overview:list,rollups:(await rollups(env)).filter(r=>r.sites.every((s:any)=>open(s.id))),site:selected,hook,github,...hooks,...reports,warehouse:warehouse?{endpoint:warehouse.endpoint,bucket:warehouse.bucket,region:warehouse.region,prefix:warehouse.prefix,accessKeyId:warehouse.access_key_id,lastDay:warehouse.last_day,lastResult:warehouse.last_result,createdAt:warehouse.created_at}:warehouse,shares:settings?await shareLinks(env,selected.id):undefined,segments:selected&&!live?await segments(env,selected.id):undefined,live:live?await realtime(env,selected,clock()):undefined,liveVisitors:selected?await currentVisitors(env,selected,clock()):undefined,report:selected&&!live?await createInsightsService(env,selected,clock(),range).list():undefined,proposals,imports,audit,people,apiKeys:keys,...push,section:url.searchParams.get('section')??undefined,notice:url.searchParams.get('notice')??undefined,...extra});
 }
 try {
  const session=await operatorAuth(env).getSession(request);
  if(!session)return path.startsWith('/app')&&request.method==='GET'?redirect('/signin?returnTo=%2Fapp'):json({error:'authentication_required'},401);
  actor=await teamActor(env,session.operator);role(actor,['owner','admin','member']);
  if(request.method==='POST')insist(request.headers.get('origin')===env.AUTH_ORIGIN&&request.headers.get('sec-fetch-site')!=='cross-site','origin','Same-origin approval is required.',403);
  // TEAM-001: every door that names a site, by query, path or form, answers only for a site the person may open.
  const named=url.searchParams.get('siteId')??path.match(/^\/app\/sites\/([\w-]+)$/)?.[1];if(named)inScope(actor,named);
  if(request.method==='GET') {
   if(path==='/api/vane/sites')return json((await sites(env)).filter(s=>open(s.id)));
   if(path==='/api/vane/summary'&&url.searchParams.has('rollupId'))return json(await rollupReport(env,await scopedRollup(url.searchParams.get('rollupId')!),range,url.searchParams.get('split')==='site'));
   if(path==='/api/vane/summary')return json(await createInsightsService(env,await site(env,url.searchParams.get('siteId')??''),clock(),range).list());
   // API-002: one report table as CSV, with the dashboard's range, comparison, filters and segment.
   if(path==='/api/vane/csv'){const value=await site(env,url.searchParams.get('siteId')??''),report=await createInsightsService(env,value,clock(),range).list() as Record<string,any>,table=url.searchParams.get('table')??'';insist(csvTables(report).includes(table),'table','Choose one of the report’s tables.',404);return new Response(toCsv(report[table]),{headers:{...headers,'content-type':'text/csv; charset=utf-8','content-disposition':`attachment; filename="vane-${value.id}-${table}-${report.from}-${report.to}.csv"`}})}
   // API-002: the whole site as a ZIP of CSVs in Plausible's export layout, for anyone who may open the site.
   if(path==='/api/vane/site-zip'){const value=await site(env,url.searchParams.get('siteId')??''),file=await siteZip(env,value,clock());return new Response(file.bytes,{headers:{...headers,'content-type':'application/zip','content-disposition':`attachment; filename="${file.name}"`}})}
   if(path==='/api/vane/realtime')return json(await realtime(env,await site(env,url.searchParams.get('siteId')??''),clock()));
   if(path==='/api/vane/inventory')return json(inventory(await site(env,url.searchParams.get('siteId')??'')));
   if(path==='/api/vane/audit'){everySite(actor);return json(await auditLog(env,actor));}
   if(path==='/api/vane/proposals') {role(actor,['owner','admin']);return json(visibleProposals(await rows(env,'SELECT * FROM vane_proposals ORDER BY created_at DESC')));}
   if(path==='/api/vane/import-journal')return json(await journal(env,actor,{siteId:url.searchParams.get('siteId')??'',jobId:url.searchParams.get('jobId')??''}));
   if(path==='/api/vane/export'&&url.searchParams.has('siteId')) { const id=url.searchParams.get('siteId')!; return new Response(JSON.stringify(await exportSite(env,actor,id),null,2),{headers:{...headers,'content-type':'application/json','content-disposition':`attachment; filename="vane-site-${id}.json"`}}); }
   if(path==='/api/vane/export')return new Response(JSON.stringify(await exportHistory(env,actor),null,2),{headers:{...headers,'content-type':'application/json','content-disposition':'attachment; filename="vane-history.json"'}});
   if(path==='/app')return await view();
   const match=path.match(/^\/app\/sites\/([\w-]+)$/);if(match)return await view(match[1]);
   const rolled=path.match(/^\/app\/rollups\/([\w-]+)$/);if(rolled){const r=await scopedRollup(rolled[1]!);return view(undefined,{rollup:r,report:await rollupReport(env,r,range,url.searchParams.get('split')==='site')})}
  }
  if(request.method==='POST') {
   const p=await input(request);
   for(const id of [p.siteId,p.input?.siteId])if(id!==undefined&&id!=='')inScope(actor,String(id));
   if(path==='/api/vane/commands')return json(await prepare(env,actor,p.command,p.input??{},'command API'),201);
   if(path==='/api/vane/import-preview')return json(await preview(env,actor,{siteId:p.siteId,document:p.document}));
   if(path==='/api/vane/import-apply')return json(await apply(env,actor,{siteId:p.siteId,document:p.document,fingerprint:p.fingerprint}));
   if(path==='/api/vane/import-undo')return json(await undo(env,actor,{siteId:p.siteId,jobId:p.jobId}));
   if(path==='/api/vane/install-check')return json(await verifyInstallation(env,actor,p.siteId));
   if(path==='/api/vane/site-import')return json(await importSite(env,actor,p.archive),201);
   if(path==='/api/vane/restore')return json(await restoreHistory(env,actor,p.archive,p.journal));
   // MOBILE-001: the alerts page's script sends this browser's push subscription, or turns it off.
   if(path==='/api/vane/push/subscribe')return json(await subscribePush(env,actor,p),201);
   if(path==='/api/vane/push/unsubscribe')return json(await unsubscribePush(env,actor,p));
   if(path==='/app/action') {
    // Approval has a deliberately separate human form surface. The command API
    // can prepare and inspect; it cannot apply pending configuration or erasure.
    if(p.operation?.startsWith('proposal.'))insist(request.headers.get('content-type')?.includes('application/x-www-form-urlencoded'),'approval','Review and approve the proposal using its form.');
    if(p.operation==='import.preview') {
     const result=await preview(env,actor,{siteId:p.siteId,document:p.document});
     return view(p.siteId,{section:'history',importPreview:{fingerprint:result.fingerprint,count:result.normalized.length,warnings:['Visitor identifiers, titles and raw URLs were discarded before custody. Historical consent and sampling are unknown.'],rows:result.normalized.map(e=>({date:e.day,path:e.path,visits:e.kind==='pageview'?1:0,source:e.source,campaign:e.campaign,goal:e.kind==='pageview'?'':e.kind}))},importCarry:JSON.stringify(result.carry)});
    }
    // DASH-007: a saved segment reopens the report with it applied.
    if(p.operation==='segment.save'){const saved=await saveSegment(env,actor,p);return redirect(`/app/sites/${encodeURIComponent(saved.siteId)}?${new URLSearchParams({section:'report',segment:saved.id,notice:'Segment saved for the team.'})}`)}
    // CONV-009: a selector preview renders on the settings page; nothing is stored.
    if(p.operation==='event.preview')return view(p.siteId,{section:'settings',eventPreview:await previewSelector(env,actor,p)});
    // TEAM-001: invitations, grants, removal and ownership transfer go through Base's account doors with this request.
    if(p.operation==='team.invite'){await invite(env,actor,request,p);return redirect('/app?'+new URLSearchParams({section:'team',notice:'Invitation sent.'}))}
    if(p.operation==='team.grant'){await regrant(env,actor,p);return redirect('/app?'+new URLSearchParams({section:'team',notice:'Access changed. It applies at once.'}))}
    if(p.operation==='team.remove'){await remove(env,actor,request,String(p.operatorId??''));return redirect('/app?'+new URLSearchParams({section:'team',notice:'Removed. Their sessions have ended.'}))}
    if(p.operation==='team.transfer'){await transferOwnership(env,actor,request,p);return redirect('/signin?returnTo=%2Fapp')}
    // API-001: a new key is rendered once in this response, never put in a redirect URL.
    if(p.operation==='apikey.create')return view(undefined,{section:'api',notice:'Key created. Copy it now: it is not shown again.',apiToken:await createKey(env,actor,p)});
    if(p.operation==='apikey.revoke'){await revokeKey(env,actor,String(p.id??''));return redirect('/app?'+new URLSearchParams({section:'api',notice:'Key revoked. It is refused from now on.'}))}
    // MOBILE-001: a browser removed from the alerts page, and a test alert to the person's own browsers.
    if(p.operation==='push.remove'){await unsubscribePush(env,actor,{id:p.id});return redirect('/app?'+new URLSearchParams({section:'alerts',notice:'That browser no longer receives alerts.'}))}
    if(p.operation==='push.test'){const sent=await testPush(env,actor,String(p.siteId??''));return redirect('/app?'+new URLSearchParams({section:'alerts',notice:sent?`Test alert sent to ${sent===1?'one browser':`${sent} browsers`}.`:'No push service accepted the test alert.'}))}
    // ALERT-001: traffic alerts.
    if(p.operation==='alert.create'){const id=await createAlert(env,actor,p);return redirect(`/app/sites/${encodeURIComponent(id)}?${new URLSearchParams({section:'settings',notice:'Alert added.'})}`)}
    if(p.operation==='alert.delete'){const id=await deleteAlert(env,actor,String(p.id??''));return redirect(`/app/sites/${encodeURIComponent(id)}?${new URLSearchParams({section:'settings',notice:'Alert deleted.'})}`)}
    // REPORT-001: email report subscriptions.
    if(p.operation==='report.subscribe'){const made=await subscribe(env,actor,p);return redirect(`/app/sites/${encodeURIComponent(made.siteId)}?${new URLSearchParams({section:'settings',notice:'Subscribed to the email report.'})}`)}
    if(p.operation==='report.unsubscribe'){const id=await unsubscribe(env,actor,String(p.id??''));return redirect(`/app/sites/${encodeURIComponent(id)}?${new URLSearchParams({section:'settings',notice:'Unsubscribed from the email report.'})}`)}
    // API-003: a signing secret is rendered once in this response, never put in a redirect URL.
    if(p.operation==='webhook.create'){const made=await createWebhook(env,actor,p);return view(made.siteId,{section:'settings',notice:'Webhook added. Copy its signing secret now: it is not shown again.',webhookSecret:made.secret})}
    if(p.operation==='webhook.delete'){const id=await deleteWebhook(env,actor,String(p.id??''));return redirect(`/app/sites/${encodeURIComponent(id)}?${new URLSearchParams({section:'settings',notice:'Webhook deleted; its pending deliveries are dropped.'})}`)}
    // API-002: the owner's scheduled warehouse export.
    if(p.operation==='export.save'){const id=await saveExport(env,actor,p);return redirect(`/app/sites/${encodeURIComponent(id)}?${new URLSearchParams({section:'settings',notice:'Scheduled export saved. The secret key is sealed and not shown again.'})}`)}
    if(p.operation==='export.delete'){const id=await deleteExport(env,actor,String(p.siteId??''));return redirect(`/app/sites/${encodeURIComponent(id)}?${new URLSearchParams({section:'settings',notice:'Scheduled export stopped and its key erased.'})}`)}
    if(p.operation==='export.run'){const sent=await runExportNow(env,actor,String(p.siteId??''));return redirect(`/app/sites/${encodeURIComponent(String(p.siteId))}?${new URLSearchParams({section:'settings',notice:sent.length?`Exported ${sent.join(', ')}.`:'Nothing new to export, or the bucket refused it: see the last result.'})}`)}
    if(p.operation==='rollup.create')return redirect('/app/rollups/'+encodeURIComponent(await createRollup(env,actor,p))+'?'+new URLSearchParams({notice:'Roll-up created.'}));
    const result=await action(env,actor,p),query=new URLSearchParams({notice:result.notice,...(result.section?{section:result.section}:{})});
    // DASH-009: a new annotation secret is rendered once in this response, never put in a redirect URL.
    if(result.secret)return view(result.siteId,{section:result.section,notice:result.notice,secret:result.secret});
    // SHARE-001: a new shared link's URL is rendered once in this response, never put in a redirect URL.
    if(result.sharePath)return view(result.siteId,{section:result.section,notice:result.notice,sharePath:result.sharePath});
    return redirect((result.siteId?'/app/sites/'+encodeURIComponent(result.siteId):'/app')+'?'+query);
   }
  }
  return json({error:'not_found'},404);
 } catch(caught) {
  // TEAM-001: Base's account doors refuse with a code; the team page names the reason.
  const error=caught instanceof AuthError?new VaneError(caught.code,ACCOUNT_REFUSALS[caught.code]??'The team change was refused: '+caught.code.replaceAll('_',' ')+'.',caught.status):caught;
  const known=error instanceof VaneError||error instanceof MoveinError;
  const message=known?error.message:'The operation could not complete. Check the document and refresh before trying again.';
  const status=known?error.status:400;
  if(path.startsWith('/app')&&actor) {const response=await view(undefined,{error:message,section:undefined});return new Response(response.body,{status,headers:response.headers});}
  return json({error:known?error.code:'invalid_operation',message},status);
 }
}

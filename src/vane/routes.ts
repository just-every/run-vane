import { operatorAuth, runtimeBindings, type Bindings } from '../auth.server'
import { insist, role, rows, site, sites, VaneError, type Actor } from './core'
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
import { realtime } from './realtime'
import { saveSegment, segments } from './segments'
const headers={'cache-control':'no-store','x-content-type-options':'nosniff','referrer-policy':'same-origin'};
const json=(value:unknown,status=200)=>Response.json(value,{status,headers});
const redirect=(path:string)=>new Response(null,{status:303,headers:{...headers,location:path}});
export async function vaneResponse(request:Request,original:Bindings):Promise<Response|null> {
 const url=new URL(request.url),path=url.pathname;
 if(path!=='/app'&&!path.startsWith('/app/')&&!path.startsWith('/api/vane/'))return null;
 const env=runtimeBindings(original);
 const range={from:url.searchParams.get('from'),to:url.searchParams.get('to'),journey:url.searchParams.get('journey'),journeyMode:url.searchParams.get('journeyMode'),period:url.searchParams.get('period'),compare:url.searchParams.get('compare'),compareFrom:url.searchParams.get('compareFrom'),compareTo:url.searchParams.get('compareTo'),weekdays:url.searchParams.get('weekdays'),interval:url.searchParams.get('interval'),metric:url.searchParams.get('metric'),group:url.searchParams.get('group'),goal:url.searchParams.get('goal'),host:url.searchParams.get('host'),hostOp:url.searchParams.get('hostOp'),filters:[...url.searchParams.getAll('filter'),...(url.searchParams.get('filterValue')?[`${url.searchParams.get('filterDimension')}:${url.searchParams.get('filterOp')}:${url.searchParams.get('filterValue')}`]:[])],segment:url.searchParams.get('segment')};
 let actor:Actor|undefined;
 async function view(siteId?:string,extra:Partial<ViewData>={}) {
  const selected=siteId?await site(env,siteId):undefined;
  const proposals=actor!.role==='member'?[]:await rows(env,'SELECT * FROM vane_proposals ORDER BY created_at DESC LIMIT 100');
  const audit=!selected&&url.searchParams.get('section')==='audit'?await auditLog(env,actor!):undefined;
  const imports=selected&&actor!.role==='owner'?await rows(env,'SELECT j.id,j.state,(SELECT COUNT(*) FROM ik_provenance p WHERE p.job_id=j.id) AS count FROM ik_jobs j JOIN vane_import_approvals a ON a.job_id=j.id WHERE a.site_id=? ORDER BY a.approved_at DESC',selected.id):[];
  const all=await sites(env),list=!selected&&!extra.rollup&&!extra.error&&(url.searchParams.get('section')??'report')==='report'?await overview(env,all,clock(),{period:url.searchParams.get('period'),sort:url.searchParams.get('sort'),q:url.searchParams.get('q')}):undefined;
  const live=selected&&url.searchParams.get('section')==='realtime';
  const settings=selected&&(extra.section??url.searchParams.get('section'))==='settings',hook=settings?(await rows<{created_at:number}>(env,'SELECT created_at FROM vane_annotation_hooks WHERE site_id=?',selected.id))[0]??null:undefined,github=settings?(await rows<{created_at:number}>(env,'SELECT created_at FROM vane_github_keys WHERE site_id=?',selected.id))[0]??null:undefined;
  return renderApp({actor:actor as ViewData['actor'],origin:env.AUTH_ORIGIN,store:await storeUse(env),sites:all,overview:list,rollups:await rollups(env),site:selected,hook,github,segments:selected&&!live?await segments(env,selected.id):undefined,live:live?await realtime(env,selected,clock()):undefined,report:selected&&!live?await createInsightsService(env,selected,clock(),range).list():undefined,proposals,imports,audit,section:url.searchParams.get('section')??undefined,notice:url.searchParams.get('notice')??undefined,...extra});
 }
 try {
  const session=await operatorAuth(env).getSession(request);
  if(!session)return path.startsWith('/app')&&request.method==='GET'?redirect('/signin?returnTo=%2Fapp'):json({error:'authentication_required'},401);
  actor=session.operator;role(actor,['owner','admin','member']);
  if(request.method==='POST')insist(request.headers.get('origin')===env.AUTH_ORIGIN&&request.headers.get('sec-fetch-site')!=='cross-site','origin','Same-origin approval is required.',403);
  if(request.method==='GET') {
   if(path==='/api/vane/sites')return json(await sites(env));
   if(path==='/api/vane/summary'&&url.searchParams.has('rollupId'))return json(await rollupReport(env,await rollup(env,url.searchParams.get('rollupId')!),range,url.searchParams.get('split')==='site'));
   if(path==='/api/vane/summary')return json(await createInsightsService(env,await site(env,url.searchParams.get('siteId')??''),clock(),range).list());
   if(path==='/api/vane/realtime')return json(await realtime(env,await site(env,url.searchParams.get('siteId')??''),clock()));
   if(path==='/api/vane/inventory')return json(inventory(await site(env,url.searchParams.get('siteId')??'')));
   if(path==='/api/vane/audit')return json(await auditLog(env,actor));
   if(path==='/api/vane/proposals') {role(actor,['owner','admin']);return json(await rows(env,'SELECT * FROM vane_proposals ORDER BY created_at DESC'));}
   if(path==='/api/vane/import-journal')return json(await journal(env,actor,{siteId:url.searchParams.get('siteId')??'',jobId:url.searchParams.get('jobId')??''}));
   if(path==='/api/vane/export'&&url.searchParams.has('siteId')) { const id=url.searchParams.get('siteId')!; return new Response(JSON.stringify(await exportSite(env,actor,id),null,2),{headers:{...headers,'content-type':'application/json','content-disposition':`attachment; filename="vane-site-${id}.json"`}}); }
   if(path==='/api/vane/export')return new Response(JSON.stringify(await exportHistory(env,actor),null,2),{headers:{...headers,'content-type':'application/json','content-disposition':'attachment; filename="vane-history.json"'}});
   if(path==='/app')return view();
   const match=path.match(/^\/app\/sites\/([\w-]+)$/);if(match)return view(match[1]);
   const rolled=path.match(/^\/app\/rollups\/([\w-]+)$/);if(rolled){const r=await rollup(env,rolled[1]!);return view(undefined,{rollup:r,report:await rollupReport(env,r,range,url.searchParams.get('split')==='site')})}
  }
  if(request.method==='POST') {
   const p=await input(request);
   if(path==='/api/vane/commands')return json(await prepare(env,actor,p.command,p.input??{},'command API'),201);
   if(path==='/api/vane/import-preview')return json(await preview(env,actor,{siteId:p.siteId,document:p.document}));
   if(path==='/api/vane/import-apply')return json(await apply(env,actor,{siteId:p.siteId,document:p.document,fingerprint:p.fingerprint}));
   if(path==='/api/vane/import-undo')return json(await undo(env,actor,{siteId:p.siteId,jobId:p.jobId}));
   if(path==='/api/vane/install-check')return json(await verifyInstallation(env,actor,p.siteId));
   if(path==='/api/vane/site-import')return json(await importSite(env,actor,p.archive),201);
   if(path==='/api/vane/restore')return json(await restoreHistory(env,actor,p.archive,p.journal));
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
    if(p.operation==='rollup.create')return redirect('/app/rollups/'+encodeURIComponent(await createRollup(env,actor,p))+'?'+new URLSearchParams({notice:'Roll-up created.'}));
    const result=await action(env,actor,p),query=new URLSearchParams({notice:result.notice,...(result.section?{section:result.section}:{})});
    // DASH-009: a new annotation secret is rendered once in this response, never put in a redirect URL.
    if(result.secret)return view(result.siteId,{section:result.section,notice:result.notice,secret:result.secret});
    return redirect((result.siteId?'/app/sites/'+encodeURIComponent(result.siteId):'/app')+'?'+query);
   }
  }
  return json({error:'not_found'},404);
 } catch(error) {
  const known=error instanceof VaneError||error instanceof MoveinError;
  const message=known?error.message:'The operation could not complete. Check the document and refresh before trying again.';
  const status=known?error.status:400;
  if(path.startsWith('/app')&&actor) {const response=await view(undefined,{error:message,section:undefined});return new Response(response.body,{status,headers:response.headers});}
  return json({error:known?error.code:'invalid_operation',message},status);
 }
}

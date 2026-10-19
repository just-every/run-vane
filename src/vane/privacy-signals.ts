import { day, insist, site, VaneError, type Env } from './core'
// PRIVACY-002: Global Privacy Control and Do Not Track stop collection. When the owner
// turns the counter on, the script sends one field-free count per signalling page load.
export const stance = [
 'Global Privacy Control and Do Not Track are honoured by default: when a browser sends either signal, vane.js collects nothing.',
 'Vane never sells or shares visitor data for cross-context behavioural advertising under the California Consumer Privacy Act as amended by the CPRA, and never processes it for targeted advertising, sale or profiling under the other US state privacy laws (including Virginia, Colorado, Connecticut, Utah, Texas and Oregon). Global Privacy Control is treated as a valid opt-out preference signal regardless.',
 'With the privacy-signal counter on, a signalling page load sends one count that carries no path, source, campaign or identifier, only which site it is for, so the owner can see how much traffic sends a signal.',
]

export async function signalResponse(request:Request,env:Env):Promise<Response|null> {
 const match=new URL(request.url).pathname.match(/^\/api\/vane\/signal\/([\w-]+)$/);
 if(!match)return null;
 let cors:Record<string,string>={'vary':'Origin','cache-control':'no-store'};
 try {
  insist(request.method==='POST','method','POST required.',405);
  const value=await site(env,match[1]!);
  insist(request.headers.get('origin')===value.origin,'origin','Origin is not registered for this site.',403);
  cors={...cors,'access-control-allow-origin':value.origin};
  insist(value.config.signalCounter===true,'signal_counter_off','This site does not count privacy signals.',403);
  insist((await request.text())==='','fields','The privacy-signal count carries no fields.');
  await env.DB.prepare('INSERT INTO vane_signals(site_id,day,count) VALUES(?,?,1) ON CONFLICT(site_id,day) DO UPDATE SET count=count+1 WHERE count<100000').bind(value.id,day()).run();
  return Response.json({counted:true},{status:202,headers:cors});
 } catch(error) { const e=error instanceof VaneError?error:new VaneError('invalid_signal','Signal could not be counted.'); return Response.json({error:e.code,message:e.message},{status:e.status,headers:cors}); }
}

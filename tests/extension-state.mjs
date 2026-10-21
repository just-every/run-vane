import assert from 'node:assert/strict'
import { setTimeout as delay } from 'node:timers/promises'

// Use uBlock's own Filter lists page without changing extension settings. On a
// fresh Chromium install uBlock reloads itself once after recording its version.
async function background(port, previous) {
 const deadline=Date.now()+30000;let targets=[];
 while(Date.now()<deadline){
  targets=await(await fetch('http://127.0.0.1:'+port+'/json/list')).json();
  const target=targets.find(t=>t.type==='background_page'&&t.url.startsWith('chrome-extension://')&&t.id!==previous);
  if(target)return target;await delay(200);
 }
 assert.fail('The actual uBlock background must load: '+JSON.stringify(targets.map(t=>({id:t.id,type:t.type,url:t.url}))));
}

export async function extensionState(port,context) {
 let target=await background(port),page;
 const open=async()=>{
  page=await context.newPage();
  await page.goto(new URL('/3p-filters.html',target.url).href);
  await page.locator('.listEntry.checked[data-key="easyprivacy"]').waitFor({timeout:60000});
 };
 try {await open()}
 catch(error){
  // Only the observed first-install extension reload can close this owned UI.
  // A browser crash, a timeout or an unchanged background remains a failure.
  if(!page?.isClosed()||!context.browser().isConnected())throw error;
  target=await background(port,target.id);
  await open();
 }
 const read=async()=>{
  const state=await page.evaluate(()=>globalThis.vAPI.messaging.send('dashboard',{what:'getLists'}));
  assert.ok(state&&state.netFilterCount>0,'uBlock must have an active network-filter engine');
  const selected=Object.entries(state.current).filter(([,entry])=>entry.off!==true).map(([key])=>key).sort();
  const easyprivacy=state.current.easyprivacy;
  assert.ok(selected.includes('easyprivacy')&&easyprivacy?.entryUsedCount>0,'Default EasyPrivacy must be selected and compiled');
  return {selected,easyprivacy,netFilterCount:state.netFilterCount};
 };
 return {read,page,close:()=>page.close()};
}

// Let the extension finish its normal fresh-install reload before Playwright's
// browser-wide autoattach takes control. This CDP session only reads readiness.
async function readyTarget(target) {
 const socket=new WebSocket(target.webSocketDebuggerUrl),pending=new Map();let id=0;
 const closed=Object.assign(new Error('Extension background reloaded'),{code:'EXTENSION_RELOADED'});
 socket.addEventListener('message',event=>{
  const result=JSON.parse(event.data),call=pending.get(result.id);
  if(!call)return;pending.delete(result.id);
  if(result.error)call.reject(new Error(result.error.message));else call.resolve(result.result);
 });
 socket.addEventListener('close',()=>{for(const call of pending.values())call.reject(closed);pending.clear()});
 await new Promise((resolve,reject)=>{socket.addEventListener('open',resolve,{once:true});socket.addEventListener('error',reject,{once:true})});
 const evaluate=expression=>new Promise((resolve,reject)=>{
  const request=++id;pending.set(request,{resolve,reject});
  socket.send(JSON.stringify({id:request,method:'Runtime.evaluate',params:{expression,awaitPromise:true,returnByValue:true}}));
 });
 const deadline=Date.now()+60000;
 try {
  while(Date.now()<deadline){
   const state=await evaluate("typeof vAPI !== 'undefined' && typeof vAPI.defer?.create === 'function' && typeof vAPI.messaging?.defaultHandler === 'function'");
   if(state.result?.value===true)break;
   await delay(100);
  }
  const result=await Promise.race([
   evaluate("import('./js/background.js').then(async ({default:u})=>{await u.isReadyPromise;return u.supportStats.allReadyAfter})"),
   delay(60000,undefined,{ref:false}).then(()=>{throw new Error('uBlock did not finish loading its default lists')})
  ]);
  assert.ok(!result.exceptionDetails,'The real uBlock background must initialize: '+JSON.stringify(result.exceptionDetails));
  assert.equal(typeof result.result?.value,'string','uBlock must report completed normal initialization');
 } finally {socket.close()}
}
export async function extensionStartup(port) {
 const first=await background(port);
 try {await readyTarget(first)}
 catch(error){
  if(error.code!=='EXTENSION_RELOADED')throw error;
  await readyTarget(await background(port,first.id));
 }
}

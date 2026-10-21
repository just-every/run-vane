import assert from 'node:assert/strict'
import { setTimeout as delay } from 'node:timers/promises'

// Current Playwright removed its MV2 backgroundPage API. Read the actual legacy
// extension target over CDP, without changing its settings or filtering state.
export async function extensionBackground(port) {
 const endpoint='http://127.0.0.1:'+port+'/json/list',deadline=Date.now()+30000;
 let targets=[],target;
 while(Date.now()<deadline){
  targets=await(await fetch(endpoint)).json();
  target=targets.find(t=>t.type==='background_page'&&t.url.startsWith('chrome-extension://'));
  if(target)break;
  await delay(200);
 }
 assert.ok(target,'The actual uBlock extension background must load: '+JSON.stringify(targets.map(t=>({type:t.type,url:t.url}))));
 const socket=new WebSocket(target.webSocketDebuggerUrl);
 await new Promise((resolve,reject)=>{socket.addEventListener('open',resolve,{once:true});socket.addEventListener('error',reject,{once:true});});
 let id=0;const pending=new Map();
 socket.addEventListener('message',event=>{
  const result=JSON.parse(event.data),call=pending.get(result.id);if(!call)return;
  pending.delete(result.id);clearTimeout(call.timer);
  result.error?call.reject(new Error(JSON.stringify(result.error))):call.resolve(result.result);
 });
 const send=(method,params)=>new Promise((resolve,reject)=>{
  const key=++id,timer=setTimeout(()=>{pending.delete(key);reject(new Error('Extension CDP request timed out: '+method));},30000);
  pending.set(key,{resolve,reject,timer});socket.send(JSON.stringify({id:key,method,params}));
 });
 await send('Runtime.enable',{});
 const started=Date.now()+60000;let initialized=false;
 while(Date.now()<started){
  const state=await send('Runtime.evaluate',{expression:"location.pathname === '/background.html' && typeof globalThis.vAPI?.defer?.create === 'function' && typeof globalThis.vAPI?.messaging?.defaultHandler === 'function'",returnByValue:true});
  if(state.result.value===true){initialized=true;break;}await delay(200);
 }
 assert.ok(initialized,'uBlock must initialize its own modules before inspection');
 const evaluate=async fn=>{
  const result=await send('Runtime.evaluate',{expression:`(async()=>{const {default:u}=await import('./js/background.js');await u.isReadyPromise;return (${fn.toString()})(u)})()`,awaitPromise:true,returnByValue:true});
  assert.ok(!result.exceptionDetails,JSON.stringify(result.exceptionDetails));return result.result.value;
 };
 return {evaluate,async waitForFunction(fn,_arg,{timeout=60000}={}){
  const until=Date.now()+timeout;while(Date.now()<until){if(await evaluate(fn))return;await delay(200);}throw new Error('Actual uBlock did not become ready to filter');
 },close:()=>{socket.close();for(const call of pending.values()){clearTimeout(call.timer);call.reject(new Error('Extension CDP closed'));}pending.clear();}};
}

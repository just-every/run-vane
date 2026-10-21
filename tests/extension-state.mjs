import assert from 'node:assert/strict'
import { setTimeout as delay } from 'node:timers/promises'

// Use uBlock's own Filter lists page without changing extension settings. On a
// fresh Chromium install uBlock reloads itself once after recording its version.
async function background(port) {
 const deadline=Date.now()+30000;let targets=[];
 while(Date.now()<deadline){
  targets=await(await fetch('http://127.0.0.1:'+port+'/json/list')).json();
  const target=targets.find(t=>t.type==='background_page'&&t.url.startsWith('chrome-extension://'));
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
  // A browser crash or a timeout remains a failure.
  if(!page?.isClosed()||!context.browser().isConnected())throw error;
  target=await background(port);
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


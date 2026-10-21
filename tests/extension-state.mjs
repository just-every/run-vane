import assert from 'node:assert/strict'
import { setTimeout as delay } from 'node:timers/promises'

// Read uBlock through its own Filter lists page. Current Playwright removed its
// MV2 backgroundPage API; no background modules or extension settings are changed.
export async function extensionState(port,context) {
 const deadline=Date.now()+30000;let targets=[],target;
 while(Date.now()<deadline){
  targets=await(await fetch('http://127.0.0.1:'+port+'/json/list')).json();
  target=targets.find(t=>t.type==='background_page'&&t.url.startsWith('chrome-extension://'));
  if(target)break;await delay(200);
 }
 assert.ok(target,'The actual uBlock background must load: '+JSON.stringify(targets.map(t=>({type:t.type,url:t.url}))));
 const page=await context.newPage();
 await page.goto(new URL('/3p-filters.html',target.url).href);
 await page.locator('.listEntry.checked[data-key="easyprivacy"]').waitFor({timeout:60000});
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

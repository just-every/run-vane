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
  const versions={};
  for(const key of selected){
   const asset=await page.evaluate(key=>globalThis.vAPI.messaging.send('default',{what:'getAssetContent',url:key}),key);
   assert.equal(typeof asset?.content,'string','Read the active list '+key);
   const {createHash}=await import('node:crypto');
   versions[key]={title:state.current[key].title,sha256:createHash('sha256').update(asset.content).digest('hex'),
    sourceURL:asset.sourceURL??null,writeTime:state.cache?.[key]?.writeTime??null,
    lastModified:asset.content.match(/^!\s*Last modified:\s*(.+)$/im)?.[1]??null,entries:state.current[key].entryUsedCount};
  }
  return {selected,easyprivacy,netFilterCount:state.netFilterCount,versions,isUpdating:state.isUpdating};
 };
 // Refresh the selected defaults, without changing any filter, setting or list.
 const update=async()=>{
  await page.evaluate(async()=>{const state=await globalThis.vAPI.messaging.send('dashboard',{what:'getLists'});await globalThis.vAPI.messaging.send('dashboard',{what:'listsUpdateNow',assetKeys:Object.entries(state.current).filter(([key,value])=>value.off!==true&&key!==state.userFiltersPath).map(([key])=>key),preferOrigin:true})});
  const deadline=Date.now()+90000;
  while(Date.now()<deadline){
   await delay(1000);
   const state=await page.evaluate(()=>globalThis.vAPI.messaging.send('dashboard',{what:'getLists'}));
   if(!state.isUpdating)return;
  }
  assert.fail('The current default lists must finish updating before the site loads');
 };
 return {read,update,page,close:()=>page.close()};
}


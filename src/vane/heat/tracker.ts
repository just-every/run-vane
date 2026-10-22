// Included inside the existing tracker closure. These geometry fields are shared
// with an owner-selected browser tab through Capture Handle only, never sent to Vane.
export const heatTracker=String.raw`
const heatPages=c.heatPaths||[];
const heatHandle=()=>{if(!heatPages.length||!c.heatCaptureOrigin||!navigator.mediaDevices?.setCaptureHandleConfig)return;const path=pathOf(new URL(location.href));try{navigator.mediaDevices.setCaptureHandleConfig({exposeOrigin:true,permittedOrigins:[c.heatCaptureOrigin],handle:heatPages.includes(path)?JSON.stringify({vaneHeat:1,siteId:id,path,width:innerWidth,height:innerHeight,documentWidth:document.documentElement.scrollWidth,documentHeight:document.documentElement.scrollHeight,scrollX,scrollY}):''})}catch{}};
addEventListener('resize',heatHandle,{passive:true});
if(heatPages.length&&'ResizeObserver' in window)new ResizeObserver(heatHandle).observe(document.documentElement);
document.addEventListener('click',e=>{if(!page||!e.isTrusted||!heatPages.includes(last)||document.visibilityState!=='visible')return;const d=document.documentElement;if(!d.scrollWidth||!d.scrollHeight)return;post('/api/vane/heat-click',{siteId:id,path:last,kind:'click',x:Math.min(39,Math.max(0,Math.floor((e.clientX+scrollX)/d.scrollWidth*40))),y:Math.min(99,Math.max(0,Math.floor((e.clientY+scrollY)/d.scrollHeight*100))),width:innerWidth,consent:consentValue()},true).catch(()=>{})},true);
`

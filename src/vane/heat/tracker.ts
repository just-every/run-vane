// Included inside the existing tracker closure. These geometry fields are shared
// with an owner-selected browser tab through Capture Handle. Only anonymous grid
// rectangles and page height also accompany clicks; no DOM content is read.
export const heatTracker=String.raw`
const heatPages=c.heatPaths||[];
const heatHandle=()=>{if(!heatPages.length||!c.heatCaptureOrigin||!navigator.mediaDevices?.setCaptureHandleConfig)return;const path=pathOf(new URL(location.href));try{navigator.mediaDevices.setCaptureHandleConfig({exposeOrigin:true,permittedOrigins:[c.heatCaptureOrigin],handle:heatPages.includes(path)?JSON.stringify({vaneHeat:1,siteId:id,path,width:innerWidth,height:innerHeight,documentWidth:document.documentElement.scrollWidth,documentHeight:document.documentElement.scrollHeight,scrollX,scrollY}):''})}catch{}};
addEventListener('resize',heatHandle,{passive:true});
if(heatPages.length&&'ResizeObserver' in window)new ResizeObserver(heatHandle).observe(document.documentElement);
const heatLayout=()=>{const d=document.documentElement,blocks=[];for(const el of document.querySelectorAll('header,nav,main,section,article,aside,footer,button,a,input,select,textarea,img,video')){const r=el.getBoundingClientRect();if(!r.width||!r.height)continue;const x=Math.max(0,Math.min(39,Math.floor((r.left+scrollX)/d.scrollWidth*40))),y=Math.max(0,Math.min(99,Math.floor((r.top+scrollY)/d.scrollHeight*100))),w=Math.min(40-x,Math.max(1,Math.ceil(r.width/d.scrollWidth*40))),h=Math.min(100-y,Math.max(1,Math.ceil(r.height/d.scrollHeight*100)));blocks.push({x,y,w,h});if(blocks.length===200)break}return {height:Math.min(10000000,d.scrollHeight),blocks}};
document.addEventListener('click',e=>{if(!page||!e.isTrusted||!heatPages.includes(last)||document.visibilityState!=='visible')return;const d=document.documentElement;if(!d.scrollWidth||!d.scrollHeight)return;post('/api/vane/heat-click',{siteId:id,path:last,kind:'click',x:Math.min(39,Math.max(0,Math.floor((e.clientX+scrollX)/d.scrollWidth*40))),y:Math.min(99,Math.max(0,Math.floor((e.clientY+scrollY)/d.scrollHeight*100))),width:innerWidth,consent:consentValue(),geometry:heatLayout()},true).catch(()=>{})},true);
`

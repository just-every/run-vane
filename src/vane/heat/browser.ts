// Native browser capture only. No screenshot service, image upload or storage.
// The permission picker is a real user gesture. Refuse unsupported browsers and
// wrong tabs rather than displaying a synthetic or unverified page background.
export const heatScript=String.raw`(()=>{
const root=document.querySelector('[data-heat]');if(!root)return;
const state=JSON.parse(root.dataset.heat),button=root.querySelector('[data-heat-capture]'),status=root.querySelector('[data-heat-status]'),ns='http://www.w3.org/2000/svg';
const tell=text=>{status.textContent=text},element=(name,attrs)=>{const el=document.createElementNS(ns,name);for(const [k,v] of Object.entries(attrs))el.setAttribute(k,String(v));return el};
let active=null;
addEventListener('pagehide',()=>{if(active)active.getTracks().forEach(t=>t.stop())});
button?.addEventListener('click',async()=>{
 if(!navigator.mediaDevices?.getDisplayMedia){tell('Live capture needs a browser with tab sharing and Capture Handle support, such as current desktop Chrome.');return}
 button.disabled=true;let stream=null,video=null;
 try{
  stream=await navigator.mediaDevices.getDisplayMedia({video:{displaySurface:'browser'},audio:false,monitorTypeSurfaces:'exclude',selfBrowserSurface:'exclude',surfaceSwitching:'exclude'});active=stream;
  const track=stream.getVideoTracks()[0],settings=track?.getSettings();
  if(!track||settings.displaySurface!=='browser'||typeof track.getCaptureHandle!=='function')throw Error('Choose the tracked page’s browser tab. This browser must support Capture Handle; windows and screens are refused.');
  // Chromium suppresses cross-tab Capture Handles in private contexts, even when both tabs share one context.
  // https://chromium.googlesource.com/chromium/src/+/lkgr/content/browser/media/capture_handle_manager.cc
  const handle=()=>{const capture=track.getCaptureHandle();if(!capture)throw Error('This tab could not be verified. Open Vane and the tracked page in normal, non-private browser windows: private windows block cross-tab verification. Reload the tracked page with its Vane script, then select that tab again.');if(capture.origin!==state.origin)throw Error('The selected tab is not this site. Choose the tracked page at '+state.origin+'.');let h;try{h=JSON.parse(capture.handle)}catch{throw Error('The selected tab has no enabled Vane page. Reload the tracked page after enabling it.')}if(h.vaneHeat!==1||h.siteId!==state.siteId||h.path!==state.path)throw Error('The selected tab is not this enabled page. Choose '+state.origin+state.path+'.');for(const k of ['width','height','documentWidth','documentHeight','scrollX','scrollY'])if(!Number.isFinite(h[k])||h[k]<0)throw Error('The page’s capture geometry is unavailable.');if(h.width!==state.width)throw Error('This page is '+h.width+' CSS pixels wide. Set the map’s viewport width to '+h.width+' and load it again.');if(!h.width||!h.height||!h.documentWidth||!h.documentHeight)throw Error('The page’s capture geometry is unavailable.');return h};
  const before=handle();video=document.createElement('video');video.muted=true;video.srcObject=stream;
  await Promise.race([video.play(),new Promise((_,reject)=>setTimeout(()=>reject(Error('The browser did not produce a live frame. Stop sharing and try again.')),10000))]);
  if(video.readyState<2)throw Error('The browser has not produced a live frame. Capture the tracked tab again.');
  const h=handle();if(JSON.stringify(before)!==JSON.stringify(h))throw Error('The page moved during capture. Keep it still and capture again.');
  const width=video.videoWidth,height=video.videoHeight;if(!width||!height||Math.abs(width/height-h.width/h.height)>.03)throw Error('The shared image does not match the page viewport. Share the browser tab itself.');
  const canvas=document.createElement('canvas');canvas.width=width;canvas.height=height;canvas.getContext('2d').drawImage(video,0,0);const image=canvas.toDataURL('image/png');
  const project=(x,y)=>[(x-h.scrollX)/h.width*width,(y-h.scrollY)/h.height*height],max=Math.max(1,...state.cells.map(c=>c.count));
  for(const kind of ['click','scroll']){
   const svg=root.querySelector('[data-heat-'+kind+']');svg.replaceChildren(element('image',{href:image,x:0,y:0,width,height}));svg.setAttribute('viewBox','0 0 '+width+' '+height);svg.hidden=false;svg.removeAttribute('hidden');
   if(kind==='click')for(const cell of state.cells){const [x,y]=project(cell.x/40*h.documentWidth,cell.y/100*h.documentHeight),rect=element('rect',{x,y,width:h.documentWidth/40/h.width*width,height:h.documentHeight/100/h.height*height,fill:'#f64b17','fill-opacity':.2+.65*cell.count/max});const title=element('title',{});title.textContent=cell.count+' clicks in grid cell '+cell.x+', '+cell.y;rect.append(title);svg.append(rect)}
   else for(let depth=0;depth<100;depth+=10){const band=state.scroll.bands.find(b=>b.depth===depth),[,y]=project(0,depth/100*h.documentHeight);if(band?.share!==null&&band?.share!==undefined)svg.append(element('rect',{x:0,y,width,height:h.documentHeight/10/h.height*height,fill:'#1c70c5','fill-opacity':.12+.48*band.share/100}))}
  }
  root.querySelector('[data-heat-images]').hidden=false;root.querySelector('[data-heat-empty]').hidden=true;tell('Live screenshot captured locally: '+h.width+' × '+h.height+' CSS pixels, '+Math.round(h.scrollY)+' px down the page. Sharing stopped. No image was uploaded or saved.');
 }catch(error){tell(error.name==='NotAllowedError'?'Tab sharing was declined. Choose Capture live page when you are ready.':error.message||'Live capture failed. Choose the tracked page’s browser tab.')}
 finally{if(stream)stream.getTracks().forEach(t=>t.stop());if(video){video.srcObject=null;video.remove()}active=null;button.disabled=false}
});
})();`

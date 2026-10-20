// The hero's white wind, carried down the whole page as one path. Each section
// marks where it passes with [data-trail] dots and bends (ordered by their
// number); the script joins their centres with a smooth curve, behind every
// card, fading in under the hero and out behind the swallow's tail. It redraws
// whenever the page reflows. Phones hide it (the desk's 390 plan has no trail).
export const trailSvg = '<svg class="trail" aria-hidden="true" focusable="false"><defs><linearGradient id="trail-fade" gradientUnits="userSpaceOnUse" x1="0" x2="0"><stop offset="0" stop-color="#fff" stop-opacity="0"/><stop class="fade-in" stop-color="#fff"/><stop class="fade-out" stop-color="#fff"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></linearGradient></defs>'
  + '<path class="trail-glow" stroke="url(#trail-fade)"/><path class="trail-line" stroke="url(#trail-fade)"/></svg>'

// Each bend's tangent follows its neighbours; control arms are a third of the chord, so the curve never loops.
export const trailScript = "(()=>{const main=document.getElementById('main'),svg=main&&main.querySelector('.trail');if(!svg)return;const fade=svg.querySelector('#trail-fade'),paths=svg.querySelectorAll('path');"
  + "const draw=()=>{if(getComputedStyle(svg).display==='none')return;const box=main.getBoundingClientRect(),pts=[...main.querySelectorAll('[data-trail]')].filter(e=>e.getClientRects().length).map(e=>{const r=e.getBoundingClientRect();return[r.left+r.width/2-box.left,r.top+r.height/2-box.top,+e.dataset.trail]}).sort((a,b)=>a[2]-b[2]);if(pts.length<2)return;"
  + "const unit=(a,b)=>{const x=b[0]-a[0],y=b[1]-a[1],l=Math.hypot(x,y)||1;return[x/l,y/l]},tan=pts.map((p,i)=>unit(pts[Math.max(i-1,0)],pts[Math.min(i+1,pts.length-1)])),r=v=>Math.round(v*10)/10;"
  + "let d='M'+r(pts[0][0])+' '+r(pts[0][1]);for(let i=0;i<pts.length-1;i++){const a=pts[i],b=pts[i+1],k=Math.hypot(b[0]-a[0],b[1]-a[1])/3;d+='C'+r(a[0]+tan[i][0]*k)+' '+r(a[1]+tan[i][1]*k)+' '+r(b[0]-tan[i+1][0]*k)+' '+r(b[1]-tan[i+1][1]*k)+' '+r(b[0])+' '+r(b[1])}"
  + "const top=pts[0][1],end=pts[pts.length-1][1],span=Math.max(end-top,1);svg.setAttribute('viewBox','0 0 '+r(box.width)+' '+r(box.height));svg.style.height=box.height+'px';fade.setAttribute('y1',top);fade.setAttribute('y2',end);"
  + "fade.querySelector('.fade-in').setAttribute('offset',Math.min(260/span,.2));fade.querySelector('.fade-out').setAttribute('offset',1-Math.min(220/span,.2));paths.forEach(p=>p.setAttribute('d',d))};"
  + "let queued=0;const soon=()=>{if(!queued){queued=1;requestAnimationFrame(()=>{queued=0;draw()})}};new ResizeObserver(soon).observe(main);document.fonts&&document.fonts.ready.then(soon);addEventListener('load',soon)})()"

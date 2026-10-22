import type { HeatReport } from '../heat/report'

export function heatGeometryMaps(h:HeatReport):string {
 const g=h.geometry
 if(!g)return '<p data-heat-geometry-empty>No page geometry recorded at this width in this period. Click an enabled page to record its anonymous layout grid.</p>'
 const scale=(x:number,y:number,w:number,height:number)=>`x="${x/40*h.width}" y="${y/100*g.height}" width="${w/40*h.width}" height="${height/100*g.height}"`
 const background=`<rect width="${h.width}" height="${g.height}" fill="#faf8f0"/>${g.blocks.map(b=>`<rect data-heat-block ${scale(b.x,b.y,b.w,b.h)} fill="#dce5e2" fill-opacity="0.5" stroke="#738c85" stroke-width="1"/>`).join('')}`
 const max=Math.max(1,...h.cells.map(c=>c.count))
 const clicks=h.cells.map(c=>`<rect data-heat-cell ${scale(c.x,c.y,1,1)} fill="#f64b17" fill-opacity="${.2+.65*c.count/max}"><title>${c.count} clicks</title></rect>`).join('')
 const scroll=h.scroll.bands.filter(b=>b.depth%10===0&&b.depth<100&&b.share!==null).map(b=>`<rect ${scale(0,b.depth,40,10)} fill="#1c70c5" fill-opacity="${.12+.48*b.share!/100}"><title>${b.share}% reached ${b.depth}% depth</title></rect>`).join('')
 return `<p>The background is the latest recorded anonymous layout grid in this period at ${h.width} CSS pixels. Blocks contain no image, text or element identifiers. Layouts may change over time.</p>${[['click','Click grid',clicks],['scroll','Scroll reach',scroll]].map(([kind,label,overlay])=>`<figure><figcaption>${label} over recorded page geometry</figcaption><svg data-heat-geometry="${kind}" viewBox="0 0 ${h.width} ${g.height}" width="100%" height="600" role="img" aria-label="${label} over recorded anonymous page geometry">${background}${overlay}</svg></figure>`).join('')}`
}

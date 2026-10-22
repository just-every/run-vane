import { insist } from '../core'

export interface HeatGeometry { height:number; blocks:{x:number;y:number;w:number;h:number}[] }
// The only layout custody is bounded rectangles on the same anonymous 40 × 100 grid.
export function heatGeometry(value:unknown):HeatGeometry {
 const g=value as HeatGeometry
 insist(g&&typeof g==='object'&&Object.keys(g).length===2&&Number.isInteger(g.height)&&g.height>=1&&g.height<=10000000&&Array.isArray(g.blocks)&&g.blocks.length<=200,'heat_geometry','Send only page height and up to 200 layout grid rectangles.')
 for(const b of g.blocks)insist(b&&Object.keys(b).length===4&&['x','y','w','h'].every(k=>Object.hasOwn(b,k)&&Number.isInteger(b[k as keyof typeof b]))&&b.x>=0&&b.y>=0&&b.w>0&&b.h>0&&b.x+b.w<=40&&b.y+b.h<=100,'heat_geometry','Layout blocks must fit the anonymous page grid.')
 return g
}

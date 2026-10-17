// Shared pieces of the homepage: a feature section (copy beside its drawing),
// the green "handled" chip under a drawing, and responsive painted art.
import { icons } from './icons'

export interface Feature { id: string; eyebrow: string; title: string; body: string; drawing: string; flip?: boolean }

// `title` may carry one <br> where the desk breaks the heading.
export const feature = ({ id, eyebrow, title, body, drawing, flip }: Feature) => `<section class="feature${flip ? ' flip' : ''}" id="${id}" aria-labelledby="${id}-title"><div class="wrap feature-grid"><div class="feature-copy"><p class="eyebrow">${eyebrow}</p><h2 id="${id}-title">${title}</h2><p class="lede">${body}</p></div><div class="feature-drawing">${drawing}</div></div></section>`

export const card = (label: string, body: string, className = '') => `<figure class="card ${className}" aria-label="${label}">${body}</figure>`

export const handled = (text: string, lead = '') => `<p class="handled">${lead}<span class="handled-check">${icons.check}</span><span>${text} <span class="handled-tick">${icons.tick}</span></span></p>`

const widths: Record<string, number[]> = { hero: [768, 1152, 1536], interlude: [768, 1152, 1536], closing: [768, 1152, 1536], 'hero-phone': [480, 836], 'interlude-phone': [480, 900], 'closing-phone': [480, 900] }
const srcset = (name: string, type: string) => widths[name].map(w => `/site/art/${name}-${w}.${type} ${w}w`).join(', ')

// The wide painting above 760 px and its phone crop below; `eager` for the first screen only.
export function art(name: 'hero' | 'interlude' | 'closing', size: { width: number; height: number }, eager = false) {
  const phone = `${name}-phone`, load = eager ? 'fetchpriority="high"' : 'loading="lazy"'
  return `<picture class="art art-${name}"><source media="(max-width: 760px)" type="image/avif" srcset="${srcset(phone, 'avif')}" sizes="100vw"><source media="(max-width: 760px)" type="image/webp" srcset="${srcset(phone, 'webp')}" sizes="100vw">`
    + `<source type="image/avif" srcset="${srcset(name, 'avif')}" sizes="100vw"><source type="image/webp" srcset="${srcset(name, 'webp')}" sizes="100vw">`
    + `<img src="/site/art/${name}-1536.webp" width="${size.width}" height="${size.height}" alt="" decoding="async" ${load}></picture>`
}

// A card on the painting, centered at (--x, --y) in the art's 1536-unit space, --w wide, tilted --r.
export const skyCard = (name: string, place: { x: number; y: number; w: number; r: number }, body: string) => `<div class="sky-card sky-${name}" style="--x:${place.x};--y:${place.y};--w:${place.w};--r:${place.r}deg">${body}</div>`

// Shared pieces of the homepage: a section's dated head, a card, the trail's
// dots, responsive painted art and the hero's cards on the painting.
import { icons } from './icons'

// Every section opens with a date stamp, so the page reads as the buyer's own week.
export const head = (id: string, eyebrow: string, title: string, body: string) => `<p class="eyebrow">${eyebrow}</p><h2 id="${id}-title">${title}</h2><p class="lede">${body}</p>`

export const card = (label: string, body: string, className = '') => `<figure class="card ${className}" aria-label="${label}">${body}</figure>`

// A dot on the wind trail; `order` places it on the one path that runs down the page (see trail.ts).
export const trailDot = (order: number, tone: 'gold' | 'hollow', className = '') => `<span class="trail-dot trail-${tone}${className ? ` ${className}` : ''}" data-trail="${order}" aria-hidden="true"></span>`
// An invisible bend in the trail, placed by CSS in its section.
export const bend = (order: number, name: string) => `<i class="trail-bend bend-${name}" data-trail="${order}" aria-hidden="true"></i>`

// Text for wider screens and the phone plan's shorter wording; only one of the two is shown.
export const byWidth = (wide: string, phone: string) => `<span class="not-phone">${wide}</span><span class="phone-only">${phone}</span>`

export const check = (text: string) => `<span class="state-check">${icons.check}</span><span>${text}</span>`

const widths: Record<string, number[]> = { hero: [768, 1152, 1536, 2304, 3072], interlude: [768, 1152, 1536, 2304, 3072], closing: [768, 1152, 1536, 2304, 3072], 'hero-phone': [480, 836], 'interlude-phone': [480, 900], 'closing-phone': [480, 900] }
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

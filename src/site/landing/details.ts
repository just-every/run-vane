// Page 08: the quiet details, six cards in two rows.
import { icons } from './icons'

const details = [
  ['blue', icons.filter, 'Bot filtering', 'Crawlers and data centers stay out of your counts.'],
  ['green', icons.external, 'Outbound links', 'Clicks to other sites, counted on their own.'],
  ['orange', icons.download, 'File downloads', 'PDFs and zips tracked with no extra code.'],
  ['blue', icons.code, 'Stats API', 'Pull any number into your own tools.'],
  ['green', icons.users, 'Team access', 'Viewers, analysts and admins for each site.'],
  ['orange', icons.history, 'Data retention', 'Keep raw events as long as you choose.'],
]

export const quietDetails = () => `<section class="details" id="details" aria-labelledby="details-title"><div class="wrap"><p class="eyebrow">Also included</p><h2 id="details-title">The quiet details.</h2>`
  + `<ul class="detail-grid">${details.map(([tone, icon, title, body]) => `<li class="detail"><span class="detail-icon tone-${tone}">${icon}</span><h3>${title}</h3><p>${body}</p></li>`).join('')}</ul></div></section>`

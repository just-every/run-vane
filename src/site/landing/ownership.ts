// Page 07: run it yourself. The terminal shows the one-line start and nothing else.
import run from '../run.json'
import { escapeHtml } from '../shell'
import { icons } from './icons'

const points = [[icons.server, 'Your own computer or your own Cloudflare account'], [icons.lock, "Your visitors' data stays yours"], [icons.share, 'Export any time']]

export const ownership = () => `<section class="feature ownership" id="ownership" aria-labelledby="ownership-title"><div class="wrap feature-grid"><div class="feature-copy"><p class="eyebrow">Ownership</p><h2 id="ownership-title">Your traffic, <br>your server.</h2>`
  + '<p class="lede"><a href="/run">Run Vane</a> on your own computer or your own Cloudflare account and keep every visit and event. Export everything, any time.</p>'
  + `<ul class="points">${points.map(([icon, text]) => `<li><span class="point-icon">${icon}</span>${text}</li>`).join('')}</ul></div>`
  + `<div class="feature-drawing"><figure class="terminal" aria-label="Start Vane with one line"><div class="terminal-bar" aria-hidden="true"><span></span><span></span><span></span></div><pre><code><span class="prompt" aria-hidden="true">$ </span>${escapeHtml(run.clone)}\n<span class="comment"># clones, installs and starts Vane on your computer</span></code></pre>`
  + `<button class="terminal-copy" type="button" data-copy="${escapeHtml(run.clone)}" hidden>Copy</button></figure></div></div></section>`

export const copyScript = "document.querySelectorAll('.terminal-copy').forEach(b=>{b.hidden=false;b.addEventListener('click',async()=>{try{await navigator.clipboard.writeText(b.dataset.copy);b.textContent='Copied';setTimeout(()=>{b.textContent='Copy'},1600)}catch{}})})"

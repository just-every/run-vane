// Line icons for the homepage drawings, 24-unit grid, drawn in currentColor.
const icon = (body: string, size = 24) => `<svg class="icon" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`

export const icons = {
  check: '<svg class="check" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="12" fill="currentColor"/><path d="m7 12.4 3.2 3.1L17 8.8" fill="none" stroke="#fff" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  ring: '<svg class="ring" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="10.6" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="m7.6 12.3 3 2.9 5.8-6" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  tick: '<svg class="tick" viewBox="0 0 16 16" aria-hidden="true"><path d="m3 8.6 3 2.9 7-7" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  up: '<svg class="up" viewBox="0 0 16 16" aria-hidden="true"><path d="M8 13V3.5M3.8 7.6 8 3.4l4.2 4.2" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  cart: icon('<path d="M2.5 3.5h2.6l2.3 11h10.4l2-7.6H6.3"/><circle cx="9" cy="19.2" r="1.4"/><circle cx="16.6" cy="19.2" r="1.4"/>'),
  user: icon('<circle cx="12" cy="8" r="3.8"/><path d="M4.5 20.5a7.5 7.5 0 0 1 15 0"/>'),
  outbound: icon('<path d="M6 18 18 6M8.5 6H18v9.5"/>'),
  file: icon('<path d="M6 2.8h8l4.5 4.5v13.9H6z"/><path d="M14 2.8v4.5h4.5"/>'),
  warning: icon('<path d="M12 3.2 21.6 20H2.4z"/><path d="M12 9.6v4.8M12 17.2h.01"/>'),
  hash: icon('<path d="M9.5 3.5 7.5 20.5M16.5 3.5l-2 17M4 9h16.5M3.5 15H20"/>', 20),
  key: icon('<circle cx="7.8" cy="15.8" r="4.3"/><path d="m10.8 12.8 9-9M16.3 7.3l2.6 2.6M18.4 5.2l2.1 2.1"/>'),
  globe: icon('<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c2.6 2.8 3.8 5.8 3.8 9s-1.2 6.2-3.8 9c-2.6-2.8-3.8-5.8-3.8-9S9.4 5.8 12 3z"/>'),
  pin: icon('<path d="M12 21s-6.5-6.1-6.5-11.2a6.5 6.5 0 0 1 13 0C18.5 14.9 12 21 12 21z"/><circle cx="12" cy="9.8" r="2.4"/>'),
  laptop: icon('<rect x="4" y="5" width="16" height="11" rx="1.6"/><path d="M2 19.5h20"/>'),
  eyeOff: icon('<path d="M3 3l18 18M10.6 5.2A10.6 10.6 0 0 1 12 5c5.5 0 9 5.3 9.5 7-.3.9-1.3 2.6-2.9 4.1M6.4 6.6C4.2 8 2.9 10.1 2.5 12c.5 1.7 4 7 9.5 7 1.7 0 3.2-.5 4.5-1.2"/><path d="M9.9 9.9a3 3 0 0 0 4.2 4.2"/>', 30),
  account: icon('<path d="M3.5 10.5 12 3.5l8.5 7V20a1 1 0 0 1-1 1h-15a1 1 0 0 1-1-1z"/><circle cx="12" cy="12.4" r="2.6"/><path d="M7.6 20.6a4.4 4.4 0 0 1 8.8 0"/>', 34),
  shieldLine: icon('<path d="M12 2.8 4.5 5.7v5.8c0 4.7 3.2 8.2 7.5 9.7 4.3-1.5 7.5-5 7.5-9.7V5.7z"/>', 34),
  download: icon('<path d="M12 3.5v11.5M7.3 10.6 12 15.3l4.7-4.7"/><path d="M3.5 16.5v3a1.5 1.5 0 0 0 1.5 1.5h14a1.5 1.5 0 0 0 1.5-1.5v-3"/>', 34),
  usersSolid: '<svg class="icon" width="22" height="22" viewBox="0 0 24 24" aria-hidden="true" fill="currentColor"><circle cx="9" cy="8" r="3.6"/><path d="M2.5 20a6.5 6.5 0 0 1 13 0z"/><circle cx="17" cy="9" r="2.8"/><path d="M14.6 13.9A5.6 5.6 0 0 1 22 19.4V20h-5.2a8 8 0 0 0-2.2-6.1z"/></svg>',
  bulb: '<svg class="icon" width="30" height="30" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3.2a6.3 6.3 0 0 0-3.8 11.3c.8.6 1.3 1.5 1.3 2.5h5c0-1 .5-1.9 1.3-2.5A6.3 6.3 0 0 0 12 3.2z" fill="#ffc83d"/><path d="M9.6 18.6h4.8M10.2 21h3.6" stroke="#a87a1c" stroke-width="1.6" stroke-linecap="round"/><path d="M12 .6v1.2M3 9.5H1.8M22.2 9.5H21M4.6 3.4l.9.9M19.4 3.4l-.9.9" stroke="#f0a92a" stroke-width="1.4" stroke-linecap="round"/></svg>',
  shield: '<svg class="icon" width="24" height="24" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2.5 4 5.6v6c0 5 3.4 8.7 8 10 4.6-1.3 8-5 8-10v-6z" fill="#e7efff" stroke="#1d58f0" stroke-width="1.8" stroke-linejoin="round"/><path d="M12 2.5v19.1c4.6-1.3 8-5 8-10v-6z" fill="#1d58f0"/></svg>',
  bars: '<svg class="icon" width="26" height="26" viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="13" width="4.2" height="8" rx="1.2" fill="#1d58f0"/><rect x="9.9" y="8" width="4.2" height="13" rx="1.2" fill="#1d58f0"/><rect x="16.8" y="3" width="4.2" height="18" rx="1.2" fill="#c8963e"/></svg>',
}

// The swallow, the real mark, as an avatar or beside a name.
export const swallow = (size = 22) => `<img class="swallow" src="/brand/mark.svg" width="${size}" height="${Math.round(size * 662 / 899)}" alt="">`

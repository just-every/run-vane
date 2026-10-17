// Line icons for the homepage drawings, 24-unit grid, drawn in currentColor.
const icon = (body: string, size = 24) => `<svg class="icon" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`

export const icons = {
  check: '<svg class="check" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="12" fill="currentColor"/><path d="m7 12.4 3.2 3.1L17 8.8" fill="none" stroke="#fff" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  minus: '<svg class="check" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="12" fill="currentColor"/><path d="M7.5 12h9" stroke="#fff" stroke-width="2.4" stroke-linecap="round"/></svg>',
  tick: '<svg class="tick" viewBox="0 0 16 16" aria-hidden="true"><path d="m3 8.6 3 2.9 7-7" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  up: '<svg class="up" viewBox="0 0 16 16" aria-hidden="true"><path d="M8 13V3.5M3.8 7.6 8 3.4l4.2 4.2" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  arrowRight: icon('<path d="M4 12h15M13 6l6 6-6 6"/>', 20),
  chevron: icon('<path d="m6 9 6 6 6-6"/>', 18),
  bell: icon('<path d="M6 9a6 6 0 1 1 12 0c0 6 2.5 7.5 2.5 7.5h-17S6 15 6 9"/><path d="M10 20a2 2 0 0 0 4 0"/>', 30),
  mail: icon('<rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3.5 6.5 8.5 6.5 8.5-6.5"/>', 26),
  link: icon('<path d="M10 14a4.5 4.5 0 0 0 6.4 0l3-3a4.5 4.5 0 0 0-6.4-6.4l-1 1"/><path d="M14 10a4.5 4.5 0 0 0-6.4 0l-3 3a4.5 4.5 0 0 0 6.4 6.4l1-1"/>', 26),
  users: icon('<circle cx="9" cy="8" r="3.4"/><path d="M2.8 20a6.2 6.2 0 0 1 12.4 0"/><circle cx="17" cy="9" r="2.6"/><path d="M16.8 14.2a5 5 0 0 1 4.6 5"/>'),
  usersSolid: '<svg class="icon" width="22" height="22" viewBox="0 0 24 24" aria-hidden="true" fill="currentColor"><circle cx="9" cy="8" r="3.6"/><path d="M2.5 20a6.5 6.5 0 0 1 13 0z"/><circle cx="17" cy="9" r="2.8"/><path d="M14.6 13.9A5.6 5.6 0 0 1 22 19.4V20h-5.2a8 8 0 0 0-2.2-6.1z"/></svg>',
  bulb: '<svg class="icon" width="30" height="30" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3.2a6.3 6.3 0 0 0-3.8 11.3c.8.6 1.3 1.5 1.3 2.5h5c0-1 .5-1.9 1.3-2.5A6.3 6.3 0 0 0 12 3.2z" fill="#ffc83d"/><path d="M9.6 18.6h4.8M10.2 21h3.6" stroke="#a87a1c" stroke-width="1.6" stroke-linecap="round"/><path d="M12 .6v1.2M3 9.5H1.8M22.2 9.5H21M4.6 3.4l.9.9M19.4 3.4l-.9.9" stroke="#f0a92a" stroke-width="1.4" stroke-linecap="round"/></svg>',
  shield: '<svg class="icon" width="24" height="24" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2.5 4 5.6v6c0 5 3.4 8.7 8 10 4.6-1.3 8-5 8-10v-6z" fill="#e7efff" stroke="#1d58f0" stroke-width="1.8" stroke-linejoin="round"/><path d="M12 2.5v19.1c4.6-1.3 8-5 8-10v-6z" fill="#1d58f0"/></svg>',
  bars: '<svg class="icon" width="26" height="26" viewBox="0 0 24 24" aria-hidden="true" fill="#1d58f0"><rect x="3" y="13" width="4.2" height="8" rx="1.2"/><rect x="9.9" y="8" width="4.2" height="13" rx="1.2"/><rect x="16.8" y="3" width="4.2" height="18" rx="1.2"/></svg>',
  file: '<svg class="icon" width="24" height="24" viewBox="0 0 24 24" aria-hidden="true"><path d="M5 2.5h9.5L20 8v13.5H5z" fill="#ffc83d"/><path d="M14.5 2.5V8H20" fill="#f0a92a"/><path d="M8.5 13h8M8.5 16.5h8" stroke="#fff" stroke-width="1.6" stroke-linecap="round"/></svg>',
  server: icon('<rect x="3.5" y="3.5" width="17" height="7" rx="2.5"/><rect x="3.5" y="13.5" width="17" height="7" rx="2.5"/><path d="M7.5 7h.01M7.5 17h.01"/>', 34),
  lock: icon('<rect x="5" y="10.5" width="14" height="10" rx="2.5"/><path d="M8 10.5V7.5a4 4 0 0 1 8 0v3"/>', 34),
  share: icon('<path d="M12 15V3.5M7.5 8 12 3.5 16.5 8"/><path d="M5 12.5V19a1.5 1.5 0 0 0 1.5 1.5h11A1.5 1.5 0 0 0 19 19v-6.5"/>', 34),
  filter: icon('<path d="M3.5 4.5h17l-6.6 8v6.3l-3.8 1.9v-8.2z"/>', 30),
  external: icon('<rect x="3.5" y="5" width="15.5" height="15.5" rx="2.5"/><path d="M12 12 20.5 3.5M14.5 3.5h6v6"/>', 30),
  download: icon('<path d="M12 3.5v11M7.5 10.5 12 15l4.5-4.5"/><path d="M4 15.5v3a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-3"/>', 30),
  code: icon('<path d="m8 7-5 5 5 5M16 7l5 5-5 5M14 4l-4 16"/>', 30),
  history: icon('<path d="M3.5 12a8.5 8.5 0 1 0 2.5-6"/><path d="M3.5 4.5V9H8M12 7.5V12l3 2"/>', 30),
}

// The swallow, small, for the agent's pill.
export const swallow = (size = 22) => `<img class="swallow" src="/brand/mark.svg" width="${size}" height="${Math.round(size * 662 / 899)}" alt="">`

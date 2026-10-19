// Line icons for the app shell, cards and the What moved panel: 24-unit paths drawn in currentColor.
const paths = {
  overview: '<path d="M4 20h16"/><path d="M6 16v-5M10 16V6M14 16v-8M18 16v-3"/>',
  pages: '<path d="M7 3h7l5 5v13H7z"/><path d="M14 3v5h5M10 13h6M10 17h6"/>',
  sources: '<circle cx="6" cy="17" r="2.5"/><circle cx="18" cy="6" r="2.5"/><circle cx="17" cy="17" r="2.5"/><path d="M8 15.5l8-8M8.5 17h6"/>',
  devices: '<rect x="3" y="4" width="14" height="11" rx="1.5"/><path d="M7 19h6"/><rect x="15" y="9" width="6" height="11" rx="1.5"/>',
  goals: '<circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="4.5"/><circle cx="12" cy="12" r="1.2"/>',
  funnels: '<path d="M4 5h16l-6 7.5V19l-4 2v-8.5z"/>',
  search: '<circle cx="11" cy="11" r="6.5"/><path d="M16 16l4.5 4.5"/>',
  realtime: '<path d="M3 12h4l2.5-6 5 12 2.5-6h4"/>',
  settings: '<circle cx="12" cy="12" r="3"/><path d="M12 3v2.5M12 18.5V21M3 12h2.5M18.5 12H21M5.6 5.6l1.8 1.8M16.6 16.6l1.8 1.8M5.6 18.4l1.8-1.8M16.6 7.4l1.8-1.8"/>',
  history: '<path d="M12 15V4M8 8l4-4 4 4"/><path d="M5 14v5h14v-5"/>',
  approvals: '<circle cx="12" cy="12" r="8.5"/><path d="M8.5 12.2l2.4 2.4 4.6-4.9"/>',
  sites: '<rect x="4" y="4" width="7" height="7" rx="1.5"/><rect x="13" y="4" width="7" height="7" rx="1.5"/><rect x="4" y="13" width="7" height="7" rx="1.5"/><rect x="13" y="13" width="7" height="7" rx="1.5"/>',
  team: '<circle cx="9" cy="9" r="3.2"/><path d="M3.5 19c.7-3.2 2.8-5 5.5-5s4.8 1.8 5.5 5"/><circle cx="17" cy="9.5" r="2.5"/><path d="M16 14.2c2.4 0 4 1.5 4.6 4.3"/>',
  key: '<circle cx="8" cy="15" r="4"/><path d="M11 12l8-8M16 7l2.5 2.5M14 9l2 2"/>',
  audit: '<path d="M8 6h12M8 12h12M8 18h12"/><circle cx="4" cy="6" r=".8"/><circle cx="4" cy="12" r=".8"/><circle cx="4" cy="18" r=".8"/>',
  calendar: '<rect x="4" y="5" width="16" height="15" rx="2"/><path d="M4 10h16M8 3v4M16 3v4"/>',
  share: '<path d="M12 15V4M8 8l4-4 4 4"/><path d="M6 12H5v8h14v-8h-1"/>',
  filter: '<path d="M4 6h16M7 12h10M10 18h4"/>',
  sparkle: '<path d="M12 3l1.9 5.6L19.5 10.5l-5.6 1.9L12 18l-1.9-5.6L4.5 10.5l5.6-1.9z"/>',
  chevron: '<path d="M9 6l6 6-6 6"/>',
  lock: '<rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/>',
  check: '<path d="M6 12.5l4 4 8-9"/>',
  visitors: '<circle cx="9" cy="8.5" r="3.2"/><path d="M3.5 19c.7-3.2 2.8-5 5.5-5s4.8 1.8 5.5 5"/><path d="M15.5 5.6a3.2 3.2 0 0 1 0 5.8M17.5 14.4c1.6.7 2.6 2.3 3 4.6"/>',
  visits: '<path d="M3 17l6-6 4 4 8-8"/><path d="M15 7h6v6"/>',
  percent: '<path d="M5 19L19 5"/><circle cx="7" cy="7" r="2.5"/><circle cx="17" cy="17" r="2.5"/>',
  clock: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>',
  pageviews: '<path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z"/><circle cx="12" cy="12" r="2.8"/>',
  note: '<path d="M5 4h14v12l-4 4H5z"/><path d="M15 20v-4h4M8.5 9h7M8.5 13h4"/>',
  code: '<path d="M8.5 7L3.5 12l5 5M15.5 7l5 5-5 5"/>',
  arrow: '<path d="M5 12h14M13 6l6 6-6 6"/>',
  menu: '<path d="M4 7h16M4 12h16M4 17h16"/>',
} as const

export type IconName = keyof typeof paths

export const icon = (name: IconName, extra = '') => `<svg class="vane-icon${extra ? ` ${extra}` : ''}" viewBox="0 0 24 24" aria-hidden="true" focusable="false">${paths[name]}</svg>`

const copyGlyph = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><rect x="8" y="6" width="12" height="15" rx="2"/><path d="M15 6V3H4v15h4"/></svg>'
export const patch = (label: string, content: string, className = '') => `<figure class="isobar-patch ${className}" aria-label="${label}"><div class="drawing-content">${content}</div></figure>`

export function heroDrawing() {
  return `<figure class="hero-drawing wrap" aria-label="Vane in three steps: add the script, visits come in, see what worked"><div class="step-card"><h2><span class="step-disc" aria-hidden="true">1</span>Add the script</h2><div class="inner-card"><p>Install the script</p><div class="script-field"><code>vane.js</code>${copyGlyph}</div></div></div><div class="step-card"><h2><span class="step-disc" aria-hidden="true">2</span>Visits come in</h2><div class="inner-card"><p>Visits (page loads)</p><strong class="hero-number">1,284</strong><p class="hero-comparison"><strong>+18.0%</strong> compared with the previous period</p></div></div><div class="step-card"><h2><span class="step-disc" aria-hidden="true">3</span>See what worked</h2><div class="inner-card source-rows"><p><span>search.example</span><span>412</span></p><p><span>signup</span><span>42</span></p></div></div></figure>`
}

export const drawings = {
  free: patch('MIT License for Vane', '<div class="product-card licence-card"><h3>MIT License</h3><div class="code-field">Vane</div></div>'),
  weekly: patch('Visits: 1,284. Goal conversions: 42. Up 18.0% compared with the previous period of 1,088.', '<div class="weekly-drawing"><div class="product-card metric-card"><p>Visits (page loads)</p><strong>1,284</strong></div><div class="product-card metric-card"><p>Goal conversions</p><strong>42</strong></div><p class="product-card weekly-comparison"><strong>+18.0%</strong> compared with the previous period (1,088).</p></div>'),
  privacy: patch('Coverage and collection limits: Consent required, sample rate 100%, retention 90 days.', '<div class="product-card limits-card"><h3>Coverage and collection limits</h3><dl><div><dt>Consent</dt><dd>Required</dd></div><div><dt>Sample rate</dt><dd>100%</dd></div><div><dt>Retention</dt><dd>90 days</dd></div></dl></div>'),
  goals: patch('Goals field: signup=/thanks', '<div class="product-card goals-card"><h3>Goals</h3><div class="code-field">signup=/thanks</div></div>'),
  moveIn: patch('Review import: two page loads, at / on October 1 and /thanks on October 2, 2026.', '<div class="product-card import-card"><h3>Review import</h3><table><thead><tr><th>Date</th><th>Path</th><th>Visits (page loads)</th></tr></thead><tbody><tr><td>2026-10-01</td><td>/</td><td>1</td></tr><tr><td>2026-10-02</td><td>/thanks</td><td>1</td></tr></tbody></table><span class="drawing-button">Apply import</span></div>'),
  yours: patch('Export analytics history with Download installation archive', '<div class="product-card export-card"><h3>Export analytics history</h3><span class="drawing-button drawing-secondary">Download installation archive</span></div>'),
}

const iconPaths = [
  '<path d="M3 6h18M3 12h18M3 18h18"/><circle cx="8" cy="6" r="2.5"/><circle cx="16" cy="12" r="2.5"/><circle cx="10" cy="18" r="2.5"/>',
  '<path d="M4 9v6M8 5v14M12 2v20M16 5v14M20 9v6"/>',
  '<path d="M20 8a8.5 8.5 0 0 0-14-3L3 8m0-5v5h5m-4 8a8.5 8.5 0 0 0 14 3l3-3m0 5v-5h-5"/>',
  '<path d="m3 12 9-9h8v8l-9 10-8-8Z"/><circle cx="16" cy="7" r="1.5"/>',
  '<rect x="3" y="6" width="14" height="16" rx="2"/><path d="M7 6V2h14v16h-4"/>',
  '<circle cx="9" cy="7" r="3"/><path d="M2 21v-3c0-3 3-5 7-5s7 2 7 5v3M16 4a3 3 0 0 1 0 6m2 4c3 1 4 3 4 6"/>',
]
export function included() {
  const labels = ['Consent mode', 'Sampling', 'Retention', 'Campaign labels', 'Several sites', 'Read-only members']
  return `<section id="included" class="included wrap"><h2>Also included</h2><div class="included-grid">${labels.map((label, index) => `<div class="included-tile"><svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${iconPaths[index]}</svg><span>${label}</span></div>`).join('')}</div></section>`
}

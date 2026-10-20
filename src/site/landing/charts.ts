// The live charts, drawn at site build time from the story's exact data. Lines
// and areas are SVG stretched to their box (non-scaling strokes); dots, pins and
// labels are HTML placed in percent of the same box, so nothing distorts at any width.
import { n, online, onlineNow, week } from './data'

type Point = [number, number]
const f = (value: number) => +value.toFixed(2)

// A monotone cubic through the points (Fritsch–Carlson), so the line never overshoots its data.
function smooth(points: Point[]) {
  const dx = points.slice(1).map(([x], i) => x - points[i][0]), slope = points.slice(1).map(([, y], i) => (y - points[i][1]) / dx[i])
  const m = points.map((_, i) => i === 0 ? slope[0] : i === points.length - 1 ? slope[i - 1] : slope[i - 1] * slope[i] <= 0 ? 0 : 3 * (dx[i - 1] + dx[i]) / ((2 * dx[i] + dx[i - 1]) / slope[i - 1] + (dx[i] + 2 * dx[i - 1]) / slope[i]))
  return points.slice(1).reduce((d, [x, y], i) => {
    const [x0, y0] = points[i], h = dx[i] / 3
    return `${d}C${f(x0 + h)} ${f(y0 + m[i] * h)} ${f(x - h)} ${f(y - m[i + 1] * h)} ${f(x)} ${f(y)}`
  }, `M${f(points[0][0])} ${f(points[0][1])}`)
}

const at = (x: number, y: number) => `left:${f(x)}%;top:${f(y)}%`
const svg = (body: string, view = '0 0 100 100') => `<svg class="plot" viewBox="${view}" preserveAspectRatio="none" aria-hidden="true">${body}</svg>`

// 03: people online through launch Tuesday, 6 am to 9:30 pm, with its three pins.
export function onlineChart() {
  const x = (hour: number) => (hour - 5.75) / (22 - 5.75) * 100, y = (count: number) => 100 - count / 96 * 100
  const pts = online.map(([hour, count]) => [x(hour), y(count)] as Point), line = smooth(pts)
  const peak = online.find(([, count]) => count === Math.max(...online.map(([, c]) => c)))!
  const pin = (hour: number, cls: string) => { const point = online.find(([h]) => h === hour)!; return `<span class="pin-dot ${cls}" style="${at(x(hour), y(point[1]))}"></span>` }
  const ticks = [[6, '6 am'], [9, '9 am'], [12, '12 pm'], [15, '3 pm'], [18, '6 pm'], [21, '9 pm']] as const
  return `<div class="online-chart"><div class="plot-box">${svg(`<defs><linearGradient id="online-fill" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#1d58f0" stop-opacity=".22"/><stop offset="1" stop-color="#1d58f0" stop-opacity="0"/></linearGradient></defs>`
    + `<path d="${line}L${f(pts[pts.length - 1][0])} 100H${f(pts[0][0])}z" fill="url(#online-fill)"/><path d="${line}" fill="none" stroke="#2556e8" stroke-width="2.4" vector-effect="non-scaling-stroke"/>`)}`
    + pin(9 + 14 / 60, 'pin-blue') + pin(9 + 41 / 60, 'pin-blue') + pin(peak[0], 'pin-blue') + `<span class="pin-dot pin-green" style="${at(pts[pts.length - 1][0], pts[pts.length - 1][1])}"></span>`
    + `<p class="pin pin-launch" style="--px:${f(x(9 + 14 / 60))}%;--py:${f(y(6))}%"><span>9:14 am · Launch post on Hacker News</span></p>`
    + `<p class="pin pin-alert" style="--px:${f(x(9 + 41 / 60))}%;--py:${f(y(35))}%"><span>9:41 am · Spike alert sent to #marketing</span></p>`
    + `<p class="pin pin-peak" style="--px:${f(x(peak[0]))}%;--py:${f(y(peak[1]))}%"><span>12:10 pm · <b class="gold">${peak[1]} online</b></span></p></div>`
    + `<div class="axis-x">${ticks.map(([hour, label]) => `<span style="left:${f(x(hour))}%">${label}</span>`).join('')}</div>`
    + `<p class="sr-only">People online on Tue, Oct 13: about ${online[0][1]} at 6 am, ${peak[1]} at the 12:10 pm peak and ${onlineNow} now, at 9:30 pm.</p></div>`
}

// 04: signups per hour, noon to 8 pm. The coverage gap (2:12–3:05 pm) is a band, never a zero.
const signups: Point[] = [[12, 24], [13, 22], [14, 19], [14.2, 18.6]]
const resumed: Point[] = [[15 + 5 / 60, 15], [16, 12], [17, 9], [18, 7], [19, 6], [20, 5]]
export function signupsChart() {
  const x = (hour: number) => (hour - 12) / 8 * 100, y = (value: number) => 100 - value / 30 * 100
  const line = (pts: Point[]) => 'M' + pts.map(([h, v]) => `${f(x(h))} ${f(y(v))}`).join('L')
  const dots = [...signups.slice(0, 3), ...resumed.slice(1, -1)].map(([h, v]) => `<span class="pin-dot pin-small" style="${at(x(h), y(v))}"></span>`).join('')
  const gap = [x(14.2), x(15 + 5 / 60)]
  return `<div class="signups-chart"><p class="chart-unit">signups per hour</p><div class="signups-plot"><div class="axis-y"><span>30</span><span>15</span><span>0</span></div><div class="plot-box">`
    + `<span class="gap-band" style="left:${f(gap[0])}%;width:${f(gap[1] - gap[0])}%"></span><p class="gap-label" style="--gx:${f((gap[0] + gap[1]) / 2)}%">Coverage gap · 2:12–3:05 pm · not counted as zero</p>`
    + svg(`<path d="M0 50H100M0 0H100" stroke="#e9edf4" stroke-width="1" vector-effect="non-scaling-stroke"/><path d="${line(signups)}" fill="none" stroke="#2556e8" stroke-width="2.2" vector-effect="non-scaling-stroke"/><path d="${line(resumed)}" fill="none" stroke="#2556e8" stroke-width="2.2" vector-effect="non-scaling-stroke"/>`)
    + `${dots}<span class="pin-dot pin-red" style="${at(x(14.2), y(18.6))}"></span><span class="pin-dot pin-gold" style="${at(x(15 + 5 / 60), y(15))}"></span><span class="pin-dot pin-green" style="${at(100, y(5))}"></span></div></div>`
    + `<div class="axis-x axis-hours">${['12 pm', '1 pm', '2 pm', '3 pm', '4 pm', '5 pm', '6 pm', '7 pm', '8 pm'].map((label, i) => `<span style="left:${f(i / 8 * 100)}%">${label}</span>`).join('')}</div>`
    + '<p class="sr-only">Signups per hour on Tue, Oct 13: 24 at noon, 22 at 1 pm, 19 at 2 pm, none recorded from 2:12 to 3:05 pm, then 15, 12, 9, 7, 6 and 5 by 8 pm.</p></div>'
}

// 08: the week's daily visitors on the public page; Tuesday is the launch.
export function weekSparkline() {
  const top = Math.max(...week.map(day => day.visitors)), x = (i: number) => i / (week.length - 1) * 100, y = (v: number) => 100 - v / (top * 1.08) * 100
  const pts = week.map((day, i) => [x(i), y(day.visitors)] as Point), line = smooth(pts)
  return `<div class="spark"><div class="plot-box">${svg(`<defs><linearGradient id="spark-fill" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#1d58f0" stop-opacity=".2"/><stop offset="1" stop-color="#1d58f0" stop-opacity="0"/></linearGradient></defs><path d="${line}L100 100H0z" fill="url(#spark-fill)"/><path d="${line}" fill="none" stroke="#2556e8" stroke-width="2" vector-effect="non-scaling-stroke"/>`)}`
    + `<span class="pin-dot pin-small" style="${at(pts[1][0], pts[1][1])}"></span></div><div class="spark-days">${week.map(day => `<span>${day.day}</span>`).join('')}</div>`
    + `<p class="sr-only">Daily visitors, Mon Oct 12 to Sun Oct 18: ${week.map(day => `${day.name} ${n(day.visitors)}`).join(', ')}.</p></div>`
}

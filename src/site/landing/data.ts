// The homepage's one story: Juniper Coffee launches a cold brew subscription in
// the week of Mon, Oct 12, 2026. Every figure that appears in more than one
// section lives here so the sections always agree.
export const site = 'junipercoffee.com'
export const goals = 12

// Daily unique visitors, Mon Oct 12 to Sun Oct 18. The daily salt means a
// visitor counts once per day, so the week's unique visitors are their sum
// (METRIC-001): 21,640. Launch Tuesday peaks; Sunday rises a little.
export const week = [
  { day: 'M', name: 'Mon', visitors: 1520 }, { day: 'T', name: 'Tue', visitors: 4812 }, { day: 'W', name: 'Wed', visitors: 3920 },
  { day: 'T', name: 'Thu', visitors: 3300 }, { day: 'F', name: 'Fri', visitors: 2860 }, { day: 'S', name: 'Sat', visitors: 2560 }, { day: 'S', name: 'Sun', visitors: 2668 },
]
export const weekVisitors = week.reduce((sum, day) => sum + day.visitors, 0) // 21,640
export const today = week[1].visitors // 4,812 on launch Tuesday
export const lastTuesday = 2238 // Tue, Oct 6: 4,812 is up 115%
export const hackerNews = { today: 1904, week: 3120 }
export const signupsToday = 212
export const order = { subscribed: 388, revenue: '$9,312.00' }

// People online on launch Tuesday, [hour, current visitors]. A visitor is
// current for five minutes after their last page load or ping (DASH-001) and a
// visit lasts about two minutes, so the area under this curve divided by seven
// minutes is 4,622 visitors from 6 am to 9:30 pm; the night hours bring the
// rest of the day's 4,812.
export const online: [number, number][] = [[6, 1], [7, 2], [8, 4], [9, 5], [9 + 14 / 60, 6], [9.5, 22], [9 + 41 / 60, 35], [10, 52], [10.5, 66], [11, 76], [11.5, 81], [12 + 10 / 60, 84],
  [13, 78], [14, 62], [15, 48], [16, 37], [17, 29], [18, 23], [19, 18], [20, 14], [21, 10], [21.5, 8]]
export const onlineNow = online[online.length - 1][1]

export const n = (value: number) => value.toLocaleString('en-US')

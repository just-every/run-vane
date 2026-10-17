// The homepage's one sample website, Juniper Coffee, seen on Friday, Oct 16, 2026.
// Figures that appear in more than one drawing live here so they always agree.
export const site = 'junipercoffee.com'

// Daily unique visitors for the last seven days. The daily salt means a
// visitor counts once per day, so the week's unique visitors are their sum.
export const week = [
  { day: 'Sat', visitors: 4236 }, { day: 'Sun', visitors: 3688 }, { day: 'Mon', visitors: 3104 }, { day: 'Tue', visitors: 3742 },
  { day: 'Wed', visitors: 4288 }, { day: 'Thu', visitors: 4546 }, { day: 'Fri', visitors: 4812 },
]
export const weekVisitors = week.reduce((sum, day) => sum + day.visitors, 0) // 28,416
export const today = week[week.length - 1].visitors // 4,812: Friday, up 23% on last Friday's 3,912
export const hackerNews = { post: '/blog/brew-guide', lastHour: 1904 } // today's spike, all of it from the brew guide's post
export const signupsToday = 212
export const goals = 12

export const n = (value: number) => value.toLocaleString('en-US')

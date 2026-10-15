import { drawings } from './drawings'

const sections = [
  { id: 'free', eyebrow: 'Free', title: '100% free.', body: 'MIT licensed. Every line is yours to read, run and change.', drawing: drawings.free },
  { id: 'weekly', eyebrow: 'Weekly', title: 'This week, against last week.', body: 'Every report sets the current seven days beside the seven before, with the counts behind the change.', drawing: drawings.weekly },
  { id: 'privacy', eyebrow: 'Privacy', title: 'Nothing about who visited.', body: 'No cookies, IP addresses or visitor IDs. Do Not Track and Global Privacy Control stop collection.', drawing: drawings.privacy },
  { id: 'goals', eyebrow: 'Goals', title: 'A goal is a page.', body: 'Write signup=/thanks and every visit to /thanks counts as a signup. No event code.', drawing: drawings.goals },
  { id: 'move-in', eyebrow: 'Move in', title: 'Bring your Umami history.', body: 'Preview an Umami export, apply it, and undo it any time.', drawing: drawings.moveIn },
  { id: 'yours', eyebrow: 'Yours', title: 'Yours to keep.', body: "Download the whole installation's history, and restore it anywhere.", drawing: drawings.yours },
]

export function featureSections() {
  return sections.map((section, index) => `<section id="${section.id}" class="feature-section${index % 2 ? ' drawing-first' : ''}"><div class="wrap feature-layout"><div class="feature-copy"><p class="eyebrow">${section.eyebrow}</p><h2>${section.title}</h2><p>${section.body}</p></div>${section.drawing}</div></section>`).join('')
}

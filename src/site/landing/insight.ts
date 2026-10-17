// Page 05: the agent explains a drop and fixes it, then Search Console keywords.
import { icons, swallow } from './icons'
import { card, feature, handled } from './parts'

const steps = [
  ['red', '8:02 am', 'Signups 31% below the 4-week average'],
  ['red', '8:03 am', "Tracking script missing on /pricing since last night's deploy"],
  ['blue', '8:04 am', 'Google and direct traffic steady · not a demand drop'],
  ['green', '8:11 am', 'Script restored · pull request #218 merged'],
  ['green', 'Thu, Oct 15', `Signups back to 214 a day <span class="tick-inline">${icons.tick}</span>`],
] as const
const agentCard = card('The agent explains a drop in signups', `<header class="card-head"><p class="card-title">Signups down 31% · Wed, Oct 14</p><p class="agent-pill">${swallow(26)}Agent</p></header>`
  + `<ol class="timeline">${steps.map(([tone, time, text]) => `<li class="step-${tone}"><span class="timeline-dot" aria-hidden="true"></span><p><span class="muted">${time} ·</span> ${text}</p></li>`).join('')}</ol>`, 'card-agent')

const queries = [['cold brew concentrate ratio', '1,204', '2.1'], ['best pour over coffee maker', '812', '4.6'], ['juniper coffee subscription', '640', '1.0'], ['low acid decaf beans', '318', '7.3']]
const searchCard = card('Search keywords from Google, last 28 days', '<header class="card-head"><p class="card-title">Search keywords · Google · Last 28 days</p></header>'
  + `<table class="keywords"><thead><tr><th scope="col">Query</th><th scope="col">Clicks</th><th scope="col">Position</th></tr></thead><tbody>${queries.map(([query, clicks, position]) => `<tr><td>${query}</td><td>${clicks}</td><td>${position}</td></tr>`).join('')}</tbody></table>`
  + '<p class="card-foot">Lands on /blog/brew-guide · 62% of clicks</p>', 'card-search')

export const insight = () => feature({
  id: 'why', eyebrow: 'Why it moved', title: 'It tells you why.',
  body: 'The agent checks your tracking, your channel mix and the site itself, finds the cause, ships the fix and measures the result.',
  drawing: agentCard,
}) + feature({
  id: 'search', eyebrow: 'Search', title: 'Know what they <br>searched.', flip: true,
  body: 'Connect Google Search Console to see the keywords behind your Google visits, next to the pages they landed on.',
  drawing: searchCard + handled('Oct 15–16 filled in from Google at the next sync'),
})

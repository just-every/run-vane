import { escape, field, hidden, operation, panel } from './html'
import type { ViewData } from './types'

const ROLE_HELP = 'Admin manages sites and settings. Analyst also creates goals, funnels, segments and no-code events for approval. Viewer reads.'

// TEAM-001: the chosen sites as checkboxes, or the whole installation.
function scope(data: ViewData, person?: { id: string; sites: string[] | null }): string {
  const whole = !data.actor.sites
  return `<fieldset><legend>Sites</legend>${whole ? `<label><input type="radio" name="scope" value="all"${!person || !person.sites ? ' checked' : ''}> Every site</label><label><input type="radio" name="scope" value="chosen"${person?.sites ? ' checked' : ''}> Only the sites ticked</label>` : hidden('scope', 'chosen')}${data.sites.map(site => `<label><input type="checkbox" name="site_${escape(site.id)}"${person?.sites?.includes(site.id) ? ' checked' : ''}> ${escape(site.name)}</label>`).join('')}</fieldset>`
}

function roles(owner: boolean, current = 'viewer'): string {
  return `<label>Role<select name="role" required>${[...(owner ? ['admin'] : []), 'analyst', 'viewer'].map(role => `<option value="${role}"${role === current ? ' selected' : ''}>${role[0]!.toUpperCase() + role.slice(1)}</option>`).join('')}</select></label>`
}

export function teamPage(data: ViewData): string {
  const owner = data.actor.access === 'owner', people = data.people ?? []
  const rows = people.map(person => {
    const sites = person.sites ? person.sites.map(id => data.sites.find(site => site.id === id)?.name ?? id).join(', ') : 'Every site'
    const manage = person.access !== 'owner' && person.id !== data.actor.id && (owner || person.access !== 'admin')
    const change = manage ? `<details><summary>Change access</summary><form action="/app/action" method="post">${operation('team.grant')}${hidden('operatorId', person.id)}${person.access === 'admin' ? '' : roles(false, person.access)}${scope(data, person)}<button type="submit" class="vane-secondary">Save access</button></form><form action="/app/action" method="post">${operation('team.remove')}${hidden('operatorId', person.id)}<button type="submit" class="vane-secondary">Remove from the team</button></form></details>` : ''
    return `<tr data-person="${escape(person.email)}"><td>${escape(person.name)}<br><span class="vane-help">${escape(person.email)}</span></td><td><span class="vane-badge">${escape(person.access)}</span>${person.status === 'invited' ? ' invited' : ''}</td><td>${escape(sites)}</td><td>${change}</td></tr>`
  }).join('')
  const table = `<div class="vane-table-scroll" role="region" aria-label="Team" tabindex="0"><table><caption class="vane-sr-only">Team members, their roles and sites</caption><thead><tr><th scope="col">Person</th><th scope="col">Role</th><th scope="col">Sites</th><th scope="col">Manage</th></tr></thead><tbody>${rows}</tbody></table></div>`
  const invite = `<form action="/app/action" method="post">${operation('team.invite')}${field('Email address', 'email', '', 'type="email" required maxlength="254" autocomplete="off"')}${field('Name', 'displayName', '', 'maxlength="80"')}${roles(owner)}<p class="vane-help">${ROLE_HELP}</p>${scope(data)}<button type="submit">Send invitation</button></form>`
  const candidates = people.filter(person => person.access !== 'owner' && person.status === 'active')
  const transfer = owner && candidates.length ? panel('Transfer ownership', `<form action="/app/action" method="post">${operation('team.transfer')}<label>New owner<select name="operatorId" required>${candidates.map(person => `<option value="${escape(person.id)}">${escape(person.name)} (${escape(person.email)})</option>`).join('')}</select></label>${field('Type the new owner’s email address to confirm', 'confirm', '', 'type="email" required autocomplete="off"')}<button type="submit">Transfer ownership</button></form><form action="/auth/step-up" method="post">${hidden('action', 'owner:transfer')}${hidden('returnTo', '/app?section=team')}<p class="vane-help">The transfer needs a fresh confirmation that it is you: follow the link we email you, then transfer within a few minutes.</p><button type="submit" class="vane-secondary">Email me a confirmation link</button></form>`, 'The new owner controls everything, including billing and erasure. You become an admin and sign in again.') : ''
  return `<p><a href="/auth/security">Sign-in security and authenticators</a></p>${panel('Team', table)}${panel('Invite a person', invite)}${transfer}`
}

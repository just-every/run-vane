export const docsPages = [
  { slug: 'getting-started', title: 'Your first website', section: 'Start', source: 'docs/getting-started.md', summary: 'Run Vane, add your website, install the script and read your first report.' },
  { slug: 'collection', title: 'Collection and coverage', section: 'Use Vane', source: 'docs/collection.md', summary: 'What the script sends, consent, sampling and the limits behind the counts.' },
  { slug: 'movement', title: 'Investigate why numbers moved', section: 'Use Vane', source: 'docs/movement.md', summary: 'Compare evidence, ranked hypotheses, denominators and unknowns without claiming causality.' },
  { slug: 'instrumentation', title: 'Investigate instrumentation', section: 'Use Vane', source: 'docs/instrumentation.md', summary: 'Inspect declared tracking, review structural fix drafts and verify deployed payloads after owner approval.' },
  { slug: 'ask', title: 'Ask a question in plain English', section: 'Use Vane', source: 'docs/ask.md', summary: 'Turn on questions, see what the model provider receives and read the exact query behind each answer.' },
  { slug: 'agency', title: 'Agency clients and branding', section: 'Use Vane', source: 'docs/agency.md', summary: 'Create client workspaces and configure branding within each report’s existing access scope.' },
  { slug: 'collection-scale', title: 'Collection scale and proof', section: 'Reference', source: 'docs/collection-scale.md', summary: 'The analytical store, native batching, published capacity and remaining scale proof.' },
  { slug: 'first-party-proxy', title: 'Serve Vane through your domain', section: 'Use Vane', source: 'docs/first-party-proxy.md', summary: 'Connect an owner-managed first-party route, install the server setup and verify its coverage and privacy.' },
  { slug: 'approvals', title: 'People and approvals', section: 'Use Vane', source: 'docs/approvals.md', summary: 'Owners, administrators and members, and how a prepared change is approved.' },
  { slug: 'sign-in-security', title: 'Organization sign-in and authenticators', section: 'Use Vane', source: 'docs/sign-in-security.md', summary: 'Configure organization sign-in, authenticators, recovery codes and account provisioning.' },
  { slug: 'umami-import', title: 'Move in from Umami', section: 'Move in', source: 'docs/umami-import.md', summary: 'Bring Umami v2 history across: the supported format, preview, apply and undo.' },
  { slug: 'history', title: 'Back up and restore', section: 'Keep your data', source: 'docs/history.md', summary: 'Download an archive, restore it, keep history for as long as you choose, or erase it.' },
  { slug: 'commands', title: 'Agent commands', section: 'Reference', source: 'docs/commands.md', summary: 'Prepare changes through the authenticated command protocol.' },
] as const
export type DocsPage = typeof docsPages[number]
export const docHref = (slug: string) => `/docs/${slug}`

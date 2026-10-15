export const docsPages = [
  { slug: 'getting-started', title: 'Your first website', section: 'Start', source: 'docs/getting-started.md', summary: 'Add your website, install the script and read your first report.' },
  { slug: 'collection', title: 'Collection and coverage', section: 'Use Vane', source: 'docs/collection.md', summary: 'Understand page loads, consent, sampling and the limits behind the counts.' },
  { slug: 'history', title: 'History and portability', section: 'Use Vane', source: 'docs/history.md', summary: 'Import, undo, export, restore and erase analytics history.' },
  { slug: 'umami-import', title: 'Move from Umami v2', section: 'Reference', source: 'docs/umami-import.md', summary: 'The supported Events API format and import custody rules.' },
  { slug: 'commands', title: 'Agent commands', section: 'Reference', source: 'docs/commands.md', summary: 'Prepare changes through the authenticated command protocol.' },
  { slug: 'run-locally', title: 'Run locally', section: 'Reference', source: 'RUN-LOCALLY.md', summary: 'RER commands, private settings and local development.' },
  { slug: 'readme', title: 'Repository guide', section: 'Reference', source: 'README.md', summary: 'The repository’s installation, deployment and development guide.' },
] as const
export type DocsPage = typeof docsPages[number]
export const docHref = (slug: string) => `/docs/${slug}`

import assert from 'node:assert/strict';

// Reads of the held RunEditRun account for HOST-001: what exists, how a Worker is bound, and what Cloudflare
// itself counted. The token only needs read scopes here; deployment and removal use the public rer commands.
const base = env => `https://api.cloudflare.com/client/v4/accounts/${env.CLOUDFLARE_ACCOUNT_ID}`;
const headers = env => ({ authorization: `Bearer ${env.CLOUDFLARE_API_TOKEN}`, 'content-type': 'application/json' });

async function read(env, path, query = {}) {
 const url = new URL(base(env) + path);
 for (const [key, value] of Object.entries(query)) url.searchParams.set(key, String(value));
 const response = await fetch(url, { headers: headers(env), signal: AbortSignal.timeout(30_000) });
 assert.equal(response.ok, true, `Cloudflare read ${path} failed with HTTP ${response.status}`);
 const body = await response.json();
 assert.equal(body.success, true, `Cloudflare read ${path} refused`);
 return body;
}

async function pages(env, path, key) {
 const rows = [];
 for (let page = 1;; page++) {
  const body = await read(env, path, { page, per_page: 100 });
  rows.push(...body.result.map(key));
  const total = body.result_info?.total_pages;
  if (total !== undefined ? page >= total : body.result.length < 100) return rows.sort();
 }
}

/** Every account resource a Vane deployment could create, by kind. Account-wide, so a stray resource shows up. */
export async function inventory(env) {
 return {
  workers: (await read(env, '/workers/scripts')).result.map(row => row.id).sort(),
  d1: await pages(env, '/d1/database', row => `${row.name} ${row.uuid}`),
  kv: await pages(env, '/storage/kv/namespaces', row => `${row.title} ${row.id}`),
  r2: (await read(env, '/r2/buckets')).result.buckets.map(row => row.name).sort(),
  queues: await pages(env, '/queues', row => `${row.queue_name} ${row.queue_id}`),
 };
}

export function difference(before, after) {
 return Object.fromEntries(Object.keys(after).map(kind => [kind, { added: after[kind].filter(row => !before[kind].includes(row)), removed: before[kind].filter(row => !after[kind].includes(row)) }]));
}

/** The Worker's bindings as name and type, from its deployed settings. */
export async function bindingsOf(env, worker) {
 const body = await read(env, `/workers/scripts/${worker}/settings`);
 return body.result.bindings.map(binding => `${binding.name}:${binding.type}`).sort();
}

const QUERY = `query($account:String!,$database:String!,$worker:String!,$from:Time!,$to:Time!,$fromDay:Date!,$toDay:Date!){viewer{accounts(filter:{accountTag:$account}){
 w:workersInvocationsAdaptive(limit:10000,filter:{scriptName:$worker,datetime_geq:$from,datetime_leq:$to}){sum{requests errors subrequests cpuTimeUs}}
 d:d1AnalyticsAdaptiveGroups(limit:10000,filter:{databaseId:$database,datetime_geq:$from,datetime_leq:$to}){sum{readQueries writeQueries rowsRead rowsWritten}}
 s:d1StorageAdaptiveGroups(limit:10000,filter:{databaseId:$database,date_geq:$fromDay,date_leq:$toDay}){max{databaseSizeBytes} dimensions{date}}
}}}`;

/** Cloudflare's own count for one Worker and its D1 database between two instants. */
export async function accountUsage(env, { worker, database, from, to }) {
 const response = await fetch('https://api.cloudflare.com/client/v4/graphql', {
  method: 'POST', headers: headers(env), signal: AbortSignal.timeout(60_000),
  body: JSON.stringify({ query: QUERY, variables: { account: env.CLOUDFLARE_ACCOUNT_ID, database, worker,
   from: from.toISOString(), to: to.toISOString(), fromDay: from.toISOString().slice(0, 10), toDay: to.toISOString().slice(0, 10) } }),
 });
 const body = await response.json();
 assert.ok(!body.errors, 'Cloudflare analytics refused: ' + JSON.stringify(body.errors));
 const account = body.data.viewer.accounts[0];
 const sum = (rows, name) => rows.reduce((total, row) => total + (row.sum[name] ?? 0), 0);
 return {
  requests: sum(account.w, 'requests'), errors: sum(account.w, 'errors'), cpuMs: sum(account.w, 'cpuTimeUs') / 1000,
  rowsRead: sum(account.d, 'rowsRead'), rowsWritten: sum(account.d, 'rowsWritten'),
  readQueries: sum(account.d, 'readQueries'), writeQueries: sum(account.d, 'writeQueries'),
  bytes: Math.max(0, ...account.s.map(row => row.max.databaseSizeBytes)),
 };
}

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

/** Workers analytics arrive twenty minutes or more after the traffic: wait until the counts reach it and stop changing. */
export async function settledUsage(env, scope, { expectRequests, minutes = 45 }) {
 let last, steady = 0;
 for (const deadline = Date.now() + minutes * 60_000; Date.now() < deadline; await sleep(30_000)) {
  const usage = await accountUsage(env, { ...scope, to: new Date() });
  steady = last && usage.requests === last.requests && usage.rowsWritten === last.rowsWritten ? steady + 1 : 0;
  last = usage;
  console.log(new Date().toISOString(), 'analytics', JSON.stringify(usage));
  if (usage.requests >= expectRequests && steady >= 4) return usage;
 }
 throw new Error('Cloudflare analytics did not settle: ' + JSON.stringify(last));
}

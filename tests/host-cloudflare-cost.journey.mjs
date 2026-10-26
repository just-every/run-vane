import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir, mkdir, writeFile } from 'node:fs/promises';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes } from 'node:crypto';
import { requireCloudflareAuthority, removeTransfer } from './host-cloudflare-cleanup.mjs';
import { inventory, difference, bindingsOf, settledUsage } from './host-cloudflare-usage.mjs';
import { HOSTING_SAMPLE, monthlyCost, usageCost, sampleUse } from '../src/vane/hosting-cost.ts';
import { main as ownerMain, report } from '@runeditrun/rer/modules/deploy-kit/owner-cli';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DESKTOP_CHROME = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36';
const FIRST = Number(process.env.VANE_HOST_COST_FIRST ?? 100_000), TOTAL = Number(process.env.VANE_HOST_COST_TOTAL ?? 1_000_000);
const PARALLEL = 6, BATCH = 1000, CONTRACT_MONTHLY = 10_000_000;
const within = (actual, expected, label) => assert.ok(Math.abs(actual - expected) <= expected * 0.1, `${label}: measured ${actual} is not within 10% of stated ${expected}`);

// What deploy.json promises, plus the four bindings the rer deploy kit adds to every Worker (static assets, version
// metadata, deployment fingerprint and source), as binding name and type the way the provider lists them.
const KIT_BINDINGS = ['ASSETS:assets', 'RER_VERSION:version_metadata', 'RER_DEPLOY_FINGERPRINT:plain_text', 'RER_DEPLOY_SOURCE:plain_text'];
async function declaredBindings() {
 const declaration = JSON.parse(await readFile(join(root, 'deploy.json'), 'utf8'));
 return [...declaration.d1.map(d => `${d.binding}:d1`), ...Object.keys(declaration.vars).map(name => `${name}:plain_text`),
  `${declaration.originVar}:plain_text`, ...declaration.secrets.map(s => `${s.binding}:secret_text`), ...KIT_BINDINGS].sort();
}

test('HOST-001 a deployed Vane Worker under real native load costs what the panel states, within 10% of Cloudflare\'s own account usage', {
 skip: process.env.VANE_HOST_COST_JOURNEY !== '1' ? 'explicit held-account journey only' : false,
 timeout: 120 * 60_000,
}, async t => {
 requireCloudflareAuthority(process.env, 'VANE_HOST_COST_JOURNEY');
 assert.ok(FIRST >= BATCH && TOTAL > FIRST && FIRST % BATCH === 0 && TOTAL % BATCH === 0, 'load sizes are whole batches');
 const environment = 'host-cost-c822';
 const state = join(root, '.rer', 'deploy', `${environment}.json`);
 const args = command => [command, '--declaration', 'deploy.json', '--environment', environment, '--product', '', '--state', state];
 const privateEnv = { ...process.env, OWNER_EMAIL: 'synthetic-vane-1@example.test', SESSION_SECRET: randomBytes(32).toString('hex'),
  SETUP_TOKEN: randomBytes(32).toString('hex'), MAIL_API_KEY: 'synthetic-vane-1', WRANGLER_SEND_METRICS: 'false' };
 let passed = false, cleanupPromise;
 const cleanup = () => cleanupPromise ??= removeTransfer({ state, env: privateEnv, root, args, passed });
 t.after(cleanup);
 const receipt = { sha: process.env.GITHUB_SHA ?? null, startedAt: new Date().toISOString(), target: { first: FIRST, total: TOTAL } };
 const saveReceipt = async () => {
  if (!process.env.VANE_HOST_RECEIPT_DIR) return;
  await mkdir(process.env.VANE_HOST_RECEIPT_DIR, { recursive: true });
  await writeFile(join(process.env.VANE_HOST_RECEIPT_DIR, 'host-cost.json'), JSON.stringify(receipt, null, 2) + '\n');
 };
 try {
  const before = await inventory(privateEnv);
  const from = new Date(Date.now() - 60_000);
  let deployed;
  try { deployed = await ownerMain(args('deploy'), privateEnv, { cwd: root, notice: () => {} }); }
  catch (error) { throw new Error('Fresh test deployment failed: ' + JSON.stringify(report(error))); }
  const record = JSON.parse(await readFile(state, 'utf8'));
  const databases = Object.values(record.owned.d1).filter(value => value.status === 'created');
  assert.equal(databases.length, 1);
  const scope = { worker: deployed.worker, database: databases[0].id, from };

  // Exactly the Worker and the bindings deploy.json declares, and nothing else in the account.
  const changes = difference(before, await inventory(privateEnv));
  assert.deepEqual(changes.workers, { added: [deployed.worker], removed: [] });
  assert.equal(changes.d1.added.length, 1); assert.ok(changes.d1.added[0].endsWith(' ' + scope.database));
  for (const kind of ['kv', 'r2', 'queues']) assert.deepEqual(changes[kind], { added: [], removed: [] }, `${kind} is untouched`);
  assert.deepEqual(changes.d1.removed, []);
  assert.deepEqual(await bindingsOf(privateEnv, deployed.worker), await declaredBindings());
  receipt.reconciliation = { worker: deployed.worker, d1Added: changes.d1.added.length, bindings: await declaredBindings(), accountBefore: Object.fromEntries(Object.entries(before).map(([k, v]) => [k, v.length])) };

  // The owner claims the installation with the setup token, approves a site and collects through the public doors.
  const post = (path, body, extra = {}) => fetch(deployed.origin + path, { method: 'POST', redirect: 'manual', headers: { origin: deployed.origin, 'content-type': 'application/json', ...extra }, body: JSON.stringify(body) });
  const cookieOf = response => response.headers.getSetCookie().map(line => line.split(';')[0]).join('; ');
  const bootstrap = await post('/auth/bootstrap', { token: privateEnv.SETUP_TOKEN, displayName: 'Site owner' });
  assert.equal(bootstrap.status, 303, 'Owner bootstrap');
  const owner = cookieOf(bootstrap);
  const form = body => fetch(deployed.origin + '/app/action', { method: 'POST', redirect: 'manual', headers: { origin: deployed.origin, 'content-type': 'application/x-www-form-urlencoded', cookie: owner }, body: new URLSearchParams(body).toString() });
  await fetch(deployed.origin + '/setup', { method: 'POST', redirect: 'manual', headers: { origin: deployed.origin, 'content-type': 'application/x-www-form-urlencoded', cookie: owner }, body: 'confirm=yes' });
  const input = { name: 'Fern Studio', origin: 'https://fern.example', paths: [], goals: {}, consent: 'not-required', sampleRate: 100, retentionDays: 90, retention: 'forever' };
  const proposed = await post('/api/vane/commands', { command: 'site.create', input }, { cookie: owner });
  assert.equal(proposed.status, 201); const proposal = await proposed.json();
  assert.equal((await form({ operation: 'proposal.approve', id: proposal.id })).status, 303);
  const siteId = proposal.payload.siteId;

  let sent = 0;
  async function load(count) {
   const batches = count / BATCH;
   let next = 0;
   await Promise.all(Array.from({ length: PARALLEL }, async () => {
    while (next < batches) {
     const first = sent + next++ * BATCH;
     const events = Array.from({ length: BATCH }, (_, i) => ({ siteId, id: crypto.randomUUID(), path: `/synthetic-vane-${(first + i) % 10}`, source: 'search.example', campaign: 'launch', consent: 'not-required' }));
     const response = await post('/api/vane/collect-batch', { events }, { origin: 'https://fern.example', 'user-agent': DESKTOP_CHROME });
     const body = await response.json();
     assert.equal(response.status, 202, JSON.stringify(body).slice(0, 300)); assert.equal(body.accepted, events.length);
    }
   }));
   sent += count;
  }
  const panel = async () => {
   const html = await (await fetch(deployed.origin + '/app?section=history', { headers: { cookie: owner } })).text();
   return { html, bytes: Number(html.match(/data-store-bytes="(\d+)"/)?.[1]), pageviews: Number(html.match(/data-hosting-pageviews>([\d,]+)</)?.[1].replaceAll(',', '')) };
  };
  await load(FIRST);
  const mid = await panel();
  assert.equal(mid.pageviews, FIRST, 'The deployed Hosting cost panel counts every admitted pageview');
  await load(TOTAL - FIRST);
  const end = await panel();
  assert.equal(end.pageviews, TOTAL);
  assert.match(end.html, /Workers Paid is required/);
  // Cloudflare's own count for the Worker and its database from before deployment to the end of the load: complete
  // usage, including setup, sign-in, dashboard reads and the five-minute schedule. Analytics lag the traffic.
  const usage = await settledUsage(privateEnv, scope, { expectRequests: TOTAL / BATCH });
  const units = TOTAL / HOSTING_SAMPLE.pageviews;
  const growth = (end.bytes - mid.bytes) / ((TOTAL - FIRST) / HOSTING_SAMPLE.pageviews);
  const per100k = { requests: usage.requests / units, cpuMs: usage.cpuMs / units, rowsRead: usage.rowsRead / units, rowsWritten: usage.rowsWritten / units, bytes: growth };
  const stated = { ...sampleUse(HOSTING_SAMPLE.pageviews, HOSTING_SAMPLE.growthBytes) };
  const atVolume = (use, pageviews) => ({ requests: use.requests * pageviews / HOSTING_SAMPLE.pageviews, cpuMs: use.cpuMs * pageviews / HOSTING_SAMPLE.pageviews,
   rowsRead: use.rowsRead * pageviews / HOSTING_SAMPLE.pageviews, rowsWritten: use.rowsWritten * pageviews / HOSTING_SAMPLE.pageviews, bytes: use.bytes * pageviews / HOSTING_SAMPLE.pageviews });
  const comparison = {
   usage, storeBytes: { afterFirst: mid.bytes, end: end.bytes }, per100kMeasured: per100k, per100kStated: stated,
   usageCostPer100k: { measured: usageCost(per100k), stated: usageCost(stated) },
   monthlyAtRun: { measured: monthlyCost({ ...usage, bytes: end.bytes }), stated: monthlyCost(sampleUse(TOTAL, end.bytes)) },
   monthlyAtContractVolume: { measured: monthlyCost(atVolume(per100k, CONTRACT_MONTHLY)), stated: monthlyCost(atVolume(stated, CONTRACT_MONTHLY)) },
  };
  receipt.comparison = comparison; await saveReceipt();
  within(comparison.usageCostPer100k.measured, comparison.usageCostPer100k.stated, 'usage cost per 100,000 pageviews');
  within(comparison.monthlyAtRun.measured, comparison.monthlyAtRun.stated, 'monthly cost at the run volume');
  within(comparison.monthlyAtContractVolume.measured, comparison.monthlyAtContractVolume.stated, 'monthly cost at the COLLECT-004 monthly volume');
  passed = true;
 } finally { await cleanup(); }
 // Removal leaves the account exactly as the journey found it.
 receipt.finishedAt = new Date().toISOString(); await saveReceipt();
});

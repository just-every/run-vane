import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { main as ownerMain } from '@runeditrun/rer/modules/deploy-kit/owner-cli';

export function requireCloudflareAuthority(env, flag = 'VANE_HOST_CLOUDFLARE_JOURNEY') {
 for (const name of ['CLOUDFLARE_API_TOKEN', 'CLOUDFLARE_ACCOUNT_ID']) {
  assert.ok(env[name]?.trim(), `${name} is required for the live Cloudflare journey; refusing to skip`);
 }
 assert.equal(env.CLOUDFLARE_ACCOUNT_ID === 'b20c0ca9cab0c2b70e13d7cf724b89bd', true,
  'The live journey is restricted to the RunEditRun account');
 assert.equal(env[flag], '1', 'The live journey must be enabled');
}

async function listAccount(env, resource) {
 const rows = [];
 for (let page = 1;; page++) {
  const url = new URL(`https://api.cloudflare.com/client/v4/accounts/${env.CLOUDFLARE_ACCOUNT_ID}${resource}`);
  if (resource !== '/workers/scripts') url.search = new URLSearchParams({ page: String(page), per_page: '100' }).toString();
  const response = await fetch(url, {
   headers: { authorization: `Bearer ${env.CLOUDFLARE_API_TOKEN}` },
   signal: AbortSignal.timeout(30_000),
  });
  assert.equal(response.ok, true, `Cloudflare cleanup inventory failed with HTTP ${response.status}`);
  const body = await response.json();
  assert.equal(body.success, true, 'Cloudflare cleanup inventory refused');
  assert.ok(Array.isArray(body.result), 'Cloudflare cleanup inventory must be complete');
  rows.push(...body.result);
  if (resource === '/workers/scripts') return rows;
  const info = body.result_info;
  if (info?.total_pages !== undefined) {
   if (page >= info.total_pages) return rows;
  } else if (body.result.length < 100) return rows;
 }
}

// Read ownership before removal: local state is discarded only after provider
// removal succeeds. Fresh account listings independently prove the end state.
export async function removeTransfer({ state, env, root, args, passed }) {
 const receipt = { sha: env.GITHUB_SHA ?? null, runId: env.GITHUB_RUN_ID ?? null,
  transfer: passed ? 'passed' : 'failed', cleanup: 'failed' };
 const failures = [];
 let record;
 try {
  const saved = await readFile(state, 'utf8').catch(error => {
   if (error.code === 'ENOENT') return null;
   throw error;
  });
  record = saved ? JSON.parse(saved) : null;
  receipt.owned = { worker: record?.owned.worker ? record.worker : null,
   databases: Object.entries(record?.owned.d1 ?? {}).map(([name, entry]) => ({ name, id: entry.id ?? null })) };
  if (record) {
   try { await ownerMain(args('remove'), env, { cwd: root, notice: () => {} }); }
   catch { failures.push('Ownership-checked removal failed; deployment state is retained privately'); }
  }
 } catch { failures.push('Could not read this journey deployment ownership'); }
 // These reads also run when deployment or removal failed. No credential,
 // sign-in URL, archive or private deployment state enters the retained receipt.
 for (const [kind, resource] of [['workers', '/workers/scripts'], ['databases', '/d1/database']]) {
  try {
   const rows = await listAccount(env, resource);
   receipt[kind] = rows.map(row => kind === 'workers' ? { name: row.id } : { name: row.name, id: row.uuid });
   const owned = receipt.owned;
   const survivors = kind === 'workers'
    ? rows.filter(row => owned?.worker && row.id === owned.worker)
    : rows.filter(row => owned?.databases.some(db => db.id ? row.uuid === db.id : row.name === db.name));
   if (survivors.length) failures.push(`The account still lists this journey's ${kind}`);
  } catch { failures.push(`The final ${kind} account listing failed`); }
 }
 receipt.cleanup = failures.length ? 'failed' : 'passed';
 receipt.failures = failures;
 if (env.VANE_HOST_RECEIPT_DIR) {
  await mkdir(env.VANE_HOST_RECEIPT_DIR, { recursive: true });
  await writeFile(join(env.VANE_HOST_RECEIPT_DIR, 'cleanup.json'), JSON.stringify(receipt, null, 2) + '\n');
 }
 assert.equal(failures.length, 0, failures.join('; '));
 console.log('Cleanup passed: fresh account Worker and D1 listings contain none of this journey resources.');
}

import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readdir, rm } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';
import { promisify } from 'node:util';
import { ownedProcesses, launch, redactedTail } from './host-local-processes.mjs';
import { installedUI } from './host-local-ui.mjs';

const execute = promisify(execFile);

// HOST-003 starts with an actual installed HOST-002 fixture, not a domain archive
// or a prebuilt database. Browser HOME remains the caller's real home.
export async function transferSource(t, root) {
 const scratch = await mkdtemp(join(tmpdir(), 'vane-transfer-source-'));
 const home = join(scratch, 'home'), empty = join(scratch, 'empty'), registry = join(scratch, 'servers');
 const processes = ownedProcesses(registry), cleanups = [];
 t.after(async () => { await processes.stop(); await rm(scratch, { recursive: true, force: true }); });
 await Promise.all([mkdir(home, { mode: 0o700 }), mkdir(empty, { mode: 0o700 })]);
 assert.deepEqual(await readdir(empty), []);
 const env = { HOME: home, PATH: process.env.PATH, TMPDIR: scratch, LANG: 'en_US.UTF-8',
  CI: 'true', WRANGLER_SEND_METRICS: 'false', RER_SERVERS_DIR: registry,
  RER_JOBS_DIR: join(scratch, 'jobs'), XDG_DATA_HOME: join(home, '.local/share'), XDG_CACHE_HOME: join(home, '.cache') };
 const archive = join(scratch, 'installation.rer');
 let ownerEmail;
 try {
  const installation = await launch(empty, env, processes, [pathToFileURL(root).href, '--dir', 'run-vane']);
  const { page } = await installedUI({ after: cleanup => cleanups.push(cleanup) }, installation, {
   screens: process.env.VANE_SCREEN_DIR, label: 'online',
  });
  const session = await (await page.request.get(installation.ready + '/auth/session')).json();
  assert.equal(session.operator.role, 'owner');
  ownerEmail = session.operator.email;
 } finally {
  try { for (const cleanup of cleanups.reverse()) await cleanup(); }
  finally { await processes.stop(); }
 }
 try {
  await execute(join(root, 'node_modules', '.bin', 'rer'), ['export', '--output', archive], {
   cwd: join(empty, 'run-vane'), env, timeout: 5 * 60_000, maxBuffer: 1024 * 1024,
  });
 } catch (error) { throw new Error('Public local rer export failed: ' + redactedTail(error.stdout ?? '', error.stderr ?? '')); }
 return { archive, ownerEmail };
}

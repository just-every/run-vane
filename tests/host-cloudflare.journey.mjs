import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readFile, mkdir } from 'node:fs/promises';
import { join, resolve, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes } from 'node:crypto';
import { redactedTail } from './host-local-processes.mjs';
import { main as ownerMain, report } from '@runeditrun/rer/modules/deploy-kit/owner-cli';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const execute = promisify(execFile);

test('HOST-003 local rer archive restores the same fixture pageview into a fresh Cloudflare deployment', {
 skip: process.env.VANE_HOST_CLOUDFLARE_JOURNEY !== '1' ? 'explicit held-account journey only' : false,
 timeout: 25 * 60_000,
}, async t => {
 const archive = process.env.VANE_HOST_ARCHIVE;
 assert.ok(archive, 'Supply the archive exported by the installed local journey');
 const environment = 'host-transfer-c45';
 const state = join(root, '.rer', 'deploy', `${environment}.json`);
 const args = command => [command, '--declaration', 'deploy.json', '--environment', environment, '--product', '', '--state', state];
 const privateEnv = { ...process.env, OWNER_EMAIL: 'owner@example.test', SESSION_SECRET: randomBytes(32).toString('hex'),
  SETUP_TOKEN: randomBytes(32).toString('hex'), MAIL_API_KEY: 'synthetic-vane-1' };
 let browser;
 // The deploy kit deletes only resources recorded as created by this exact run.
 t.after(async () => {
  try { await browser?.close(); }
  finally {
   const held = await readFile(state, 'utf8').catch(error => { if (error.code === 'ENOENT') return null; throw error; });
   if (held) await ownerMain(args('remove'), privateEnv, { cwd: root, notice: () => {} });
  }
 });
 let deployed;
 try { deployed = await ownerMain(args('deploy'), privateEnv, { cwd: root, notice: () => {} }); }
 catch (error) { throw new Error('Fresh test deployment failed: ' + JSON.stringify(report(error))); }
 const record = JSON.parse(await readFile(state, 'utf8'));
 const databases = Object.values(record.owned.d1).filter(value => value.status === 'created');
 assert.equal(databases.length, 1);
 // No scheduled or incoming writer runs during a complete installation restore.
 const api = `https://api.cloudflare.com/client/v4/accounts/${privateEnv.CLOUDFLARE_ACCOUNT_ID}`;
 const schedules = `${api}/workers/scripts/${deployed.worker}/schedules`;
 const headers = { authorization: `Bearer ${privateEnv.CLOUDFLARE_API_TOKEN}`, 'content-type': 'application/json' };
 assert.equal((await fetch(schedules, { method: 'PUT', headers, body: '[]' })).status, 200);
 const paused = await (await fetch(schedules, { headers })).json();
 assert.equal(paused.success, true); assert.equal(paused.result.schedules?.length ?? paused.result.length, 0);
 const env = { ...privateEnv, VANE_REMOTE_DATABASE_ID: databases[0].id, VANE_REMOTE_TRANSFER_PAUSED: '1', WRANGLER_SEND_METRICS: 'false' };
 // Invoke the actual public command, including its confirmation and archive checks.
 try {
  await execute(join(root, 'node_modules', '.bin', 'rer'), ['import', '--target', 'remote', '--input', relative(root, resolve(archive)), '--yes'], {
   cwd: root, env, timeout: 10 * 60_000, maxBuffer: 1024 * 1024,
  });
 } catch (error) {
  // CLI logs contain no provider credential, but keep all child output private.
  throw new Error(`Public remote rer import failed (exit ${error.code ?? 'unknown'}): ${redactedTail(error.stdout ?? '', error.stderr ?? '')}`);
 }
 const signin = await ownerMain(args('signin'), privateEnv, { cwd: root, notice: () => {} });
 const { chromium, expect } = await import('@playwright/test');
 browser = await chromium.launch({ headless: true, args: ['--use-mock-keychain', '--password-store=basic'] });
 const context = await browser.newContext(), page = await context.newPage();
 try { await page.goto(signin.link); }
 catch { throw new Error('The private hosted owner sign-in link could not be opened'); }
 await page.getByRole('button', { name: /Confirm/ }).click();
 await page.goto(deployed.origin + '/app');
 await page.getByRole('link', { name: 'Northline Coffee', exact: true }).click();
 const url = new URL(page.url()); url.search = '?section=report';
 for (const width of [1440, 390]) {
  await page.setViewportSize({ width, height: 960 }); await page.goto(url.href);
  await expect(page.getByRole('heading', { name: 'Pageviews', exact: true }).locator('..').locator('.vane-metric')).toHaveText('1');
  await expect(page.locator('main')).toContainText('/subscriptions');
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  if (process.env.VANE_SCREEN_DIR) {
   await mkdir(process.env.VANE_SCREEN_DIR, { recursive: true });
   await page.screenshot({ path: join(process.env.VANE_SCREEN_DIR, `host-cloudflare-report-${width}.png`) });
  }
 }
 t.diagnostic('The public rer import restored the exported local fixture pageview into a fresh held-account deployment; both report widths passed.');
});

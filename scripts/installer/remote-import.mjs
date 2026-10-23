import { RerError } from '@runeditrun/rer/internal/cli/errors.mjs';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { getPlatformProxy, unstable_splitSqlQuery } from 'wrangler';
import { parseJsonc } from '@runeditrun/rer/jsonc';
import { createPortability, readArchive, PortabilityError } from '@runeditrun/rer/modules/portability';
import { fileRecords, importArchive } from '@runeditrun/rer/modules/portability/files';
import { migrationReplay } from '@runeditrun/rer/modules/portability/migration-history';
import { appliedMigrations, platformMigrationDeclaration } from '@runeditrun/rer/portability-migrations';
import { portabilityPlan, ensurePortabilitySchema } from '@runeditrun/rer/internal/modules/container/portability-schema.mjs';
import { installationPolicy } from './portability-policy.mjs';

function refuse(message) { throw new RerError('safety_refusal', message, 4); }

// This is a command operated with the destination owner's Cloudflare credential.
// No remotely reachable restore endpoint or application sign-in bypass is added.
export async function remoteImport({ root, path, journal, platform, legacyRecovery, store }) {
 if (journal || legacyRecovery || (platform && platform !== 'workers')) refuse('Hosted restore supports a complete v2 archive on Workers only.');
 const account = process.env.CLOUDFLARE_ACCOUNT_ID, database = process.env.VANE_REMOTE_DATABASE_ID;
 if (!/^[a-f0-9]{32}$/.test(account ?? '') || !/^[a-f0-9-]{36}$/.test(database ?? '') || !process.env.CLOUDFLARE_API_TOKEN) {
  refuse('Hosted restore needs the destination CLOUDFLARE_ACCOUNT_ID, CLOUDFLARE_API_TOKEN and VANE_REMOTE_DATABASE_ID in its private environment.');
 }
 if (process.env.VANE_REMOTE_TRANSFER_PAUSED !== '1') refuse('Stop the destination Worker and scheduled writers, then explicitly set VANE_REMOTE_TRANSFER_PAUSED=1 for the restore.');
 // Verify integrity before opening a provider binding or creating bookkeeping.
 for await (const record of fileRecords(path, readArchive)) { void record; }
 const config = parseJsonc(await readFile(join(root, 'wrangler.jsonc'), 'utf8'));
 if (config.d1_databases?.length !== 1 || config.d1_databases[0].binding !== 'DB' || config.r2_buckets?.length || config.kv_namespaces?.length || config.durable_objects?.bindings?.length) {
  refuse('Hosted restore requires reviewed coverage of every declared resource; this adapter covers Vane’s single D1 binding only.');
 }
 const directory = join(root, '.wrangler');
 await mkdir(directory, { recursive: true });
 const configPath = join(directory, `vane-remote-import-${process.pid}.json`);
 await writeFile(configPath, JSON.stringify({ name: config.name, account_id: account,
  compatibility_date: config.compatibility_date, compatibility_flags: config.compatibility_flags,
  d1_databases: [{ binding: 'DB', database_name: 'foundation', database_id: database, remote: true }],
 }), { mode: 0o600, flag: 'wx' });
 let proxy;
 try {
  proxy = await getPlatformProxy({ configPath, remoteBindings: true });
  const declaration = platformMigrationDeclaration();
  const plan = await appliedMigrations(root, proxy.env.DB, 'DB', declaration, unstable_splitSqlQuery);
  const migrations = async () => migrationReplay(plan, installationPolicy, declaration);
  // Destination migrations must already be applied, without bootstrapping owner
  // data. The shared importer verifies the exact schema and refuses occupied data.
  await ensurePortabilitySchema(proxy.env.DB, await portabilityPlan(unstable_splitSqlQuery));
  const service = await createPortability({ db: proxy.env.DB, policy: installationPolicy, migrations });
  const receipt = await importArchive(service, path, ['local runtime caches and logs'], undefined,
   progress => { if (progress.phase) store.report(`Hosted restore: ${progress.phase}`); });
  return { ...receipt, target: 'remote', input: relative(root, path) };
 } catch (error) {
  // Native provider errors may contain private input; report symbolic categories.
  if (error instanceof PortabilityError) refuse(`Hosted restore refused (${error.code.split(':')[0]}). Keep the source and use an empty, migration-compatible destination.`);
  throw new RerError('transfer_failed', 'Hosted restore failed before a completed receipt. Keep the source installation and inspect the destination with its owner credential.', 1);
 } finally { await proxy?.dispose(); await rm(configPath, { force: true }); }
}

import { mkdir, lstat, chmod, readFile, open, rename, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { digest, requireValue } from './common.mjs';

export async function privateDirectory(dir) {
  await mkdir(dir, { recursive: true, mode: 0o700 });
  const info = await lstat(dir);
  requireValue(info.isDirectory() && !info.isSymbolicLink(), 'INVALID_REVIEW_DIRECTORY');
  await chmod(dir, 0o700);
}

export async function readJson(dir, name, optional = false) {
  const path = join(dir, name);
  let info;
  try { info = await lstat(path); } catch (error) {
    if (optional && error.code === 'ENOENT') return null;
    throw error;
  }
  requireValue(info.isFile() && !info.isSymbolicLink() && info.size <= 32_000_000, 'INVALID_REVIEW_FILE');
  await chmod(path, 0o600);
  return JSON.parse(await readFile(path, 'utf8'));
}

export async function atomicJson(dir, name, value) {
  const temp = join(dir, '.' + randomUUID() + '.tmp');
  const file = await open(temp, 'wx', 0o600);
  try {
    await file.writeFile(JSON.stringify(value) + '\n');
    await file.sync(); await file.close();
    await rename(temp, join(dir, name));
  } catch (error) {
    await file.close().catch(() => {}); await unlink(temp).catch(() => {}); throw error;
  }
}

export const pageName = index => `page-${String(index + 1).padStart(6, '0')}.json`;
export const pageDigest = page => digest(JSON.stringify(page));

export function checkManifest(value) {
  requireValue(value?.version === 1 && typeof value.origin === 'string' && typeof value.siteId === 'string' &&
    ['umami', 'simple'].includes(value.format) && typeof value.complete === 'boolean' &&
    /^[a-f0-9]{64}$/.test(value.source?.sha256) && Number.isSafeInteger(value.source.bytes) &&
    value.source.bytes >= 0 && Array.isArray(value.pages), 'INVALID_MANIFEST');
  let rows = 0, normalizedRows = 0;
  value.pages.forEach((page, index) => {
    requireValue(page.file === pageName(index) && /^[a-f0-9]{64}$/.test(page.sourceSha256) &&
      /^[a-f0-9]{64}$/.test(page.sha256) && Number.isSafeInteger(page.rows) && page.rows > 0 && page.rows <= 500 &&
      Number.isSafeInteger(page.normalizedRows) && page.normalizedRows > 0 && page.normalizedRows <= page.rows &&
      typeof page.complete === 'boolean' && (page.jobId === null || typeof page.jobId === 'string' && page.jobId.length > 0) &&
      (!page.complete || page.jobId !== null), 'INVALID_MANIFEST_PAGE');
    rows += page.rows; normalizedRows += page.normalizedRows;
  });
  requireValue(value.rows === rows && value.normalizedRows === normalizedRows &&
    (!value.complete || value.pages.length > 0), 'INVALID_MANIFEST_TOTALS');
  return value;
}

export async function readPage(dir, entry) {
  const page = await readJson(dir, entry.file);
  requireValue(pageDigest(page) === entry.sha256, 'REVIEW_PAGE_CHANGED');
  return page;
}

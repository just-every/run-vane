import { existsSync } from 'node:fs'
import { spawnSync } from 'node:child_process'

// Only CI consumers opt in; ordinary verification still builds the checkout.
export function restoreCiBuild() {
  const archive = process.env.VANE_VERIFY_BUILD_ARCHIVE
  if (!archive) return false
  if (process.env.CI !== 'true' || !process.env.VANE_VERIFY_SHARD) {
    throw new Error('A shared verification build requires CI and an explicit shard')
  }
  const result = spawnSync('tar', ['-xf', archive], { stdio: 'inherit' })
  if (result.error) throw result.error
  if (result.status !== 0) throw new Error('Could not restore the shared verification build')
  for (const path of ['dist/server/index.js', 'dist/server/wrangler.json', 'dist/client', '.wrangler/deploy/config.json']) {
    if (!existsSync(path)) throw new Error(`Shared verification build is missing ${path}`)
  }
  return true
}

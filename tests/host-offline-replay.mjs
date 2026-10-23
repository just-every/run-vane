// Invoked only by the installed journey, after online installation finishes.
import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { ownedProcesses, launch } from './host-local-processes.mjs'
import { installedUI } from './host-local-ui.mjs'

const execute = promisify(execFile)
const scratch = process.env.VANE_HOST_INSTALLED
assert.ok(scratch, 'The installed checkout must be supplied by the parent journey')
assert.deepEqual(JSON.parse((await execute('ip', ['-j', 'address'])).stdout).map(row => row.ifname), ['lo'])
assert.equal((await execute('ip', ['route', 'show'])).stdout.trim(), '')
assert.equal((await execute('ip', ['-6', 'route', 'show', 'default'])).stdout.trim(), '')
// A real connection attempt must fail; browser routing is never the boundary.
await execute(process.execPath, ['-e', "fetch('https://example.com',{signal:AbortSignal.timeout(3000)}).then(()=>process.exit(1),()=>process.exit(0))"])
const home = join(scratch, 'home'), registry = join(scratch, 'servers')
const processes = ownedProcesses(registry), cleanups = []
const env = { HOME: home, PATH: process.env.PATH, TMPDIR: scratch, LANG: 'en_US.UTF-8',
  CI: 'true', WRANGLER_SEND_METRICS: 'false', RER_SERVERS_DIR: registry,
  RER_JOBS_DIR: join(scratch, 'jobs'), XDG_DATA_HOME: join(home, '.local/share'), XDG_CACHE_HOME: join(home, '.cache') }
try {
  const installation = await launch(join(scratch, 'empty', 'run-vane'), env, processes, [])
  await installedUI({ after: cleanup => cleanups.push(cleanup) }, installation, {
    screens: process.env.VANE_SCREEN_DIR, label: 'installed-offline',
  })
  console.log('Installed offline journey passed with only loopback and no external routes.')
} finally {
  try { for (const cleanup of cleanups.reverse()) await cleanup() }
  finally { await processes.stop() }
}

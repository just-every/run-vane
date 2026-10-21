import { spawnSync } from 'node:child_process'
import { vaneTests } from './vane-tests.mjs'

const shard = process.env.VANE_VERIFY_SHARD
if (shard && shard !== 'foundation' && !Object.hasOwn(vaneTests, shard)) throw Error(`Unknown verification shard: ${shard}`)
const commands = [['run', 'build']]
if (!shard || shard === 'foundation') commands.push(['exec', 'rer', 'build', '--site'], ['run', 'test:site'], ['run', 'typecheck'])
if (!shard) commands.push(['run', 'test:vane'])
else if (shard !== 'foundation') commands.push(['exec', 'node', 'scripts/vane-tests.mjs', shard])
if (!shard || shard === 'foundation') commands.push(['run', 'test:email-link'])
for (const args of commands) {
  const result = spawnSync('pnpm', args, { stdio: 'inherit' })
  if (result.error) throw result.error
  if (result.status !== 0) process.exit(result.status ?? 1)
}

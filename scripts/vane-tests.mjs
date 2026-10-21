import { readdirSync } from 'node:fs'
import { spawnSync } from 'node:child_process'

// These files used to be imported by vane.test.mjs. Run each in its own Node
// test process, so CI can distribute them without filtering any test cases.
const integrations = [
  ...readdirSync('tests').filter(file => file.endsWith('.test.mjs') && !['vane.test.mjs', 'site.test.mjs'].includes(file)).map(file => `tests/${file}`),
  'tests/locations.journey.mjs',
].sort()
export const vaneTests = {
  'product-1': ['tests/vane-access.mjs', 'tests/vane-metrics.mjs', 'tests/vane-reports.mjs'],
  'product-2': ['tests/vane-report-settings.mjs', 'tests/vane-conversions.mjs'],
  'product-3': ['tests/vane-team-and-exports.mjs', 'tests/vane-mobile-and-api.mjs', 'tests/vane-alerts.mjs'],
  'integrations-1': integrations.filter((_, index) => index % 2 === 0),
  'integrations-2': integrations.filter((_, index) => index % 2 === 1),
}

if (process.argv[1]?.endsWith('/vane-tests.mjs')) {
  const shard = process.argv[2]
  if (shard === '--list') console.log(JSON.stringify(vaneTests, null, 2))
  else {
    if (process.argv.length > 3 || (shard && !Object.hasOwn(vaneTests, shard))) throw Error('Unknown Vane test shard')
    const files = shard ? vaneTests[shard] : Object.values(vaneTests).flat()
    const result = spawnSync(process.execPath, ['--test', '--test-concurrency=1', ...files], { stdio: 'inherit' })
    if (result.error) throw result.error
    process.exitCode = result.status ?? 1
  }
}

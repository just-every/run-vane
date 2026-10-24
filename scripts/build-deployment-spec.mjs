import {mkdir, readFile, writeFile} from 'node:fs/promises'
import {deploymentSpec} from './delivery/base/spec.mjs'

const config = JSON.parse(await readFile(new URL('../packaging.json', import.meta.url), 'utf8'))
const bytes = JSON.stringify(await deploymentSpec(process.cwd(), config.artifact.specInputs), null, 2) + '\n'
const target = new URL('../management/integration/deployment-spec.json', import.meta.url)
if (process.argv.includes('--check')) {
 if (await readFile(target, 'utf8') !== bytes) throw Error('Deployment specification is stale; run pnpm delivery:spec')
 console.log('Deployment specification is current')
} else {
 await mkdir(new URL('.', target), {recursive: true})
 await writeFile(target, bytes)
 console.log('Wrote management/integration/deployment-spec.json')
}

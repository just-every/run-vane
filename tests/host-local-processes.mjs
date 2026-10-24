import assert from 'node:assert/strict'
import { spawn, execFile } from 'node:child_process'
import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import { setTimeout as delay } from 'node:timers/promises'
const execute = promisify(execFile)

// Read no arguments or environments from other processes. Birth checks protect
// against PID reuse; only our child and our private registry grant ownership.
async function processTable() {
  const { stdout } = await execute('ps', ['-axo', 'pid=,ppid=,stat=,lstart='], { env: { ...process.env, LC_ALL: 'C' } })
  return new Map(stdout.trim().split('\n').flatMap(line => {
    const match = line.trim().match(/^(\d+)\s+(\d+)\s+(\S+)\s+(.+)$/)
    return match ? [[Number(match[1]), { parent: Number(match[2]), state: match[3], birth: match[4] }]] : []
  }))
}

function ownedProcesses(registry) {
  const owned = new Map()
  const launchers = new Set()
  async function capture(child) {
    const table = await processTable()
    if (child && Number.isInteger(child.pid) && !launchers.has(child)) {
      launchers.add(child)
      if (table.has(child.pid)) owned.set(child.pid, table.get(child.pid).birth)
    }
    let paths = []
    try { paths = await readdir(registry, { recursive: true }) } catch (error) { if (error.code !== 'ENOENT') throw error }
    for (const path of paths.filter(path => /(?:^|\/)(?:worker|server|state)\.json$/.test(path))) {
      let record
      try { record = JSON.parse(await readFile(join(registry, path), 'utf8')) }
      catch (error) { if (error.code === 'ENOENT' || error instanceof SyntaxError) continue; throw error }
      const visit = value => {
        if (!value || typeof value !== 'object') return
        if (Number.isInteger(value.pid) && table.has(value.pid) && !owned.has(value.pid)) owned.set(value.pid, table.get(value.pid).birth)
        for (const item of Object.values(value)) visit(item)
      }
      visit(record)
    }
    for (let changed = true; changed;) {
      changed = false
      for (const [pid, info] of table) {
        if (!owned.has(pid) && owned.has(info.parent) && owned.get(info.parent) === table.get(info.parent)?.birth) {
          owned.set(pid, info.birth); changed = true
        }
      }
    }
    return table
  }
  return {
    capture,
    async stop() {
      // The repository launcher's SIGTERM handler invokes rer dev --stop. Kill
      // only our exact launcher PID directly; stop its owned descendants by PID.
      await capture()
      let table = await processTable()
      for (const child of launchers) if (owned.get(child.pid) === table.get(child.pid)?.birth) {
        try { process.kill(child.pid, 'SIGKILL') } catch (error) { if (error.code !== 'ESRCH') throw error }
      }
      for (const signal of ['SIGTERM', 'SIGKILL']) {
        table = await capture()
        for (const [pid, birth] of owned) if (pid !== process.pid && table.get(pid)?.birth === birth && !table.get(pid).state.startsWith('Z')) {
          try { process.kill(pid, signal) } catch (error) { if (error.code !== 'ESRCH') throw error }
        }
        const end = Date.now() + 5000
        do {
          await delay(100)
          table = await capture()
          if (![...owned].some(([pid, birth]) => table.get(pid)?.birth === birth && !table.get(pid).state.startsWith('Z'))) return
        } while (Date.now() < end)
      }
      assert.fail('An owned local journey process did not stop')
    },
  }
}

async function launch(cwd, env, processes, args) {
  // No inherited stdio: RER_OPEN is a credential, including on failure. Keep
  // output in memory and use only generic assertions in the test reporter.
  const runner = process.env.VANE_HOST_RER || fileURLToPath(new URL('../node_modules/.bin/rer', import.meta.url))
  const child = spawn(runner, ['dev', ...args, '--detach'], { cwd, env, stdio: ['ignore', 'pipe', 'pipe'] })
  let output = '', errors = '', exited = false, code, failed = false
  child.stdout.on('data', chunk => { output = (output + chunk.toString()).slice(-262144) })
  child.stderr.on('data', chunk => { errors = (errors + chunk.toString()).slice(-262144) })
  child.once('error', () => { failed = true; exited = true })
  child.once('close', value => { code = value; exited = true })
  await processes.capture(child)
  const deadline = Date.now() + 12 * 60_000
  while (!exited && Date.now() < deadline) { await processes.capture(); await delay(500) }
  assert.ok(exited, 'rer dev must finish installation and report readiness within twelve minutes')
  assert.equal(failed, false, 'The public rer executable must be available')
  const safe = redactedTail(output, errors)
  assert.equal(code, 0, 'Public rer dev must launch successfully (credentials withheld): ' + safe)
  const line = name => output.match(new RegExp(`^${name} (\\S+)\\s*$`, 'm'))?.[1]
  const ready = line('RER_READY'), open = line('RER_OPEN')
  assert.ok(ready && open, 'Public rer dev must print RER_READY and RER_OPEN')
  assert.ok(['127.0.0.1', 'localhost', '[::1]'].includes(new URL(ready).hostname), 'Vane must serve locally')
  assert.equal(new URL(open).origin, new URL(ready).origin, 'The sign-in link must belong to the local installation')
  return { ready: ready.replace(/\/$/, ''), open }
}

async function signIn(page, installation) {
  // Never let a Playwright navigation error echo the credential URL.
  try {
    await page.goto(installation.open)
    await page.waitForURL(url => !url.hash && !url.pathname.startsWith('/__dev/') && !url.pathname.startsWith('/auth/dev/'))
  } catch { throw new Error('The browser could not consume the private local sign-in link') }
  await finishSetup(page)
  await page.goto(installation.ready + '/app')
  await page.getByRole('heading', { name: 'Your sites', exact: true }).waitFor()
}


export async function finishSetup(page) {
  if (new URL(page.url()).pathname === '/setup') {
    await page.getByLabel('I confirm this owner account is ready to use.').check()
    await page.getByRole('button', { name: 'Finish setup', exact: true }).click()
  }
}

export function redactedTail(output, errors = '') {
  return (output + errors).split('\n').filter(line => !/RER_OPEN|RER_SIGN_IN|RER_SIGNED_IN/.test(line)).slice(-40).join('\n').replace(/https?:\/\/[^\s"'<>]+/g, '[address]').replace(/[A-Za-z0-9_+/=-]{20,}/g, '[private]').replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+/gi, '[email]')
}

export { ownedProcesses, launch, signIn }

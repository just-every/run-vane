import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { readFile, rm, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { chromium } from '@playwright/test'
import { extensionState, extensionInitialInstall } from './extension-state.mjs'

export async function chrome(t, scratch, hostname, trackerHostname) {
  assert.ok(process.env.CHROMIUM_EXECUTABLE_PATH, 'Set CHROMIUM_EXECUTABLE_PATH to the official Chrome 138 Linux executable')
  assert.ok(process.env.UBLOCK_EXTENSION_PATH, 'Set UBLOCK_EXTENSION_PATH to the unpacked official uBlock Origin MV2 extension')
  const extension = resolve(process.env.UBLOCK_EXTENSION_PATH)
  const manifest = JSON.parse(await readFile(join(extension, 'manifest.json'), 'utf8'))
  assert.equal(manifest.manifest_version, 2, 'This journey requires real blocking webRequest support from uBlock Origin MV2')
  assert.ok(manifest.permissions.includes('webRequestBlocking'))
  const profile = join(scratch, 'chrome-profile')
  const spawnChrome = () => spawn(process.env.CHROMIUM_EXECUTABLE_PATH, [
    '--headless=new', '--enable-logging=stderr', '--log-level=0', '--remote-debugging-port=0', '--remote-debugging-address=127.0.0.1',
    '--user-data-dir=' + profile, '--load-extension=' + extension, '--disable-extensions-except=' + extension,
    '--enable-features=AllowLegacyMV2Extensions',
    '--disable-features=ExtensionManifestV2Unsupported,ExtensionManifestV2Disabled,ExtensionManifestV2DeprecationWarning,DisableLoadExtensionCommandLineSwitch',
    '--password-store=basic', '--no-first-run', '--no-default-browser-check',
    '--no-sandbox', '--disable-dev-shm-usage', '--ignore-certificate-errors', '--no-proxy-server',
    '--host-resolver-rules=MAP ' + hostname + ' 127.0.0.1,MAP ' + trackerHostname + ' 127.0.0.1',
    '--user-agent=Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Safari/537.36',
    'about:blank',
  // Chrome's ProcessSingleton UNIX socket must fit Linux's 108-byte pathname limit.
  ], { env: {...process.env,TMPDIR:'/tmp'}, stdio: ['ignore', 'ignore', 'pipe'] })
  let child,stderr='',fullStderr='',launchError,browser
  const stop=async()=>{
    if(child?.exitCode!==null||child?.signalCode!==null||!child?.pid)return
    const exited=once(child,'exit');child.kill('SIGTERM')
    await Promise.race([exited,delay(5000,undefined,{ref:false})])
    if(child.exitCode===null&&child.signalCode===null){child.kill('SIGKILL');await exited}
  }
  t.after(async()=>{
    try {await browser?.close()}
    finally {await stop();if(process.env.VANE_BLOCKER_LOG)await writeFile(process.env.VANE_BLOCKER_LOG,fullStderr)}
  })
  const launch=async()=>{
    await rm(join(profile,'DevToolsActivePort'),{force:true})
    child=spawnChrome();launchError=undefined;stderr=''
    child.stderr.on('data',bytes=>{fullStderr+=bytes.toString();stderr=fullStderr.slice(-8192)})
    child.on('error',error=>{launchError=error})
    const deadline=Date.now()+30000
    while(Date.now()<deadline){
      if(launchError)throw launchError
      assert.equal(child.exitCode,null,'Chrome exited before CDP was ready: '+stderr)
      assert.equal(child.signalCode,null,'Chrome stopped before CDP was ready: '+stderr)
      try {
        const port=Number((await readFile(join(profile,'DevToolsActivePort'),'utf8')).split('\n')[0])
        if(port)return port
      } catch(error){if(error.code!=='ENOENT')throw error}
      await delay(100)
    }
    assert.fail('Chrome must expose its own ephemeral CDP port: '+stderr)
  }
  let port=await launch()
  // Install once into this journey's empty profile. The command-line unpacked
  // extension unloads on its normal first-install reload; reopen the same owned
  // profile after that observed phase. No preferences or filter lists are set.
  await extensionInitialInstall(port)
  await stop()
  port=await launch()
  browser = await chromium.connectOverCDP('http://127.0.0.1:' + port)
  const context = browser.contexts()[0]
  assert.ok(context, 'Use the fresh Chrome default context where the extension is installed')
  const filters = await extensionState(port,context)
  t.after(()=>filters.close())
  const {selected,netFilterCount} = await filters.read()
  t.diagnostic('Chrome ' + browser.version() + '; uBlock Origin ' + manifest.version + '; active network filters: '+netFilterCount+'; default lists: ' + selected.join(', '))
  return { context, filters, selected }
}

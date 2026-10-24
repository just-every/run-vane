import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { signIn } from './host-local-processes.mjs'

export async function installedUI(t, installation, { screens, label }) {
  const siteName = label === 'online' ? 'Northline Coffee' : 'Northline Coffee offline'
  let snippet = ''
  const fixture = createServer((_request, response) => {
    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' })
    response.end(`<!doctype html><html lang="en"><meta charset="utf-8"><title>Northline Coffee — subscriptions</title><h1>Fresh coffee, delivered weekly</h1><p>Choose a seasonal roast for your home or office.</p>${snippet}</html>`)
  })
  t.after(() => new Promise((done, reject) => { fixture.close(error => error ? reject(error) : done()); fixture.closeAllConnections() }))
  await new Promise((done, reject) => { fixture.once('error', reject); fixture.listen(0, '127.0.0.1', done) })
  const fixtureOrigin = `http://127.0.0.1:${fixture.address().port}`
  const { chromium, expect } = await import('@playwright/test')
  const browser = await chromium.launch({ headless: true, args: ['--use-mock-keychain', '--password-store=basic'] })
  t.after(() => browser.close())
  const owner = await browser.newContext(), page = await owner.newPage()
  await signIn(page, installation)
  await page.getByLabel('Site name', { exact: true }).fill(siteName)
  await page.getByLabel('Website origin', { exact: true }).fill(fixtureOrigin)
  await page.getByLabel('Time zone', { exact: true }).fill('Australia/Brisbane')
  await page.getByLabel('Consent', { exact: true }).selectOption('not-required')
  await page.getByRole('button', { name: 'Prepare site', exact: true }).click()
  const proposal = page.locator('article.vane-proposal')
    .filter({ has: page.getByRole('heading', { name: 'Add site', exact: true }) })
    .filter({ hasText: siteName })
  await expect(proposal).toContainText(siteName)
  await expect(proposal).toContainText(fixtureOrigin)
  await proposal.getByRole('button', { name: 'Approve change', exact: true }).click()
  await page.goto(installation.ready + '/app')
  await page.getByRole('link', { name: siteName, exact: true }).click()
  const reportURL = new URL(page.url()); reportURL.search = '?section=report'
  const settingsURL = new URL(reportURL); settingsURL.search = '?section=settings'
  await page.goto(settingsURL.href)
  snippet = await page.locator('.vane-script code').first().innerText()
  assert.match(snippet, /^<script defer src="http:\/\/[^\s]+\/vane\.js" data-site="[^\s"]+"[^>]*><\/script>$/)

  // Use a normal visitor UA to exercise accepted traffic: the application
  // deliberately rejects the headless browser's default HeadlessChrome UA.
  const userAgent = (await page.evaluate(() => navigator.userAgent)).replace('HeadlessChrome/', 'Chrome/')
  const visitor = await browser.newContext({ userAgent }), visit = await visitor.newPage()
  const collect = visit.waitForResponse(response => new URL(response.url()).pathname === '/api/vane/collect' && response.request().method() === 'POST')
  await visit.goto(fixtureOrigin + '/subscriptions')
  const accepted = await collect
  const result = await accepted.json()
  assert.equal(accepted.status(), 202, 'The real installed tracker must collect the fixture page: ' + JSON.stringify(result))
  assert.equal(result.accepted, true)
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 960 })
    await page.goto(reportURL.href)
    await page.getByRole('heading', { name: 'Overview', exact: true, level: 1 }).waitFor()
    const pageviews = page.getByRole('heading', { name: 'Pageviews', exact: true }).locator('..')
    await expect(pageviews.locator('.vane-metric')).toHaveText('1')
    await expect(page.locator('main')).toContainText('/subscriptions')
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false)
    await captureReport(page, screens, label, width)
  }
  await visitor.close()
  return { page, reportURL }
}

export async function captureReport(page, screens, label, width) {
  if (!screens) return
  const { expect } = await import('@playwright/test')
  await mkdir(screens, { recursive: true })
  await page.screenshot({ path: join(screens, `host-${label}-report-${width}.png`) })
  if (width === 390) {
    await page.getByRole('heading', { name: 'Pageviews', exact: true }).scrollIntoViewIfNeeded()
    await page.screenshot({ path: join(screens, `host-${label}-pageviews-${width}.png`) })
    const menu = page.locator('.vane-menu > summary')
    const tooltip = menu.getByRole('tooltip')
    await page.keyboard.press('Tab')
    await menu.focus()
    await expect(tooltip).toBeVisible()
    await page.screenshot({ path: join(screens, `host-${label}-menu-focus-${width}.png`) })
    await page.getByRole('heading', { level: 1 }).click()
    await menu.hover()
    await expect(tooltip).toBeVisible()
    await page.screenshot({ path: join(screens, `host-${label}-menu-hover-${width}.png`) })
  }
}

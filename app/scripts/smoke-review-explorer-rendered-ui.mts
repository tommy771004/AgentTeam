import assert from 'node:assert/strict'
import { mkdir } from 'node:fs/promises'
import { resolve } from 'node:path'

const appRoot = new URL('..', import.meta.url).pathname
const evidenceRoot = resolve(appRoot, '../.scratch/run-review-workspace/evidence/ui-release-2026-08-30')
await mkdir(evidenceRoot, { recursive: true })
const [{ createServer }, { default: react }, { default: tailwindcss }, { chromium }] = await Promise.all([
  import('vite'), import('@vitejs/plugin-react'), import('@tailwindcss/vite'), import('playwright'),
])
const server = await createServer({ configFile: false, root: appRoot, plugins: [react(), tailwindcss()], server: { host: '127.0.0.1', port: 0 } })
await server.listen()
const address = server.httpServer?.address()
const port = typeof address === 'object' && address ? address.port : 0
assert.ok(port > 0)
const browser = await chromium.launch({ headless: true })
try {
  for (const viewport of [{ name: 'desktop', width: 1280, height: 900 }, { name: 'narrow', width: 320, height: 780 }]) {
    const page = await browser.newPage({ viewport: { width: viewport.width, height: viewport.height } })
    page.on('pageerror', (error) => console.error(`[review-explorer-ui:${viewport.name}] ${error.message}`))
    page.on('requestfailed', (request) => console.error(`[review-explorer-ui:${viewport.name}] request failed: ${request.url()} ${request.failure()?.errorText || ''}`))
    await page.goto(`http://127.0.0.1:${port}/scripts/review-explorer-ui-fixture.html`, { waitUntil: 'networkidle' })
    const fileList = page.getByRole('listbox', { name: /個變更檔案/ })
    await fileList.waitFor({ timeout: 120_000 })
    assert.match(await page.locator('body').innerText(), /部分快照：2 hunks omitted/)
    assert.match(await page.locator('body').innerText(), /shared attribution/)
    assert.equal(await page.locator('body').evaluate((body) => body.scrollWidth <= window.innerWidth + 1), true, `${viewport.name} body must not overflow`)
    await page.keyboard.press(process.platform === 'darwin' ? 'Meta+f' : 'Control+f')
    assert.equal(await page.getByRole('textbox', { name: '搜尋變更檔案' }).evaluate((element) => element === document.activeElement), true)
    await page.getByRole('textbox', { name: '搜尋變更檔案' }).fill('ReviewExplorer')
    await fileList.getByRole('option').first().waitFor()
    await page.getByRole('textbox', { name: '搜尋變更檔案' }).fill('')
    const before = await fileList.getByRole('option', { selected: true }).innerText()
    await page.keyboard.press('Alt+ArrowDown')
    const after = await fileList.getByRole('option', { selected: true }).innerText()
    assert.notEqual(after, before, `${viewport.name} keyboard navigation changes selection`)
    await fileList.getByRole('option', { name: /src\/components\/ReviewExplorer\.tsx/ }).click()
    await page.getByRole('button', { name: '載入更多 hunks' }).click()
    assert.match(await page.getByLabel(/ReviewExplorer\.tsx diff/).innerText(), /context line 160/)
    await page.getByRole('button', { name: /載入更多（200\/205）/ }).click()
    assert.equal(await fileList.getByRole('option').count(), 205)
    await fileList.getByRole('option', { name: /public\/assets\/architecture-preview\.bin/ }).click()
    await page.getByText('Binary change', { exact: true }).waitFor()
    await page.getByRole('button', { name: 'Split' }).click()
    assert.equal(await page.getByLabel('Diff 顯示方式').evaluate((element) => element.scrollWidth <= element.ownerDocument.documentElement.scrollWidth), true)
    await page.screenshot({ path: resolve(evidenceRoot, `${viewport.name}.png`), fullPage: false })
    await page.close()
  }

  const errorPage = await browser.newPage({ viewport: { width: 900, height: 700 } })
  await errorPage.goto(`http://127.0.0.1:${port}/scripts/review-explorer-ui-fixture.html?scenario=error`, { waitUntil: 'networkidle' })
  await errorPage.getByText('無法載入審查', { exact: true }).waitFor({ timeout: 120_000 })
  assert.match(await errorPage.locator('body').innerText(), /Host review projection unavailable fixture/)
  await errorPage.screenshot({ path: resolve(evidenceRoot, 'error.png') })
  await errorPage.close()

  const missingPage = await browser.newPage({ viewport: { width: 900, height: 700 } })
  await missingPage.goto(`http://127.0.0.1:${port}/scripts/review-explorer-ui-fixture.html?scenario=missing`, { waitUntil: 'networkidle' })
  await missingPage.getByText('審查資料遺失', { exact: true }).waitFor({ timeout: 120_000 })
  assert.match(await missingPage.locator('body').innerText(), /missing/)
  await missingPage.screenshot({ path: resolve(evidenceRoot, 'missing.png') })
  await missingPage.close()
  console.log('rendered Review Explorer UI passed: desktop/narrow, keyboard/focus, paging/overflow, partial/binary/distinct-missing/error')
} finally {
  await browser.close()
  await server.close()
}

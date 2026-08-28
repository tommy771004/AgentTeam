import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import net from 'node:net'
import { chromium } from 'playwright'

const appRoot = new URL('..', import.meta.url).pathname

const reservePort = async () => new Promise((resolve, reject) => {
  const server = net.createServer()
  server.once('error', reject)
  server.listen(0, '127.0.0.1', () => {
    const address = server.address()
    server.close(() => resolve(address.port))
  })
})

const waitForServer = async (url) => {
  const deadline = Date.now() + 30_000
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url)
      if (response.ok) return
    } catch {
      // Vite has not bound the port yet.
    }
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  throw new Error(`Vite did not become ready: ${url}`)
}

const port = await reservePort()
const origin = `http://127.0.0.1:${port}`
const vite = spawn(process.execPath, [
  'node_modules/vite/bin/vite.js',
  '--host', '127.0.0.1',
  '--port', String(port),
  '--strictPort',
], { cwd: appRoot, stdio: ['ignore', 'pipe', 'pipe'] })
let browser

try {
  await waitForServer(origin)
  browser = await chromium.launch({ headless: true })
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } })
  await page.goto(`${origin}/#/subdesign?prototype=subdesign-unified`)

  const pinButton = page.getByRole('button', { name: /Pin 修正|點擊元素加 pin/ })
  await pinButton.waitFor()
  assert.equal(await pinButton.getAttribute('aria-pressed'), 'false', 'fixture starts idle')

  await pinButton.click()
  assert.equal(await pinButton.getAttribute('aria-pressed'), 'true', 'fixture enters pinning')

  await page.evaluate(() => window.postMessage({ type: 'subdesign-pin', selector: 'body', text: 'forged', region: { x: 0, y: 0, width: 1, height: 1 } }, '*'))
  await page.waitForTimeout(50)
  assert.equal(await page.getByText(/即將送出的 scoped 修正/).count(), 0, 'messages outside the preview iframe are ignored')

  const preview = page.frameLocator('iframe[title="Product strategy deck preview"]')
  await preview.locator('h1.title').click()
  await page.getByLabel('留言內容').fill('把主標題的間距縮小，保留其他區域不變。')
  await page.getByRole('button', { name: '加入修正' }).click()
  await page.getByText('即將送出的 scoped 修正（1）').waitFor()

  await page.getByRole('button', { name: '檢查並送出' }).click()
  await page.getByText('確認以單次 runTask 送出這 1 項修正？').waitFor()
  await page.getByRole('button', { name: '確認送出' }).click()
  await page.locator('[data-testid="pin-fixture-state"]').filter({ hasText: 'submitted' }).waitFor()
  assert.equal(await pinButton.getAttribute('aria-pressed'), 'false', 'successful submission returns to idle')

  console.log('SubDesign pin component fixture passed: idle → pinning → submitted')
} finally {
  await browser?.close().catch(() => {})
  vite.kill('SIGTERM')
}

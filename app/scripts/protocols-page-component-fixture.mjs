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

  const mobile = await browser.newPage({ viewport: { width: 390, height: 844 } })
  await mobile.goto(`${origin}/#/`)
  const drawer = mobile.getByRole('complementary', { name: '對話列表' })
  await drawer.waitFor()
  assert.equal(await drawer.isVisible(), true, 'mobile thread drawer becomes visible')
  await mobile.getByTitle('收合').click()
  await mobile.getByRole('button', { name: '開啟對話列表' }).click()
  await drawer.waitFor()

  const desktop = await browser.newPage({ viewport: { width: 1280, height: 900 } })
  await desktop.goto(`${origin}/#/`)
  const fileInput = desktop.locator('input[type="file"]')
  await fileInput.setInputFiles({
    name: 'thread-a-notes.txt',
    mimeType: 'text/plain',
    buffer: Buffer.from('thread A only'),
  })
  await desktop.getByText('thread-a-notes.txt').waitFor()

  await desktop.getByRole('button', { name: '新增內容與設定' }).click()
  await desktop.getByRole('button', { name: '新增對話' }).click()
  assert.equal(await desktop.getByText('thread-a-notes.txt').count(), 0, 'new thread does not inherit attachments')

  const threadRows = desktop.locator('[role="button"][title*="新對話"]')
  assert.ok(await threadRows.count() >= 2, 'fixture created a second thread')
  await threadRows.last().click()
  await desktop.getByText('thread-a-notes.txt').waitFor()

  console.log('Protocols page component fixture passed: mobile drawer and thread-scoped attachments')
} finally {
  await browser?.close().catch(() => {})
  vite.kill('SIGTERM')
}

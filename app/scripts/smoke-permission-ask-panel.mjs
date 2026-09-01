import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import net from 'node:net'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { chromium } from 'playwright'

const appRoot = new URL('..', import.meta.url).pathname

const reservePort = () => new Promise((resolve, reject) => {
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
      if ((await fetch(url)).ok) return
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
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } })
  await page.goto(origin)
  await page.evaluate(async () => {
    const { default: React } = await import('/node_modules/.vite/deps/react.js')
    const { default: ReactDOM } = await import('/node_modules/.vite/deps/react-dom_client.js')
    const { PermissionAskPanel } = await import('/src/components/PermissionAskModal.tsx')
    const { usePermissionAskStore } = await import('/src/store/permissionAskStore.ts')
    document.getElementById('root').style.display = 'none'
    const fixture = document.createElement('main')
    fixture.id = 'permission-panel-fixture'
    fixture.className = 'bg-background p-3 text-ink'
    document.body.append(fixture)
    const root = ReactDOM.createRoot(fixture)
    window.permissionAskFixtureStore = usePermissionAskStore
    window.renderPermissionAskFixture = (threadId = 'thread-a') => root.render(
      React.createElement(PermissionAskPanel, { threadId }),
    )
    usePermissionAskStore.setState({
      current: {
        id: 'ask-b', threadId: 'thread-b', runId: 'run-b', callId: 'call-b',
        tool: 'workspace_write', argsJson: '{"path":"b.txt"}', reason: 'B 對話的請求',
        createdAt: new Date().toISOString(),
      },
      queue: [{
        id: 'ask-a', threadId: 'thread-a', runId: 'run-a', callId: 'call-a',
        tool: 'workspace_write', argsJson: '{"path":"a.txt"}', reason: '允許寫入 a.txt？',
        createdAt: new Date().toISOString(),
      }],
    })
    window.renderPermissionAskFixture()
  })

  const panel = page.getByRole('region', { name: '需要核准' })
  await panel.waitFor()
  assert.match(await panel.textContent(), /允許寫入 a\.txt？/)
  assert.doesNotMatch(await panel.textContent(), /B 對話|逾時|自動拒絕|\d+s/)
  assert.equal(await page.locator('dialog').count(), 0, 'the decision surface is not modal')
  assert.equal(await panel.getAttribute('aria-live'), 'polite')
  assert.equal(await panel.evaluate((element) => element.scrollWidth <= element.clientWidth), true)

  const screenshots = await mkdtemp(join(tmpdir(), 'agentteam-permission-panel-'))
  for (const theme of ['light', 'dark']) {
    await page.evaluate((value) => { document.documentElement.dataset.theme = value }, theme)
    await page.locator('#permission-panel-fixture').screenshot({
      path: join(screenshots, `${theme}.png`),
      animations: 'disabled',
    })
  }

  await panel.getByRole('button', { name: '拒絕' }).click()
  await panel.waitFor({ state: 'detached' })
  assert.equal(await page.evaluate(() => window.permissionAskFixtureStore.getState().current?.runId), 'run-b')
  assert.equal(await page.evaluate(() => window.permissionAskFixtureStore.getState().queue.length), 0)
  console.log(`Permission ask panel passed: inline, thread-scoped, no countdown, explicit decision. Screenshots: ${screenshots}`)
} finally {
  await browser?.close()
  vite.kill('SIGTERM')
}

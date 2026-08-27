import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import net from 'node:net'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
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

const verifyTaskRows = async (browser, origin) => {
  const page = await browser.newPage({ viewport: { width: 320, height: 860 } })
  const errors = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.goto(origin)
  await page.evaluate(async () => {
    const { default: React } = await import('/node_modules/.vite/deps/react.js')
    const { default: ReactDOM } = await import('/node_modules/.vite/deps/react-dom_client.js')
    const h = React.createElement
    const { RunTaskRow } = await import('/src/components/RunTaskRow.tsx')
    document.getElementById('root').style.display = 'none'
    const fixture = document.createElement('main')
    fixture.id = 'task-row-fixture'
    fixture.className = 'bg-inset p-3 text-ink'
    document.body.append(fixture)
    const root = ReactDOM.createRoot(fixture)
    let state = { status: 'pending', live: true, runId: 'run-a' }
    window.updateTaskRowsFixture = (patch = {}) => {
      state = { ...state, ...patch }
      root.render(h('div', { className: 'space-y-4' },
        h('h2', null, '任務步驟'),
        h('ul', { 'aria-label': '任務步驟', className: 'space-y-2' },
          h(RunTaskRow, {
            key: state.runId, index: 0, text: '讀取工作區中很長的任務說明並驗證結果',
            status: state.status, live: state.live, detail: '實際結果：已找到設定檔', meta: '1.2s',
          }),
          h(RunTaskRow, { key: 'second', index: 1, text: '整理回報', status: 'pending', live: true }),
          h(RunTaskRow, { key: 'skipped', index: 2, text: '選用步驟', status: 'skipped' }),
        ),
        h('h2', null, '任務計畫'),
        h('ul', { 'aria-label': '任務計畫', className: 'overflow-hidden rounded-xl bg-surface' },
          h(RunTaskRow, { key: 'archived', index: 0, text: '執行已結束的未完成步驟', status: 'active', variant: 'list' }),
          h(RunTaskRow, { key: 'failed', index: 1, text: '檢查檔案', status: 'failed', variant: 'list' }),
          h(RunTaskRow, { key: 'done', index: 2, text: '載入設定', status: 'done', variant: 'list' }),
        ),
      ))
    }
    window.updateTaskRowsFixture()
  })
  const rows = page.getByRole('list', { name: '任務步驟', exact: true })
  const first = rows.getByRole('button').nth(0)
  const second = rows.getByRole('button').nth(1)
  await first.waitFor()
  assert.equal(await first.getAttribute('aria-expanded'), 'false')
  assert.equal(await rows.locator('.animate-spin').count(), 0, 'pending tasks do not spin')
  await first.focus()
  await page.keyboard.press('Enter')
  assert.equal(await first.getAttribute('aria-expanded'), 'true', 'Enter opens full task details')
  const detailId = await first.getAttribute('aria-controls')
  assert.equal(await page.locator(`[id="${detailId}"] > [aria-hidden]`).getAttribute('aria-hidden'), 'false')
  assert.match(await page.locator(`[id="${detailId}"]`).textContent(), /實際結果：已找到設定檔.*1\.2s/)
  await second.click()
  assert.equal(await first.getAttribute('aria-expanded'), 'true', 'rows can remain open independently')
  for (const [status, label] of [['active', '進行中'], ['failed', '失敗'], ['done', '已完成']]) {
    await page.evaluate((status) => window.updateTaskRowsFixture({ status }), status)
    await first.filter({ hasText: label }).waitFor()
    assert.equal(await first.getAttribute('aria-expanded'), 'true', 'status updates preserve manual disclosure')
    assert.equal(await first.locator('.animate-spin').count(), status === 'active' ? 1 : 0)
  }
  await first.focus()
  await page.keyboard.press('Space')
  assert.equal(await first.getAttribute('aria-expanded'), 'false', 'Space closes details')
  await first.click()
  await page.evaluate(() => window.updateTaskRowsFixture({ runId: 'run-b', status: 'active' }))
  await first.filter({ hasText: '進行中' }).waitFor()
  assert.equal(await first.getAttribute('aria-expanded'), 'false', 'a new run does not inherit disclosure state')
  const archive = page.getByRole('list', { name: '任務計畫', exact: true })
  assert.equal(await archive.locator('.animate-spin').count(), 0, 'archived active status never spins')
  assert.match(await archive.textContent(), /未完成/)
  assert.match(await rows.textContent(), /已略過/)
  await first.click()
  const screenshots = await mkdtemp(join(tmpdir(), 'agentteam-task-rows-'))
  for (const theme of ['light', 'dark']) {
    await page.evaluate((theme) => { document.documentElement.dataset.theme = theme }, theme)
    await page.locator('#task-row-fixture').screenshot({ path: join(screenshots, `${theme}.png`), animations: 'disabled' })
    assert.equal(await rows.evaluate((el) => el.scrollWidth <= el.clientWidth), true, 'narrow task rows do not overflow')
  }
  await page.emulateMedia({ reducedMotion: 'reduce' })
  assert.ok(await first.locator('svg').evaluate((el) => parseFloat(getComputedStyle(el).animationDuration) < 0.001), 'reduced motion disables continuous spinning')
  assert.deepEqual(errors, [], 'task row rendering has no browser exceptions')
  await page.close()
  console.log(`Task rows fixture passed: keyboard disclosure, live status, archive, run isolation, themes, reduced motion. Screenshots: ${screenshots}`)
}

const verifyCodeBlocks = async (browser, origin) => {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } })
  const errors = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.goto(origin)
  await page.evaluate(async () => {
    const { default: React } = await import('/node_modules/.vite/deps/react.js')
    const { default: ReactDOM } = await import('/node_modules/.vite/deps/react-dom_client.js')
    const { MarkdownBody } = await import('/src/components/MarkdownBody.tsx')
    document.getElementById('root').style.display = 'none'
    const fixture = document.createElement('main')
    fixture.id = 'code-block-fixture'
    fixture.className = 'p-3 agent-streaming-body'
    document.body.append(fixture)
    const root = ReactDOM.createRoot(fixture)
    window.renderCodeFixture = (content, streaming = true) => root.render(React.createElement(MarkdownBody, { content, streaming }))
    window.copiedCode = []
    window.clipboardMode = 'success'
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: {
      writeText: async (text) => {
        if (window.clipboardMode === 'error') throw new Error('Permission denied')
        if (window.clipboardMode === 'delayed') await new Promise((resolve) => { window.resolveCopy = resolve })
        window.copiedCode.push(text)
      },
    } })
  })
  const raw = 'export async function readConfig() {\n  const value = "設定 <安全> & \\"原文\\"";\n\n  return 42;\n}'
  const prefix = '```ts title="src/config.ts"\n'
  const render = async (content, streaming = true) => {
    await page.evaluate(({ content, streaming }) => window.renderCodeFixture(content, streaming), { content, streaming })
    await page.waitForFunction(({ content, streaming }) => {
      return import('/src/lib/renderMarkdown.ts').then(({ renderMarkdown }) => {
        const expected = document.createElement('div')
        expected.innerHTML = renderMarkdown(content, streaming)
        return document.querySelector('#code-block-fixture .markdown-body')?.innerHTML === expected.innerHTML
      })
    }, { content, streaming })
  }
  await render(prefix + raw)
  const block = page.locator('.agent-code-block').first()
  const copy = block.getByRole('button', { name: '複製程式碼' })
  assert.equal(await block.locator('code').textContent(), raw, 'highlighting preserves every code character and blank line')
  assert.equal(await block.locator('.agent-code-filename').textContent(), 'src/config.ts')
  assert.equal(await block.locator('.agent-code-lang').textContent(), 'TypeScript')
  assert.equal(await block.locator('.agent-code-count').textContent(), '5 行')
  assert.ok(await block.locator('.agent-code-keyword').count() > 0)
  assert.ok(await block.locator('.agent-code-string').count() > 0)
  assert.ok(await block.locator('.agent-code-number').count() > 0)
  assert.equal(await block.getAttribute('data-streaming'), 'true')
  await copy.focus()
  await page.keyboard.press('Enter')
  await copy.filter({ hasText: '已複製' }).waitFor()
  assert.equal(await page.evaluate(() => window.copiedCode.at(-1)), raw, 'copy excludes line numbers, caret and header')
  await page.waitForFunction(() => document.querySelector('[data-copy-label]').textContent === '複製')
  await page.evaluate(() => { window.clipboardMode = 'error' })
  await copy.click()
  await copy.filter({ hasText: '複製失敗' }).waitFor()
  await page.evaluate(() => { window.clipboardMode = 'delayed' })
  await copy.click()
  await page.waitForFunction(() => typeof window.resolveCopy === 'function')
  await render(prefix + raw + '\n// 新收到的一行')
  await page.evaluate(() => window.resolveCopy())
  assert.equal(await copy.textContent(), '複製', 'a completed stale copy does not mark replacement content copied')
  await page.evaluate(() => { window.clipboardMode = 'success' })
  await copy.click()
  await copy.filter({ hasText: '已複製' }).waitFor()
  assert.equal(await page.evaluate(() => window.copiedCode.at(-1)), raw + '\n// 新收到的一行', 'copy uses the latest visible stream')
  await render(prefix + raw, false)
  assert.equal(await block.getAttribute('data-streaming'), null, 'settlement removes the caret even for an unclosed fence')
  await render(prefix + raw + '\n```')
  assert.equal(await block.getAttribute('data-streaming'), null, 'a closed code fence does not keep streaming')
  const unsafe = '<img src=x onerror="window.fixtureInjected=true">\n<script>alert(1)</script>'
  await render('~~~unknown\n' + unsafe + '\n~~~', false)
  assert.equal(await block.locator('code').textContent(), unsafe)
  assert.equal(await block.locator('img, script').count(), 0, 'unknown languages remain escaped text')
  assert.equal(await block.locator('.agent-code-filename').count(), 0, 'no filename is fabricated')
  await render('````text\n```ts\nconst x = 1\n```\n````', false)
  assert.equal(await block.locator('code').textContent(), '```ts\nconst x = 1\n```', 'shorter embedded fences stay literal')
  await render('```json\n{"x":1}\n```\n\n```text\nsecond\n```', false)
  await copy.click()
  await copy.filter({ hasText: '已複製' }).waitFor()
  assert.equal(await page.locator('[data-copy-code]').nth(1).textContent(), '複製', 'copy feedback is block-scoped')
  await page.evaluate(() => { Object.defineProperty(navigator, 'clipboard', { configurable: true, value: undefined }) })
  await page.locator('[data-copy-code]').nth(1).click()
  await page.locator('[data-copy-code]').nth(1).filter({ hasText: '複製失敗' }).waitFor()
  await render(prefix + raw + '\n// ' + 'long-line-'.repeat(40))
  const screenshots = await mkdtemp(join(tmpdir(), 'agentteam-code-block-'))
  for (const theme of ['light', 'dark']) {
    await page.evaluate((theme) => { document.documentElement.dataset.theme = theme }, theme)
    await page.locator('#code-block-fixture').screenshot({ path: join(screenshots, `${theme}.png`), animations: 'disabled' })
    assert.equal(await page.locator('#code-block-fixture').evaluate((el) => el.scrollWidth <= el.clientWidth), true, 'long lines scroll inside the code block')
    assert.equal(await block.locator('pre').evaluate((el) => el.scrollWidth > el.clientWidth), true)
  }
  assert.deepEqual(errors, [], 'clipboard rejection and rendering have no unhandled browser exceptions')
  await page.close()
  console.log(`Code block fixture passed: streaming, copy/error/race, safe highlighting, fences, themes, horizontal scroll. Screenshots: ${screenshots}`)
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

  const threadRows = desktop.locator('button.sidebar-thread-select[title*="新對話"]')
  assert.ok(await threadRows.count() >= 2, 'fixture created a second thread')
  await threadRows.last().click()
  await desktop.getByText('thread-a-notes.txt').waitFor()

  const modelMenu = desktop.getByTitle('模型與推理強度')
  await modelMenu.click()
  await desktop.getByRole('button', { name: /^模型/ }).last().click()
  await desktop.locator('input:not([type="file"])').last().fill('fixture-model')
  await desktop.getByRole('button', { name: '套用', exact: true }).click()
  assert.match(
    (await modelMenu.textContent()) || '',
    /fixture-model/,
    'model selection is projected without leaving and reopening the page',
  )

  const quickActions = desktop.getByRole('button', { name: '新增內容與設定' })
  await quickActions.click()
  await desktop.getByRole('button', { name: /規劃模式/ }).click()
  await quickActions.click()
  const planClasses = ((await desktop.getByRole('button', { name: /規劃模式/ }).getAttribute('class')) || '')
    .split(/\s+/)
  assert.ok(planClasses.includes('bg-hover-2'), 'Plan selection is projected immediately')

  await desktop.evaluate(async () => {
    const { useSettingsStore } = await import('/src/store/settingsStore.ts')
    useSettingsStore.setState((state) => ({
      settings: {
        ...state.settings,
        cliProviders: [
          {
            id: 'codex',
            kind: 'codex',
            name: 'Codex',
            enabled: true,
            authorized: true,
            models: [{ id: 'fixture-codex', label: 'Fixture Codex' }],
          },
        ],
      },
    }))
  })
  await desktop.getByRole('button', { name: 'Codex', exact: true }).click()
  await quickActions.click()
  const codexClasses = ((await desktop.getByRole('button', { name: 'Codex', exact: true }).getAttribute('class')) || '')
    .split(/\s+/)
  assert.ok(codexClasses.includes('bg-accent-tint'), 'CLI runner selection is projected immediately')

  await verifyTaskRows(browser, origin)
  await verifyCodeBlocks(browser, origin)
  console.log('Protocols page component fixture passed: responsive drawer, thread isolation, and live composer settings')
} finally {
  await browser?.close().catch(() => {})
  vite.kill('SIGTERM')
}

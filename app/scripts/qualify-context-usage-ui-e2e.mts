import assert from 'node:assert/strict'
import { appendTurnRecord, parseTurnRecord } from '../src/agent/turnRecord.ts'
import { projectContextUsage } from '../src/agent/contextUsageProjection.ts'

const appRoot = new URL('..', import.meta.url).pathname
let server: Awaited<ReturnType<(typeof import('vite'))['createServer']>> | undefined
let browser: Awaited<ReturnType<(typeof import('playwright'))['chromium']['launch']>> | undefined

const usage = (input: number, output: number, total: number, contextTokens: number, costUsd?: number) => ({
  input, output, total, cachedRead: Math.floor(input / 2), cachedWrite: 0,
  contextTokens,
  ...(costUsd === undefined ? {} : { costUsd }),
})

let runningRecord = appendTurnRecord(undefined, [
  { kind: 'turn-start', source: 'host', turn: 1, step: 1, at: 1 },
  { kind: 'user-text', source: 'user', content: 'inspect release', turn: 1, step: 1, at: 2 },
  { kind: 'assistant-text', source: 'model', content: 'first result', turn: 1, step: 1, at: 3 },
  { kind: 'step-end', source: 'host', timing: { requestAt: 1, completedAt: 4, usage: usage(4_000, 200, 4_200, 3_500, 0.012) }, turn: 1, step: 1, at: 4 },
  { kind: 'step-start', source: 'host', turn: 1, step: 2, at: 5 },
  { kind: 'assistant-text', source: 'model', content: 'still streaming', turn: 1, step: 2, at: 6 },
])
const settledRecord = appendTurnRecord(runningRecord, [
  { kind: 'step-end', source: 'host', timing: { requestAt: 5, completedAt: 7, usage: usage(6_000, 300, 6_300, 11_000, 0.018) }, turn: 1, step: 2, at: 7 },
])
const legacyEntries = settledRecord.entries.map((entry) => entry.kind === 'step-end' && entry.timing?.usage
  ? { ...entry, timing: { ...entry.timing, usage: { input: entry.timing.usage.input, output: entry.timing.usage.output, total: entry.timing.usage.total } } }
  : entry)
const legacyRecord = parseTurnRecord({ version: 1, entries: legacyEntries }).record
const payload = {
  running: projectContextUsage(runningRecord, { contextWindow: 200_000 }),
  settled: projectContextUsage(settledRecord, { contextWindow: 200_000 }),
  legacy: projectContextUsage(legacyRecord, { contextWindow: 200_000 }),
  unknown: projectContextUsage(legacyRecord),
  externalTokens: 8_500,
}

try {
  const [{ createServer }, { default: react }, { default: tailwindcss }, { chromium }] = await Promise.all([
    import('vite'), import('@vitejs/plugin-react'), import('@tailwindcss/vite'), import('playwright'),
  ])
  server = await createServer({ configFile: false, root: appRoot, plugins: [react(), tailwindcss()], server: { host: '127.0.0.1', port: 0 } })
  await server.listen()
  const address = server.httpServer?.address()
  const port = typeof address === 'object' && address ? address.port : 0
  assert.ok(port > 0)
  browser = await chromium.launch({ headless: true })
  const page = await browser.newPage({ viewport: { width: 1_100, height: 850 } })
  await page.goto(`http://127.0.0.1:${port}/scripts/context-usage-ui-fixture.html?payload=${encodeURIComponent(JSON.stringify(payload))}`, { waitUntil: 'networkidle' })

  const live = page.getByTestId('live-panel')
  await live.waitFor({ state: 'visible' })
  assert.match(await live.innerText(), /4,200 tokens/)
  assert.match(await live.innerText(), /1 個步驟執行中，尚未計入/)
  assert.doesNotMatch(await live.innerText(), /10,500 tokens/)
  await page.getByTestId('settle-step').click()
  assert.match(await live.innerText(), /10,500 tokens/)
  assert.match(await live.innerText(), /US\$0\.03/)
  assert.match(await live.innerText(), /6%/)
  assert.doesNotMatch(await live.innerText(), /步驟執行中，尚未計入/)

  const legacy = await page.getByTestId('legacy-panel').innerText()
  assert.match(legacy, /10,500 tokens/)
  assert.doesNotMatch(legacy, /US\$/)
  assert.match(legacy, /快取讀\s*—/)
  const unknown = await page.getByTestId('unknown-panel').innerText()
  assert.doesNotMatch(unknown, /US\$/)
  assert.match(unknown, /context window 未知/)
  assert.doesNotMatch(unknown, /context window 未知\s+\d+%/)
  const external = await page.getByTestId('external-panel').innerText()
  assert.match(external, /8,500 tokens/)
  assert.match(external, /只回報總量/)
  assert.doesNotMatch(external, /輸入\s+\d|快取讀\s+\d|US\$/)

  await page.setViewportSize({ width: 320, height: 850 })
  for (const testId of ['live-panel', 'legacy-panel', 'unknown-panel', 'external-panel']) {
    assert.equal(await page.getByTestId(testId).evaluate((node) => node.scrollWidth <= node.clientWidth + 1), true, `${testId} overflows narrow viewport`)
  }
  console.log('Context Usage rendered qualification passed: live settlement, honest omissions, legacy replay, external degradation, and narrow layout')
} finally {
  await browser?.close()
  await server?.close()
}

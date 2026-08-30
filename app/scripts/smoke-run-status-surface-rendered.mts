import assert from 'node:assert/strict'
import { mkdir } from 'node:fs/promises'
import { resolve } from 'node:path'
import { projectRunStatusSurface } from '../src/agent/runStatusSurface.ts'
import { deriveRunLifecycle } from '../src/agent/runLifecycle.ts'
import { BUILTIN_RUNNER_CAPABILITIES } from '../src/agent/runners/types.ts'

const replayWorkingState = {
  runId: 'replay-run', revision: 2, verification: 'verified' as const, objective: 'private objective', constraints: [], tombstoned: false,
  goals: [
    { id: 'a', description: '第一步', status: 'done' as const, evidence: [], hiddenEvidenceCount: 0 },
    { id: 'b', description: '第二步', status: 'pending' as const, evidence: [], hiddenEvidenceCount: 0 },
  ],
}
const replayLifecycle = deriveRunLifecycle({ phase: 'executing', status: 'running', active: true })
const replayInput = {
  lifecycle: replayLifecycle,
  capabilities: BUILTIN_RUNNER_CAPABILITIES,
  isExternal: false,
  activity: { events: [], fileChanges: [], terminal: null, updatedAt: 1, interaction: null },
  workingState: replayWorkingState,
}
const liveProjection = projectRunStatusSurface(replayInput)
const reloadedProjection = projectRunStatusSurface(structuredClone(replayInput))
assert.deepEqual(reloadedProjection.secondary, liveProjection.secondary, 'live/reload/replay select the same variant and milestone ordering')

const appRoot = new URL('..', import.meta.url).pathname
const evidenceRoot = resolve(appRoot, '../.scratch/adaptive-agent-run-status-surface/evidence/ui-2026-08-30')
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
const forbidden = ['Reference chat history', 'AGENTS / CLAUDE', '/Users/tommy', 'Host 已驗證 rev 99', 'raw-output-secret']

async function openScenario(name: string) {
  const page = await browser.newPage({ viewport: { width: 360, height: 780 } })
  page.on('pageerror', (error) => console.error(`[run-status:${name}] ${error.message}`))
  await page.goto(`http://127.0.0.1:${port}/scripts/run-status-surface-fixture.html?scenario=${name}`, { waitUntil: 'domcontentloaded' })
  await page.getByRole('heading', { name: '執行狀態' }).waitFor({ timeout: 120_000 })
  return page
}

try {
  const builtin = await openScenario('builtin')
  assert.equal(await builtin.getByRole('status').count(), 1, 'primary lifecycle is the only polite status region')
  assert.equal(await builtin.getByRole('heading', { name: '任務進度' }).count(), 1)
  const milestoneText = await builtin.getByRole('list', { name: '任務里程碑' }).innerText()
  for (const label of ['已完成', '進行中', '等待中', '受阻']) assert.match(milestoneText, new RegExp(label))
  assert.equal(await builtin.getByRole('progressbar').count(), 0, 'open-ended goal work has no percentage progressbar')
  const builtinText = await builtin.locator('body').innerText()
  for (const value of forbidden) assert.doesNotMatch(builtinText, new RegExp(value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))
  const beforeReload = await builtin.getByRole('list', { name: '任務里程碑' }).innerText()
  await builtin.reload({ waitUntil: 'domcontentloaded' })
  await builtin.getByRole('heading', { name: '執行狀態' }).waitFor({ timeout: 120_000 })
  assert.equal(await builtin.getByRole('list', { name: '任務里程碑' }).innerText(), beforeReload, 'reload preserves variant and milestone order')
  await builtin.screenshot({ path: resolve(evidenceRoot, 'builtin-progress.png') })
  const details = builtin.getByRole('button', { name: /執行資訊/ }).last()
  await details.focus()
  await builtin.keyboard.press('Enter')
  assert.equal(await details.getAttribute('aria-expanded'), 'true', 'diagnostic disclosure is keyboard operable')
  assert.match(await builtin.locator('body').innerText(), /Host 已驗證 · rev 7/)
  await builtin.close()

  const external = await openScenario('external')
  assert.equal(await external.getByRole('heading', { name: '最近活動' }).count(), 1)
  assert.equal(await external.getByRole('list', { name: '最近活動' }).getByRole('listitem').count(), 5)
  assert.doesNotMatch(await external.locator('body').innerText(), /已驗證|任務進度|\d+%/)
  assert.equal(await external.locator('[aria-label="最近活動"][aria-live]').count(), 0, 'activity list is not a live region')
  await external.screenshot({ path: resolve(evidenceRoot, 'external-activity.png') })
  await external.close()

  for (const [name, action] of [
    ['approval', '查看核准要求並做出決定。'],
    ['authentication', '完成登入後再繼續。'],
    ['input', '回覆 Agent 所需資訊。'],
  ] as const) {
    const page = await openScenario(name)
    assert.equal(await page.getByRole('heading', { name: '需要你處理' }).count(), 1)
    assert.equal(await page.getByText(action, { exact: true }).count(), 1)
    for (const value of forbidden) assert.doesNotMatch(await page.locator('body').innerText(), new RegExp(value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))
    await page.close()
  }

  const terminal = await openScenario('terminal-external')
  assert.equal(await terminal.getByRole('heading', { name: '執行摘要' }).count(), 1)
  assert.match(await terminal.locator('body').innerText(), /外部程序已結束；這不代表 Checker 已確認任務完成。/)
  assert.doesNotMatch(await terminal.locator('body').innerText(), /Host 已驗證|DoD met/)
  await terminal.screenshot({ path: resolve(evidenceRoot, 'terminal-external.png') })
  await terminal.close()

  for (const [name, expected] of [['failed', '執行未完成'], ['cancelled', '執行已停止']] as const) {
    const page = await openScenario(name)
    assert.equal(await page.getByRole('heading', { name: '執行摘要' }).count(), 1)
    assert.match(await page.locator('body').innerText(), new RegExp(expected))
    await page.close()
  }

  const simple = await openScenario('simple')
  for (const title of ['任務進度', '最近活動', '需要你處理', '執行摘要']) {
    assert.equal(await simple.getByRole('heading', { name: title }).count(), 0, `simple run hides ${title}`)
  }
  await simple.close()
  console.log('rendered adaptive run status passed: builtin/external, attention, terminal, simple-hide, hostile-input, reload and accessibility')
} finally {
  await browser.close()
  await server.close()
}

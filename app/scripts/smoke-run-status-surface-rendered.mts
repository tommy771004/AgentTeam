import assert from 'node:assert/strict'
import { mkdir, readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { projectRunStatusSurface } from '../src/agent/runStatusSurface.ts'
import { deriveRunLifecycle } from '../src/agent/runLifecycle.ts'
import { BUILTIN_RUNNER_CAPABILITIES } from '../src/agent/runners/types.ts'
import { createSubmittingFollowUpProjection } from '../src/agent/interactiveFollowUp.ts'

assert.deepEqual(
  createSubmittingFollowUpProjection({
    id: 'client-message-1',
    threadId: 'thread-1',
    text: '補上剛發現的限制條件',
    action: 'steer',
    attachmentCount: 1,
  }),
  {
    id: 'client-message-1',
    runId: 'client-message-1',
    sessionId: 'renderer-submitting',
    threadId: 'thread-1',
    text: '補上剛發現的限制條件',
    action: 'steer',
    state: 'submitting',
    revision: 0,
    queueRevision: 0,
    editable: false,
    cancellable: false,
    reorderable: false,
    attachmentCount: 1,
  },
  'Composer projects the message immediately while Host acknowledgement is pending',
)

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
const proseOnlyAuth = projectRunStatusSurface({
  ...replayInput,
  activity: { ...replayInput.activity, events: [{ id: 'prose', at: 1, kind: 'status' as const, title: 'OAuth login required' }] },
})
assert.notEqual(proseOnlyAuth.secondary?.kind, 'attention', 'provider prose cannot forge an authentication attention fact')

const rawObjective = '## 近期對話歷史（Reference chat history） User: 讀取整份 request 與 transport error'
const noRepeatedTaskPlan = projectRunStatusSurface({
  ...replayInput,
  workingState: {
    ...replayWorkingState,
    goals: [{ id: 'raw-objective', description: rawObjective, status: 'pending' as const, evidence: [], hiddenEvidenceCount: 0 }],
  },
})
assert.equal(noRepeatedTaskPlan.secondary, undefined, 'execution summary does not repeat the task plan or Working State goals')
assert.doesNotMatch(String(noRepeatedTaskPlan.secondary), /Reference chat history/, 'raw request/context never becomes a task milestone')

const appRoot = new URL('..', import.meta.url).pathname
const coordinatorSource = await readFile(resolve(appRoot, 'src/agent/taskRunCoordinator.ts'), 'utf8')
assert.match(
  coordinatorSource,
  /thr\.clearRunPlan\(tid\)[\s\S]{0,240}bindRun\(opts\.runId, tid\)/,
  'a new run clears the previous plan before binding the new run identity',
)
// Disposable smoke captures must not overwrite committed qualification evidence.
const evidenceRoot = resolve(appRoot, 'test-results/run-status-surface')
await mkdir(evidenceRoot, { recursive: true })
const followUpEvidenceRoot = resolve(appRoot, 'test-results/follow-up-composer')
await mkdir(followUpEvidenceRoot, { recursive: true })
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
  const composer = await browser.newPage({ viewport: { width: 360, height: 780 } })
  const composerErrors: string[] = []
  composer.on('pageerror', (error) => composerErrors.push(error.message))
  await composer.goto(`http://127.0.0.1:${port}/`, { waitUntil: 'domcontentloaded' })
  await composer.evaluate(async () => {
    const [{ default: React }, { default: ReactDOM }, { CommandComposer }] = await Promise.all([
      import('/node_modules/.vite/deps/react.js'),
      import('/node_modules/.vite/deps/react-dom_client.js'),
      import('/src/components/CommandComposer.tsx'),
    ])
    const rootNode = document.getElementById('root')!
    rootNode.replaceChildren()
    rootNode.className = 'p-3'
    const h = React.createElement
    const actions: string[] = []
    ;(window as any).followUpActions = actions
    ;(window as any).releaseComposerSubmit = undefined
    const base = { sessionId: 'session-1', threadId: 'thread-1', revision: 7, queueRevision: 7 }
    ReactDOM.createRoot(rootNode).render(h(CommandComposer, {
      scopeKey: 'follow-up-fixture',
      value: '新增一筆後續指令',
      onChange: () => undefined,
      onSubmitLine: async () => {
        actions.push('send')
        await new Promise<void>((resolve) => { (window as any).releaseComposerSubmit = resolve })
      },
      onSlashCommand: () => undefined,
      mode: 'agent',
      running: true,
      followUpAction: 'steer',
      followUpImmediateAction: 'steer',
      onFollowUpActionChange: (action: string) => actions.push(`mode:${action}`),
      onStop: () => actions.push('stop'),
      pendingFollowUps: [
        { ...base, id: 'submitting-1', runId: 'submitting-run', text: '補上剛發現的限制條件', action: 'steer', state: 'submitting', editable: false, cancellable: false, reorderable: false },
        { ...base, id: 'steer-1', runId: 'steer-run', text: '先修正目前分析方向，不要重啟任務', action: 'steer', state: 'accepted', editable: false, cancellable: false, reorderable: false },
        { ...base, id: 'queue-1', runId: 'queue-run-1', text: '完成後整理測試證據與變更摘要', action: 'queue', state: 'queued', editable: true, cancellable: true, reorderable: true, attachmentCount: 2 },
        { ...base, id: 'queue-2', runId: 'queue-run-2', text: '接著檢查窄版畫面不應產生水平捲動', action: 'queue', state: 'queued', editable: true, cancellable: true, reorderable: true },
        { ...base, id: 'paused-1', runId: 'paused-run', text: '中斷後等我開始', action: 'queue', state: 'paused', editable: true, cancellable: true, reorderable: true, startable: true },
        { ...base, id: 'rejected-1', runId: 'rejected-run', text: '保留這筆未接受的原始指令', action: 'steer', state: 'rejected', editable: true, cancellable: true, reorderable: false, reason: 'active turn changed' },
      ],
      onEditPendingFollowUp: (_item: unknown, text: string) => actions.push(`edit:${text}`),
      onCancelPendingFollowUp: (item: { id: string }) => actions.push(`cancel:${item.id}`),
      onStartPendingFollowUp: (item: { id: string }) => actions.push(`start:${item.id}`),
      onMovePendingFollowUp: (item: { id: string }, direction: string) => actions.push(`move:${item.id}:${direction}`),
      onQueueRejectedFollowUp: (item: { id: string }) => actions.push(`queue:${item.id}`),
    }))
  })
  await composer.getByLabel('待處理的後續指令').waitFor()
  assert.match(await composer.getByLabel('待處理的後續指令').innerText(), /補上剛發現的限制條件.*引導 · 送出中.*先修正目前分析方向.*引導 · 已接受.*完成後整理測試證據.*排隊 · 第 1 位 · 排隊中 · 附件 2.*接著檢查窄版.*排隊 · 第 2 位 · 排隊中.*中斷後等我開始.*排隊 · 第 3 位 · 已暫停.*保留這筆未接受.*未接受/s)
  await composer.getByRole('button', { name: '開始：中斷後等我開始' }).click()
  assert.equal(await composer.evaluate(() => (window as any).followUpActions.includes('start:paused-1')), true)
  assert.equal(await composer.getByRole('button', { name: '引導目前任務', exact: true }).count(), 1)
  assert.equal(await composer.getByRole('button', { name: '停止執行' }).count(), 1)
  const submitButton = composer.getByRole('button', { name: '引導目前任務', exact: true })
  await submitButton.click()
  await submitButton.click()
  assert.equal(
    await composer.evaluate(() => (window as any).followUpActions.filter((action: string) => action === 'send').length),
    1,
    'one physical Composer submission stays single-flight until its callback settles',
  )
  await composer.evaluate(() => (window as any).releaseComposerSubmit?.())
  assert.equal(await composer.locator('[aria-live="polite"]').filter({ hasText: '待處理後續指令 6 筆' }).count(), 1, 'queue changes announce one bounded summary')
  await composer.getByRole('button', { name: '送出模式：引導目前任務' }).click()
  await composer.getByRole('menuitemradio', { name: /排到下一個任務/ }).click()
  const expandable = composer.getByRole('button', { name: '先修正目前分析方向，不要重啟任務' })
  await expandable.focus()
  await composer.keyboard.press('Enter')
  assert.equal(await expandable.getAttribute('aria-expanded'), 'true', 'instruction preview expands from keyboard')
  assert.equal(await composer.getByRole('button', { name: /上移：完成後整理/ }).isDisabled(), true, 'first mutable queue item cannot move above accepted steer')
  await composer.getByRole('button', { name: /上移：接著檢查窄版/ }).focus()
  await composer.keyboard.press('Enter')
  await composer.getByRole('button', { name: /改為排隊：保留這筆/ }).click()
  assert.deepEqual(await composer.evaluate(() => (window as any).followUpActions), ['start:paused-1', 'send', 'mode:queue', 'move:queue-2:up', 'queue:rejected-1'])
  assert.equal(await composer.locator('.agent-composer').evaluate((element) => element.scrollWidth <= element.clientWidth), true, 'narrow Composer has no horizontal overflow')
  await composer.screenshot({ path: resolve(followUpEvidenceRoot, 'composer-narrow.png'), animations: 'disabled' })
  await composer.setViewportSize({ width: 1120, height: 720 })
  assert.equal(await composer.locator('.agent-composer').evaluate((element) => element.scrollWidth <= element.clientWidth), true, 'desktop Composer has no horizontal overflow')
  await composer.screenshot({ path: resolve(followUpEvidenceRoot, 'composer-desktop.png'), animations: 'disabled' })
  assert.deepEqual(composerErrors, [], 'follow-up Composer renders without browser exceptions')
  await composer.close()

  const steps = await browser.newPage({ viewport: { width: 1120, height: 720 } })
  await steps.goto(`http://127.0.0.1:${port}/`, { waitUntil: 'domcontentloaded' })
  await steps.evaluate(async () => {
    const [{ default: React }, { default: ReactDOM }, { ExecutionStepsProgress }] = await Promise.all([
      import('/node_modules/.vite/deps/react.js'),
      import('/node_modules/.vite/deps/react-dom_client.js'),
      import('/src/components/ExecutionStepsProgress.tsx'),
    ])
    const rootNode = document.getElementById('root')!
    rootNode.replaceChildren()
    rootNode.className = 'p-8 pt-72'
    const h = React.createElement
    ReactDOM.createRoot(rootNode).render(h('div', { id: 'steps-row', className: 'flex', style: { width: '800px' } }, h(ExecutionStepsProgress, {
      tasks: [
        { id: 'one', text: '讀取現況', status: 'done' },
        { id: 'two', text: '更新介面', status: 'active' },
        { id: 'three', text: '驗證結果', status: 'pending' },
      ],
      fileChanges: [
        { added: 6, removed: 1 },
        { added: 2, removed: 2 },
      ],
    })))
  })
  const stepButton = steps.getByRole('button', { name: /步驟 2 \/ 3/ })
  await stepButton.waitFor()
  assert.match(await stepButton.innerText(), /步驟 2 \/ 3.*\+8.*-3/s, 'step and current-run diff totals share one horizontal summary')
  const [rowBox, buttonBox] = await Promise.all([steps.locator('#steps-row').boundingBox(), stepButton.boundingBox()])
  assert.ok(rowBox && buttonBox && Math.abs((rowBox.x + rowBox.width) - (buttonBox.x + buttonBox.width)) <= 1,
    `the compact execution summary is right-aligned above the composer: ${JSON.stringify({ rowBox, buttonBox })}`)
  await stepButton.click()
  const dialogBox = await steps.getByRole('dialog', { name: '執行步驟' }).boundingBox()
  assert.ok(dialogBox && buttonBox && dialogBox.y + dialogBox.height <= buttonBox.y,
    'the floating step card opens above its compact summary')
  await steps.screenshot({ path: resolve(followUpEvidenceRoot, 'execution-steps-above.png'), animations: 'disabled' })
  await steps.close()

  const streaming = await browser.newPage({ viewport: { width: 720, height: 480 } })
  await streaming.goto(`http://127.0.0.1:${port}/`, { waitUntil: 'domcontentloaded' })
  await streaming.evaluate(async () => {
    const [{ default: React }, { default: ReactDOM }, { RunTimelineList }] = await Promise.all([
      import('/node_modules/.vite/deps/react.js'),
      import('/node_modules/.vite/deps/react-dom_client.js'),
      import('/src/components/RunTimelineList.tsx'),
    ])
    const rootNode = document.getElementById('root')!
    rootNode.replaceChildren()
    rootNode.className = 'p-8'
    const root = ReactDOM.createRoot(rootNode)
    ;(window as any).renderStreamingAnswer = (content: string) => root.render(React.createElement(RunTimelineList, {
      rows: [{ id: 'draft-answer', kind: 'assistant', content, draft: true }],
    }))
    ;(window as any).renderStreamingAnswer('正在產生回覆。')
  })
  const streamingParagraph = streaming.locator('[data-timeline-row="assistant-draft"] .markdown-body > p')
  await streamingParagraph.waitFor()
  await streaming.waitForTimeout(500)
  await streaming.evaluate(() => (window as any).renderStreamingAnswer('正在產生回覆，這是下一段串流文字。'))
  await streaming.waitForTimeout(20)
  const streamingFilter = await streamingParagraph.evaluate((element) => getComputedStyle(element).filter)
  assert.ok(streamingFilter === 'none' || streamingFilter === 'blur(0px)',
    `an in-progress assistant response stays sharp when a new chunk renders; got ${streamingFilter}`)
  assert.equal(await streaming.locator('.agent-streaming-body').evaluate((element) => getComputedStyle(element).animationName), 'none',
    'the streaming response container never obscures live text with an entrance animation')
  await streaming.screenshot({ path: resolve(followUpEvidenceRoot, 'streaming-answer-sharp.png'), animations: 'disabled' })
  await streaming.close()

  const builtin = await openScenario('builtin')
  assert.equal(await builtin.getByRole('status').count(), 1, 'primary lifecycle is the only polite status region')
  assert.equal(await builtin.getByRole('heading', { name: '任務進度' }).count(), 0, 'execution summary no longer repeats the task plan')
  assert.equal(await builtin.getByRole('button', { name: /子程序／子代理/ }).count(), 0, 'no child execution means no child-agent section')
  assert.equal(await builtin.getByRole('progressbar').count(), 0, 'open-ended goal work has no percentage progressbar')
  const builtinText = await builtin.locator('body').innerText()
  for (const value of forbidden) assert.doesNotMatch(builtinText, new RegExp(value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))
  await builtin.reload({ waitUntil: 'domcontentloaded' })
  await builtin.getByRole('heading', { name: '執行狀態' }).waitFor({ timeout: 120_000 })
  assert.equal(await builtin.getByRole('heading', { name: '任務進度' }).count(), 0, 'reload does not restore the removed task-plan surface')
  await builtin.screenshot({ path: resolve(evidenceRoot, 'builtin-progress.png') })
  const details = builtin.getByRole('button', { name: /執行資訊/ }).last()
  await details.focus()
  await builtin.keyboard.press('Enter')
  assert.equal(await details.getAttribute('aria-expanded'), 'true', 'diagnostic disclosure is keyboard operable')
  assert.match(await builtin.locator('body').innerText(), /Host 已驗證 · rev 7/)
  await builtin.close()

  const subagent = await openScenario('subagent')
  const childDisclosure = subagent.getByRole('button', { name: /子程序／子代理.*1 個執行/ })
  assert.equal(await childDisclosure.getAttribute('aria-expanded'), 'false', 'child execution starts as a compact clickable summary')
  await childDisclosure.click()
  assert.equal(await childDisclosure.getAttribute('aria-expanded'), 'true')
  assert.match(await subagent.locator('[data-agent-work-id="fixture-child"]').innerText(), /檢查回覆呈現狀況.*子代理 · reviewer · 執行中/s)
  await subagent.screenshot({ path: resolve(evidenceRoot, 'subagent-execution.png'), animations: 'disabled' })
  await subagent.close()

  const persisted = await openScenario('persisted-plan')
  assert.equal(await persisted.locator('[data-task-status]').count(), 0, 'persisted plans are not repeated in execution summary')
  await persisted.reload({ waitUntil: 'domcontentloaded' })
  await persisted.getByRole('heading', { name: '執行狀態' }).waitFor({ timeout: 120_000 })
  assert.equal(await persisted.locator('[data-task-status]').count(), 0, 'reload keeps persisted plans out of execution summary')
  await persisted.close()

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

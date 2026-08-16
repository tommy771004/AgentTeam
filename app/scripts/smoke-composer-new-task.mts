/**
 * Pure-logic smoke for the composer new-task flow (spec 2/6).
 *
 * Covers what the UI cannot: the payload a tile click assembles, the schedule /
 * event readiness rules, and the retired bare-shell route table. Run:
 *   node --experimental-strip-types scripts/smoke-composer-new-task.mts
 */
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  buildEventDraft,
  buildScheduleDraft,
  describeEventDraft,
  describeScheduleDraft,
  eventDraftReady,
  jobRunnerFor,
  scheduleDraftReady,
} from '../src/agent/composerAutomationDraft.ts'
import { LOOP_CHOICES, allowedDepthsFor } from '../src/agent/composerLayering.ts'
import { previewDod, resolveUserDefinitionOfDone } from '../src/agent/dodPreview.ts'
import {
  buildRetryOverrides,
  buildRetryRunFields,
  clampRetryParams,
  retryEligibility,
} from '../src/agent/retryOverrides.ts'
import { THINKING_DEPTHS } from '../src/agent/thinking.ts'

const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

let passed = 0
function test(name: string, fn: () => void) {
  try {
    fn()
    console.log(`  ✓ ${name}`)
    passed++
  } catch (error) {
    console.error(`  ✗ ${name}`)
    console.error(error)
    process.exit(1)
  }
}

console.log('\ncomposer new-task flow')

test('排程草稿：從「每天 08:00」讀出每日與時間', () => {
  const draft = buildScheduleDraft('每天 08:00 整理收件匣')
  assert.equal(draft.kind, 'daily')
  assert.equal(draft.dailyAt, '08:00')
  assert.equal(draft.objective, '每天 08:00 整理收件匣')
  assert.ok(draft.name.length > 0, '名稱應從目標推出')
  assert.equal(scheduleDraftReady(draft), true)
})

test('排程草稿：從「每 15 分鐘」讀出間隔', () => {
  const draft = buildScheduleDraft('每 15 分鐘檢查建置狀態')
  assert.equal(draft.kind, 'interval')
  assert.equal(draft.intervalMinutes, 15)
  assert.equal(describeScheduleDraft(draft), '每 15 分鐘執行')
})

test('排程草稿：沒有時間語意時退到每日 08:00，不是空值', () => {
  const draft = buildScheduleDraft('整理收件匣')
  assert.equal(draft.kind, 'daily')
  assert.equal(draft.dailyAt, '08:00')
  assert.equal(scheduleDraftReady(draft), true)
})

test('空輸入不足以建立——目標為空一律 not ready', () => {
  const schedule = buildScheduleDraft('   ')
  assert.equal(schedule.objective, '')
  assert.equal(schedule.name, '')
  assert.equal(scheduleDraftReady(schedule), false)

  const event = buildEventDraft('')
  assert.equal(eventDraftReady(event), false)
})

test('排程草稿：頻率不合法就不能建立', () => {
  const daily = { ...buildScheduleDraft('整理收件匣'), dailyAt: '8am' }
  assert.equal(scheduleDraftReady(daily), false)
  const interval = { ...buildScheduleDraft('每 15 分鐘檢查'), intervalMinutes: 0 }
  assert.equal(scheduleDraftReady(interval), false)
})

test('事件草稿：預填目標並給真實存在的來源', () => {
  const draft = buildEventDraft('收到 webhook 時把內容存檔')
  assert.equal(draft.objective, '收到 webhook 時把內容存檔')
  assert.equal(draft.source, 'webhook.http')
  assert.equal(eventDraftReady(draft), true)
  assert.match(describeEventDraft(draft), /來源 webhook\.http/)
})

test('事件草稿：述句帶上每個已填的斷言', () => {
  const draft = {
    ...buildEventDraft('歸檔發票'),
    subjectContains: 'Invoice',
    keyword: '請款',
    hasAttachment: true,
  }
  const described = describeEventDraft(draft)
  assert.match(described, /主旨含「Invoice」/)
  assert.match(described, /內容含「請款」/)
  assert.match(described, /需有附件/)
})

test('排程引擎白名單：排程存不下的引擎退回 builtin', () => {
  assert.equal(jobRunnerFor('codex'), 'codex')
  assert.equal(jobRunnerFor('builtin'), 'builtin')
  // gemini 不在 JobRunner union 裡 — 必須退回而不是寫入非法值
  assert.equal(jobRunnerFor('gemini'), 'builtin')
  assert.equal(jobRunnerFor('unknown-cli'), 'builtin')
})

test('定時／事件是建立動作，不是可釘選的 loop', () => {
  const automation = LOOP_CHOICES.filter((choice) => choice.createsAutomation)
  assert.deepEqual(
    automation.map((choice) => choice.type),
    ['Time-based', 'Proactive'],
  )
  assert.deepEqual(
    automation.map((choice) => choice.createsAutomation),
    ['schedule', 'event'],
  )
  const pinnable = LOOP_CHOICES.filter((choice) => !choice.createsAutomation)
  assert.deepEqual(
    pinnable.map((choice) => choice.type),
    [null, 'Goal-based', 'Turn-based'],
    'composer 只能釘選 auto / Goal / Turn',
  )
})

test('推理程度：查不到模型能力時給全部，不把使用者鎖住', () => {
  assert.equal(allowedDepthsFor(undefined, '', 'gpt-x').length, THINKING_DEPTHS.length)
  assert.equal(allowedDepthsFor([], 'gpt-x', 'gpt-x').length, THINKING_DEPTHS.length)
})

test('DoD 預覽：Goal-based 才有卡，Turn-based 不打斷輕量對話', () => {
  const goal = '幫我比較三家供應商的報價並整理成表格，缺的資料標 N/A'
  const preview = previewDod(goal, null)
  assert.ok(preview, 'Goal-based 應有預覽')
  assert.equal(preview.loopType, 'Goal-based')
  assert.ok(preview.definitionOfDone.length > 0)
  assert.match(preview.reason, /Auto 判定為 Goal-based/)

  assert.equal(previewDod('嗨', null), null)
  assert.equal(previewDod('謝謝', 'Turn-based'), null)
  assert.equal(previewDod('', null), null)
  // 排程／事件由規則觸發，composer 不會送出這兩種 run
  assert.equal(previewDod(goal, 'Time-based'), null)
  assert.equal(previewDod(goal, 'Proactive'), null)
})

test('DoD ingress：只有真的改過才隨 snapshot 送出（缺省完全回退）', () => {
  const goal = '幫我比較三家供應商的報價並整理成表格，缺的資料標 N/A'
  const preview = previewDod(goal, null)
  assert.ok(preview)
  assert.equal(resolveUserDefinitionOfDone(undefined, preview), undefined)
  assert.equal(resolveUserDefinitionOfDone('', preview), undefined)
  assert.equal(resolveUserDefinitionOfDone('   ', preview), undefined)
  assert.equal(resolveUserDefinitionOfDone(preview.definitionOfDone, preview), undefined)
  assert.equal(
    resolveUserDefinitionOfDone(`  ${preview.definitionOfDone}  `, preview),
    undefined,
    '只是空白差異不算編輯',
  )
  assert.equal(resolveUserDefinitionOfDone('  三家報價都有含稅價  ', preview), '三家報價都有含稅價')
  assert.equal(
    resolveUserDefinitionOfDone('三家報價都有含稅價', null),
    undefined,
    '非 Goal-based 不夾帶 DoD',
  )
})

test('DoD 只覆寫文本：engine 在分類與 LLM 精煉之後才套用，且非 Goal 不套用', () => {
  const engine = fs.readFileSync(path.join(appRoot, 'src/agent/engine.ts'), 'utf8')
  assert.match(engine, /userDefinitionOfDone/)
  assert.match(
    engine,
    /loopConfig\.loopType === 'Goal-based'\s*\)\s*\{\s*\n\s*this\.state\.loopConfig\.definitionOfDone = userDod/,
    '使用者 DoD 必須只在 Goal-based 時覆寫 DoD 文本',
  )
  const applyAt = engine.indexOf('const userDod =')
  const llmRefineAt = engine.indexOf('LLM 解析：')
  assert.ok(applyAt > llmRefineAt && llmRefineAt > 0, '必須排在 LLM 精煉之後套用')
})

const RETRY_DEFAULTS = { maxIterations: 5, minConfidence: 0.8, timeoutMs: 30_000 }

test('retry 覆寫白名單：只有三個參數（加必需的觸發證據）進到新 run', () => {
  const overrides = buildRetryOverrides(
    { maxIterations: 8, minConfidence: 0.9, timeoutMs: 45_000 },
    {},
  )
  assert.deepEqual(Object.keys(overrides).sort(), [
    'maxIterations',
    'minConfidence',
    'timeoutMs',
  ])
  assert.equal(overrides.maxIterations, 8)
  assert.equal(overrides.minConfidence, 0.9)
  assert.equal(overrides.timeoutMs, 45_000)
})

test('retry 覆寫：有觸發證據才夾帶，且不夾帶其他任何欄位', () => {
  const eventTrigger = { eventId: 'e1', matchedAt: '2026-08-16T00:00:00.000Z' } as never
  const overrides = buildRetryOverrides(RETRY_DEFAULTS, { eventTrigger })
  assert.deepEqual(Object.keys(overrides).sort(), [
    'eventTrigger',
    'maxIterations',
    'minConfidence',
    'timeoutMs',
  ])
})

test('retry 參數夾緊：超界收斂、NaN 回退預設', () => {
  const high = clampRetryParams(
    { maxIterations: 999, minConfidence: 5, timeoutMs: 10_000_000 },
    RETRY_DEFAULTS,
  )
  assert.equal(high.maxIterations, 20)
  assert.equal(high.minConfidence, 1)
  assert.equal(high.timeoutMs, 600_000)

  const low = clampRetryParams({ maxIterations: 0, minConfidence: 0, timeoutMs: 1 }, RETRY_DEFAULTS)
  assert.equal(low.maxIterations, 1)
  assert.equal(low.minConfidence, 0.1)
  assert.equal(low.timeoutMs, 5_000)

  const bad = clampRetryParams(
    { maxIterations: Number.NaN, minConfidence: Number.NaN, timeoutMs: Number.NaN },
    RETRY_DEFAULTS,
  )
  assert.deepEqual(bad, RETRY_DEFAULTS)
})

test('retry 資格：缺觸發證據的 Time/Proactive 擋下來，不偷改 loop 類型', () => {
  assert.equal(retryEligibility('Goal-based', {}).canRetry, true)
  assert.equal(retryEligibility('Turn-based', {}).canRetry, true)
  assert.equal(retryEligibility(undefined, {}).canRetry, true)

  const noSchedule = retryEligibility('Time-based', {})
  assert.equal(noSchedule.canRetry, false)
  assert.match(noSchedule.canRetry === false ? noSchedule.reason : '', /自動化/)

  const noEvent = retryEligibility('Proactive', {})
  assert.equal(noEvent.canRetry, false)

  const withEvidence = retryEligibility('Proactive', {
    eventTrigger: { eventId: 'e1' } as never,
  })
  assert.equal(withEvidence.canRetry, true)
})

test('retry 進 run：來源記為 retry，Proactive 只在有證據時宣告 pre-matched', () => {
  const plain = buildRetryRunFields('Goal-based', {})
  assert.equal(plain.sourceKind, 'retry')
  assert.equal(plain.loopType, 'Goal-based')
  assert.equal(plain.eventPreMatched, false)

  const proactive = buildRetryRunFields('Proactive', { eventTrigger: { eventId: 'e1' } as never })
  assert.equal(proactive.eventPreMatched, true)
  assert.equal(buildRetryRunFields('Proactive', {}).eventPreMatched, false)
})

test('裸殼路由已退役：/execution、/success、/failed 一律 redirect 回首頁', () => {
  const app = fs.readFileSync(path.join(appRoot, 'src/App.tsx'), 'utf8')
  for (const route of ['execution', 'success', 'failed']) {
    const declaration = new RegExp(
      `<Route\\s+path="${route}"\\s+element=\\{<Navigate\\s+to="/"\\s+replace\\s*/>\\}\\s*/>`,
    )
    assert.match(app, declaration, `/${route} 必須 redirect 回首頁`)
  }
  for (const page of ['ExecutionPage', 'SuccessPage', 'FailedPage']) {
    assert.equal(
      fs.existsSync(path.join(appRoot, `src/pages/${page}.tsx`)),
      false,
      `${page}.tsx 必須刪除`,
    )
  }
})

test('死檔已清除：未被路由引用的頁面與 Vite 樣板樣式不再存在', () => {
  for (const dead of [
    'src/pages/ArchivePage.tsx',
    'src/pages/EventsPage.tsx',
    'src/pages/LogsPage.tsx',
    'src/pages/SchedulerPage.tsx',
    'src/App.css',
  ]) {
    assert.equal(fs.existsSync(path.join(appRoot, dead)), false, `${dead} 必須刪除`)
  }
})

test('rewind 不再使用原生 confirm', () => {
  const bubble = fs.readFileSync(path.join(appRoot, 'src/components/ChatBubble.tsx'), 'utf8')
  assert.doesNotMatch(bubble, /window\.confirm\(/)
  assert.match(bubble, /ConfirmSheet/)
})

console.log(`\n${passed} composer new-task smoke tests passed`)
console.log('OK')

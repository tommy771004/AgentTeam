/**
 * Pure-logic smoke for automation one-click (spec 5/6).
 *
 * The security model is what this file mainly guards: conversation text may only
 * ever produce a *proposal*. Nothing here creates a job, and the suppression /
 * cooldown rules must never quietly become "create it for them".
 *
 * Run: node --experimental-strip-types scripts/smoke-automation-one-click.mts
 */
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  SUGGESTION_COOLDOWN_DAYS,
  cooldownRemainingMs,
  decideSuggestionPresentation,
  describeQueueLoad,
  eventDraftFromSuggestion,
  findActiveScheduleFor,
  sameObjective,
  scheduleDraftFromSuggestion,
  SCHEDULE_TRIGGER_CAVEAT,
} from '../src/agent/automationConsent.ts'
import {
  buildRecurringSuggestion,
  detectAutomationSuggestion,
} from '../src/agent/automationSuggestion.ts'
import {
  eventCreateRequest,
  scheduleCreateRequest,
} from '../src/agent/composerAutomationDraft.ts'
import type { ProactiveEvent, ScheduledJob } from '../src/agent/types.ts'

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

console.log('\nautomation one-click')

const DAY = 24 * 60 * 60 * 1000
const NOW = Date.parse('2026-08-16T12:00:00.000Z')

function job(overrides: Partial<ScheduledJob> = {}): ScheduledJob {
  return {
    id: 'job-1',
    name: '整理收件匣',
    objective: '每天早上八點整理 inbox',
    loopType: 'Time-based',
    enabled: true,
    kind: 'daily',
    dailyAt: '08:00',
    lastRunAt: null,
    nextRunAt: null,
    ...overrides,
  } as ScheduledJob
}

function event(overrides: Partial<ProactiveEvent> = {}): ProactiveEvent {
  return {
    id: 'ev-1',
    name: 'CI 失敗',
    source: 'webhook.http',
    objective: '當 webhook 收到 CI 失敗就通知我',
    enabled: true,
    lastTriggeredAt: null,
    triggerCount: 0,
    ...overrides,
  } as ProactiveEvent
}

// ── 意圖 → 建議 ────────────────────────────────────────────────────

test('排程意圖產生排程建議，並讀出時間', () => {
  const suggestion = detectAutomationSuggestion('每天早上 08:00 整理 inbox')
  assert.ok(suggestion, '應偵測到排程意圖')
  assert.equal(suggestion.kind, 'schedule')
  const draft = scheduleDraftFromSuggestion(suggestion)
  assert.equal(draft.kind, 'daily')
  assert.equal(draft.dailyAt, '08:00')
  assert.ok(draft.objective.length > 0)
})

test('事件意圖產生事件建議', () => {
  const suggestion = detectAutomationSuggestion('當 webhook 收到 CI 失敗就通知我')
  assert.ok(suggestion)
  assert.equal(suggestion.kind, 'event')
  const draft = eventDraftFromSuggestion(suggestion)
  assert.equal(draft.source, 'webhook.http')
  assert.ok(draft.objective.length > 0)
})

test('偵測涵蓋解析得出來的間隔講法（模組內部不得自相矛盾）', () => {
  // INTERVAL_RE 讀得懂「每 15 分鐘」，訊號偵測就不能認不得它，
  // 否則使用者說了一句我們明明解析得出來的排程卻收不到建議。
  for (const text of ['每 15 分鐘檢查建置狀態', '每15分鐘檢查', '每隔 30 分鐘同步']) {
    const suggestion = detectAutomationSuggestion(text)
    assert.ok(suggestion, `應偵測到排程意圖：${text}`)
    assert.equal(suggestion.kind, 'schedule')
    assert.equal(scheduleDraftFromSuggestion(suggestion).kind, 'interval')
  }
})

test('一般對話不產生任何建議（ambiguous 不硬猜）', () => {
  assert.equal(detectAutomationSuggestion('幫我看一下這段程式'), null)
  assert.equal(detectAutomationSuggestion('嗨'), null)
  assert.equal(detectAutomationSuggestion(''), null)
})

test('建議只是提案：payload 裡沒有任何「執行」的意思', () => {
  const suggestion = detectAutomationSuggestion('每天 09:00 跑報表')
  assert.ok(suggestion)
  assert.equal(suggestion.source, 'conversation')
  // AutomationSuggestion 不得攜帶觸發證據——那是執行路徑才有的東西
  assert.equal('scheduleTrigger' in suggestion, false)
  assert.equal('eventTrigger' in suggestion, false)
})

// ── 抑制與冷卻 ─────────────────────────────────────────────────────

test('目標比對忽略空白與大小寫', () => {
  assert.equal(sameObjective('  整理 Inbox ', '整理 inbox'), true)
  assert.equal(sameObjective('整理 inbox', '整理收件匣'), false)
})

test('已有啟用中的同目標排程 → 降級為輕提示，不推卡', () => {
  const suggestion = detectAutomationSuggestion('每天早上八點整理 inbox')
  assert.ok(suggestion)
  const result = decideSuggestionPresentation({
    suggestion,
    jobs: [job({ objective: suggestion.objective })],
    events: [],
    decisions: {},
    now: NOW,
  })
  assert.equal(result.mode, 'notice')
  assert.match(result.mode === 'notice' ? result.message : '', /不重複建立/)
})

test('停用中的同目標排程不算數，仍然推卡', () => {
  const suggestion = detectAutomationSuggestion('每天早上八點整理 inbox')
  assert.ok(suggestion)
  const result = decideSuggestionPresentation({
    suggestion,
    jobs: [job({ objective: suggestion.objective, enabled: false })],
    events: [],
    decisions: {},
    now: NOW,
  })
  assert.equal(result.mode, 'card')
})

test('事件建議同樣會被啟用中的同目標事件規則抑制', () => {
  const suggestion = detectAutomationSuggestion('當 webhook 收到 CI 失敗就通知我')
  assert.ok(suggestion)
  const result = decideSuggestionPresentation({
    suggestion,
    jobs: [],
    events: [event({ objective: suggestion.objective })],
    decisions: {},
    now: NOW,
  })
  assert.equal(result.mode, 'notice')
})

test('拒絕是有記憶的：冷卻期內完全不再建議', () => {
  const suggestion = detectAutomationSuggestion('每天 09:00 跑報表')
  assert.ok(suggestion)
  const decisions = {
    [suggestion.dedupKey]: {
      action: 'dismissed' as const,
      at: new Date(NOW - 2 * DAY).toISOString(),
    },
  }
  const result = decideSuggestionPresentation({
    suggestion,
    jobs: [],
    events: [],
    decisions,
    now: NOW,
  })
  assert.equal(result.mode, 'silent')
})

test('冷卻到期後可以再建議一次', () => {
  const suggestion = detectAutomationSuggestion('每天 09:00 跑報表')
  assert.ok(suggestion)
  const decisions = {
    [suggestion.dedupKey]: {
      action: 'dismissed' as const,
      at: new Date(NOW - (SUGGESTION_COOLDOWN_DAYS + 1) * DAY).toISOString(),
    },
  }
  const result = decideSuggestionPresentation({
    suggestion,
    jobs: [],
    events: [],
    decisions,
    now: NOW,
  })
  assert.equal(result.mode, 'card')
})

test('接受過的決定不會造成冷卻（只有拒絕才靜音）', () => {
  const accepted = { action: 'accepted' as const, at: new Date(NOW - DAY).toISOString() }
  assert.equal(cooldownRemainingMs(accepted, NOW), 0)
  assert.equal(cooldownRemainingMs(undefined, NOW), 0)
  assert.equal(cooldownRemainingMs({ action: 'dismissed', at: 'not-a-date' }, NOW), 0)
})

test('拒絕優先於「已存在」：拒絕過就連提示都不給', () => {
  const suggestion = detectAutomationSuggestion('每天早上八點整理 inbox')
  assert.ok(suggestion)
  const result = decideSuggestionPresentation({
    suggestion,
    jobs: [job({ objective: suggestion.objective })],
    events: [],
    decisions: {
      [suggestion.dedupKey]: { action: 'dismissed', at: new Date(NOW - DAY).toISOString() },
    },
    now: NOW,
  })
  assert.equal(result.mode, 'silent')
})

// ── 建立請求 ───────────────────────────────────────────────────────

test('建立請求與自動化頁同一條路徑：欄位逐項對得上', () => {
  const suggestion = detectAutomationSuggestion('每天早上 08:00 整理 inbox')
  assert.ok(suggestion)
  const draft = { ...scheduleDraftFromSuggestion(suggestion), skillNames: ['inbox-triage'] }
  const request = scheduleCreateRequest(draft, { runner: 'builtin', projectRoot: '/tmp/p' })
  assert.equal(request.kind, 'daily')
  assert.equal(request.dailyAt, '08:00')
  assert.equal(request.intervalMinutes, undefined, 'daily 不該帶 interval')
  assert.equal(request.runAt, undefined, 'daily 不該帶 runAt')
  assert.deepEqual(request.skillNames, ['inbox-triage'])
  assert.equal(request.runner, 'builtin')
  assert.equal(request.projectRoot, '/tmp/p')
})

test('建立請求：interval 與 once 各自只帶自己的欄位', () => {
  const base = scheduleDraftFromSuggestion(detectAutomationSuggestion('每 15 分鐘檢查建置')!)
  const interval = scheduleCreateRequest({ ...base, kind: 'interval', intervalMinutes: 15 }, {
    runner: 'builtin',
  })
  assert.equal(interval.intervalMinutes, 15)
  assert.equal(interval.dailyAt, undefined)

  const once = scheduleCreateRequest({ ...base, kind: 'once', runAt: '' }, {
    runner: 'builtin',
    now: NOW,
  })
  assert.equal(once.dailyAt, undefined)
  assert.equal(once.intervalMinutes, undefined)
  assert.ok(once.runAt && Date.parse(once.runAt) > NOW, '留空的一次性排程要落在未來')
})

test('事件建立請求預設啟用，空欄位不寫入雜訊', () => {
  const suggestion = detectAutomationSuggestion('當 webhook 收到 CI 失敗就通知我')
  assert.ok(suggestion)
  const request = eventCreateRequest(eventDraftFromSuggestion(suggestion))
  assert.equal(request.enabled, true)
  assert.equal(request.source, 'webhook.http')
  assert.equal(request.subjectContains, undefined)
  assert.equal(request.keyword, undefined)
})

test('建立請求是純轉換：同樣的草稿產生同樣的請求（可安全重試）', () => {
  const draft = scheduleDraftFromSuggestion(detectAutomationSuggestion('每天 07:30 備份')!)
  const a = scheduleCreateRequest(draft, { runner: 'builtin', now: NOW })
  const b = scheduleCreateRequest(draft, { runner: 'builtin', now: NOW })
  assert.deepEqual(a, b)
})

// ── 卡片要講的話 ───────────────────────────────────────────────────

test('觸發前提講清楚：app 沒開就沒有人在跑排程', () => {
  assert.match(SCHEDULE_TRIGGER_CAVEAT, /app 開啟或常駐/)
  assert.match(SCHEDULE_TRIGGER_CAVEAT, /補跑/)
})

test('佇列負載一句話', () => {
  assert.equal(describeQueueLoad(0, 24), '目前沒有待跑任務')
  assert.equal(describeQueueLoad(3, 24), '目前待跑 3/24')
})

test('活躍排程查找只認 enabled', () => {
  const jobs = [job({ enabled: false }), job({ id: 'job-2', enabled: true })]
  assert.equal(findActiveScheduleFor(jobs[0].objective, jobs)?.id, 'job-2')
  assert.equal(findActiveScheduleFor('別的事', jobs), undefined)
})

// ── 安全模型契約 ───────────────────────────────────────────────────

test('對話建議路徑不得直接進入執行：policy 只推卡或提示', () => {
  const policy = fs.readFileSync(path.join(appRoot, 'src/agent/taskRunPolicy.ts'), 'utf8')
  const start = policy.indexOf('export function presentConversationAutomationSuggestion')
  assert.ok(start > 0)
  const block = policy.slice(start, start + 2_400)
  assert.doesNotMatch(block, /dispatchThreadTask|startExecution|runTask\s*\(/)
  assert.match(block, /status: 'suggested'/)
  assert.match(block, /decideConversationSuggestion/)
})

test('建議卡不得自己送出 run：只呼叫建立介面', () => {
  const card = fs.readFileSync(
    path.join(appRoot, 'src/components/ChatAutomationSuggestion.tsx'),
    'utf8',
  )
  assert.doesNotMatch(card, /taskRunCoordinator|runTask\s*\(|dispatchThreadTask/)
  assert.match(card, /scheduleCreateRequest/)
  assert.match(card, /eventCreateRequest/)
})

test('建立來源被記錄（ADR-0040 來源欄位，供統計建議轉換率）', () => {
  const draft = scheduleDraftFromSuggestion(detectAutomationSuggestion('每天 08:00 整理')!)
  const fromCard = scheduleCreateRequest(draft, {
    runner: 'builtin',
    createdFrom: 'chat-suggestion',
  })
  assert.equal(fromCard.createdFrom, 'chat-suggestion')
  const fromPage = scheduleCreateRequest(draft, {
    runner: 'builtin',
    createdFrom: 'automation-page',
  })
  assert.equal(fromPage.createdFrom, 'automation-page')
  // 沒指定來源時不硬塞值（舊呼叫端行為不變）
  assert.equal(scheduleCreateRequest(draft, { runner: 'builtin' }).createdFrom, undefined)
})

test('三個殼共用同一條建立轉換：沒有人再自己組 addJob payload', () => {
  const shells = [
    'src/pages/AutomationPage.tsx',
    'src/pages/ProtocolsPage.tsx',
    'src/components/ChatAutomationSuggestion.tsx',
  ]
  for (const shell of shells) {
    const source = fs.readFileSync(path.join(appRoot, shell), 'utf8')
    assert.match(
      source,
      /scheduleCreateRequest\(/,
      `${shell} 應透過共用轉換建立排程`,
    )
  }
})

test('來源欄位不影響執行：createJob 只是原樣保存', () => {
  const scheduler = fs.readFileSync(path.join(appRoot, 'src/agent/scheduler.ts'), 'utf8')
  assert.match(scheduler, /createdFrom: input\.createdFrom/)
  // 排程觸發驗證不得因為來源不同而放寬
  assert.doesNotMatch(scheduler, /createdFrom === 'chat-suggestion'/)
})

// ── 一次性成功 → 轉為排程（US12）────────────────────────────────────

test('轉為排程：目標沒有 cron 字樣也組得出提案（不能靠偵測）', () => {
  // 使用者做成功的事，措辭裡本來就不會有「每天」；靠 detect 會得到 null。
  const goal = '整理今天的收件匣並寫出待辦摘要'
  assert.equal(detectAutomationSuggestion(goal), null, '前提：這句話偵測不到排程意圖')
  const suggestion = buildRecurringSuggestion(goal, '剛剛成功了')
  assert.ok(suggestion)
  assert.equal(suggestion.kind, 'schedule')
  assert.equal(suggestion.objective, goal)
  assert.ok(suggestion.schedule, '要有可編輯的預設時間')
})

test('轉為排程仍然只是提案：不含任何觸發證據', () => {
  const suggestion = buildRecurringSuggestion('跑每日報表', '剛剛成功了')
  assert.ok(suggestion)
  assert.equal(suggestion.source, 'conversation')
  assert.equal('scheduleTrigger' in suggestion, false)
  assert.equal('eventTrigger' in suggestion, false)
})

test('轉為排程沿用同一套抑制與冷卻（不是另一條路）', () => {
  const goal = '整理今天的收件匣'
  const suggestion = buildRecurringSuggestion(goal, '剛剛成功了')
  assert.ok(suggestion)
  // 已有等價啟用中排程 → 只提示
  assert.equal(
    decideSuggestionPresentation({
      suggestion,
      jobs: [job({ objective: goal })],
      events: [],
      decisions: {},
      now: NOW,
    }).mode,
    'notice',
  )
  // 拒絕過 → 靜音
  assert.equal(
    decideSuggestionPresentation({
      suggestion,
      jobs: [],
      events: [],
      decisions: {
        [suggestion.dedupKey]: { action: 'dismissed', at: new Date(NOW - DAY).toISOString() },
      },
      now: NOW,
    }).mode,
    'silent',
  )
})

test('空目標不產生提案', () => {
  assert.equal(buildRecurringSuggestion('   ', '剛剛成功了'), null)
})

test('只有成功的背景委派才提議常態化，失敗的不提', () => {
  const bg = fs.readFileSync(path.join(appRoot, 'src/agent/hermes/backgroundJobs.ts'), 'utf8')
  assert.match(bg, /job\.ok\s*\n?\s*\?\s*buildRecurringSuggestion/, '必須以 job.ok 為條件')
  assert.match(bg, /suggestion: recurring/)
  // 完成通知本身不得變成執行入口
  const start = bg.indexOf('async function injectBackgroundResult')
  const block = bg.slice(start, bg.indexOf('export type BackgroundJobStatus'))
  assert.doesNotMatch(block, /runTask\s*\(|dispatchThreadTask|addJob\s*\(/)
})

console.log(`\n${passed} automation one-click smoke tests passed`)
console.log('OK')

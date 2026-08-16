/**
 * Composer new-task flow（ticket 04/05）— 從 composer 文字組出自動化建立草稿。
 *
 * composer 的「排程／事件」以前只是替這個對話標記 loop 語意，點了什麼也不會發生：
 * 真正的觸發規則要到「自動化」頁另外建立。這裡把那條死路接起來——把輸入的文字
 * 變成一份可預填、可編輯的草稿，實際建立仍由使用者在表單按下確認。
 *
 * 這個模組是純的：它只組草稿，不建立任何 ScheduledJob / ProactiveEvent，也不
 * 送出任何 run。Time-based / Proactive 依然只能由排程或事件證據進入執行。
 */
import { parseScheduleHintFromText, type AutomationScheduleHint } from './automationSuggestion.ts'
import type { ThreadRunner } from '../store/threadStore.ts'
import type { JobRunner, ScheduleKind } from './types.ts'

export type ScheduleDraft = {
  name: string
  objective: string
  kind: ScheduleKind
  dailyAt: string
  intervalMinutes: number
  runAt: string
  /** 附掛的 Skills（沿用排程表單既有欄位） */
  skillNames?: string[]
}

export type EventDraft = {
  name: string
  source: string
  subjectContains: string
  keyword: string
  hasAttachment: boolean
  objective: string
}

/** 這個 app 真的會送進 matcher 的來源；其餘由 webhook payload 自行宣告。 */
export const EVENT_SOURCE_SUGGESTIONS = [
  { id: 'webhook.http', label: 'Webhook', hint: '本機 webhook 伺服器收到的請求' },
  { id: 'monitor', label: 'Monitor', hint: 'monitor 工具回報的變化' },
] as const

const NAME_MAX = 40

/** 名稱取目標的第一句／前幾個字——夠辨識就好，使用者可以改。 */
export function draftNameFromObjective(objective: string, fallback: string): string {
  const firstLine = objective.split(/[\n。.!?！？]/)[0]?.trim() || ''
  const name = (firstLine || objective).trim().slice(0, NAME_MAX)
  return name || fallback
}

function normalize(objective: string): string {
  return objective.replace(/\s+/g, ' ').trim()
}

export function buildScheduleDraft(objective: string): ScheduleDraft {
  const text = normalize(objective)
  const hint: AutomationScheduleHint = text
    ? parseScheduleHintFromText(text)
    : { kind: 'daily', dailyAt: '08:00' }
  return {
    name: text ? draftNameFromObjective(text, '定時任務') : '',
    objective: text,
    kind: hint.kind,
    dailyAt: hint.dailyAt || '08:00',
    intervalMinutes: hint.intervalMinutes || 30,
    runAt: hint.runAt || '',
    skillNames: [],
  }
}

export function buildEventDraft(objective: string): EventDraft {
  const text = normalize(objective)
  return {
    name: text ? draftNameFromObjective(text, '事件規則') : '',
    source: EVENT_SOURCE_SUGGESTIONS[0].id,
    subjectContains: '',
    keyword: '',
    hasAttachment: false,
    objective: text,
  }
}

/** 一句話描述這份排程草稿何時會跑——建立前與建立後的系統訊息共用。 */
export function describeScheduleDraft(draft: ScheduleDraft): string {
  if (draft.kind === 'interval') return `每 ${draft.intervalMinutes} 分鐘執行`
  if (draft.kind === 'once') return draft.runAt ? `於 ${draft.runAt} 執行一次` : '指定時間執行一次'
  return `每天 ${draft.dailyAt} 執行`
}

/** 一句話描述這條事件規則的匹配條件。 */
export function describeEventDraft(draft: EventDraft): string {
  const predicates = [
    `來源 ${draft.source}`,
    draft.subjectContains ? `主旨含「${draft.subjectContains}」` : '',
    draft.keyword ? `內容含「${draft.keyword}」` : '',
    draft.hasAttachment ? '需有附件' : '',
  ].filter(Boolean)
  return `${predicates.join(' · ')} 時觸發`
}

/** 草稿是否足以建立——目標為空時只提示，不建立空任務。 */
export function scheduleDraftReady(draft: ScheduleDraft): boolean {
  if (!draft.objective.trim()) return false
  if (draft.kind === 'interval') return draft.intervalMinutes > 0
  if (draft.kind === 'daily') return /^\d{2}:\d{2}$/.test(draft.dailyAt)
  return true
}

export function eventDraftReady(draft: EventDraft): boolean {
  return Boolean(draft.objective.trim() && draft.source.trim())
}

/** 排程能表達的執行引擎（UI 選單與白名單共用同一份）。 */
export const JOB_RUNNER_OPTIONS: ReadonlyArray<{ id: JobRunner; label: string }> = [
  { id: 'builtin', label: '內建' },
  { id: 'codex', label: 'Codex' },
  { id: 'claude', label: 'Claude' },
  { id: 'grok', label: 'Grok' },
  { id: 'opencode', label: 'OpenCode' },
  { id: 'cursor', label: 'Cursor' },
]

const JOB_RUNNERS: readonly JobRunner[] = [
  'builtin',
  'codex',
  'claude',
  'grok',
  'opencode',
  'cursor',
]

/**
 * 把對話的執行引擎收斂成排程能存的值。
 *
 * ScheduledJob 的 runner union 比對話的窄（例如沒有 gemini）。落到內建是安全的
 * 退路，但不能默默發生——呼叫端要拿回傳值和原值比對，並把降級講給使用者聽。
 */
export function jobRunnerFor(runner: ThreadRunner): JobRunner {
  return (JOB_RUNNERS as readonly string[]).includes(runner) ? (runner as JobRunner) : 'builtin'
}

/**
 * 排程建立請求（`scheduleStore.addJob` 的輸入）。
 *
 * 抽成純轉換是為了讓「composer 快速動作」「對話建議卡」「自動化頁」三個殼
 * 送出的東西逐欄位相同——卡片是另一個殼，不是另一條 API。
 */
export type AutomationCreatedFrom = 'automation-page' | 'composer' | 'chat-suggestion'

export function scheduleCreateRequest(
  draft: ScheduleDraft,
  context: {
    runner: ThreadRunner
    projectRoot?: string | null
    now?: number
    /** 建立來源（ADR-0040 的來源欄位；不影響執行） */
    createdFrom?: AutomationCreatedFrom
  },
) {
  const now = context.now ?? Date.now()
  return {
    name: draft.name.trim() || draft.objective.slice(0, 40),
    objective: draft.objective.trim(),
    kind: draft.kind,
    dailyAt: draft.kind === 'daily' ? draft.dailyAt : undefined,
    intervalMinutes: draft.kind === 'interval' ? draft.intervalMinutes : undefined,
    runAt:
      draft.kind === 'once'
        ? new Date(draft.runAt || now + 60_000).toISOString()
        : undefined,
    skillNames: draft.skillNames?.length ? draft.skillNames : undefined,
    runner: jobRunnerFor(context.runner),
    projectRoot: context.projectRoot || undefined,
    createdFrom: context.createdFrom,
  }
}

/** 事件規則建立請求（`scheduleStore.addEvent` 的輸入）。 */
export function eventCreateRequest(draft: EventDraft) {
  return {
    name: draft.name.trim() || draft.objective.slice(0, 40),
    source: draft.source.trim(),
    subjectContains: draft.subjectContains.trim() || undefined,
    hasAttachment: draft.hasAttachment,
    keyword: draft.keyword.trim() || undefined,
    objective: draft.objective.trim(),
    enabled: true,
  }
}

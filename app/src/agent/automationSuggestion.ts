/**
 * Consent-first automation intent detection for conversational input.
 *
 * This module is deliberately pure: it recognises a schedule/event hint and
 * returns a proposal. Creating a ScheduledJob, registering an event, or
 * executing a tool belongs to a later, explicit user/trigger action.
 */

import type { ScheduleKind } from './types'

export type AutomationSuggestionKind = 'schedule' | 'event'

export type AutomationScheduleHint = {
  kind: ScheduleKind
  intervalMinutes?: number
  dailyAt?: string
  runAt?: string
}

export type AutomationSuggestion = {
  id: string
  dedupKey: string
  source: 'conversation'
  kind: AutomationSuggestionKind
  title: string
  objective: string
  reason: string
  schedule?: AutomationScheduleHint
}

/**
 * 排程語意的訊號。
 *
 * 必須涵蓋 INTERVAL_RE 讀得懂的講法（例如「每 15 分鐘」）——模組能解析卻不認得
 * 是同一個模組內部不一致：使用者說了一句我們解析得出來的排程，卻收不到建議。
 */
const SCHEDULE_SIGNAL_RE =
  /(?:\bcron\b|\bschedule(?:d)?\b|\bdaily\b|\bevery\s+(?:day|hour|week|\d+)\b|\bweekly\b|每(?:天|日|週|星期|小時)|每隔?\s*\d+\s*(?:分鐘|分|小時)|每日|定時|排程)/i
const INTERVAL_RE =
  /(?:every|每隔?)\s*(\d+)\s*(minutes?|mins?|minute|hours?|hour|分鐘|分|小時)/i
const CLOCK_RE =
  /(?:\b(?:at|daily|every\s+day)\s*|每天?\s*|每日\s*|定時\s*)?(\d{1,2})[:：](\d{2})/i
const EVENT_SIGNAL_RE =
  /(?:\bwhen\b|\bon\s+event\b|\bwebhook\b|\bmonitor\b|\btrigger(?:\s+when)?\b|\bif\s+(?:an?\s+)?(?:email|webhook|event|message|notification)\b|當|如果|若|一旦|每當|事件|收到[^\n]{0,32}(?:時|後|后))/i

function normalizeObjective(input: string): string {
  return input.replace(/\s+/g, ' ').trim().slice(0, 2_000)
}

function keyFor(objective: string): string {
  const key = objective
    .toLowerCase()
    .replace(/[^a-z0-9一-鿿]+/gi, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 96)
  return `conversation:${key || 'automation-intent'}`
}

function parseClock(text: string): string | undefined {
  const match = text.match(CLOCK_RE)
  if (!match) return undefined
  const hour = Number(match[1])
  const minute = Number(match[2])
  if (!Number.isInteger(hour) || !Number.isInteger(minute)) return undefined
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return undefined
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`
}

/**
 * 從文字推出排程提示（每 N 分鐘／每天幾點）。
 * composer 的排程建立表單（ticket 04）與這裡的建議卡共用同一份判讀。
 */
export function parseScheduleHintFromText(text: string): AutomationScheduleHint {
  const interval = text.match(INTERVAL_RE)
  if (interval) {
    const amount = Math.max(1, Number(interval[1]))
    const unit = interval[2].toLowerCase()
    return {
      kind: 'interval',
      intervalMinutes: /hour|小時/.test(unit) ? amount * 60 : amount,
    }
  }

  return {
    kind: 'daily',
    dailyAt: parseClock(text) || '08:00',
  }
}

function scheduleLabel(schedule: AutomationScheduleHint): string {
  if (schedule.kind === 'interval') {
    return `每 ${schedule.intervalMinutes || 60} 分鐘執行`
  }
  if (schedule.kind === 'once') return '指定時間執行'
  return `每日 ${schedule.dailyAt || '08:00'} 執行`
}

/**
 * Detect automation-shaped conversational text without executing anything.
 * Event semantics take precedence when a request contains both a clock and a
 * concrete event source (for example a webhook arriving at a time).
 */
export function detectAutomationSuggestion(
  input: string,
): AutomationSuggestion | null {
  const objective = normalizeObjective(input)
  if (!objective) return null

  const hasEventSignal = EVENT_SIGNAL_RE.test(objective)
  const hasScheduleSignal =
    SCHEDULE_SIGNAL_RE.test(objective) ||
    (Boolean(parseClock(objective)) &&
      /(?:\b(?:at|every|daily)\b|每天|每日|定時|時間)/i.test(objective))

  if (!hasEventSignal && !hasScheduleSignal) return null

  const kind: AutomationSuggestionKind = hasEventSignal ? 'event' : 'schedule'
  const dedupKey = keyFor(objective)
  if (kind === 'event') {
    return {
      id: `automation_${dedupKey.replace(/[^a-z0-9._:-]+/gi, '_').slice(0, 110)}`,
      dedupKey,
      source: 'conversation',
      kind,
      title: `建立事件規則：${objective.slice(0, 36)}`,
      objective,
      reason:
        '偵測到 when/if、Webhook 或事件條件語意；對話自動分類不會直接啟動 Proactive loop。',
    }
  }

  const schedule = parseScheduleHintFromText(objective)
  return {
    id: `automation_${dedupKey.replace(/[^a-z0-9._:-]+/gi, '_').slice(0, 110)}`,
    dedupKey,
    source: 'conversation',
    kind,
    title: `建立排程：${objective.slice(0, 36)}`,
    objective,
    schedule,
    reason: `偵測到 cron／定時語意（${scheduleLabel(schedule)}）；對話自動分類不會直接啟動 Time-based loop。`,
  }
}

/** Stable chat rendering for a suggestion; no action is implied by this text. */
export function formatAutomationSuggestion(suggestion: AutomationSuggestion): string {
  const kind = suggestion.kind === 'schedule' ? 'ScheduledJob' : 'Proactive event rule'
  const recommendation =
    suggestion.kind === 'schedule' && suggestion.schedule
      ? `前往「自動化」建立 ${scheduleLabel(suggestion.schedule)} 的 ${kind}`
      : `前往「自動化」註冊並確認 ${kind}`

  return [
    '💡 自動化建議（尚未執行）',
    'Trigger source：對話文字',
    `建議類型：${kind}`,
    `原因：${suggestion.reason}`,
    `下一步：${recommendation}；確認前不會執行工具。`,
  ].join('\n')
}

/**
 * 明確為某個目標組一張「轉為排程」的提案。
 *
 * 和 `detectAutomationSuggestion` 不同：那支是從對話文字**猜**有沒有排程意圖，
 * 這支是使用者已經把事情做成功了、我們問要不要常態化——目標文字裡本來就不會有
 * cron 字樣，所以不能靠偵測。
 *
 * 仍然只是提案：回傳值不含任何觸發證據，什麼都不會被執行。
 */
export function buildRecurringSuggestion(
  objective: string,
  reason: string,
): AutomationSuggestion | null {
  const normalized = normalizeObjective(objective)
  if (!normalized) return null
  const dedupKey = keyFor(normalized)
  return {
    id: `automation_${dedupKey.replace(/[^a-z0-9._:-]+/gi, '_').slice(0, 110)}`,
    dedupKey,
    source: 'conversation',
    kind: 'schedule',
    title: `轉為排程：${normalized.slice(0, 36)}`,
    objective: normalized,
    reason,
    schedule: parseScheduleHintFromText(normalized),
  }
}

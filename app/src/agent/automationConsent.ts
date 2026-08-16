/**
 * Automation one-click（spec 5/6 ticket 01）— 建議的抑制、冷卻與建立草稿。
 *
 * 這個模組刻意是純的，而且刻意**不會建立任何東西**：它只回答「這次該不該推卡」
 * 「卡上預填什麼」。真正的建立仍由使用者按下按鈕、走 Automation 既有的建立路徑。
 *
 * 安全模型不在這裡放寬：對話文字永遠只能產生建議，Time-based 仍需 claimed
 * ScheduledJob snapshot、Proactive 仍需布林事件證據（見 CONTEXT.md）。
 */
import type { AutomationSuggestion } from './automationSuggestion.ts'
import {
  buildEventDraft,
  buildScheduleDraft,
  type EventDraft,
  type ScheduleDraft,
} from './composerAutomationDraft.ts'
import type { ProactiveEvent, ScheduledJob } from './types.ts'

/** 拒絕之後多久不再對同一個目標提出同樣的建議。 */
export const SUGGESTION_COOLDOWN_DAYS = 7
const COOLDOWN_MS = SUGGESTION_COOLDOWN_DAYS * 24 * 60 * 60 * 1000

/**
 * 建立成功後要記住的東西——持久化的領域資料，因此住在 agent 層而不是元件裡。
 * （store 匯入 components 會形成反向相依與循環。）
 */
export type AutomationCreatedInfo = {
  kind: AutomationSuggestion['kind']
  name: string
  /** 一句話：何時會觸發 */
  summary: string
  /** 管理連結（hash route） */
  href: string
  /** 下次觸發時間（排程才有） */
  nextRunAt?: string | null
}

export type SuggestionDecision = {
  action: 'accepted' | 'dismissed'
  at: string
}

/**
 * 這次要對使用者做什麼。
 *
 * - `card`：推一張可編輯的建議卡
 * - `notice`：已經有等價的自動化在跑了，只講一句，不要再推一次卡
 * - `silent`：使用者拒絕過且還在冷卻期內——拒絕是有記憶的
 */
export type SuggestionPresentation =
  | { mode: 'card' }
  | { mode: 'notice'; message: string }
  | { mode: 'silent'; reason: string }

function normalize(text: string): string {
  return text.replace(/\s+/g, ' ').trim().toLowerCase()
}

/** 目標是否等價——用來判斷「這件事已經自動化過了」。 */
export function sameObjective(a: string, b: string): boolean {
  return normalize(a) === normalize(b)
}

/** 找出已經在跑同一個目標的啟用中排程。 */
export function findActiveScheduleFor(
  objective: string,
  jobs: readonly ScheduledJob[],
): ScheduledJob | undefined {
  return jobs.find((job) => job.enabled && sameObjective(job.objective, objective))
}

/** 找出已經在監聽同一個目標的啟用中事件規則。 */
export function findActiveEventFor(
  objective: string,
  events: readonly ProactiveEvent[],
): ProactiveEvent | undefined {
  return events.find((event) => event.enabled && sameObjective(event.objective, objective))
}

export function cooldownRemainingMs(
  decision: SuggestionDecision | undefined,
  now: number,
): number {
  if (!decision || decision.action !== 'dismissed') return 0
  const at = Date.parse(decision.at)
  if (!Number.isFinite(at)) return 0
  return Math.max(0, at + COOLDOWN_MS - now)
}

/**
 * 決定這次的呈現方式。
 *
 * 順序有意義：先看冷卻（使用者說過不要），再看是否已有等價自動化（別重複問），
 * 最後才推卡。反過來會讓拒絕過的人又被問一次。
 */
export function decideSuggestionPresentation(input: {
  suggestion: AutomationSuggestion
  jobs: readonly ScheduledJob[]
  events: readonly ProactiveEvent[]
  decisions: Record<string, SuggestionDecision | undefined>
  now?: number
}): SuggestionPresentation {
  const now = input.now ?? Date.now()
  const remaining = cooldownRemainingMs(input.decisions[input.suggestion.dedupKey], now)
  if (remaining > 0) {
    const days = Math.ceil(remaining / (24 * 60 * 60 * 1000))
    return { mode: 'silent', reason: `已拒絕過，${days} 天內不再建議` }
  }

  if (input.suggestion.kind === 'schedule') {
    const active = findActiveScheduleFor(input.suggestion.objective, input.jobs)
    if (active) {
      return {
        mode: 'notice',
        message: `已有啟用中的定時任務「${active.name}」在做同一件事，這次不重複建立。`,
      }
    }
  } else {
    const active = findActiveEventFor(input.suggestion.objective, input.events)
    if (active) {
      return {
        mode: 'notice',
        message: `已有啟用中的事件規則「${active.name}」在做同一件事，這次不重複建立。`,
      }
    }
  }

  return { mode: 'card' }
}

/** 把建議轉成排程建立草稿（卡片的預填值）。 */
export function scheduleDraftFromSuggestion(suggestion: AutomationSuggestion): ScheduleDraft {
  const draft = buildScheduleDraft(suggestion.objective)
  const hint = suggestion.schedule
  if (!hint) return draft
  return {
    ...draft,
    kind: hint.kind,
    dailyAt: hint.dailyAt || draft.dailyAt,
    intervalMinutes: hint.intervalMinutes || draft.intervalMinutes,
    runAt: hint.runAt || draft.runAt,
  }
}

/** 把建議轉成事件規則建立草稿。 */
export function eventDraftFromSuggestion(suggestion: AutomationSuggestion): EventDraft {
  return buildEventDraft(suggestion.objective)
}

/**
 * 排程真的什麼時候會跑——卡片要講清楚的前提。
 *
 * 這不是免責聲明，是使用者需要知道的事實：這個產品在本機執行，app 沒開就沒有人
 * 在跑那個排程。講清楚比事後才發現沒跑好。
 */
export const SCHEDULE_TRIGGER_CAVEAT =
  '排程只在 app 開啟或常駐系統匣時觸發；關閉 app 期間到期的任務會在下次啟動時補跑。'

/** 佇列負載的一句話（建立前先讓人知道系統忙不忙）。 */
export function describeQueueLoad(queued: number, max: number): string {
  if (queued <= 0) return '目前沒有待跑任務'
  return `目前待跑 ${queued}/${max}`
}

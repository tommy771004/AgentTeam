/**
 * Narration for run outcomes the user was never told about.
 *
 * The journal (ADR-0040) knows a run reached a terminal state; it does not
 * hold the run's output, its diff, or any proof of what changed on disk. So
 * the redelivered message says exactly what the record can support — the
 * objective, when it ended, and how it settled — and says plainly that it is
 * a replayed record rather than a fresh verification. ADR-0048: never claim a
 * side effect that cannot be shown.
 */

import { isIterationExhausted, iterationExhaustedLabel } from './runLifecycle.ts'
import type { JournalEntry, RecoveryItem } from './runJournal.ts'

export type PendingDeliveryNarration = {
  runId: string
  threadId?: string
  /** System bubble for the owning thread; absent when it cannot be delivered. */
  message?: string
  /** Startup recovery report line; used when there is no thread to speak into. */
  recovery?: RecoveryItem
}

const REDELIVERY_FOOTNOTE = '此訊息由啟動復原補送，內容取自本機執行紀錄，未重新驗證任何變更。'

/** Local `YYYY-MM-DD HH:mm`; falls back to the raw value when unparseable. */
export function formatFinishedAt(value: string | undefined): string {
  if (!value) return '時間不明'
  const at = new Date(value)
  if (Number.isNaN(at.getTime())) return value.slice(0, 40)
  const pad = (part: number) => String(part).padStart(2, '0')
  return `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())} ${pad(at.getHours())}:${pad(at.getMinutes())}`
}

/**
 * How a settled run may honestly be described from its journal entry alone.
 *
 * An external CLI run only ever "ended" — it never declared a Definition of
 * Done, so no redelivered copy may say it met one.
 */
export function redeliveryOutcomeLine(entry: JournalEntry): string {
  if (entry.executionKind === 'external') return '外部 CLI 已結束（不宣稱 DoD）'
  if (entry.status !== 'success') {
    return entry.status === 'interrupted'
      ? '執行中斷，結果未知'
      : entry.status === 'cancelled'
        ? '已中止'
        : '執行失敗'
  }
  const orchestration = {
    iterations: entry.iterations,
    maxIterations: entry.maxIterations,
    dodMet: entry.dodMet,
    executionKind: entry.executionKind,
  }
  return isIterationExhausted(orchestration) ? iterationExhaustedLabel(entry.iterations) : '已完成'
}

/**
 * Turn one claimed pending-delivery entry into what the user should see.
 *
 * A successful outcome with a surviving thread becomes a message in that
 * thread. Anything else becomes one honest line in the startup recovery
 * report: a lost thread is reported as unknown rather than as success or
 * failure, because the outcome can no longer be shown where it belongs.
 */
export function narratePendingDelivery(
  entry: JournalEntry,
  threadExists: boolean,
): PendingDeliveryNarration {
  const objective = (entry.objective || '').trim()
  const finishedAt = formatFinishedAt(entry.finishedAt || entry.updatedAt)
  const outcome = redeliveryOutcomeLine(entry)

  if (!entry.threadId || !threadExists) {
    return {
      runId: entry.id,
      threadId: entry.threadId,
      recovery: {
        kind: 'run',
        id: entry.id,
        previousStatus: entry.status,
        action: 'result-unknown',
        detail: `找不到擁有這次執行的對話，結果未知（${finishedAt}${objective ? ` · ${objective}` : ''}）。`,
      },
    }
  }

  if (entry.status !== 'success') {
    return {
      runId: entry.id,
      threadId: entry.threadId,
      recovery: {
        kind: 'run',
        id: entry.id,
        previousStatus: entry.status,
        action: 'redelivered',
        detail: `你不在時這次執行以「${outcome}」收尾（${finishedAt}${objective ? ` · ${objective}` : ''}）。`,
      },
    }
  }

  return {
    runId: entry.id,
    threadId: entry.threadId,
    message: [
      '你不在時這個任務結束了',
      `目標：${objective || '（沒有目標描述）'}`,
      `結束時間：${finishedAt}`,
      `結果：${outcome}`,
      REDELIVERY_FOOTNOTE,
    ].join('\n'),
    recovery: {
      kind: 'run',
      id: entry.id,
      previousStatus: entry.status,
      action: 'redelivered',
      detail: `已補送完成通知到原對話（${outcome}）。`,
    },
  }
}

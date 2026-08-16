/**
 * Composer new-task flow（ticket 07）— 對話內的「調整參數重跑」。
 *
 * 這個能力以前只存在於 legacy 的裸殼失敗頁：任務失敗後要離開對話、跳到一個沒有
 * 入口的頁面才能調 maxIterations／minConfidence／timeout 重跑。這裡把它變成 run
 * 後續動作區的一顆按鈕，重跑仍走既有的任務生命週期（新的 runId、來源記為 retry）。
 *
 * 模組是純的：只負責夾緊參數、決定能不能重跑、以及組出白名單覆寫。實際送出由
 * 呼叫端交給 taskRunCoordinator。
 */
import type {
  EventTriggerSnapshot,
  LoopType,
  RuntimeOverrides,
  ScheduleTriggerSnapshot,
} from './types.ts'

export type RetryParams = {
  maxIterations: number
  minConfidence: number
  timeoutMs: number
}

export const RETRY_LIMITS = {
  maxIterations: { min: 1, max: 20 },
  minConfidence: { min: 0.1, max: 1 },
  timeoutMs: { min: 5_000, max: 600_000 },
} as const

function clamp(value: number, min: number, max: number, fallback: number): number {
  if (!Number.isFinite(value)) return fallback
  return Math.min(max, Math.max(min, value))
}

/** 夾緊到可用範圍；非數字回退到預設，不讓 NaN 進到 run。 */
export function clampRetryParams(raw: Partial<RetryParams>, defaults: RetryParams): RetryParams {
  return {
    maxIterations: Math.round(
      clamp(
        Number(raw.maxIterations),
        RETRY_LIMITS.maxIterations.min,
        RETRY_LIMITS.maxIterations.max,
        defaults.maxIterations,
      ),
    ),
    minConfidence: clamp(
      Number(raw.minConfidence),
      RETRY_LIMITS.minConfidence.min,
      RETRY_LIMITS.minConfidence.max,
      defaults.minConfidence,
    ),
    timeoutMs: Math.round(
      clamp(
        Number(raw.timeoutMs),
        RETRY_LIMITS.timeoutMs.min,
        RETRY_LIMITS.timeoutMs.max,
        defaults.timeoutMs,
      ),
    ),
  }
}

export type RetryEvidence = {
  scheduleTrigger?: ScheduleTriggerSnapshot
  eventTrigger?: EventTriggerSnapshot
}

export type RetryEligibility =
  | { canRetry: true }
  | { canRetry: false; reason: string }

/**
 * 這個 run 能不能就地重跑。
 *
 * Time-based / Proactive 只能由排程或事件證據進入執行；失敗的那次若沒有留下證據
 * 快照，就沒有東西可以重放——這時誠實擋下來，而不是偷偷改成 Goal-based 重跑。
 */
export function retryEligibility(
  loopType: LoopType | undefined,
  evidence: RetryEvidence,
): RetryEligibility {
  if (loopType === 'Time-based' && !evidence.scheduleTrigger) {
    return { canRetry: false, reason: '這是定時任務，缺少排程觸發證據，請從「自動化」頁重跑。' }
  }
  if (loopType === 'Proactive' && !evidence.eventTrigger) {
    return { canRetry: false, reason: '這是事件任務，缺少事件匹配證據，請從「自動化」頁重跑。' }
  }
  return { canRetry: true }
}

/**
 * 組出重跑的 runtime overrides。
 *
 * 白名單就是這三個參數，加上重放同一種 loop 必需的觸發證據。其他任何東西
 * （模型、approval、能力預載…）都不從失敗的那次帶過來——重跑是一次新的 run。
 */
export function buildRetryOverrides(
  params: RetryParams,
  evidence: RetryEvidence,
): RuntimeOverrides {
  const overrides: RuntimeOverrides = {
    maxIterations: params.maxIterations,
    minConfidence: params.minConfidence,
    timeoutMs: params.timeoutMs,
  }
  if (evidence.scheduleTrigger) overrides.scheduleTrigger = evidence.scheduleTrigger
  if (evidence.eventTrigger) overrides.eventTrigger = evidence.eventTrigger
  return overrides
}

/** 送給 coordinator 的欄位（呼叫端補上 objective / reuseThreadId）。 */
export function buildRetryRunFields(loopType: LoopType | undefined, evidence: RetryEvidence) {
  return {
    sourceKind: 'retry' as const,
    sourceLabel: '對話內調整參數重跑',
    loopType,
    eventPreMatched: loopType === 'Proactive' && Boolean(evidence.eventTrigger),
  }
}

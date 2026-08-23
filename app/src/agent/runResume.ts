/**
 * Resuming a run that was parked.
 *
 * Stopping a long task and starting it over is the same cost as never stopping
 * it, so an interrupted run can continue from its last checkpoint. What makes
 * that safe is where it stopped: an interrupt parks at a tool boundary with
 * nothing mid-execution, which is the only state in which the record can
 * honestly claim that no effectful action happened after the checkpoint
 * (ADR-0042). Anything less refuses, and says why.
 *
 * Resume is not a second ingress. It builds a continuation objective and hands
 * it to `taskRunCoordinator.runTask` like every other entry point.
 */

import type { CompactionCheckpoint } from './compactionCheckpoint.ts'

export type ResumeRefusal =
  | 'no-checkpoint'
  | 'not-replay-safe'
  | 'already-claimed'
  | 'no-durable-store'
  | 'no-thread'

export type ResumeDecision =
  | { allowed: true; checkpoint: CompactionCheckpoint }
  | { allowed: false; refusal: ResumeRefusal; detail: string; checkpoint?: CompactionCheckpoint }

/** What the user is told when a resume is refused. Never blames them. */
export const RESUME_REFUSAL_COPY: Record<ResumeRefusal, string> = {
  'no-checkpoint': '這次執行沒有留下可續跑的檢查點，只能重新開始。',
  'not-replay-safe':
    '無法證明中斷後沒有已經發生的副作用（例如寫檔或送出請求），為了不重複執行，這次不提供續跑。',
  'already-claimed': '這個檢查點已經續跑過一次了，不會重複觸發。',
  'no-durable-store': '找不到本機的檢查點儲存層，無法確認續跑是否安全。',
  'no-thread': '找不到這次執行所屬的對話，無法把續跑放回原處。',
}

/**
 * Decide whether one checkpoint may be resumed.
 *
 * Pure and fail-closed: every path that cannot positively establish replay
 * safety returns a refusal with a reason the user can read.
 */
export function decideResume(
  checkpoint: CompactionCheckpoint | null | undefined,
  options: { hasOwningThread?: boolean } = {},
): ResumeDecision {
  if (!checkpoint) {
    return { allowed: false, refusal: 'no-checkpoint', detail: RESUME_REFUSAL_COPY['no-checkpoint'] }
  }
  if (checkpoint.resumeClaimedAt) {
    return { allowed: false, refusal: 'already-claimed', detail: RESUME_REFUSAL_COPY['already-claimed'], checkpoint }
  }
  // Replay safety must be asserted at write time by a clean tool-boundary park;
  // it is never inferred here from the absence of evidence.
  if (checkpoint.replaySafe !== true || checkpoint.parkedAtToolBoundary !== true) {
    return { allowed: false, refusal: 'not-replay-safe', detail: RESUME_REFUSAL_COPY['not-replay-safe'], checkpoint }
  }
  if (options.hasOwningThread === false) {
    return { allowed: false, refusal: 'no-thread', detail: RESUME_REFUSAL_COPY['no-thread'], checkpoint }
  }
  return { allowed: true, checkpoint }
}

/**
 * The objective a resumed run is given.
 *
 * It states what was already done so the agent continues rather than redoing
 * it, and names the completed side effects explicitly — the list is the whole
 * reason a resume is allowed to skip them.
 */
export function buildResumeObjective(checkpoint: CompactionCheckpoint): string {
  const effects = (checkpoint.effects || []).slice(0, 20)
  return [
    `延續先前中斷的任務：${(checkpoint.objective || '').trim() || '（原始目標未記錄）'}`,
    '',
    '## 先前進度（來自中斷時的檢查點）',
    checkpoint.summary.trim() || '（沒有可用的進度摘要）',
    '',
    effects.length
      ? `## 已經完成、不可重做的動作\n${effects.map((effect) => `- ${effect}`).join('\n')}`
      : '## 已經完成、不可重做的動作\n（檢查點記錄為無）',
    '',
    '請從上面的進度接續，不要重跑已完成的步驟，也不要重複任何已列出的動作。',
  ].join('\n')
}

/** Does this terminal run offer a resume entry at all? */
export function isResumableTerminalRun(input: {
  status?: string
  interruptReason?: 'user' | 'timeout'
}): boolean {
  return input.status === 'halted' && (input.interruptReason === 'user' || input.interruptReason === 'timeout')
}

/**
 * Goal-based corrective replan — when DoD is unmet, replace the step plan
 * with gap-driven corrective steps instead of blind re-run of the same plan.
 */

import type { ExecutionStep } from './types.ts'

/**
 * Build 1–3 corrective steps from DoD missing[] items, plus an optional re-validate step.
 * Pure: no I/O.
 */
export function replanCorrectiveSteps(
  missing: string[],
  objective: string,
  opts?: { maxSteps?: number },
): ExecutionStep[] {
  const maxSteps = Math.max(1, Math.min(4, opts?.maxSteps ?? 3))
  const gaps = missing
    .map((item) => item.trim())
    .filter(Boolean)
    .slice(0, Math.max(1, maxSteps - 1))

  const sequence: string[] =
    gaps.length > 0
      ? gaps.map((gap) => `補齊缺口：${gap}`.slice(0, 240))
      : [`依目標補齊未達標部分：${objective.slice(0, 120)}`]

  if (sequence.length < maxSteps) {
    sequence.push('依 Definition of Done 重新驗證並產出完整結果')
  }

  return sequence.slice(0, maxSteps).map((description, index) => ({
    step: index + 1,
    action: `correct_${index + 1}`,
    description,
    status: 'PENDING' as const,
  }))
}

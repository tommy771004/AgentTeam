/**
 * Cross-run Goal resume — keep DoD / missing / steps so the next chat turn
 * can continue the same loop instead of re-parsing from scratch.
 */

import type { LoopType } from './types'

export type ContinueGoalSnapshot = {
  objective: string
  definitionOfDone: string
  loopType: LoopType
  /** Last known step descriptions (may be replan corrective steps) */
  steps: string[]
  /** DoD gaps from last evaluation */
  missing: string[]
  /** Short prior outputs / partial result for context */
  priorDigest?: string
  lastStatus: 'failed' | 'halted' | 'success' | 'running'
  runId?: string
  at: string
}

export function buildContinueGoalSnapshot(input: {
  objective: string
  definitionOfDone: string
  loopType: LoopType
  steps: Array<{ description: string }>
  missing?: string[]
  priorDigest?: string
  lastStatus: ContinueGoalSnapshot['lastStatus']
  runId?: string
}): ContinueGoalSnapshot {
  return {
    objective: input.objective.trim().slice(0, 2000),
    definitionOfDone: input.definitionOfDone.trim().slice(0, 800),
    loopType: input.loopType || 'Goal-based',
    steps: input.steps.map((s) => s.description).filter(Boolean).slice(0, 8),
    missing: (input.missing || []).map((m) => m.trim()).filter(Boolean).slice(0, 8),
    priorDigest: input.priorDigest?.trim().slice(0, 2500) || undefined,
    lastStatus: input.lastStatus,
    runId: input.runId,
    at: new Date().toISOString(),
  }
}

/** System bubble when a Goal ends without meeting DoD. */
export function formatContinueGoalOffer(snap: ContinueGoalSnapshot): string {
  const gaps =
    snap.missing.length > 0
      ? snap.missing.map((m) => `· ${m}`).join('\n')
      : '· （無明細缺口 — 將重跑修正步驟）'
  return [
    '⏸ Goal 未達標 — 可「補齊缺口繼續」保留同一 DoD，不必重新解析任務。',
    `目標：${snap.objective.slice(0, 120)}`,
    `DoD：${snap.definitionOfDone.slice(0, 160)}`,
    '缺口：',
    gaps,
    '提示：點右側面板「補齊缺口繼續」，或輸入「繼續／補齊…」。',
  ].join('\n')
}

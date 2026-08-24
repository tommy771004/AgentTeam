/**
 * Turning one finished run into the four things worth remembering.
 *
 * Every line here is derived from what the run actually recorded — its plan
 * steps, its failures, its halt reason — so the digest is a reading of the
 * execution record rather than the model's account of itself (ADR-0048).
 *
 * The wording is deliberately plain: this file is read by whoever picks up the
 * work next, which is often not an engineer.
 */

import type { AgentState } from './types.ts'
import type { RunMemoryDigest } from './runMemorySink.ts'

const MAX_ITEMS = 8
const MAX_LINE = 220

function tidy(value: string | undefined): string {
  return (value || '').replace(/\s+/g, ' ').trim().slice(0, MAX_LINE)
}

function unique(lines: string[]): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const line of lines) {
    const text = tidy(line)
    if (!text || seen.has(text)) continue
    seen.add(text)
    out.push(text)
    if (out.length >= MAX_ITEMS) break
  }
  return out
}

export function buildRunMemoryDigestFromRun(input: {
  runId: string
  threadId: string
  objective: string
  agent: AgentState
  status: string
}): RunMemoryDigest {
  const steps = input.agent.steps || []
  const completed = steps.filter((step) => step.status === 'COMPLETED')
  const failed = steps.filter((step) => step.status === 'FAILED')

  // A decision is a step that succeeded and said what it did — the tool trail
  // is evidence, the step description is the human-readable version of it.
  const decisions = unique([
    ...completed.map((step) => step.description || step.action || ''),
    ...(input.agent.loopConfig?.definitionOfDone
      ? [`驗收條件：${input.agent.loopConfig.definitionOfDone}`]
      : []),
  ])

  const failures = unique([
    ...failed.map((step) => `${step.description || step.action || '步驟'}：${step.result || '沒有記錄原因'}`),
    ...(input.agent.haltReason ? [input.agent.haltReason] : []),
    ...(input.agent.interruptReason === 'timeout' ? ['這次執行逾時被中止，下次可考慮拆小或放寬時間上限。'] : []),
    ...(input.agent.interruptReason === 'user' ? ['這次執行由使用者中止。'] : []),
  ])

  // A procedure is only worth writing down when the run actually walked one.
  const procedure = completed.length >= 2
    ? unique(completed.map((step, index) => `${index + 1}. ${step.description || step.action || `步驟 ${step.step}`}`))
    : []

  return {
    runId: input.runId,
    threadId: input.threadId,
    at: input.agent.finishedAt || new Date().toISOString(),
    objective: tidy(input.objective),
    decisions,
    failures,
    procedure,
  }
}

/** Parse a digest file back into its four sections for prior-context reuse. */
export function parseRunMemoryDigest(markdown: string, fallback: {
  runId: string
  threadId: string
  at: string
}): RunMemoryDigest | null {
  const text = String(markdown || '')
  if (!text.trim()) return null
  const objective = /^#\s+(.+)$/m.exec(text)?.[1]?.trim() || ''
  const sectionLines = (title: string): string[] => {
    const match = new RegExp(`^##\\s+${title}\\s*$([\\s\\S]*?)(?=^##\\s|\\Z)`, 'm').exec(text)
    if (!match) return []
    return match[1]
      .split('\n')
      .map((line) => line.replace(/^\s*-\s*/, '').trim())
      .filter((line) => line && !line.startsWith('（'))
  }
  return {
    runId: fallback.runId,
    threadId: fallback.threadId,
    at: /^>\s+run\s+\S+\s+·\s+(\S+)/m.exec(text)?.[1] || fallback.at,
    objective,
    decisions: sectionLines('做了哪些決定'),
    failures: sectionLines('哪裡卡住或失敗'),
    procedure: sectionLines('下次可以照著做的步驟'),
  }
}

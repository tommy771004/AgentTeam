import {
  continuationSignature,
  normalizeContinuationItems,
  selectContinuationItem,
  type ContinuationItem,
} from './continuation.ts'

const ENVELOPE = /<agentteam-continuation>([\s\S]*?)<\/agentteam-continuation>/i

export type ExternalCliContinuationEnvelope = Readonly<{
  done: boolean
  items: readonly ContinuationItem[]
}>

export function parseExternalCliContinuationEnvelope(output: string): ExternalCliContinuationEnvelope | undefined {
  const match = output.match(ENVELOPE)
  if (!match?.[1]) return undefined
  try {
    const parsed = JSON.parse(match[1]) as { done?: unknown; items?: unknown }
    if (typeof parsed.done !== 'boolean' || !Array.isArray(parsed.items)) return undefined
    const items = normalizeContinuationItems(parsed.items)
    if (parsed.items.length !== items.length) return undefined
    return Object.freeze({ done: parsed.done, items: Object.freeze(items) })
  } catch {
    return undefined
  }
}

export function stripExternalCliContinuationEnvelope(output: string): string {
  return output.replace(ENVELOPE, '').trim()
}

export function externalCliContinuationPrompt(input: {
  objective: string
  item?: ContinuationItem
  priorOutput?: string
  phase?: 'plan' | 'build'
}): string {
  return [
    '# External CLI orchestrated iteration',
    'This process is one iteration of the same logical task. Do not ask the user to send another message.',
    `Original objective:\n${input.objective.trim()}`,
    input.phase === 'plan'
      ? 'This is the Plan phase. Do not implement. Return original-objective continuation items that the next Build process can execute.'
      : 'This is the Build phase. Implement and verify the selected work.',
    input.item
      ? `Current Host-selected item:\n${JSON.stringify(input.item)}`
      : 'Complete as much of the original objective as is safely possible in this iteration.',
    input.priorOutput?.trim()
      ? `Prior iteration digest (not proof; verify against the workspace):\n${input.priorOutput.trim().slice(-2_000)}`
      : '',
    'Before the final answer, assess remaining implementation or improvement work.',
    'End with exactly one machine-readable envelope:',
    '<agentteam-continuation>{"done":true,"items":[]}</agentteam-continuation>',
    'When done is false, items must use: id, title, description, acceptanceCriteria[], priority, dependencies[], scope (original-objective|expanded), requiresAdditionalAuthority, status (candidate|running|completed|blocked|discarded).',
    'Only original-objective items may be auto-selected. Mark any scope expansion or extra authority honestly so the Host can stop.',
  ].filter(Boolean).join('\n\n')
}

export async function runExternalCliOrchestration<T extends { ok: boolean; output: string }>(input: {
  objective: string
  maxIterations: number
  initialAgentMode?: 'plan' | 'build'
  execute: (prompt: string, iteration: number, phase: 'plan' | 'build') => Promise<T>
  onIteration?: (event: { iteration: number; phase: 'started' | 'continued' | 'stopped'; detail: string }) => void
}): Promise<T & { iterations: number; orchestrationStopReason?: string }> {
  const limit = Math.max(1, Math.min(20, Math.floor(input.maxIterations || 1)))
  let item: ContinuationItem | undefined
  let priorOutput = ''
  let priorSignature = ''
  let repeated = 0
  let last: T | undefined
  let phase: 'plan' | 'build' = input.initialAgentMode === 'plan' ? 'plan' : 'build'

  for (let iteration = 1; iteration <= limit; iteration += 1) {
    input.onIteration?.({ iteration, phase: 'started', detail: item ? item.title : 'original objective' })
    last = await input.execute(externalCliContinuationPrompt({
      objective: input.objective,
      item,
      priorOutput,
      phase,
    }), iteration, phase)
    if (!last.ok) return { ...last, output: stripExternalCliContinuationEnvelope(last.output), iterations: iteration }

    const envelope = parseExternalCliContinuationEnvelope(last.output)
    if (!envelope) {
      const reason = 'CLI 未回傳有效續行 envelope；保留本輪結果但不自動擴大執行。'
      input.onIteration?.({ iteration, phase: 'stopped', detail: reason })
      return { ...last, output: stripExternalCliContinuationEnvelope(last.output), iterations: iteration, orchestrationStopReason: reason }
    }
    if (envelope.done) return { ...last, output: stripExternalCliContinuationEnvelope(last.output), iterations: iteration }

    const selection = selectContinuationItem(envelope.items)
    if (!selection.item) {
      const reason = selection.blockedReason || 'CLI 表示尚未完成，但沒有可安全續行的項目。'
      input.onIteration?.({ iteration, phase: 'stopped', detail: reason })
      return { ...last, output: stripExternalCliContinuationEnvelope(last.output), iterations: iteration, orchestrationStopReason: reason }
    }
    const signature = continuationSignature(selection.item)
    repeated = signature === priorSignature ? repeated + 1 : 0
    priorSignature = signature
    if (repeated >= 2) {
      const reason = `續行項目「${selection.item.title}」連續沒有更新，已停止避免無限迴圈。`
      input.onIteration?.({ iteration, phase: 'stopped', detail: reason })
      return { ...last, output: stripExternalCliContinuationEnvelope(last.output), iterations: iteration, orchestrationStopReason: reason }
    }
    if (iteration >= limit) {
      const reason = `已達外部 CLI iteration 上限 ${limit}。`
      input.onIteration?.({ iteration, phase: 'stopped', detail: reason })
      return { ...last, output: stripExternalCliContinuationEnvelope(last.output), iterations: iteration, orchestrationStopReason: reason }
    }
    item = selection.item
    priorOutput = last.output
    phase = 'build'
    input.onIteration?.({ iteration, phase: 'continued', detail: item.title })
  }

  if (!last) throw new Error('External CLI orchestration did not start')
  return { ...last, output: stripExternalCliContinuationEnvelope(last.output), iterations: limit }
}

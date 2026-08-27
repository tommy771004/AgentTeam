import type { ApprovalMode } from './types.ts'
import type { ExternalRunOpts } from './taskRunTypes.ts'

export type ComposerApprovalHandoff = {
  readonly id: number
  readonly threadId: string
  readonly mode: ApprovalMode
  consumed: boolean
}

const pendingByThread = new Map<string, ComposerApprovalHandoff[]>()
let nextId = 1

/**
 * Bridge the composer-only, one-run selection across the existing slash
 * command adapter without turning it into a second task-run coordinator.
 */
export function beginComposerApprovalHandoff(
  threadId: string,
  mode: ApprovalMode,
): ComposerApprovalHandoff {
  const handoff = { id: nextId++, threadId, mode, consumed: false }
  const queue = pendingByThread.get(threadId) || []
  pendingByThread.set(threadId, [...queue, handoff])
  return handoff
}

/** Called once at the canonical runTask seam, before capacity/queue admission. */
export function applyComposerApprovalHandoff(input: ExternalRunOpts): ExternalRunOpts {
  if (input.sourceKind !== 'slash' || !input.reuseThreadId) return input
  const queue = pendingByThread.get(input.reuseThreadId)
  const handoff = queue?.shift()
  if (!handoff) return input
  handoff.consumed = true
  if (queue?.length) pendingByThread.set(input.reuseThreadId, queue)
  else pendingByThread.delete(input.reuseThreadId)
  return {
    ...input,
    overrides: { ...(input.overrides || {}), approvalMode: handoff.mode },
  }
}

/** Release an unused non-task slash selection and report whether runTask claimed it. */
export function finishComposerApprovalHandoff(handoff: ComposerApprovalHandoff): boolean {
  if (handoff.consumed) return true
  const queue = pendingByThread.get(handoff.threadId) || []
  const remaining = queue.filter((candidate) => candidate.id !== handoff.id)
  if (remaining.length) pendingByThread.set(handoff.threadId, remaining)
  else pendingByThread.delete(handoff.threadId)
  return false
}

export function resetComposerApprovalHandoffsForTests(): void {
  pendingByThread.clear()
  nextId = 1
}

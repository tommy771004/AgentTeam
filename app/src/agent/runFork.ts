/**
 * Replay-safe fork selection.
 *
 * A fork never replays a prior tool call or side effect. The only admissible
 * checkpoint is a persisted user bubble; the new coordinator run receives that
 * text as a fresh objective and starts with clean capability/DoD state.
 */
import type { ChatAttachment } from './types.ts'
import type { Thread } from '../store/threadStore.ts'

export type ReplaySafeCheckpoint = {
  bubbleId: string
  objective: string
  at: string
  /** 1-based position among this thread's replay-safe points — the "step N". */
  stepIndex: number
  attachments?: ChatAttachment[]
}

/** The single admissibility rule — every caller must go through it. */
export function isReplaySafeBubble(bubble: Thread['bubbles'][number] | undefined): boolean {
  return Boolean(bubble && bubble.role === 'user' && bubble.content.trim())
}

function toCheckpoint(
  bubble: Thread['bubbles'][number],
  stepIndex: number,
): ReplaySafeCheckpoint {
  return {
    bubbleId: bubble.id,
    objective: bubble.content.trim().slice(0, 32_000),
    at: bubble.at,
    stepIndex,
    attachments: bubble.attachments?.map((attachment) => ({ ...attachment })),
  }
}

/**
 * Every point in this thread a fork may start from, oldest first. Tool results
 * and side effects are never admissible, so the list is exactly the persisted
 * user turns (ADR-0042).
 */
export function listReplaySafeCheckpoints(thread: Thread): ReplaySafeCheckpoint[] {
  const checkpoints: ReplaySafeCheckpoint[] = []
  for (const bubble of thread.bubbles) {
    if (isReplaySafeBubble(bubble)) checkpoints.push(toCheckpoint(bubble, checkpoints.length + 1))
  }
  return checkpoints
}

/**
 * Resolve one fork point. Without `bubbleId` the latest checkpoint is used;
 * with one, a non-replay-safe id is refused rather than silently adjusted.
 */
export function findReplaySafeCheckpoint(
  thread: Thread,
  bubbleId?: string,
): ReplaySafeCheckpoint | null {
  const checkpoints = listReplaySafeCheckpoints(thread)
  if (!bubbleId) return checkpoints.at(-1) || null
  return checkpoints.find((checkpoint) => checkpoint.bubbleId === bubbleId) || null
}

/** Index of the fork point in the source bubble list, or -1 when inadmissible. */
export function replaySafeCheckpointIndex(thread: Thread, bubbleId: string): number {
  const index = thread.bubbles.findIndex((bubble) => bubble.id === bubbleId)
  return index >= 0 && isReplaySafeBubble(thread.bubbles[index]) ? index : -1
}


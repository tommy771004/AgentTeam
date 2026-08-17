/**
 * Replay-safe fork selection.
 *
 * A fork never replays a prior tool call or side effect. The only admissible
 * checkpoint is a persisted user bubble; the new coordinator run receives that
 * text as a fresh objective and starts with clean capability/DoD state.
 */
import type { ChatAttachment } from './types'
import type { Thread } from '../store/threadStore'

export type ReplaySafeCheckpoint = {
  bubbleId: string
  objective: string
  at: string
  attachments?: ChatAttachment[]
}

export function findReplaySafeCheckpoint(
  thread: Thread,
  bubbleId?: string,
): ReplaySafeCheckpoint | null {
  const candidate = bubbleId
    ? thread.bubbles.find((bubble) => bubble.id === bubbleId)
    : [...thread.bubbles].reverse().find((bubble) => bubble.role === 'user')
  if (!candidate || candidate.role !== 'user' || !candidate.content.trim()) return null
  return {
    bubbleId: candidate.id,
    objective: candidate.content.trim().slice(0, 32_000),
    at: candidate.at,
    attachments: candidate.attachments?.map((attachment) => ({ ...attachment })),
  }
}


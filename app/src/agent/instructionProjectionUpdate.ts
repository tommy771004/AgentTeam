import {
  acceptInstructionProjection,
  beginInstructionProjectionRequest,
  type InstructionProjectionCursor,
  observeInstructionRevision,
} from './instructionProjectionCursor.ts'

/** Host projection resolver owned by the Personalization renderer boundary. */
export type InstructionProjectionResolver<T extends { revision: number }> = () => Promise<T>

/**
 * One production request lifecycle: begin a sequence, await Host, then accept
 * only if the response is still current and has caught up with Host events.
 */
export async function requestInstructionProjection<T extends { revision: number }>(
  cursor: InstructionProjectionCursor,
  resolve: InstructionProjectionResolver<T>,
): Promise<{ accepted: boolean; snapshot: T }> {
  const request = beginInstructionProjectionRequest(cursor)
  const snapshot = await resolve()
  return {
    accepted: acceptInstructionProjection(cursor, request, snapshot.revision),
    snapshot,
  }
}

/** Observe a Host invalidation and let the owner schedule its next resolve. */
export function observeInstructionProjectionEvent(
  cursor: InstructionProjectionCursor,
  revision: number,
  refresh: () => void,
): boolean {
  if (!observeInstructionRevision(cursor, revision)) return false
  refresh()
  return true
}

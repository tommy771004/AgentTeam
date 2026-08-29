export type InstructionProjectionRequest = Readonly<{
  sequence: number
}>

/**
 * Renderer-side after-cursor gate for Host instruction projections.
 *
 * The object is deliberately mutable so a React ref can own it without
 * causing render loops. Host revisions are monotonic; request sequence is
 * local and only prevents an older in-flight response from winning a race.
 */
export type InstructionProjectionCursor = {
  latestRequestSequence: number
  requiredRevision: number
  appliedRevision: number
}

export function createInstructionProjectionCursor(): InstructionProjectionCursor {
  return { latestRequestSequence: 0, requiredRevision: 0, appliedRevision: 0 }
}

export function beginInstructionProjectionRequest(
  cursor: InstructionProjectionCursor,
): InstructionProjectionRequest {
  cursor.latestRequestSequence += 1
  return Object.freeze({ sequence: cursor.latestRequestSequence })
}

/** Returns true only for a new monotonic Host event. */
export function observeInstructionRevision(
  cursor: InstructionProjectionCursor,
  revision: number,
): boolean {
  if (!Number.isSafeInteger(revision) || revision <= cursor.requiredRevision) return false
  cursor.requiredRevision = revision
  return true
}

/**
 * Apply only the latest request and only after it has caught up with every
 * Host revision event observed before the response arrived.
 */
export function acceptInstructionProjection(
  cursor: InstructionProjectionCursor,
  request: InstructionProjectionRequest,
  responseRevision: number,
): boolean {
  if (!Number.isSafeInteger(responseRevision)) return false
  if (request.sequence !== cursor.latestRequestSequence) return false
  if (responseRevision < cursor.requiredRevision || responseRevision < cursor.appliedRevision) return false
  cursor.appliedRevision = responseRevision
  return true
}

/** Invalidate in-flight responses when the selected project authority changes. */
export function invalidateInstructionProjection(cursor: InstructionProjectionCursor): void {
  cursor.latestRequestSequence += 1
  cursor.appliedRevision = 0
}

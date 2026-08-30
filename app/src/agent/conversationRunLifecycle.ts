/**
 * Locate the recorded summary that owns terminal-only continuation controls.
 *
 * The conversation may already contain a later user bubble while its next run
 * is queued or still being admitted. Returning the owning bubble id lets the
 * renderer keep old controls in historical order instead of appending them to
 * the live conversation tail.
 */
export function continuationAnchorBubbleId(
  bubbles: ReadonlyArray<{
    id: string
    role: string
    runSummary?: { runId?: string } | null
  }>,
  runId?: string | null,
): string | null {
  if (!runId) return null
  for (let index = bubbles.length - 1; index >= 0; index -= 1) {
    const bubble = bubbles[index]
    if (bubble?.role === 'run' && bubble.runSummary?.runId === runId) return bubble.id
  }
  return null
}

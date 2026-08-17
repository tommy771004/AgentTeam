/**
 * Loop Runner state — the plain, publishable state a Loop run mutates.
 *
 * LoopRunState is AgentState: the domain concept doesn't get a second shape,
 * just a home inside agent/loop/ (Loop Runner deepening, ticket 02).
 *
 * Publish contract:
 * - The loop may call `deps.publish(state)` with the **live** mutable object
 *   for efficiency during tight step loops.
 * - Production adapters **must** clone before storing or fan-out (use
 *   `snapshot(state)`). Smokes that assert isolation should clone on publish.
 */
import type { AgentState } from '../types.ts'

export type LoopRunState = AgentState

/** Structural clone for the publish seam — adapters use this so UI never holds a live mutator ref. */
export function snapshot(state: LoopRunState): LoopRunState {
  return structuredClone(state)
}

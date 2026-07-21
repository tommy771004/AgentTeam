/**
 * Loop Runner state — the plain, publishable state a Loop run mutates.
 *
 * LoopRunState is AgentState: the domain concept doesn't get a second shape,
 * just a home inside agent/loop/ (Loop Runner deepening, ticket 02). The
 * Loop Runner's only side-effect outlet is `deps.publish(snapshot(state))`.
 */
import type { AgentState } from '../types'

export type LoopRunState = AgentState

/** Structural clone for the publish seam — callers never see a live-mutated reference. */
export function snapshot(state: LoopRunState): LoopRunState {
  return structuredClone(state)
}

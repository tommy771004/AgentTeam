/**
 * ContextEngine — Hermes-style pluggable context management seam.
 *
 * Default adapter wraps createContextGovernor. Tests inject fakes.
 *
 * Hermes-oriented compress discipline (enforced by default adapter + helpers):
 * - preflight compress when over threshold (governor / tokenEstimate)
 * - protect last N turns (compaction config)
 * - flush durable memory BEFORE lossy compress when flushBeforeCompress set
 * - do not split tool_call / tool result pairs (see assertToolPairsAdjacent)
 */
import type { LlmSettings } from './types'
import {
  createContextGovernor,
  type ContextGovernor,
  type ContextGovernorDeps,
  type GovernorMessage,
  type BeforeRoundInput,
} from './tools/contextGovernor.ts'

export type ContextEnginePrepareInput = BeforeRoundInput

export type ContextEngine = {
  /** Before each tool-round API call — may compress / swap messages. */
  prepareRound: (input: ContextEnginePrepareInput) => Promise<GovernorMessage[]>
  /** Optional: flush durable memory before lossy compress (Hermes order). */
  flushBeforeCompress?: () => Promise<void>
}

export function createDefaultContextEngine(
  deps: ContextGovernorDeps,
  opts?: { flushBeforeCompress?: () => Promise<void> },
): ContextEngine {
  const governor: ContextGovernor = createContextGovernor(deps)
  return {
    flushBeforeCompress: opts?.flushBeforeCompress,
    async prepareRound(input) {
      if (opts?.flushBeforeCompress) {
        try {
          await opts.flushBeforeCompress()
        } catch {
          /* non-fatal */
        }
      }
      return governor.beforeRound(input)
    },
  }
}

/** Cheap smoke guard: tool messages should not appear without any assistant. */
export function toolPairsIntact(messages: Array<{ role: string }>): boolean {
  let tools = 0
  let assistants = 0
  for (const m of messages) {
    if (m.role === 'assistant') assistants++
    if (m.role === 'tool') tools++
  }
  return tools === 0 || assistants > 0
}

/**
 * Hermes pair integrity: every tool message should follow an assistant
 * (possibly with other tools in between from the same turn).
 */
export function assertToolPairsAdjacent(
  messages: Array<{ role: string; tool_call_id?: string }>,
): boolean {
  if (!toolPairsIntact(messages)) return false
  let sawAssistant = false
  for (const m of messages) {
    if (m.role === 'assistant') sawAssistant = true
    if (m.role === 'tool' && !sawAssistant) return false
    if (m.role === 'user') sawAssistant = false
  }
  return true
}

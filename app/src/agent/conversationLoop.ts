/**
 * Single conversation / Loop run facade (Hermes run_conversation alignment).
 *
 * P3: Prefer this module as the orchestration *story*. Engine still owns Loop
 * Pattern runners; stepStrategies are implementation details behind engine —
 * not a second public product seam for UI.
 *
 * Entry for product code remains taskRunCoordinator.runTask → dispatch → engine.
 */
export { agentEngine } from './engine.ts'

/** Documented single path: Task run admission is the only product ingress. */
export const CONVERSATION_LOOP_INGRESS = 'taskRunCoordinator.runTask' as const

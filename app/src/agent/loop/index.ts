/**
 * Loop Runner（迴圈執行器）— the only product-facing export of agent/loop/.
 * See CONTEXT.md「Loop Runner（迴圈執行器）」. engine.ts is the sole production adapter.
 */
export { runLoop, type LoopRequest, type LoopDeps, type LoopResult } from './loopRunner.ts'

import type { LoopType, RunContextPolicy } from './types.ts'
import type { TurnRecord } from './turnRecord.ts'
import { clampPiIterations } from './loopBounds.ts'
import type { SubDesignPluginExecutionProjection, SubDesignPluginExecutionRequest } from './subdesign/pluginExecution.ts'

export type PiHostRunConfigInput = {
  forceLoopType?: LoopType
  maxIterations?: number
}

export type PiHostRunConfig = {
  loopType: LoopType
  maxIterations: number
  definitionOfDone: string
}

/** Why a turn stopped short of its own settlement (Pi Host `turn/interrupt`). */
export type PiTurnInterruptReason = 'user' | 'timeout'

/**
 * How a Pi turn ended, as a closed union.
 *
 * `success` used to mean two different things — the provider call worked, and
 * the user got an answer — so a turn that returned no text at all reached the
 * archive as a completed run. Splitting `answered` from `empty` makes the
 * difference unrepresentable-by-accident: every consumer switches on this
 * union and the switch does not compile until all five are handled.
 */
export const PI_TURN_SETTLEMENTS = ['answered', 'empty', 'truncated', 'interrupted', 'failed', 'cancelled'] as const

export type PiTurnSettlement = (typeof PI_TURN_SETTLEMENTS)[number]

export function isPiTurnSettlement(value: unknown): value is PiTurnSettlement {
  return typeof value === 'string' && (PI_TURN_SETTLEMENTS as readonly string[]).includes(value)
}

/** The union is closed: an unrecognised settlement is a bug, never a default. */
function unreachableSettlement(value: never): never {
  throw new Error(`Unknown Pi turn settlement: ${String(value)}`)
}

/**
 * Which of the two model-reachable settlements a completed turn earned.
 *
 * A provider call that finished cleanly but carried no assistant text is
 * `empty`, not `answered` — the run produced nothing for the user to read.
 * A call the provider cut off mid-generation (`stopReason: 'length'`) is
 * `truncated`, not `empty`: retrying an identical prompt hits the identical
 * budget wall, so a truncated turn is terminal in a way emptiness is not.
 */
export function classifyPiTurnSettlement(items: unknown[], stopReason?: string): 'answered' | 'empty' | 'truncated' {
  if (piTurnFinalAnswer(items)) return 'answered'
  return stopReason === 'length' ? 'truncated' : 'empty'
}

/** The human-readable verdict a truncated turn reports, with the knob that fixes it. */
export const PI_TURN_TRUNCATED_NOTICE =
  '模型的輸出在完成前被 maxTokens 上限截斷（思考或長文吃光了輸出預算），這次沒有產出可保留。' +
  '調高此模型的 maxTokens、降低 thinking 等級，或把任務拆小後再試。'

/**
 * The provider's finish reason on the turn's last assistant message.
 *
 * Pi records it on the message, so this reads the record instead of guessing
 * from absent content — one reading shared by every truncation consumer, so
 * two paths can never classify the same turn differently.
 */
export function piTurnStopReason(
  messages: ReadonlyArray<{ role?: string; stopReason?: string }>,
): string | undefined {
  return [...messages].reverse().find((message) => message?.role === 'assistant')?.stopReason
}

/**
 * Whether the turn's final assistant message was cut off by the output cap.
 *
 * A genuinely silent model (`stopReason: 'stop'`, no text) must not be misfiled
 * as truncated.
 */
export function isLengthTruncatedTurn(
  messages: ReadonlyArray<{ role?: string; stopReason?: string }>,
): boolean {
  return piTurnStopReason(messages) === 'length'
}

/**
 * A provider failure Pi surfaced in-band instead of throwing.
 *
 * A rejected request comes back as an assistant message with no content and
 * `stopReason: 'error'`, so a turn that never reached the model at all would
 * otherwise settle as a clean turn that simply said nothing. The failure text
 * is what the user needs to see, so it is returned rather than just detected.
 */
export function piTurnProviderError(
  messages: ReadonlyArray<{ role?: string; stopReason?: string; errorMessage?: string }>,
): string | undefined {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index]
    if (message?.role !== 'assistant' || message.stopReason !== 'error') continue
    return message.errorMessage?.trim() || 'Pi provider request failed'
  }
  return undefined
}

/**
 * What one settled turn means on every surface that reports it.
 *
 * Deliberately not called a projection: CONTEXT.md reserves **UI Projection**
 * for the renderer's disposable view of Host state, and this is a pure reading
 * of one settlement. `status` is the run status vocabulary (`AgentState`), not
 * the settlement — an answered turn is a successful run, an empty one is not.
 */
export type PiTurnOutcome = {
  status: 'success' | 'failed' | 'halted'
  text: string
  confidence: number
  logLevel: 'SUCCESS' | 'HALT' | 'ERROR'
  stepStatus: 'COMPLETED' | 'SKIPPED' | 'FAILED'
  interruptReason?: PiTurnInterruptReason
}

export type PiTurnOutcomeInput = {
  /** The settled answer derived from the turn's items. */
  answer: string
  interruptReason?: PiTurnInterruptReason
}

/**
 * The one reading every surface reports a settled turn through.
 *
 * The answer comes from the Host's own items and nothing else: ADR-0039 makes
 * Host state canonical, so the renderer's feed cache never decides whether a
 * turn produced something. A turn whose items carry no text IS empty, and
 * saying so is the whole point of the union.
 */
export function piTurnOutcome(
  settlement: PiTurnSettlement,
  input: PiTurnOutcomeInput,
): PiTurnOutcome {
  const answer = input.answer?.trim() ? input.answer : ''
  switch (settlement) {
    case 'answered':
      return { status: 'success', text: answer, confidence: 0.9, logLevel: 'SUCCESS', stepStatus: 'COMPLETED' }
    case 'empty':
      return {
        status: 'failed',
        text: '模型沒有產出任何內容，這次沒有結果可看（可重試）。',
        confidence: 0.2,
        logLevel: 'ERROR',
        stepStatus: 'FAILED',
      }
    case 'truncated':
      // A budget wall is not retryable with the same inputs, so this reads as
      // a failure with the knob that fixes it, not as a blank.
      return {
        status: 'failed',
        text: PI_TURN_TRUNCATED_NOTICE,
        confidence: 0.2,
        logLevel: 'ERROR',
        stepStatus: 'FAILED',
      }
    case 'interrupted': {
      const reason = input.interruptReason || 'user'
      return {
        status: 'halted',
        text:
          answer
          || (reason === 'timeout'
            ? '任務已逾時中止，沒有產出可保留的部分回覆。'
            : '任務已中止，沒有產出可保留的部分回覆。'),
        confidence: 0.3,
        logLevel: 'HALT',
        stepStatus: 'SKIPPED',
        interruptReason: reason,
      }
    }
    case 'failed':
      return { status: 'failed', text: answer || 'Pi Core 執行失敗。', confidence: 0.3, logLevel: 'ERROR', stepStatus: 'FAILED' }
    case 'cancelled':
      return { status: 'halted', text: answer || '任務已取消。', confidence: 0.3, logLevel: 'HALT', stepStatus: 'SKIPPED' }
    default:
      return unreachableSettlement(settlement)
  }
}

/**
 * Whether a settlement completed a model call, and so may continue a goal.
 *
 * A `switch` rather than a comparison so a sixth settlement cannot be added
 * without deciding, here, whether the loop may continue on it.
 */
export function isCompletedModelCall(settlement: PiTurnSettlement): boolean {
  switch (settlement) {
    case 'answered':
    case 'empty':
      return true
    // A truncated call did reach the model, but its wall is deterministic:
    // the goal loop must not spend remaining iterations on the same prompt.
    case 'truncated':
    case 'interrupted':
    case 'failed':
    case 'cancelled':
      return false
    default:
      return unreachableSettlement(settlement)
  }
}

/** The renderer's default DoD is the Host settlement, not response text. */
export const PI_CORE_SETTLEMENT_DEFINITION_OF_DONE = 'Pi Core settlement returned'

export function isPiHostDefinitionOfDoneMet(
  definitionOfDone: string | undefined,
  settlement: PiTurnSettlement,
  assistantContent?: string,
): boolean | undefined {
  if (!definitionOfDone) return undefined
  if (definitionOfDone === PI_CORE_SETTLEMENT_DEFINITION_OF_DONE) {
    // Only an answered turn met a settlement-shaped DoD: an empty turn
    // settled without producing the thing the DoD asks for.
    return settlement === 'answered'
  }
  return Boolean(assistantContent?.trim())
}

/** Keep the renderer cutover's loop defaults aligned with the builtin parser. */
export function buildPiHostRunConfig(input: PiHostRunConfigInput = {}): PiHostRunConfig {
  const loopType = input.forceLoopType || 'Goal-based'
  const fallbackIterations = loopType === 'Goal-based' ? 5 : 1
  const requestedIterations = typeof input.maxIterations === 'number' && Number.isFinite(input.maxIterations)
    ? Math.floor(input.maxIterations)
    : fallbackIterations
  return {
    loopType,
    // Shared ceiling with the Host's turn admission (loopBounds.ts) — both
    // sides must clamp identically or a requested budget silently diverges.
    maxIterations: clampPiIterations(requestedIterations),
    definitionOfDone: PI_CORE_SETTLEMENT_DEFINITION_OF_DONE,
  }
}

export type PiHostSession = {
  id: string
  title: string
  threadId?: string
  archived?: boolean
}

export type PiTurnContextPolicy = RunContextPolicy

export type PiHostRunnerApi = {
  sessions: {
    list: () => Promise<{ sessions: unknown[] }>
    create: (title?: string, threadId?: string) => Promise<{ sessionId: string; sessions: unknown[] }>
    createChild?: (input: { title?: string; parentSessionId: string; role: string; profile: Record<string, unknown>; context: { objective: string; facts: string[]; constraints: string[] }; depth: number }) => Promise<{ sessionId: string; sessions: unknown[] }>
  }
  turn: {
    submit: (input: { sessionId: string; prompt: string; runId?: string; cwd?: string; profile?: Record<string, unknown>; contextPolicy?: PiTurnContextPolicy; pattern?: 'Turn-based' | 'Goal-based' | 'Time-based' | 'Proactive'; maxIterations?: number; definitionOfDone?: string; timeoutMs?: number; mode?: 'steer' | 'queue'; queue?: boolean; pluginExecution?: SubDesignPluginExecutionRequest }) => Promise<{
      sessionId: string
      runId: string
      settlement: string
      items?: unknown[]
      record?: TurnRecord
      interruptReason?: PiTurnInterruptReason
      orchestration?: { pattern: string; iterations: number; maxIterations: number; definitionOfDone?: string; dodMet?: boolean }
      pluginExecution?: SubDesignPluginExecutionProjection
    }>
  }
}

export type SubmitPiHostRunInput = {
  threadId: string
  title: string
  prompt: string
  runId: string
  cwd?: string
  profile?: Record<string, unknown>
  contextPolicy?: PiTurnContextPolicy
  child?: { role: string; profile: Record<string, unknown>; context: { objective: string; facts: string[]; constraints: string[] }; depth: number }
  pattern?: 'Turn-based' | 'Goal-based' | 'Time-based' | 'Proactive'
  maxIterations?: number
  definitionOfDone?: string
  /** Per-turn deadline decided at admission; absent means the Host arms none. */
  timeoutMs?: number
  pluginExecution?: SubDesignPluginExecutionRequest
}

export type SubmitPiHostRunResult = {
  sessionId: string
  runId: string
  settlement: PiTurnSettlement
  /** Present only on `interrupted`; distinguishes a user stop from a timeout. */
  interruptReason?: PiTurnInterruptReason
  result: string
  items: unknown[]
  /** What this turn appended to the session's Turn Record. */
  record?: TurnRecord
  orchestration?: { pattern: string; iterations: number; maxIterations: number; definitionOfDone?: string; dodMet?: boolean }
  pluginExecution?: SubDesignPluginExecutionProjection
}

function asSession(value: unknown): PiHostSession | undefined {
  if (!value || typeof value !== 'object') return undefined
  const item = value as Record<string, unknown>
  if (typeof item.id !== 'string' || typeof item.title !== 'string') return undefined
  return {
    id: item.id,
    title: item.title,
    threadId: typeof item.threadId === 'string' ? item.threadId : undefined,
    archived: item.archived === true,
  }
}

/** The session a thread's runs submit to: the FIRST non-archived binding.
 * One owner for that choice — submission (submitPiHostRun) and any surface
 * reading a run's record back must resolve the same id or the two disagree. */
export function pickThreadPiSession(sessions: readonly unknown[], threadId: string): PiHostSession | undefined {
  return sessions
    .map(asSession)
    .find((session) => session?.threadId === threadId && !session.archived)
}

/**
 * The answer a turn settles on is its LAST assistant message, never its first.
 *
 * A tool-using turn narrates before it works（「我先探索本地專案結構…」）and only
 * concludes after the tools return, so reading the first assistant message
 * publishes the preamble and eats the conclusion. The narration in between is
 * not lost: it already reaches the UI as `host/turn-item` events.
 *
 * When no assistant message carries text — the final message holds only
 * thinking/toolCall blocks, or message items were never projected — the
 * streamed `text_delta` content is what the user already watched arrive in
 * the feed, so the answer is rebuilt from it instead of collapsing to ''.
 */
/**
 * Item types that end one assistant message.
 *
 * Streamed deltas belong to the message that produced them: a tool call, an
 * explicit message boundary, or a completed message all close the message
 * before them. Without this, a stopped turn's opening narration welds onto the
 * half-sentence the model was writing when it was stopped.
 */
const PI_MESSAGE_BOUNDARY_ITEMS = new Set(['message_start', 'tool_execution_start', 'assistant_message'])

export function piTurnFinalAnswer(items: unknown[]): string {
  const records = items.filter((item): item is Record<string, unknown> => Boolean(item && typeof item === 'object'))
  const texts = records
    .filter((item) => item.type === 'assistant_message')
    .map((item) => (typeof item.content === 'string' ? item.content.trim() : ''))
    .filter((text) => text.length > 0)
  if (texts.length > 0) return texts[texts.length - 1]
  // No assistant message carried usable text, so rebuild from what the user
  // actually watched stream in — one message at a time, last message wins.
  const segments: string[] = ['']
  for (const item of records) {
    if (typeof item.type === 'string' && PI_MESSAGE_BOUNDARY_ITEMS.has(item.type)) {
      segments.push('')
      continue
    }
    const event = item.assistantMessageEvent
    if (!event || typeof event !== 'object') continue
    const streamed = event as Record<string, unknown>
    if (streamed.type !== 'text_delta' || typeof streamed.delta !== 'string') continue
    segments[segments.length - 1] += streamed.delta
  }
  const written = segments.map((segment) => segment.trim()).filter((segment) => segment.length > 0)
  return written[written.length - 1] || ''
}

/**
 * The text a settled turn reports, derived per settlement.
 *
 * A `switch` rather than one join for all of them: a stopped turn reports the
 * message it was writing, while a failed one reports the error its items
 * carry. Joining every item was how a stop returned narration welded to a
 * half-sentence.
 */
export function piTurnResultText(settlement: PiTurnSettlement, items: unknown[]): string {
  switch (settlement) {
    case 'answered':
    case 'empty':
    case 'interrupted':
      return piTurnFinalAnswer(items)
    case 'truncated':
      return PI_TURN_TRUNCATED_NOTICE
    case 'failed':
    case 'cancelled':
      return items
        .filter((item): item is Record<string, unknown> => Boolean(item && typeof item === 'object'))
        .map((item) => (typeof item.content === 'string' ? item.content : ''))
        .filter((content) => content.trim().length > 0)
        .join('\n')
    default:
      return unreachableSettlement(settlement)
  }
}

/**
 * Electron-only runner seam. The renderer never owns Pi history: it only
 * resolves the durable Host session bound to the conversation thread and
 * submits one turn through the Host Protocol.
 */
export async function submitPiHostRun(
  api: PiHostRunnerApi,
  input: SubmitPiHostRunInput,
): Promise<SubmitPiHostRunResult> {
  const listed = await api.sessions.list()
  const existing = pickThreadPiSession(listed.sessions || [], input.threadId)
  const parentSessionId = existing?.id || (await api.sessions.create(input.title, input.threadId)).sessionId
  const sessionId = input.child && api.sessions.createChild
    ? (await api.sessions.createChild({ title: input.title, parentSessionId, ...input.child })).sessionId
    : parentSessionId
  const turn = await api.turn.submit({
    sessionId,
    prompt: input.prompt,
    runId: input.runId,
    cwd: input.cwd,
    profile: input.profile,
    contextPolicy: input.contextPolicy,
    pattern: input.pattern,
    maxIterations: input.maxIterations,
    definitionOfDone: input.definitionOfDone,
    timeoutMs: input.timeoutMs,
    pluginExecution: input.pluginExecution,
  })
  const items = Array.isArray(turn.items) ? turn.items : []
  return {
    sessionId,
    runId: turn.runId || input.runId,
    settlement: isPiTurnSettlement(turn.settlement) ? turn.settlement : 'failed',
    ...(turn.interruptReason === 'user' || turn.interruptReason === 'timeout'
      ? { interruptReason: turn.interruptReason }
      : {}),
    result: piTurnFinalAnswer(items),
    items,
    ...(turn.record ? { record: turn.record } : {}),
    orchestration: turn.orchestration,
    pluginExecution: turn.pluginExecution,
  }
}

import type { LoopType, RunContextPolicy } from './types.ts'
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

/** The renderer's default DoD is the Host settlement, not response text. */
export const PI_CORE_SETTLEMENT_DEFINITION_OF_DONE = 'Pi Core settlement returned'

export function isPiHostDefinitionOfDoneMet(
  definitionOfDone: string | undefined,
  settlement: 'success' | 'failed' | 'cancelled' | 'interrupted',
  assistantContent?: string,
): boolean | undefined {
  if (!definitionOfDone) return undefined
  if (definitionOfDone === PI_CORE_SETTLEMENT_DEFINITION_OF_DONE) {
    return settlement === 'success'
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
    maxIterations: Math.max(1, Math.min(8, requestedIterations)),
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
    submit: (input: { sessionId: string; prompt: string; runId?: string; cwd?: string; profile?: Record<string, unknown>; contextPolicy?: PiTurnContextPolicy; pattern?: 'Turn-based' | 'Goal-based' | 'Time-based' | 'Proactive'; maxIterations?: number; definitionOfDone?: string; mode?: 'steer' | 'queue'; queue?: boolean; pluginExecution?: SubDesignPluginExecutionRequest }) => Promise<{
      sessionId: string
      runId: string
      settlement: string
      items?: unknown[]
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
  pluginExecution?: SubDesignPluginExecutionRequest
}

export type SubmitPiHostRunResult = {
  sessionId: string
  runId: string
  settlement: 'success' | 'failed' | 'cancelled' | 'interrupted'
  result: string
  items: unknown[]
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

function assistantText(items: unknown[]): string {
  return items
    .filter((item): item is Record<string, unknown> => Boolean(item && typeof item === 'object'))
    .filter((item) => item.type === 'assistant_message')
    .map((item) => (typeof item.content === 'string' ? item.content : ''))
    .join('\n')
    .trim()
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
  const existing = (listed.sessions || [])
    .map(asSession)
    .find((session) => session?.threadId === input.threadId && !session.archived)
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
    pluginExecution: input.pluginExecution,
  })
  const items = Array.isArray(turn.items) ? turn.items : []
  return {
    sessionId,
    runId: turn.runId || input.runId,
    settlement: (['success', 'failed', 'cancelled', 'interrupted'].includes(turn.settlement)
      ? turn.settlement
      : 'failed') as SubmitPiHostRunResult['settlement'],
    result: assistantText(items),
    items,
    orchestration: turn.orchestration,
    pluginExecution: turn.pluginExecution,
  }
}

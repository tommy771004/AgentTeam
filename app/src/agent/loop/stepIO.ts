/**
 * Step I/O seam — shared shape + pure helpers for FC / heuristic / simulation.
 *
 * Relocated verbatim from ../stepExecutor.ts (Loop Runner deepening, ticket 02).
 * Kept as its own leaf file (no dependency on strategies.ts or stepRun.ts) so the
 * acyclic shape survives: strategies.ts depends on this file; stepRun.ts depends
 * on this file and on strategies.ts. Neither of those two depends back on the other.
 *
 * Strategies share input/output shape only; internal loop shapes stay different
 * (FC multi-round vs heuristic single pass vs simulation no tools).
 *
 * Gated tool authorize→execute→truncate→record→afterTool lives in
 * tools/toolInvocation.invokeGatedTool (heuristic wires it; FC later).
 */
import type {
  LlmSettings,
  PermissionPolicy,
  PermissionProjection,
  ToolCallRecord,
} from '../types'
import type { AssembleOpts } from '../capabilities/runtime.ts'

export type StepExecutorInput = {
  role: string
  objective: string
  step: string
  stepOutputs: string[]
  userAttachments?: import('../types').ChatAttachment[]
  settings: LlmSettings
  overrides: {
    projectRoot?: string
    permissionPolicy?: PermissionPolicy
    permissionProjection?: PermissionProjection
    mcpAgentId?: string
    agentMode?: string
    blockedTools?: string[]
    attachedSkills?: string[]
    preloadCapabilityIds?: string[]
    preloadUnlockedTools?: string[]
    unattended?: boolean
    hitlTimeoutMs?: number
    sourceKind?: string
    runId?: string
    threadId?: string
      temporary?: boolean
    /** When false, strategies must not call the LLM even if settings.enabled */
    useLlm?: boolean
  }
  loadedCapabilityIds?: string[]
  unlockedToolNames?: string[]
  temporaryChatDefault?: boolean
  projectGuidance?: string
  sessionRecallBlock?: string
  attachedSkillContext?: string
  /** Role for leaf isolation of delegate_task */
  agentName?: string
  subAgentsEnabled?: boolean
}

export type StepExecutorOutput = {
  output: string
  toolContext: string
  tokensUsed: number
  loadedCapabilityIds: string[]
  unlockedToolNames: string[]
  rounds?: number
  toolCalls: ToolCallRecord[]
  /**
   * Heuristic → orchestrator handoff.
   * When true, engine must run the simulation strategy (tools-only / no LLM).
   * Must NOT be inferred from empty `output` — LLM may legitimately return "".
   */
  needsSimulation?: boolean
}

export type StepExecutor = {
  execute: (input: StepExecutorInput) => Promise<StepExecutorOutput>
}

/**
 * Orchestrator decision after heuristic strategy returns.
 * Pure — the bug was overloading empty `output` as "needs simulation".
 */
export function resolveHeuristicStepOutcome(result: {
  output: string
  needsSimulation?: boolean
}): 'use-output' | 'simulate' {
  // CORRECT contract: only the explicit flag requests simulation.
  // (Pre-bug: `if (!result.output) simulate` — see smoke-step-executor regression.)
  if (result.needsSimulation === true) return 'simulate'
  return 'use-output'
}

/** Shared capability/preload/blocked-tools assembly for FC + heuristic. */
export function buildStepCapabilityPreload(input: {
  settings: LlmSettings
  overrides: StepExecutorInput['overrides']
  loadedCapabilityIds?: string[]
  unlockedToolNames?: string[]
  agentName?: string
  role?: string
  projectRoot?: string
  entitlement?: import('../entitlement').EntitlementSnapshot
}): AssembleOpts {
  const { settings, overrides, loadedCapabilityIds, unlockedToolNames, agentName, role } =
    input
  return {
    progressive: settings.capabilitiesEnabled !== false,
    preloadIds: [
      ...(overrides.attachedSkills || []).map((n) => `skill:${n}`),
      ...(overrides.preloadCapabilityIds || []),
      ...(loadedCapabilityIds || []),
    ],
    preloadUnlockedTools: [
      ...(overrides.preloadUnlockedTools || []),
      ...(unlockedToolNames || []),
    ],
    webSearchEnabled: settings.webSearchEnabled !== false,
    projectRoot: input.projectRoot || overrides.projectRoot || '',
    agentId: overrides.mcpAgentId || overrides.agentMode || 'build',
    blockedTools: [
      ...(overrides.blockedTools || []),
      ...(agentName === 'Core' || role === 'executor' ? ['delegate_task'] : []),
    ],
    ...(input.entitlement ? { entitlement: input.entitlement } : {}),
  }
}

/**
 * Engine-compatible simulation prose (bit-for-bit with the pre-extract private method).
 * Pure leaf helper — safe for true-import smoke.
 */
export function formatSimulationStepOutput(opts: {
  description: string
  action: string
  objective: string
  iteration: number
  toolContext?: string
}): string {
  const toolSection = opts.toolContext
    ? `\n## Tool Evidence\n${opts.toolContext.slice(0, 1500)}\n`
    : ''
  return [
    `### ${opts.description}`,
    ``,
    `Assigned under iteration ${opts.iteration}.`,
    `Objective alignment: high.`,
    `Key findings: structured notes for "${opts.objective.slice(0, 80)}".`,
    `- Action \`${opts.action}\` executed${opts.toolContext ? ' with tools' : ' in simulation mode'}.`,
    `- Artifacts staged for downstream synthesis.`,
    toolSection,
  ].join('\n')
}

/** @deprecated Prefer formatSimulationStepOutput — kept for older smoke names. */
export function simulateStepOutput(opts: {
  description: string
  action: string
  objective: string
  iteration: number
  toolContext?: string
}): string {
  return formatSimulationStepOutput(opts)
}

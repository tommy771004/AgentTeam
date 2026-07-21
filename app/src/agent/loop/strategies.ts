/**
 * @internal Loop Runner strategy adapters — NOT a product-facing seam.
 *
 * Relocated from ../stepStrategies.ts (Loop Runner deepening, ticket 02).
 * Consumed by ./stepRun.ts; the only product-facing entry to the Loop
 * Runner is runLoop (./index.ts). Do not import from UI or new product
 * code — use taskRunCoordinator.runTask.
 *
 * Internal shapes stay different:
 *   - function-calling: multi-round toolLoop
 *   - heuristic: single fixed tool list + optional plain LLM
 *   - simulation: deterministic text (no tools / no LLM)
 */
import { v4 as uuid } from 'uuid'
import type {
  ChatAttachment,
  LlmSettings,
  LogLevel,
  RuntimeOverrides,
  ToolCallRecord,
} from '../types'
import {
  runPrimaryAgentTask,
  runSubAgentTask,
} from '../llm.ts'
import { buildPromptLayers, formatPacketDiagnostics } from '../hermes/promptBuilder.ts'
import { compressStepOutputs } from '../hermes/sessionSearch.ts'
import { buildToolInput, selectToolsForStep, type ToolName } from '../tools/registry.ts'
import { authorizeTool } from '../tools/toolGuard.ts'
import { dispatchRegistered, discoverRegisteredToolModules } from '../tools/toolRegistry.ts'
import {
  buildCustomToolInput,
  executeCustomTool,
  selectCustomToolsForStep,
} from '../tools/customTools.ts'
import { runFunctionCallingLoop } from '../tools/toolLoop.ts'
import { invokeGatedTool } from '../tools/toolInvocation.ts'
import type { SupervisorLimits } from '../supervisor.ts'
import {
  buildStepCapabilityPreload,
  formatSimulationStepOutput,
  type StepExecutor,
  type StepExecutorInput,
  type StepExecutorOutput,
} from './stepIO.ts'

export { formatSimulationStepOutput }

export type StepStrategyHost = {
  log: (level: LogLevel | 'System', message: string) => void
  shouldAbort: () => boolean
  executionSettings: (role: string) => LlmSettings
  supervisorLimits: () => SupervisorLimits
  subAgentsEnabled: () => boolean
  onToolCall: (record: ToolCallRecord) => void
  /** Merge capability ids into run state (cross-step union). */
  onCapabilityUnion: (ids: string[]) => void
  onUnlockedUnion: (names: string[]) => void
  onQuestionAsked: () => void
  onQuestionResolved: () => void
  onSubAgentSnippet: (snippet: string) => void
}

/** Extended input used by strategies (engine fills these). */
export type StrategyStepInput = StepExecutorInput & {
  stepAction: string
  stepNumber: number
  iteration: number
  agentName: string
}

function nowTime(): string {
  return new Date().toLocaleTimeString('en-GB', { hour12: false })
}

function delay(ms: number) {
  return new Promise((r) => setTimeout(r, ms))
}

async function evaluateAfterToolHooks(
  settings: LlmSettings,
  ctx: { tool: string; toolOk: boolean; sourceKind?: string; objective?: string },
): Promise<{ audits: string[]; notifications: string[] }> {
  try {
    const { collectHookRules, evaluateHooks } = await import('../hooks.ts')
    const ev = evaluateHooks(collectHookRules(settings), {
      point: 'afterTool',
      tool: ctx.tool,
      toolOk: ctx.toolOk,
      sourceKind: ctx.sourceKind as import('../hooks').HookContext['sourceKind'],
      objective: ctx.objective,
    })
    return { audits: ev.audits, notifications: ev.notifications }
  } catch {
    return { audits: [], notifications: [] }
  }
}

/**
 * Single assembly for heuristic gated tools (builtin + custom).
 * Owns authorize → invokeGatedTool options; callers only supply tool/input/flags/execute.
 * Supervisor via invokeGatedTool is truncate-only (phase 1).
 */
async function runHeuristicGatedTool(args: {
  tool: string
  input: Record<string, unknown>
  settings: LlmSettings
  overrides: StepExecutorInput['overrides']
  host: StepStrategyHost
  toolCalls: ToolCallRecord[]
  forceAsk?: boolean
  sideEffect?: boolean
  hitlTimeoutMs?: number
  step?: number
  objective: string
  startedAt: number
  execute: () => Promise<{ ok: boolean; output: string }>
  evaluateAfterTool: (ctx: {
    tool: string
    toolOk: boolean
    sourceKind?: string
    objective?: string
  }) => Promise<{ audits: string[]; notifications: string[] }>
}): Promise<string> {
  const { tool, input, settings, overrides, host } = args
  const fin = await invokeGatedTool({
    tool,
    input,
    authorize: () =>
      authorizeTool({
        tool,
        input,
        settings,
        permissionPolicy: overrides.permissionPolicy,
        permissionProjection: overrides.permissionProjection,
        blockedTools: overrides.blockedTools,
        forceAsk: args.forceAsk,
        sideEffect: args.sideEffect,
        hitlTimeoutMs: args.hitlTimeoutMs,
        unattended: overrides.unattended,
        runId: overrides.runId,
        threadId: overrides.threadId,
        sourceKind: overrides.sourceKind,
        objective: args.objective,
        onLog: (level, message) => host.log(level as LogLevel, message),
      }),
    execute: args.execute,
    supervisorLimits: host.supervisorLimits(),
    step: args.step,
    sourceKind: overrides.sourceKind,
    objective: args.objective,
    startedAt: args.startedAt,
    nowTime,
    newId: () => uuid(),
    onLog: (level, message) => host.log(level as LogLevel, message),
    onRecord: (record) => {
      host.onToolCall(record)
      args.toolCalls.push(record)
    },
    evaluateAfterTool: args.evaluateAfterTool,
    notify: (title, body) => {
      void window.subagents?.notify?.(title, body)
    },
  })
  return fin.chunk
}

/** Thrown by heuristic strategy when the plain-LLM call fails — orchestrator falls back to simulation. */
export class HeuristicLlmFailedError extends Error {
  readonly toolContext: string
  readonly causeError: unknown
  constructor(message: string, toolContext: string, causeError: unknown) {
    super(message)
    this.name = 'HeuristicLlmFailedError'
    this.toolContext = toolContext
    this.causeError = causeError
  }
}

// ── Function-calling strategy ────────────────────────────────────

export function createFunctionCallingStepExecutor(host: StepStrategyHost): StepExecutor {
  return {
    async execute(raw: StepExecutorInput): Promise<StepExecutorOutput> {
      const input = raw as StrategyStepInput
      const { settings, overrides, role, agentName } = input
      host.log('INFO', `[${agentName}] function-calling tool loop enabled`)
      host.log('System', 'Binding tool registry… [OK]')

      const roleSettings = host.executionSettings(role)
      const layers = buildPromptLayers({
        role,
        objective: input.objective,
        settings,
        projectGuidance: input.projectGuidance || undefined,
        temporary:
          overrides.temporary === true ||
          input.temporaryChatDefault === true,
        stepEvidence: compressStepOutputs(input.stepOutputs, 4000),
        sessionRecall: input.sessionRecallBlock || undefined,
        skillsContext: input.attachedSkillContext || undefined,
      })
      if (layers.packetDiagnostics) {
        host.log('INFO', formatPacketDiagnostics(layers.packet!))
      }

      const fcCapOpts = buildStepCapabilityPreload({
        settings,
        overrides,
        loadedCapabilityIds: input.loadedCapabilityIds,
        unlockedToolNames: input.unlockedToolNames,
        agentName,
        role,
        projectRoot: overrides.projectRoot,
      })

      if (input.userAttachments?.some((a) => a.kind === 'image' && a.dataUrl)) {
        host.log(
          'INFO',
          `Multimodal: ${input.userAttachments.filter((a) => a.kind === 'image').length} image(s) in user message`,
        )
      }

      const loop = await runFunctionCallingLoop(
        roleSettings,
        {
          role,
          objective: input.objective,
          step: input.step,
          context: layers.full.slice(0, 12_000),
          userAttachments: input.userAttachments,
        },
        {
          limits: host.supervisorLimits(),
          haltOnPayloadOverflow: settings.haltOnPayloadOverflow === true,
          includeMcpTools: settings.mcpEnabled,
          permissionPolicy: overrides.permissionPolicy,
          permissionProjection: overrides.permissionProjection,
          mcpAgentId: overrides.mcpAgentId || overrides.agentMode || 'build',
          preloadCapabilityIds: fcCapOpts.preloadIds,
          preloadUnlockedTools: fcCapOpts.preloadUnlockedTools,
          unattended: overrides.unattended === true,
          hitlTimeoutMs: overrides.hitlTimeoutMs,
          sourceKind: overrides.sourceKind,
          objective: input.objective,
          projectRoot: overrides.projectRoot,
          runId: overrides.runId,
          threadId: overrides.threadId,
          blockedTools: fcCapOpts.blockedTools,
          callbacks: {
            shouldAbort: () => host.shouldAbort(),
            onLog: (level, message) => {
              const map: Record<string, LogLevel> = {
                THOUGHT: 'THOUGHT',
                ACTION: 'ACTION',
                INFO: 'INFO',
                EXEC: 'EXEC',
                SUCCESS: 'SUCCESS',
                WARN: 'WARN',
                ERROR: 'ERROR',
                PROCESS: 'PROCESS',
              }
              host.log(map[level] || 'INFO', message)
            },
            onToolCall: (record) => {
              host.onToolCall({ ...record, step: input.stepNumber })
            },
            onCapabilityLoad: (ids) => {
              host.onCapabilityUnion(ids)
            },
            onQuestionAsked: () => host.onQuestionAsked(),
            onQuestionResolved: () => host.onQuestionResolved(),
          },
        },
      )

      if (loop.loadedCapabilityIds?.length) {
        host.onCapabilityUnion(loop.loadedCapabilityIds)
      }
      if (loop.unlockedToolNames?.length) {
        host.onUnlockedUnion(loop.unlockedToolNames)
      }
      host.onSubAgentSnippet(loop.content.slice(0, 120))
      host.log(
        'INFO',
        `[${agentName}] FC rounds=${loop.rounds} tokens +${loop.tokensUsed}` +
          (loop.loadedCapabilityIds?.length
            ? ` caps=[${loop.loadedCapabilityIds.join(', ')}]`
            : '') +
          (loop.unlockedToolNames?.length
            ? ` unlock=${loop.unlockedToolNames.length}`
            : ''),
      )

      return {
        output: loop.content,
        toolContext: loop.toolContext,
        tokensUsed: loop.tokensUsed,
        loadedCapabilityIds: loop.loadedCapabilityIds || [],
        unlockedToolNames: loop.unlockedToolNames || [],
        rounds: loop.rounds,
        toolCalls: [],
      }
    },
  }
}

// ── Heuristic strategy ───────────────────────────────────────────

export function createHeuristicStepExecutor(host: StepStrategyHost): StepExecutor {
  return {
    async execute(raw: StepExecutorInput): Promise<StepExecutorOutput> {
      const input = raw as StrategyStepInput
      const { settings, overrides, role, agentName } = input
      let toolContext = ''
      const toolCalls: ToolCallRecord[] = []
      let loadedCapabilityIds: string[] = []

      if (settings.toolsEnabled !== false) {
        const {
          assembleCapabilities,
          loadCapability,
          capabilityOwnsTool,
          approvalRequiredFor,
          formatAlwaysOnInstructions,
        } = await import('../capabilities/index.ts')
        let projectRoot = ''
        try {
          const { useProjectStore } = await import('../../store/projectStore.ts')
          projectRoot =
            (overrides.projectRoot || '').trim() ||
            useProjectStore.getState().root ||
            ''
        } catch {
          projectRoot = (overrides.projectRoot || '').trim()
        }

        let entitlement
        try {
          entitlement = (await import('../../store/subscriptionStore.ts')).useSubscriptionStore.getState()
            .entitlement
        } catch {
          entitlement = undefined
        }

        const capState = assembleCapabilities(
          settings,
          buildStepCapabilityPreload({
            settings,
            overrides,
            loadedCapabilityIds: input.loadedCapabilityIds,
            unlockedToolNames: input.unlockedToolNames,
            agentName,
            role,
            projectRoot,
            entitlement,
          }),
        )

        const tools = selectToolsForStep(
          input.step,
          input.objective,
          input.stepAction,
          { webSearchEnabled: settings.webSearchEnabled !== false },
        ).filter(
          (t) =>
            (settings.subAgentsEnabled === true || !t.startsWith('delegate_')) &&
            !(overrides.blockedTools || []).includes(t),
        )

        for (const tool of tools) {
          for (const c of capState.all) {
            if (capabilityOwnsTool(c, tool) && !capState.loadedIds.has(c.id)) {
              loadCapability(capState, c.id)
              host.log('INFO', `heuristic auto-load capability «${c.id}» for tool ${tool}`)
            }
          }
        }
        loadedCapabilityIds = [...capState.loadedIds]
        host.onCapabilityUnion(loadedCapabilityIds)

        const runbook = formatAlwaysOnInstructions(capState)
        if (runbook) {
          host.log(
            'INFO',
            `heuristic capability runbooks active (${[...capState.loadedIds].length})`,
          )
        }

        const customTools = selectCustomToolsForStep(
          input.step,
          input.objective,
          settings,
          { blockedTools: overrides.blockedTools },
        )
        for (const custom of customTools) {
          const ownerCap = `user:${custom.ownerId}`
          if (!capState.loadedIds.has(ownerCap)) {
            loadCapability(capState, ownerCap)
            host.log('INFO', `heuristic auto-load capability «${ownerCap}» for ${custom.name}`)
          }
        }
        loadedCapabilityIds = [...capState.loadedIds]
        host.onCapabilityUnion(loadedCapabilityIds)

        if (tools.length || customTools.length) {
          host.log(
            'PROCESS',
            `[${agentName}] tools: ${[...tools, ...customTools.map((c) => c.name)].join(', ')}`,
          )
        }

        const toolChunks: string[] = []
        if (runbook) toolChunks.push(`### capability runbooks\n${runbook.slice(0, 2000)}`)
        const hitlTimeoutMs =
          overrides.hitlTimeoutMs ??
          (overrides.unattended ? 45_000 : undefined)
        const afterTool = (ctx: {
          tool: string
          toolOk: boolean
          sourceKind?: string
          objective?: string
        }) => evaluateAfterToolHooks(settings, ctx)

        for (const tool of tools) {
          if (host.shouldAbort()) break
          const toolInput = buildToolInput(
            tool,
            input.objective,
            input.step,
            input.stepOutputs,
          )
          const toolName: ToolName = tool
          const chunk = await runHeuristicGatedTool({
            tool: toolName,
            input: toolInput,
            settings,
            overrides,
            host,
            toolCalls,
            forceAsk: approvalRequiredFor(capState, toolName),
            hitlTimeoutMs,
            step: input.stepNumber,
            objective: input.objective,
            startedAt: Date.now(),
            evaluateAfterTool: afterTool,
            execute: async () => {
              host.log('ACTION', `Invoking tool '${toolName}'`)
              host.log(
                'EXEC',
                `tool:${toolName} ${JSON.stringify(toolInput).slice(0, 120)}`,
              )
              await discoverRegisteredToolModules()
              return dispatchRegistered(toolName, toolInput, {
                permissionPolicy: overrides.permissionPolicy,
                permissionProjection: overrides.permissionProjection,
                mcpAgentId: overrides.mcpAgentId || overrides.agentMode || 'build',
                runId: overrides.runId,
                threadId: overrides.threadId,
                projectRoot: overrides.projectRoot,
              })
            },
          })
          toolChunks.push(chunk)
        }

        for (const custom of customTools) {
          if (host.shouldAbort()) break
          const toolInput = buildCustomToolInput(custom, input.objective, input.step)
          const chunk = await runHeuristicGatedTool({
            tool: custom.name,
            input: toolInput,
            settings,
            overrides,
            host,
            toolCalls,
            forceAsk: approvalRequiredFor(capState, custom.name),
            sideEffect: true,
            hitlTimeoutMs,
            step: input.stepNumber,
            objective: input.objective,
            startedAt: Date.now(),
            evaluateAfterTool: afterTool,
            execute: () =>
              executeCustomTool(custom, toolInput, settings, {
                runId: overrides.runId,
                projectRoot: overrides.projectRoot,
              }),
          })
          toolChunks.push(chunk)
        }
        toolContext = toolChunks.join('\n\n')
      }

      // Plain LLM — on failure, throw so orchestrator owns simulation fallback
      const useLlm =
        overrides.useLlm !== false && settings.enabled && Boolean(settings.apiKey)
      if (useLlm) {
        try {
          const context = input.stepOutputs.slice(-3).join('\n---\n')
          const roleSettings = host.executionSettings(role)
          const layers = buildPromptLayers({
            role,
            objective: input.objective,
            settings,
            projectGuidance: input.projectGuidance || undefined,
            temporary:
              overrides.temporary === true ||
              input.temporaryChatDefault === true,
            stepEvidence: context,
            sessionRecall: input.sessionRecallBlock || undefined,
            skillsContext: input.attachedSkillContext || undefined,
          })
          let userContent: import('../llm').ChatMessageContent | undefined
          if (input.userAttachments?.some((a) => a.kind === 'image')) {
            try {
              const {
                buildMultimodalUserContent,
                hydrateAttachmentsFromDisk,
                attachmentsPathAppendix,
              } = await import('../../lib/chatAttachments.ts')
              const hydrated = await hydrateAttachmentsFromDisk(input.userAttachments)
              const body = `Objective: ${input.objective}\n\nYour step: ${input.step}\n\nTool results:\n${toolContext || '(no tools ran)'}\n\nContext so far:\n${layers.full.slice(0, 10_000)}\n\n${attachmentsPathAppendix(hydrated)}\n\nProduce the step output only.`
              userContent = buildMultimodalUserContent(body, hydrated)
              if (Array.isArray(userContent)) {
                host.log('INFO', 'Heuristic multimodal: sending image(s) to LLM')
              } else if (hydrated.some((a) => a.kind === 'image' && !a.dataUrl)) {
                host.log(
                  'WARN',
                  'Heuristic: images lack dataUrl — path appendix only (open FC for full vision path)',
                )
              }
            } catch {
              /* fall through to plain text */
            }
          }
          const result = host.subAgentsEnabled()
            ? await runSubAgentTask(
                roleSettings,
                role,
                input.objective,
                input.step,
                layers.full.slice(0, 10_000),
                toolContext,
                userContent ? { userContent } : undefined,
              )
            : await runPrimaryAgentTask(
                roleSettings,
                input.objective,
                input.step,
                layers.full.slice(0, 10_000),
                toolContext,
                userContent ? { userContent } : undefined,
              )
          host.onSubAgentSnippet(result.content.slice(0, 120))
          host.log('INFO', `[${agentName}] LLM tokens +${result.tokensUsed}`)
          return {
            // content may legitimately be "" — never encode control flow in output
            output: result.content ?? '',
            toolContext,
            tokensUsed: result.tokensUsed,
            loadedCapabilityIds,
            unlockedToolNames: [],
            toolCalls,
            needsSimulation: false,
          }
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e)
          throw new HeuristicLlmFailedError(msg, toolContext, e)
        }
      }

      // tools-only / no LLM — explicit handoff; do not overload empty output.
      return {
        output: '',
        toolContext,
        tokensUsed: 0,
        loadedCapabilityIds,
        unlockedToolNames: [],
        toolCalls,
        needsSimulation: true,
      }
    },
  }
}

// ── Simulation strategy ──────────────────────────────────────────

export type SimulationStepInput = StrategyStepInput & {
  _toolContext?: string
  /** When true, skip artificial UI delay (LLM-failure fallback must stay immediate). */
  _skipDelay?: boolean
}

export function createSimulationStepExecutor(host: StepStrategyHost): StepExecutor {
  return {
    async execute(raw: StepExecutorInput): Promise<StepExecutorOutput> {
      const input = raw as SimulationStepInput
      // Tools-only / !useLlm path: preserve prior sim latency.
      // LLM-failure path passes _skipDelay (pre-refactor called format immediately).
      if (!input._skipDelay) {
        const workMs = 400 + Math.random() * 500
        await delay(workMs)
      }
      if (host.shouldAbort()) {
        return {
          output: '',
          toolContext: input._toolContext || '',
          tokensUsed: 0,
          loadedCapabilityIds: [],
          unlockedToolNames: [],
          toolCalls: [],
        }
      }
      const toolContext = input._toolContext || ''
      const output = formatSimulationStepOutput({
        description: input.step,
        action: input.stepAction,
        objective: input.objective,
        iteration: input.iteration,
        toolContext,
      })
      return {
        output,
        toolContext,
        tokensUsed: 0,
        loadedCapabilityIds: [],
        unlockedToolNames: [],
        toolCalls: [],
      }
    },
  }
}

/** Factory bundle for the engine orchestrator. */
export function createStepStrategies(host: StepStrategyHost) {
  return {
    functionCalling: createFunctionCallingStepExecutor(host),
    heuristic: createHeuristicStepExecutor(host),
    simulation: createSimulationStepExecutor(host),
  }
}

/** Attach toolContext for simulation fallback without widening public StepExecutorInput. */
export function withToolContext(
  input: StrategyStepInput,
  toolContext: string,
  opts?: { skipDelay?: boolean },
): SimulationStepInput {
  return {
    ...input,
    _toolContext: toolContext,
    ...(opts?.skipDelay ? { _skipDelay: true } : {}),
  }
}

export type { RuntimeOverrides, ChatAttachment }

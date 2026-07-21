/**
 * Multi-round OpenAI function-calling tool loop.
 * + dynamic MCP tools in schema
 * + blockedTools (delegate leaf isolation)
 * + Capability progressive disclosure (load_capability)
 */

import { v4 as uuid } from 'uuid'
import type { LlmSettings, PermissionProjection, ToolCallRecord } from '../types'
import { chatCompletionWithTools, type ChatMessageExt, type ToolCallRequest } from '../llm.ts'
import { buildOpenAiTools, type OpenAiToolDef } from './schemas.ts'
import {
  DEFAULT_SUPERVISOR_LIMITS,
  enforceStepContextBudget,
  enforceToolPayload,
  type SupervisorLimits,
  SupervisorViolation,
} from '../supervisor.ts'
import { listAllMcpTools, mcpCallTool } from '../hermes/mcp.ts'
import { resolveMcpSecretOwnerId } from '../hermes/mcpSecrets.ts'
import { checkToolPermission, type PermissionPolicy } from '../opencode/permissions.ts'
import { mcpServersForAgent, isMcpServerAllowedForAgent } from '../opencode/mcpAccess.ts'
import { authorizeTool } from './toolGuard.ts'
import {
  isPostAuthAgentLevelTool,
  isPreAuthAgentLevelTool,
} from './agentLevelTools.ts'
import { invokeGatedTool } from './toolInvocation.ts'
import { discoverRegisteredToolModules, dispatchRegistered } from './toolRegistry.ts'
import {
  activeModelSettings,
  applyToolSearchVisibility,
  approvalRequiredFor,
  assembleCapabilities,
  filterToolDefs,
  formatAlwaysOnInstructions,
  formatDeferredCatalog,
  isToolAllowedByCapabilities,
  loadCapability,
  loadCapabilityToolDef,
  LOAD_CAPABILITY_TOOL,
  RUN_CODE_TOOL,
  searchTools,
  summarizeCapabilityState,
  TOOL_SEARCH_TOOL,
  toolSearchToolDef,
  type CapabilityRuntimeState,
} from '../capabilities/index.ts'
import { runCodeMode, runCodeToolDef } from './codeMode.ts'
import { createDefaultContextEngine } from '../contextEngine.ts'
import {
  ENTER_PLAN_MODE_TOOL,
  EXIT_PLAN_MODE_TOOL,
  isPlanModeActive,
  PLAN_FILE_PREFIX,
  setPlanMode,
} from '../planMode.ts'
import {
  customToolDefs,
  customToolsForSettings,
  executeCustomTool,
  isCustomToolApprovalRequired,
  type ResolvedCustomTool,
} from './customTools.ts'
import type { ChatAttachment } from '../types'
import {
  buildMultimodalUserContent,
  contentPartsToPlainText,
} from '../../lib/chatAttachments.ts'

export interface ToolLoopCallbacks {
  onLog?: (
    level:
      | 'INFO'
      | 'EXEC'
      | 'SUCCESS'
      | 'WARN'
      | 'ERROR'
      | 'PROCESS'
      | 'THOUGHT'
      | 'ACTION'
      | 'AWAIT',
    message: string,
  ) => void
  onToolCall?: (record: ToolCallRecord) => void
  /** Fired when load_capability activates a bundle (or preload snapshot) */
  onCapabilityLoad?: (ids: string[]) => void
  /** 每輪 context 用量估算（tokenEstimate 單一來源），供 UI meter。 */
  onContextUsage?: (usage: { tokens: number; contextWindow: number; ratio: number }) => void
  /** Structured ask_user lifecycle for the live run status. */
  onQuestionAsked?: () => void
  onQuestionResolved?: () => void
  shouldAbort?: () => boolean
}

export interface ToolLoopResult {
  content: string
  tokensUsed: number
  toolCalls: ToolCallRecord[]
  toolContext: string
  rounds: number
  /** Always-on + loaded deferred capability ids at end of loop */
  loadedCapabilityIds: string[]
  /** tool_search unlock set at end of loop */
  unlockedToolNames: string[]
}

export interface ToolLoopOptions {
  limits?: SupervisorLimits
  callbacks?: ToolLoopCallbacks
  haltOnPayloadOverflow?: boolean
  /** Hermes leaf isolation / OpenCode deny list */
  blockedTools?: string[]
  /** OpenCode-style permission policy */
  permissionPolicy?: PermissionPolicy
  permissionProjection?: PermissionProjection
  /** OpenCode agent id used for per-agent MCP allowlists. */
  mcpAgentId?: string
  extraToolsNote?: string
  /** Inject dynamic MCP tools into FC schema */
  includeMcpTools?: boolean
  /** Preload deferred capability ids (e.g. attached skills as skill:name) */
  preloadCapabilityIds?: string[]
  /** Restore tool_search unlocked names */
  preloadUnlockedTools?: string[]
  /** Override progressive disclosure (default: settings.capabilitiesEnabled) */
  capabilitiesEnabled?: boolean
  /** Unattended automation: shorter HITL timeout → auto deny */
  unattended?: boolean
  hitlTimeoutMs?: number
  /** Lifecycle hooks context (P1-D) */
  sourceKind?: string
  objective?: string
  /** Per-run project pin (scheduler) — overrides UI project store for tools/MCP */
  projectRoot?: string
  /** Explicit identity used for HITL routing, shell cancellation and thread-bound tools. */
  runId?: string
  threadId?: string
  /**
   * Live settings re-read each FC LLM round so mid-step configure() (model etc.)
   * applies without restarting the step. Capability assembly still uses the
   * entry `settings` argument.
   */
  getSettings?: () => LlmSettings
}

function nowTime(): string {
  return new Date().toLocaleTimeString('en-GB', { hour12: false })
}

function sanitizeFnName(s: string): string {
  return s.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 64)
}

/** Parse inherit_capabilities from delegate_task args (array or comma string). */
function parseInheritCapabilities(args: Record<string, unknown>): string[] {
  const raw =
    args.inherit_capabilities ?? args.inheritCapabilities ?? args.capabilities
  if (Array.isArray(raw)) {
    return raw.map((x) => String(x || '').trim()).filter(Boolean).slice(0, 12)
  }
  if (typeof raw === 'string' && raw.trim()) {
    return raw
      .split(/[,\s]+/)
      .map((s) => s.trim())
      .filter(Boolean)
      .slice(0, 12)
  }
  return []
}

/** Map FC name → { serverId, toolName } */
type McpNameMap = Map<string, { serverId: string; toolName: string }>

async function buildDynamicMcpTools(settings: LlmSettings, mcpAgentId?: string): Promise<{
  defs: OpenAiToolDef[]
  map: McpNameMap
  errors: string[]
}> {
  const map: McpNameMap = new Map()
  const defs: OpenAiToolDef[] = []
  const errors: string[] = []
  if (!settings.mcpEnabled || !settings.mcpServers?.length) {
    return { defs, map, errors }
  }
  try {
    const tools = await listAllMcpTools(
      mcpServersForAgent(settings, mcpAgentId),
      settings,
    )
    for (const t of tools) {
      if (t.name === '__error__') {
        errors.push(`[${t.serverName}/${t.serverId}] ${t.description || 'probe failed'}`)
        continue
      }
      const fn = sanitizeFnName(`mcp_${t.serverId}_${t.name}`)
      map.set(fn, { serverId: t.serverId, toolName: t.name })
      defs.push({
        type: 'function',
        function: {
          name: fn,
          description: `[MCP:${t.serverName}] ${t.description || t.name}`,
          parameters: (t.inputSchema as Record<string, unknown>) || {
            type: 'object',
            properties: {},
          },
        },
      })
    }
  } catch (e) {
    errors.push(e instanceof Error ? e.message : String(e))
  }
  return { defs, map, errors }
}

export async function runFunctionCallingLoop(
  settings: LlmSettings,
  args: {
    role: string
    objective: string
    step: string
    context: string
    seedToolContext?: string
    /** Images for vision-capable models (text files already in objective) */
    userAttachments?: ChatAttachment[]
  },
  opts?: ToolLoopOptions,
): Promise<ToolLoopResult> {
  // Hermes discover: import self-registering tool modules once per process
  await discoverRegisteredToolModules()
  const limits = opts?.limits || DEFAULT_SUPERVISOR_LIMITS
  const cb = opts?.callbacks
  const blocked = new Set((opts?.blockedTools || []).map(String))
  const policy = opts?.permissionPolicy
  // Per-run pin first (must not silently fall back to wrong UI project)
  let projectRoot = (opts?.projectRoot || '').trim()
  if (!projectRoot) {
    try {
      const { useProjectStore } = await import('../../store/projectStore')
      projectRoot = useProjectStore.getState().root || ''
    } catch {
      /* browser/unit-test fallback */
    }
  }
  // ── Capability progressive disclosure (Pydantic AI 2.0–style) ──
  const hitlTimeoutMs =
    opts?.hitlTimeoutMs ??
    (opts?.unattended ? 45_000 : undefined)

  const capState = assembleCapabilities(settings, {
    progressive: opts?.capabilitiesEnabled ?? settings.capabilitiesEnabled !== false,
    preloadIds: opts?.preloadCapabilityIds,
    preloadUnlockedTools: opts?.preloadUnlockedTools,
    webSearchEnabled: settings.webSearchEnabled !== false,
    includeMcpCaps: opts?.includeMcpTools !== false && settings.mcpEnabled,
    projectRoot,
    blockedTools: opts?.blockedTools,
    agentId: opts?.mcpAgentId,
    entitlement: await (async () => {
      try {
        return (await import('../../store/subscriptionStore.ts')).useSubscriptionStore.getState()
          .entitlement
      } catch {
        // Node smokes / non-renderer: free entitlement floor
        return undefined
      }
    })(),
  })
  cb?.onLog?.('INFO', summarizeCapabilityState(capState))
  const emitLoadedCaps = () => {
    const ids = [...capState.loadedIds].sort()
    cb?.onCapabilityLoad?.(ids)
  }
  emitLoadedCaps()
  const snapshotUnlock = () => [...capState.toolSearch.unlocked].sort()

  // Full catalog of built-in + optional tools; gated each round by capState
  const allBuiltin = buildOpenAiTools({
    webSearchEnabled: settings.webSearchEnabled !== false,
  }).filter((t) => {
    if (settings.subAgentsEnabled !== true && (t.function.name === 'delegate_task' || t.function.name === 'delegate_status')) return false
    if (blocked.has(t.function.name)) return false
    if (policy && checkToolPermission(policy, t.function.name) === 'deny') return false
    return true
  })

  let mcpMap: McpNameMap = new Map()
  const customMap = new Map<string, ResolvedCustomTool>()
  const allMcpDefs: OpenAiToolDef[] = []
  let mcpProbeErrors: string[] = []
  if (opts?.includeMcpTools !== false && settings.mcpEnabled) {
    const dyn = await buildDynamicMcpTools(settings, opts?.mcpAgentId)
    mcpMap = dyn.map
    mcpProbeErrors = dyn.errors
    for (const d of dyn.defs) {
      if (!blocked.has(d.function.name)) allMcpDefs.push(d)
    }
    if (dyn.defs.length) {
      cb?.onLog?.(
        'INFO',
        `MCP 動態工具 ${dyn.defs.length} 個（capability 未載入前不會出現在 schema）`,
      )
    }
    if (dyn.errors.length) {
      cb?.onLog?.('WARN', `MCP 探測失敗 ${dyn.errors.length} 項：\n${dyn.errors.join('\n')}`)
    }
  }

  // Include delegate_task only when Sub Agent mode is explicitly enabled.
  const delegateDef: OpenAiToolDef = {
    type: 'function',
    function: {
      name: 'delegate_task',
      description:
        'Spawn an isolated leaf subagent with its own context (no parent transcript). Use for parallel research sub-goals.',
      parameters: {
        type: 'object',
        properties: {
          goal: { type: 'string', description: 'Isolated goal for the child' },
          context: { type: 'string', description: 'Read-only context snippet for the child' },
          role: { type: 'string', enum: ['leaf', 'orchestrator'], default: 'leaf' },
          background: {
            type: 'boolean',
            description: 'If true, enqueue background job and return job id immediately',
          },
          notify_on_complete: {
            type: 'boolean',
            description: 'Notify on desktop when background job finishes (default true)',
          },
          inherit_capabilities: {
            type: 'array',
            items: { type: 'string' },
            description:
              'Optional capability ids to preload in the child (e.g. codegraph, workspace). Isolation by default; only listed packs inherit.',
          },
          capability_mode: {
            type: 'string',
            enum: ['read-only', 'read-write', 'execute', 'all'],
            description:
              'Coarse tool filter for the child (grok-style): read-only = no writes/shell; read-write = files but no shell; execute = shell but no writes. Stacks on role restrictions (never loosens).',
          },
          persona: {
            type: 'string',
            description:
              'Named behavioral overlay from Settings (instructions + optional model). Unknown persona fails the spawn.',
          },
          resume_from: {
            type: 'string',
            description:
              'Background delegate job id whose result becomes read-only context for this child (multi-stage workflows). Job must be finished.',
          },
          isolation: {
            type: 'string',
            enum: ['none', 'worktree'],
            description:
              'worktree = child works in an isolated git worktree (Electron + git project only); changes stay out of the main workspace until applied.',
          },
        },
        required: ['goal'],
      },
    },
  }
  const fullPool: OpenAiToolDef[] = [...allBuiltin]
  if (settings.subAgentsEnabled === true && !blocked.has('delegate_task') && !fullPool.some((t) => t.function.name === 'delegate_task')) {
    fullPool.push(delegateDef)
  }
  {
    const existing = new Set(fullPool.map((t) => t.function.name))
    for (const d of allMcpDefs) {
      if (!existing.has(d.function.name)) fullPool.push(d)
    }
  }
  for (const custom of customToolsForSettings(settings)) customMap.set(custom.name, custom)
  for (const def of customToolDefs([...customMap.values()])) {
    if (!blocked.has(def.function.name) && !fullPool.some((t) => t.function.name === def.function.name)) fullPool.push(def)
  }

  // CodeMode: run_code joins the pool when its capability exists this run
  if (
    capState.all.some((c) => c.id === 'code-mode') &&
    !blocked.has(RUN_CODE_TOOL)
  ) {
    fullPool.push(
      runCodeToolDef(fullPool.map((t) => t.function.name).filter((n) => n !== RUN_CODE_TOOL)),
    )
  }

  // G8 plan mode:僅互動式 run(有人可審批)提供;enter/exit 依狀態輪替
  const planToolsAvailable = !opts?.unattended && Boolean(opts?.runId)
  const enterPlanDef: OpenAiToolDef = {
    type: 'function',
    function: {
      name: ENTER_PLAN_MODE_TOOL,
      description:
        '進入 Plan mode:任務有多種合理作法或架構歧義時,先探索並寫計畫再實作。需使用者核准;核准後只有 .scratch/ 計畫檔可寫,副作用工具被凍結。',
      parameters: {
        type: 'object',
        properties: {
          reason: { type: 'string', description: '為何需要先規劃(一句話)' },
        },
        required: ['reason'],
      },
    },
  }
  const exitPlanDef: OpenAiToolDef = {
    type: 'function',
    function: {
      name: EXIT_PLAN_MODE_TOOL,
      description:
        '完成計畫後請使用者審批。核准即離開 Plan mode 開始實作;退回則留在 Plan mode 依回饋修訂。',
      parameters: {
        type: 'object',
        properties: {
          plan: {
            type: 'string',
            description: '計畫摘要(Markdown,會呈給使用者審批)',
          },
          plan_path: {
            type: 'string',
            description: `計畫檔路徑(${PLAN_FILE_PREFIX} 下,選填)`,
          },
        },
        required: ['plan'],
      },
    },
  }

  const rebuildVisibleTools = (): OpenAiToolDef[] => {
    let visible = filterToolDefs(capState, fullPool)
    // Tool Search: over threshold, hide non-core schemas behind tool_search
    const ts = applyToolSearchVisibility(capState, visible)
    visible = ts.defs
    const searchDef = toolSearchToolDef(capState, ts.hiddenCount)
    if (searchDef && !visible.some((t) => t.function.name === TOOL_SEARCH_TOOL)) {
      visible = [...visible, searchDef]
    }
    const loadDef = loadCapabilityToolDef(capState)
    if (loadDef && !visible.some((t) => t.function.name === LOAD_CAPABILITY_TOOL)) {
      visible = [...visible, loadDef]
    }
    if (planToolsAvailable) {
      const planDef = isPlanModeActive(opts?.runId) ? exitPlanDef : enterPlanDef
      if (!visible.some((t) => t.function.name === planDef.function.name)) {
        visible = [...visible, planDef]
      }
    }
    return visible
  }

  let tools = rebuildVisibleTools()

  // MCP probe failed → auto-load matching connector HTTP packs (user:*)
  if (mcpProbeErrors.length && settings.mcpEnabled) {
    const fallbackIds = new Set<string>()
    for (const server of mcpServersForAgent(settings, opts?.mcpAgentId)) {
      const hasTools = [...mcpMap.values()].some((m) => m.serverId === server.id)
      const errHit = mcpProbeErrors.some(
        (e) => e.includes(server.id) || e.includes(server.name),
      )
      if (hasTools && !errHit) continue
      const owner = server.secretPluginId || resolveMcpSecretOwnerId(server)
      if (owner) fallbackIds.add(`user:${owner}`)
    }
    let loadedFallback = 0
    for (const id of fallbackIds) {
      if (!capState.all.some((c) => c.id === id)) continue
      if (capState.loadedIds.has(id)) continue
      loadCapability(capState, id)
      loadedFallback += 1
      cb?.onLog?.('INFO', `MCP 失敗 fallback：自動載入 ${id}（connector HTTP 工具）`)
    }
    if (loadedFallback > 0) {
      emitLoadedCaps()
      tools = rebuildVisibleTools()
      cb?.onLog?.(
        'INFO',
        `已自動載入 ${loadedFallback} 個 connector 包以替代失效 MCP`,
      )
    }
  }

  const toolCalls: ToolCallRecord[] = []
  const toolChunks: string[] = []
  if (args.seedToolContext) toolChunks.push(args.seedToolContext)
  if (mcpProbeErrors.length) {
    const fallbackNote = [...capState.loadedIds]
      .filter((id) => id.startsWith('user:'))
      .map((id) => id.slice(5))
    toolChunks.push(
      [
        '### MCP 探測警告（對 agent 可見）',
        '下列 MCP 伺服器目前無法提供工具。請授權對應 connector 或檢查設定後再試。',
        ...mcpProbeErrors.map((e) => `- ${e}`),
        fallbackNote.length
          ? `\n已自動載入 connector HTTP 工具包：${fallbackNote.join(', ')}。請優先使用 github_* / notion_* 等 custom tools。`
          : '\n若有對應 connector 已授權，請 load_capability user:<connector-id> 後改用 HTTP 工具。',
      ].join('\n'),
    )
  }

  let tokensUsed = 0
  let rounds = 0

  // ContextEngine (Hermes seam) — default adapter wraps ContextGovernor per step.
  const contextEngine = createDefaultContextEngine({
    compact: async (s, msgs, o) => {
      const { maybeCompactMessages } = await import('../opencode/compaction')
      return maybeCompactMessages(
        s,
        msgs as Parameters<typeof maybeCompactMessages>[1],
        o,
      )
    },
    saveCheckpoint: async (id, payload) => {
      const { saveCompactionCheckpoint } = await import('../compactionCheckpoint')
      saveCompactionCheckpoint(id, {
        summary: payload.summary,
        messages: payload.messages as Parameters<
          typeof saveCompactionCheckpoint
        >[1]['messages'],
      })
    },
    memoryFlush: async (o) => {
      const { learningLoop } = await import('../hermes/learning')
      return learningLoop.onPreCompactionFlush({
        objective: o.objective,
        summary: o.summary,
        runId: o.runId,
        memoryEnabled: o.memoryEnabled,
        memoryWriteEnabled: o.memoryWriteEnabled,
      })
    },
    memoryRecall: async (query, limit) => {
      const { memoryStore } = await import('../hermes/memory')
      return memoryStore.search(query, limit)
    },
    evaluateHook: async (point, ctx) => {
      const { collectHookRules, evaluateHooks } = await import('../hooks')
      const ev = evaluateHooks(collectHookRules(settings), {
        point,
        sourceKind: ctx.sourceKind as import('../hooks').HookContext['sourceKind'],
        objective: ctx.objective,
      })
      return { audits: ev.audits, notifications: ev.notifications }
    },
    bumpMetric: async (runId, key) => {
      const { bumpRunMetric } = await import('../metrics')
      bumpRunMetric(runId, key)
    },
    notify: (title, body) => {
      void window.subagents?.notify?.(title, body)
    },
    log: (level, message) =>
      cb?.onLog?.(
        level as 'INFO' | 'PROCESS' | 'EXEC' | 'SUCCESS' | 'WARN' | 'ERROR' | 'AWAIT' | 'THOUGHT' | 'ACTION',
        message,
      ),
    onContextUsage: (u) => cb?.onContextUsage?.(u),
    contentToPlainText: (content) =>
      contentPartsToPlainText(content as Parameters<typeof contentPartsToPlainText>[0]),
  })

  const catalog = formatDeferredCatalog(capState)
  const alwaysInstr = formatAlwaysOnInstructions(capState)
  const systemExtra = [
    opts?.extraToolsNote || '',
    blocked.size ? `Blocked tools: ${[...blocked].join(', ')}` : '',
    mcpProbeErrors.length
      ? `\n## MCP probe warnings\nSome MCP servers failed to list tools. Prefer connector HTTP tools if available, or tell the user to authorize: ${mcpProbeErrors.join(' | ').slice(0, 800)}`
      : '',
    alwaysInstr ? `\n## Active capability runbooks\n${alwaysInstr}` : '',
    catalog ? `\n## Deferred capabilities\n${catalog}` : '',
    planToolsAvailable
      ? `\n## Plan mode\nFor tasks with genuine architectural ambiguity (multiple reasonable approaches), call enter_plan_mode first: explore read-only, write the plan under ${PLAN_FILE_PREFIX}, then exit_plan_mode for user approval before implementing. Skip planning for clear-path tasks.`
      : '',
  ]
    .filter(Boolean)
    .join('\n')

  const userText = `Objective: ${args.objective}\n\nYour step: ${args.step}\n\nPrior context:\n${args.context || '(none)'}\n\n${args.seedToolContext ? `Pre-fetched tool evidence:\n${args.seedToolContext}` : ''}`
  const userContent = buildMultimodalUserContent(userText, args.userAttachments)

  const messages: ChatMessageExt[] = [
    {
      role: 'system',
      content: `You are the "${args.role}" sub-agent in SubAgents AI.
You may call tools via function calling to gather evidence, then produce a concise Markdown step result.
Rules:
- Prefer tools over guessing.
- Never invent credentials or private data.
- After tools return, synthesize the step output.
- Stop calling tools when you have enough evidence.
- If the user message includes images, describe and use them as primary evidence.
- MCP tools appear as mcp_<serverId>_<toolName> after their MCP capability is loaded.
- Use delegate_task only for parallel isolated sub-goals (if available).
- When a needed tool is missing, call load_capability with the matching capability id first.
- If tool_search is available, hidden tools exist — search by keyword to reveal the ones you need.
- For many similar tool calls (fetch N items then filter), prefer run_code (code-mode capability) to batch them in one round.
${systemExtra}`,
    },
    {
      role: 'user',
      content: userContent,
    },
  ]

  while (rounds < limits.maxToolRounds) {
    if (cb?.shouldAbort?.()) break
    rounds++

    // Refresh tools each round (capability loads expand the set)
    tools = rebuildVisibleTools()

    // Live settings each round (mid-step configure) — assembly still uses entry settings.
    const liveSettings = opts?.getSettings?.() ?? settings

    // ContextEngine: meter + compact + checkpoint + memory (Hermes-style seam).
    const governed = await contextEngine.prepareRound({
      messages,
      round: rounds,
      toolsEstimateText: JSON.stringify(tools),
      settings: liveSettings,
      model: liveSettings.model,
      runId: opts?.runId,
      threadId: opts?.threadId,
      objective: opts?.objective || args.objective,
      sourceKind: opts?.sourceKind,
    })
    if (governed !== messages) {
      messages.length = 0
      for (const m of governed) {
        messages.push({
          role: m.role as ChatMessageExt['role'],
          content: m.content as ChatMessageExt['content'],
          tool_calls: m.tool_calls,
          tool_call_id: m.tool_call_id,
          name: m.name,
        })
      }
    }

    cb?.onLog?.(
      'PROCESS',
      `function-call round ${rounds}/${limits.maxToolRounds} · tools=${tools.length}`,
    )

    // Per-capability model settings (capability bundles model config, v2 style).
    const capModel = activeModelSettings(capState)
    const callSettings = capModel.model
      ? { ...liveSettings, model: capModel.model }
      : liveSettings
    const result = await chatCompletionWithTools(callSettings, messages, tools, {
      temperature: capModel.temperature ?? 0.3,
      maxTokens: capModel.maxTokens ?? 1400,
      toolChoice: 'auto',
      onResilienceEvent: (m) => {
        cb?.onLog?.('WARN', m)
        void import('../metrics').then(({ bumpRunMetric }) =>
          bumpRunMetric(opts?.runId, 'llmRetries'),
        )
      },
    })
    tokensUsed += result.tokensUsed

    if (result.toolCalls.length === 0) {
      const content =
        result.content ||
        (toolChunks.length
          ? `### ${args.step}\n\nSynthesized from tool evidence.\n\n${toolChunks.join('\n\n').slice(0, 2000)}`
          : `### ${args.step}\n\nNo tool calls; completed with reasoning only.`)
      const budget = enforceStepContextBudget(toolChunks, limits)
      const loadedCapabilityIds = [...capState.loadedIds].sort()
      return {
        content,
        tokensUsed,
        toolCalls,
        toolContext: budget.text,
        rounds,
        loadedCapabilityIds,
        unlockedToolNames: snapshotUnlock(),
      }
    }

    messages.push({
      role: 'assistant',
      content: result.content || null,
      tool_calls: result.toolCalls.map((tc) => ({
        id: tc.id,
        type: 'function' as const,
        function: { name: tc.name, arguments: tc.arguments },
      })),
    })

    if (result.content) {
      cb?.onLog?.('THOUGHT', result.content.slice(0, 240))
    }

    // Hermes-style parallel tool_calls: multi-call parallel unless interactive/agent-level.
    // Each call uses isolated buffers; merge tool messages / records in original order.
    const { isAgentLevelTool } = await import('./agentLevelTools.ts')
    const calls = result.toolCalls
    const forceSerial = (name: string) => name === 'ask_user' || isAgentLevelTool(name)
    const baseCtx = {
      limits,
      haltOnPayloadOverflow: opts?.haltOnPayloadOverflow,
      cb,
      blocked,
      mcpMap,
      customMap,
      settings,
      permissionPolicy: policy,
      permissionProjection: opts?.permissionProjection,
      mcpAgentId: opts?.mcpAgentId,
      capState,
      fullPool,
      onLoadedCaps: emitLoadedCaps,
      hitlTimeoutMs,
      unattended: opts?.unattended,
      sourceKind: opts?.sourceKind,
      objective: opts?.objective || args.objective,
      runId: opts?.runId,
      threadId: opts?.threadId,
      projectRoot,
    }
    if (calls.length <= 1 || calls.some((tc) => forceSerial(tc.name))) {
      for (const tc of calls) {
        if (cb?.shouldAbort?.()) break
        await executeOneToolCall(tc, {
          ...baseCtx,
          toolCalls,
          toolChunks,
          messages,
        })
      }
    } else {
      const buffers = calls.map(() => ({
        toolCalls: [] as ToolCallRecord[],
        toolChunks: [] as string[],
        messages: [] as ChatMessageExt[],
      }))
      await Promise.all(
        calls.map((tc, i) =>
          executeOneToolCall(tc, {
            ...baseCtx,
            toolCalls: buffers[i]!.toolCalls,
            toolChunks: buffers[i]!.toolChunks,
            messages: buffers[i]!.messages,
          }),
        ),
      )
      for (const b of buffers) {
        for (const rec of b.toolCalls) toolCalls.push(rec)
        for (const ch of b.toolChunks) toolChunks.push(ch)
        for (const m of b.messages) messages.push(m)
      }
    }
  }

  cb?.onLog?.('WARN', 'Max tool rounds reached; forcing synthesis')
  messages.push({
    role: 'user',
    content: 'Max tool rounds reached. Produce the final Markdown step output now without more tools.',
  })
  const finalLive = opts?.getSettings?.() ?? settings
  const final = await chatCompletionWithTools(finalLive, messages, [], {
    temperature: 0.3,
    maxTokens: 1400,
    toolChoice: 'none',
    onResilienceEvent: (m) => cb?.onLog?.('WARN', m),
  })
  tokensUsed += final.tokensUsed
  const budget = enforceStepContextBudget(toolChunks, limits)
  const loadedCapabilityIds = [...capState.loadedIds].sort()
  return {
    content: final.content || budget.text || 'Step completed after tool budget exhausted.',
    tokensUsed,
    toolCalls,
    toolContext: budget.text,
    rounds,
    loadedCapabilityIds,
    unlockedToolNames: snapshotUnlock(),
  }
}

async function executeOneToolCall(
  tc: ToolCallRequest,
  ctx: {
    limits: SupervisorLimits
    haltOnPayloadOverflow?: boolean
    toolCalls: ToolCallRecord[]
    toolChunks: string[]
    messages: ChatMessageExt[]
    cb?: ToolLoopCallbacks
    blocked: Set<string>
    mcpMap: McpNameMap
    customMap: Map<string, ResolvedCustomTool>
    settings: LlmSettings
    permissionPolicy?: PermissionPolicy
    permissionProjection?: PermissionProjection
    mcpAgentId?: string
    capState?: CapabilityRuntimeState
    /** Complete tool def pool (for tool_search + load_capability unlock) */
    fullPool?: OpenAiToolDef[]
    onLoadedCaps?: () => void
    hitlTimeoutMs?: number
    unattended?: boolean
    sourceKind?: string
    objective?: string
    runId?: string
    threadId?: string
    projectRoot?: string
    onQuestionAsked?: () => void
    onQuestionResolved?: () => void
  },
) {
  let args: Record<string, unknown> = {}
  try {
    args = tc.arguments ? JSON.parse(tc.arguments) : {}
  } catch {
    args = { raw: tc.arguments }
  }

  // ── Agent-level intercept (pre-auth): plan / tool_search / load_capability ──
  // Hermes-style: framework tools never enter gated invokeGatedTool path.
  if (isPreAuthAgentLevelTool(tc.name) && (tc.name === ENTER_PLAN_MODE_TOOL || tc.name === EXIT_PLAN_MODE_TOOL)) {
    const started = Date.now()
    const entering = tc.name === ENTER_PLAN_MODE_TOOL
    let output = ''
    let ok = true
    if (!ctx.runId || ctx.unattended) {
      output = 'Plan mode 僅供互動式 run(unattended 無人可審批)。請以一般流程直接執行。'
    } else {
      try {
        const { usePermissionAskStore } = await import('../../store/permissionAskStore')
        ctx.cb?.onLog?.(
          'AWAIT',
          entering ? 'Plan mode:等待使用者核准進入…' : 'Plan mode:計畫審批中…',
        )
        const decision = await usePermissionAskStore.getState().requestAsk({
          threadId: ctx.threadId,
          runId: ctx.runId,
          tool: tc.name,
          args,
          reason: entering
            ? `Agent 請求進入 Plan mode(規劃階段只寫 ${PLAN_FILE_PREFIX} 計畫檔):${String(args.reason || '').slice(0, 200)}`
            : `計畫審批 — 核准即開始實作,拒絕則退回修訂:\n\n${String(args.plan || '').slice(0, 1500)}`,
          timeoutMs: 90_000,
        })
        if (decision === 'deny') {
          output = entering
            ? '使用者未核准進入 Plan mode,請以一般流程直接執行。'
            : '使用者退回計畫 — 留在 Plan mode,請依對話回饋修訂後再次呼叫 exit_plan_mode。'
        } else {
          setPlanMode(ctx.runId, entering)
          output = entering
            ? `已進入 Plan mode。限制:只有 ${PLAN_FILE_PREFIX} 下的計畫檔可寫(建議 ${PLAN_FILE_PREFIX}<feature-slug>/plan.md),bash 與副作用工具會被拒。完成後呼叫 exit_plan_mode 附計畫摘要送審。`
            : '計畫已核准,Plan mode 已解除 — 依計畫開始實作。'
        }
        ctx.cb?.onLog?.(
          decision === 'deny' ? 'WARN' : 'SUCCESS',
          `${tc.name}:${decision === 'deny' ? '未核准' : '已核准'}`,
        )
      } catch (e) {
        ok = false
        output = `plan mode 審批失敗:${e instanceof Error ? e.message : String(e)}`
      }
    }
    const record: ToolCallRecord = {
      id: uuid(),
      tool: tc.name,
      input: args,
      output: output.slice(0, 4000),
      ok,
      durationMs: Date.now() - started,
      timestamp: nowTime(),
    }
    ctx.toolCalls.push(record)
    ctx.cb?.onToolCall?.(record)
    ctx.messages.push({ role: 'tool', tool_call_id: tc.id, content: output })
    return
  }

  // ── Agent-level: tool_search (no HITL) ──
  if (isPreAuthAgentLevelTool(tc.name) && tc.name === TOOL_SEARCH_TOOL && ctx.capState) {
    const started = Date.now()
    const query = String(args.query || '')
    const limit = Number(args.limit) || 6
    const r = searchTools(ctx.capState, ctx.fullPool || [], query, limit)
    ctx.cb?.onLog?.(
      r.ok ? 'SUCCESS' : 'WARN',
      r.ok
        ? `tool_search «${query}» → ${r.unlocked.length} 個工具解鎖${r.autoLoadedCapabilities.length ? ` · 自動載入 caps=[${r.autoLoadedCapabilities.join(', ')}]` : ''}`
        : `tool_search failed: ${r.output}`,
    )
    const record: ToolCallRecord = {
      id: uuid(),
      tool: TOOL_SEARCH_TOOL,
      input: args,
      output: r.output.slice(0, 4000),
      ok: r.ok,
      durationMs: Date.now() - started,
      timestamp: nowTime(),
    }
    ctx.toolCalls.push(record)
    ctx.cb?.onToolCall?.(record)
    if (r.autoLoadedCapabilities.length) ctx.onLoadedCaps?.()
    ctx.messages.push({ role: 'tool', tool_call_id: tc.id, content: r.output })
    return
  }

  // ── Agent-level: load_capability (no HITL) ──
  if (isPreAuthAgentLevelTool(tc.name) && tc.name === LOAD_CAPABILITY_TOOL && ctx.capState) {
    const started = Date.now()
    const id = String(args.id || args.capability_id || '')
    const r = loadCapability(ctx.capState, id, ctx.fullPool)
    const output = r.ok
      ? [
          r.newlyLoaded ? `Loaded capability «${r.id}».` : `Capability «${r.id}» already active.`,
          `Tools unlocked: ${r.tools.join(', ') || '(instructions only)'}`,
          '',
          '## Runbook / instructions',
          r.instructions,
        ].join('\n')
      : r.error
    ctx.cb?.onLog?.(
      r.ok ? 'SUCCESS' : 'WARN',
      r.ok ? `load_capability → ${r.id}` : `load_capability failed: ${r.error}`,
    )
    const record: ToolCallRecord = {
      id: uuid(),
      tool: LOAD_CAPABILITY_TOOL,
      input: args,
      output: output.slice(0, 4000),
      ok: r.ok,
      durationMs: Date.now() - started,
      timestamp: nowTime(),
    }
    ctx.toolCalls.push(record)
    ctx.cb?.onToolCall?.(record)
    if (r.ok) {
      ctx.toolChunks.push(`[load_capability:${r.id}]\n${r.instructions.slice(0, 1200)}`)
      ctx.onLoadedCaps?.()
    }
    ctx.messages.push({ role: 'tool', tool_call_id: tc.id, content: output })
    return
  }

  // Capability gate: reject tools whose bundle is not loaded yet
  if (ctx.capState && !isToolAllowedByCapabilities(ctx.capState, tc.name)) {
    const msg = `工具「${tc.name}」屬於尚未載入的 capability。請先呼叫 load_capability 載入對應能力。`
    ctx.cb?.onLog?.('WARN', msg)
    ctx.messages.push({ role: 'tool', tool_call_id: tc.id, content: msg })
    return
  }

  // Shared HITL / Plan deny / bash patterns — same path as heuristic executeTool.
  // Capability-declared approvalTools force an ask regardless of policy (v2 style).
  const custom = ctx.customMap.get(tc.name)
  const forceAsk = (ctx.capState ? approvalRequiredFor(ctx.capState, tc.name) : false) ||
    (custom ? isCustomToolApprovalRequired(custom) : false)
  const authOpts = {
    tool: tc.name,
    input: args,
    settings: ctx.settings,
    permissionPolicy: ctx.permissionPolicy,
    permissionProjection: ctx.permissionProjection,
    blockedTools: Array.from(ctx.blocked),
    forceAsk,
    // Custom http/bash templates are network/exec — approvalMode 'always' must see them
    sideEffect: Boolean(custom),
    hitlTimeoutMs: ctx.hitlTimeoutMs,
    unattended: ctx.unattended,
    sourceKind: ctx.sourceKind,
    objective: ctx.objective,
    runId: ctx.runId,
    threadId: ctx.threadId,
    onLog: (level: string, message: string) => {
      ctx.cb?.onLog?.(level as Parameters<NonNullable<ToolLoopCallbacks['onLog']>>[0], message)
    },
  }

  // ── Gated path: builtin + custom + MCP via invokeGatedTool (Hermes dispatch) ──
  if (!isPostAuthAgentLevelTool(tc.name)) {
    if (tc.name === 'ask_user') ctx.cb?.onQuestionAsked?.()
    const fin = await invokeGatedTool({
      tool: tc.name,
      input: args,
      authorize: () => authorizeTool(authOpts),
      execute: async () => {
        ctx.cb?.onLog?.('ACTION', `Invoking tool '${tc.name}'`)
        ctx.cb?.onLog?.('EXEC', `Input: ${JSON.stringify(args).slice(0, 200)}`)
        const mcpRef = ctx.mcpMap.get(tc.name)
        if (mcpRef) {
          const server = (ctx.settings.mcpServers || []).find((s) => s.id === mcpRef.serverId)
          if (!server) return { ok: false, output: `MCP server not found: ${mcpRef.serverId}` }
          if (!isMcpServerAllowedForAgent(ctx.settings, ctx.mcpAgentId, mcpRef.serverId)) {
            return { ok: false, output: `MCP server blocked for agent: ${mcpRef.serverId}` }
          }
          const r = await mcpCallTool(server, mcpRef.toolName, args, ctx.settings)
          return { ok: r.ok, output: r.ok ? r.content : r.error || 'MCP failed' }
        }
        if (custom) {
          const r = await executeCustomTool(custom, args, ctx.settings, {
            runId: ctx.runId,
            projectRoot: ctx.projectRoot,
          })
          return { ok: r.ok, output: r.output }
        }
        // Hermes registry dispatch only (no executor switch bypass)
        return dispatchRegistered(tc.name, args, {
          mcpAgentId: ctx.mcpAgentId,
          runId: ctx.runId,
          threadId: ctx.threadId,
          projectRoot: ctx.projectRoot,
          permissionPolicy: ctx.permissionPolicy,
          permissionProjection: ctx.permissionProjection,
        })
      },
      supervisorLimits: ctx.limits,
      haltOnPayloadOverflow: ctx.haltOnPayloadOverflow === true,
      sourceKind: ctx.sourceKind,
      objective: ctx.objective,
      newId: () => uuid(),
      nowTime,
      onLog: (level, message) => {
        ctx.cb?.onLog?.(level as Parameters<NonNullable<ToolLoopCallbacks['onLog']>>[0], message)
      },
      onRecord: (record) => {
        ctx.toolCalls.push(record)
        ctx.cb?.onToolCall?.(record)
      },
      evaluateAfterTool: async ({ tool, toolOk }) => {
        try {
          const { collectHookRules, evaluateHooks } = await import('../hooks')
          const ev = evaluateHooks(collectHookRules(ctx.settings), {
            point: 'afterTool',
            tool,
            toolOk,
            sourceKind: ctx.sourceKind as import('../hooks').HookContext['sourceKind'],
            objective: ctx.objective,
          })
          return { audits: ev.audits, notifications: ev.notifications }
        } catch {
          return { audits: [], notifications: [] }
        }
      },
      notify: (title, body) => {
        void window.subagents?.notify?.(title, body)
      },
    })
    if (tc.name === 'ask_user') ctx.cb?.onQuestionResolved?.()
    ctx.toolChunks.push(fin.chunk)
    ctx.messages.push({
      role: 'tool',
      tool_call_id: tc.id,
      content: fin.output.slice(0, 8000),
    })
    return
  }

  // ── Agent-level (post-auth): run_code / delegate — not gated invokeGatedTool ──
  const auth = await authorizeTool(authOpts)
  if (!auth.allowed) {
    ctx.messages.push({ role: 'tool', tool_call_id: tc.id, content: auth.output })
    return
  }

  ctx.cb?.onLog?.('ACTION', `Invoking tool '${tc.name}'`)
  ctx.cb?.onLog?.('EXEC', `Input: ${JSON.stringify(args).slice(0, 200)}`)
  if (tc.name === 'ask_user') ctx.cb?.onQuestionAsked?.()

  const started = Date.now()
  let output = ''
  let ok = false

  // ── CodeMode: run model JS in worker; inner tool calls re-use the same gates ──
  if (isPostAuthAgentLevelTool(tc.name) && tc.name === RUN_CODE_TOOL) {
    const r = await runCodeMode(String(args.code || ''), {
      timeoutMs: Number(args.timeoutMs) || undefined,
      onLog: (m) => ctx.cb?.onLog?.('EXEC', m),
      callTool: async (name, innerArgs) => {
        if (ctx.capState && !isToolAllowedByCapabilities(ctx.capState, name)) {
          return {
            ok: false,
            output: `Tool «${name}» belongs to an unloaded capability. load_capability outside run_code first.`,
          }
        }
        const innerAuth = await authorizeTool({
          tool: name,
          input: innerArgs,
          settings: ctx.settings,
          permissionPolicy: ctx.permissionPolicy,
          permissionProjection: ctx.permissionProjection,
          blockedTools: Array.from(ctx.blocked),
          forceAsk: (ctx.capState ? approvalRequiredFor(ctx.capState, name) : false) ||
            (ctx.customMap.get(name) ? isCustomToolApprovalRequired(ctx.customMap.get(name)!) : false),
          sideEffect: Boolean(ctx.customMap.get(name)),
          hitlTimeoutMs: ctx.hitlTimeoutMs,
          unattended: ctx.unattended,
          sourceKind: ctx.sourceKind,
          objective: ctx.objective,
          runId: ctx.runId,
          threadId: ctx.threadId,
          onLog: (level, message) => {
            ctx.cb?.onLog?.(
              level as Parameters<NonNullable<ToolLoopCallbacks['onLog']>>[0],
              message,
            )
          },
        })
        if (!innerAuth.allowed) return { ok: false, output: innerAuth.output }

        const started2 = Date.now()
        let innerOk = false
        let innerOut = ''
        const innerMcp = ctx.mcpMap.get(name)
        const innerCustom = ctx.customMap.get(name)
        if (innerMcp) {
          const server = (ctx.settings.mcpServers || []).find((s) => s.id === innerMcp.serverId)
          if (!server) {
            innerOut = `MCP server not found: ${innerMcp.serverId}`
          } else {
            const mr = await mcpCallTool(server, innerMcp.toolName, innerArgs, ctx.settings)
            innerOk = mr.ok
            innerOut = mr.ok ? mr.content : mr.error || 'MCP failed'
          }
        } else if (innerCustom) {
          const cr = await executeCustomTool(innerCustom, innerArgs, ctx.settings, {
            runId: ctx.runId,
            projectRoot: ctx.projectRoot,
          })
          innerOk = cr.ok
          innerOut = cr.output
        } else {
          try {
            const er = await dispatchRegistered(name, innerArgs, {
              mcpAgentId: ctx.mcpAgentId,
              runId: ctx.runId,
              threadId: ctx.threadId,
              projectRoot: ctx.projectRoot,
            })
            innerOk = er.ok
            innerOut = er.output
          } catch (e) {
            innerOut = e instanceof Error ? e.message : String(e)
          }
        }
        const enforced = enforceToolPayload(name, innerOut, ctx.limits, 'truncate')
        const record: ToolCallRecord = {
          id: uuid(),
          tool: `run_code›${name}`,
          input: innerArgs,
          output: enforced.output.slice(0, 4000),
          ok: innerOk,
          durationMs: Date.now() - started2,
          timestamp: nowTime(),
        }
        ctx.toolCalls.push(record)
        ctx.cb?.onToolCall?.(record)
        return { ok: innerOk, output: enforced.output }
      },
    })
    const summary = [
      r.ok ? `run_code 完成（${r.toolCallCount} 次內部工具呼叫，${r.durationMs}ms）` : r.output,
      r.logs.length ? `\n### log()\n${r.logs.join('\n').slice(0, 1500)}` : '',
      r.ok ? `\n### result\n${r.output.slice(0, 6000)}` : '',
    ]
      .filter(Boolean)
      .join('\n')
    const record: ToolCallRecord = {
      id: uuid(),
      tool: RUN_CODE_TOOL,
      input: { code: String(args.code || '').slice(0, 2000) },
      output: summary.slice(0, 4000),
      ok: r.ok,
      durationMs: r.durationMs,
      timestamp: nowTime(),
    }
    ctx.toolCalls.push(record)
    ctx.cb?.onToolCall?.(record)
    ctx.cb?.onLog?.(
      r.ok ? 'SUCCESS' : 'WARN',
      `run_code ${r.ok ? 'ok' : 'fail'} · ${r.toolCallCount} inner calls (${r.durationMs}ms)`,
    )
    ctx.toolChunks.push(`### tool:run_code\n${summary.slice(0, 2000)}`)
    ctx.messages.push({ role: 'tool', tool_call_id: tc.id, content: summary.slice(0, 8000) })
    return
  }

  if (isPostAuthAgentLevelTool(tc.name) && tc.name === 'delegate_task') {
    const background = args.background === true
    const notifyOnComplete = args.notify_on_complete !== false && args.notifyOnComplete !== false
    const inheritCapabilities = parseInheritCapabilities(args)
    const { parseCapabilityMode } = await import('../hermes/capabilityMode')
    const capabilityMode = parseCapabilityMode(args.capability_mode ?? args.capabilityMode)
    const persona = String(args.persona || '').trim() || undefined
    const isolation = args.isolation === 'worktree' ? ('worktree' as const) : undefined
    // G9 resume_from:引用已完成背景委派的結果作為唯讀上下文
    let resumeContext = ''
    const resumeFrom = String(args.resume_from || args.resumeFrom || '').trim()
    if (resumeFrom) {
      const { getBackgroundJob } = await import('../hermes/backgroundJobs')
      const prev = getBackgroundJob(resumeFrom)
      if (!prev) {
        const msg = `resume_from 失敗:找不到背景委派 ${resumeFrom}(用 delegate_status 查可用 id)。`
        ctx.messages.push({ role: 'tool', tool_call_id: tc.id, content: msg })
        return
      }
      if (prev.status === 'queued' || prev.status === 'running') {
        const msg = `resume_from 失敗:${resumeFrom} 尚未完成(${prev.status})。可先 delegate_status wait=all 等待。`
        ctx.messages.push({ role: 'tool', tool_call_id: tc.id, content: msg })
        return
      }
      resumeContext = [
        `## 前次委派結果(resume_from ${prev.id} · ${prev.status})`,
        `目標:${prev.goal.slice(0, 200)}`,
        prev.summary ? `結果摘要:\n${prev.summary.slice(0, 2400)}` : '(無摘要)',
      ].join('\n')
    }
    const childContext = [resumeContext, args.context ? String(args.context) : '']
      .filter(Boolean)
      .join('\n\n') || undefined
    if (background) {
      const { enqueueBackgroundDelegate } = await import('../hermes/backgroundJobs')
      const job = enqueueBackgroundDelegate(
        ctx.settings,
        {
          goal: String(args.goal || ''),
          context: childContext,
          role: args.role === 'orchestrator' ? 'orchestrator' : 'leaf',
          background: true,
          notifyOnComplete,
          inheritCapabilities,
          capabilityMode,
          persona,
          isolation,
          projectRoot: ctx.projectRoot,
          parentRunId: ctx.runId,
          parentThreadId: ctx.threadId,
          parentPermissionPolicy: ctx.permissionPolicy,
          parentPermissionProjection: ctx.permissionProjection,
          parentMcpAgentId: ctx.mcpAgentId,
        },
        {
          onLog: (m) => ctx.cb?.onLog?.('INFO', m),
          shouldAbort: ctx.cb?.shouldAbort,
        },
      )
      output = `背景委派已排入：${job.id}（notify=${notifyOnComplete}）\n目標：${job.goal}`
      ok = true
    } else {
      // P4: nested leaf via Task run admission (Hermes-aligned single lifecycle)
      const { runTask } = await import('../taskRunCoordinator')
      const goal = String(args.goal || '')
      try {
        const tr = await runTask({
          sourceKind: 'delegate',
          objective: goal,
          extraContext: childContext,
          unattended: true,
          workerThread: true,
          projectRoot: ctx.projectRoot,
          attachedSkills: inheritCapabilities,
          overrides: {
            permissionPolicy: ctx.permissionPolicy,
            permissionProjection: ctx.permissionProjection,
            mcpAgentId: ctx.mcpAgentId,
            preloadCapabilityIds: inheritCapabilities,
          },
          sourceLabel: `delegate:${persona || isolation || capabilityMode || 'leaf'}`,
        })
        const summary = tr.error || tr.result || tr.status || ''
        const success = !tr.error && tr.status !== 'failed' && tr.status !== 'skipped'
        output = success
          ? `委派完成（via runTask · ${tr.runId || tr.threadId || ''}）\n\n${String(summary).slice(0, 4000)}`
          : `委派失敗：${String(summary).slice(0, 2000)}`
        ok = Boolean(success)
      } catch (e) {
        output = `委派失敗：${e instanceof Error ? e.message : String(e)}`
        ok = false
      }
    }
  } else if (tc.name === 'delegate_status') {
    const r = await dispatchRegistered('delegate_status', args, {
      mcpAgentId: ctx.mcpAgentId,
      runId: ctx.runId,
      threadId: ctx.threadId,
      projectRoot: ctx.projectRoot,
    })
    output = r.output
    ok = r.ok
  } else {
    output = `Unknown agent-level tool: ${tc.name}`
    ok = false
  }
  if (tc.name === 'ask_user') ctx.cb?.onQuestionResolved?.()

  try {
    const enforced = enforceToolPayload(
      tc.name,
      output,
      ctx.limits,
      ctx.haltOnPayloadOverflow ? 'halt' : 'truncate',
    )
    if (enforced.truncated) {
      ctx.cb?.onLog?.('WARN', `Supervisor truncated '${tc.name}' payload (${enforced.bytes} bytes)`)
    }
    output = enforced.output
  } catch (e) {
    if (e instanceof SupervisorViolation) {
      ctx.cb?.onLog?.('ERROR', e.message)
      throw e
    }
    throw e
  }

  const durationMs = Date.now() - started
  const record: ToolCallRecord = {
    id: uuid(),
    tool: tc.name,
    input: args,
    output: output.slice(0, 4000),
    ok,
    durationMs,
    timestamp: nowTime(),
  }
  ctx.toolCalls.push(record)
  ctx.cb?.onToolCall?.(record)
  ctx.cb?.onLog?.(ok ? 'SUCCESS' : 'WARN', `tool:${tc.name} ${ok ? 'ok' : 'fail'} (${durationMs}ms)`)
  // P1-D lifecycle hooks (afterTool): audit / notify only
  try {
    const { collectHookRules, evaluateHooks } = await import('../hooks')
    const ev = evaluateHooks(collectHookRules(ctx.settings), {
      point: 'afterTool',
      tool: tc.name,
      toolOk: ok,
      sourceKind: ctx.sourceKind as import('../hooks').HookContext['sourceKind'],
      objective: ctx.objective,
    })
    for (const line of ev.audits) ctx.cb?.onLog?.('INFO', line)
    for (const n of ev.notifications) {
      void window.subagents?.notify?.('SubAgents AI · Hook', n.slice(0, 160))
    }
  } catch {
    /* non-fatal */
  }
  ctx.toolChunks.push(`### tool:${tc.name}\n${output.slice(0, 2000)}`)

  ctx.messages.push({
    role: 'tool',
    tool_call_id: tc.id,
    content: output.slice(0, 8000),
  })
}


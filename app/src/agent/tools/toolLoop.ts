/**
 * Multi-round OpenAI function-calling tool loop.
 * + dynamic MCP tools in schema
 * + blockedTools (delegate leaf isolation)
 * + Capability progressive disclosure (load_capability)
 */

import { v4 as uuid } from 'uuid'
import type { LlmSettings, PermissionProjection, ToolCallRecord } from '../types'
import { chatCompletionWithTools, type ChatMessageExt, type ToolCallRequest } from '../llm'
import { executeTool } from './executor'
import type { ToolName } from './registry'
import { buildOpenAiTools, isToolName, type OpenAiToolDef } from './schemas'
import {
  DEFAULT_SUPERVISOR_LIMITS,
  enforceStepContextBudget,
  enforceToolPayload,
  type SupervisorLimits,
  SupervisorViolation,
} from '../supervisor'
import { listAllMcpTools, mcpCallTool } from '../hermes/mcp'
import { resolveMcpSecretOwnerId } from '../hermes/mcpSecrets'
import { checkToolPermission, type PermissionPolicy } from '../opencode/permissions'
import { mcpServersForAgent, isMcpServerAllowedForAgent } from '../opencode/mcpAccess'
import { authorizeTool } from './toolGuard'
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
} from '../capabilities'
import { runCodeMode, runCodeToolDef } from './codeMode'
import {
  customToolDefs,
  customToolsForSettings,
  executeCustomTool,
  isCustomToolApprovalRequired,
  type ResolvedCustomTool,
} from './customTools'
import type { ChatAttachment } from '../types'
import {
  buildMultimodalUserContent,
  contentPartsToPlainText,
} from '../../lib/chatAttachments'

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

    // OpenCode-style compaction — preserve tool_calls / tool_call_id chain.
    // Skip while vision images are still in the transcript (data URLs + compaction would drop them).
    const hasVisionParts = messages.some(
      (m) =>
        Array.isArray(m.content) &&
        m.content.some((p) => p.type === 'image_url'),
    )
    if (!hasVisionParts && (rounds === 1 || rounds % 2 === 0)) {
      try {
        const { maybeCompactMessages } = await import('../opencode/compaction')
        const flat = messages.map((m) => ({
          role: m.role,
          content:
            typeof m.content === 'string' || m.content == null
              ? m.content
              : contentPartsToPlainText(m.content),
          tool_calls: m.tool_calls,
          tool_call_id: m.tool_call_id,
          name: m.name,
        }))
        const c = await maybeCompactMessages(settings, flat)
        if (c.compacted) {
          messages.length = 0
          for (const m of c.messages) {
            messages.push({
              role: m.role as ChatMessageExt['role'],
              content: m.content,
              tool_calls: m.tool_calls,
              tool_call_id: m.tool_call_id,
              name: m.name,
            })
          }
          cb?.onLog?.('INFO', 'Context compacted (OpenCode-style)')
        }
      } catch {
        /* non-fatal */
      }
    }

    cb?.onLog?.(
      'PROCESS',
      `function-call round ${rounds}/${limits.maxToolRounds} · tools=${tools.length}`,
    )

    // Per-capability model settings (capability bundles model config, v2 style)
    const capModel = activeModelSettings(capState)
    const callSettings = capModel.model ? { ...settings, model: capModel.model } : settings
    const result = await chatCompletionWithTools(callSettings, messages, tools, {
      temperature: capModel.temperature ?? 0.3,
      maxTokens: capModel.maxTokens ?? 1400,
      toolChoice: 'auto',
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

    for (const tc of result.toolCalls) {
      if (cb?.shouldAbort?.()) break
      await executeOneToolCall(tc, {
        limits,
        haltOnPayloadOverflow: opts?.haltOnPayloadOverflow,
        toolCalls,
        toolChunks,
        messages,
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
      })
    }
  }

  cb?.onLog?.('WARN', 'Max tool rounds reached; forcing synthesis')
  messages.push({
    role: 'user',
    content: 'Max tool rounds reached. Produce the final Markdown step output now without more tools.',
  })
  const final = await chatCompletionWithTools(settings, messages, [], {
    temperature: 0.3,
    maxTokens: 1400,
    toolChoice: 'none',
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

  // ── Framework tool: tool_search (no HITL) ──
  if (tc.name === TOOL_SEARCH_TOOL && ctx.capState) {
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

  // ── Framework tool: load_capability (no HITL) ──
  if (tc.name === LOAD_CAPABILITY_TOOL && ctx.capState) {
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
  const auth = await authorizeTool({
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
    onLog: (level, message) => {
      ctx.cb?.onLog?.(level as Parameters<NonNullable<ToolLoopCallbacks['onLog']>>[0], message)
    },
  })
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
  if (tc.name === RUN_CODE_TOOL) {
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
        } else if (!isToolName(name)) {
          innerOut = `Unknown tool: ${name}`
        } else {
          try {
            const er = await executeTool(name as ToolName, innerArgs, {
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

  // Dynamic MCP tool from schema injection
  const mcpRef = ctx.mcpMap.get(tc.name)
  if (mcpRef) {
    const server = (ctx.settings.mcpServers || []).find((s) => s.id === mcpRef.serverId)
    if (!server) {
      output = `MCP server not found: ${mcpRef.serverId}`
      ok = false
    } else if (!isMcpServerAllowedForAgent(ctx.settings, ctx.mcpAgentId, mcpRef.serverId)) {
      output = `MCP server blocked for agent: ${mcpRef.serverId}`
      ok = false
    } else {
      const r = await mcpCallTool(server, mcpRef.toolName, args, ctx.settings)
      output = r.ok ? r.content : r.error || 'MCP failed'
      ok = r.ok
    }
  } else if (custom) {
    const r = await executeCustomTool(custom, args, ctx.settings, {
      runId: ctx.runId,
      projectRoot: ctx.projectRoot,
    })
    output = r.output
    ok = r.ok
  } else if (tc.name === 'delegate_task') {
    const background = args.background === true
    const notifyOnComplete = args.notify_on_complete !== false && args.notifyOnComplete !== false
    const inheritCapabilities = parseInheritCapabilities(args)
    if (background) {
      const { enqueueBackgroundDelegate } = await import('../hermes/backgroundJobs')
      const job = enqueueBackgroundDelegate(
        ctx.settings,
        {
          goal: String(args.goal || ''),
          context: args.context ? String(args.context) : undefined,
          role: args.role === 'orchestrator' ? 'orchestrator' : 'leaf',
          background: true,
          notifyOnComplete,
          inheritCapabilities,
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
      const { runDelegatedTask } = await import('../hermes/delegate')
      // OpenCode-style child session thread (does not steal parent focus)
      let childThreadId: string | undefined
      try {
        const { useThreadStore } = await import('../../store/threadStore')
        const thr = useThreadStore.getState()
        const parentId = thr.activeId
        childThreadId = thr.createThread({
          title: `↳ ${String(args.goal || 'delegate').slice(0, 36)}`,
          agentMode: 'build',
        })
        thr.pushBubble(
          childThreadId,
          'system',
          `Child session · parent=${parentId || '—'} · ${String(args.goal || '').slice(0, 240)}`,
        )
        if (parentId) thr.selectThread(parentId)
      } catch {
        /* non-fatal */
      }
      const r = await runDelegatedTask(
        ctx.settings,
        {
          goal: String(args.goal || ''),
          context: args.context ? String(args.context) : undefined,
          role: args.role === 'orchestrator' ? 'orchestrator' : 'leaf',
          inheritCapabilities,
          parentPermissionPolicy: ctx.permissionPolicy,
          parentPermissionProjection: ctx.permissionProjection,
          parentMcpAgentId: ctx.mcpAgentId,
        },
        {
          onLog: (m) => {
            ctx.cb?.onLog?.('INFO', m)
            if (childThreadId) {
              void import('../../store/threadStore').then(({ useThreadStore }) => {
                useThreadStore.getState().pushBubble(childThreadId!, 'system', m.slice(0, 500))
              })
            }
          },
          shouldAbort: ctx.cb?.shouldAbort,
        },
      )
      if (childThreadId) {
        try {
          const { useThreadStore } = await import('../../store/threadStore')
          useThreadStore
            .getState()
            .pushBubble(
              childThreadId,
              'assistant',
              r.summary.slice(0, 4000) || (r.ok ? '(empty)' : 'failed'),
            )
          useThreadStore
            .getState()
            .setThreadStatus(childThreadId, r.ok ? 'success' : 'failed')
        } catch {
          /* ignore */
        }
      }
      output = r.ok
        ? `委派 ${r.id} 完成 (depth=${r.depth}, ${r.durationMs}ms)${childThreadId ? ` · child=${childThreadId}` : ''}\n\n${r.summary}`
        : `委派失敗：${r.summary}`
      ok = r.ok
      tokensNote(ctx, r.tokensUsed)
    }
  } else if (!isToolName(tc.name)) {
    output = `Unknown tool: ${tc.name}`
    ok = false
  } else {
    try {
      const result = await executeTool(tc.name as ToolName, args, {
        mcpAgentId: ctx.mcpAgentId,
        runId: ctx.runId,
        threadId: ctx.threadId,
        projectRoot: ctx.projectRoot,
      })
      output = result.output
      ok = result.ok
    } catch (e) {
      output = e instanceof Error ? e.message : String(e)
      ok = false
    }
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

function tokensNote(
  ctx: { toolChunks: string[] },
  n: number,
) {
  if (n > 0) ctx.toolChunks.push(`_(child tokens +${n})_`)
}

/**
 * Delegate isolation — Hermes-inspired leaf / orchestrator
 * Leaf: isolated context, restricted tools, no re-delegate
 * Orchestrator: may spawn leaves (depth-limited)
 */

import { v4 as uuid } from 'uuid'
import type { LlmSettings, PermissionPolicy, PermissionProjection, ToolCallRecord } from '../types'
import { withRoleModel } from '../llm'
import { runFunctionCallingLoop } from '../tools/toolLoop'
import { executeTool } from '../tools/executor'
import { buildPromptLayers } from './promptBuilder'
import { compressStepOutputs } from './sessionSearch'

export type DelegateRole = 'leaf' | 'orchestrator'

export interface DelegateTaskInput {
  goal: string
  context?: string
  role?: DelegateRole
  /** Max tool rounds inside child */
  maxRounds?: number
  /** Fire-and-forget (Phase 5) */
  background?: boolean
  /** Desktop notify when background task finishes (default true if background) */
  notifyOnComplete?: boolean
  /**
   * Explicit capability ids to preload in the child (parent model chooses).
   * Isolation by default; only listed packs are inherited (G4).
   */
  inheritCapabilities?: string[]
  /** Parent run trace (audit / hooks) */
  parentRunId?: string
  /** Parent entry source for hooks (delegate / schedule / …) */
  sourceKind?: string
  /** Per-run project pin (must not use UI store alone) */
  projectRoot?: string
  /** Parent policy is inherited only restrictively by the child. */
  parentPermissionPolicy?: PermissionPolicy
  parentPermissionProjection?: PermissionProjection
  /** Restrictive MCP allowlist inherited from the parent OpenCode agent. */
  parentMcpAgentId?: string
}

export interface DelegateTaskResult {
  id: string
  role: DelegateRole
  goal: string
  ok: boolean
  summary: string
  tokensUsed: number
  toolCalls: ToolCallRecord[]
  durationMs: number
  depth: number
}

/**
 * Depth = nesting of parent→child (stack). Concurrent = parallel leaves at any depth.
 * Previously both shared one counter so parallel leaves burned depth budget incorrectly.
 */
export class DelegationBudget {
  private concurrent = 0
  constructor(
    public maxDepth = 2,
    public maxConcurrent = 3,
  ) {}

  /** Acquire a slot at parentDepth+1. Returns child depth or null if denied. */
  tryEnter(parentDepth = 0): number | null {
    if (parentDepth >= this.maxDepth) return null
    if (this.concurrent >= this.maxConcurrent) return null
    this.concurrent += 1
    return parentDepth + 1
  }

  /** @deprecated use tryEnter(parentDepth) */
  enter(): boolean {
    return this.tryEnter(0) != null
  }

  leave() {
    this.concurrent = Math.max(0, this.concurrent - 1)
  }

  currentDepth() {
    // Best-effort: concurrent leaves report as depth 1 from root
    return this.concurrent > 0 ? 1 : 0
  }

  currentConcurrent() {
    return this.concurrent
  }
}

export const globalDelegationBudget = new DelegationBudget(2, 3)

/**
 * Run an isolated subagent for a single goal.
 * Does NOT share parent message history — only the goal + optional context string.
 */
export async function runDelegatedTask(
  settings: LlmSettings,
  input: DelegateTaskInput,
  opts?: {
    budget?: DelegationBudget
    onLog?: (msg: string) => void
    shouldAbort?: () => boolean
    parentDepth?: number
  },
): Promise<DelegateTaskResult> {
  const id = `dlg_${uuid().slice(0, 8)}`
  const role: DelegateRole = input.role || 'leaf'
  if (settings.subAgentsEnabled !== true) {
    return {
      id,
      role,
      goal: input.goal,
      ok: false,
      summary: 'Sub Agent 功能目前已關閉，委派未啟動。請到設定 → 角色模型開啟。',
      tokensUsed: 0,
      toolCalls: [],
      durationMs: 0,
      depth: opts?.parentDepth ?? 0,
    }
  }
  const budget = opts?.budget || globalDelegationBudget
  const t0 = Date.now()
  const parentDepth = opts?.parentDepth ?? 0

  const depth = budget.tryEnter(parentDepth)
  if (depth == null) {
    return {
      id,
      role,
      goal: input.goal,
      ok: false,
      summary: `委派被拒：已達深度/並行上限 (depth≤${budget.maxDepth}, concurrent≤${budget.maxConcurrent})`,
      tokensUsed: 0,
      toolCalls: [],
      durationMs: 0,
      depth: parentDepth,
    }
  }

  opts?.onLog?.(`[delegate ${id}] 啟動 ${role} depth=${depth} goal=${input.goal.slice(0, 80)}`)

  try {
    // Isolated prompt: NO parent full transcript
    const layers = buildPromptLayers({
      role: role === 'orchestrator' ? 'orchestrator' : 'analyst',
      objective: input.goal,
      settings,
      extraContext: [
        '## 隔離子代理（Delegate Isolation）',
        role === 'leaf'
          ? '你是 leaf worker：只能完成指派目標，不可再委派，不可寫入新技能。'
          : '你是 orchestrator：可規劃後產出摘要；本實作中不再巢狀委派以控制成本。',
        input.context ? `## 父層提供的唯讀上下文\n${input.context.slice(0, 3000)}` : '',
      ]
        .filter(Boolean)
        .join('\n'),
    })

    const childSettings = withRoleModel(
      settings,
      role === 'orchestrator' ? 'orchestrator' : 'analyst',
    )

    if (settings.enabled && settings.apiKey) {
      const blockedTools =
        role === 'leaf'
          ? [
              'skill_save',
              'delegate_task',
              'run_code',
              'bash',
              'workspace_write',
              'workspace_download',
              'workspace_mkdir',
              'workspace_move',
              'workspace_delete',
              'design_system_create',
              'design_system_update',
              'design_artifact_register',
              'design_artifact_export',
              'message_send',
              'mcp_call',
            ]
          : ['delegate_task']
      // Baseline + optional parent-chosen inherit_capabilities (G4)
      const baseline = ['core-utils', 'web-research', 'memory']
      const inherited = (input.inheritCapabilities || [])
        .map((s) => String(s || '').trim())
        .filter(Boolean)
        .slice(0, 12)
      const preloadCapabilityIds = [...new Set([...baseline, ...inherited])]
      // Pin child tools to parent project (scheduler A while UI shows B)
      try {
        const { setRunProjectRoot, setRunId } = await import('../tools/runContext')
        if (input.projectRoot) setRunProjectRoot(input.projectRoot)
        if (input.parentRunId) setRunId(`${input.parentRunId}>${id}`)
      } catch {
        /* ignore */
      }
      const loop = await runFunctionCallingLoop(
        childSettings,
        {
          role: role === 'leaf' ? 'leaf-worker' : 'sub-orchestrator',
          objective: input.goal,
          step: `完成隔離任務：${input.goal}`,
          context: layers.full.slice(0, 10_000),
        },
        {
          limits: {
            maxToolPayloadBytes: (settings.maxToolPayloadKb || 50) * 1024,
            maxStepContextBytes: 150_000,
            maxToolRounds: input.maxRounds || Math.min(3, settings.maxToolRounds || 4),
          },
          callbacks: {
            shouldAbort: opts?.shouldAbort,
            onLog: (level, message) => opts?.onLog?.(`[${id}] ${level} ${message}`),
          },
          haltOnPayloadOverflow: settings.haltOnPayloadOverflow,
          extraToolsNote:
            role === 'leaf'
              ? `LEAF 限制：只讀 brief/artifact evidence；禁止寫 workspace、bash、skill_save、message_send、MCP write、再次 delegate_task / run_code。獨立上下文。preload caps=[${preloadCapabilityIds.join(', ')}]`
              : '子 orchestrator：本層禁止再 delegate 以控制深度。',
          blockedTools,
          permissionPolicy: input.parentPermissionPolicy,
          permissionProjection: input.parentPermissionProjection,
          mcpAgentId: input.parentMcpAgentId,
          preloadCapabilityIds,
          includeMcpTools: role === 'leaf' ? false : settings.mcpEnabled,
          unattended: true,
          hitlTimeoutMs: 45_000,
          sourceKind: (input.sourceKind as import('../hooks').HookContext['sourceKind']) || 'delegate',
          objective: input.goal,
          projectRoot: input.projectRoot,
        },
      )

      return {
        id,
        role,
        goal: input.goal,
        ok: loop.toolCalls.length === 0 || loop.toolCalls.some((t) => t.ok),
        summary: loop.content,
        tokensUsed: loop.tokensUsed,
        toolCalls: loop.toolCalls,
        durationMs: Date.now() - t0,
        depth,
      }
    }

    // Simulation path without LLM
    const chunks: string[] = []
    for (const tool of ['datetime_now', 'memory_search'] as const) {
      const r = await executeTool(tool, tool === 'memory_search' ? { query: input.goal } : {})
      chunks.push(`### ${tool}\n${r.output.slice(0, 500)}`)
    }
    const summary = [
      `### 隔離子代理摘要 (${role})`,
      `目標：${input.goal}`,
      compressStepOutputs(chunks, 2000),
      '（模擬模式：未呼叫 LLM）',
    ].join('\n\n')

    return {
      id,
      role,
      goal: input.goal,
      ok: true,
      summary,
      tokensUsed: 0,
      toolCalls: [],
      durationMs: Date.now() - t0,
      depth,
    }
  } catch (e) {
    return {
      id,
      role,
      goal: input.goal,
      ok: false,
      summary: e instanceof Error ? e.message : String(e),
      tokensUsed: 0,
      toolCalls: [],
      durationMs: Date.now() - t0,
      depth,
    }
  } finally {
    budget.leave()
  }
}

export async function runDelegateBatch(
  settings: LlmSettings,
  tasks: DelegateTaskInput[],
  opts?: {
    onLog?: (msg: string) => void
    shouldAbort?: () => boolean
  },
): Promise<DelegateTaskResult[]> {
  const max = globalDelegationBudget.maxConcurrent
  const results: DelegateTaskResult[] = []
  // Simple pool
  for (let i = 0; i < tasks.length; i += max) {
    if (opts?.shouldAbort?.()) break
    const slice = tasks.slice(i, i + max)
    const batch = await Promise.all(
      slice.map((t) => runDelegatedTask(settings, { ...t, role: t.role || 'leaf' }, opts)),
    )
    results.push(...batch)
  }
  return results
}

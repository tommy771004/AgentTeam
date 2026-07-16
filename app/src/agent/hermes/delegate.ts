/**
 * Delegate isolation — Hermes-inspired leaf / orchestrator
 * Leaf: isolated context, restricted tools, no re-delegate
 * Orchestrator: may spawn leaves (depth-limited)
 */

import { v4 as uuid } from 'uuid'
import type { LlmSettings, PermissionPolicy, PermissionProjection, ToolCallRecord } from '../types'
import { resolveRoleModel } from '../llm'
import { runFunctionCallingLoop } from '../tools/toolLoop'
import { executeTool } from '../tools/executor'
import { buildPromptLayers } from './promptBuilder'
import { compressStepOutputs } from './sessionSearch'
import {
  blockedToolsForCapabilityMode,
  type DelegateCapabilityMode,
} from './capabilityMode'

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
  /**
   * G9 粗粒度工具篩選(grok capability_mode):read-only / read-write /
   * execute / all。疊加在角色 blockedTools 之上,只會更嚴不會放寬。
   */
  capabilityMode?: DelegateCapabilityMode
  /**
   * G9 persona overlay:settings.delegatePersonas 中的具名行為疊層。
   * 找不到指名的 persona 時 spawn 直接失敗(grok 同款,避免靜默降級)。
   */
  persona?: string
  /** G9 resume:接續已完成背景委派的結果脈絡(其摘要作為唯讀上下文)。 */
  resumeFrom?: string
  /** G9 隔離:worktree 模式在獨立 git worktree 內工作(僅 Electron)。 */
  isolation?: 'none' | 'worktree'
  /** Parent run trace (audit / hooks) */
  parentRunId?: string
  /** Source thread for background completion injection. */
  parentThreadId?: string
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

  // G9 persona:找不到指名 persona 即失敗(不靜默降級)
  const persona = input.persona
    ? settings.delegatePersonas?.[input.persona]
    : undefined
  if (input.persona && (!persona || !persona.instructions?.trim())) {
    budget.leave()
    return {
      id,
      role,
      goal: input.goal,
      ok: false,
      summary: `委派失敗:persona「${input.persona}」不存在或沒有 instructions(設定 → 角色模型管理)。`,
      tokensUsed: 0,
      toolCalls: [],
      durationMs: Date.now() - t0,
      depth,
    }
  }

  opts?.onLog?.(`[delegate ${id}] 啟動 ${role} depth=${depth} goal=${input.goal.slice(0, 80)}${input.persona ? ` persona=${input.persona}` : ''}`)

  // G7 delegateStart hook 事件(被動:log / notify)
  const emitDelegateHook = async (point: 'delegateStart' | 'delegateEnd', ok?: boolean) => {
    try {
      const { collectHookRules, evaluateHooks } = await import('../hooks')
      const ev = evaluateHooks(collectHookRules(settings), {
        point,
        tool: 'delegate_task',
        toolOk: ok,
        objective: input.goal,
      })
      for (const line of ev.audits) opts?.onLog?.(line)
      for (const n of ev.notifications) {
        void window.subagents?.notify?.('SubAgents AI · Hook', n.slice(0, 160))
      }
    } catch {
      /* non-fatal */
    }
  }
  await emitDelegateHook('delegateStart')
  const finish = async (r: DelegateTaskResult): Promise<DelegateTaskResult> => {
    await emitDelegateHook('delegateEnd', r.ok)
    return r
  }

  try {
    // Isolated prompt: NO parent full transcript
    // G9 worktree 隔離(僅 Electron + git 專案;建立失敗回退共用 workspace)
    let childProjectRoot = input.projectRoot
    let worktreeNote = ''
    if (input.isolation === 'worktree' && input.projectRoot) {
      try {
        const wt = await window.subagents?.project?.worktreeCreate?.(
          input.projectRoot,
          settings.gitBranchPrefix || 'agent/',
        )
        if (wt?.ok && wt.path) {
          childProjectRoot = wt.path
          worktreeNote = `${wt.path}（branch ${wt.branch || '—'}）`
          opts?.onLog?.(`[delegate ${id}] worktree 隔離：${wt.path}`)
        } else {
          opts?.onLog?.(
            `[delegate ${id}] worktree 建立失敗（${wt?.error || '環境不支援'}），回退共用 workspace`,
          )
        }
      } catch (e) {
        opts?.onLog?.(
          `[delegate ${id}] worktree 建立異常（${e instanceof Error ? e.message : e}），回退共用 workspace`,
        )
      }
    }

    const layers = buildPromptLayers({
      role: role === 'orchestrator' ? 'orchestrator' : 'analyst',
      objective: input.goal,
      settings,
      extraContext: [
        '## 隔離子代理（Delegate Isolation）',
        role === 'leaf'
          ? '你是 leaf worker：只能完成指派目標，不可再委派，不可寫入新技能。'
          : '你是 orchestrator：可規劃後產出摘要；本實作中不再巢狀委派以控制成本。',
        // G9 persona 疊層:只影響行為指示,不放寬工具面
        persona
          ? `## Persona：${input.persona}\n${persona.instructions.trim().slice(0, 2000)}`
          : '',
        worktreeNote
          ? `## Worktree 隔離\n你在獨立 git worktree 工作：${worktreeNote}。變更不會影響主工作區。`
          : '',
        input.context ? `## 父層提供的唯讀上下文\n${input.context.slice(0, 3000)}` : '',
      ]
        .filter(Boolean)
        .join('\n'),
    })

    // G9 模型優先序:role 覆寫 > persona.model > 父 run 模型
    const roleName = role === 'orchestrator' ? 'orchestrator' : 'analyst'
    const roleResolved = resolveRoleModel(settings, roleName)
    const childModel =
      roleResolved.source === 'role'
        ? roleResolved.model
        : persona?.model?.trim() || roleResolved.model
    const childSettings: LlmSettings = { ...settings, model: childModel }

    if (settings.enabled && settings.apiKey) {
      const roleBlocked =
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
      // G9 capability_mode 疊加(只更嚴,不放寬 role 既有封鎖)
      const blockedTools = [
        ...new Set([
          ...roleBlocked,
          ...blockedToolsForCapabilityMode(input.capabilityMode),
        ]),
      ]
      // Baseline + optional parent-chosen inherit_capabilities (G4)
      const baseline = ['core-utils', 'web-research', 'memory']
      const inherited = (input.inheritCapabilities || [])
        .map((s) => String(s || '').trim())
        .filter(Boolean)
        .slice(0, 12)
      const preloadCapabilityIds = [...new Set([...baseline, ...inherited])]
      // Keep child identity explicit. A module-global run context would race
      // when two parent runs delegate at the same time.
      const childRunId = `${input.parentRunId || 'delegate'}>${id}`
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
          projectRoot: childProjectRoot,
          runId: childRunId,
          threadId: input.parentThreadId,
        },
      )

      return finish({
        id,
        role,
        goal: input.goal,
        ok: loop.toolCalls.length === 0 || loop.toolCalls.some((t) => t.ok),
        summary: worktreeNote
          ? `${loop.content}\n\n〔worktree 隔離:變更在 ${worktreeNote},檢視後可套用回主工作區(project.worktreeApply)或移除〕`
          : loop.content,
        tokensUsed: loop.tokensUsed,
        toolCalls: loop.toolCalls,
        durationMs: Date.now() - t0,
        depth,
      })
    }

    // Simulation path without LLM
    const chunks: string[] = []
    for (const tool of ['datetime_now', 'memory_search'] as const) {
      const r = await executeTool(
        tool,
        tool === 'memory_search' ? { query: input.goal } : {},
        {
          runId: `${input.parentRunId || 'delegate'}>${id}`,
          threadId: input.parentThreadId,
          projectRoot: input.projectRoot,
        },
      )
      chunks.push(`### ${tool}\n${r.output.slice(0, 500)}`)
    }
    const summary = [
      `### 隔離子代理摘要 (${role})`,
      `目標：${input.goal}`,
      compressStepOutputs(chunks, 2000),
      '（模擬模式：未呼叫 LLM）',
    ].join('\n\n')

    return finish({
      id,
      role,
      goal: input.goal,
      ok: true,
      summary,
      tokensUsed: 0,
      toolCalls: [],
      durationMs: Date.now() - t0,
      depth,
    })
  } catch (e) {
    return finish({
      id,
      role,
      goal: input.goal,
      ok: false,
      summary: e instanceof Error ? e.message : String(e),
      tokensUsed: 0,
      toolCalls: [],
      durationMs: Date.now() - t0,
      depth,
    })
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

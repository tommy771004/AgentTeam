/**
 * Shared tool permission + HITL ask — used by FC toolLoop AND heuristic
 * (via invokeGatedTool authorize adapter).
 *
 * Decision layers 1–8 live in approvalDecision.decide() (effect-as-data).
 * This module is the adapter: resolve dynamic inputs, call decide(), apply
 * events/logs, then perform layer 9 HITL ask when needed.
 *
 * Auth+execute combo previously lived in guardAndExecuteTool; heuristic now
 * uses authorizeTool + execute via invokeGatedTool. Do not reintroduce a
 * parallel auth+execute entry without a real caller.
 */
import type { LlmSettings, PermissionPolicy, PermissionProjection } from '../types'
import {
  decide,
  decideApprovalNeed,
  effectiveApprovalMode,
  type DecisionHookRule,
} from './approvalDecision.ts'
import {
  isSideEffectTool,
  isSubDesignReadonlyBashCommand,
  isSubDesignWritableBashCommand,
  SIDE_EFFECT_TOOLS,
} from './toolGuardShared.ts'

export type AuthorizeResult =
  | { allowed: true }
  | { allowed: false; output: string }

// Re-export pure helpers so existing import paths keep working.
export {
  decideApprovalNeed,
  effectiveApprovalMode,
  isSideEffectTool,
  isSubDesignReadonlyBashCommand,
  isSubDesignWritableBashCommand,
  SIDE_EFFECT_TOOLS,
}

/**
 * permissionDenied hook 事件(G7 部分):任何 deny(pattern／policy／
 * hook／使用者拒絕)都廣播給宣告式 hooks,僅 log / notify(被動觀察,
 * 供稽核與 denial-ratio 統計),不影響已定案的拒絕。
 */
async function emitPermissionDenied(
  settings: LlmSettings,
  ctx: { sourceKind?: string; objective?: string; runId?: string },
  tool: string,
  reason: string,
  onLog?: (level: string, message: string) => void,
): Promise<void> {
  try {
    const { collectHookRules, evaluateHooks } = await import('../hooks')
    const ev = evaluateHooks(collectHookRules(settings), {
      point: 'permissionDenied',
      tool,
      sourceKind: ctx.sourceKind as import('../hooks').HookContext['sourceKind'],
      objective: ctx.objective,
      reason,
    })
    for (const line of ev.audits) onLog?.('INFO', line)
    for (const n of ev.notifications) {
      void window.subagents?.notify?.('SubAgents AI · Hook', n.slice(0, 160))
    }
  } catch {
    /* hooks unavailable — never block on hook infra */
  }
  // G11 denial 記帳(denial ratio 是 approvalMode / allowlist 的調整回饋)
  try {
    const { bumpRunMetric } = await import('../metrics')
    bumpRunMetric(ctx.runId, 'toolDenials')
  } catch {
    /* metrics must never block */
  }
}

function applyDecisionLogs(
  logs: { level: string; message: string }[],
  onLog?: (level: string, message: string) => void,
): void {
  for (const line of logs) onLog?.(line.level, line.message)
}

/**
 * Deny / ask only — no execute. Shared by FC (MCP/delegate after) and heuristic.
 */
export async function authorizeTool(opts: {
  tool: string
  input: Record<string, unknown>
  settings: LlmSettings
  permissionPolicy?: PermissionPolicy
  permissionProjection?: PermissionProjection
  blockedTools?: string[]
  /** Capability-declared approvalTools → always HITL ask (Pydantic v2 style) */
  forceAsk?: boolean
  /** Arbitrary-named side-effect tool (custom http/bash template) — approvalMode 'always' must ask */
  sideEffect?: boolean
  /**
   * HITL timeout ms. When set (or unattended), unresolved asks auto-deny
   * so scheduler/webhook cannot hang an unattended run overnight.
   */
  hitlTimeoutMs?: number
  unattended?: boolean
  runId?: string
  threadId?: string
  /** Lifecycle hook context (P1-D) */
  sourceKind?: string
  objective?: string
  onLog?: (level: string, message: string) => void
}): Promise<AuthorizeResult> {
  const { tool, input, settings, permissionPolicy, permissionProjection, blockedTools, onLog } = opts

  // ── Resolve dynamic inputs for pure decide() ──
  let planMode: { active: false } | { active: true; allowed: boolean; reason?: string } = {
    active: false,
  }
  if (opts.runId) {
    try {
      const { isPlanModeActive, planModeToolDecision } = await import('../planMode')
      if (isPlanModeActive(opts.runId)) {
        const d = planModeToolDecision(tool, input, opts.sideEffect === true)
        planMode = { active: true, allowed: d.allowed, reason: d.reason }
      }
    } catch {
      /* plan mode module unavailable — never block on infra */
    }
  }

  let subDesign: { selectedDirectionId?: string | null } | null = null
  try {
    const { useSubDesignStore } = await import('../../store/subDesignStore')
    const runThreadId = opts.threadId
    const brief = runThreadId ? useSubDesignStore.getState().findByThreadId(runThreadId) : null
    if (brief) subDesign = { selectedDirectionId: brief.selectedDirectionId }
  } catch {
    /* Optional SubDesign store is unavailable in pure/unit contexts. */
  }

  let resolveBash:
    | ((candidate: string, fallback: 'allow' | 'ask' | 'deny') => 'allow' | 'ask' | 'deny')
    | undefined
  if (tool === 'bash' || (tool === 'monitor' && String(input.action || '') === 'start')) {
    let agentId: string | undefined
    try {
      const { useThreadStore } = await import('../../store/threadStore')
      const thr = useThreadStore.getState()
      const runThreadId = opts.threadId
      const t = thr.threads.find((x) => x.id === (runThreadId || thr.activeId))
      agentId = t?.agentMode
    } catch {
      /* ignore */
    }
    try {
      const { resolveBashAction } = await import('../opencode/agentRegistry')
      resolveBash = (candidate, fb) => resolveBashAction(agentId, candidate, fb)
    } catch {
      /* bash resolver unavailable — decide() falls back to bashRequireAsk */
    }
  }

  let hookRules: DecisionHookRule[] | undefined
  try {
    const { collectHookRules } = await import('../hooks')
    hookRules = collectHookRules(settings) as DecisionHookRule[]
  } catch {
    /* hooks unavailable — never block execution on hook infra */
  }

  const decision = decide({
    tool,
    args: input,
    subAgentsEnabled: settings.subAgentsEnabled,
    blockedTools,
    planMode,
    subDesign,
    permissionPolicy,
    permissionProjection,
    forceAsk: opts.forceAsk,
    sideEffect: opts.sideEffect,
    unattended: opts.unattended,
    approvalMode: settings.approvalMode,
    bashRequireAsk: settings.bashRequireAsk,
    resolveBash,
    hookRules,
    sourceKind: opts.sourceKind,
    objective: opts.objective,
  })

  applyDecisionLogs(decision.logs, onLog)

  // Emit permissionDenied observability for every deny (including gates that
  // previously skipped it — sub-agent / blockedTools / SubDesign).
  for (const ev of decision.events) {
    if (ev.kind === 'permissionDenied') {
      await emitPermissionDenied(settings, opts, ev.tool, ev.reason, onLog)
    }
  }

  if (decision.verdict === 'deny') {
    // Prefer the human-facing log message (last WARN) for the tool output string.
    const warn = [...decision.logs].reverse().find((l) => l.level === 'WARN')
    const msg =
      decision.reason === 'hook_deny'
        ? `工具被 hook 政策拒絕：${(decision.events[0]?.reason || '').replace(/^hook deny：/, '') || tool}`
        : warn?.message || `工具被拒絕：${tool}`
    return { allowed: false, output: msg }
  }

  if (decision.verdict === 'ask' && decision.askSpec) {
    try {
      const { bumpRunMetric } = await import('../metrics')
      bumpRunMetric(opts.runId, 'toolAsks')
    } catch {
      /* metrics must never block */
    }
    const timeoutMs =
      opts.hitlTimeoutMs ??
      (opts.unattended ? 45_000 : 90_000)
    onLog?.(
      'AWAIT',
      `權限 ask：${tool} — 等待使用者核准…（${Math.round(timeoutMs / 1000)}s 逾時自動拒絕${opts.unattended ? ' · 無人值守' : ''}）`,
    )
    try {
      const { usePermissionAskStore } = await import('../../store/permissionAskStore')
      const hitl = await usePermissionAskStore.getState().requestAsk({
        threadId: opts.threadId,
        runId: opts.runId,
        tool,
        args: input,
        reason: decision.askSpec.reason,
        timeoutMs,
      })
      if (hitl === 'deny') {
        const msg = `使用者拒絕或逾時拒絕工具：${tool}`
        onLog?.('WARN', msg)
        await emitPermissionDenied(settings, opts, tool, msg, onLog)
        return { allowed: false, output: msg }
      }
      onLog?.('SUCCESS', `使用者核准：${tool}`)
    } catch (e) {
      const msg = `ask 權限失敗：${e instanceof Error ? e.message : e}`
      onLog?.('ERROR', msg)
      return { allowed: false, output: msg }
    }
  }

  return { allowed: true }
}

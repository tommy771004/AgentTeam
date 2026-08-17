/**
 * Approval Decision — pure composed verdict for one tool invocation.
 *
 * Layers 1–8 of authorizeTool live here as effect-as-data. Layer 9 (HITL ask)
 * and real side effects (notify / metrics / log dispatch) stay in toolGuard.
 *
 * Ordering is part of the meaning: hook deny wins over everything; capability
 * forceAsk survives approvalMode 'full'; bash segment allow clears a prior
 * policy ask (documented quirk, preserved).
 *
 * Leaf module: only imports other pure leaves so smoke can true-import under
 * node --experimental-strip-types (no bundler).
 */
import type {
  ApprovalMode,
  PermissionPolicy,
  PermissionProjection,
} from '../types.ts'
import {
  checkProjectedToolPermission,
  checkToolPermission,
} from '../opencode/toolPermissionMap.ts'
import { decideBashAction, type BashPermissionAction } from './shellCommandParser.ts'
import { isSideEffectTool, isSubDesignWritableBashCommand } from './toolGuardShared.ts'

export type ApprovalVerdict = 'allow' | 'deny' | 'ask'

export type ApprovalLog = {
  level: string
  message: string
}

export type ApprovalEvent = {
  kind: 'permissionDenied'
  tool: string
  reason: string
}

export type AskSpec = {
  tool: string
  reason: string
}

export type ApprovalDecision = {
  verdict: ApprovalVerdict
  /** Short machine-ish reason class for tests + audit. */
  reason: string
  logs: ApprovalLog[]
  events: ApprovalEvent[]
  askSpec?: AskSpec
}

export type BashResolveFn = (
  candidate: string,
  fallback: BashPermissionAction,
) => BashPermissionAction

/** Pre-resolved plan-mode gate (adapter checks isPlanModeActive + planModeToolDecision). */
export type PlanModeInput =
  | { active: false }
  | { active: true; allowed: boolean; reason?: string }

/** SubDesign brief slice needed for the direction gate. */
export type SubDesignGateInput = {
  selectedDirectionId?: string | null
} | null

/**
 * Minimal hook rule shape for beforeTool evaluation.
 * Compatible with hooks.HookRule — callers pass through collectHookRules output.
 */
export type DecisionHookRule = {
  id: string
  point: string
  match?: {
    tool?: string
    sourceKind?: string[]
    objectiveIncludes?: string
  }
  action: string
  reason?: string
  enabled?: boolean
  pluginId?: string
}

export type DecideInput = {
  tool: string
  args: Record<string, unknown>
  /** settings.subAgentsEnabled */
  subAgentsEnabled?: boolean
  blockedTools?: string[]
  planMode?: PlanModeInput
  subDesign?: SubDesignGateInput
  permissionPolicy?: PermissionPolicy
  permissionProjection?: PermissionProjection
  forceAsk?: boolean
  sideEffect?: boolean
  unattended?: boolean
  approvalMode?: ApprovalMode
  /** settings.bashRequireAsk — default true when undefined */
  bashRequireAsk?: boolean
  /** Segment-level bash permission resolver (agent allowlist). */
  resolveBash?: BashResolveFn
  hookRules?: DecisionHookRule[]
  sourceKind?: string
  objective?: string
}

const SUBDESIGN_WRITE_TOOLS = new Set([
  'workspace_write',
  'workspace_download',
  'workspace_mkdir',
  'workspace_move',
  'workspace_delete',
  'design_system_create',
  'design_system_update',
  'design_artifact_export',
  'design_artifact_patch',
  'design_artifact_tweak',
  'design_artifact_capture',
  'design_artifact_lint',
])

// Permission checks: shared pure leaf toolPermissionMap (same as FC path).

// ── pure beforeTool hook eval (mirror hooks.evaluateHooks for leaf purity) ──

function evaluateBeforeTool(
  rules: DecisionHookRule[],
  tool: string,
  sourceKind?: string,
  objective?: string,
): {
  deny?: { reason: string }
  forceAsk: boolean
  audits: string[]
} {
  const out: { deny?: { reason: string }; forceAsk: boolean; audits: string[] } = {
    forceAsk: false,
    audits: [],
  }
  for (const rule of rules) {
    if (rule.enabled === false) continue
    if (rule.point !== 'beforeTool') continue
    const m = rule.match
    if (m) {
      if (m.tool) {
        const t = tool || ''
        const ok = m.tool.endsWith('*')
          ? t.startsWith(m.tool.slice(0, -1))
          : t === m.tool
        if (!ok) continue
      }
      if (m.sourceKind?.length && (!sourceKind || !m.sourceKind.includes(sourceKind))) {
        continue
      }
      if (
        m.objectiveIncludes &&
        !(objective || '').toLowerCase().includes(m.objectiveIncludes.toLowerCase())
      ) {
        continue
      }
    }
    const label = `[hook:${rule.id}${rule.pluginId ? `@${rule.pluginId}` : ''}]`
    switch (rule.action) {
      case 'deny':
        if (!out.deny) {
          out.deny = { reason: rule.reason || `被 hook ${rule.id} 拒絕` }
        }
        out.audits.push(`${label} deny：${rule.reason || tool}`)
        break
      case 'require-approval':
        out.forceAsk = true
        out.audits.push(`${label} require-approval：${tool}`)
        break
      case 'log':
        out.audits.push(`${label} ${rule.reason || 'beforeTool matched'}`)
        break
      case 'notify':
        out.audits.push(`${label} notify`)
        break
    }
  }
  return out
}

export function effectiveApprovalMode(
  mode: ApprovalMode | undefined,
  unattended: boolean | undefined,
): ApprovalMode {
  const m = mode || 'auto'
  if (m === 'full' && unattended) return 'auto'
  return m
}

/**
 * Pure decision core for approvalMode after base signals are gathered.
 * Deny checks happen before this and always win.
 */
export function decideApprovalNeed(
  mode: ApprovalMode,
  tool: string,
  baseNeedAsk: boolean,
  sideEffectHint = false,
): boolean {
  if (mode === 'full') return false
  if (mode === 'always') return baseNeedAsk || sideEffectHint || isSideEffectTool(tool)
  return baseNeedAsk
}

function isMcpWriteTool(tool: string): boolean {
  return (
    (tool.startsWith('mcp_') || tool === 'mcp_call') &&
    /create|delete|update|write|remove|destroy|unlink|post|put|patch|set_|insert|drop/i.test(
      tool,
    )
  )
}

function deny(
  tool: string,
  reason: string,
  msg: string,
  logs: ApprovalLog[],
  events: ApprovalEvent[],
): ApprovalDecision {
  logs.push({ level: 'WARN', message: msg })
  events.push({ kind: 'permissionDenied', tool, reason: msg })
  return { verdict: 'deny', reason, logs, events }
}

/**
 * Compose the full Approval Decision for one tool call (layers 1–8).
 * Does not perform HITL; when verdict is 'ask', askSpec describes the ask.
 */
export function decide(input: DecideInput): ApprovalDecision {
  const tool = input.tool
  const args = input.args || {}
  const logs: ApprovalLog[] = []
  const events: ApprovalEvent[] = []

  // 1. Sub-agent feature gate
  if (
    input.subAgentsEnabled !== true &&
    (tool === 'delegate_task' || tool === 'delegate_status')
  ) {
    return deny(
      tool,
      'sub_agent_gate',
      `Sub Agent 功能目前已關閉：${tool}`,
      logs,
      events,
    )
  }

  // 2. Isolation blockedTools
  const blocked = new Set(input.blockedTools || [])
  if (blocked.has(tool)) {
    return deny(
      tool,
      'blocked_tools',
      `工具被隔離策略封鎖：${tool}`,
      logs,
      events,
    )
  }

  // 3. Plan mode (stronger than full access)
  if (input.planMode?.active) {
    if (!input.planMode.allowed) {
      const msg = input.planMode.reason || `Plan mode 拒絕：${tool}`
      return deny(tool, 'plan_mode', msg, logs, events)
    }
  }

  // 4. SubDesign direction gate
  if (SUBDESIGN_WRITE_TOOLS.has(tool) || tool === 'bash') {
    const brief = input.subDesign
    const writeBlocked =
      tool !== 'bash' || isSubDesignWritableBashCommand(String(args.command || ''))
    if (brief && !brief.selectedDirectionId && writeBlocked) {
      return deny(
        tool,
        'subdesign_gate',
        `SubDesign direction gate：請先選定 direction，再使用 ${tool}。`,
        logs,
        events,
      )
    }
  }

  // 5. Projection + policy + forceAsk base
  let needAsk = input.forceAsk === true
  const projected = checkProjectedToolPermission(
    input.permissionProjection,
    tool,
    args,
  )
  if (input.permissionProjection?.unsupported.length) {
    logs.push({
      level: 'WARN',
      message: `OpenCode unsupported permission keys：${input.permissionProjection.unsupported.join(', ')}`,
    })
  }
  if (projected === 'deny') {
    return deny(tool, 'projection_deny', `OpenCode permission deny：${tool}`, logs, events)
  }
  if (projected === 'ask') needAsk = true

  if (input.permissionPolicy) {
    const act = checkToolPermission(input.permissionPolicy, tool)
    if (act === 'deny') {
      return deny(
        tool,
        'policy_deny',
        `權限 deny：${tool}（目前 Agent 模式禁止此工具，可切換 Build）`,
        logs,
        events,
      )
    }
    if (act === 'ask') needAsk = true
  }

  // 6. Bash / monitor segment-level rules
  // Quirk preserved: segment allow clears a prior policy ask (needAsk = false).
  if (tool === 'bash' || (tool === 'monitor' && String(args.action || '') === 'start')) {
    const cmd = String(args.command || '')
    if (input.resolveBash) {
      const fallback: BashPermissionAction =
        input.bashRequireAsk !== false || needAsk ? 'ask' : 'allow'
      const decision = decideBashAction(cmd, input.resolveBash, fallback)
      if (decision.action === 'deny') {
        return deny(
          tool,
          'bash_deny',
          `bash 權限 deny（${decision.reason}）：${cmd.slice(0, 120)}`,
          logs,
          events,
        )
      }
      if (decision.action === 'ask') {
        needAsk = true
        logs.push({ level: 'INFO', message: `bash 需核准：${decision.reason}` })
      } else {
        // allow — clears prior ask (documented quirk)
        needAsk = false
      }
    } else if (input.bashRequireAsk !== false) {
      needAsk = true
    }
  }

  // 7. Capability approval cannot be bypassed by allow patterns
  if (input.forceAsk) needAsk = true

  // 8. Approval mode + mcpWrite + unattended
  const mode = effectiveApprovalMode(input.approvalMode, input.unattended)
  if ((input.approvalMode || 'auto') === 'full' && mode !== 'full') {
    logs.push({
      level: 'INFO',
      message: '無人值守任務：完整存取權降級為「代我核准」',
    })
  }
  const mcpWrite = isMcpWriteTool(tool)
  if (mcpWrite) needAsk = true

  const decided = decideApprovalNeed(
    mode,
    tool,
    needAsk,
    input.sideEffect === true || mcpWrite,
  )
  if (needAsk && !decided && mode === 'full') {
    logs.push({ level: 'INFO', message: `完整存取權：自動核准 ${tool}` })
  }
  // Capability forceAsk survives full
  needAsk = input.forceAsk === true ? true : decided
  // Unattended + MCP-write always ask. For other side-effect tools this is a
  // no-op when needAsk is already false (bit-for-bit with pre-extract guard).
  if (input.unattended && (mcpWrite || (isSideEffectTool(tool) && needAsk))) {
    needAsk = true
  }

  // Hooks (beforeTool): deny wins over everything; require-approval overrides full
  if (input.hookRules?.length) {
    const hookEval = evaluateBeforeTool(
      input.hookRules,
      tool,
      input.sourceKind,
      input.objective,
    )
    for (const line of hookEval.audits) {
      logs.push({ level: 'INFO', message: line })
    }
    if (hookEval.deny) {
      logs.push({
        level: 'WARN',
        message: `hook deny：${tool} — ${hookEval.deny.reason}`,
      })
      events.push({
        kind: 'permissionDenied',
        tool,
        reason: `hook deny：${hookEval.deny.reason}`,
      })
      return {
        verdict: 'deny',
        reason: 'hook_deny',
        logs,
        events,
      }
    }
    if (hookEval.forceAsk) needAsk = true
  }

  if (needAsk) {
    return {
      verdict: 'ask',
      reason: input.unattended ? 'hitl_unattended' : 'hitl',
      logs,
      events,
      askSpec: {
        tool,
        reason: input.unattended
          ? `無人值守任務請求工具「${tool}」（逾時將自動拒絕）`
          : `Agent 請求執行工具「${tool}」`,
      },
    }
  }

  return { verdict: 'allow', reason: 'allow', logs, events }
}

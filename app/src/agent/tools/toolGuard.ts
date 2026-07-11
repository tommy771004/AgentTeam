/**
 * Shared tool permission + HITL ask — used by FC toolLoop AND heuristic executeTool path.
 */
import type { ApprovalMode, LlmSettings, PermissionPolicy } from '../types'
import { checkToolPermission } from '../opencode/permissions'
import { executeTool, type ToolResult } from './executor'

export type AuthorizeResult =
  | { allowed: true }
  | { allowed: false; output: string }

export type GuardResult =
  | { allowed: true; result: ToolResult }
  | { allowed: false; output: string }

/**
 * ChatGPT「要求核准」範圍：會編輯檔案或使用網路等副作用工具。
 * 唯讀工具（list/read/search memory/codegraph/datetime…）不在此列。
 */
const SIDE_EFFECT_TOOLS = new Set([
  'bash',
  'workspace_write',
  'workspace_download',
  'workspace_mkdir',
  'workspace_move',
  'workspace_delete',
  'http_fetch',
  'web_search',
  'message_send',
  'mcp_call',
  'skill_save',
  'memory_set',
  'memory_append',
  'run_code',
  'delegate_task',
])

/** Side-effect classification (dynamic MCP tools count as network). */
export function isSideEffectTool(tool: string): boolean {
  return SIDE_EFFECT_TOOLS.has(tool) || tool.startsWith('mcp_')
}

/**
 * Pure decision core (mirrored in scripts/smoke-caps.mjs):
 * given the mode and the base ask signal (policy/bash-pattern/capability),
 * return whether to HITL-ask. Deny checks happen before this and always win.
 * `sideEffectHint` marks tools with arbitrary names (custom http/bash templates)
 * that the static SIDE_EFFECT_TOOLS list cannot know about.
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

/**
 * Effective mode for a run: unattended automation (scheduler/webhook/telegram)
 * never gets 'full' — downgrade to 'auto' so 完整存取權 stays a supervised mode.
 */
export function effectiveApprovalMode(
  mode: ApprovalMode | undefined,
  unattended: boolean | undefined,
): ApprovalMode {
  const m = mode || 'auto'
  if (m === 'full' && unattended) return 'auto'
  return m
}

/**
 * Deny / ask only — no execute. Shared by FC (MCP/delegate after) and heuristic.
 */
export async function authorizeTool(opts: {
  tool: string
  input: Record<string, unknown>
  settings: LlmSettings
  permissionPolicy?: PermissionPolicy
  blockedTools?: string[]
  /** Capability-declared approvalTools → always HITL ask (Pydantic v2 style) */
  forceAsk?: boolean
  /** Arbitrary-named side-effect tool (custom http/bash template) — approvalMode 'always' must ask */
  sideEffect?: boolean
  /**
   * HITL timeout ms. When set (or unattended), unresolved asks auto-deny
   * so scheduler/webhook cannot hang the global run lock overnight.
   */
  hitlTimeoutMs?: number
  unattended?: boolean
  /** Lifecycle hook context (P1-D) */
  sourceKind?: string
  objective?: string
  onLog?: (level: string, message: string) => void
}): Promise<AuthorizeResult> {
  const { tool, input, settings, permissionPolicy, blockedTools, onLog } = opts
  const blocked = new Set(blockedTools || [])

  if (blocked.has(tool)) {
    const msg = `工具被隔離策略封鎖：${tool}`
    onLog?.('WARN', msg)
    return { allowed: false, output: msg }
  }

  let needAsk = opts.forceAsk === true
  if (permissionPolicy) {
    const act = checkToolPermission(permissionPolicy, tool)
    if (act === 'deny') {
      const msg = `權限 deny：${tool}（目前 Agent 模式禁止此工具，可切換 Build）`
      onLog?.('WARN', msg)
      return { allowed: false, output: msg }
    }
    if (act === 'ask') needAsk = true
  }

  if (tool === 'bash') {
    const cmd = String(input.command || '')
    let agentId: string | undefined
    try {
      const { useThreadStore } = await import('../../store/threadStore')
      const thr = useThreadStore.getState()
      const t = thr.threads.find((x) => x.id === thr.activeId)
      agentId = t?.agentMode
    } catch {
      /* ignore */
    }
    try {
      const { resolveBashAction } = await import('../opencode/agentRegistry')
      const fallback =
        settings.bashRequireAsk !== false || needAsk ? 'ask' : 'allow'
      const bashAct = resolveBashAction(agentId, cmd, fallback)
      if (bashAct === 'deny') {
        const msg = `bash 權限 deny（pattern）：${cmd.slice(0, 120)}`
        onLog?.('WARN', msg)
        return { allowed: false, output: msg }
      }
      needAsk = bashAct === 'ask'
    } catch {
      if (settings.bashRequireAsk !== false) needAsk = true
    }
  }

  // Capability approval cannot be bypassed by allow patterns
  if (opts.forceAsk) needAsk = true

  // ChatGPT-style approval mode: always / auto (default) / full.
  // Unattended sources never run 'full' — downgraded to 'auto'.
  const mode = effectiveApprovalMode(settings.approvalMode, opts.unattended)
  if ((settings.approvalMode || 'auto') === 'full' && mode !== 'full') {
    onLog?.('INFO', '無人值守任務：完整存取權降級為「代我核准」')
  }
  // P0: dynamic MCP tools often lack static approval — force HITL for write-like names
  // under unattended / always modes so schedule/webhook cannot silently mutate.
  const mcpWrite =
    (tool.startsWith('mcp_') || tool === 'mcp_call') &&
    /create|delete|update|write|remove|destroy|unlink|post|put|patch|set_|insert|drop/i.test(
      tool,
    )
  if (mcpWrite) {
    needAsk = true
  }
  const decided = decideApprovalNeed(
    mode,
    tool,
    needAsk,
    opts.sideEffect === true || mcpWrite,
  )
  if (needAsk && !decided && mode === 'full') {
    onLog?.('INFO', `完整存取權：自動核准 ${tool}`)
  }
  needAsk = decided
  // Unattended + side-effect (incl. MCP write): never skip ask even if auto would
  if (opts.unattended && (mcpWrite || (isSideEffectTool(tool) && needAsk))) {
    needAsk = true
  }

  // P1-D lifecycle hooks (beforeTool): declarative policy — deny wins over
  // everything; require-approval overrides even approvalMode 'full'.
  try {
    const { collectHookRules, evaluateHooks } = await import('../hooks')
    const hookEval = evaluateHooks(collectHookRules(settings), {
      point: 'beforeTool',
      tool,
      sourceKind: opts.sourceKind as import('../hooks').HookContext['sourceKind'],
      objective: opts.objective,
    })
    for (const line of hookEval.audits) onLog?.('INFO', line)
    if (hookEval.deny) {
      onLog?.('WARN', `hook deny：${tool} — ${hookEval.deny.reason}`)
      return { allowed: false, output: `工具被 hook 政策拒絕：${hookEval.deny.reason}` }
    }
    if (hookEval.forceAsk) needAsk = true
  } catch {
    /* hooks unavailable — never block execution on hook infra */
  }

  if (needAsk) {
    const timeoutMs =
      opts.hitlTimeoutMs ??
      (opts.unattended ? 45_000 : 90_000)
    onLog?.(
      'AWAIT',
      `權限 ask：${tool} — 等待使用者核准…（${Math.round(timeoutMs / 1000)}s 逾時自動拒絕${opts.unattended ? ' · 無人值守' : ''}）`,
    )
    try {
      const { usePermissionAskStore } = await import('../../store/permissionAskStore')
      const decision = await usePermissionAskStore.getState().requestAsk({
        tool,
        args: input,
        reason: opts.unattended
          ? `無人值守任務請求工具「${tool}」（逾時將自動拒絕）`
          : `Agent 請求執行工具「${tool}」`,
        timeoutMs,
      })
      if (decision === 'deny') {
        const msg = `使用者拒絕或逾時拒絕工具：${tool}`
        onLog?.('WARN', msg)
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

/**
 * Deny / ask / allow then execute. Keeps Plan mode & bashRequireAsk consistent.
 */
export async function guardAndExecuteTool(opts: {
  tool: string
  input: Record<string, unknown>
  settings: LlmSettings
  permissionPolicy?: PermissionPolicy
  blockedTools?: string[]
  forceAsk?: boolean
  sideEffect?: boolean
  hitlTimeoutMs?: number
  unattended?: boolean
  sourceKind?: string
  objective?: string
  onLog?: (level: string, message: string) => void
}): Promise<GuardResult> {
  const auth = await authorizeTool(opts)
  if (!auth.allowed) return auth

  opts.onLog?.('ACTION', `Invoking tool '${opts.tool}'`)
  opts.onLog?.(
    'EXEC',
    `tool:${opts.tool} ${JSON.stringify(opts.input).slice(0, 120)}`,
  )
  const result = await executeTool(
    opts.tool as Parameters<typeof executeTool>[0],
    opts.input,
  )
  return { allowed: true, result }
}

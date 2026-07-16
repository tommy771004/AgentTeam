/**
 * Shared tool permission + HITL ask — used by FC toolLoop AND heuristic executeTool path.
 */
import type { ApprovalMode, LlmSettings, PermissionPolicy, PermissionProjection } from '../types'
import { checkProjectedToolPermission, checkToolPermission } from '../opencode/permissions'
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
  'design_system_create',
  'design_system_update',
  'design_artifact_export',
  'design_artifact_patch',
  'design_artifact_tweak',
  'design_artifact_capture',
  'design_artifact_lint',
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

/**
 * Conservative read-only shell allowlist for the SubDesign direction gate.
 * Anything not explicitly recognized is treated as potentially writable.
 */
export function isSubDesignReadonlyBashCommand(command: string): boolean {
  const value = command.trim()
  if (!value || /[`$()<>]/.test(value)) return false
  if (/\b(?:curl|wget|nc|ssh|scp|sftp|npm|pnpm|yarn|bun|cargo|pip|python(?:3)?|node|ruby|perl|php|make|docker)\b/i.test(value)) return false
  if (/\bgit\s+(?:apply|add|commit|clean|checkout|mv|rm|reset|restore|rebase|merge|cherry-pick|stash|switch|branch\s+(?!--show-current)|tag|push|pull|fetch|clone)\b/i.test(value)) return false
  const commands = value.split(/\s*(?:&&|\|\||;|\|)\s*/).map((part) => part.trim()).filter(Boolean)
  if (!commands.length) return false
  return commands.every((part) => /^(?:pwd|ls|cat|head|tail|grep|rg|find|fd|sort|uniq|wc|echo|printf|which|type|command\s+-v|env|printenv|git\s+(?:status|diff|log|show|branch\s+--show-current|rev-parse|ls-files)|sed\s+(?!.*(?:^|\s)-i\b)|awk)\b/i.test(part))
}

/** Bash commands that can mutate the linked SubDesign workspace. */
export function isSubDesignWritableBashCommand(command: string): boolean {
  return !isSubDesignReadonlyBashCommand(command)
}

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
 * permissionDenied hook 事件(G7 部分):任何 deny(pattern／policy／
 * hook／使用者拒絕)都廣播給宣告式 hooks,僅 log / notify(被動觀察,
 * 供稽核與 denial-ratio 統計),不影響已定案的拒絕。
 */
async function emitPermissionDenied(
  settings: LlmSettings,
  ctx: { sourceKind?: string; objective?: string },
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
    bumpRunMetric((ctx as { runId?: string }).runId, 'toolDenials')
  } catch {
    /* metrics must never block */
  }
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
  const blocked = new Set(blockedTools || [])

  if (
    settings.subAgentsEnabled !== true &&
    (tool === 'delegate_task' || tool === 'delegate_status')
  ) {
    const msg = `Sub Agent 功能目前已關閉：${tool}`
    onLog?.('WARN', msg)
    return { allowed: false, output: msg }
  }

  if (blocked.has(tool)) {
    const msg = `工具被隔離策略封鎖：${tool}`
    onLog?.('WARN', msg)
    return { allowed: false, output: msg }
  }

  // G8 plan mode:Active 時只有 .scratch/ 計畫檔可寫;在 approvalMode
  // 之前強制執行,連「完整存取權」也不可越過(grok 同款語意)。
  if (opts.runId) {
    try {
      const { isPlanModeActive, planModeToolDecision } = await import('../planMode')
      if (isPlanModeActive(opts.runId)) {
        const d = planModeToolDecision(
          tool,
          input,
          opts.sideEffect === true,
        )
        if (!d.allowed) {
          const msg = d.reason || `Plan mode 拒絕：${tool}`
          onLog?.('WARN', msg)
          await emitPermissionDenied(settings, opts, tool, msg, onLog)
          return { allowed: false, output: msg }
        }
      }
    } catch {
      /* plan mode module unavailable — never block on infra */
    }
  }

  // SubDesign direction gate is evaluated at tool time so a direction selected
  // after ask_user can unlock Build during the same run.
  if (SUBDESIGN_WRITE_TOOLS.has(tool) || tool === 'bash') {
    try {
      const { useSubDesignStore } = await import('../../store/subDesignStore')
      const runThreadId = opts.threadId
      const brief = runThreadId ? useSubDesignStore.getState().findByThreadId(runThreadId) : null
      const subDesignWriteBlocked = tool !== 'bash' || isSubDesignWritableBashCommand(String(input.command || ''))
      if (brief && !brief.selectedDirectionId && subDesignWriteBlocked) {
        const msg = `SubDesign direction gate：請先選定 direction，再使用 ${tool}。`
        onLog?.('WARN', msg)
        return { allowed: false, output: msg }
      }
    } catch {
      /* Optional SubDesign store is unavailable in pure/unit contexts. */
    }
  }

  let needAsk = opts.forceAsk === true
  const projected = checkProjectedToolPermission(permissionProjection, tool, input)
  if (permissionProjection?.unsupported.length) {
    onLog?.('WARN', `OpenCode unsupported permission keys：${permissionProjection.unsupported.join(', ')}`)
  }
  if (projected === 'deny') {
    const msg = `OpenCode permission deny：${tool}`
    onLog?.('WARN', msg)
    await emitPermissionDenied(settings, opts, tool, msg, onLog)
    return { allowed: false, output: msg }
  }
  if (projected === 'ask') needAsk = true
  if (permissionPolicy) {
    const act = checkToolPermission(permissionPolicy, tool)
    if (act === 'deny') {
      const msg = `權限 deny：${tool}（目前 Agent 模式禁止此工具，可切換 Build）`
      onLog?.('WARN', msg)
      await emitPermissionDenied(settings, opts, tool, msg, onLog)
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
      const runThreadId = opts.threadId
      const t = thr.threads.find((x) => x.id === (runThreadId || thr.activeId))
      agentId = t?.agentMode
    } catch {
      /* ignore */
    }
    try {
      const { resolveBashAction } = await import('../opencode/agentRegistry')
      const { decideBashAction } = await import('./shellCommandParser')
      const fallback =
        settings.bashRequireAsk !== false || needAsk ? 'ask' : 'allow'
      // grok-style 段級檢查:deny 看整串+每段(含 wrapper 剝除後),
      // 危險命令強制 ask,allow 需每一段命中(比 grok 的整串 allow 嚴)。
      const decision = decideBashAction(
        cmd,
        (candidate, fb) => resolveBashAction(agentId, candidate, fb),
        fallback,
      )
      if (decision.action === 'deny') {
        const msg = `bash 權限 deny（${decision.reason}）：${cmd.slice(0, 120)}`
        onLog?.('WARN', msg)
        await emitPermissionDenied(settings, opts, tool, msg, onLog)
        return { allowed: false, output: msg }
      }
      if (decision.action === 'ask') {
        needAsk = true
        onLog?.('INFO', `bash 需核准：${decision.reason}`)
      } else {
        needAsk = false
      }
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
      await emitPermissionDenied(settings, opts, tool, `hook deny：${hookEval.deny.reason}`, onLog)
      return { allowed: false, output: `工具被 hook 政策拒絕：${hookEval.deny.reason}` }
    }
    if (hookEval.forceAsk) needAsk = true
  } catch {
    /* hooks unavailable — never block execution on hook infra */
  }

  if (needAsk) {
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
      const decision = await usePermissionAskStore.getState().requestAsk({
        threadId: opts.threadId,
        runId: opts.runId,
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

/**
 * Deny / ask / allow then execute. Keeps Plan mode & bashRequireAsk consistent.
 */
export async function guardAndExecuteTool(opts: {
  tool: string
  input: Record<string, unknown>
  settings: LlmSettings
  permissionPolicy?: PermissionPolicy
  permissionProjection?: PermissionProjection
  /** OpenCode agent id for MCP per-agent access checks in the executor. */
  mcpAgentId?: string
  blockedTools?: string[]
  forceAsk?: boolean
  sideEffect?: boolean
    hitlTimeoutMs?: number
  unattended?: boolean
  runId?: string
  threadId?: string
  projectRoot?: string
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
    {
      permissionPolicy: opts.permissionPolicy,
      permissionProjection: opts.permissionProjection,
      mcpAgentId: opts.mcpAgentId,
      runId: opts.runId,
      threadId: opts.threadId,
      projectRoot: opts.projectRoot,
    },
  )
  return { allowed: true, result }
}

/**
 * The Host-side extension tool seam（工具接縫）.
 *
 * One place defines a tool (user story 24): a pack declares its tools here and
 * the SAME declaration serves three consumers — the `pi.registerTool()` call
 * that puts the tool in front of the model inside a Pi turn, the direct
 * `tools/pack` protocol method, and Code Mode's nested `tools.<name>()`. No
 * central executor switch exists on either side; each consumer drives the same
 * `execute` through the same Approval Decision, so 「代我核准」 and 「要求核准」
 * mean one thing across the whole catalog (user story 20).
 *
 * Packs group by the cohesive boundaries CONTEXT.md already names — each pack
 * is a Trusted Extension in ADR-0024 terms: full host authority, enablement is
 * an explicit trust decision, and no UI copy may describe a pack as sandboxed.
 */

import { decideBuiltinShellUnderProtection } from '../src/agent/outbound/cliSandbox.ts'

/** A TypeBox-compatible parameter schema, written as plain JSON Schema so the Host stays dependency-free. */
export type PiToolSchema = Record<string, unknown>

export type PiToolContext = {
  sessionId: string
  /** Absolute project root the turn runs against. */
  cwd: string
  runId?: string
  temporaryChat?: boolean
}

export type PiToolResult = {
  content: Array<{ type: 'text'; text: string }>
  details?: unknown
}

export type PiToolApprovalPlan =
  | { need: false }
  | { need: true; reason: string }

/**
 * What one pack tool is. `execute` returns structured results — an expected
 * failure is content (`ok:false`), never a throw, so a failing tool can never
 * end a turn (issue 01).
 */
export type PiPackTool = {
  name: string
  label: string
  description: string
  /** One-line snippet for the system prompt's Available tools section. */
  promptSnippet: string
  promptGuidelines?: string[]
  parameters: PiToolSchema
  execute: (args: Record<string, unknown>, ctx: PiToolContext) => Promise<PiToolResult>
  approval?: (args: Record<string, unknown>, ctx: PiToolContext) => PiToolApprovalPlan
}

export type PiExtensionPack = {
  id: string
  name: string
  description: string
  /**
   * The capability boundary this pack belongs to, when its tools should stay
   * hidden behind progressive disclosure instead of being active by default.
   */
  capability?: string
  /** Tools active without an explicit load (the always-on capabilities). */
  alwaysActive?: boolean
  tools: PiPackTool[]
}

const packs = new Map<string, PiExtensionPack>()
const packOrder: string[] = []

export function registerPiExtensionPack(pack: PiExtensionPack): void {
  if (!packs.has(pack.id)) packOrder.push(pack.id)
  for (const tool of pack.tools) {
    const owner = [...packs.values()].find((existing) => existing.tools.some((candidate) => candidate.name === tool.name))
    if (owner && owner.id !== pack.id) {
      throw new Error(`Pi extension tool declared twice: ${tool.name} (${owner.id} and ${pack.id})`)
    }
  }
  packs.set(pack.id, pack)
}

/** Test seam: forget every registered pack. */
export function resetPiExtensionPacks(): void {
  packs.clear()
  packOrder.length = 0
}

export function piExtensionPacks(): PiExtensionPack[] {
  return packOrder.map((id) => packs.get(id)!).filter(Boolean)
}

export function findPiPackTool(name: string): { pack: PiExtensionPack; tool: PiPackTool } | undefined {
  for (const pack of piExtensionPacks()) {
    const tool = pack.tools.find((candidate) => candidate.name === name)
    if (tool) return { pack, tool }
  }
  return undefined
}

/** Every pack tool name, so a restricted activeTools allowlist still admits them into the registry. */
export function piAllPackToolNames(): string[] {
  return piExtensionPacks().flatMap((pack) => pack.tools.map((tool) => tool.name))
}

/**
 * THE shared definition of an active pack tool set.
 *
 * - Always-on packs (interaction, planning, core-utils, framework) are active
 *   under any configuration.
 * - Capability-gated tools are active once their capability loads, or when
 *   the user names them explicitly.
 *
 * The projection, the session runtime, and Code Mode's sandbox all derive
 * their answer from this one function, so a tool cannot be listed as callable
 * in one place and refused in another.
 */
export function piActivePackToolNames(activeTools: ReadonlyArray<string>, unlocked: ReadonlyArray<string>): string[] {
  return piExtensionPacks().flatMap((pack) => {
    const gated = Boolean(pack.capability) && !pack.alwaysActive
    return pack.tools
      .filter((tool) => !gated || unlocked.includes(tool.name) || activeTools.includes(tool.name))
      .map((tool) => tool.name)
  })
}

/* ── Live session handles for mid-run activation ─────────────────────── */

/**
 * The one thing a pack may do to its own session mid-run: change which
 * registered tools are active. `load_capability` drives this so a task that
 * turns out to need a capability picks it up without restarting (user story
 * 16); nothing else about the session is reachable from packs.
 */
export type PiPackSessionHandle = {
  setActiveTools: (names: string[]) => boolean
  getActiveTools: () => string[]
}

const packSessions = new Map<string, PiPackSessionHandle>()

export function registerPiPackSession(sessionId: string, handle: PiPackSessionHandle): void {
  packSessions.set(sessionId, handle)
}

export function unregisterPiPackSession(sessionId: string): void {
  packSessions.delete(sessionId)
}

export function piPackSessionHandle(sessionId: string): PiPackSessionHandle | undefined {
  return packSessions.get(sessionId)
}

/* ── Run binding ─────────────────────────────────────────────────────── */

/**
 * Which run owns each session right now, and what its approval policy is.
 * In-turn tools learn their coordinates from this binding because extension
 * factories are created per session, while approvals are keyed per run.
 */
type PiRunBinding = {
  runId: string
  approvalMode: 'always' | 'auto' | 'full'
  unattended: boolean
  temporaryChat?: boolean
  shellPolicy?: { effectiveMode: 'required' | 'optional' | 'demo' | 'off'; shellIsolationVerified?: boolean; viewRoot?: string }
}
const sessionRuns = new Map<string, PiRunBinding>()

export function bindPiSessionRun(sessionId: string, binding: {
  runId: string
  approvalMode?: PiRunBinding['approvalMode']
  unattended?: boolean
  temporaryChat?: boolean
  shellPolicy?: PiRunBinding['shellPolicy']
}): void {
  sessionRuns.set(sessionId, {
    runId: binding.runId,
    approvalMode: binding.approvalMode || 'auto',
    unattended: binding.unattended === true,
    ...(binding.temporaryChat !== undefined ? { temporaryChat: binding.temporaryChat } : {}),
    ...(binding.shellPolicy ? { shellPolicy: binding.shellPolicy } : {}),
  })
}

export function unbindPiSessionRun(sessionId: string): void {
  sessionRuns.delete(sessionId)
}

export function piSessionRunBinding(sessionId: string): PiRunBinding | undefined {
  return sessionRuns.get(sessionId)
}

/* ── Approval Decision ──────────────────────────────────────────────── */

export type PiApprovalRequest = {
  runId: string
  sessionId: string
  tool: string
  callId: string
  args?: Record<string, unknown>
  reason?: string
  timeoutMs: number
}

export type PiApprovalResolution = { decision: 'allow' | 'deny' | 'timeout'; answer?: string; reason?: string }

type PiApprovalBridge = {
  request: (request: PiApprovalRequest) => void
}

type PiTurnAuditRecord = {
  runId: string
  sessionId: string
  tool: string
  callId: string
  decision: 'allow' | 'deny'
  settlement?: 'denied'
  reason?: string
}

let approvalBridge: PiApprovalBridge | undefined
let turnAudit: ((record: PiTurnAuditRecord) => void) | undefined

/**
 * The protocol layer installs the bridge so an in-turn ask travels out as a
 * `host/approval-requested` event and comes back through `approvals/resolve` —
 * the same HITL path every other approval rides. The audit callback receives
 * each in-turn verdict so decisions land in the same tool audit stream as
 * direct calls.
 */
export function setPiApprovalBridge(bridge: PiApprovalBridge, audit?: (record: PiTurnAuditRecord) => void): void {
  approvalBridge = bridge
  turnAudit = audit
}

/** Interactive asks wait this long before auto-denying (matches toolGuard's 90s). */
export const PI_INTERACTIVE_APPROVAL_TIMEOUT_MS = 90_000

function piApprovalTimeoutMs(): number {
  const configured = Number(process.env.SUBAGENTS_PI_APPROVAL_TIMEOUT_MS)
  return Number.isFinite(configured) && configured > 0 ? configured : PI_INTERACTIVE_APPROVAL_TIMEOUT_MS
}

const pendingApprovals = new Map<string, {
  resolve: (resolution: PiApprovalResolution) => void
  timer: NodeJS.Timeout
}>()

function approvalKey(runId: string, callId: string): string {
  return `${runId}::${callId}`
}

/** Answer one pending ask from the renderer. Returns false when nothing waits. */
export function resolvePiApproval(params: {
  runId?: unknown
  callId?: unknown
  decision?: unknown
  answer?: unknown
}): boolean {
  const runId = typeof params.runId === 'string' ? params.runId : ''
  const callId = typeof params.callId === 'string' ? params.callId : ''
  const pending = pendingApprovals.get(approvalKey(runId, callId))
  if (!pending) return false
  clearTimeout(pending.timer)
  pendingApprovals.delete(approvalKey(runId, callId))
  if (params.decision === 'allow') {
    pending.resolve({
      decision: 'allow',
      ...(typeof params.answer === 'string' ? { answer: params.answer } : {}),
    })
  } else {
    pending.resolve({
      decision: params.decision === 'deny' ? 'deny' : 'timeout',
      reason: params.decision === 'deny' ? 'Approval denied by user' : 'Approval timed out',
    })
  }
  return true
}

/** Cancel every pending ask for a run (its turn ended; nobody is listening). */
export function cancelPiApprovalsForRun(runId: string): number {
  let cancelled = 0
  for (const [key, pending] of [...pendingApprovals.entries()]) {
    if (!key.startsWith(`${runId}::`)) continue
    clearTimeout(pending.timer)
    pendingApprovals.delete(key)
    cancelled += 1
    pending.resolve({ decision: 'timeout', reason: 'Approval cancelled with its run' })
  }
  return cancelled
}

/**
 * Ask the human. Unattended runs deny immediately — fail-closed, matching the
 * unattended downgrade the rest of the Approval Decision uses.
 *
 * Transport only: this resolves the ask and reports nothing else. Whoever
 * called it owns its own decision/result emission.
 */
export async function requestPiToolApproval(request: Omit<PiApprovalRequest, 'timeoutMs'> & { timeoutMs?: number; unattended?: boolean }): Promise<PiApprovalResolution> {
  if (request.unattended) {
    return { decision: 'deny', reason: 'Unattended approval denied after timeout' }
  }
  const timeoutMs = request.timeoutMs ?? piApprovalTimeoutMs()
  return new Promise<PiApprovalResolution>((resolvePromise) => {
    const key = approvalKey(request.runId, request.callId)
    const timer = setTimeout(() => {
      pendingApprovals.delete(key)
      resolvePromise({ decision: 'timeout', reason: 'Approval timed out' })
    }, timeoutMs)
    pendingApprovals.set(key, { resolve: resolvePromise, timer })
    approvalBridge?.request({ ...request, timeoutMs })
  })
}

/** Audit an in-turn verdict so it lands beside every other tool decision. */
export function auditPiInTurnDecision(record: PiTurnAuditRecord): void {
  turnAudit?.(record)
}

/**
 * CallIds denied mid-turn, keyed `${sessionId}:${callId}`. The Turn Record
 * writer consults this so a denial settles as `denied` — not `failed` — when
 * Pi reports the blocked execution's end.
 */
const deniedInTurnCalls = new Map<string, string>()

export function markPiDeniedInTurnCall(sessionId: string, callId: string, reason: string): void {
  deniedInTurnCalls.set(`${sessionId}:${callId}`, reason)
}

export function consumePiDeniedInTurnCall(sessionId: string, callId: string): string | undefined {
  const key = `${sessionId}:${callId}`
  const reason = deniedInTurnCalls.get(key)
  if (reason !== undefined) deniedInTurnCalls.delete(key)
  return reason
}

/* ── Execution with the shared gates ─────────────────────────────────── */

export type PiPackExecutionOutcome = {
  ok: boolean
  text: string
  data?: unknown
  denied?: boolean
}

/**
 * Effective Approval Decision for one call, composed the same way the direct
 * protocol path composes it: a tool's own plan, the turn's approval mode, and
 * the unattended downgrade all land in one verdict (ADR-0048 layers).
 *
 * `full` attended mode trusts declared plans only when they force an ask;
 * `unattended` keeps every ask fail-closed.
 */
export function evaluatePiToolApproval(
  tool: PiPackTool,
  args: Record<string, unknown>,
  ctx: PiToolContext,
  policy: { approvalMode?: 'always' | 'auto' | 'full'; unattended?: boolean } = {},
): PiToolApprovalPlan {
  const base = tool.approval?.(args, ctx) || { need: false }
  if (!base.need) return { need: false }
  if (policy.unattended) return base
  if ((policy.approvalMode || 'auto') === 'full') return { need: false }
  return base
}

/**
 * Run one pack tool through its Approval Decision. Every consumer shares this
 * path: the model calling mid-turn, the renderer calling `tools/pack`, and
 * Code Mode nesting `tools.<name>()`.
 *
 * A denial is an outcome, not an exception — the caller sees exactly why the
 * tool did not run ("the agent could not" vs "the agent chose not to",
 * user story 14).
 */
export async function executePiPackTool(
  name: string,
  args: Record<string, unknown>,
  ctx: PiToolContext,
  options: { approval?: 'allow' | 'deny'; policy?: { approvalMode?: 'always' | 'auto' | 'full'; unattended?: boolean }; callId?: string } = {},
): Promise<PiPackExecutionOutcome> {
  const found = findPiPackTool(name)
  if (!found) return { ok: false, text: `Unknown Pi extension tool: ${name}` }
  const { tool } = found
  const callId = options.callId || `${ctx.runId || ctx.sessionId}:${name}:${Math.random().toString(36).slice(2, 8)}`
  const policy = options.policy || {}
  if (options.approval !== 'allow') {
    const plan = evaluatePiToolApproval(tool, args, ctx, policy)
    if (plan.need) {
      if (options.approval === 'deny') {
        return { ok: false, denied: true, text: `${name} was not approved: ${plan.reason}` }
      }
      const resolution = await requestPiToolApproval({
        runId: ctx.runId || 'direct',
        sessionId: ctx.sessionId,
        tool: name,
        callId,
        args,
        reason: plan.reason,
        ...(policy.unattended ? { unattended: true } : {}),
      })
      if (resolution.decision !== 'allow') {
        return { ok: false, denied: true, text: `${name} was not approved (${resolution.decision}): ${plan.reason}`, data: { ok: false, denied: true, error: plan.reason } }
      }
      // ask_user's answer travels back inside the resolved arguments.
      if (resolution.answer !== undefined) (args as Record<string, unknown>).answer = resolution.answer
    }
  }
  try {
    const result = await tool.execute(args, ctx)
    return {
      ok: true,
      text: result.content.map((part) => part.text).join('\n'),
      data: result.details,
    }
  } catch (error) {
    // An unexpected crash still answers structurally instead of ending the turn.
    const message = error instanceof Error ? error.message : String(error)
    return { ok: false, text: `${name} failed: ${message}`, data: { ok: false, error: message } }
  }
}

/* ── Inline extension factories for DefaultResourceLoader ───────────── */

type InlineExtensionFactoryInput = {
  on: (event: string, handler: (event: Record<string, unknown>) => unknown) => void
  registerTool: (tool: {
    name: string
    label: string
    description: string
    promptSnippet?: string
    promptGuidelines?: string[]
    parameters: PiToolSchema
    execute: (toolCallId: string, params: Record<string, unknown>) => Promise<{ content: Array<{ type: 'text'; text: string }>; details?: unknown }>
  }) => void
}

/**
 * ADR-0047 gate for the builtin bash tool, enforced HOST-side where in-turn
 * execution actually happens: under Outbound Guard `required`, an unverified
 * shell is refused outright; any mode refuses absolute paths escaping the
 * bound Restricted Project View. The policy travels per run from the
 * renderer's contextPolicy — absent information never invents a denial, and
 * `required` always fails closed.
 */
export function piBashGateExtensionFactory(ctx: { sessionId: string }): { name: string; hidden: true; factory: (pi: InlineExtensionFactoryInput) => void } {
  return {
    name: 'subagents-bash-gate',
    hidden: true,
    factory: (pi: InlineExtensionFactoryInput) => {
      pi.on('tool_call', (event) => {
        if (event.toolName !== 'bash') return undefined
        const binding = piSessionRunBinding(ctx.sessionId)
        const shell = binding?.shellPolicy
        if (!shell?.effectiveMode || shell.effectiveMode === 'off') return undefined
        const command = ((event.input as Record<string, unknown>) || {}).command
        const verdict = decideBuiltinShellUnderProtection({
          effectiveMode: shell.effectiveMode,
          command: String(command || ''),
          viewRoot: shell.viewRoot ?? null,
          shellIsolationVerified: shell.shellIsolationVerified,
        })
        if (verdict.allow) return undefined
        const callId = typeof event.toolCallId === 'string' ? event.toolCallId : `${binding?.runId || 'turn'}:bash`
        auditPiInTurnDecision({
          runId: binding?.runId || 'turn',
          sessionId: ctx.sessionId,
          tool: 'bash',
          callId,
          decision: 'deny',
          settlement: 'denied',
          reason: verdict.reason || 'builtin shell denied by outbound protection',
        })
        markPiDeniedInTurnCall(ctx.sessionId, callId, verdict.reason || 'builtin shell denied by outbound protection')
        return { block: true, reason: verdict.reason || 'builtin shell denied by outbound protection' }
      })
    },
  }
}

/**
 * Build the inline factories handed to `DefaultResourceLoader` alongside the
 * hidden `subagents-session-context` factory. Each pack becomes one factory;
 * its `tool_call` hook is where the shared Approval Decision intercepts the
 * model's calls mid-turn, so a nested or direct call cannot slip past it.
 */
export function piPackExtensionFactories(ctx: { sessionId: string; cwd: string; temporaryChat?: boolean }): Array<{ name: string; hidden: true; factory: (pi: InlineExtensionFactoryInput) => void }> {
  return piExtensionPacks().map((pack) => ({
    name: `subagents-${pack.id}`,
    hidden: true,
    factory: (pi: InlineExtensionFactoryInput) => {
      const byName = new Map(pack.tools.map((tool) => [tool.name, tool]))
      pi.on('tool_call', async (event) => {
        const toolName = typeof event.toolName === 'string' ? event.toolName : ''
        const tool = byName.get(toolName)
        if (!tool) return undefined
        const binding = piSessionRunBinding(ctx.sessionId)
        const policy = { approvalMode: binding?.approvalMode, unattended: binding?.unattended }
        const plan = evaluatePiToolApproval(tool, (event.input as Record<string, unknown>) || {}, {
          sessionId: ctx.sessionId,
          cwd: ctx.cwd,
          runId: binding?.runId,
          temporaryChat: binding?.temporaryChat || ctx.temporaryChat,
        }, policy)
        if (!plan.need) return undefined
        const callId = typeof event.toolCallId === 'string' ? event.toolCallId : `${binding?.runId || 'turn'}:${toolName}`
        const resolution = await requestPiToolApproval({
          runId: binding?.runId || 'turn',
          sessionId: ctx.sessionId,
          tool: toolName,
          callId,
          args: (event.input as Record<string, unknown>) || {},
          reason: plan.reason,
          ...(binding?.unattended ? { unattended: true } : {}),
        })
        const allowed = resolution.decision === 'allow'
        auditPiInTurnDecision({
          runId: binding?.runId || 'turn',
          sessionId: ctx.sessionId,
          tool: toolName,
          callId,
          decision: allowed ? 'allow' : 'deny',
          ...(!allowed ? { settlement: 'denied' as const, reason: resolution.reason || plan.reason } : {}),
        })
        if (!allowed) {
          // The record must say the tool was DENIED, not merely failed.
          markPiDeniedInTurnCall(ctx.sessionId, callId, `${toolName} was not approved (${resolution.decision}): ${plan.reason}`)
        }
        return allowed
          ? undefined
          : { block: true, reason: `${toolName} was not approved (${resolution.decision}): ${plan.reason}` }
      })
      for (const tool of pack.tools) {
        pi.registerTool({
          name: tool.name,
          label: tool.label,
          description: tool.description,
          promptSnippet: tool.promptSnippet,
          ...(tool.promptGuidelines ? { promptGuidelines: tool.promptGuidelines } : {}),
          parameters: tool.parameters,
          // The `tool_call` hook above IS this path's Approval Decision; the
          // execution must not ask a second time for the same call.
          execute: async (_toolCallId, params) => {
            const binding = piSessionRunBinding(ctx.sessionId)
            const outcome = await executePiPackTool(tool.name, params, {
              sessionId: ctx.sessionId,
              cwd: ctx.cwd,
              runId: binding?.runId,
              temporaryChat: binding?.temporaryChat || ctx.temporaryChat,
            }, { approval: 'allow' })
            return {
              content: [{ type: 'text' as const, text: outcome.text }],
              details: { ...(outcome.data as Record<string, unknown> | undefined), ...(outcome.denied ? { denied: true } : {}) },
            }
          },
        })
      }
    },
  }))
}

/* ── Catalog projection ──────────────────────────────────────────────── */

export type PiCatalogEntry = {
  name: string
  description: string
  /** Owning extension pack id, or `builtin` / `mcp`. */
  pack: string
  source: 'discovered' | 'installed'
  active: boolean
  available: boolean
  reason?: string
}

/**
 * Project the packs into catalog entries.
 *
 * Availability is a fact carried by EACH entry with its own reason — never a
 * wholesale state (issue 03): while packs land one by one, live and not-yet
 * entries sit beside each other. A capability-gated tool is inactive until its
 * capability loads or the user enables it explicitly.
 */
export function piPackCatalogEntries(options: { activeTools: ReadonlyArray<string>; unlockedTools?: ReadonlyArray<string> }): PiCatalogEntry[] {
  const unlocked = options.unlockedTools || []
  return piExtensionPacks().flatMap((pack) => pack.tools.map((tool) => {
    const gated = Boolean(pack.capability) && !pack.alwaysActive
    const active = !gated || unlocked.includes(tool.name) || options.activeTools.includes(tool.name)
    return {
      name: tool.name,
      description: tool.description,
      pack: pack.id,
      source: 'discovered' as const,
      active,
      available: true,
      ...(!active ? { reason: `Inactive this turn: load the ${pack.capability} capability or enable the tool explicitly` } : {}),
    }
  }))
}

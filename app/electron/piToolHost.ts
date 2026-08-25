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
import { admitBuiltinShellSandbox, releaseBuiltinShellExecution, wrapVerifiedBuiltinShellCommand, type BuiltinShellSandboxVerification } from './piBuiltinShellSandbox.ts'
import { decideGitCommand, type GitCommandPolicy } from '../src/agent/tools/gitCommandPolicy.ts'
import { schemaDigest, type PiToolCatalogEntry } from './piToolContract.ts'
import {
  evaluatePiInvocationPolicy,
  PiInvocationEvidence,
  type PiFrozenRunPolicy,
  type PiInvocationContractIdentity,
  type PiPolicyEvidenceEvent,
  type PiToolPolicyRequirements,
} from './piPolicyEvidence.ts'

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
  | { need: true; reason: string; hitl?: boolean }

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
  /** Tool-specific restrictions composed by the common Host policy seam. */
  policyMigration?: PiToolPolicyRequirements
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
  refreshContract?: () => void
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

/** Attach the Host-owned contract publisher after a live Pi session exists. */
export function setPiPackSessionContractRefresh(sessionId: string, refreshContract?: () => void): boolean {
  const handle = packSessions.get(sessionId)
  if (!handle) return false
  if (refreshContract) packSessions.set(sessionId, { ...handle, refreshContract })
  else {
    const { refreshContract: _refreshContract, ...withoutRefresh } = handle
    packSessions.set(sessionId, withoutRefresh)
  }
  return true
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
  shellPolicy?: {
    effectiveMode: 'required' | 'optional' | 'demo' | 'off'
    viewRoot?: string
    /** Started at Host turn admission; renderer/model input cannot supply it. */
    sandboxVerification?: Promise<BuiltinShellSandboxVerification>
  }
  /** Settings → Git preferences frozen for this run (issue 18). */
  gitPolicy?: GitCommandPolicy
  frozenPolicy?: PiFrozenRunPolicy
}
const sessionRuns = new Map<string, PiRunBinding>()

export function bindPiSessionRun(sessionId: string, binding: {
  runId: string
  approvalMode?: PiRunBinding['approvalMode']
  unattended?: boolean
  temporaryChat?: boolean
  shellPolicy?: PiRunBinding['shellPolicy']
  gitPolicy?: PiRunBinding['gitPolicy']
  frozenPolicy?: PiFrozenRunPolicy
}): void {
  sessionRuns.set(sessionId, {
    runId: binding.runId,
    approvalMode: binding.approvalMode || 'auto',
    unattended: binding.unattended === true,
    ...(binding.temporaryChat !== undefined ? { temporaryChat: binding.temporaryChat } : {}),
    ...(binding.shellPolicy ? { shellPolicy: binding.shellPolicy } : {}),
    ...(binding.gitPolicy ? { gitPolicy: binding.gitPolicy } : {}),
    ...(binding.frozenPolicy ? { frozenPolicy: binding.frozenPolicy } : {}),
  })
}

/**
 * Patch a verified bash call so it executes inside this run's sandbox.
 *
 * Pi allows `event.input` to be mutated in place before execution, so the
 * command the Approval Decision inspected is the command that runs — only now
 * confined. Which backend does the confining is the seam's business, not this
 * module's: a new platform adapter needs no change here.
 */
async function wrapVerifiedBuiltinShell(input: {
  evidenceBackend: string
  runId: string
  viewRoot: string
  input: Record<string, unknown>
}): Promise<{ wrapped: true } | { wrapped: false; reason: string }> {
  const command = typeof input.input?.command === 'string' ? input.input.command : ''
  const wrapped = await wrapVerifiedBuiltinShellCommand({
    backend: input.evidenceBackend,
    runId: input.runId,
    viewRoot: input.viewRoot,
    command,
  })
  if (!wrapped.ok) return { wrapped: false, reason: wrapped.reason }
  input.input.command = wrapped.command
  return { wrapped: true }
}

export function unbindPiSessionRun(sessionId: string): void {
  const binding = sessionRuns.get(sessionId)
  if (binding?.runId) releaseBuiltinShellExecution(binding.runId)
  sessionRuns.delete(sessionId)
}

export function piSessionRunBinding(sessionId: string): PiRunBinding | undefined {
  return sessionRuns.get(sessionId)
}

/** Host runtime adds its immutable Skill Resource View after snapshotting. */
export function bindPiSessionSkillResourceView(sessionId: string, resourceView: NonNullable<PiFrozenRunPolicy['resourceView']>): void {
  const binding = sessionRuns.get(sessionId)
  if (!binding?.frozenPolicy) return
  const frozenResourceView = Object.freeze({
    ...resourceView,
    manifest: Object.freeze([...resourceView.manifest]),
  })
  sessionRuns.set(sessionId, {
    ...binding,
    frozenPolicy: Object.freeze({ ...binding.frozenPolicy, resourceView: frozenResourceView }),
  })
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

export type PiApprovalResolution = { decision: 'allow' | 'deny' | 'timeout' | 'cancel'; answer?: string; reason?: string }

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
    pending.resolve({ decision: 'cancel', reason: 'Approval cancelled with its run' })
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

/* ── Policy/evidence expand bridge (Ticket 06) ──────────────────────── */

type PiPolicyEvidenceBridge = {
  contractIdentity: (sessionId: string, tool: string) => PiInvocationContractIdentity | undefined
  append: (sessionId: string, event: PiPolicyEvidenceEvent) => void
}

let policyEvidenceBridge: PiPolicyEvidenceBridge | undefined

export function setPiPolicyEvidenceBridge(bridge: PiPolicyEvidenceBridge): void {
  policyEvidenceBridge = bridge
}

const migratedInvocations = new Map<string, {
  evidence: PiInvocationEvidence
  args: Readonly<Record<string, unknown>>
  executionRoot: string
}>()

const builtinInvocations = new Map<string, PiInvocationEvidence>()

function migratedInvocationKey(sessionId: string, callId: string): string {
  return `${sessionId}:${callId}`
}

/** Complete the evidence started by the single model-builtin tool_call hook. */
export function settlePiModelBuiltinInvocation(input: {
  sessionId: string
  callId: string
  cancelled?: boolean
  failed?: boolean
  detail?: string
}): void {
  const key = migratedInvocationKey(input.sessionId, input.callId)
  const evidence = builtinInvocations.get(key)
  if (!evidence) return
  builtinInvocations.delete(key)
  const settlement = input.cancelled ? 'cancelled' : input.failed ? 'failed' : 'success'
  evidence.update(input.detail || `Builtin execution ${settlement}`)
  evidence.result(settlement === 'success', input.detail || settlement)
  evidence.settle(settlement, input.detail)
}

function packPolicyRequirements(tool: PiPackTool, args: Record<string, unknown>, ctx: PiToolContext): PiToolPolicyRequirements {
  const approval = tool.approval?.(args, ctx)
  return {
    ...(tool.policyMigration || {}),
    ...(approval?.need && !tool.policyMigration?.capabilityApproval && !tool.policyMigration?.approvalRequired
      ? { approvalRequired: approval.reason, sideEffect: true }
      : {}),
    ...(approval?.need && approval.hitl ? { hitl: true } : {}),
  }
}

function builtinPolicyRequirements(tool: string): PiToolPolicyRequirements {
  const mutating = tool === 'write' || tool === 'edit' || tool === 'bash'
  return {
    ...(tool !== 'bash' ? { pathArguments: ['path'] } : {}),
    ...(tool === 'bash' ? { outbound: true } : {}),
    ...(mutating ? { sideEffect: true, approvalRequired: `${tool} requires approval before execution` } : {}),
  }
}

/* ── Execution with the shared gates ─────────────────────────────────── */

export type PiPackExecutionOutcome = {
  ok: boolean
  text: string
  data?: unknown
  denied?: boolean
}

/**
 * Execute an already-authorized pack definition. The policy/evidence module is
 * the only caller-facing gate; keeping approval out of this leaf prevents a
 * second, subtly different verdict from reappearing here.
 */
export async function executePiPackTool(
  name: string,
  args: Record<string, unknown>,
  ctx: PiToolContext,
  options: { callId?: string } = {},
): Promise<PiPackExecutionOutcome> {
  const found = findPiPackTool(name)
  if (!found) return { ok: false, text: `Unknown Pi extension tool: ${name}` }
  return executePiPackToolDefinition(found.tool, name, args, ctx, options)
}

async function executePiPackToolDefinition(
  tool: PiPackTool,
  name: string,
  args: Record<string, unknown>,
  ctx: PiToolContext,
  options: { callId?: string } = {},
): Promise<PiPackExecutionOutcome> {
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
 * The single model-builtin policy hook. Every Pi builtin first enters the
 * common frozen policy/evidence seam. Bash then receives ADR-0047's additional
 * shell-specific verdict in this same hook, so there is no competing gate.
 */
export function piBashGateExtensionFactory(ctx: { sessionId: string }): { name: string; hidden: true; factory: (pi: InlineExtensionFactoryInput) => void } {
  return {
    name: 'subagents-bash-gate',
    hidden: true,
    factory: (pi: InlineExtensionFactoryInput) => {
      pi.on('tool_call', async (event) => {
        const toolName = typeof event.toolName === 'string' ? event.toolName : ''
        if (!['bash', 'edit', 'find', 'grep', 'ls', 'read', 'write'].includes(toolName)) return undefined
        const binding = piSessionRunBinding(ctx.sessionId)
        const callId = typeof event.toolCallId === 'string' ? event.toolCallId : `${binding?.runId || 'turn'}:${toolName}`
        const contract = policyEvidenceBridge?.contractIdentity(ctx.sessionId, toolName)
        const frozenPolicy = binding?.frozenPolicy
        if (!binding || !contract || !frozenPolicy || !policyEvidenceBridge) {
          const reason = `Host policy evidence unavailable for Pi builtin ${toolName}`
          markPiDeniedInTurnCall(ctx.sessionId, callId, reason)
          auditPiInTurnDecision({ runId: binding?.runId || 'turn', sessionId: ctx.sessionId, tool: toolName, callId, decision: 'deny', settlement: 'denied', reason })
          return { block: true, reason }
        }
        const coordinates = { sessionId: ctx.sessionId, runId: binding.runId, callId }
        const evidence = new PiInvocationEvidence({ ...coordinates, tool: toolName, origin: 'model', ...contract }, (entry) => policyEvidenceBridge!.append(ctx.sessionId, entry))
        evidence.start()
        const evaluation = evaluatePiInvocationPolicy({
          coordinates,
          origin: 'model',
          tool: toolName,
          contract,
          args: (event.input as Record<string, unknown>) || {},
          policy: frozenPolicy,
          requirements: builtinPolicyRequirements(toolName),
        })
        if (evaluation.verdict === 'deny') {
          evidence.decision('deny', evaluation.reason)
          evidence.result(false, evaluation.reason)
          evidence.settle('denied', evaluation.reason)
          markPiDeniedInTurnCall(ctx.sessionId, callId, evaluation.reason)
          auditPiInTurnDecision({ runId: binding.runId, sessionId: ctx.sessionId, tool: toolName, callId, decision: 'deny', settlement: 'denied', reason: evaluation.reason })
          return { block: true, reason: evaluation.reason }
        }
        if (evaluation.verdict === 'ask') {
          evidence.decision('ask', evaluation.reason)
          const resolution = await requestPiToolApproval({
            runId: binding.runId,
            sessionId: ctx.sessionId,
            tool: toolName,
            callId,
            args: evaluation.normalizedArgs as Record<string, unknown>,
            reason: evaluation.reason,
            timeoutMs: frozenPolicy.approvalTimeoutMs,
            ...(frozenPolicy.unattended ? { unattended: true } : {}),
          })
          if (resolution.decision !== 'allow') {
            const reason = resolution.reason || evaluation.reason
            evidence.decision('deny', reason)
            evidence.result(false, reason)
            evidence.settle(resolution.decision === 'cancel' ? 'cancelled' : 'denied', reason)
            markPiDeniedInTurnCall(ctx.sessionId, callId, reason)
            auditPiInTurnDecision({ runId: binding.runId, sessionId: ctx.sessionId, tool: toolName, callId, decision: 'deny', settlement: 'denied', reason })
            return { block: true, reason }
          }
        }

        if (toolName !== 'bash') {
          evidence.decision('allow', evaluation.reason)
          auditPiInTurnDecision({ runId: binding.runId, sessionId: ctx.sessionId, tool: toolName, callId, decision: 'allow' })
          builtinInvocations.set(migratedInvocationKey(ctx.sessionId, callId), evidence)
          return undefined
        }
        // Issue 18: Settings → Git preferences apply BEFORE the outbound gate,
        // so the gate inspects (and the sandbox wraps) the command that will
        // actually run. A forbidden force push is refused rather than silently
        // stripped: rewriting destructive intent would leave the model reading
        // a success for a push that did not do what it asked.
        if (binding?.gitPolicy) {
          const git = decideGitCommand(String(((event.input as Record<string, unknown>) || {}).command || ''), binding.gitPolicy)
          if (git.action === 'deny') {
            evidence.decision('deny', git.reason)
            evidence.result(false, git.reason)
            evidence.settle('denied', git.reason)
            auditPiInTurnDecision({
              runId: binding.runId,
              sessionId: ctx.sessionId,
              tool: toolName,
              callId,
              decision: 'deny',
              settlement: 'denied',
              reason: git.reason,
            })
            markPiDeniedInTurnCall(ctx.sessionId, callId, git.reason)
            return { block: true, reason: git.reason }
          }
          if (git.action === 'rewrite') {
            ;(event.input as Record<string, unknown>).command = git.command
            evidence.update(git.note)
          }
        }
        const shell = binding?.shellPolicy
        if (!shell?.effectiveMode || shell.effectiveMode === 'off') {
          evidence.decision('allow', shell?.effectiveMode === 'off'
            ? 'Outbound Guard is off for builtin shell'
            : evaluation.reason)
          auditPiInTurnDecision({ runId: binding.runId, sessionId: ctx.sessionId, tool: toolName, callId, decision: 'allow' })
          builtinInvocations.set(migratedInvocationKey(ctx.sessionId, callId), evidence)
          return undefined
        }
        const command = ((event.input as Record<string, unknown>) || {}).command
        if (shell.effectiveMode === 'required') {
          const verification = await shell.sandboxVerification
          const admission = admitBuiltinShellSandbox({
            verification,
            runId: binding.runId,
            viewRoot: shell.viewRoot || '',
          })
          if (admission.verified) {
            // Verification authorises nothing on its own: the command must
            // actually execute under the profile the canary proved. Pi allows
            // `event.input` to be patched in place before execution, so the
            // model's command is wrapped here — whole and unparsed — rather
            // than merely permitted to run on the open host.
            const wrap = await wrapVerifiedBuiltinShell({
              evidenceBackend: admission.evidence.backend,
              runId: binding.runId,
              viewRoot: shell.viewRoot || '',
              input: event.input as Record<string, unknown>,
            })
            if (!wrap.wrapped) {
              evidence.decision('deny', wrap.reason)
              evidence.result(false, wrap.reason)
              evidence.settle('denied', wrap.reason)
              auditPiInTurnDecision({
                runId: binding.runId,
                sessionId: ctx.sessionId,
                tool: 'bash',
                callId,
                decision: 'deny',
                settlement: 'denied',
                reason: wrap.reason,
              })
              markPiDeniedInTurnCall(ctx.sessionId, callId, wrap.reason)
              return { block: true, reason: wrap.reason }
            }
            const reason = `${admission.reason} view=${admission.evidence.viewRoot}`
            evidence.decision('allow', reason)
            auditPiInTurnDecision({
              runId: binding.runId,
              sessionId: ctx.sessionId,
              tool: toolName,
              callId,
              decision: 'allow',
              reason,
            })
            builtinInvocations.set(migratedInvocationKey(ctx.sessionId, callId), evidence)
            return undefined
          }
          evidence.decision('deny', admission.reason)
          evidence.result(false, admission.reason)
          evidence.settle('denied', admission.reason)
          auditPiInTurnDecision({
            runId: binding.runId,
            sessionId: ctx.sessionId,
            tool: 'bash',
            callId,
            decision: 'deny',
            settlement: 'denied',
            reason: admission.reason,
          })
          markPiDeniedInTurnCall(ctx.sessionId, callId, admission.reason)
          return { block: true, reason: admission.reason }
        }
        const verdict = decideBuiltinShellUnderProtection({
          effectiveMode: shell.effectiveMode,
          command: String(command || ''),
          viewRoot: shell.viewRoot ?? null,
        })
        if (verdict.allow) {
          const reason = verdict.reason || evaluation.reason
          evidence.decision('allow', reason)
          if (verdict.degraded) evidence.update(reason)
          auditPiInTurnDecision({
            runId: binding.runId,
            sessionId: ctx.sessionId,
            tool: toolName,
            callId,
            decision: 'allow',
            ...(verdict.reason ? { reason: verdict.reason } : {}),
          })
          builtinInvocations.set(migratedInvocationKey(ctx.sessionId, callId), evidence)
          return undefined
        }
        evidence.decision('deny', verdict.reason || 'builtin shell denied by outbound protection')
        evidence.result(false, verdict.reason)
        evidence.settle('denied', verdict.reason)
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
export function piPackExtensionFactories(
  ctx: { sessionId: string; cwd: string; temporaryChat?: boolean },
  additionalPacks: ReadonlyArray<PiExtensionPack> = [],
): Array<{ name: string; hidden: true; factory: (pi: InlineExtensionFactoryInput) => void }> {
  return [...piExtensionPacks(), ...additionalPacks].map((pack) => ({
    name: `subagents-${pack.id}`,
    hidden: true,
    factory: (pi: InlineExtensionFactoryInput) => {
      const byName = new Map(pack.tools.map((tool) => [tool.name, tool]))
      pi.on('tool_call', async (event) => {
        const toolName = typeof event.toolName === 'string' ? event.toolName : ''
        const tool = byName.get(toolName)
        if (!tool) return undefined
        const binding = piSessionRunBinding(ctx.sessionId)
        const callId = typeof event.toolCallId === 'string' ? event.toolCallId : `${binding?.runId || 'turn'}:${toolName}`
        {
          const contract = policyEvidenceBridge?.contractIdentity(ctx.sessionId, toolName)
          const frozenPolicy = binding?.frozenPolicy
          if (!contract || !frozenPolicy || !policyEvidenceBridge) {
            const reason = `Host policy evidence unavailable for migrated tool ${toolName}`
            markPiDeniedInTurnCall(ctx.sessionId, callId, reason)
            auditPiInTurnDecision({
              runId: binding?.runId || 'turn', sessionId: ctx.sessionId, tool: toolName,
              callId, decision: 'deny', settlement: 'denied', reason,
            })
            return { block: true, reason }
          }
          const coordinates = { sessionId: ctx.sessionId, runId: binding.runId, callId }
          const evidence = new PiInvocationEvidence({
            ...coordinates,
            tool: toolName,
            origin: 'model',
            ...contract,
          }, (entry) => policyEvidenceBridge!.append(ctx.sessionId, entry))
          evidence.start()
          const evaluation = evaluatePiInvocationPolicy({
            coordinates,
            origin: 'model',
            tool: toolName,
            contract,
            args: (event.input as Record<string, unknown>) || {},
            policy: frozenPolicy,
            requirements: packPolicyRequirements(tool, (event.input as Record<string, unknown>) || {}, {
              sessionId: ctx.sessionId,
              cwd: ctx.cwd,
              runId: binding?.runId,
              temporaryChat: binding?.temporaryChat || ctx.temporaryChat,
            }),
          })
          let normalizedArgs = evaluation.normalizedArgs
          evidence.decision(evaluation.verdict, evaluation.reason)
          if (evaluation.verdict === 'deny') {
            evidence.result(false, evaluation.reason)
            evidence.settle('denied', evaluation.reason)
            markPiDeniedInTurnCall(ctx.sessionId, callId, evaluation.reason)
            auditPiInTurnDecision({
              runId: binding.runId, sessionId: ctx.sessionId, tool: toolName,
              callId, decision: 'deny', settlement: 'denied', reason: evaluation.reason,
            })
            return { block: true, reason: evaluation.reason }
          }
          if (evaluation.verdict === 'ask') {
            const resolution = await requestPiToolApproval({
              runId: binding.runId,
              sessionId: ctx.sessionId,
              tool: toolName,
              callId,
              args: evaluation.normalizedArgs as Record<string, unknown>,
              reason: evaluation.reason,
              timeoutMs: frozenPolicy.approvalTimeoutMs,
              ...(frozenPolicy.unattended ? { unattended: true } : {}),
            })
            const allowed = resolution.decision === 'allow'
            if (allowed && resolution.answer !== undefined) normalizedArgs = Object.freeze({ ...normalizedArgs, answer: resolution.answer })
            evidence.decision(allowed ? 'allow' : 'deny', resolution.reason || evaluation.reason)
            auditPiInTurnDecision({
              runId: binding.runId, sessionId: ctx.sessionId, tool: toolName,
              callId, decision: allowed ? 'allow' : 'deny',
              ...(!allowed ? { settlement: 'denied' as const, reason: resolution.reason || evaluation.reason } : {}),
            })
            if (!allowed) {
              const reason = `${toolName} was not approved (${resolution.decision}): ${evaluation.reason}`
              evidence.result(false, reason)
              evidence.settle('denied', reason)
              markPiDeniedInTurnCall(ctx.sessionId, callId, reason)
              return { block: true, reason }
            }
          } else {
            auditPiInTurnDecision({ runId: binding.runId, sessionId: ctx.sessionId, tool: toolName, callId, decision: 'allow' })
          }
          migratedInvocations.set(migratedInvocationKey(ctx.sessionId, callId), {
            evidence,
            args: normalizedArgs,
            executionRoot: frozenPolicy.outbound.restrictedViewRoot || frozenPolicy.projectRoot,
          })
          return undefined
        }
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
          execute: async (toolCallId, params) => {
            const binding = piSessionRunBinding(ctx.sessionId)
            const migrated = migratedInvocations.get(migratedInvocationKey(ctx.sessionId, toolCallId))
            const executionArgs = migrated?.args || params
            const outcome = await executePiPackToolDefinition(tool, tool.name, executionArgs as Record<string, unknown>, {
              sessionId: ctx.sessionId,
              cwd: migrated?.executionRoot || ctx.cwd,
              runId: binding?.runId,
              temporaryChat: binding?.temporaryChat || ctx.temporaryChat,
            })
            if (migrated) {
              // A structured `{ok:false}` is a successful transport but a
              // failed tool result. It stays content for Pi recovery while
              // evidence records the actual result semantics.
              const structuredFailure = Boolean(outcome.data && typeof outcome.data === 'object'
                && (outcome.data as { ok?: unknown }).ok === false)
              const resultOk = outcome.ok && !structuredFailure
              migrated.evidence.update(resultOk ? 'Extension Pack execution completed' : outcome.text)
              migrated.evidence.result(resultOk, resultOk ? 'structured result returned' : outcome.text)
              migrated.evidence.settle(outcome.denied ? 'denied' : resultOk ? 'success' : 'failed', resultOk ? undefined : outcome.text)
              migratedInvocations.delete(migratedInvocationKey(ctx.sessionId, toolCallId))
            }
            if (outcome.data && typeof outcome.data === 'object'
              && (outcome.data as { transportFailure?: unknown }).transportFailure === true) {
              throw new Error(outcome.text)
            }
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

export type PiCatalogEntry = PiToolCatalogEntry

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
      schemaDigest: schemaDigest(tool.parameters),
      ...(!active ? { reason: `Inactive this turn: load the ${pack.capability} capability or enable the tool explicitly` } : {}),
    }
  }))
}

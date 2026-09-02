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
import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { realpathSync } from 'node:fs'
import { resolve } from 'node:path'
import { homedir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { admitBuiltinShellSandbox, releaseBuiltinShellExecution, wrapVerifiedBuiltinShellCommand, type BuiltinShellSandboxVerification } from './piBuiltinShellSandbox.ts'
import { decideGitCommand, type GitCommandPolicy } from '../src/agent/tools/gitCommandPolicy.ts'
import type { SkillContextInjectionTrace, SkillRevisionIdentity } from '../src/agent/skillPreflight.ts'
import { canonicalJson, schemaDigest, type PiToolCatalogEntry } from './piToolContract.ts'
import type { MemoryAccessContext } from './durableMemoryStore.ts'
import type { WorkingExecutionEvidence } from '../src/agent/workingState.ts'
import type { MemoryControlPackageIdentity } from '../src/agent/memoryControlPackage.ts'
import {
  evaluatePiInvocationPolicy,
  PiInvocationEvidence,
  type PiFrozenRunPolicy,
  type PiInvocationContractIdentity,
  type PiPolicyEvidenceEvent,
  type PiPolicyEvaluation,
  type PiToolPolicyRequirements,
} from './piPolicyEvidence.ts'

/** A TypeBox-compatible parameter schema, written as plain JSON Schema so the Host stays dependency-free. */
export type PiToolSchema = Record<string, unknown>

export type PiToolContext = {
  sessionId: string
  /** Absolute project root the turn runs against. */
  cwd: string
  runId?: string
  callId?: string
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
  /** Explicit audit classification for tools guaranteed not to mutate or send data. */
  operationClass?: 'read'
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
  memoryAccess?: Readonly<MemoryAccessContext>
  memoryCreatedAt?: string
  shellPolicy?: {
    effectiveMode: 'required' | 'optional' | 'demo' | 'off'
    viewRoot?: string
    /** Started at Host turn admission; renderer/model input cannot supply it. */
    sandboxVerification?: Promise<BuiltinShellSandboxVerification>
  }
  /** Settings → Git preferences frozen for this run (issue 18). */
  gitPolicy?: GitCommandPolicy
  frozenPolicy?: PiFrozenRunPolicy
  completedFileEffects?: ReadonlyArray<{ path: string; sha256: string }>
  memoryControlPackage?: MemoryControlPackageIdentity
}
const sessionRuns = new Map<string, PiRunBinding>()

export function bindPiSessionRun(sessionId: string, binding: {
  runId: string
  approvalMode?: PiRunBinding['approvalMode']
  unattended?: boolean
  temporaryChat?: boolean
  memoryAccess?: MemoryAccessContext
  shellPolicy?: PiRunBinding['shellPolicy']
  gitPolicy?: PiRunBinding['gitPolicy']
  frozenPolicy?: PiFrozenRunPolicy
  completedFileEffects?: ReadonlyArray<{ path: string; sha256: string }>
  memoryControlPackage?: MemoryControlPackageIdentity
}): void {
  sessionRuns.set(sessionId, {
    runId: binding.runId,
    approvalMode: binding.approvalMode || 'auto',
    unattended: binding.unattended === true,
    ...(binding.temporaryChat !== undefined ? { temporaryChat: binding.temporaryChat } : {}),
    ...(binding.memoryAccess ? { memoryAccess: Object.freeze({ ...binding.memoryAccess }), memoryCreatedAt: new Date().toISOString() } : {}),
    ...(binding.shellPolicy ? { shellPolicy: binding.shellPolicy } : {}),
    ...(binding.gitPolicy ? { gitPolicy: binding.gitPolicy } : {}),
    ...(binding.frozenPolicy ? { frozenPolicy: binding.frozenPolicy } : {}),
    ...(binding.completedFileEffects ? { completedFileEffects: Object.freeze(binding.completedFileEffects.map((effect) => Object.freeze({ ...effect }))) } : {}),
    ...(binding.memoryControlPackage ? { memoryControlPackage: Object.freeze({ ...binding.memoryControlPackage }) } : {}),
  })
}

/**
 * Advance one admitted run from Plan to Build at an iteration boundary.
 * The run id and expected mode form a CAS guard; every other frozen field is
 * retained so a phase transition cannot accidentally drop a restriction.
 */
export function transitionPiSessionAgentMode(
  sessionId: string,
  runId: string,
  expected: 'plan' | 'build',
  next: 'plan' | 'build',
): boolean {
  const binding = sessionRuns.get(sessionId)
  if (!binding?.frozenPolicy || binding.runId !== runId || binding.frozenPolicy.agentMode !== expected) return false
  sessionRuns.set(sessionId, {
    ...binding,
    frozenPolicy: Object.freeze({ ...binding.frozenPolicy, agentMode: next }),
  })
  return true
}

const APPROVAL_STRICTNESS = { always: 0, auto: 1, full: 2 } as const

/** Apply only an equal or stricter approval posture to an active run. */
export function tightenPiSessionApprovalMode(
  sessionId: string,
  runId: string,
  requested: 'always' | 'auto' | 'full',
): boolean {
  const binding = sessionRuns.get(sessionId)
  if (!binding?.frozenPolicy || binding.runId !== runId) return false
  const current = binding.frozenPolicy.approvalMode
  if (APPROVAL_STRICTNESS[requested] > APPROVAL_STRICTNESS[current]) return false
  sessionRuns.set(sessionId, {
    ...binding,
    approvalMode: requested,
    frozenPolicy: Object.freeze({ ...binding.frozenPolicy, approvalMode: requested }),
  })
  return true
}

/** Attended may become unattended immediately; the reverse waits for a new run. */
export function tightenPiSessionUnattended(sessionId: string, runId: string): boolean {
  const binding = sessionRuns.get(sessionId)
  if (!binding?.frozenPolicy || binding.runId !== runId) return false
  if (binding.unattended && binding.frozenPolicy.unattended) return true
  sessionRuns.set(sessionId, {
    ...binding,
    unattended: true,
    frozenPolicy: Object.freeze({ ...binding.frozenPolicy, unattended: true }),
  })
  return true
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
  clearPiSessionTransientPreflightState(sessionId)
}

function clearPiSessionTransientPreflightState(sessionId: string): void {
  pendingSkillContexts.delete(sessionId)
  pendingRedraftCandidates.delete(sessionId)
  redraftAuthorizations.delete(sessionId)
  for (const key of notExecutedInTurnCalls.keys()) {
    if (key.startsWith(`${sessionId}:`)) notExecutedInTurnCalls.delete(key)
  }
  for (const [key, decision] of preflightCallDecisions) {
    if (key.startsWith(`${sessionId}:`) && decision.decision === 'pass-through') preflightCallDecisions.delete(key)
  }
  for (const [key, decision] of preflightBatchDecisions) {
    if (key.startsWith(`${sessionId}:`) && !decision.block) preflightBatchDecisions.delete(key)
  }
  for (const key of releasedPreflightCalls.keys()) {
    if (key.startsWith(`${sessionId}:`)) releasedPreflightCalls.delete(key)
  }
  for (const key of preflightCallBatchIds.keys()) {
    if (key.startsWith(`${sessionId}:`) && !preflightCallDecisions.has(key)) preflightCallBatchIds.delete(key)
  }
}

/** Remove session-lifetime idempotency tombstones only when the Pi session itself is disposed. */
export function disposePiSkillPreflightSession(sessionId: string): void {
  preflightSessionGenerations.set(sessionId, preflightSessionGeneration(sessionId) + 1)
  for (const key of preflightBatchInFlight.keys()) {
    if (key.startsWith(`${sessionId}:`)) preflightBatchInFlight.delete(key)
  }
  sessionBatchPackTools.delete(sessionId)
  pendingSkillContexts.delete(sessionId)
  pendingRedraftCandidates.delete(sessionId)
  redraftAuthorizations.delete(sessionId)
  for (const map of [notExecutedInTurnCalls, preflightCallDecisions, preflightBatchDecisions, preflightCallBatchIds, releasedPreflightCalls]) {
    for (const key of map.keys()) if (key.startsWith(`${sessionId}:`)) map.delete(key)
  }
}

/** Retire a runtime while keeping blocked identity tombstones for session replay. */
export function retirePiSkillPreflightSession(sessionId: string): void {
  // Replacing a Pi runtime must not clear the logical turn's binding: the
  // newly-created runtime still belongs to the same Host session and needs
  // its frozen policy/resource view until the turn's owner finally unbinds it.
  // In-flight batch latches and blocked identity tombstones remain durable.
  clearPiSessionTransientPreflightState(sessionId)
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
    ...(resourceView.fileDigests ? { fileDigests: Object.freeze({ ...resourceView.fileDigests }) } : {}),
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
  resolved?: (request: PiApprovalRequest, resolution: PiApprovalResolution) => void
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

/** Zero is the wire-level sentinel for an attended ask that waits for the user. */
export const PI_INTERACTIVE_APPROVAL_TIMEOUT_MS = 0

const pendingApprovals = new Map<string, {
  request: PiApprovalRequest
  resolve: (resolution: PiApprovalResolution) => void
  timer?: NodeJS.Timeout
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
  if (pending.timer) clearTimeout(pending.timer)
  pendingApprovals.delete(approvalKey(runId, callId))
  let resolution: PiApprovalResolution
  if (params.decision === 'allow') {
    resolution = {
      decision: 'allow',
      ...(typeof params.answer === 'string' ? { answer: params.answer } : {}),
    }
  } else {
    resolution = {
      decision: params.decision === 'deny' ? 'deny' : 'timeout',
      reason: params.decision === 'deny' ? 'Approval denied by user' : 'Approval timed out',
    }
  }
  pending.resolve(resolution)
  approvalBridge?.resolved?.(pending.request, resolution)
  return true
}

/** Cancel every pending ask for a run (its turn ended; nobody is listening). */
export function cancelPiApprovalsForRun(runId: string): number {
  let cancelled = 0
  for (const [key, pending] of [...pendingApprovals.entries()]) {
    if (!key.startsWith(`${runId}::`)) continue
    if (pending.timer) clearTimeout(pending.timer)
    pendingApprovals.delete(key)
    cancelled += 1
    const resolution = { decision: 'cancel' as const, reason: 'Approval cancelled with its run' }
    pending.resolve(resolution)
    approvalBridge?.resolved?.(pending.request, resolution)
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
    return { decision: 'deny', reason: 'Unattended approval denied' }
  }
  const timeoutMs = PI_INTERACTIVE_APPROVAL_TIMEOUT_MS
  const pendingRequest: PiApprovalRequest = { ...request, timeoutMs }
  return new Promise<PiApprovalResolution>((resolvePromise) => {
    const key = approvalKey(request.runId, request.callId)
    pendingApprovals.set(key, { request: pendingRequest, resolve: resolvePromise })
    approvalBridge?.request(pendingRequest)
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

type PiSkillPreflightBridgeInput = {
  sessionId: string
  runId: string
  callId: string
  tool: string
  args: Record<string, unknown>
  identity: PiInvocationContractIdentity
  trigger: NonNullable<PiPolicyEvaluation['skillPreflight']>['trigger']
  step: number
  batchId: string
  workingStateRevision: number
}

type PiSelectedPreflightSkill = SkillRevisionIdentity & { body: string }
type PiSkillPreflightDecision =
  | { kind: 'pass-through' }
  | { kind: 'redraft'; skills: PiSelectedPreflightSkill[] }

type PiSkillPreflightBridge = {
  snapshot: (sessionId: string) => { runId: string; step: number; workingStateRevision: number }
  preflight: (input: PiSkillPreflightBridgeInput) => Promise<PiSkillPreflightDecision>
  contextInjected: (sessionId: string, injection: SkillContextInjectionTrace) => void
}

let skillPreflightBridge: PiSkillPreflightBridge | undefined

type PendingSkillContext = {
  runId: string
  originalCallId: string
  tool: string
  identity: PiInvocationContractIdentity
  skills: PiSelectedPreflightSkill[]
  reason: string
  batchId: string
}

type CachedPreflightDecision = {
  identityDigest: string
  decision: 'pass-through' | 'redraft'
  reason?: string
}

type PiSkillBatchDecision = {
  identityDigest: string
  block: boolean
  reason?: string
}

const pendingSkillContexts = new Map<string, PendingSkillContext>()
const pendingRedraftCandidates = new Map<string, PendingSkillContext[]>()
const redraftAuthorizations = new Map<string, PendingSkillContext[]>()
const notExecutedInTurnCalls = new Map<string, string>()
const preflightCallDecisions = new Map<string, CachedPreflightDecision>()
const preflightBatchDecisions = new Map<string, PiSkillBatchDecision>()
const preflightBatchInFlight = new Map<string, Promise<{ block: true; reason: string } | undefined>>()
const preflightSessionGenerations = new Map<string, number>()
const preflightCallBatchIds = new Map<string, string>()
const releasedPreflightCalls = new Map<string, string>()
const sessionBatchPackTools = new Map<string, Map<string, PiPackTool>>()

function preflightSessionGeneration(sessionId: string): number {
  return preflightSessionGenerations.get(sessionId) || 0
}

function preflightGenerationIsCurrent(sessionId: string, generation: number): boolean {
  return preflightSessionGeneration(sessionId) === generation
}

/** Host-owned consumer for the pure policy directive. Missing ownership fails closed. */
export function setPiSkillPreflightBridge(bridge: PiSkillPreflightBridge | undefined): void {
  skillPreflightBridge = bridge
}

function samePreflightTool(left: PiInvocationContractIdentity, right: PiInvocationContractIdentity): boolean {
  return left.contractRevision === right.contractRevision
    && left.contractDigest === right.contractDigest
    && left.schemaDigest === right.schemaDigest
    && left.toolSource === right.toolSource
    && left.toolPack === right.toolPack
    && canonicalJson(left.packageProvenance) === canonicalJson(right.packageProvenance)
}

function sameSelectedSkills(left: PendingSkillContext, right: PendingSkillContext): boolean {
  return canonicalJson(left.skills.map(({ body: _body, ...identity }) => identity))
    === canonicalJson(right.skills.map(({ body: _body, ...identity }) => identity))
}

function skillRedraftReason(input: PendingSkillContext): string {
  const revisions = input.skills.map((skill) => `${skill.id}@${skill.version}#${skill.digest}`).join(', ')
  return `Skill preflight intervened; original call ${input.originalCallId} was not executed. Apply ${revisions} and issue a fresh ${input.tool} call identity.`
}

function preflightIdentityDigest(input: {
  runId: string
  step: number
  batchId: string
  workingStateRevision: number
  callId: string
  tool: string
  args: Record<string, unknown>
  identity: PiInvocationContractIdentity
}): string {
  return createHash('sha256').update(canonicalJson(input), 'utf8').digest('hex')
}

function preflightIdentityConflict(input: { sessionId: string; callId: string; batchId: string }): { block: true; reason: string } {
  const reason = `Skill preflight identity conflict for batch ${input.batchId}; call ${input.callId} was not executed.`
  notExecutedInTurnCalls.set(migratedInvocationKey(input.sessionId, input.callId), reason)
  return { block: true, reason }
}

function preflightGenerationFailure(input: { sessionId: string; generation?: number }): { block: true; reason: string } | undefined {
  if (input.generation !== undefined && !preflightGenerationIsCurrent(input.sessionId, input.generation)) {
    return { block: true, reason: 'Skill preflight session generation was disposed before decision.' }
  }
  return undefined
}

type PiSkillPreflightSnapshot = { runId: string; step: number; workingStateRevision: number }

async function finishSkillPreflightDecision(input: {
  evaluation: PiPolicyEvaluation
  sessionId: string
  runId: string
  callId: string
  tool: string
  args: Record<string, unknown>
  identity: PiInvocationContractIdentity
  batchId: string
  snapshot: PiSkillPreflightSnapshot
  callKey: string
  identityDigest: string
  generation?: number
}): Promise<{ block: true; reason: string } | undefined> {
  const decision = await skillPreflightBridge!.preflight({
    sessionId: input.sessionId,
    runId: input.runId,
    callId: input.callId,
    tool: input.tool,
    args: input.args,
    identity: input.identity,
    trigger: input.evaluation.skillPreflight!.trigger,
    step: input.snapshot.step,
    batchId: input.batchId,
    workingStateRevision: input.snapshot.workingStateRevision,
  })
  const generationFailure = preflightGenerationFailure(input)
  if (generationFailure) return generationFailure
  if (decision.kind === 'pass-through') {
    preflightCallDecisions.set(input.callKey, { identityDigest: input.identityDigest, decision: 'pass-through' })
    return undefined
  }
  const pending: PendingSkillContext = {
    runId: input.runId,
    originalCallId: input.callId,
    tool: input.tool,
    identity: input.identity,
    skills: decision.skills,
    reason: '',
    batchId: input.batchId,
  }
  pending.reason = skillRedraftReason(pending)
  if (!pendingSkillContexts.has(input.sessionId)) pendingSkillContexts.set(input.sessionId, pending)
  const candidates = pendingRedraftCandidates.get(input.sessionId) || []
  if (!candidates.some((candidate) => candidate.originalCallId === pending.originalCallId)) candidates.push(pending)
  pendingRedraftCandidates.set(input.sessionId, candidates)
  notExecutedInTurnCalls.set(input.callKey, pending.reason)
  preflightCallDecisions.set(input.callKey, { identityDigest: input.identityDigest, decision: 'redraft', reason: pending.reason })
  return { block: true, reason: pending.reason }
}

export async function consumePiSkillPreflightDirective(input: {
  evaluation: PiPolicyEvaluation
  sessionId: string
  runId: string
  callId: string
  tool: string
  args: Record<string, unknown>
  identity: PiInvocationContractIdentity
  batchId?: string
  generation?: number
}): Promise<{ block: true; reason: string } | undefined> {
  const initialGenerationFailure = preflightGenerationFailure(input)
  if (initialGenerationFailure) return initialGenerationFailure
  if (!input.evaluation.skillPreflight) return
  if (!skillPreflightBridge) throw new Error('Host Skill preflight owner is unavailable')
  const snapshot = skillPreflightBridge.snapshot(input.sessionId)
  const snapshotGenerationFailure = preflightGenerationFailure(input)
  if (snapshotGenerationFailure) return snapshotGenerationFailure
  if (snapshot.runId !== input.runId) throw new Error('Skill preflight run identity drifted before execution')
  const callKey = migratedInvocationKey(input.sessionId, input.callId)
  const batchId = input.batchId || preflightCallBatchIds.get(callKey)
    || `skill-batch:${input.runId}:${snapshot.step}:${input.callId}`
  const identityDigest = preflightIdentityDigest({
    runId: input.runId,
    step: snapshot.step,
    batchId,
    workingStateRevision: snapshot.workingStateRevision,
    callId: input.callId,
    tool: input.tool,
    args: input.args,
    identity: input.identity,
  })
  const cached = preflightCallDecisions.get(callKey)
  if (cached) {
    if (cached.identityDigest !== identityDigest) {
      return preflightIdentityConflict({ sessionId: input.sessionId, callId: input.callId, batchId })
    }
    if (cached.decision === 'pass-through') return undefined
    notExecutedInTurnCalls.set(callKey, cached.reason || 'Skill preflight intercepted the original call')
    return { block: true, reason: cached.reason || 'Skill preflight intercepted the original call' }
  }
  const authorizations = redraftAuthorizations.get(input.sessionId) || []
  const authorizationIndex = authorizations.findIndex((authorization) => authorization.runId === input.runId
    && authorization.originalCallId !== input.callId && authorization.tool === input.tool
    && samePreflightTool(authorization.identity, input.identity))
  if (authorizationIndex >= 0) {
    const authorizationGenerationFailure = preflightGenerationFailure(input)
    if (authorizationGenerationFailure) return authorizationGenerationFailure
    authorizations.splice(authorizationIndex, 1)
    if (authorizations.length < 1) redraftAuthorizations.delete(input.sessionId)
    preflightCallDecisions.set(callKey, { identityDigest, decision: 'pass-through' })
    return undefined
  }
  return finishSkillPreflightDecision({ ...input, batchId, snapshot, callKey, identityDigest })
}

type PiSkillBatchCall = { callId: string; tool: string; args: Record<string, unknown> }

function batchPolicyRequirements(sessionId: string, call: PiSkillBatchCall, binding: PiRunBinding): PiToolPolicyRequirements | undefined {
  if (['bash', 'edit', 'find', 'grep', 'ls', 'read', 'write'].includes(call.tool)) return builtinPolicyRequirements(call.tool)
  const tool = sessionBatchPackTools.get(sessionId)?.get(call.tool)
  if (!tool) return undefined
  return packPolicyRequirements(tool, call.args, {
    sessionId,
    cwd: binding.frozenPolicy?.projectRoot || process.cwd(),
    runId: binding.runId,
    temporaryChat: binding.temporaryChat,
  })
}

function markBatchNotExecuted(sessionId: string, calls: PiSkillBatchCall[], reason: string): void {
  for (const call of calls) notExecutedInTurnCalls.set(migratedInvocationKey(sessionId, call.callId), reason)
}

async function decideBatchPreflight(input: {
  sessionId: string
  binding: PiRunBinding & { frozenPolicy: PiFrozenRunPolicy }
  classified: Array<{ call: PiSkillBatchCall; requirements: PiToolPolicyRequirements | undefined }>
  contracts: Array<PiInvocationContractIdentity | undefined>
  batchId: string
  generation: number
}): Promise<{ block: true; reason: string } | undefined> {
  let blocked: { block: true; reason: string } | undefined
  for (let index = 0; index < input.classified.length; index += 1) {
    const { call, requirements } = input.classified[index]
    if (!requirements?.sideEffect && !requirements?.skillPreflight) continue
    const contract = input.contracts[index]
    if (!contract) return { block: true, reason: `Skill preflight contract unavailable for batch call ${call.callId}` }
    const evaluation = evaluatePiInvocationPolicy({
      coordinates: { sessionId: input.sessionId, runId: input.binding.runId, callId: call.callId },
      origin: 'model', tool: call.tool, contract, args: call.args,
      policy: input.binding.frozenPolicy, requirements,
    })
    const decision = await consumePiSkillPreflightDirective({
      evaluation,
      sessionId: input.sessionId,
      runId: input.binding.runId,
      callId: call.callId,
      tool: call.tool,
      args: evaluation.normalizedArgs as Record<string, unknown>,
      identity: contract,
      batchId: input.batchId,
      generation: input.generation,
    })
    if (decision && !blocked) blocked = decision
  }
  return blocked
}

async function preflightPiToolBatch(sessionId: string, calls: PiSkillBatchCall[], signal?: AbortSignal): Promise<{ block: true; reason: string } | undefined> {
  if (calls.length < 1) return undefined
  const generation = preflightSessionGeneration(sessionId)
  const durableTombstone = calls.find((call) => preflightCallDecisions.get(migratedInvocationKey(sessionId, call.callId))?.decision === 'redraft')
  if (durableTombstone) {
    const reason = `Skill preflight identity conflict for call ${durableTombstone.callId}; the original identity was already intercepted.`
    markBatchNotExecuted(sessionId, calls, reason)
    return { block: true, reason }
  }
  const binding = piSessionRunBinding(sessionId)
  if (!binding?.frozenPolicy || !policyEvidenceBridge || !skillPreflightBridge) {
    const reason = 'Skill preflight Host admission dependencies are unavailable; no batch call was executed.'
    markBatchNotExecuted(sessionId, calls, reason)
    return { block: true, reason }
  }
  const snapshot = skillPreflightBridge.snapshot(sessionId)
  if (snapshot.runId !== binding.runId) throw new Error('Skill preflight batch run identity drifted before execution')
  const classified = calls.map((call) => ({ call, requirements: batchPolicyRequirements(sessionId, call, binding) }))
  if (!classified.some(({ requirements }) => requirements?.sideEffect || requirements?.skillPreflight)) return undefined
  const batchId = `skill-batch:${binding.runId}:${snapshot.step}:${createHash('sha256')
    .update(canonicalJson(calls.map(({ callId, tool }) => ({ callId, tool }))), 'utf8').digest('hex')}`.slice(0, 512)
  for (const call of calls) preflightCallBatchIds.set(migratedInvocationKey(sessionId, call.callId), batchId)
  const released = calls.map((call) => releasedPreflightCalls.get(migratedInvocationKey(sessionId, call.callId)))
  const foreignRelease = released.some((releasedBatch) => releasedBatch !== undefined && releasedBatch !== batchId)
  if (foreignRelease || released.every((releasedBatch) => releasedBatch === batchId)) {
    const reason = `Skill preflight duplicate execution identity for ${batchId}; no sibling was executed.`
    markBatchNotExecuted(sessionId, calls, reason)
    return { block: true, reason }
  }
  const contracts = calls.map((call) => policyEvidenceBridge!.contractIdentity(sessionId, call.tool))
  const boundBinding = { ...binding, frozenPolicy: binding.frozenPolicy! }
  const identityDigest = createHash('sha256').update(canonicalJson({
    runId: binding.runId,
    step: snapshot.step,
    batchId,
    workingStateRevision: snapshot.workingStateRevision,
    calls: calls.map((call, index) => ({ ...call, identity: contracts[index] || null })),
  }), 'utf8').digest('hex')
  const batchKey = `${sessionId}:${batchId}`
  const cached = preflightBatchDecisions.get(batchKey)
  if (cached) {
    if (cached.identityDigest !== identityDigest) {
      const reason = `Skill preflight batch identity conflict for ${batchId}; no sibling was executed.`
      markBatchNotExecuted(sessionId, calls, reason)
      return { block: true, reason }
    }
    if (!cached.block) return undefined
    const reason = cached.reason || `Skill preflight blocked batch ${batchId}`
    markBatchNotExecuted(sessionId, calls, reason)
    return { block: true, reason }
  }
  const inFlight = preflightBatchInFlight.get(batchKey)
  if (inFlight) return inFlight
  const decisionPromise: Promise<{ block: true; reason: string } | undefined> = (async () => {
    let blocked: { block: true; reason: string } | undefined
    try {
      if (signal?.aborted) {
        blocked = { block: true, reason: `Skill preflight batch ${batchId} was cancelled before decision.` }
      } else {
        blocked = await decideBatchPreflight({ sessionId, binding: boundBinding, classified, contracts, batchId, generation })
        if (signal?.aborted) blocked = { block: true, reason: `Skill preflight batch ${batchId} was cancelled before execution.` }
      }
    } catch (error) {
      blocked = { block: true, reason: `Skill preflight batch ${batchId} failed closed: ${error instanceof Error ? error.message : 'decision unavailable'}` }
    }
    if (!preflightGenerationIsCurrent(sessionId, generation)) {
      return { block: true, reason: `Skill preflight batch ${batchId} was disposed before decision completion.` }
    }
    const reason = blocked ? `Skill preflight blocked batch ${batchId} before side effects: ${blocked.reason}` : undefined
    preflightBatchDecisions.set(batchKey, {
      identityDigest,
      block: Boolean(reason),
      ...(reason ? { reason } : {}),
    })
    if (!reason) return undefined
    markBatchNotExecuted(sessionId, calls, reason)
    return { block: true as const, reason }
  })()
  preflightBatchInFlight.set(batchKey, decisionPromise)
  try {
    return await decisionPromise
  } finally {
    if (preflightBatchInFlight.get(batchKey) === decisionPromise) preflightBatchInFlight.delete(batchKey)
  }
}

/** Install one Host-owned barrier before Pi's ordinary per-call policy hooks. */
export function installPiSkillPreflightBatchBarrier(sessionId: string, agent: {
  beforeToolCall?: (context: {
    assistantMessage: { content?: unknown[] }
    toolCall: { id: string; name: string; arguments: unknown }
    args: unknown
    context?: { tools?: Array<{ name: string; prepareArguments?: (args: unknown) => unknown }> }
  }, signal?: AbortSignal) => Promise<{ block?: boolean; reason?: string } | undefined>
}): void {
  const previous = agent.beforeToolCall?.bind(agent)
  agent.beforeToolCall = async (context, signal) => {
    const content = Array.isArray(context.assistantMessage.content) ? context.assistantMessage.content : []
    const calls = content.flatMap((item): PiSkillBatchCall[] => {
      if (!item || typeof item !== 'object' || (item as { type?: unknown }).type !== 'toolCall') return []
      const call = item as { id?: unknown; name?: unknown; arguments?: unknown }
      if (typeof call.id !== 'string' || typeof call.name !== 'string') return []
      const definition = context.context?.tools?.find((tool) => tool.name === call.name)
      const prepared = call.id === context.toolCall.id
        ? context.args
        : definition?.prepareArguments?.(call.arguments) ?? call.arguments
      return [{ callId: call.id, tool: call.name, args: Object(prepared) as Record<string, unknown> }]
    })
    const blocked = await preflightPiToolBatch(sessionId, calls, signal)
    if (blocked) return blocked
    const result = await previous?.(context, signal)
    if (!result?.block) {
      const key = migratedInvocationKey(sessionId, context.toolCall.id)
      releasedPreflightCalls.set(key, preflightCallBatchIds.get(key) || '')
    }
    return result
  }
}

export function consumePiSkillNotExecutedInTurnCall(sessionId: string, callId: string): string | undefined {
  const key = migratedInvocationKey(sessionId, callId)
  const reason = notExecutedInTurnCalls.get(key)
  if (reason !== undefined) notExecutedInTurnCalls.delete(key)
  return reason
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
    const result = await tool.execute(args, { ...ctx, ...(options.callId ? { callId: options.callId } : {}) })
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

function skillRedraftContext(input: PendingSkillContext): string {
  const bodies = input.skills.map((skill) => [
    `Skill id: ${skill.id}`,
    `Version: ${skill.version}`,
    `Digest: ${skill.digest}`,
    '<skill-body>',
    skill.body,
    '</skill-body>',
  ].join('\n')).join('\n\n')
  return [
    '[HOST SKILL PREFLIGHT REDRAFT]',
    `The original ${input.tool} call ${input.originalCallId} was NOT EXECUTED.`,
    bodies,
    `Draft a new ${input.tool} call that applies this exact immutable Skill revision.`,
    `The new call MUST use a fresh call identity; never resend ${input.originalCallId}.`,
  ].join('\n\n')
}

/** One per-session context hook injects a selected revision only on the next provider request. */
export function piSkillPreflightExtensionFactory(ctx: { sessionId: string }): {
  name: string
  hidden: true
  factory: (pi: InlineExtensionFactoryInput) => void
} {
  return {
    name: 'subagents-skill-preflight-context',
    hidden: true as const,
    factory: (pi) => {
      pi.on('context', (event) => {
        const pending = pendingSkillContexts.get(ctx.sessionId)
        if (!pending) return undefined
        if (!skillPreflightBridge) throw new Error('Host Skill preflight owner is unavailable')
        const content = skillRedraftContext(pending)
        const contextBytes = Buffer.byteLength(content, 'utf8')
        if (contextBytes > 24_576) throw new Error('Skill preflight injection exceeds the hard context budget')
        const injection: SkillContextInjectionTrace = {
          schemaVersion: 2,
          context: content,
          runId: pending.runId,
          originalCallId: pending.originalCallId,
          tool: pending.tool,
          skills: pending.skills.map(({ body: _body, ...identity }) => identity),
          contextBytes,
          contextDigest: createHash('sha256').update(content, 'utf8').digest('hex'),
          freshCallRequired: true,
        }
        pendingSkillContexts.delete(ctx.sessionId)
        const candidates = pendingRedraftCandidates.get(ctx.sessionId) || [pending]
        const authorized = candidates.filter((candidate) => candidate.batchId === pending.batchId && sameSelectedSkills(candidate, pending))
        const remaining = candidates.filter((candidate) => !authorized.includes(candidate))
        redraftAuthorizations.set(ctx.sessionId, authorized.length > 0 ? authorized : [pending])
        if (remaining.length > 0) {
          pendingRedraftCandidates.set(ctx.sessionId, remaining)
          pendingSkillContexts.set(ctx.sessionId, remaining[0])
        } else {
          pendingRedraftCandidates.delete(ctx.sessionId)
        }
        skillPreflightBridge.contextInjected(ctx.sessionId, injection)
        const messages = Array.isArray(event.messages) ? event.messages : []
        return {
          messages: [...messages, {
            role: 'user',
            content: [{ type: 'text', text: content }],
            timestamp: Date.now(),
          }],
        }
      })
    },
  }
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
        const binding = piSessionRunBinding(ctx.sessionId)
        const callId = typeof event.toolCallId === 'string' ? event.toolCallId : `${binding?.runId || 'turn'}:${toolName}`
        const contract = policyEvidenceBridge?.contractIdentity(ctx.sessionId, toolName)
        const builtinTool = ['bash', 'edit', 'find', 'grep', 'ls', 'read', 'write'].includes(toolName)
        const packageTool = contract?.toolSource === 'pi-package'
        if (!builtinTool && !packageTool) {
          const unsafeResumeTool = binding?.completedFileEffects?.length
            && (!contract || contract.toolSource === 'builtin' || contract.toolSource === 'mcp')
          if (unsafeResumeTool) {
            const reason = `resume replay refused for unclassified or MCP tool: ${toolName}`
            markPiDeniedInTurnCall(ctx.sessionId, callId, reason)
            auditPiInTurnDecision({ runId: binding.runId, sessionId: ctx.sessionId, tool: toolName, callId, decision: 'deny', settlement: 'denied', reason })
            return { block: true, reason }
          }
          return undefined
        }
        const frozenPolicy = binding?.frozenPolicy
        if (!binding || !contract || !frozenPolicy || !policyEvidenceBridge) {
          const reason = `Host policy evidence unavailable for ${packageTool ? 'Pi package tool' : 'Pi builtin'} ${toolName}`
          markPiDeniedInTurnCall(ctx.sessionId, callId, reason)
          auditPiInTurnDecision({ runId: binding?.runId || 'turn', sessionId: ctx.sessionId, tool: toolName, callId, decision: 'deny', settlement: 'denied', reason })
          return { block: true, reason }
        }
        if (binding.completedFileEffects?.length && (packageTool || toolName === 'write' || toolName === 'edit' || toolName === 'bash')) {
          const toolInput = (event.input as Record<string, unknown>) || {}
          const path = typeof toolInput.path === 'string' ? toolInput.path : ''
          const canonicalPath = path ? canonicalPiToolPath(frozenPolicy.projectRoot, path) : ''
          const protectedEffect = packageTool || toolName === 'bash'
            ? binding.completedFileEffects[0]
            : binding.completedFileEffects.find((effect) =>
                canonicalPiToolPath(frozenPolicy.projectRoot, effect.path) === canonicalPath)
          if (protectedEffect) {
            const reason = `resume replay refused for completed resource: ${protectedEffect.path}`
            markPiDeniedInTurnCall(ctx.sessionId, callId, reason)
            auditPiInTurnDecision({ runId: binding.runId, sessionId: ctx.sessionId, tool: toolName, callId, decision: 'deny', settlement: 'denied', reason })
            return { block: true, reason }
          }
        }
        const coordinates = { sessionId: ctx.sessionId, runId: binding.runId, callId }
        const evaluation = evaluatePiInvocationPolicy({
          coordinates,
          origin: 'model',
          tool: toolName,
          contract,
          args: Object(event.input) as Record<string, unknown>,
          policy: frozenPolicy,
          requirements: packageTool ? {
            capabilityApproval: `Trusted Pi Package ${contract.packageProvenance?.packageName || contract.toolPack || 'extension'} tool ${toolName} requires approval`,
            sideEffect: true,
            outbound: true,
          } : builtinPolicyRequirements(toolName),
        })
        const redraftBlock = await consumePiSkillPreflightDirective({
          evaluation,
          sessionId: ctx.sessionId,
          runId: binding.runId,
          callId,
          tool: toolName,
          args: evaluation.normalizedArgs as Record<string, unknown>,
          identity: contract,
        })
        if (redraftBlock) return redraftBlock
        const evidence = new PiInvocationEvidence({ ...coordinates, tool: toolName, origin: 'model', ...contract }, (entry) => policyEvidenceBridge!.append(ctx.sessionId, entry))
        evidence.start()
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

export const WORKING_EXECUTION_EVIDENCE_DETAIL_KEY = 'workingExecutionEvidence'

const workingWriteCanonicalPaths = new Map<string, string>()

const workingWriteEffectKey = (runId: string, callId: string) => `${runId}\u0000${callId}`

export function canonicalPiToolPath(root: string, value: string): string {
  let normalized = value.replace(/[\u00A0\u2000-\u200A\u202F\u205F\u3000]/g, ' ')
  if (normalized.startsWith('@')) normalized = normalized.slice(1)
  const path = normalized === '~'
    ? homedir()
    : normalized.startsWith('~/') || (process.platform === 'win32' && normalized.startsWith('~\\'))
      ? resolve(homedir(), normalized.slice(2))
      : /^file:\/\//.test(normalized)
        ? fileURLToPath(normalized)
        : resolve(root, normalized)
  try { return realpathSync.native(path) } catch { return path }
}

/** Host-private path captured by Pi's write resolver; never exposed to the model. */
export function consumePiWorkingWriteCanonicalPath(runId: string, callId: string): string | undefined {
  const key = workingWriteEffectKey(runId, callId)
  const path = workingWriteCanonicalPaths.get(key)
  workingWriteCanonicalPaths.delete(key)
  return path
}

type PiWriteToolDefinition = {
  execute: (
    toolCallId: string,
    args: Record<string, unknown>,
    signal?: AbortSignal,
    onUpdate?: (update: unknown) => void,
    context?: unknown,
  ) => Promise<{ content: unknown[]; details?: unknown; isError?: boolean }>
  [key: string]: unknown
}

type PiWriteEvidenceContext = {
  runId: string
  contractDigest: string
  schemaDigest: string
}

type PiWriteToolFactory = (
  cwd: string,
  options: {
    operations: {
      mkdir: (directory: string) => Promise<void>
      writeFile: (absolutePath: string, content: string) => Promise<void>
    }
  },
) => PiWriteToolDefinition

/**
 * Wrap Pi's builtin write execution boundary so only that invocation can issue
 * a receipt. The wrapper delegates the mutation first, then reads back the
 * effect before returning the same tool result to Pi.
 */
export function wrapPiBuiltinWriteWithEvidence(input: {
  cwd: string
  factory: PiWriteToolFactory
  evidenceContext: () => PiWriteEvidenceContext | undefined
  onEvidenceIssued?: (runId: string, callId: string, absolutePath: string) => void
}): PiWriteToolDefinition {
  let activeEffect: { absolutePath?: string } | undefined
  let executionQueue: Promise<void> = Promise.resolve()
  const definition = input.factory(input.cwd, {
    operations: {
      mkdir: (directory) => mkdir(directory, { recursive: true }).then(() => undefined),
      writeFile: async (absolutePath, content) => {
        await writeFile(absolutePath, content, 'utf8')
        if (activeEffect) activeEffect.absolutePath = absolutePath
      },
    },
  })
  return {
    ...definition,
    async execute(toolCallId, args, signal, onUpdate, context) {
      const run = async () => {
        const effect: { absolutePath?: string } = {}
        activeEffect = effect
        try {
          const result = await definition.execute(toolCallId, args, signal, onUpdate, context)
          const path = typeof args.path === 'string' ? args.path : ''
          const identity = input.evidenceContext()
          if (result.isError === true || !path || !effect.absolutePath || !identity) return result
          try {
            const evidence = await attestBuiltinWriteEffect({
              absolutePath: effect.absolutePath,
              runId: identity.runId,
              callId: toolCallId,
              path,
              contractDigest: identity.contractDigest,
              schemaDigest: identity.schemaDigest,
            })
            input.onEvidenceIssued?.(identity.runId, toolCallId, effect.absolutePath)
            return { ...result, details: { [WORKING_EXECUTION_EVIDENCE_DETAIL_KEY]: evidence } }
          } catch {
            return result
          }
        } finally {
          activeEffect = undefined
        }
      }
      const outcome = executionQueue.then(run, run)
      executionQueue = outcome.then(() => undefined, () => undefined)
      return outcome
    },
  }
}

/** Bind the builtin wrapper to the Host's frozen run and tool contract. */
export function piWorkingStateWriteToolDefinition(input: {
  sessionId: string
  cwd: string
  factory: PiWriteToolFactory
}): PiWriteToolDefinition {
  return wrapPiBuiltinWriteWithEvidence({
    cwd: input.cwd,
    factory: input.factory,
    onEvidenceIssued: (runId, callId, absolutePath) => {
      workingWriteCanonicalPaths.set(workingWriteEffectKey(runId, callId), absolutePath)
    },
    evidenceContext: () => {
      const binding = piSessionRunBinding(input.sessionId)
      const identity = policyEvidenceBridge?.contractIdentity(input.sessionId, 'write')
      if (!binding || identity?.toolSource !== 'builtin') return undefined
      if (typeof identity.contractDigest !== 'string' || typeof identity.schemaDigest !== 'string') return undefined
      return {
        runId: binding.runId,
        contractDigest: identity.contractDigest,
        schemaDigest: identity.schemaDigest,
      }
    },
  })
}

/** Read back one just-completed builtin write effect and issue its receipt. */
async function attestBuiltinWriteEffect(input: {
  absolutePath: string
  runId: string
  callId: string
  path: string
  contractDigest: string
  schemaDigest: string
}): Promise<WorkingExecutionEvidence> {
  const observed = await readFile(input.absolutePath)
  const resource = {
    kind: 'file-content' as const,
    path: input.path,
    sha256: createHash('sha256').update(observed).digest('hex'),
  }
  const receiptDigest = createHash('sha256').update(JSON.stringify({
    schemaVersion: 1,
    runId: input.runId,
    tool: 'write',
    callId: input.callId,
    contractDigest: input.contractDigest,
    schemaDigest: input.schemaDigest,
    resource,
  })).digest('hex')
  return {
    schemaVersion: 1,
    evidenceId: `execution:${receiptDigest}`,
    runId: input.runId,
    tool: 'write',
    callId: input.callId,
    contractDigest: input.contractDigest,
    schemaDigest: input.schemaDigest,
    receiptDigest,
    resource,
    issuedBy: 'adapter',
    attestation: 'non-model',
  }
}

/**
 * Build the inline factories handed to `DefaultResourceLoader` alongside the
 * hidden `subagents-session-context` factory. Each pack becomes one factory;
 * its `tool_call` hook is where the shared Approval Decision intercepts the
 * model's calls mid-turn, so a nested or direct call cannot slip past it.
 */
export type PiPackExtensionBundle = {
  factories: Array<{ name: string; hidden: true; factory: (pi: InlineExtensionFactoryInput) => void }>
  batchTools: Map<string, PiPackTool>
}

/** Build replacement resources without mutating the catalog used by the live session. */
export function buildPiPackExtensionBundle(
  ctx: { sessionId: string; cwd: string; temporaryChat?: boolean },
  additionalPacks: ReadonlyArray<PiExtensionPack> = [],
): PiPackExtensionBundle {
  const allPacks = [...piExtensionPacks(), ...additionalPacks]
  const batchTools = new Map(allPacks.flatMap((pack) => pack.tools.map((tool) => [tool.name, tool])))
  const factories = allPacks.map((pack) => ({
    name: `subagents-${pack.id}`,
    hidden: true as const,
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
          const requirements = packPolicyRequirements(tool, Object(event.input) as Record<string, unknown>, {
            sessionId: ctx.sessionId,
            cwd: ctx.cwd,
            runId: binding?.runId,
            temporaryChat: binding?.temporaryChat || ctx.temporaryChat,
          })
          if (binding.completedFileEffects?.length && requirements.sideEffect) {
            const reason = `resume replay refused for side-effecting extension tool: ${toolName}`
            markPiDeniedInTurnCall(ctx.sessionId, callId, reason)
            auditPiInTurnDecision({
              runId: binding.runId, sessionId: ctx.sessionId, tool: toolName,
              callId, decision: 'deny', settlement: 'denied', reason,
            })
            return { block: true, reason }
          }
          const coordinates = { sessionId: ctx.sessionId, runId: binding.runId, callId }
          const evaluation = evaluatePiInvocationPolicy({
            coordinates,
            origin: 'model',
            tool: toolName,
            contract,
            args: Object(event.input) as Record<string, unknown>,
            policy: frozenPolicy,
            requirements,
          })
          const redraftBlock = await consumePiSkillPreflightDirective({
            evaluation,
            sessionId: ctx.sessionId,
            runId: binding.runId,
            callId,
            tool: toolName,
            args: evaluation.normalizedArgs as Record<string, unknown>,
            identity: contract,
          })
          if (redraftBlock) return redraftBlock
          const evidence = new PiInvocationEvidence({
            ...coordinates,
            tool: toolName,
            origin: 'model',
            ...contract,
          }, (entry) => policyEvidenceBridge!.append(ctx.sessionId, entry))
          evidence.start()
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
              callId: toolCallId,
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
  return { factories, batchTools }
}

/** Commit the staged catalog only after its replacement Pi session is live. */
export function commitPiPackExtensionBundle(sessionId: string, bundle: PiPackExtensionBundle): void {
  sessionBatchPackTools.set(sessionId, bundle.batchTools)
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

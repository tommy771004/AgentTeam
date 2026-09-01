import { isPiTurnSettlement, type PiTurnInterruptReason, type PiTurnSettlement } from '../src/agent/piHostRun.ts'
import {
  executionSettlementFromTurnSettlement,
  isGoalVerdict,
  isRunExecutionSettlement,
  type GoalVerdict,
  type RunExecutionSettlement,
} from '../src/agent/goalOutcome.ts'
import type { TurnRecordEntry } from '../src/agent/turnRecord.ts'
import { isLegacyPiMemory, type PiMemory } from './piMemory.ts'

/**
 * Host-owned attachment journal.  This is deliberately metadata, not a
 * second transcript: the Turn Record remains the only source of entries.
 * Renderer reloads can therefore observe a run without taking ownership of
 * execution or app finalization.
 */
export type PiHostAttachmentStatus = 'active' | 'terminal'

/**
 * Durable app-finalization claim state.  Pi execution settlement remains a
 * separate, immutable Host decision; this state only coordinates the
 * renderer-owned app finalization that consumes that settlement.
 *
 * `claimantId` is an opaque renderer-instance id.  It is persisted with the
 * attachment so a Host-side CAS survives a transport reconnect; it is not a
 * credential and carries no run payload.
 */
export type PiHostFinalizationState = {
  status: 'claimed' | 'completed'
  claimantId: string
  claimEpoch: number
  leaseExpiresAt: number
  completedAt?: number
}

export type PiHostFinalizationClaimResult = {
  runId: string
  claimed: boolean
  owner: boolean
  state: 'missing' | 'active' | 'available' | 'claimed' | 'completed'
  claimEpoch: number
  leaseExpiresAt?: number
  completedAt?: number
  reason?: 'not_terminal' | 'claimed_by_other' | 'not_claimed' | 'completed'
}

export type PiHostFinalizationCompleteResult = {
  runId: string
  completed: boolean
  owner: boolean
  state: 'missing' | 'active' | 'available' | 'claimed' | 'completed'
  claimEpoch: number
  leaseExpiresAt?: number
  completedAt?: number
  reason?: 'not_terminal' | 'not_claimed' | 'not_owner' | 'completed'
}

/** Renderer-safe descriptor for the one approval blocking a Host run. */
export type PiHostPendingApproval = {
  runId: string
  sessionId: string
  tool: string
  callId: string
  args?: Record<string, unknown>
  reason?: string
  timeoutMs: number
}

/** Host-private, admission-frozen candidate. It is only consumed by app finalization. */
export type PiHostRunLearningCandidate = {
  mode: 'explicit' | 'automatic'
  memory: PiMemory
  access: {
    runId: string
    sessionId: string
    memoryReadEnabled: boolean
    memoryWriteEnabled: boolean
    temporary: boolean
    canonicalProject: string
  }
}

export type PiHostAttachment = {
  runId: string
  sessionId: string
  threadId?: string
  turn?: number
  status: PiHostAttachmentStatus
  latestSeq: number
  total: number
  settlement?: PiTurnSettlement
  /** Immutable Host terminal facts. App finalization may consume, never replace, these fields. */
  executionSettlement?: RunExecutionSettlement
  goalVerdict?: GoalVerdict
  goalContractDigest?: string
  acceptanceDigest?: string
  stopReason?: string
  interruptReason?: PiTurnInterruptReason
  summary?: string
  pendingApproval?: PiHostPendingApproval
  terminalAt?: number
  acknowledged?: boolean
  finalization?: PiHostFinalizationState
  learning?: PiHostRunLearningCandidate
}

export type PiHostAttachmentState = {
  records: PiHostAttachment[]
}

export type PiHostAttachmentPage = {
  attachment: PiHostAttachment
  entries: TurnRecordEntry[]
  latestSeq: number
  total: number
  availableFromSeq: number
  gap?: { missingBefore: number; earliestSeq: number }
}

export const PI_HOST_ATTACHMENT_TERMINAL_LIMIT = 256
export const PI_HOST_ATTACHMENT_TOMBSTONE_LIMIT = 256
export const PI_HOST_ATTACHMENT_MAX_SUMMARY_BYTES = 64 * 1024
export const PI_HOST_ATTACHMENT_TTL_MS = 24 * 60 * 60 * 1000
export const PI_HOST_ATTACHMENT_PAGE_LIMIT = 200
export const PI_HOST_ATTACHMENT_MAX_APPROVAL_BYTES = 16 * 1024
/** A crashed renderer can be replaced after this bounded lease. */
export const PI_HOST_ATTACHMENT_FINALIZATION_LEASE_MS = 30_000
const PI_HOST_ATTACHMENT_MAX_APPROVAL_STRING = 2_048
const PI_HOST_ATTACHMENT_MAX_APPROVAL_REASON = 1_024
const PI_HOST_ATTACHMENT_MAX_APPROVAL_DEPTH = 4
const PI_HOST_ATTACHMENT_MAX_APPROVAL_KEYS = 32
const PI_HOST_ATTACHMENT_MAX_APPROVAL_ITEMS = 32
const SENSITIVE_APPROVAL_KEY = /(?:api[_-]?key|access[_-]?key|token|secret|password|credential|authorization|cookie|private[_-]?key|client[_-]?secret)/i

const emptyState = (): PiHostAttachmentState => ({ records: [] })

function boundedSummary(summary: unknown): string | undefined {
  if (typeof summary !== 'string' || !summary) return undefined
  // UTF-8 byte length is the renderer-facing bound, not a JS code-unit bound.
  const bytes = new TextEncoder().encode(summary)
  if (bytes.byteLength <= PI_HOST_ATTACHMENT_MAX_SUMMARY_BYTES) return summary
  // Cut only at a UTF-8 code-point boundary. TextDecoder's replacement
  // character can itself exceed the byte budget when a multibyte character is
  // split exactly at the limit, so back up over continuation bytes first.
  let end = PI_HOST_ATTACHMENT_MAX_SUMMARY_BYTES
  while (end > 0 && (bytes[end] & 0xc0) === 0x80) end -= 1
  return new TextDecoder().decode(bytes.slice(0, end))
}

function boundedString(value: unknown, max = 160): string | undefined {
  return typeof value === 'string' && value.trim() ? value.slice(0, max) : undefined
}

const SHA256_DIGEST = /^[a-f0-9]{64}$/

function boundedDigest(value: unknown): string | undefined {
  return typeof value === 'string' && SHA256_DIGEST.test(value) ? value : undefined
}

function sanitizeApprovalValue(value: unknown, depth = 0): unknown {
  if (value === null || typeof value === 'boolean' || typeof value === 'number') return value
  if (typeof value === 'string') return value.slice(0, PI_HOST_ATTACHMENT_MAX_APPROVAL_STRING)
  if (depth >= PI_HOST_ATTACHMENT_MAX_APPROVAL_DEPTH || !value || typeof value !== 'object') return undefined
  if (Array.isArray(value)) {
    return value
      .slice(0, PI_HOST_ATTACHMENT_MAX_APPROVAL_ITEMS)
      .map((item) => sanitizeApprovalValue(item, depth + 1))
      .filter((item) => item !== undefined)
  }
  const result: Record<string, unknown> = {}
  for (const [key, item] of Object.entries(value).slice(0, PI_HOST_ATTACHMENT_MAX_APPROVAL_KEYS)) {
    if (SENSITIVE_APPROVAL_KEY.test(key)) {
      result[key] = '[redacted]'
      continue
    }
    const sanitized = sanitizeApprovalValue(item, depth + 1)
    if (sanitized !== undefined) result[key] = sanitized
  }
  return result
}

function boundedApprovalArgs(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined
  const sanitized = sanitizeApprovalValue(value)
  if (!sanitized || typeof sanitized !== 'object' || Array.isArray(sanitized)) return undefined
  const result = sanitized as Record<string, unknown>
  while (Object.keys(result).length > 0 && new TextEncoder().encode(JSON.stringify(result)).byteLength > PI_HOST_ATTACHMENT_MAX_APPROVAL_BYTES) {
    delete result[Object.keys(result).at(-1)!]
  }
  return result
}

export function normalizePiHostPendingApproval(value: unknown): PiHostPendingApproval | undefined {
  if (!value || typeof value !== 'object') return undefined
  const candidate = value as Partial<PiHostPendingApproval>
  const runId = boundedString(candidate.runId)
  const sessionId = boundedString(candidate.sessionId)
  const tool = boundedString(candidate.tool)
  const callId = boundedString(candidate.callId)
  const timeoutMs = typeof candidate.timeoutMs === 'number' && Number.isFinite(candidate.timeoutMs)
    ? Math.max(0, Math.floor(candidate.timeoutMs))
    : undefined
  if (!runId || !sessionId || !tool || !callId || timeoutMs === undefined) return undefined
  const args = boundedApprovalArgs(candidate.args)
  const reason = boundedString(candidate.reason, PI_HOST_ATTACHMENT_MAX_APPROVAL_REASON)
  return {
    runId,
    sessionId,
    tool,
    callId,
    ...(args && Object.keys(args).length ? { args } : {}),
    ...(reason ? { reason } : {}),
    timeoutMs,
  }
}

function clonePendingApproval(value: PiHostPendingApproval | undefined): PiHostPendingApproval | undefined {
  return value ? { ...value, ...(value.args ? { args: structuredClone(value.args) as Record<string, unknown> } : {}) } : undefined
}

function cloneFinalization(value: PiHostFinalizationState | undefined): PiHostFinalizationState | undefined {
  return value ? { ...value } : undefined
}

function normalizeLearning(value: unknown): PiHostRunLearningCandidate | undefined {
  if (!value || typeof value !== 'object') return undefined
  const candidate = value as Partial<PiHostRunLearningCandidate>
  if (candidate.mode !== 'explicit' && candidate.mode !== 'automatic') return undefined
  if (!isLegacyPiMemory(candidate.memory)) return undefined
  if (!candidate.access || typeof candidate.access !== 'object') return undefined
  const canonicalProject = boundedString(candidate.access.canonicalProject, 4_096)
  const runId = boundedString(candidate.access.runId)
  const sessionId = boundedString(candidate.access.sessionId)
  if (!canonicalProject || !runId || !sessionId) return undefined
  return {
    mode: candidate.mode,
    memory: {
      ...candidate.memory,
      tags: [...candidate.memory.tags],
    },
    access: {
      runId,
      sessionId,
      memoryReadEnabled: candidate.access.memoryReadEnabled === true,
      memoryWriteEnabled: candidate.access.memoryWriteEnabled === true,
      temporary: candidate.access.temporary === true,
      canonicalProject,
    },
  }
}

function cloneLearning(value: PiHostRunLearningCandidate | undefined): PiHostRunLearningCandidate | undefined {
  return value ? {
    mode: value.mode,
    memory: { ...value.memory, tags: [...value.memory.tags] },
    access: { ...value.access },
  } : undefined
}

/** Renderer projection deliberately omits the pending memory text. */
function projectAttachment(record: PiHostAttachment): PiHostAttachment {
  const { learning: _learning, ...visible } = record
  return {
    ...visible,
    ...(record.pendingApproval ? { pendingApproval: clonePendingApproval(record.pendingApproval) } : {}),
    ...(record.finalization ? { finalization: cloneFinalization(record.finalization) } : {}),
  }
}

function boundedCount(value: unknown): number {
  const parsed = typeof value === 'number' && Number.isFinite(value) ? Math.floor(value) : 0
  return Math.max(0, parsed)
}

function normalizeFinalization(value: unknown): PiHostFinalizationState | undefined {
  if (!value || typeof value !== 'object') return undefined
  const candidate = value as Partial<PiHostFinalizationState>
  if (candidate.status !== 'claimed' && candidate.status !== 'completed') return undefined
  const claimantId = boundedString(candidate.claimantId, 160)
  const claimEpoch = boundedCount(candidate.claimEpoch)
  const leaseExpiresAt = typeof candidate.leaseExpiresAt === 'number' && Number.isFinite(candidate.leaseExpiresAt)
    ? Math.max(0, candidate.leaseExpiresAt)
    : undefined
  if (!claimantId || claimEpoch < 1 || leaseExpiresAt === undefined) return undefined
  return {
    status: candidate.status,
    claimantId,
    claimEpoch,
    leaseExpiresAt,
    ...(typeof candidate.completedAt === 'number' && Number.isFinite(candidate.completedAt) ? { completedAt: candidate.completedAt } : {}),
  }
}

function normalizedTerminalFacts(record: PiHostAttachment): Partial<PiHostAttachment> {
  const executionSettlement = isRunExecutionSettlement(record.executionSettlement) ? record.executionSettlement : undefined
  const goalVerdict = isGoalVerdict(record.goalVerdict) ? record.goalVerdict : undefined
  const goalContractDigest = boundedDigest(record.goalContractDigest)
  const acceptanceDigest = boundedDigest(record.acceptanceDigest)
  const stopReason = boundedString(record.stopReason, 1_024)
  return {
    ...(executionSettlement ? { executionSettlement } : {}),
    ...(goalVerdict ? { goalVerdict } : {}),
    ...(goalContractDigest ? { goalContractDigest } : {}),
    ...(acceptanceDigest ? { acceptanceDigest } : {}),
    ...(stopReason ? { stopReason } : {}),
  }
}

/** Pick the attachment schema explicitly; never reflect persisted unknown fields. */
function normalizeRecord(record: PiHostAttachment): PiHostAttachment | undefined {
  if (!record || typeof record !== 'object') return undefined
  const runId = boundedString(record.runId)
  const sessionId = boundedString(record.sessionId)
  if (!runId || !sessionId || (record.status !== 'active' && record.status !== 'terminal')) return undefined
  const settlement = isPiTurnSettlement(record.settlement) ? record.settlement : undefined
  return {
    runId,
    sessionId,
    ...(boundedString(record.threadId) ? { threadId: boundedString(record.threadId) } : {}),
    ...(record.turn === undefined ? {} : { turn: boundedCount(record.turn) }),
    status: record.status,
    latestSeq: boundedCount(record.latestSeq),
    total: boundedCount(record.total),
    ...(settlement ? { settlement } : {}),
    ...normalizedTerminalFacts(record),
    ...(record.interruptReason === 'user' || record.interruptReason === 'timeout' ? { interruptReason: record.interruptReason } : {}),
    ...(boundedSummary(record.summary) ? { summary: boundedSummary(record.summary) } : {}),
    ...(normalizePiHostPendingApproval(record.pendingApproval) ? { pendingApproval: normalizePiHostPendingApproval(record.pendingApproval) } : {}),
    ...(typeof record.terminalAt === 'number' && Number.isFinite(record.terminalAt) ? { terminalAt: record.terminalAt } : {}),
    ...(record.acknowledged === true ? { acknowledged: true } : {}),
    ...(normalizeFinalization(record.finalization) ? { finalization: normalizeFinalization(record.finalization) } : {}),
    ...(normalizeLearning(record.learning) ? { learning: normalizeLearning(record.learning) } : {}),
  }
}

/** Mutable Host-local journal backed by the parent snapshot persistence hook. */
export class PiHostAttachmentJournal {
  private state: PiHostAttachmentState
  private readonly onChange?: (state: PiHostAttachmentState) => void
  private readonly clock: () => number

  constructor(state?: Partial<PiHostAttachmentState>, onChange?: (state: PiHostAttachmentState) => void, clock: () => number = Date.now) {
    this.clock = clock
    this.state = {
      records: Array.isArray(state?.records) ? state.records.map(normalizeRecord).filter((record): record is PiHostAttachment => Boolean(record)) : [],
    }
    this.onChange = onChange
    this.prune(this.clock())
  }

  snapshot(): PiHostAttachmentState {
    return { records: this.state.records.map((record) => ({
      ...record,
      ...(record.pendingApproval ? { pendingApproval: clonePendingApproval(record.pendingApproval) } : {}),
      ...(record.finalization ? { finalization: cloneFinalization(record.finalization) } : {}),
      ...(record.learning ? { learning: cloneLearning(record.learning) } : {}),
    })) }
  }

  private changed(): void {
    this.onChange?.(this.snapshot())
  }

  private prune(now: number): void {
    const terminal = this.state.records.filter((record) => record.status === 'terminal')
    const unexpired = terminal.filter((record) => !(record.terminalAt && now - record.terminalAt >= PI_HOST_ATTACHMENT_TTL_MS))
    // Ack ends recovery/finalization delivery, not run identity. Keep the
    // acknowledged record as a bounded tombstone so a delayed turn/submit
    // cannot resurrect the same runId after renderer settlement. Recovery and
    // tombstone retention have separate caps: a burst of pending finalization
    // must not evict recently acknowledged submission identities.
    const pending = unexpired
      .filter((record) => !record.acknowledged)
      .sort((a, b) => (a.terminalAt || 0) - (b.terminalAt || 0))
      .slice(-PI_HOST_ATTACHMENT_TERMINAL_LIMIT)
    const tombstones = unexpired
      .filter((record) => record.acknowledged)
      .sort((a, b) => (a.terminalAt || 0) - (b.terminalAt || 0))
      .slice(-PI_HOST_ATTACHMENT_TOMBSTONE_LIMIT)
    const active = this.state.records.filter((record) => record.status === 'active')
    this.state.records = [...active, ...tombstones, ...pending]
  }

  begin(input: { runId: string; sessionId: string; threadId?: string; turn?: number; learning?: PiHostRunLearningCandidate }): PiHostAttachment {
    const existing = this.state.records.find((record) => record.runId === input.runId)
    if (existing) return { ...existing }
    const record: PiHostAttachment = {
      runId: input.runId,
      sessionId: input.sessionId,
      ...(input.threadId ? { threadId: input.threadId } : {}),
      ...(input.turn === undefined ? {} : { turn: input.turn }),
      status: 'active',
      latestSeq: 0,
      total: 0,
      ...(input.learning ? { learning: cloneLearning(input.learning) } : {}),
    }
    this.state.records.push(record)
    this.changed()
    return { ...record }
  }

  append(runId: string, entries: readonly TurnRecordEntry[], latestSeq?: number): void {
    const record = this.state.records.find((candidate) => candidate.runId === runId)
    if (!record || record.status !== 'active') return
    const previousLatest = record.latestSeq
    const highest = entries.reduce((value, entry) => Math.max(value, entry.seq), 0)
    record.latestSeq = Math.max(record.latestSeq, latestSeq || 0, highest)
    const newlyObserved = entries.filter((entry) => entry.seq > previousLatest).length
    record.total = Math.max(record.total, record.total + newlyObserved, record.latestSeq)
    this.changed()
  }

  setPendingApproval(runId: string, request: PiHostPendingApproval): void {
    const record = this.state.records.find((candidate) => candidate.runId === runId)
    if (!record || record.status !== 'active') return
    const pendingApproval = normalizePiHostPendingApproval(request)
    if (!pendingApproval) return
    record.pendingApproval = pendingApproval
    this.changed()
  }

  clearPendingApproval(runId: string, callId?: string): void {
    const record = this.state.records.find((candidate) => candidate.runId === runId)
    if (!record?.pendingApproval || (callId && record.pendingApproval.callId !== callId)) return
    delete record.pendingApproval
    this.changed()
  }

  settle(
    runId: string,
    settlement: PiTurnSettlement,
    summary?: string,
    latestSeq?: number,
    interruptReason?: PiTurnInterruptReason,
    terminal?: Partial<Pick<PiHostAttachment, 'executionSettlement' | 'goalVerdict' | 'goalContractDigest' | 'acceptanceDigest' | 'stopReason'>>,
  ): PiHostAttachment | undefined {
    const record = this.state.records.find((candidate) => candidate.runId === runId)
    if (!record) return undefined
    // Terminal state is immutable: a late provider response cannot resurrect
    // cancellation or failure.
    if (record.status === 'terminal') return { ...record }
    record.status = 'terminal'
    delete record.pendingApproval
    record.settlement = settlement
    record.executionSettlement = isRunExecutionSettlement(terminal?.executionSettlement)
      ? terminal.executionSettlement
      : executionSettlementFromTurnSettlement(settlement)
    if (isGoalVerdict(terminal?.goalVerdict)) record.goalVerdict = terminal.goalVerdict
    const goalContractDigest = boundedDigest(terminal?.goalContractDigest)
    const acceptanceDigest = boundedDigest(terminal?.acceptanceDigest)
    const stopReason = boundedString(terminal?.stopReason, 1_024)
    if (goalContractDigest) record.goalContractDigest = goalContractDigest
    if (acceptanceDigest) record.acceptanceDigest = acceptanceDigest
    if (stopReason) record.stopReason = stopReason
    record.terminalAt = this.clock()
    record.acknowledged = false
    delete record.finalization
    record.latestSeq = Math.max(record.latestSeq, latestSeq || 0)
    record.total = Math.max(record.total, record.latestSeq)
    record.summary = boundedSummary(summary)
    if (interruptReason) record.interruptReason = interruptReason
    this.prune(record.terminalAt)
    this.changed()
    return { ...record }
  }

  acknowledge(runId: string): boolean {
    const record = this.state.records.find((candidate) => candidate.runId === runId)
    // Acknowledging an already-pruned/expired record is intentionally a
    // successful no-op. The renderer may retry after a transport reconnect;
    // ack must never turn that retry into an error or a second release.
    if (!record) return true
    if (record.status !== 'terminal') return false
    // A terminal outcome is retained until the renderer proves that it
    // completed the coordinator-owned app finalization.  This closes the
    // dangerous ack-before-finalize window during renderer reload.
    if (!record.finalization || record.finalization.status !== 'completed') return false
    if (record.acknowledged) return true
    record.acknowledged = true
    this.prune(this.clock())
    this.changed()
    return true
  }

  /**
   * Compare-and-swap the app-finalization owner.  Calls are synchronous inside
   * the Host request handler, so two renderer requests cannot both win.  A
   * lease is deliberately finite: if the winner disappears before completing
   * its local durable effects, a later renderer can retry after expiry.
   */
  claimFinalization(
    runId: string,
    claimantId: string,
    leaseMs = PI_HOST_ATTACHMENT_FINALIZATION_LEASE_MS,
  ): PiHostFinalizationClaimResult {
    const normalizedRunId = runId.trim()
    const normalizedClaimant = claimantId.trim().slice(0, 160)
    const record = this.state.records.find((candidate) => candidate.runId === normalizedRunId)
    if (!record) return { runId: normalizedRunId, claimed: false, owner: false, state: 'missing', claimEpoch: 0 }
    if (record.status !== 'terminal') return { runId: normalizedRunId, claimed: false, owner: false, state: 'active', claimEpoch: 0, reason: 'not_terminal' }
    if (!normalizedClaimant) return { runId: normalizedRunId, claimed: false, owner: false, state: 'available', claimEpoch: 0, reason: 'not_claimed' }
    const now = this.clock()
    const current = record.finalization
    if (current?.status === 'completed') {
      return {
        runId: normalizedRunId,
        claimed: false,
        owner: current.claimantId === normalizedClaimant,
        state: 'completed',
        claimEpoch: current.claimEpoch,
        leaseExpiresAt: current.leaseExpiresAt,
        ...(current.completedAt === undefined ? {} : { completedAt: current.completedAt }),
        reason: 'completed',
      }
    }
    if (current && current.leaseExpiresAt > now) {
      const owner = current.claimantId === normalizedClaimant
      if (owner) {
        const lease = Math.max(1, Math.floor(Number.isFinite(leaseMs) ? leaseMs : PI_HOST_ATTACHMENT_FINALIZATION_LEASE_MS))
        current.leaseExpiresAt = now + lease
        this.changed()
      }
      return {
        runId: normalizedRunId,
        claimed: owner,
        owner,
        state: 'claimed',
        claimEpoch: current.claimEpoch,
        leaseExpiresAt: current.leaseExpiresAt,
        ...(owner ? {} : { reason: 'claimed_by_other' as const }),
      }
    }
    const claimEpoch = (current?.claimEpoch || 0) + 1
    const lease = Math.max(1, Math.floor(Number.isFinite(leaseMs) ? leaseMs : PI_HOST_ATTACHMENT_FINALIZATION_LEASE_MS))
    record.finalization = {
      status: 'claimed',
      claimantId: normalizedClaimant,
      claimEpoch,
      leaseExpiresAt: now + lease,
    }
    this.changed()
    return { runId: normalizedRunId, claimed: true, owner: true, state: 'claimed', claimEpoch, leaseExpiresAt: now + lease }
  }

  /** Complete the current claim. Repeating complete is an idempotent success. */
  completeFinalization(runId: string, claimantId: string, claimEpoch: number): PiHostFinalizationCompleteResult {
    const normalizedRunId = runId.trim()
    const normalizedClaimant = claimantId.trim().slice(0, 160)
    const record = this.state.records.find((candidate) => candidate.runId === normalizedRunId)
    if (!record) return { runId: normalizedRunId, completed: false, owner: false, state: 'missing', claimEpoch: 0 }
    if (record.status !== 'terminal') return { runId: normalizedRunId, completed: false, owner: false, state: 'active', claimEpoch: 0, reason: 'not_terminal' }
    const current = record.finalization
    if (!current) return { runId: normalizedRunId, completed: false, owner: false, state: 'available', claimEpoch: 0, reason: 'not_claimed' }
    if (current.status === 'completed') {
      return {
        runId: normalizedRunId,
        completed: true,
        owner: current.claimantId === normalizedClaimant && current.claimEpoch === claimEpoch,
        state: 'completed',
        claimEpoch: current.claimEpoch,
        leaseExpiresAt: current.leaseExpiresAt,
        ...(current.completedAt === undefined ? {} : { completedAt: current.completedAt }),
        reason: 'completed',
      }
    }
    const owner = current.claimantId === normalizedClaimant && current.claimEpoch === claimEpoch
    if (!owner || current.leaseExpiresAt <= this.clock()) {
      return {
        runId: normalizedRunId,
        completed: false,
        owner: false,
        state: 'claimed',
        claimEpoch: current.claimEpoch,
        leaseExpiresAt: current.leaseExpiresAt,
        reason: 'not_owner',
      }
    }
    const completedAt = this.clock()
    record.finalization = { ...current, status: 'completed', completedAt }
    this.changed()
    return {
      runId: normalizedRunId,
      completed: true,
      owner: true,
      state: 'completed',
      claimEpoch: current.claimEpoch,
      leaseExpiresAt: current.leaseExpiresAt,
      completedAt,
    }
  }

  get(runId: string): PiHostAttachment | undefined {
    const record = this.state.records.find((candidate) => candidate.runId === runId)
    return record ? projectAttachment(record) : undefined
  }

  /** Host-only finalization input; never included in runs/active or attach. */
  learningCandidate(runId: string): PiHostRunLearningCandidate | undefined {
    const record = this.state.records.find((candidate) => candidate.runId === runId)
    return cloneLearning(record?.learning)
  }

  active(): PiHostAttachment[] {
    this.prune(this.clock())
    return this.state.records.filter((record) => record.status === 'active').map(projectAttachment)
  }

  pendingTerminal(): PiHostAttachment[] {
    this.prune(this.clock())
    return this.state.records
      .filter((record) => record.status === 'terminal' && !record.acknowledged)
      .map(projectAttachment)
  }

  /** A Host child restart has no live execution witness; active turns end honestly. */
  recoverOrphanedActive(): PiHostAttachment[] {
    const recovered: PiHostAttachment[] = []
    for (const record of this.state.records) {
      if (record.status !== 'active') continue
      record.status = 'terminal'
      delete record.pendingApproval
      record.settlement = 'interrupted'
      record.terminalAt = this.clock()
      record.acknowledged = false
      recovered.push(projectAttachment(record))
    }
    if (recovered.length) {
      this.prune(this.clock())
      this.changed()
    }
    return recovered
  }

  attach(runId: string, entries: readonly TurnRecordEntry[], before?: number, limit = PI_HOST_ATTACHMENT_PAGE_LIMIT): PiHostAttachmentPage | undefined {
    const attachment = this.get(runId)
    if (!attachment) return undefined
    const bounded = Math.min(PI_HOST_ATTACHMENT_PAGE_LIMIT, Math.max(1, Math.floor(limit || PI_HOST_ATTACHMENT_PAGE_LIMIT)))
    const ordered = [...entries].sort((a, b) => a.seq - b.seq)
    const cursor = typeof before === 'number' && Number.isFinite(before) ? before : Number.POSITIVE_INFINITY
    const page = ordered.filter((entry) => entry.seq < cursor).slice(-bounded)
    // `availableFromSeq` describes this bounded response, not merely the
    // oldest row still on disk. A caller must be told when the 200-row page
    // starts after an omitted prefix, even if the Host could page that prefix
    // separately.
    const availableFromSeq = page[0]?.seq || ordered[0]?.seq || 0
    const missingBefore = availableFromSeq > 1 ? availableFromSeq - 1 : 0
    return {
      attachment,
      entries: page,
      latestSeq: Math.max(attachment.latestSeq, ordered.at(-1)?.seq || 0),
      total: Math.max(attachment.total, ordered.length),
      availableFromSeq,
      ...(missingBefore > 0 && page.length ? { gap: { missingBefore, earliestSeq: page[0].seq } } : {}),
    }
  }
}

export function emptyPiHostAttachmentState(): PiHostAttachmentState {
  return emptyState()
}

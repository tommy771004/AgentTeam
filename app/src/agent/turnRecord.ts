/**
 * The Turn Record（回合記錄）— the Pi Core Host's append-only account of what
 * happened inside one turn.
 *
 * It exists because the answer, the model's own history, and the UI Projection
 * were each assembled separately and could disagree without anything noticing:
 * a turn published its opening narration as the answer, wrote that same wrong
 * text into its history, and every surface agreed the run had succeeded. One
 * ordered record they all derive from is what makes that disagreement
 * impossible rather than merely unlikely.
 *
 * This module is the shared vocabulary: the Host appends, the renderer reads.
 * Nothing here executes anything, so both halves can import it.
 */
import type { PiTurnInterruptReason, PiTurnSettlement } from './piHostRun.ts'
import {
  isDelegatedGoalAssignment,
  isDelegatedGoalCheck,
  isDelegatedGoalObservation,
  isWorkingExecutionEvidence,
  isWorkingState,
  isWorkingStateCheck,
  isWorkingStateProposal,
  type WorkingExecutionEvidence,
  type WorkingState,
  type WorkingStateCheck,
  type WorkingStateProposal,
  type DelegatedGoalAssignment,
  type DelegatedGoalCheck,
  type DelegatedGoalObservation,
} from './workingState.ts'
import {
  isSkillContextInjectionTrace,
  isSkillInvocationTrace,
  type SkillContextInjectionTrace,
  type SkillInvocationTrace,
} from './skillPreflight.ts'
import { isMemoryControlPackageIdentity, MEMORY_CONTROL_COMPONENT_KEYS, type MemoryControlLifecycleEvent, type MemoryControlPackageIdentity } from './memoryControlPackage.ts'
import type { RunnerCapabilities } from './runners/types.ts'

/**
 * On-disk format of the record. It is versioned inside the Pi Host Protocol
 * payload: a record this build cannot read is refused loudly, never treated as
 * empty. Version 2 adds metadata-only durable-memory recall provenance.
 * Version 3 adds Host-owned Verified Working State snapshots.
 * Version 4 adds Host-authored blocked proposals and explicit rebase verdicts.
 * Version 5 adds parent-owned delegated-goal assignment/observation/check audit.
 * Version 6 adds bounded, Host-authored Skill invocation decisions.
 * Version 7 adds immutable Skill context injection and not-executed outcomes.
 * Version 8 adds batch-bound Skill preflight idempotency identities.
 * Version 9 adds the governing Memory-Control Package and Checker linkage.
 * Version 10 adds the bounded activation/rollback event governing the run.
 */
export const TURN_RECORD_FORMAT_VERSION = 10
const LEGACY_TURN_RECORD_FORMAT_VERSIONS = new Set([1, 2, 3, 4, 5, 6, 7, 8, 9])

/**
 * What one model request actually cost, measured at the boundary that made it.
 *
 * `firstTokenAt` is the moment the model stopped thinking and started writing.
 * Splitting it out is the difference between "the provider is stalled" and
 * "the answer is long" — one total number cannot tell those apart. It is
 * absent when the request produced no text at all.
 */
export type PiStepTiming = {
  /** When the request left for the provider. */
  requestAt: number
  /** When the first token of text arrived; absent if none ever did. */
  firstTokenAt?: number
  /** When the request finished, successfully or not. */
  completedAt: number
  /**
   * What the provider reported this step spent. Every field is optional and
   * every one is MEASURED: a field is written only when the provider actually
   * reported it, and left absent otherwise. Absent and zero are different
   * facts — «快取沒省到» and «這個 provider 不談快取» must never render alike —
   * so nothing here is ever filled in with 0 to make a shape look complete.
   *
   * The cache and cost fields are additions, not a format change: a record
   * written before they existed carries the same three fields it always did
   * and projects exactly as it did then.
   */
  usage?: RecordedUsage
  /**
   * The context window of the model that served this step, as its catalog
   * states it.
   *
   * Recorded per step rather than looked up at render time for two reasons: a
   * conversation that switches models mid-run is then measured against the
   * model that ACTUALLY ran each step, and a replay a year later gets the same
   * window the live view had instead of whatever the settings say by then.
   * Absent when nobody knew it — and an absent window yields no ratio at all,
   * never a ratio against a default.
   */
  contextWindow?: number
}

/**
 * The one usage shape, named once.
 *
 * Both capture paths write it and one projection reads it, so they cannot
 * drift into two vocabularies for the same measurement — which is the whole
 * reason the panel needs no fork per runner.
 */
export type RecordedUsage = {
  input?: number
  output?: number
  total?: number
  /** Prompt tokens served from the provider's cache. */
  cachedRead?: number
  /** Prompt tokens written INTO that cache this step. */
  cachedWrite?: number
  /**
   * US dollars, priced by whoever knew the rates — the Pi model catalog on
   * the Host path, the user's own `ModelProfile.pricing` on the direct
   * OpenAI-compatible one. Absent when nobody knew them; this app keeps no
   * price list of its own and will not invent a number.
   */
  costUsd?: number
  /**
   * The prompt the step's FINAL model call actually sent, cache included.
   *
   * Not derivable from `input`: one step can make several model calls when the
   * agent uses tools, and `input` sums every one of them. Summing prompts
   * answers «這一步買了多少 token»; only the last prompt answers «模型現在握著
   * 多滿的 context», which is what a ratio against the window means. Absent
   * when the provider reported no prompt size.
   */
  contextTokens?: number
}

/** Who is accountable for an entry's content (ADR-0048). */
export type TurnRecordSource =
  /** The person driving the conversation. */
  | 'user'
  /** The model said or asked for it; it is a claim, not evidence. */
  | 'model'
  /** The Host performed it; this is the trusted adapter's own account. */
  | 'host'

/** Where an entry sits in the turn, independent of its position in the array. */
export type TurnRecordCoordinates = {
  /** Monotonic within one session; ordering is decided by this and nothing else. */
  seq: number
  /** 1-based turn number within the session. */
  turn: number
  /** 1-based step (one model request plus the tools it called) within the turn. */
  step: number
  /** Epoch milliseconds. */
  at: number
}

/**
 * Identity of the immutable Host tool contract that authorized one invocation.
 *
 * These fields are optional at the file-format boundary so records written by
 * older builds remain readable. Production Pi tool calls written by the
 * current Host populate the complete identity on both call and result entries.
 */
export type TurnRecordToolContractIdentity = {
  contractRevision?: number
  contractDigest?: string
  schemaDigest?: string
  toolSource?: 'builtin' | 'extension-pack' | 'mcp'
  toolPack?: string
  invocationOrigin?: 'model' | 'direct-protocol' | 'code-mode' | 'mcp'
  /**
   * Why this entry carries no contract identity (issue 19).
   *
   * Three different situations used to look identical in the record:
   *
   *  - `catalogued-not-in-turn-contract` — the Host knows this tool (it is in
   *    the published catalog) but this turn's frozen contract does not carry
   *    it, typically a deferred capability's tool called before loading. The
   *    schema digest and source above ARE present; only the contract revision
   *    is not, because the tool was not part of that revision.
   *  - `not-in-turn-contract` — the Host does not know this tool at all.
   *  - absent — ordinary identified call.
   *
   * Recording which keeps a refusal from reading as a dropped field.
   */
  contractStatus?: 'not-in-turn-contract' | 'catalogued-not-in-turn-contract'
}

/** Commit receipt only; private durable-memory content never enters the record. */
export type TurnRecordMemoryWrite = {
  operation: 'set' | 'append'
  id: string
  logicalKey: string
  scope: 'project'
  revision: number
  runId: string
  sessionId: string
  callId: string
}

export function asTurnRecordMemoryWrite(value: unknown, expectedCallId?: string): TurnRecordMemoryWrite | undefined {
  if (!value || typeof value !== 'object') return undefined
  const write = value as Record<string, unknown>
  const strings = [
    [write.id, 512],
    [write.logicalKey, 256],
    [write.runId, 512],
    [write.sessionId, 512],
    [write.callId, 512],
  ] as const
  if (!strings.every(([item, max]) => typeof item === 'string' && item.length > 0 && item.length <= max)) return undefined
  if (write.operation !== 'set' && write.operation !== 'append') return undefined
  if (write.scope !== 'project' || !Number.isSafeInteger(write.revision) || Number(write.revision) < 1) return undefined
  if (expectedCallId !== undefined && write.callId !== expectedCallId) return undefined
  return {
    operation: write.operation,
    id: write.id as string,
    logicalKey: write.logicalKey as string,
    scope: write.scope,
    revision: Number(write.revision),
    runId: write.runId as string,
    sessionId: write.sessionId as string,
    callId: write.callId as string,
  }
}

export type TurnRecordEntry = TurnRecordCoordinates &
  (
    | {
        kind: 'turn-start'
        source: 'host'
        /** Which runner drove the turn; absent means the builtin Pi Core loop. */
        runner?: string
        /**
         * What that runner actually does. Carried on the record so identical
         * presentation can never be read as identical guarantees: an external
         * CLI produces the same rows while still declaring that it ran no
         * builtin Parse, no DoD validation and no iterate.
         */
        capabilities?: RunnerCapabilities
      }
    | {
        kind: 'turn-end'
        source: 'host'
        settlement: PiTurnSettlement
        interruptReason?: PiTurnInterruptReason
      }
    | { kind: 'step-start'; source: 'host' }
    | {
        kind: 'step-end'
        source: 'host'
        /**
         * Measured, never inferred. A reader must not subtract one entry's
         * timestamp from another's to invent a duration: entries are appended
         * around work, not at its exact edges, and a turn can wait on tools
         * between them.
         */
        timing?: PiStepTiming
      }
    | { kind: 'user-text'; source: 'user'; content: string }
    | { kind: 'assistant-text'; source: 'model'; content: string }
    | {
        /**
         * What the model thought before it spoke or acted.
         *
         * It is a first-class entry because of the rule this project shares
         * with deepseek-harness: model-visible means logged. The thinking
         * already reached the UI as a stream; not writing it here meant that,
         * an hour later, nobody could answer «為什麼它那時決定跑這個指令» —
         * the record held the tool call and not one word of its reason.
         *
         * Kept WHOLE. There is no per-entry truncation and no per-turn budget,
         * a decision taken deliberately: a summarised thought is evidence of a
         * thought, not the thought. Volume is served by the bounded paging
         * every reader already goes through, never by silently shortening what
         * the model actually said.
         */
        kind: 'reasoning'
        source: 'model'
        content: string
      }
    | ({
        kind: 'tool-call'
        source: 'model'
        tool: string
        callId: string
        /** The arguments as recorded, so a replay re-presents identically (ADR-0050). */
        args?: unknown
        path?: string
      } & TurnRecordToolContractIdentity)
    | ({
        kind: 'tool-result'
        source: 'host'
        tool: string
        callId: string
        settlement: 'success' | 'failed' | 'cancelled' | 'denied' | 'not-executed'
        detail?: string
        memoryWrite?: TurnRecordMemoryWrite
        /** Adapter-issued, bounded identity for a verified state-changing result. */
        executionEvidence?: WorkingExecutionEvidence
      } & TurnRecordToolContractIdentity)
    | ({
        /** Host-owned policy/evidence lifecycle for a migrated invocation. */
        kind: 'tool-evidence'
        source: 'host'
        tool: string
        runId: string
        callId: string
        parentRunId?: string
        phase: 'start' | 'decision' | 'update' | 'result' | 'settlement'
        decision?: 'allow' | 'ask' | 'deny'
        settlement?: 'success' | 'failed' | 'cancelled' | 'denied'
        /** Bounded metadata only; never raw tool output or credentials. */
        detail?: string
      } & TurnRecordToolContractIdentity)
    | { kind: 'approval'; source: 'host'; tool: string; callId: string; decision: string; reason?: string }
    | { kind: 'compaction'; source: 'host'; replaced: number; tokens?: number }
    | {
        /** Bounded provenance only. Memory text stays in the Host context. */
        kind: 'memory-recall'
        source: 'host'
        revision: number
        items: Array<{
          id: string
          logicalKey: string
          scope: 'global' | 'project'
          memoryKind: 'memory' | 'profile' | 'document'
          revision: number
        }>
      }
    | {
        /** A candidate patch, never a completion fact; source stays accountable. */
        kind: 'state-proposal'
        source: 'model' | 'host'
        proposal: WorkingStateProposal
      }
    | {
        /** Host Checker verdict over one exact proposal and result identity. */
        kind: 'state-check'
        source: 'host'
        check: WorkingStateCheck
        /** Absent only on legacy records written before format v9. */
        packageIdentity?: MemoryControlPackageIdentity
      }
    | {
        /** Canonical Host snapshot for one Task run; models can only observe it. */
        kind: 'working-state'
        source: 'host'
        state: WorkingState
      }
    | { kind: 'delegation-assignment'; source: 'host'; assignment: DelegatedGoalAssignment }
    | { kind: 'delegation-observation'; source: 'host'; observation: DelegatedGoalObservation }
    | { kind: 'delegation-check'; source: 'host'; check: DelegatedGoalCheck; packageIdentity?: MemoryControlPackageIdentity }
    | { kind: 'memory-control-package'; source: 'host'; packageIdentity: MemoryControlPackageIdentity; lifecycleEvent?: MemoryControlLifecycleEvent }
    | { kind: 'memory-control-lifecycle'; source: 'host'; event: MemoryControlLifecycleEvent }
    | { kind: 'skill-invocation'; source: 'host'; invocation: SkillInvocationTrace }
    | { kind: 'skill-context'; source: 'host'; injection: SkillContextInjectionTrace }
    | {
        /** A fact the user must see that is not a tool call or a message. */
        kind: 'notice'
        source: 'host'
        topic: string
        text: string
      }
  )

/**
 * `Omit` over a union keeps only the keys every member shares, which would
 * erase every entry kind's own fields. Distributing it preserves the union.
 */
type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never

/** One entry before the record assigns its sequence number. */
export type TurnRecordAppend = DistributiveOmit<TurnRecordEntry, 'seq'>

/** One entry before the recorder fills in where and when it happened. */
export type TurnRecordDraft = DistributiveOmit<TurnRecordEntry, 'seq' | 'turn' | 'step' | 'at'>

export type TurnRecord = {
  version: number
  entries: TurnRecordEntry[]
}

export const EMPTY_TURN_RECORD: TurnRecord = { version: TURN_RECORD_FORMAT_VERSION, entries: [] }

/** A record written by a build this one cannot read. */
export class TurnRecordVersionError extends Error {
  readonly found: unknown

  constructor(found: unknown) {
    super(`Unreadable Turn Record format version: ${String(found)}`)
    this.name = 'TurnRecordVersionError'
    this.found = found
  }
}

/** A record whose middle is damaged — not a torn tail, and not recoverable. */
export class TurnRecordCorruptError extends Error {
  readonly index: number

  constructor(index: number) {
    super(`Turn Record entry ${index} is unreadable and is not the final entry`)
    this.name = 'TurnRecordCorruptError'
    this.index = index
  }
}

const KINDS = new Set([
  'turn-start',
  'turn-end',
  'step-start',
  'step-end',
  'user-text',
  'assistant-text',
  'reasoning',
  'tool-call',
  'tool-result',
  'tool-evidence',
  'approval',
  'compaction',
  'memory-recall',
  'state-proposal',
  'state-check',
  'working-state',
  'delegation-assignment',
  'delegation-observation',
  'delegation-check',
  'memory-control-package',
  'memory-control-lifecycle',
  'skill-invocation',
  'skill-context',
  'notice',
])

const MEMORY_RECALL_ENTRY_KEYS = new Set(['kind', 'source', 'revision', 'items', 'seq', 'turn', 'step', 'at'])

function isMemoryControlLifecycleEvent(value: unknown): value is MemoryControlLifecycleEvent {
  if (!value || typeof value !== 'object') return false
  const event = value as Record<string, unknown>
  return Object.keys(event).every((key) => ['sequence', 'kind', 'revision', 'fromRevision', 'diagnosisComponent', 'reason'].includes(key))
    && Number.isSafeInteger(event.sequence) && Number(event.sequence) > 0
    && ['candidate-created', 'candidate-activated', 'candidate-rejected', 'rollback'].includes(String(event.kind))
    && Number.isSafeInteger(event.revision) && Number(event.revision) > 0
    && (event.fromRevision === undefined || (Number.isSafeInteger(event.fromRevision) && Number(event.fromRevision) > 0))
    && (event.diagnosisComponent === undefined || MEMORY_CONTROL_COMPONENT_KEYS.includes(event.diagnosisComponent as never))
    && typeof event.reason === 'string' && event.reason.length > 0 && new TextEncoder().encode(event.reason).byteLength <= 2 * 1024
}

function isMemoryRecallEntry(entry: Record<string, unknown>): boolean {
  if (entry.source !== 'host' || Object.keys(entry).some((key) => !MEMORY_RECALL_ENTRY_KEYS.has(key))) return false
  if (!Number.isSafeInteger(entry.revision) || Number(entry.revision) < 0 || !Array.isArray(entry.items) || entry.items.length < 1 || entry.items.length > 100) return false
  return entry.items.every((value) => {
    if (!value || typeof value !== 'object') return false
    const item = value as Record<string, unknown>
    if (Object.keys(item).some((key) => !['id', 'logicalKey', 'scope', 'memoryKind', 'revision'].includes(key))) return false
    return typeof item.id === 'string' && item.id.length > 0 && item.id.length <= 512
      && typeof item.logicalKey === 'string' && item.logicalKey.length > 0 && item.logicalKey.length <= 256
      && (item.scope === 'global' || item.scope === 'project')
      && (item.memoryKind === 'memory' || item.memoryKind === 'profile' || item.memoryKind === 'document')
      && Number.isSafeInteger(item.revision) && Number(item.revision) > 0 && Number(item.revision) <= Number(entry.revision)
  })
}

function isWorkingStateContextEntry(entry: Record<string, unknown>): boolean | undefined {
  if (entry.kind === 'memory-control-package') {
    return isMemoryControlPackageEntry(entry)
  }
  if (entry.kind === 'memory-control-lifecycle') {
    return entry.source === 'host'
      && Object.keys(entry).every((key) => ['kind', 'source', 'event', 'seq', 'turn', 'step', 'at'].includes(key))
      && isMemoryControlLifecycleEvent(entry.event)
  }
  if (entry.kind === 'state-proposal') {
    return (entry.source === 'model' || entry.source === 'host')
      && Object.keys(entry).every((key) => ['kind', 'source', 'proposal', 'seq', 'turn', 'step', 'at'].includes(key))
      && isWorkingStateProposal(entry.proposal)
      && entry.source === entry.proposal.source
  }
  if (entry.kind === 'state-check') {
    return entry.source === 'host'
      && Object.keys(entry).every((key) => ['kind', 'source', 'check', 'packageIdentity', 'seq', 'turn', 'step', 'at'].includes(key))
      && isWorkingStateCheck(entry.check)
      && (entry.packageIdentity === undefined || isMemoryControlPackageIdentity(entry.packageIdentity))
  }
  if (entry.kind === 'working-state') {
    return entry.source === 'host'
      && Object.keys(entry).every((key) => ['kind', 'source', 'state', 'seq', 'turn', 'step', 'at'].includes(key))
      && isWorkingState(entry.state)
  }
  return isDelegationContextEntry(entry)
}

function isMemoryControlPackageEntry(entry: Record<string, unknown>): boolean {
  if (entry.source !== 'host'
    || Object.keys(entry).some((key) => !['kind', 'source', 'packageIdentity', 'lifecycleEvent', 'seq', 'turn', 'step', 'at'].includes(key))
    || !isMemoryControlPackageIdentity(entry.packageIdentity)) return false
  if (entry.lifecycleEvent === undefined) return true
  return isMemoryControlLifecycleEvent(entry.lifecycleEvent)
    && ['candidate-activated', 'rollback'].includes(entry.lifecycleEvent.kind)
    && entry.lifecycleEvent.revision === entry.packageIdentity.revision
}

function isDelegationContextEntry(entry: Record<string, unknown>): boolean | undefined {
  if (entry.kind === 'delegation-assignment') {
    return entry.source === 'host'
      && Object.keys(entry).every((key) => ['kind', 'source', 'assignment', 'seq', 'turn', 'step', 'at'].includes(key))
      && isDelegatedGoalAssignment(entry.assignment)
  }
  if (entry.kind === 'delegation-observation') {
    return entry.source === 'host'
      && Object.keys(entry).every((key) => ['kind', 'source', 'observation', 'seq', 'turn', 'step', 'at'].includes(key))
      && isDelegatedGoalObservation(entry.observation)
  }
  if (entry.kind === 'delegation-check') {
    return entry.source === 'host'
      && Object.keys(entry).every((key) => ['kind', 'source', 'check', 'packageIdentity', 'seq', 'turn', 'step', 'at'].includes(key))
      && isDelegatedGoalCheck(entry.check)
      && (entry.packageIdentity === undefined || isMemoryControlPackageIdentity(entry.packageIdentity))
  }
  if (entry.kind === 'skill-invocation') {
    return entry.source === 'host'
      && Object.keys(entry).every((key) => ['kind', 'source', 'invocation', 'seq', 'turn', 'step', 'at'].includes(key))
      && isSkillInvocationTrace(entry.invocation)
  }
  if (entry.kind === 'skill-context') {
    return entry.source === 'host'
      && Object.keys(entry).every((key) => ['kind', 'source', 'injection', 'seq', 'turn', 'step', 'at'].includes(key))
      && isSkillContextInjectionTrace(entry.injection)
  }
  return undefined
}

function isHostContextEntry(entry: Record<string, unknown>): boolean {
  if (entry.kind === 'memory-recall') return isMemoryRecallEntry(entry)
  const workingStateEntry = isWorkingStateContextEntry(entry)
  if (workingStateEntry !== undefined) return workingStateEntry
  if (entry.kind === 'notice') return typeof entry.topic === 'string' && typeof entry.text === 'string'
  if (entry.kind === 'tool-result') {
    if (!['success', 'failed', 'cancelled', 'denied', 'not-executed'].includes(String(entry.settlement))) return false
    if (entry.memoryWrite !== undefined && !asTurnRecordMemoryWrite(entry.memoryWrite, String(entry.callId || ''))) return false
    return entry.executionEvidence === undefined || isWorkingExecutionEvidence(entry.executionEvidence)
  }
  return true
}

function isEntry(value: unknown): value is TurnRecordEntry {
  if (!value || typeof value !== 'object') return false
  const entry = value as Record<string, unknown>
  if (typeof entry.kind !== 'string' || !KINDS.has(entry.kind)) return false
  if (entry.source !== 'user' && entry.source !== 'model' && entry.source !== 'host') return false
  for (const field of ['seq', 'turn', 'step', 'at'] as const) {
    const number = entry[field]
    if (typeof number !== 'number' || !Number.isFinite(number)) return false
  }
  if ((entry.kind === 'user-text' || entry.kind === 'assistant-text' || entry.kind === 'reasoning') && typeof entry.content !== 'string') return false
  if ((entry.kind === 'tool-call' || entry.kind === 'tool-result' || entry.kind === 'tool-evidence' || entry.kind === 'approval')
    && (typeof entry.tool !== 'string' || typeof entry.callId !== 'string')) return false
  if (entry.kind === 'tool-call' || entry.kind === 'tool-result' || entry.kind === 'tool-evidence') {
    const hasContractIdentity = entry.contractRevision !== undefined
      || entry.contractDigest !== undefined
      || entry.schemaDigest !== undefined
      || entry.toolSource !== undefined
      || entry.toolPack !== undefined
      || entry.invocationOrigin !== undefined
    if (hasContractIdentity) {
      if (typeof entry.contractRevision !== 'number' || !Number.isInteger(entry.contractRevision) || entry.contractRevision < 1) return false
      // Optional at the format boundary so records from the pre-digest build
      // remain readable; the current Host writes it for every new invocation.
      if (entry.contractDigest !== undefined && (typeof entry.contractDigest !== 'string' || !/^[a-f0-9]{64}$/.test(entry.contractDigest))) return false
      if (typeof entry.schemaDigest !== 'string' || !/^[a-f0-9]{64}$/.test(entry.schemaDigest)) return false
      if (entry.toolSource !== 'builtin' && entry.toolSource !== 'extension-pack' && entry.toolSource !== 'mcp') return false
      if (entry.toolPack !== undefined && typeof entry.toolPack !== 'string') return false
      if (entry.invocationOrigin !== 'model' && entry.invocationOrigin !== 'direct-protocol' && entry.invocationOrigin !== 'code-mode' && entry.invocationOrigin !== 'mcp') return false
    }
  }
  if (entry.kind === 'tool-evidence') {
    if (typeof entry.runId !== 'string' || !['start', 'decision', 'update', 'result', 'settlement'].includes(String(entry.phase))) return false
    if (entry.parentRunId !== undefined && typeof entry.parentRunId !== 'string') return false
    if (entry.decision !== undefined && entry.decision !== 'allow' && entry.decision !== 'ask' && entry.decision !== 'deny') return false
    if (entry.settlement !== undefined && entry.settlement !== 'success' && entry.settlement !== 'failed' && entry.settlement !== 'cancelled' && entry.settlement !== 'denied') return false
    if (entry.detail !== undefined && (typeof entry.detail !== 'string' || new TextEncoder().encode(entry.detail).byteLength > 1_024)) return false
  }
  if (!isHostContextEntry(entry)) return false
  return true
}

/**
 * Read a persisted record.
 *
 * Three outcomes, and the difference between them is the point:
 * a version this build does not know THROWS, because silently starting from an
 * empty record is data loss performed rather than reported; a damaged entry in
 * the middle THROWS for the same reason; a damaged FINAL entry is a torn write
 * (the process died mid-append), so the good prefix is kept and the loss is
 * reported to the caller instead of being swallowed.
 */
export function parseTurnRecord(value: unknown): { record: TurnRecord; tornTail: boolean } {
  if (value === undefined || value === null) return { record: { ...EMPTY_TURN_RECORD, entries: [] }, tornTail: false }
  if (typeof value !== 'object') throw new TurnRecordVersionError(value)
  const raw = value as { version?: unknown; entries?: unknown }
  if (raw.version !== TURN_RECORD_FORMAT_VERSION && !LEGACY_TURN_RECORD_FORMAT_VERSIONS.has(Number(raw.version))) {
    throw new TurnRecordVersionError(raw.version)
  }
  const entries = Array.isArray(raw.entries) ? raw.entries : []
  const kept: TurnRecordEntry[] = []
  let tornTail = false
  for (let index = 0; index < entries.length; index += 1) {
    if (isLegacyIncompatibleEntry(Number(raw.version), entries[index])) throw new TurnRecordCorruptError(index)
    if (isEntry(entries[index])) {
      kept.push(entries[index] as TurnRecordEntry)
      continue
    }
    if (index === entries.length - 1) {
      tornTail = true
      break
    }
    throw new TurnRecordCorruptError(index)
  }
  return { record: { version: TURN_RECORD_FORMAT_VERSION, entries: kept }, tornTail }
}

function isLegacyIncompatibleEntry(version: number, value: unknown): boolean {
  if (!value || typeof value !== 'object') return false
  const entry = value as Record<string, unknown>
  const kind = String(entry.kind || '')
  if (version === 1 && kind === 'memory-recall') return true
  if (version <= 2 && kind === 'working-state') return true
  if (version < 9 && (kind === 'memory-control-package'
    || ((kind === 'state-check' || kind === 'delegation-check') && entry.packageIdentity !== undefined))) return true
  if (version < 10 && kind === 'memory-control-package' && entry.lifecycleEvent !== undefined) return true
  if (version < 10 && kind === 'memory-control-lifecycle') return true
  if (isLegacySkillEntry(version, kind, entry)) return true
  return version < 5 && ['delegation-assignment', 'delegation-observation', 'delegation-check'].includes(kind)
}

function isLegacySkillEntry(version: number, kind: string, entry: Record<string, unknown>): boolean {
  if (version < 6 && kind === 'skill-invocation') return true
  if (version < 7 && kind === 'skill-context') return true
  if (version < 7 && kind === 'tool-result' && entry.settlement === 'not-executed') return true
  if (version < 7 && kind === 'skill-invocation' && isRedraftSkillInvocation(entry.invocation)) return true
  return version < 8 && kind === 'skill-invocation' && isBatchSkillInvocation(entry.invocation)
}

function isRedraftSkillInvocation(value: unknown): boolean {
  if (!value || typeof value !== 'object') return false
  const decision = value as Record<string, unknown>
  return decision.decision === 'redraft' || decision.matchCount !== 0 || decision.selectedSkills !== undefined
}

function isBatchSkillInvocation(value: unknown): boolean {
  return Boolean(value && typeof value === 'object' && (value as Record<string, unknown>).schemaVersion === 2)
}

/**
 * The sequence number the next appended entry will receive.
 *
 * Exported because the Host publishes entries live, one at a time, long before
 * the turn commits them — and a live entry must carry the SAME `seq` its
 * committed twin will get, or the two projections of one turn would disagree
 * about order. One function decides it, so they cannot drift.
 */
export function nextTurnRecordSeq(record: TurnRecord | undefined): number {
  const base = record && (record.version === TURN_RECORD_FORMAT_VERSION || LEGACY_TURN_RECORD_FORMAT_VERSIONS.has(record.version))
    ? record.entries
    : []
  return (base.length > 0 ? base[base.length - 1].seq : 0) + 1
}

/**
 * Append entries, assigning the next sequence numbers.
 *
 * Sequence is owned here so no caller can invent one, and so a reader never
 * has to fall back on array position to know what happened first.
 */
export function appendTurnRecord(
  record: TurnRecord | undefined,
  entries: TurnRecordAppend[],
): TurnRecord {
  const base = record && (record.version === TURN_RECORD_FORMAT_VERSION || LEGACY_TURN_RECORD_FORMAT_VERSIONS.has(record.version))
    ? record.entries
    : []
  let seq = nextTurnRecordSeq(record) - 1
  const appended = entries.map((entry) => {
    seq += 1
    return { ...entry, seq } as TurnRecordEntry
  })
  return { version: TURN_RECORD_FORMAT_VERSION, entries: [...base, ...appended] }
}

/** Latest canonical state in the record, optionally scoped to one Task run. */
export function workingStateFromTurnRecord(
  record: TurnRecord | undefined,
  runId?: string,
): WorkingState | undefined {
  let latest: WorkingState | undefined
  for (const entry of turnRecordEntries(record)) {
    if (entry.kind !== 'working-state') continue
    if (runId !== undefined && entry.state.runId !== runId) continue
    if (!latest || entry.state.revision >= latest.revision) latest = entry.state
  }
  return latest
}

/** One message as the model's own history carries it. */
export type PiRecordedMessage = { role: 'user' | 'assistant' | 'tool'; content: string }

/**
 * The model's history, derived from the record rather than accumulated beside it.
 *
 * Tool calls and their results are part of it: a follow-up turn needs to know
 * what the agent DID, not only what it said, and a history of prose alone made
 * the model re-explain work it had already done. A compaction entry replays as
 * the drop it performed, so a shortened context is reproduced rather than
 * re-grown on the next derivation.
 */
export function derivePiHistory(record: TurnRecord | undefined): PiRecordedMessage[] {
  const messages: PiRecordedMessage[] = []
  for (const entry of turnRecordEntries(record)) {
    switch (entry.kind) {
      case 'user-text':
        messages.push({ role: 'user', content: entry.content })
        break
      case 'assistant-text':
        messages.push({ role: 'assistant', content: entry.content })
        break
      case 'tool-call':
        messages.push({ role: 'tool', content: `→ ${entry.tool}(${entry.callId})${entry.path ? ` ${entry.path}` : ''}` })
        break
      case 'tool-result':
        messages.push({ role: 'tool', content: `← ${entry.tool}(${entry.callId}) ${entry.settlement}${entry.detail ? `: ${entry.detail}` : ''}` })
        break
      case 'compaction':
        messages.splice(0, Math.max(0, Math.min(entry.replaced, messages.length)))
        break
      default:
        break
    }
  }
  return messages
}

/** One bounded page of a record, addressed by sequence. */
export type TurnRecordPage = {
  /** The page's entries in ascending `seq`, oldest first. */
  entries: TurnRecordEntry[]
  /**
   * Ask for the page before this one by passing it as `before`. Absent when
   * the page reaches the beginning of the record.
   */
  nextBefore?: number
  /** Whether older entries remain unloaded ahead of this page. */
  hasOlder: boolean
  /** Entries in the whole record, so a view can say what it has not loaded. */
  total: number
}

/** How many entries one page carries unless a caller asks for fewer. */
export const TURN_RECORD_PAGE_SIZE = 100

/**
 * One page of a record, newest end first.
 *
 * A long run's earliest steps used to be the first thing the product forgot,
 * because the whole record travelled at once and memory bounded what survived.
 * Paging by `seq` — never by array position — means a view holds what it is
 * showing and can always ask for the page before it.
 */
export function pageTurnRecord(
  record: TurnRecord | undefined,
  options: { before?: number; limit?: number } = {},
): TurnRecordPage {
  const ordered = turnRecordEntries(record)
  const limit = Math.max(1, Math.min(TURN_RECORD_PAGE_SIZE, Math.floor(options.limit ?? TURN_RECORD_PAGE_SIZE)))
  const before = typeof options.before === 'number' && Number.isFinite(options.before) ? options.before : undefined
  const eligible = before === undefined ? ordered : ordered.filter((entry) => entry.seq < before)
  const entries = eligible.slice(-limit)
  const hasOlder = entries.length < eligible.length
  return {
    entries,
    ...(hasOlder && entries.length > 0 ? { nextBefore: entries[0].seq } : {}),
    hasOlder,
    total: ordered.length,
  }
}

/** One step's timing, as a reader needs it. */
export type PiStepTimingView = {
  turn: number
  step: number
  /** Present only once the step has ended. */
  waitingMs?: number
  generatingMs?: number
  totalMs?: number
  usage?: PiStepTiming['usage']
  /** The window of the model that served this step, when its catalog stated one. */
  contextWindow?: number
  /** True while the step has started and not yet ended. */
  running: boolean
}

/**
 * Per-step timing for a record.
 *
 * A step still running reports `running: true` and NO durations. Inventing one
 * — by measuring against "now", or by subtracting the previous entry — would
 * put a number on screen that was never measured, which is the same class of
 * mistake as publishing an answer nobody wrote.
 */
export function stepTimings(record: TurnRecord | undefined): PiStepTimingView[] {
  const views = new Map<string, PiStepTimingView>()
  for (const entry of turnRecordEntries(record)) {
    if (entry.kind !== 'step-start' && entry.kind !== 'step-end') continue
    const key = `${entry.turn}:${entry.step}`
    if (entry.kind === 'step-start') {
      views.set(key, { turn: entry.turn, step: entry.step, running: true })
      continue
    }
    const view = views.get(key) || { turn: entry.turn, step: entry.step, running: true }
    const timing = entry.timing
    views.set(key, {
      ...view,
      running: false,
      ...(timing
        ? {
            ...(timing.firstTokenAt === undefined
              ? {}
              : {
                  waitingMs: Math.max(0, timing.firstTokenAt - timing.requestAt),
                  generatingMs: Math.max(0, timing.completedAt - timing.firstTokenAt),
                }),
            totalMs: Math.max(0, timing.completedAt - timing.requestAt),
            ...(timing.usage ? { usage: timing.usage } : {}),
            ...(timing.contextWindow ? { contextWindow: timing.contextWindow } : {}),
          }
        : {}),
    })
  }
  return [...views.values()]
}

/** What the record says about the runner that drove it. */
export function recordRunnerDeclaration(
  record: TurnRecord | undefined,
): { runner: string; capabilities?: RunnerCapabilities } | undefined {
  for (const entry of turnRecordEntries(record)) {
    if (entry.kind !== 'turn-start') continue
    if (!entry.runner) continue
    return { runner: entry.runner, ...(entry.capabilities ? { capabilities: entry.capabilities } : {}) }
  }
  return undefined
}

/** Entries in the order they happened, decided by `seq` and never by position. */
export function turnRecordEntries(record: TurnRecord | undefined): TurnRecordEntry[] {
  if (!record?.entries?.length) return []
  return [...record.entries].sort((left, right) => left.seq - right.seq)
}

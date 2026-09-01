/**
 * Canonical task-run seam.
 *
 * Phase 3 ownership:
 *   item 1 — ingress (`runTask` / `coordinateTaskRun`)
 *   item 2 — capacity · attachments · thread bind · beforeRun (once)
 *   item 3 — build `RunDispatchSnapshot`; runDispatch only selects runner
 *   item 4/5 — unique finalization order; only finalization drains
 *
 * Store/hook dependencies are loaded lazily so pure helpers (normalizeTaskRunInput)
 * stay importable without pulling the full renderer graph.
 */

import { conversationAnswer } from './conversationProjection.ts'
import type {
  AgentState,
  ChatAttachment,
  LlmSettings,
  LoopType,
  RuntimeOverrides,
} from './types.ts'
import type {
  ExternalRunOpts,
  ExternalRunResult,
  RunSourceKind,
} from './taskRunTypes.ts'
import type { BusyPolicy, TakeoverOutcome } from './taskRunPolicy.ts'
import type { DispatchResult } from './runDispatch.ts'
import type { HookEvaluation } from './hooks.ts'
import type { ThreadRunner } from '../store/threadStore.ts'
import { findReplaySafeCheckpoint } from './runFork.ts'
import {
  buildExternalCliDelegateContract,
  capabilitiesForRunner,
  executionKindForRunner,
  instructionDeliveryForRunner,
} from './runners/types.ts'
import { buildRunContextPolicy, resolveRunSettingsOverrides, snapshotRunSettings, withRunShellPolicy } from './runSettingsSnapshot.ts'
import { normalizeExternalCliRunPolicy } from './externalCliRunSession.ts'
import { snapshotExternalCliConnectorRequirements } from './externalCliConnectorSnapshot.ts'
import { orchestrationFromAgent } from './runLifecycle.ts'
import { resolveTurnTimeout } from './turnTimeout.ts'
import { clampContinueFreshnessMs, isSnapshotFresh } from './autoContinueFreshness.ts'
import { applyComposerApprovalHandoff } from './composerApprovalHandoff.ts'
import { followUpActionForRunner, submitHostInteractiveFollowUp } from './interactiveFollowUp.ts'
import {
  decideBusyPolicy,
  decideExternalQueueSnapshotAdmission,
  decideInitialTaskRunAdmission,
  initialTaskRunAdmissionResult,
} from './taskRunAdmission.ts'
import {
  nonCanonicalReviewAdmission,
  type ReviewAdmissionSnapshot,
  type ReviewFileManifestEntry,
  type ReviewRunnerKind,
  type ReviewSnapshotRef,
} from './reviewContract.ts'

import { v4 as uuid } from 'uuid'
import {
  getJournalEntry,
  markRunAppFinalized,
  recordRunAdmitted,
  recordRunStarted,
  recordRunTerminal,
  waitForStartupRecovery,
} from './runJournal.ts'

export type { ExternalRunOpts, ExternalRunResult, RunSourceKind }
export type TaskRunInput = ExternalRunOpts
export type TaskRunResult = ExternalRunResult

/**
 * A renderer must be mounted AND on screen for an in-thread outcome to count
 * as seen. A backgrounded window still writes the bubble, but the user has not
 * been told, so the journal keeps that outcome pending until something narrates
 * it (the live completion notice, or the startup redelivery pass).
 */
function rendererPresent(): boolean {
  if (typeof document === 'undefined') return false
  return document.visibilityState === 'visible'
}

export async function admitExternalInstructions(input: {
  runner: string
  projectRoot?: string
  overrides: RuntimeOverrides
  notice: (text: string) => void
}): Promise<void> {
  if (executionKindForRunner(input.runner) !== 'external') return
  const delivery = instructionDeliveryForRunner(input.runner)
  try {
    const bridge = window.subagents?.piHost?.instructions
    if (typeof bridge?.resolve !== 'function') {
      input.notice('指令送達：unverified · Host instruction projection unavailable')
      return
    }
    const projection = (await bridge.resolve({ projectRoot: input.projectRoot, workPath: input.projectRoot })).instructionSnapshot
    input.overrides.instructionSnapshot = {
      ...projection,
      deliveryMode: delivery.mode,
      exactSnapshot: delivery.exactSnapshot,
    }
    const explicitText = delivery.mode === 'native'
      ? projection.globalEffectiveText
      : projection.effectiveText
    if (explicitText.trim()) {
      input.overrides.extraSystemContext = [
        input.overrides.extraSystemContext,
        `## Host instruction delivery (${delivery.mode}; exact=${delivery.exactSnapshot}; hash=${projection.effectiveHash})\n${explicitText}`,
      ].filter(Boolean).join('\n\n')
    }
    input.notice(`指令送達：${delivery.mode} · ${delivery.detail} · snapshot ${projection.id}`)
  } catch (error) {
    input.notice(`指令送達：unverified · ${error instanceof Error ? error.message : String(error)}`)
  }
}

/** Freeze external delivery before parking a run so restart cannot reread newer settings. */
async function freezeExternalInstructionsForQueue(opts: ExternalRunOpts): Promise<ExternalRunOpts> {
  if (!opts.runner || opts.runner === 'builtin' || opts.overrides?.instructionSnapshot) return opts
  const overrides = { ...(opts.overrides || {}) }
  await admitExternalInstructions({
    runner: opts.runner,
    projectRoot: opts.projectRoot || overrides.projectRoot,
    overrides,
    notice: () => {},
  })
  return { ...opts, overrides }
}

async function admitTaskInstructions(input: {
  runner: string
  projectRoot?: string
  overrides: RuntimeOverrides
  notice: (text: string) => void
}): Promise<void> {
  if (input.overrides.instructionSnapshot) {
    const delivery = instructionDeliveryForRunner(input.runner)
    input.notice(`指令送達：${delivery.mode} · frozen snapshot ${input.overrides.instructionSnapshot.id}`)
    return
  }
  await admitExternalInstructions(input)
}

/** Complete the one-time renderer legacy handoff before any provider admission. */
export async function admitLegacyInstructionMigration<T>(input: {
  currentRevision: number
  readiness: { status: 'pending' | 'ready' | 'failed'; error?: string }
  retry: () => Promise<{ status: 'pending' | 'ready' | 'failed'; error?: string }>
  getMigrationInput: () => T
  migrate: (migrationInput: T) => Promise<unknown>
}): Promise<'migrated' | 'skipped'> {
  let readiness = input.readiness
  if (readiness.status === 'failed') readiness = await input.retry()
  if (readiness.status !== 'ready') {
    throw new Error(`Legacy Hermes 尚未可讀，migration 保留 pending：${readiness.error || 'read not ready'}`)
  }
  if (input.currentRevision !== 0) return 'skipped'
  await input.migrate(input.getMigrationInput())
  return 'migrated'
}

async function ensureHostInstructionMigration(settings: LlmSettings): Promise<void> {
  const bridge = window.subagents?.piHost?.instructions
  if (typeof bridge?.get !== 'function' || typeof bridge.migrateLegacy !== 'function') return
  const { useLearningStore } = await import('../store/learningStore.ts')
  if (!useLearningStore.getState().loaded) await useLearningStore.getState().load()
  const {
    getLegacyInstructionDocs,
    getLegacyInstructionHydration,
  } = await import('./hermes/promptBuilder.ts')
  const current = (await bridge.get()).instructions
  const { getLegacyPersonalizationPresence } = await import('../store/settingsStore.ts')
  await admitLegacyInstructionMigration({
    currentRevision: current.revision,
    readiness: getLegacyInstructionHydration(),
    retry: async () => {
      // A transient Hermes read must be retried through the owning store. Never
      // turn a failed read into migrateLegacy({}), which would durably record a
      // false "no legacy data" marker.
      await useLearningStore.getState().reloadLegacyInstructionSource()
      return getLegacyInstructionHydration()
    },
    getMigrationInput: () => {
      const presence = getLegacyPersonalizationPresence()
      const legacyDocs = getLegacyInstructionDocs()
      return {
        ...(presence.personality ? { personality: settings.personality } : {}),
        ...(presence.aboutUser ? { aboutUser: settings.customAboutUser } : {}),
        ...(presence.responseStyle ? { responseStyle: settings.customResponseStyle } : {}),
        ...(legacyDocs.soul !== undefined ? { soul: legacyDocs.soul } : {}),
        ...(legacyDocs.agents !== undefined ? { agents: legacyDocs.agents } : {}),
      }
    },
    migrate: (migrationInput) => bridge.migrateLegacy(migrationInput),
  })
}

/** Prevent re-entrant callers from starting the same lifecycle twice. */
const coordinatingRunIds = new Set<string>()
const recoveredFinalizationClaims = new Set<string>()
// A renderer can disappear immediately after winning the Host CAS. Keep the
// lease long enough for heartbeat renewal, but short enough that recovery can
// take over within one interactive retry window.
const PI_FINALIZATION_LEASE_MS = 15_000
const PI_FINALIZATION_RENEW_INTERVAL_MS = Math.floor(PI_FINALIZATION_LEASE_MS / 3)
const rendererFinalizationClaimant = `renderer_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`
/** RecoveryBootstrap uses this to decide whether it is safe to send Host ack. */
const piFinalizationAckable = new Set<string>()

export function isPiFinalizationAckable(runId: string): boolean {
  return piFinalizationAckable.has(runId)
}

/**
 * Normalize only the canonical ingress field; preserve the caller object and
 * every lifecycle option so queue/retry/automation semantics stay intact.
 */
export function normalizeTaskRunInput(input: TaskRunInput): TaskRunInput {
  const objective = input.objective.trim()
  return objective === input.objective ? input : { ...input, objective }
}

export type AttachmentPrepPhase = 'persist' | 'hydrate' | 'full'

export type PrepareAttachmentsOpts = {
  projectRoot?: string
  sessionId?: string
  /**
   * - `persist` (default): normalize + materialize once for queue-safe filePath
   * - `hydrate`: restore dataUrls only (after admit; never re-materialize)
   * - `full`: all three steps once (tests / one-shot callers)
   */
  phase?: AttachmentPrepPhase
}

/**
 * Single attachment pipeline owned by the coordinator.
 * Each phase runs at most once per run; runDispatch must not call this.
 */
export async function prepareRunAttachments(
  attachments: ChatAttachment[] | undefined,
  opts: PrepareAttachmentsOpts = {},
): Promise<ChatAttachment[] | undefined> {
  if (!attachments?.length) return attachments
  const phase = opts.phase || 'persist'
  try {
    const {
      materializeAttachmentsOnDisk,
      normalizeImageAttachmentsForVision,
      hydrateAttachmentsFromDisk,
    } = await import('../lib/chatAttachments.ts')
    let next = attachments
    if (phase === 'persist' || phase === 'full') {
      next = await normalizeImageAttachmentsForVision(next)
      next = await materializeAttachmentsOnDisk(next, {
        projectRoot: opts.projectRoot,
        sessionId: opts.sessionId,
      })
    }
    if (phase === 'hydrate' || phase === 'full') {
      next = await hydrateAttachmentsFromDisk(next)
    }
    return next
  } catch {
    return attachments
  }
}

export type CapacityCheck = {
  allowed: boolean
  active: number
  limit: number
  reason?: string
}

/** Read current capacity without reserving. Idempotent for an already-reserved runId. */
export async function checkRunCapacity(
  runId: string,
  threadId?: string,
): Promise<CapacityCheck> {
  const { useAgentStore } = await import('../store/agentStore.ts')
  return useAgentStore.getState().canStartRun(runId, threadId)
}

/**
 * Reserve one capacity slot for this runId. Same runId is re-entrant (true).
 * Returns false when the concurrent cap blocks a new reservation.
 */
export async function reserveRunCapacity(
  runId: string,
  threadId: string | undefined,
  kind: 'builtin' | 'cli',
): Promise<boolean> {
  const { useAgentStore } = await import('../store/agentStore.ts')
  return useAgentStore.getState().reserveRun(runId, threadId, kind)
}

/** Release a previously reserved slot (hook deny / early failure before dispatch). */
export async function releaseRunCapacity(runId: string): Promise<void> {
  const { useAgentStore } = await import('../store/agentStore.ts')
  useAgentStore.getState().releaseRun(runId)
}

export type BindRunThreadOpts = {
  runId: string
  objective: string
  title?: string
  reuseThreadId?: string
  runner?: ThreadRunner
  /** Force-create with this loop pin; null leaves auto until user pins. */
  loopType?: LoopType | null
  thinkingDepth?: 'standard' | 'deep' | 'max'
  /**
   * Phase 3 item 7: create a hidden worker thread (background delegate).
   * Does not steal active selection or open the run panel.
   */
  hidden?: boolean
  /** Project this run is pinned to; stamped on the thread for sidebar grouping. */
  projectRoot?: string
}

export type BoundRunThread = {
  threadId: string
  /** True when an existing thread was reused. */
  reused: boolean
}

/**
 * Bind a reserved run to a conversation thread: create or reuse, select,
 * clear plan, show panel, bindRun, set running flags.
 * Call once after capacity is reserved; never from runDispatch.
 */
export async function bindRunThread(opts: BindRunThreadOpts): Promise<BoundRunThread> {
  const [{ useThreadStore }, { useAgentStore }] = await Promise.all([
    import('../store/threadStore.ts'),
    import('../store/agentStore.ts'),
  ])
  const thr = useThreadStore.getState()
  if (!thr.activeId && thr.threads.length === 0) thr.hydrate()

  let tid = opts.reuseThreadId || ''
  const existing = tid ? thr.threads.find((t) => t.id === tid) : null
  let reused = Boolean(existing)

  if (!existing) {
    tid = thr.createThread({
      title: (opts.title || opts.objective).slice(0, 48),
      loopType: opts.loopType ?? null,
      thinkingDepth: opts.thinkingDepth || 'standard',
      runner: opts.runner || 'builtin',
      hidden: opts.hidden === true ? true : undefined,
      projectRoot: opts.projectRoot,
    })
    reused = false
  }
  // A reused thread may predate the binding, or the user may have switched
  // projects between runs; the latest run owns the grouping.
  if (opts.projectRoot) thr.setThreadProject(tid, opts.projectRoot)

  const isHidden =
    opts.hidden === true ||
    Boolean(useThreadStore.getState().threads.find((t) => t.id === tid)?.hidden)

  // Worker threads must not steal the user's active conversation focus.
  if (!isHidden) {
    thr.selectThread(tid)
    thr.setShowRunPanel(true)
  }
  if (opts.runner) thr.setRunner(tid, opts.runner)
  thr.clearRunPlan(tid)
  useAgentStore.getState().bindRun(opts.runId, tid)
  thr.setThreadRunning(tid, true, opts.runId)
  thr.setAwaitingReply(tid, false)
  thr.setThreadStatus(tid, 'running')

  return { threadId: tid, reused }
}

export type BeforeRunHookOpts = {
  settings: LlmSettings
  sourceKind?: RunSourceKind
  objective: string
  threadId: string
  runId: string
  /** G7:hydrate 專案級 hooks(.subagents/hooks.json,需 folder trust) */
  projectRoot?: string
}

export type BeforeRunHookResult =
  | { ok: true; appendTexts: string[]; audits: string[]; notifications: string[] }
  | {
      ok: false
      denyReason: string
      audits: string[]
      notifications: string[]
      /** afterRun audits already applied for deny path */
      afterAudits: string[]
      afterNotifications: string[]
    }

/**
 * Evaluate beforeRun hooks once under coordinator ownership.
 * On deny, caller still owns release/onSettled/drain (finalization later).
 */
export async function evaluateBeforeRunHooks(
  opts: BeforeRunHookOpts,
): Promise<BeforeRunHookResult> {
  try {
    const [{ collectHookRules, evaluateHooks }, { useThreadStore }] = await Promise.all([
      import('./hooks.ts'),
      import('../store/threadStore.ts'),
    ])
    // G7:先 hydrate 專案級 hooks(未信任專案靜默跳過),collect 才收得到
    try {
      const { hydrateProjectHooks } = await import('./projectHooks.ts')
      const hydrated = await hydrateProjectHooks(opts.settings, opts.projectRoot)
      if (hydrated.loaded > 0) {
        useThreadStore
          .getState()
          .pushBubble(opts.threadId, 'system', `專案 hooks 已載入 ${hydrated.loaded} 條（.subagents/hooks.json）`)
      }
    } catch {
      /* project hooks must never break runs */
    }
    const rules = collectHookRules(opts.settings)
    const thr = useThreadStore.getState()
    const ev: HookEvaluation = evaluateHooks(rules, {
      point: 'beforeRun',
      sourceKind: opts.sourceKind,
      objective: opts.objective,
    })
    for (const line of ev.audits) thr.pushBubble(opts.threadId, 'system', line)
    for (const n of ev.notifications) {
      void window.subagents?.notify?.('AgentStudio · Hook', n.slice(0, 160))
    }
    if (ev.deny) {
      // afterRun is owned by finalizeTaskRun — do not evaluate it here.
      return {
        ok: false,
        denyReason: ev.deny.reason,
        audits: ev.audits,
        notifications: ev.notifications,
        afterAudits: [],
        afterNotifications: [],
      }
    }
    return {
      ok: true,
      appendTexts: ev.appendTexts,
      audits: ev.audits,
      notifications: ev.notifications,
    }
  } catch {
    /* hook infra must never break runs */
    return { ok: true, appendTexts: [], audits: [], notifications: [] }
  }
}

// ── Phase 3 item 3: dispatch snapshot ─────────────────────────────

async function admitRunReviewWorkspace(input: {
  runId: string
  threadId: string
  projectRoot?: string
  runnerKind: ReviewRunnerKind
}): Promise<ReviewAdmissionSnapshot> {
  const projectRoot = input.projectRoot?.trim()
  if (!projectRoot) {
    return nonCanonicalReviewAdmission(input.runId, input.runnerKind, 'Run Review project root is unavailable')
  }
  const admit = typeof window === 'undefined'
    ? undefined
    : window.subagents?.piHost?.review?.admit
  if (!admit) {
    return nonCanonicalReviewAdmission(input.runId, input.runnerKind, 'Pi Host Run Review bridge is unavailable')
  }
  try {
    return (await admit({ ...input, projectRoot })).reviewAdmission
  } catch (error) {
    return nonCanonicalReviewAdmission(
      input.runId,
      input.runnerKind,
      error instanceof Error ? error.message : 'Pi Host Run Review admission failed',
    )
  }
}

function reviewRunnerKind(runner: string): ReviewRunnerKind {
  return executionKindForRunner(runner) === 'external' ? 'external' : 'builtin'
}

function reviewSettlementKindForFinalization(
  agent: import('./types.ts').AgentState,
  result: DispatchResult,
): 'completed' | 'failed' | 'cancelled' | 'timeout' | 'crash' {
  if (agent.interruptReason === 'timeout') return 'timeout'
  if (agent.interruptReason) return 'cancelled'
  if (result.status === 'failed' || result.error) return 'failed'
  return 'completed'
}

async function finalizeRunReviewSnapshot(
  admission: ReviewAdmissionSnapshot | undefined,
  runId: string,
  settlementKind: 'completed' | 'failed' | 'cancelled' | 'timeout' | 'crash',
): Promise<ReviewSnapshotRef | undefined> {
  try {
    const finalize = typeof window === 'undefined' ? undefined : window.subagents?.piHost?.review?.finalize
    if (!finalize) throw new Error('Pi Host Run Review finalization bridge is unavailable')
    const { useAgentStore } = await import('../store/agentStore.ts')
    const activeWorkspaceRuns = Math.max(1, useAgentStore.getState().activeRunIds.length)
    return (await finalize({ ...(admission?.canonical && admission.snapshotId ? { snapshotId: admission.snapshotId } : { runId }), settlementKind, activeWorkspaceRuns })).reviewSnapshotRef
  } catch {
    // Review failure is visible but never rewrites task success/failure.
    return admission?.canonical && admission.snapshotId
      ? { snapshotId: admission.snapshotId, runId: admission.runId, status: 'failed', attributionFidelity: 'partial' }
      : undefined
  }
}

async function disposeRestrictedProjectView(
  runId: string,
  writeback: boolean,
): Promise<{ filesWritten: number; withheldRanges: number } | undefined> {
  try {
    const disp = await window.subagents?.outbound?.disposeRunView?.(runId, { writeback })
    if (!writeback || !disp || typeof disp !== 'object' || !('writeback' in disp) || !disp.writeback) return undefined
    return {
      filesWritten: disp.writeback.filesWritten,
      withheldRanges: disp.writeback.withheldRanges,
    }
  } catch {
    return undefined
  } finally {
    try {
      const { unpinRestrictedViewRootForRun } = await import('./outbound/sanitizedWorkspace.ts')
      unpinRestrictedViewRootForRun(runId)
    } catch {
      /* non-fatal */
    }
  }
}

/**
 * Frozen fields for one adapter dispatch. Built once after admit; runDispatch
 * must not re-read capacity, materialize attachments, or invent a new runId.
 */
export type RunDispatchSnapshot = {
  runId: string
  threadId: string
  /** Goal text for the adapter (continueGoal may differ from the user phrase). */
  objective: string
  runner: ThreadRunner
  forceLoopType?: LoopType
  /** Coordinator-prepared attachments (persist + hydrate already done). */
  attachments: ChatAttachment[]
  /** Deep-cloned at admission; adapters must never re-read mutable Settings. */
  settings: LlmSettings
  /** Host-frozen workspace identity and baseline captured once at admission. */
  reviewAdmission: ReviewAdmissionSnapshot
  /** Full runtime overrides; always carries coordinator-owned run/thread identity. */
  overrides: RuntimeOverrides
}

/** Build the immutable dispatch snapshot after capacity/thread/beforeRun admit. */
export function buildRunDispatchSnapshot(parts: {
  runId: string
  threadId: string
  objective: string
  runner?: ThreadRunner
  forceLoopType?: LoopType
  attachments?: ChatAttachment[]
  settings: LlmSettings
  reviewAdmission: ReviewAdmissionSnapshot
  overrides: RuntimeOverrides
}): RunDispatchSnapshot {
  const attachments =
    parts.attachments || parts.overrides.userAttachments || ([] as ChatAttachment[])
  const forceLoopType =
    parts.forceLoopType ||
    (parts.overrides.loopTypeMode === 'force'
      ? parts.overrides.forceLoopType
      : undefined)
  return {
    runId: parts.runId,
    threadId: parts.threadId,
    objective: parts.objective.trim(),
    runner: parts.runner || 'builtin',
    forceLoopType,
    attachments: attachments.slice(),
    settings: snapshotRunSettings(parts.settings),
    reviewAdmission: parts.reviewAdmission,
    overrides: {
      ...parts.overrides,
      runId: parts.runId,
      threadId: parts.threadId,
      userAttachments: attachments.length
        ? attachments
        : parts.overrides.userAttachments,
      forceLoopType: forceLoopType || parts.overrides.forceLoopType,
      loopTypeMode: forceLoopType
        ? 'force'
        : parts.overrides.loopTypeMode || 'auto',
      // Capture the complete Host supervision policy at admission so a run
      // never re-reads mutable settings while the external process is live.
      externalCliPolicy: normalizeExternalCliRunPolicy({
        ...parts.overrides.externalCliPolicy,
        // Preserve the existing bounded unattended HITL policy when callers
        // have not supplied an external-session-specific value.
        unattendedWaitMs:
          parts.overrides.externalCliPolicy?.unattendedWaitMs ?? parts.overrides.hitlTimeoutMs,
      }),
      externalCliRequiredConnectors: snapshotExternalCliConnectorRequirements(
        parts.settings,
        parts.overrides,
      ),
    },
  }
}

  // ── Phase 3 item 4/5: unique finalization + single drain ──────────

export type FinalizeTaskRunInput = {
  runId: string
  threadId: string
  objective: string
  sourceKind?: RunSourceKind
  projectRoot?: string
  settings: LlmSettings
  /** Reuses admission evidence; settlement must never recalculate Git identity. */
  reviewAdmission?: ReviewAdmissionSnapshot
  /** Present after a successful dispatchThreadTask return (including failed status). */
  dispatchResult?: DispatchResult
  onSettled?: (result: ExternalRunResult) => void | Promise<void>
  /**
   * Early terminal without adapter execution (hook deny / exception).
   * Skips thread process summary derived from agent state.
   */
  early?: { error: string; path?: 'builtin' | 'cli'; agent?: AgentState }
}

async function recordPermanentUsage(
  input: Pick<FinalizeTaskRunInput, 'runId' | 'sourceKind' | 'projectRoot' | 'settings'>,
  agent: AgentState,
  status?: 'success' | 'failed' | 'halted' | 'warning',
): Promise<void> {
  try {
    const [{ usageEntryFromAgent }, { upsertUsageEntry }] = await Promise.all([
      import('./usageLedger.ts'),
      import('./usageLedgerClient.ts'),
    ])
    const usageModel = agent.steps.at(-1)?.modelUsed
    const entry = usageEntryFromAgent({
      agent,
      runId: input.runId,
      sourceKind: input.sourceKind,
      projectRoot: input.projectRoot,
      status,
      pricing: usageModel ? input.settings.modelProfiles?.[usageModel]?.pricing : undefined,
    })
    if (entry) await upsertUsageEntry(entry)
  } catch {
    /* analytics persistence must never block settlement */
  }
}

async function persistTerminalRunRecords(input: FinalizeTaskRunInput, agent: AgentState, status: string): Promise<void> {
  if (status !== 'success' && status !== 'failed' && status !== 'halted') return
  try {
    const { useAgentStore } = await import('../store/agentStore.ts')
    await useAgentStore.getState().saveToArchive(agent, input.runId)
  } catch {
    /* archive must not block release/drain */
  }
  await recordPermanentUsage(input, agent, status)
}

function terminalJournalSettlement(input: FinalizeTaskRunInput, agent: AgentState) {
  return {
    ...orchestrationFromAgent(agent),
    executionSettlement: agent.executionSettlement,
    goalVerdict: agent.goalVerdict,
    goalContractDigest: agent.goalContractDigest,
    acceptanceDigest: agent.acceptanceDigest,
    appFinalization: input.dispatchResult?.executionKind === 'loop' ? 'pending' as const : 'not-applicable' as const,
    stopReason: agent.stopReason || input.dispatchResult?.stopReason || input.dispatchResult?.error || agent.haltReason || agent.interruptReason,
    interruptReason: agent.interruptReason,
  }
}

/**
 * Per-run finalization claim. The first entry owns the whole terminal
 * sequence; every later entry — the outer catch in `coordinateTaskRun` above
 * all — reads the outcome the claim already produced.
 *
 * Holds the outcome promise rather than a boolean so a re-entry that lands
 * while the sequence is still running waits for the same answer instead of
 * starting a second one. `done` marks a finished claim; only finished claims
 * are ever forgotten, so trimming can never free an in-flight run to restart.
 */
type FinalizationClaim = { outcome: Promise<ExternalRunResult>; done: boolean }

type PiHostFinalizationClaim = { claimantId: string; claimEpoch: number; leaseExpiresAt?: number }

type PiHostFinalizationHeartbeat = {
  stop: () => Promise<void>
  lostOwnership: () => boolean
}

function isPiHostFinalization(input: FinalizeTaskRunInput): boolean {
  // A loop dispatch is the only renderer path whose terminal settlement is
  // owned by the Pi Host attachment journal. Hook/guard early exits have no
  // Host terminal attachment and must retain the ordinary coordinator path.
  return input.dispatchResult?.executionKind === 'loop'
}

function syntheticPiFinalizationResult(input: FinalizeTaskRunInput, error?: string): ExternalRunResult {
  return {
    path: 'builtin',
    executionKind: 'loop',
    status: input.dispatchResult?.status || 'failed',
    ...(input.dispatchResult?.result ? { result: input.dispatchResult.result } : {}),
    ...(error ? { error } : input.dispatchResult?.error ? { error: input.dispatchResult.error } : {}),
    threadId: input.threadId,
    runId: input.runId,
  }
}

async function claimPiHostFinalization(input: FinalizeTaskRunInput): Promise<PiHostFinalizationClaim | null | 'unavailable'> {
  try {
    const claim = window.subagents?.piHost?.runs?.finalizeClaim
    if (!claim) return null
    const result = await claim(input.runId, rendererFinalizationClaimant, PI_FINALIZATION_LEASE_MS)
    if (result.claimed && result.owner && result.claimEpoch > 0) {
      return {
        claimantId: rendererFinalizationClaimant,
        claimEpoch: result.claimEpoch,
        leaseExpiresAt: result.leaseExpiresAt,
      }
    }
    if (result.state === 'completed' || result.reason === 'completed') {
      piFinalizationAckable.add(input.runId)
    }
    return 'unavailable'
  } catch {
    // A terminal attachment remains Host-owned until claim+complete succeeds.
    // Leave it pending for the next bootstrap rather than running app effects
    // without a durable CAS owner.
    return 'unavailable'
  }
}

/** Keep a long renderer-owned closeout inside its Host CAS lease. */
function startPiHostFinalizationHeartbeat(
  runId: string,
  claim: PiHostFinalizationClaim,
): PiHostFinalizationHeartbeat | undefined {
  const renew = window.subagents?.piHost?.runs?.finalizeClaim
  if (!renew) return undefined
  let stopped = false
  let lost = false
  let inFlight: Promise<void> | undefined
  const tick = () => {
    if (stopped || lost || inFlight) return
    inFlight = renew(runId, claim.claimantId, PI_FINALIZATION_LEASE_MS)
      .then((result) => {
        if (!result.claimed || !result.owner || result.claimEpoch !== claim.claimEpoch) lost = true
      })
      .catch(() => {
        // A transient IPC failure does not prove ownership was lost. The next
        // tick retries; finalizeComplete remains the final fencing check.
      })
      .finally(() => { inFlight = undefined })
  }
  const timer = setInterval(tick, PI_FINALIZATION_RENEW_INTERVAL_MS)
  return {
    stop: async () => {
      stopped = true
      clearInterval(timer)
      await inFlight
    },
    lostOwnership: () => lost,
  }
}
const finalizationClaims = new Map<string, FinalizationClaim>()
/**
 * How many finished runs stay remembered. Only settled claims are forgotten,
 * and forgetting one only means a much later call with that same runId would
 * be treated as a fresh finalization — which cannot happen, because runIds are
 * unique per run and re-entry is always same-tick with the first call.
 */
const MAX_FINALIZATION_CLAIMS = 256

type SettleFinalization = (result: ExternalRunResult) => Promise<void>

async function completePiHostFinalization(
  runId: string,
  claim: PiHostFinalizationClaim | undefined,
  heartbeat: PiHostFinalizationHeartbeat | undefined,
  result: ExternalRunResult,
): Promise<void> {
  if (!claim || heartbeat?.lostOwnership()) return
  try {
    const complete = await window.subagents?.piHost?.runs?.finalizeComplete?.(
      runId,
      claim.claimantId,
      claim.claimEpoch,
      {
        status: result.status,
        executionKind: result.executionKind,
        ...(result.orchestration?.dodMet === undefined
          ? {}
          : { dodMet: result.orchestration.dodMet }),
      },
    )
    if (!complete?.completed) return
    markRunAppFinalized(runId)
    piFinalizationAckable.add(runId)
    await window.subagents?.piHost?.runs?.ack?.(runId)
  } catch {
    // Keep the terminal attachment pending; a later renderer retries.
  }
}

async function recoverFinalizationFailure(
  input: FinalizeTaskRunInput,
  settle: SettleFinalization,
  error: unknown,
): Promise<ExternalRunResult> {
  const message = error instanceof Error ? error.message : String(error)
  const reason = `finalization 失敗：${message}`
  const path = input.dispatchResult?.path || input.early?.path || 'builtin'
  try {
    if (!hasJournalledEnding(input.runId)) {
      return await runFinalizationSequence({
        ...input,
        dispatchResult: undefined,
        early: { error: reason, path, agent: input.early?.agent },
      }, settle)
    }
  } catch {
    /* the closeout is the last resort; it must not replace the reason */
  }
  const failed: ExternalRunResult = {
    path,
    status: 'failed',
    error: reason,
    threadId: input.threadId,
    runId: input.runId,
  }
  try {
    const { useThreadStore } = await import('../store/threadStore.ts')
    useThreadStore.getState().setThreadRunning(input.threadId, false, input.runId)
  } catch {
    /* the thread may already be gone; release still has to happen */
  }
  await settle(failed)
  return failed
}

async function cleanupFinalization(input: FinalizeTaskRunInput): Promise<void> {
  // 5) release capacity
  await releaseRunCapacity(input.runId)
  // 6) queue drain
  try {
    const { drainExternalRunQueue } = await import('./runQueue.ts')
    void drainExternalRunQueue((queued) => runTask({
      ...queued,
      _fromQueue: true,
      sourceKind: queued.sourceKind || 'queue-drain',
    }))
  } catch {
    /* a drain that cannot start is retried by the next finalization */
  }
  const mine = finalizationClaims.get(input.runId)
  if (mine) mine.done = true
  forgetSettledFinalizationClaims()
}

async function executeClaimedFinalization(
  input: FinalizeTaskRunInput,
  settle: SettleFinalization,
): Promise<ExternalRunResult> {
  let claim: PiHostFinalizationClaim | undefined
  let heartbeat: PiHostFinalizationHeartbeat | undefined
  try {
    if (isPiHostFinalization(input)) {
      const claimed = await claimPiHostFinalization(input)
      if (claimed === 'unavailable') {
        return syntheticPiFinalizationResult(input, 'Pi Host app-finalization claim unavailable; terminal attachment remains pending')
      }
      claim = claimed || undefined
      if (claim) heartbeat = startPiHostFinalizationHeartbeat(input.runId, claim)
    }
    const result = await runFinalizationSequence(input, settle)
    await completePiHostFinalization(input.runId, claim, heartbeat, result)
    return result
  } catch (error) {
    return recoverFinalizationFailure(input, settle, error)
  } finally {
    await heartbeat?.stop()
    await cleanupFinalization(input)
  }
}

/**
 * Single finalization sequence for every terminal outcome:
 *   thread summary/bubble → afterRun → Archive → onSettled → release capacity → drain
 *
 * Learning still fires inside adapters (engine/CLI) before they return; moving
 * that is deferred so outcome semantics stay stable.
 *
 * Only this function (and early/deny paths that call it) may drain the queue.
 *
 * Exactly-once is a property of this seam, not of caller discipline: the run
 * claims finalization here, so a second entry can only return the first
 * outcome. Capacity release and the queue drain sit in the claim holder's
 * `finally`, which makes them obligations of *holding* the claim rather than
 * steps of a sequence that an exception could skip.
 */
export async function finalizeTaskRun(
  input: FinalizeTaskRunInput,
): Promise<ExternalRunResult> {
  const claimed = finalizationClaims.get(input.runId)
  if (claimed) return claimed.outcome

  // onSettled is what closes scheduler / webhook / gateway bookkeeping, so it
  // is owned here rather than inside the sequence: exactly once per run,
  // including when the sequence dies before reaching its own settle step.
  let settled = false
  const settleOnce = async (result: ExternalRunResult) => {
    if (settled) return
    settled = true
    // G11:每 run 一筆指標(finalization 唯一出口保證恰好一次)
    try {
      const { finalizeRunMetric } = await import('./metrics.ts')
      finalizeRunMetric(input.runId, {
        sourceKind: input.sourceKind,
        path: result.path,
        status: result.status,
        ok: !result.error && !result.skipped,
        facts: {
          executionSettlement: result.executionSettlement,
          goalVerdict: result.goalVerdict,
          iterations: result.orchestration?.iterations,
        },
      })
    } catch {
      /* metrics must never block finalization */
    }
    try {
      await window.subagents?.tools?.toolOutputSpillDispose?.({
        runId: input.runId,
        projectRoot: input.projectRoot,
      })
    } catch {
      /* spill cleanup is bounded best effort and never changes the run result */
    }
    try {
      await input.onSettled?.(result)
    } catch {
      /* caller errors non-fatal */
    }
  }

  const outcome = executeClaimedFinalization(input, settleOnce)

  finalizationClaims.set(input.runId, { outcome, done: false })
  return outcome
}

/** Does the durable journal already record how this run ended? */
function hasJournalledEnding(runId: string): boolean {
  const entry = getJournalEntry('run', runId)
  return Boolean(entry && ['success', 'failed', 'cancelled', 'interrupted'].includes(entry.status))
}

/** Trim the claim ledger, never touching a finalization still in flight. */
function forgetSettledFinalizationClaims(): void {
  if (finalizationClaims.size <= MAX_FINALIZATION_CLAIMS) return
  for (const [runId, claim] of finalizationClaims) {
    if (finalizationClaims.size <= MAX_FINALIZATION_CLAIMS) return
    if (claim.done) finalizationClaims.delete(runId)
  }
}

async function runFinalizationSequence(
  input: FinalizeTaskRunInput,
  settle: (result: ExternalRunResult) => Promise<void>,
): Promise<ExternalRunResult> {
  const [{ useAgentStore }, { useThreadStore }] = await Promise.all([
    import('../store/agentStore.ts'),
    import('../store/threadStore.ts'),
  ])

  const thr = useThreadStore.getState()
  const { runId, threadId: tid, objective, settings } = input

  try {
    const { useRunActivityStore } = await import('../store/runActivityStore.ts')
    useRunActivityStore.getState().setStatus('正在整理執行摘要…', runId)
  } catch {
    /* renderer activity is optional for headless / recovery paths */
  }

  // G8:plan mode 是 run-scoped 狀態,finalization 唯一出口負責釋放
  try {
    const { clearPlanMode } = await import('./planMode.ts')
    clearPlanMode(runId)
  } catch {
    /* non-fatal */
  }

  // ── Early terminal (hook deny / exception before or during dispatch) ──
  if (input.early) {
    thr.setThreadStatus(tid, 'failed')
    thr.setThreadRunning(tid, false, runId)
    thr.pushBubble(tid, 'system', input.early.error)
    // Marked terminal only after the reason is in the thread, so the delivery
    // fact recorded alongside it is the truth and not an intention.
    recordRunTerminal({
      runId,
      threadId: tid,
      status: 'failed',
      delivery: {
        hasOwningThread: useThreadStore.getState().threads.some((thread) => thread.id === tid),
        resultWrittenToThread: true,
        rendererPresent: rendererPresent(),
      },
    })
    try {
      const { collectHookRules, evaluateHooks } = await import('./hooks.ts')
      const ev = evaluateHooks(collectHookRules(settings), {
        point: 'afterRun',
        sourceKind: input.sourceKind,
        objective,
      })
      for (const line of ev.audits) thr.pushBubble(tid, 'system', line)
      for (const n of ev.notifications) {
        void window.subagents?.notify?.('AgentStudio · Hook', n.slice(0, 160))
      }
    } catch {
      /* non-fatal */
    }
    const agent = useAgentStore.getState()
    const currentAgent = input.early.agent || agent.getRunState(runId)
    const failureAgent = currentAgent
      ? {
          ...currentAgent,
          id: currentAgent.id || runId,
          objective: currentAgent.objective || objective,
          status: 'failed' as const,
          progress: 100,
          result: input.early.error,
          haltReason: input.early.error,
          finishedAt: new Date().toISOString(),
          steps:
            currentAgent.steps.length > 0
              ? currentAgent.steps
              : [
                  {
                    step: 1,
                    action: 'task-run',
                    description: 'Task run lifecycle',
                    status: 'FAILED' as const,
                    result: input.early.error,
                  },
                ],
        }
      : undefined
    const failResult: ExternalRunResult = {
      path: input.early.path || 'builtin',
      status: 'failed',
      error: input.early.error,
      threadId: tid,
      runId,
    }
    await disposeRestrictedProjectView(runId, false)
    const reviewSnapshotRef = await finalizeRunReviewSnapshot(input.reviewAdmission, runId, 'failed')
    await pushEarlyFailureSummary({
      thr,
      tid,
      runId,
      objective,
      finalAgent: failureAgent,
      result: failResult,
      projectRoot: input.projectRoot,
      settings,
      reviewAdmission: input.reviewAdmission,
      reviewSnapshotRef,
    })
    await persistArtifactIndexForRun({
      threadId: tid,
      runId,
      objective,
      status: 'failed',
      result: input.early.error,
      blockers: [input.early.error],
      evidenceOperations: [],
      plan: [],
    })
    try {
      const agent = useAgentStore.getState()
      await agent.saveToArchive(failureAgent, runId)
    } catch {
      /* archive is optional on early fail */
    }
    if (failureAgent) await recordPermanentUsage(input, failureAgent, 'failed')
    try {
      const { useRunActivityStore } = await import('../store/runActivityStore.ts')
      useRunActivityStore.getState().end(runId, '失敗')
    } catch {
      /* renderer activity is optional for headless / recovery paths */
    }
    await settle(failResult)
    return failResult
  }

  const result = input.dispatchResult || {
    path: 'builtin' as const,
    status: 'failed',
    error: 'missing dispatch result',
  }
  const storedAgent =
    useAgentStore.getState().getRunState(runId) || useAgentStore.getState().agent
  const returnedStatus = result.status || storedAgent.status
  const runnerReturnedTerminal = ['success', 'failed', 'halted'].includes(
    String(returnedStatus),
  )
  const storedTerminal = ['success', 'failed', 'halted'].includes(
    String(storedAgent.status),
  )
  const nonTerminalReason = `runner returned non-terminal status: ${returnedStatus}`
  const needsFailureEvidence =
    (!runnerReturnedTerminal && !storedTerminal) ||
    ((result.status === 'failed' || result.error) &&
      storedAgent.status === 'idle' &&
      !storedAgent.objective)
  const finalAgent =
    needsFailureEvidence
      ? {
          ...storedAgent,
          id: storedAgent.id || runId,
          objective,
          status: 'failed' as const,
          progress: 100,
          result: result.error || nonTerminalReason,
          haltReason: result.error || nonTerminalReason,
          finishedAt: new Date().toISOString(),
          steps: [
            {
              step: 1,
              action: result.path === 'cli' ? 'local-cli' : 'task-run',
              description: result.path === 'cli' ? '外部 CLI 執行' : 'Task run lifecycle',
              status: 'FAILED' as const,
              result: result.error || nonTerminalReason,
            },
          ],
        }
      : storedAgent
  const postState = finalAgent.postState

  const status =
    result.status === 'failed' || result.error
      ? result.status === 'failed'
        ? 'failed'
        : finalAgent.status
      : finalAgent.status || result.status

  const writeback = await disposeRestrictedProjectView(runId, String(status) === 'success')
  if (writeback && writeback.filesWritten > 0) {
    thr.pushBubble(
      tid,
      'system',
      `出站資料閘門：安全回寫 ${writeback.filesWritten} 檔（withheld ranges=${writeback.withheldRanges}）`,
    )
  }

  const reviewSnapshotRef = await finalizeRunReviewSnapshot(
    input.reviewAdmission,
    runId,
    reviewSettlementKindForFinalization(finalAgent, result),
  )

  // 1) Thread summary / bubbles / plan
  if (postState?.status === 'failed') {
    thr.pushBubble(
      tid,
      'system',
      `Next_State=${postState.nextState}：${postState.error || 'delivery failed'}`,
    )
  } else if (postState?.status === 'delivered') {
    thr.pushBubble(
      tid,
      'system',
      `Next_State=Dispatch Webhook 已送出：${postState.target || 'target'}${postState.responseStatus ? ` · HTTP ${postState.responseStatus}` : ''}`,
    )
  }

  if (finalAgent.steps?.length > 0) {
    thr.setRunPlan(
      tid,
      finalAgent.steps.map((step) => ({
        id: `step_${step.step}`,
        text: step.description || step.action || `步驟 ${step.step}`,
        status:
          step.status === 'COMPLETED'
            ? ('done' as const)
            : step.status === 'FAILED'
              ? ('failed' as const)
              : step.status === 'IN_PROGRESS'
                ? ('active' as const)
                : ('pending' as const),
      })),
    )
  }

  thr.setThreadStatus(
    tid,
    (status === 'success' ||
    status === 'failed' ||
    status === 'halted' ||
    status === 'idle'
      ? status
      : finalAgent.status) as 'success' | 'failed' | 'halted' | 'idle' | 'running',
  )

  const stepsTail = (finalAgent.steps || [])
    .filter((step) => step.result)
    .slice(-3)
    .map((step) => step.result)
    .join('\n\n')
  // The answer is projected from the Host's record, not composed here: the
  // renderer stopped authoring the conversation (ADR-0039). The older chain
  // stays as the fallback for runners that do not write a record yet.
  const finalAnswer =
    conversationAnswer(finalAgent.turnRecord)
    || finalAgent.result
    || stepsTail
    || result.result
    || `狀態：${status}`
  const hasFinalAnswer = !(result.error && result.status === 'failed' && !result.result)
  if (!hasFinalAnswer) {
    thr.pushBubble(tid, 'system', result.error || finalAgent.haltReason || '執行失敗')
  }

  if (hasFinalAnswer) {
    thr.pushBubble(tid, 'assistant', finalAnswer)
  }
  // Keep review evidence adjacent to the answer it belongs to. This mirrors
  // the desktop conversation: the assistant result reads first, followed by
  // the execution disclosure and its standalone changed-files card.
  try {
    await pushRunProcessSummary({
      thr,
      tid,
      runId,
      objective,
      finalAgent,
      result,
      status: String(status),
      projectRoot: input.projectRoot,
      settings,
      reviewAdmission: input.reviewAdmission,
      reviewSnapshotRef,
    })
  } catch {
    /* execution summary must not break the task lifecycle */
  }
  thr.setThreadRunning(tid, false, runId)
  thr.setAwaitingReply(tid, finalAgent.loopConfig?.nextState === 'Await User Input')

  const finalResult: ExternalRunResult = {
    ...result,
    threadId: tid,
    runId,
    status: status as ExternalRunResult['status'],
    error: result.error || finalAgent.haltReason,
    postState,
    orchestration: orchestrationFromAgent(finalAgent),
  }

  // 2) afterRun hooks
  try {
    const { collectHookRules, evaluateHooks } = await import('./hooks.ts')
    const ev = evaluateHooks(collectHookRules(settings), {
      point: 'afterRun',
      sourceKind: input.sourceKind,
      objective,
    })
    for (const line of ev.audits) thr.pushBubble(tid, 'system', line)
    for (const n of ev.notifications) {
      void window.subagents?.notify?.('AgentStudio · Hook', n.slice(0, 160))
    }
  } catch {
    /* non-fatal */
  }

  // 3) Archive + permanent usage ledger (once; execution adapters never own this step)
  await persistTerminalRunRecords(input, finalAgent, String(finalResult.status))

  // A parked run leaves a resume point. Replay safety is asserted only for an
  // interrupt, because that is the one stop that happens at a tool boundary
  // with nothing mid-execution — the state ADR-0042 requires before a resume
  // may skip already-completed work.
  if (finalAgent.interruptReason) {
    try {
      const { saveCompactionCheckpoint } = await import('./compactionCheckpoint.ts')
      const effects = (finalAgent.toolCalls || [])
        .filter((tool) => tool.ok !== false && /write|edit|create|patch|bash|shell|send|post|publish|delete/i.test(tool.tool))
        .map((tool) => `${tool.tool}${tool.input?.path ? ` · ${String(tool.input.path)}` : ''}`)
      await saveCompactionCheckpoint(runId, {
        threadId: tid,
        objective,
        summary: buildResumeSummary(finalAgent),
        messages: [],
        parkedAtToolBoundary: true,
        replaySafe: true,
        effects,
      })
    } catch {
      /* No checkpoint means no resume offer; never block finalization. */
    }
  }

  // Sediment what this run learned into the project, before the terminal
  // marker: the journal entry then either carries write evidence or does not,
  // and nothing in between can claim the knowledge was kept.
  try {
    await persistRunMemoryDigest({
      runId,
      threadId: tid,
      objective,
      finalAgent,
      status: String(status),
      projectRoot: input.projectRoot,
    })
  } catch {
    /* A missing digest is reported by its absence, never by a failed run. */
  }

  // Persist the terminal marker only after the user-visible summary and
  // archive evidence have been attempted. A crash before this point remains
  // conservatively recoverable as interrupted instead of claiming a complete
  // run without its evidence.
  recordRunTerminal({
    runId,
    threadId: tid,
    status: String(status),
    delivery: {
      hasOwningThread: useThreadStore.getState().threads.some((thread) => thread.id === tid),
      // The assistant answer / failure line above is this run's outcome in-thread.
      resultWrittenToThread: true,
      rendererPresent: rendererPresent(),
    },
    settlement: terminalJournalSettlement(input, finalAgent),
  })

  try {
    const { useRunActivityStore } = await import('../store/runActivityStore.ts')
    const terminalLabel =
      String(status) === 'failed'
        ? '失敗'
        : String(status) === 'halted'
          ? finalAgent.interruptReason === 'timeout'
            ? '已逾時中止'
            : finalAgent.interruptReason === 'user'
              ? '已中止'
              : '已停止'
          : '完成'
    // The settled outcome rides the same registry entry the shell watches, so
    // the completion notice reads one record instead of reconstructing state.
    const outcomeSettlement = orchestrationFromAgent(finalAgent)
    useRunActivityStore.getState().end(runId, terminalLabel, {
      status:
        String(status) === 'failed' ? 'failed' : String(status) === 'halted' ? 'halted' : 'success',
      objective,
      executionKind: outcomeSettlement?.executionKind || finalAgent.executionKind,
      iterations: outcomeSettlement?.iterations,
      maxIterations: outcomeSettlement?.maxIterations,
      dodMet: outcomeSettlement?.dodMet,
      interruptReason: finalAgent.interruptReason,
    })
  } catch {
    /* renderer activity is optional for headless / recovery paths */
  }

  // 4) onSettled
  await settle(finalResult)

  // Steps 5 (release capacity) and 6 (queue drain) are not steps of this
  // sequence: they are obligations of holding the finalization claim, and run
  // in finalizeTaskRun's finally whatever this sequence did.
  return finalResult
}

/**
 * Reconstruct the coordinator-owned terminal effects after Host process loss.
 *
 * The old renderer promise/callback is gone after reload, so recovery cannot
 * merely paint an interrupted label. A durable journal terminal marker is the
 * idempotency key; the normal finalizer then owns summary, archive, release,
 * and queue-drain effects exactly as it does for a live adapter.
 */
export async function finalizeRecoveredExternalRun(input: {
  runId: string
  threadId?: string
  conversationId?: string
  adapter: string
  reason?: string
}): Promise<ExternalRunResult | null> {
  const runId = input.runId.trim()
  if (!runId || recoveredFinalizationClaims.has(runId)) return null
  const existing = getJournalEntry('run', runId)
  if (existing && ['success', 'failed', 'cancelled'].includes(existing.status)) return null
  recoveredFinalizationClaims.add(runId)
  try {
    const [{ useSettingsStore }, { emptyAgentLike }] = await Promise.all([
      import('../store/settingsStore.ts'),
      import('./localCliRun.ts'),
    ])
    const threadId = input.threadId || input.conversationId || runId
    const objective = '外部 CLI 執行於 Host 重啟時中斷'
    const reason = (input.reason || 'Electron host restart; process ownership was lost').slice(0, 300)
    const agent = emptyAgentLike({
      id: runId,
      objective,
      status: 'failed',
      executionKind: 'external',
      externalRunnerKind: input.adapter,
      haltReason: `interrupted · ${reason}`,
      result: `外部 CLI 已中斷：${reason}`,
      steps: [{
        step: 1,
        action: 'external-cli-recovery',
        description: `外部 CLI · ${input.adapter}（Host recovery）`,
        status: 'FAILED',
        result: `需要手動重新執行 · ${reason}`,
      }],
    })
    return await finalizeTaskRun({
      runId,
      threadId,
      objective,
      sourceKind: 'retry',
      settings: useSettingsStore.getState().settings,
      early: { error: `外部 CLI 執行已中斷：${reason}`, path: 'cli', agent },
    })
  } catch (error) {
    recoveredFinalizationClaims.delete(runId)
    throw error
  }
}

/**
 * Consume a terminal settlement that Pi Host journalled after a renderer
 * reload. This is deliberately a coordinator adapter, not a new ingress: the
 * existing finalizeTaskRun sequence still owns summary, archive, metrics,
 * onSettled, release, and queue drain.
 */
export async function finalizeRecoveredPiHostRun(input: {
  runId: string
  threadId: string
  objective: string
  agent: AgentState
}): Promise<ExternalRunResult | null> {
  const runId = input.runId.trim()
  if (!runId || recoveredFinalizationClaims.has(runId)) return null
  recoveredFinalizationClaims.add(runId)
  try {
    const { useSettingsStore } = await import('../store/settingsStore.ts')
    const status = input.agent.status === 'success'
      ? 'success'
      : input.agent.status === 'halted'
        ? 'halted'
        : 'failed'
    return await finalizeTaskRun({
      runId,
      threadId: input.threadId,
      objective: input.objective,
      sourceKind: 'retry',
      settings: useSettingsStore.getState().settings,
      dispatchResult: {
        path: 'builtin',
        executionKind: 'loop',
        status,
        executionSettlement: input.agent.executionSettlement,
        goalVerdict: input.agent.goalVerdict,
        goalContractDigest: input.agent.goalContractDigest,
        acceptanceDigest: input.agent.acceptanceDigest,
        stopReason: input.agent.stopReason,
        orchestration: orchestrationFromAgent(input.agent),
        ...(input.agent.result ? { result: input.agent.result } : {}),
        ...(status === 'failed' && input.agent.result ? { error: input.agent.result } : {}),
      },
    })
  } catch (error) {
    recoveredFinalizationClaims.delete(runId)
    throw error
  }
}

/** How many past digests a new run on the same thread is reminded of. */
const PRIOR_CONTEXT_DIGESTS = 3

/**
 * The prior-context block for a new run on an existing thread.
 *
 * Read from the journal's own write evidence, so a thread only carries forward
 * digests that provably reached disk — never ones a model said it wrote.
 */
async function loadThreadPriorContext(threadId: string, projectRoot?: string): Promise<string> {
  try {
    const [{ listJournalEntries }, { parseRunMemoryDigest }, { buildPriorContextBlock }] = await Promise.all([
      import('./runJournal.ts'),
      import('./runMemoryDigest.ts'),
      import('./runMemorySink.ts'),
    ])
    const sinks = listJournalEntries()
      .filter((entry) => entry.kind === 'run' && entry.threadId === threadId && entry.memorySink)
      .slice(-PRIOR_CONTEXT_DIGESTS)
    if (!sinks.length) return ''
    const digests = []
    for (const entry of sinks) {
      const read = await window.subagents?.tools?.workspaceRead?.(entry.memorySink!.path, projectRoot)
      const content = typeof read === 'string' ? read : read?.content
      if (!content) continue
      const digest = parseRunMemoryDigest(content, {
        runId: entry.id,
        threadId,
        at: entry.memorySink!.at,
      })
      if (digest) digests.push(digest)
    }
    return digests.length ? buildPriorContextBlock(digests, PRIOR_CONTEXT_DIGESTS) : ''
  } catch {
    // Prior context is a courtesy; a missing one must never block a run.
    return ''
  }
}

/**
 * Write this run's four-section digest into the project's memory directory.
 *
 * Everything in the digest comes from recorded execution — plan steps, failed
 * steps, halt reasons — never from the model narrating its own competence.
 */
async function persistRunMemoryDigest(args: {
  runId: string
  threadId: string
  objective: string
  finalAgent: import('./types.ts').AgentState
  status: string
  projectRoot?: string
  /** The run's frozen settings — the only place user-stated model rates live. */
  settings?: import('./types.ts').LlmSettings
}): Promise<void> {
  const [{ buildRunMemoryDigestFromRun }, { renderRunMemoryDigest, runMemoryRelativePath, isWorthPersisting }] =
    await Promise.all([import('./runMemoryDigest.ts'), import('./runMemorySink.ts')])
  const digest = buildRunMemoryDigestFromRun({
    runId: args.runId,
    threadId: args.threadId,
    objective: args.objective,
    agent: args.finalAgent,
    status: args.status,
  })
  if (!isWorthPersisting(digest)) return
  const relativePath = runMemoryRelativePath(digest)
  const written = await window.subagents?.learning?.export?.({
    relativePath,
    content: renderRunMemoryDigest(digest),
    projectRoot: args.projectRoot,
    overwrite: true,
  })
  if (!written?.ok || !written.path) return
  const { recordRunMemorySink } = await import('./runJournal.ts')
  recordRunMemorySink(args.runId, { path: written.path, bytes: written.bytes || 0 })
}

/**
 * What a resumed run is told about where the previous attempt got to.
 *
 * Built from the run's own recorded steps and partial answer — never from a
 * model claim about its own progress (ADR-0048).
 */
function buildResumeSummary(agent: import('./types.ts').AgentState): string {
  const steps = (agent.steps || [])
    .filter((step) => step.status === 'COMPLETED')
    .slice(-12)
    .map((step) => `- ${step.description || step.action || `步驟 ${step.step}`}`)
  const partial = (agent.result || '').trim().slice(0, 2_000)
  return [
    steps.length ? `已完成的步驟：\n${steps.join('\n')}` : '沒有記錄到已完成的步驟。',
    partial ? `\n中斷前的部分輸出：\n${partial}` : '',
  ].join('\n').trim()
}

async function pushEarlyFailureSummary(input: {
  thr: ReturnType<typeof import('../store/threadStore.ts').useThreadStore.getState>
  tid: string
  runId: string
  objective: string
  finalAgent?: import('./types.ts').AgentState
  result: DispatchResult
  projectRoot?: string
  settings: import('./types.ts').LlmSettings
  reviewAdmission?: ReviewAdmissionSnapshot
  reviewSnapshotRef?: ReviewSnapshotRef
}): Promise<void> {
  if (!input.finalAgent) return
  try {
    await pushRunProcessSummary({
      thr: input.thr,
      tid: input.tid,
      runId: input.runId,
      objective: input.objective,
      finalAgent: input.finalAgent,
      result: input.result,
      status: 'failed',
      projectRoot: input.projectRoot,
      settings: input.settings,
      reviewAdmission: input.reviewAdmission,
      reviewSnapshotRef: input.reviewSnapshotRef,
    })
  } catch {
    /* review summary must not block early settlement */
  }
}

async function legacySummaryDiff(input: {
  reviewAdmission?: ReviewAdmissionSnapshot
  reviewSnapshotRef?: ReviewSnapshotRef
  producedFiles: Array<{ path: string }>
  projectRoot?: string
}): Promise<string | undefined> {
  // Only the explicitly non-canonical browser compatibility path may read a
  // live workspace. A failed canonical capture remains failed; rereading the
  // mutable tree would silently substitute different evidence.
  if (input.reviewAdmission?.canonical !== false || input.reviewSnapshotRef || input.producedFiles.length === 0) return undefined
  try {
    const { useProjectStore } = await import('../store/projectStore.ts')
    const projectRoot = input.projectRoot || useProjectStore.getState().root || undefined
    const diffResult = await window.subagents?.tools?.workspaceDiff?.(
      input.producedFiles.map((file) => file.path),
      projectRoot,
    )
    return diffResult?.ok && diffResult.diff.trim()
      ? diffResult.diff.slice(0, 200_000)
      : undefined
  } catch {
    /* Legacy diff is optional; it is never historical review authority. */
    return undefined
  }
}

function archivedAgentWork(finalAgent: AgentState) {
  if (!finalAgent.hostSessionId) return undefined
  const recordedEntries = finalAgent.turnRecord?.entries || []
  const originTurn = recordedEntries.reduce((highest, entry) => (
    entry.kind === 'agent-lifecycle' || entry.kind === 'agent-collaboration'
      ? highest
      : Math.max(highest, entry.turn)
  ), 0)
  if (originTurn <= 0) return undefined
  const entries = recordedEntries.filter((entry) => entry.kind === 'agent-lifecycle'
    || entry.kind === 'agent-collaboration'
    || entry.kind === 'delegation-assignment'
    || entry.kind === 'delegation-observation'
    || entry.kind === 'delegation-check')
  return { sessionId: finalAgent.hostSessionId, originTurn, entries }
}

function archivedAgentWorkPayload(finalAgent: AgentState) {
  const agentWork = archivedAgentWork(finalAgent)
  return agentWork ? { agentWork } : {}
}

type RunSummaryChangedFile = {
  path: string
  action: string
  added?: number
  removed?: number
}

function reviewFileAction(file: ReviewFileManifestEntry): string {
  if (file.status === 'added' || file.status === 'untracked' || file.status === 'copied') return 'create'
  if (file.status === 'deleted') return 'delete'
  if (file.status === 'renamed') return 'rename'
  return 'edit'
}

/**
 * Archive the Host snapshot's per-file numstat next to the summary bubble.
 * The Turn Record remains the fallback for old/degraded runners, while a
 * canonical snapshot supplies deletions, renames, and exact +/− counts.
 */
async function reviewSummaryFiles(
  ref: ReviewSnapshotRef | undefined,
  producedFiles: Array<{ path: string; action: string }>,
): Promise<RunSummaryChangedFile[]> {
  const fallback = producedFiles.map((file) => ({ path: file.path, action: file.action }))
  const listFiles = typeof window === 'undefined' ? undefined : window.subagents?.piHost?.review?.listFiles
  if (!ref || typeof listFiles !== 'function') return fallback
  try {
    const items: ReviewFileManifestEntry[] = []
    let cursor: string | undefined
    for (let pageNumber = 0; pageNumber < 25; pageNumber += 1) {
      const response = await listFiles({
        target: { kind: 'run-snapshot', snapshotId: ref.snapshotId },
        ...(cursor ? { cursor } : {}),
        limit: 200,
      })
      items.push(...response.reviewFiles.items)
      cursor = response.reviewFiles.nextCursor
      if (!cursor) break
    }
    if (!items.length) return fallback
    const files = items.map((file) => ({
      path: file.path,
      action: reviewFileAction(file),
      ...(file.additions === undefined ? {} : { added: file.additions }),
      ...(file.removals === undefined ? {} : { removed: file.removals }),
    }))
    const known = new Set(files.map((file) => file.path))
    return [...files, ...fallback.filter((file) => !known.has(file.path))]
  } catch {
    return fallback
  }
}

async function pushRunProcessSummary(args: {
  thr: ReturnType<typeof import('../store/threadStore.ts').useThreadStore.getState>
  tid: string
  runId: string
  objective: string
  finalAgent: import('./types.ts').AgentState
  result: DispatchResult
  status: string
  projectRoot?: string
  /** The run's frozen settings — the only place user-stated model rates live. */
  settings?: import('./types.ts').LlmSettings
  reviewAdmission?: ReviewAdmissionSnapshot
  reviewSnapshotRef?: ReviewSnapshotRef
}): Promise<void> {
  const { thr, tid, runId, finalAgent, result, status } = args
  const {
    useSubDesignStore,
  } = await import('../store/subDesignStore.ts')
  const { useSubDesignArtifactStore } = await import('../store/subDesignArtifactStore.ts')
  const { useSubDesignCritiqueStore } = await import('../store/subDesignCritiqueStore.ts')
  const { useSubDesignExportStore } = await import('../store/subDesignExportStore.ts')

  // The execution process is derived from the Turn Record and from nothing
  // else. The four-source fallback ladder (live activity → Host tool audit →
  // toolCalls → steps+logs) is gone: none of those shapes was canonical, and
  // the live cache's 120/40 caps meant a long run lost its earliest operations
  // exactly when it finished. The record has no such cap — its entries are the
  // durable history — so the summary now shows every operation a run did.
  const { projectRunOperations, projectProducedFiles } = await import('./runOperationsProjection.ts')
  const operations = projectRunOperations(finalAgent.turnRecord).map((row) => ({
    id: row.id,
    kind: row.kind,
    title: row.title,
    detail: row.detail,
    path: row.path,
    ok: row.ok,
    // The diff size the tool's own declaration derived from the record's
    // args — the same numbers the live timeline showed, so the collapsed
    // summary card can re-render the same process without the live cache.
    added: row.added,
    removed: row.removed,
  }))
  const producedFiles = projectProducedFiles(finalAgent.turnRecord)
  const summaryFiles = await reviewSummaryFiles(args.reviewSnapshotRef, producedFiles)
  const diff = await legacySummaryDiff({
    reviewAdmission: args.reviewAdmission,
    reviewSnapshotRef: args.reviewSnapshotRef,
    producedFiles,
    projectRoot: args.projectRoot,
  })
  const plan = (thr.threads.find((thread) => thread.id === tid)?.runPlan || []).slice(0, 40)
  const subDesignBrief = useSubDesignStore.getState().findByThreadId(tid)
  const subDesignArtifact = subDesignBrief
    ? useSubDesignArtifactStore.getState().findByBriefId(subDesignBrief.id)[0]
    : null
  const subDesignCritique = subDesignArtifact
    ? useSubDesignCritiqueStore
        .getState()
        .latestForArtifact(subDesignArtifact.id, subDesignArtifact.revision)
    : null
  const subDesignExports = subDesignArtifact
    ? useSubDesignExportStore.getState().findByArtifactId(subDesignArtifact.id)
    : []
  const settlement = orchestrationFromAgent(finalAgent)
  // The same projection every live surface reads, run once at settlement so
  // the archived bubble and the panel it replaces cannot report two totals.
  const { projectContextUsage } = await import('./contextUsageProjection.ts')
  const usageModel = finalAgent.steps?.[finalAgent.steps.length - 1]?.modelUsed
  const usage = projectContextUsage(finalAgent.turnRecord, {
    // Rates the user stated price the run when its recorder could not. The
    // window is not needed here: the archived bubble shows totals, not a ratio.
    pricing: usageModel ? args.settings?.modelProfiles?.[usageModel]?.pricing : undefined,
  })
  thr.pushRunSummary(tid, {
    runId,
    ...archivedAgentWorkPayload(finalAgent),
    status:
      status === 'failed' ? 'failed' : status === 'halted' ? 'halted' : 'success',
    durationMs: finalAgent.metrics?.executionMs,
    dodMet: settlement?.dodMet,
    iterations: settlement?.iterations,
    maxIterations: settlement?.maxIterations,
    executionKind: settlement?.executionKind,
    turnSettlement: finalAgent.turnSettlement,
    executionSettlement: finalAgent.executionSettlement,
    goalVerdict: finalAgent.goalVerdict,
    appFinalization: finalAgent.appFinalization,
    interruptReason: finalAgent.interruptReason,
    reviewSnapshotRef: args.reviewSnapshotRef,
    // Written only when something was actually measured; a runner that
    // reported nothing archives no figure rather than a zero.
    ...(usage.measuredSteps > 0 ? { tokens: usage.tokens.total } : {}),
    ...(usage.costUsd === undefined ? {} : { costUsd: usage.costUsd }),
    subDesign: subDesignBrief
      ? {
          briefId: subDesignBrief.id,
          stage: subDesignBrief.stage,
          selectedDirectionId: subDesignBrief.selectedDirectionId,
          artifactId: subDesignArtifact?.id,
          artifactRevision: subDesignArtifact?.revision,
          critique: subDesignCritique
            ? {
                revision: subDesignCritique.revision || 1,
                verdict: subDesignCritique.verdict,
                blockerCount: subDesignCritique.findings.filter(
                  (finding) => finding.severity === 'blocker',
                ).length,
                scores: {
                  briefCoverage: subDesignCritique.briefCoverage,
                  brandConformance: subDesignCritique.brandConformance,
                  accessibility: subDesignCritique.accessibility,
                  implementationReadiness: subDesignCritique.implementationReadiness,
                },
              }
            : undefined,
          exports: subDesignExports.map((item) => ({
            format: item.format,
            revision: item.revision,
            path: item.path,
            sha256: item.sha256,
          })),
        }
      : undefined,
    diff,
    plan,
    agents: (finalAgent.subAgents || []).map((agent) => ({
      id: agent.id,
      name: agent.name,
      role: agent.role,
      status: agent.status,
      lastMessage: agent.lastMessage,
      model: agent.model,
    })),
    operations:
      operations.length > 0
        ? operations
        : [
            {
              id: 'run_done',
              kind: status === 'success' ? 'done' : 'status',
              title:
                result.path === 'cli'
                  ? `本機 CLI 完成（${result.kind || 'cli'}）`
                  : `執行完成 · ${status}`,
              detail: (finalAgent.result || '').slice(0, 200),
              ok: status === 'success',
            },
          ],
    files: summaryFiles,
  })

  await persistArtifactIndexForRun({
    threadId: tid,
    runId,
    objective: args.objective,
    status,
    result: finalAgent.result || result.result || result.error,
    blockers: [
      ...(finalAgent.haltReason ? [finalAgent.haltReason] : []),
      ...operations
        .filter((operation) => operation.ok === false)
        .map((operation) => operation.title),
    ],
    decisions: plan.length ? [`執行計畫已保留為引用（${plan.length} 項）`] : [],
    suggestedNextSkills:
      status === 'success' ? ['code-review'] : ['tdd', 'code-review'],
    evidenceOperations: operations,
    plan,
    diff,
    projectRoot: args.projectRoot,
    review: subDesignCritique
      ? {
          source: `subdesign:${subDesignCritique.artifactId || 'artifact'}/critique`,
          status: subDesignCritique.verdict === 'pass' ? 'complete' : 'stale',
          detail: `${subDesignCritique.verdict}; ${subDesignCritique.findings.length} findings`,
        }
      : undefined,
  })
}

async function persistArtifactIndexForRun(args: {
  threadId: string
  runId: string
  objective: string
  status: string
  result?: string
  blockers?: string[]
  decisions?: string[]
  suggestedNextSkills?: string[]
  evidenceOperations: Array<{ id: string; kind: string; title: string; ok?: boolean }>
  plan: Array<{ id: string; text: string; status: string }>
  diff?: string
  projectRoot?: string
  review?: { source: string; status: 'complete' | 'failed' | 'stale' | 'missing'; detail?: string }
}): Promise<void> {
  try {
    const {
      buildArtifactEvidenceFromRun,
      recordArtifactRun,
    } = await import('./artifactIndex.ts')
    const storage = typeof window === 'undefined' ? undefined : window.localStorage
    if (!storage) return
    const evidence = buildArtifactEvidenceFromRun({
      threadId: args.threadId,
      runId: args.runId,
      objective: args.objective,
      status: args.status,
      result: args.result,
      diff: args.diff,
      projectRoot: args.projectRoot,
      operations: args.evidenceOperations,
      plan: args.plan,
      review: args.review,
    })
    recordArtifactRun(storage, {
      threadId: args.threadId,
      runId: args.runId,
      objective: args.objective,
      status: args.status,
      result: args.result,
      blockers: args.blockers,
      decisions: args.decisions,
      suggestedNextSkills: args.suggestedNextSkills,
      evidence,
    })
  } catch {
    /* Artifact indexing is best-effort and never changes run outcome. */
  }
}

function activeSameThreadRunId(opts: ExternalRunOpts, busyRunId: string | null | undefined, activeRunIds: readonly string[]): string | undefined {
  return opts.reuseThreadId && busyRunId && activeRunIds.includes(busyRunId) ? busyRunId : undefined
}

function admittedObjective(opts: ExternalRunOpts): string {
  const objective = opts.objective.trim()
  return objective || (opts.attachments?.length ? '請分析我附上的圖片或檔案。' : '')
}

function queuedFollowUpCount(queue: unknown, threadId: string): number {
  if (!Array.isArray(queue)) return 0
  return queue.filter((value) => {
    if (!value || typeof value !== 'object') return false
    const item = value as Record<string, unknown>
    const profile = item.profile && typeof item.profile === 'object' ? item.profile as Record<string, unknown> : {}
    return item.action === 'queue' && item.status === 'queued' && profile.threadId === threadId
  }).length
}

function eligibleBuiltinFollowUpAction(input: {
  opts: ExternalRunOpts
  runner: ThreadRunner
  activeRunId?: string
  settings: LlmSettings
}): 'steer' | 'queue' | undefined {
  const interactiveSource = input.opts.sourceKind === 'composer'
    || input.opts.sourceKind === 'slash'
    || input.opts.sourceKind === 'retry'
    || input.opts.sourceKind === 'review'
  if (!interactiveSource || input.opts._fromQueue || input.runner !== 'builtin' || !input.activeRunId || !input.opts.reuseThreadId) return undefined
  const action = input.opts.followUpAction || followUpActionForRunner(input.runner, input.settings.followUpMode || 'steer')
  return action === 'steer' || action === 'queue' ? action : undefined
}

function builtinFollowUpProfile(input: {
  opts: ExternalRunOpts
  settings: LlmSettings
  existingThread?: { model?: string; agentMode?: string }
}): Record<string, unknown> {
  return Object.fromEntries(Object.entries({
    model: input.opts.overrides?.model || input.existingThread?.model,
    thinkingLevel: input.opts.overrides?.thinkingDepth,
    speed: input.opts.overrides?.speed,
    approvalMode: input.opts.overrides?.approvalMode || input.settings.approvalMode,
    agentMode: input.opts.overrides?.agentMode || input.existingThread?.agentMode,
  }).filter(([, value]) => value !== undefined))
}

function acceptedBuiltinFollowUpResult(input: {
  action: 'steer' | 'queue'
  response: Record<string, unknown>
  threadId: string
  runId: string
}): ExternalRunResult {
  const queuedCount = queuedFollowUpCount(input.response.queue, input.threadId)
  const notice = input.action === 'steer'
    ? '已引導目前執行：將在下一個安全工具／模型邊界套用。'
    : `已加入目前對話的 Host 佇列第 ${Math.max(1, queuedCount)} 位，會在目前 Task run 完成後執行。`
  return { path: 'builtin', status: 'skipped', error: notice, threadId: input.threadId, runId: input.runId, skipped: true, skipReason: input.action, ...(input.action === 'queue' ? { queued: true } : {}) }
}

function rejectedBuiltinFollowUpResult(input: {
  action: 'steer' | 'queue'
  error: unknown
  threadId: string
  runId: string
  objective: string
}): ExternalRunResult {
  const reason = input.error instanceof Error ? input.error.message : String(input.error)
  const label = input.action === 'steer' ? '引導' : '排隊'
  return {
    path: 'builtin',
    status: 'skipped',
    error: `${label}未接受：${reason}；原始指令已保留，可編輯或改為排隊。`,
    threadId: input.threadId,
    runId: input.runId,
    skipped: true,
    skipReason: 'busy',
    followUpRecovery: {
      id: input.runId,
      text: input.objective,
      action: input.action,
      reason,
    },
  }
}

async function submitBuiltinBusyFollowUp(input: {
  opts: ExternalRunOpts
  runId: string
  objective: string
  activeRunId?: string
  runner: ThreadRunner
  attachments: ChatAttachment[]
  projectRoot?: string
  settings: LlmSettings
  existingThread?: { model?: string; agentMode?: string }
  pushUserBubble: (threadId: string, text: string, attachments: ChatAttachment[]) => void
}): Promise<ExternalRunResult | undefined> {
  const action = eligibleBuiltinFollowUpAction(input)
  if (!action || !input.activeRunId || !input.opts.reuseThreadId) return undefined
  const piHost = window.subagents?.piHost
  if (!piHost?.sessions?.list || !piHost.turn?.submit) {
    return { path: 'builtin', status: 'skipped', error: 'Pi Host follow-up bridge unavailable；原始指令尚未接受，請稍後重送。', threadId: input.opts.reuseThreadId, runId: input.runId, skipped: true, skipReason: 'busy' }
  }
  if (!piHost.runs?.list) {
    // A partial/non-Electron bridge cannot be the queue authority. Queue mode
    // falls through to the bounded renderer compatibility queue; true steer
    // remains unavailable rather than being fabricated by abort-and-replace.
    if (action === 'queue') return undefined
    return { path: 'builtin', status: 'skipped', error: 'Pi Host steer capability unavailable；原始指令尚未接受，請改為排隊或稍後重送。', threadId: input.opts.reuseThreadId, runId: input.runId, skipped: true, skipReason: 'busy' }
  }
  try {
    const profile = builtinFollowUpProfile(input)
    const response = await submitHostInteractiveFollowUp(piHost, {
      action,
      threadId: input.opts.reuseThreadId,
      runId: input.runId,
      expectedActiveRunId: input.activeRunId,
      prompt: input.objective,
      runner: 'builtin',
      projectRoot: input.projectRoot,
      attachments: input.attachments,
      profile,
    })
    input.pushUserBubble(input.opts.reuseThreadId, input.objective, input.attachments)
    return acceptedBuiltinFollowUpResult({ action, response, threadId: input.opts.reuseThreadId, runId: input.runId })
  } catch (error) {
    return rejectedBuiltinFollowUpResult({ action, error, threadId: input.opts.reuseThreadId, runId: input.runId, objective: input.objective })
  }
}

/**
 * Coordinate one Task run: admission → immutable dispatch snapshot → adapter → finalization.
 * This is the only lifecycle implementation behind the public runTask seam.
 */
async function coordinateTaskRun(
  opts: ExternalRunOpts,
): Promise<ExternalRunResult> {
  opts = normalizeTaskRunInput(opts)
  const runId = opts.runId || `run_${uuid().slice(0, 12)}`
  const objective = admittedObjective(opts)
  const objectiveAdmission = decideInitialTaskRunAdmission({
    objective,
    runId,
    hasExplicitRunId: Boolean(opts.runId),
    reuseThreadId: opts.reuseThreadId,
    sourceKind: opts.sourceKind,
    fromQueue: opts._fromQueue === true,
    delegateEnabled: true,
    activeRunIds: [],
  })
  if (objectiveAdmission.kind !== 'proceed') {
    return initialTaskRunAdmissionResult(objectiveAdmission, { runId, originalRunId: opts.runId, reuseThreadId: opts.reuseThreadId })
  }

  const [
    { useAgentStore },
    { useThreadStore },
    { useSettingsStore },
    { dispatchThreadTask },
    { enqueueExternalRun, listQueuedRuns, queueLength, MAX_RUN_QUEUE },
    { isContinueGoalPhrase },
    { detectAutomationSuggestion },
    { resolvePlanBubbleMetadata, classifyLoopType },
    lifecycleHelpers,
  ] = await Promise.all([
    import('../store/agentStore.ts'),
    import('../store/threadStore.ts'),
    import('../store/settingsStore.ts'),
    import('./runDispatch.ts'),
    import('./runQueue.ts'),
    import('./chatHistory.ts'),
    import('./automationSuggestion.ts'),
    import('./parser.ts'),
    import('./taskRunPolicy.ts'),
  ])
  const {
    buildTakeoverPartialDigest,
    explicitLoopTypeForConversation,
    formatTakeoverNotice,
    takeoverOutcomeSummary,
    isAutomationSource,
    isInteractiveConversationSource,
    presentConversationAutomationSuggestion,
    resolveBusyPolicy,
    resolveProactiveTrigger,
    resolveScheduleTrigger,
    shouldEnqueueWhenBusy,
    verifyClaimedScheduleTrigger,
  } = lifecycleHelpers

  const queuedDuplicate = listQueuedRuns().find((queued) => queued.runId === runId)
  const initialAdmission = decideInitialTaskRunAdmission({
    objective,
    runId,
    hasExplicitRunId: Boolean(opts.runId),
    reuseThreadId: opts.reuseThreadId,
    sourceKind: opts.sourceKind,
    fromQueue: opts._fromQueue === true,
    queuedDuplicateId: queuedDuplicate?.id,
    delegateEnabled: useSettingsStore.getState().settings.subAgentsEnabled === true,
    activeRunIds: useAgentStore.getState().activeRunIds,
  })
  if (initialAdmission.kind !== 'proceed') {
    return initialTaskRunAdmissionResult(initialAdmission, { runId, originalRunId: opts.runId, reuseThreadId: opts.reuseThreadId })
  }

  const scheduleTriggerResolution = resolveScheduleTrigger(opts)
  const proactiveTriggerResolution = resolveProactiveTrigger(opts)
  const rejectBeforeStart = async (error: string): Promise<ExternalRunResult> => {
    const threadId = opts.reuseThreadId || useThreadStore.getState().activeId || null
    if (threadId && (opts.reuseThreadId || isInteractiveConversationSource(opts))) {
      useThreadStore.getState().pushBubble(threadId, 'system', error)
    }
    const rejected: ExternalRunResult = {
      path: 'builtin',
      status: 'failed',
      error,
      threadId,
      runId,
    }
    // Trigger validation happens before execution admission, so this never
    // archives or releases a run. The callback still closes scheduler/gateway
    // bookkeeping that marked the external trigger as running.
    try {
      await opts.onSettled?.(rejected)
    } catch {
      /* caller notification is non-fatal */
    }
    return rejected
  }
  if (scheduleTriggerResolution && 'error' in scheduleTriggerResolution) {
    return rejectBeforeStart(scheduleTriggerResolution.error)
  }
  if (proactiveTriggerResolution && 'error' in proactiveTriggerResolution) {
    return rejectBeforeStart(proactiveTriggerResolution.error)
  }
  const scheduleTrigger =
    scheduleTriggerResolution && 'snapshot' in scheduleTriggerResolution
      ? scheduleTriggerResolution.snapshot
      : undefined
  const eventTrigger =
    proactiveTriggerResolution && 'snapshot' in proactiveTriggerResolution
      ? proactiveTriggerResolution.snapshot
      : undefined
  if (scheduleTrigger) {
    const claimError = await verifyClaimedScheduleTrigger(scheduleTrigger)
    if (claimError) {
      return rejectBeforeStart(`Time-based trigger 無效：${claimError}`)
    }
  }

  // Coordinator owns attachment I/O: materialize once early so queue keeps filePath.
  // Hydrate happens once after capacity is reserved (below).
  const { useProjectStore } = await import('../store/projectStore.ts')
  const attachmentProjectRoot =
    opts.projectRoot || useProjectStore.getState().root || undefined
  const attachmentSessionId = opts.reuseThreadId || opts.meta?.scheduleJobId
  let attachments = await prepareRunAttachments(opts.attachments, {
    projectRoot: attachmentProjectRoot,
    sessionId: attachmentSessionId,
    phase: 'persist',
  })

  // Conversation text can mention a schedule or event, but that is not a
  // validated trigger. Keep the request in the chat as an advisory proposal;
  // no capacity reservation, engine start, or tool call is allowed here.
  const conversationSuggestion =
    !opts._fromQueue &&
    isInteractiveConversationSource(opts) &&
    !explicitLoopTypeForConversation(opts)
      ? detectAutomationSuggestion(objective)
      : null
  if (conversationSuggestion) {
    return presentConversationAutomationSuggestion(
      opts,
      objective,
      conversationSuggestion,
    )
  }

  // Freeze the selected/configured connector capability set before the first
  // capacity branch. Queued and admitted runs therefore carry the same
  // fail-closed auth context instead of deriving it from later stderr.
  const existingAdmissionThread = opts.reuseThreadId
    ? useThreadStore.getState().threads.find((thread) => thread.id === opts.reuseThreadId)
    : undefined
  const selectedRunner = opts.runner || existingAdmissionThread?.runner
  const selectedMcpAgentId =
    opts.overrides?.mcpAgentId || opts.overrides?.agentMode || existingAdmissionThread?.agentMode
  if (!opts.runner && selectedRunner && selectedRunner !== 'builtin') {
    // Persist the resolved runner with a queued request; otherwise a restart
    // would hydrate an external conversation as the builtin adapter.
    opts = { ...opts, runner: selectedRunner }
  }
  const admissionSettings = useSettingsStore.getState().settings
  if (opts.runner && opts.runner !== 'builtin') {
    const queueSnapshotAdmission = decideExternalQueueSnapshotAdmission({
      runner: opts.runner,
      fromQueue: opts._fromQueue === true,
      hasConnectorSnapshot: Array.isArray(opts.overrides?.externalCliRequiredConnectors),
    })
    if (queueSnapshotAdmission.kind === 'missing-connector-snapshot') {
      const rejected: ExternalRunResult = {
        path: 'cli',
        status: 'failed',
        error: '佇列項目缺少 external CLI connector capability snapshot，已停止不安全補跑；請手動重新提交。',
        threadId: opts.reuseThreadId || null,
        runId,
      }
      try { await opts.onSettled?.(rejected) } catch { /* callback is non-fatal */ }
      return rejected
    }
    opts = {
      ...opts,
      overrides: {
        ...(opts.overrides || {}),
        mcpAgentId: selectedMcpAgentId,
        externalCliRequiredConnectors: snapshotExternalCliConnectorRequirements(
          admissionSettings,
          opts.overrides,
        ),
      },
    }
  }

  // Coordinator owns capacity: check once, then reserve once.
  const agent = useAgentStore.getState()
  let capacity = await checkRunCapacity(runId, opts.reuseThreadId)
  if (!capacity.allowed) {
    const policy: BusyPolicy = decideBusyPolicy({
      followUpAction: opts.followUpAction,
      sourceKind: opts.sourceKind,
      resolvedSourcePolicy: opts.sourceKind
        ? resolveBusyPolicy(opts.sourceKind, useSettingsStore.getState().settings.followUpMode)
        : undefined,
      shouldEnqueue: shouldEnqueueWhenBusy(opts),
    })

    const thrBusy = useThreadStore.getState()
    const busyThreadId = opts.reuseThreadId || thrBusy.runningThreadId || thrBusy.runningThreadIds[0]
    const busyRunId = opts.reuseThreadId
      ? agent.getRunIdForThread(opts.reuseThreadId)
      : agent.selectedRunId || agent.activeRunIds[0]
    const runningTitle = busyThreadId
      ? thrBusy.threads.find((t) => t.id === busyThreadId)?.title?.slice(0, 32)
      : undefined
    const sameThreadActiveRunId = activeSameThreadRunId(opts, busyRunId, useAgentStore.getState().activeRunIds)
    const builtinFollowUp = await submitBuiltinBusyFollowUp({
      opts,
      runId,
      objective,
      activeRunId: sameThreadActiveRunId,
      runner: (selectedRunner || 'builtin') as ThreadRunner,
      attachments: attachments || [],
      projectRoot: attachmentProjectRoot,
      settings: admissionSettings,
      existingThread: existingAdmissionThread,
      pushUserBubble: (threadId, text, bubbleAttachments) => thrBusy.pushBubble(threadId, 'user', text, bubbleAttachments),
    })
    if (builtinFollowUp) return builtinFollowUp

    if (policy === 'steer' && !opts._fromQueue) {
      // External CLI takeover: capture the partial digest, abort, then report what
      // actually happened. The bubble is written after the outcome is known —
      // announcing an abort up front is how the old path could say "已轉向"
      // and then answer busy, leaving the user's instruction nowhere at all.
      const tid0 = opts.reuseThreadId || thrBusy.activeId
      const partial = buildTakeoverPartialDigest(agent.getRunState(busyRunId || undefined) || agent.agent)
      // The bubble and the returned `error` are the same sentence, so the
      // thread and the caller can never be told different stories.
      const takeoverResult = (
        outcome: TakeoverOutcome,
        queuePosition?: number,
        queueTotal?: number,
      ): string => {
        const shape = { outcome, runningTitle, partial, queuePosition, queueTotal }
        if (tid0) thrBusy.pushBubble(tid0, 'system', formatTakeoverNotice(shape))
        return takeoverOutcomeSummary(shape)
      }
      // Only a run still holding a capacity slot can be steered away from.
      // A stale thread→run association is not something to abort, and busy is
      // then the truthful answer rather than a lost race.
      const abortableRunId =
        busyRunId && useAgentStore.getState().activeRunIds.includes(busyRunId)
          ? busyRunId
          : null
      if (!abortableRunId) {
        return {
          path: 'builtin',
          status: 'skipped',
          error: takeoverResult('not-abortable'),
          threadId: tid0 || null,
          runId,
          skipped: true,
          skipReason: 'busy',
        }
      } else {
        useAgentStore.getState().stopExecution(abortableRunId)
        for (let i = 0; i < 20; i += 1) {
          await new Promise((r) => setTimeout(r, 50))
          capacity = await checkRunCapacity(runId, opts.reuseThreadId)
          if (capacity.allowed) break
        }
        if (capacity.allowed) {
          takeoverResult('took-over')
        } else {
          // A safe park stops at the next tool boundary, so outliving the wait
          // window is normal behaviour — not a reason to discard the new goal.
          // It takes the same queue every other busy follow-up takes.
          const item = enqueueExternalRun({
            ...opts,
            runId,
            attachments,
            unattended: opts.unattended ?? isAutomationSource(opts),
          })
          if (item) {
            const pos = listQueuedRuns().findIndex((q) => q.id === item.id) + 1
            return {
              path: 'builtin',
              status: 'skipped',
              error: takeoverResult('queued', pos > 0 ? pos : queueLength(), queueLength()),
              threadId: tid0 || null,
              runId,
              skipped: true,
              skipReason: 'queued',
              queued: true,
              queueId: item.id,
            }
          }
          // Unreachable while the queue dedupes on runId and the duplicate
          // guard at the top of admission already rejects a re-queued runId —
          // kept because the abort has happened either way, and the generic
          // capacity wording below would flatly contradict the bubble.
          return {
            path: 'builtin',
            status: 'skipped',
            error: takeoverResult('aborted-not-queued'),
            threadId: tid0 || null,
            runId,
            skipped: true,
            skipReason: 'busy',
          }
        }
      }
    } else if (policy === 'queue' && !opts._fromQueue) {
      opts = await freezeExternalInstructionsForQueue(opts)
      const item = enqueueExternalRun({
        ...opts,
        runId,
        attachments,
        unattended: opts.unattended ?? isAutomationSource(opts),
      })
      if (item) {
        const pos = listQueuedRuns().findIndex((q) => q.id === item.id) + 1
        const posLabel = pos > 0 ? pos : queueLength()
        return {
          path: 'builtin',
          status: 'skipped',
          error: `並行執行上限 ${capacity.limit}${runningTitle ? `（${runningTitle}）` : ''} — 已加入佇列第 ${posLabel} 位（${queueLength()}/${MAX_RUN_QUEUE}）`,
          threadId: opts.reuseThreadId || thrBusy.activeId,
          runId,
          skipped: true,
          skipReason: 'queued',
          queued: true,
          queueId: item.id,
        }
      }
      return {
        path: 'builtin',
        status: 'skipped',
        error: `並行執行上限 ${capacity.limit}${runningTitle ? `（${runningTitle}）` : ''} — 佇列已滿或重複`,
        threadId: opts.reuseThreadId || thrBusy.activeId,
        runId,
        skipped: true,
        skipReason: 'busy',
      }
    }
    if (!capacity.allowed) {
      return {
        path: 'builtin',
        status: 'skipped',
        error: `並行執行上限 ${capacity.limit}${runningTitle ? `（${runningTitle}）` : ''}，請稍候或改用佇列模式`,
        threadId: thrBusy.activeId,
        runId,
        skipped: true,
        skipReason: 'busy',
      }
    }
  }

  const reserveKind: 'builtin' | 'cli' =
    opts.runner && opts.runner !== 'builtin' ? 'cli' : 'builtin'
  if (!(await reserveRunCapacity(runId, opts.reuseThreadId, reserveKind))) {
    const retryCapacity = await checkRunCapacity(runId, opts.reuseThreadId)
    if (!opts._fromQueue && (opts.sourceKind ? resolveBusyPolicy(opts.sourceKind, useSettingsStore.getState().settings.followUpMode) : 'queue') === 'queue') {
      opts = await freezeExternalInstructionsForQueue(opts)
      const item = enqueueExternalRun({ ...opts, runId, attachments, unattended: opts.unattended ?? isAutomationSource(opts) })
      if (item) return { path: 'builtin', status: 'skipped', error: `並行執行上限 ${retryCapacity.limit}，已加入佇列`, threadId: opts.reuseThreadId || null, runId, skipped: true, skipReason: 'queued', queued: true, queueId: item.id }
    }
    return { path: 'builtin', status: 'skipped', error: `並行執行上限 ${retryCapacity.limit}，請稍候`, threadId: opts.reuseThreadId || null, runId, skipped: true, skipReason: 'busy' }
  }

  // Journal admission before any async bind/dispatch work can yield. This
  // lets startup reconciliation classify a renderer/main interruption.
  recordRunAdmitted({
    runId,
    objective,
    sourceKind: opts.sourceKind,
    scheduleJobId: opts.meta?.scheduleJobId,
    onPersisted: opts._onAdmitted,
  })

  const settings = admissionSettings
  const thr = useThreadStore.getState()
  let boundThreadId = opts.reuseThreadId || ''
  let reviewAdmission: ReviewAdmissionSnapshot | undefined

  try {

  // continueGoal needs the existing thread snapshot before bind creates/reuses.
  const preBindId = opts.reuseThreadId || ''
  const existing = preBindId ? thr.threads.find((t) => t.id === preBindId) : null
  const existingSnap = existing?.continueGoal || undefined
  let wantContinue = Boolean(
    existingSnap &&
      (opts.continueGoal === true || isContinueGoalPhrase(objective)),
  )
  // Only runners that declare continueGoal may resume DoD/missing. External
  // CLI declares this capability because runDispatch turns the snapshot into
  // an explicit prompt contract; it does not claim builtin DoD validation.
  const intendedRunner = opts.runner || existing?.runner || 'builtin'
  let continueBlockedNote: string | undefined
  if (wantContinue) {
    if (!capabilitiesForRunner(intendedRunner).continueGoal) {
      wantContinue = false
      continueBlockedNote =
        '目前 runner 為外部 CLI（或不支援 continueGoal）。「補齊缺口繼續」僅適用內建引擎；已改為一般任務執行。請切換 runner 為 builtin 後再試，或重新描述任務。'
    } else {
      // Freshness gate (hermes auto-continue lesson): a stale snapshot would
      // replay corrective work against a world that already moved on. Past
      // the window the run degrades to a fresh parse instead of zombie-resuming.
      const snapshotAgeMs = existingSnap?.at ? Date.now() - Date.parse(existingSnap.at) : NaN
      const freshWindowMs = clampContinueFreshnessMs(undefined)
      if (!isSnapshotFresh({ at: existingSnap?.at })) {
        wantContinue = false
        const staleMinutes = Number.isFinite(snapshotAgeMs)
          ? Math.max(1, Math.round(snapshotAgeMs / 60_000))
          : 0
        continueBlockedNote = Number.isFinite(snapshotAgeMs)
          ? `先前的 Goal 快照已過期（超過 ${Math.round(freshWindowMs / 60_000)} 分鐘窗口，距今約 ${staleMinutes} 分鐘）。為避免在過期狀態上殭屍續跑，已改為重新解析任務；如需保留原 DoD，請重新貼上目標與缺口。`
          : '先前的 Goal 快照缺少時間戳，無法證明新鮮度；已改為重新解析任務。如需保留原 DoD，請重新貼上目標與缺口。'
      }
    }
  }
  const continueSnap = wantContinue ? existingSnap : undefined

  // Conversation default: omit loopType → auto classify (Chat-lite / Goal).
  // Continue-goal forces Goal-based; automation / UI pin still force.
  const forcedLoopType = continueSnap
    ? ('Goal-based' as LoopType)
    : opts.loopType
  const loopTypeMode: 'force' | 'auto' = forcedLoopType ? 'force' : 'auto'
  // Auto mode must actually classify. The heuristic parser is the only owner
  // of that decision (Chat-lite → Turn-based, otherwise Goal-based); without
  // it every "自動" message silently ran the Goal pipeline. Classification
  // applies to interactive conversation only — automation sources without an
  // explicit pin keep the Goal-based default. The classified result feeds run
  // config but never pins the thread: the thread stays auto per message.
  const effectiveLoopType: LoopType | undefined = forcedLoopType
    ? forcedLoopType
    : objective.trim() && isInteractiveConversationSource(opts)
      ? classifyLoopType(objective)
      : undefined

  // Coordinator owns thread bind once after capacity is reserved.
  const { threadId: tid } = await bindRunThread({
    runId,
    objective,
    title: opts.title,
    reuseThreadId: opts.reuseThreadId,
    runner: opts.runner,
    loopType: forcedLoopType || null,
    hidden: opts.workerThread === true,
    projectRoot: attachmentProjectRoot,
  })
  boundThreadId = tid
  recordRunStarted({ runId, threadId: tid })
  // The coordinator is the lifecycle owner for the shared in-chat surfaces.
  // Adapters may still mirror activity for compatibility, but they must not
  // decide when the visible run is terminal.
  try {
    const { useRunActivityStore } = await import('../store/runActivityStore.ts')
    useRunActivityStore.getState().begin(runId, tid)
    useRunActivityStore.getState().setStatus('啟動中…', runId)
  } catch {
    /* renderer activity is optional for headless / recovery paths */
  }
  if (!opts.skipUserBubble) {
    thr.pushBubble(tid, 'user', objective, attachments)
  }
  if (continueBlockedNote) {
    thr.pushBubble(tid, 'system', continueBlockedNote)
  }
  if (continueSnap) {
    thr.pushBubble(
      tid,
      'system',
      `▶ 補齊缺口繼續 · DoD 保留 · 缺口 ${continueSnap.missing.length || 0} 項`,
    )
  }
  if (opts.sourceLabel && !opts.skipUserBubble) {
    thr.pushBubble(tid, 'system', opts.sourceLabel)
  } else if (opts.sourceLabel && opts._fromQueue) {
    thr.pushBubble(tid, 'system', opts.sourceLabel)
  }
  if (opts.extraContext?.trim() && !opts.skipUserBubble) {
    thr.pushBubble(
      tid,
      'system',
      `事件內容（節錄）\n${opts.extraContext.trim().slice(0, 2000)}`,
    )
  }
  if (opts.projectRoot?.trim() && !opts.skipUserBubble) {
    thr.pushBubble(tid, 'system', `專案綁定：${opts.projectRoot.trim()}`)
  }

  const boundThread = useThreadStore.getState().threads.find((thread) => thread.id === tid)
  const admittedSettings = resolveRunSettingsOverrides(settings, {
    model: opts.overrides?.model || boundThread?.model || undefined,
    thinkingDepth: opts.overrides?.thinkingDepth || boundThread?.thinkingDepth,
    speed: opts.overrides?.speed || boundThread?.speed,
    approvalMode: opts.overrides?.approvalMode,
    temporary: opts.overrides?.temporary,
    project: opts.projectRoot?.trim() || opts.overrides?.projectRoot,
  })
  const temporary = admittedSettings.temporary === true

  const sourceIsAutomation = isAutomationSource(opts)

  const planBubbleMetadata = resolvePlanBubbleMetadata({
    mode: loopTypeMode,
    sourceKind: opts.sourceKind || opts.overrides?.sourceKind,
    triggerSource: opts.overrides?.triggerSource,
    sourceLabel: opts.sourceLabel,
    classificationReason: opts.overrides?.classificationReason,
    loopType: forcedLoopType,
    continueGoal: Boolean(continueSnap),
  })

  // Builtin vision needs dataUrls; CLI receives the persisted filePath and
  // must not be hydrated back into dataUrl before its own file-path adapter.
  const boundRunner =
    opts.runner || thr.threads.find((thread) => thread.id === tid)?.runner || 'builtin'
  if (boundRunner === 'builtin') {
    attachments = await prepareRunAttachments(attachments, {
      projectRoot: attachmentProjectRoot,
      sessionId: attachmentSessionId || tid,
      phase: 'hydrate',
    })
  }

  // A conversation that forgets everything between runs makes the user repeat
  // themselves. The last few digests from this thread ride in as background,
  // never as instructions that could outrank the request being made now.
  const priorContext = await loadThreadPriorContext(tid, opts.projectRoot?.trim() || opts.overrides?.projectRoot)

  const extraSystem = [
    opts.overrides?.extraSystemContext,
    priorContext,
    opts.extraContext?.trim()
      ? `## External event / channel context\n${opts.extraContext.trim().slice(0, 12_000)}`
      : '',
  ]
    .filter(Boolean)
    .join('\n\n')

  // Pure "繼續" has no extra hint; "補齊價格欄" keeps the phrase as corrective hint.
  const pureContinue =
    /^(繼續|接著做?|再試|重試|continue|retry|keep going)\s*[!！.。…]*$/i.test(
      objective.trim(),
    )
  const continueHint =
    opts.continueHint ||
    (continueSnap && !pureContinue && objective.trim() !== continueSnap.objective.trim()
      ? objective.trim()
      : undefined)

  // When resuming, engine objective is the original goal (not the "繼續" phrase)
  const dispatchObjective = continueSnap ? continueSnap.objective : objective

  // Admission owns the patience budget: one decision per run, inherited by
  // every ingress, instead of each caller inventing its own deadline.
  const admittedTurnTimeoutMs = resolveTurnTimeout({
    runner: (opts.runner || thr.threads.find((thread) => thread.id === tid)?.runner || 'builtin') === 'builtin'
      ? 'builtin'
      : 'external',
    pattern: (forcedLoopType || 'Turn-based') as Parameters<typeof resolveTurnTimeout>[0]['pattern'],
    settingsTimeoutMs: settings.turnTimeoutMs,
    threadTimeoutMs: thr.threads.find((thread) => thread.id === tid)?.turnTimeoutMs,
    runTimeoutMs: opts.overrides?.turnTimeoutMs,
    unattended: opts.overrides?.unattended ?? sourceIsAutomation,
  })

  const overrides: RuntimeOverrides = {
    ...admittedSettings,
    ...(opts.overrides || {}),
    turnTimeoutMs: admittedTurnTimeoutMs,
    runId,
    sourceKind: opts.sourceKind || opts.overrides?.sourceKind,
    triggerSource: planBubbleMetadata.triggerSource,
    classificationReason: planBubbleMetadata.classificationReason,
    scheduleTrigger,
    eventTrigger,
    agentMode:
      opts.overrides?.agentMode ||
      thr.threads.find((thread) => thread.id === tid)?.agentMode ||
      'build',
    eventPreMatched: Boolean(eventTrigger),
    attachedSkills:
      opts.attachedSkills || opts.overrides?.attachedSkills || undefined,
    temporary,
    contextPolicySnapshot: admittedSettings.contextPolicySnapshot,
    unattended: opts.overrides?.unattended ?? sourceIsAutomation,
    hitlTimeoutMs: opts.overrides?.hitlTimeoutMs,
    projectRoot: opts.projectRoot?.trim() || opts.overrides?.projectRoot,
    extraSystemContext: extraSystem || undefined,
    userAttachments: attachments?.length
      ? attachments
      : opts.overrides?.userAttachments,
    loopTypeMode,
    forceLoopType: effectiveLoopType,
    threadId: tid,
    continueGoal: continueSnap
      ? {
          objective: continueSnap.objective,
          definitionOfDone: continueSnap.definitionOfDone,
          loopType: continueSnap.loopType || 'Goal-based',
          steps: continueSnap.steps,
          missing: continueSnap.missing,
          priorDigest: continueSnap.priorDigest,
          userHint: continueHint,
        }
      : opts.overrides?.continueGoal,
    externalCliContract:
      opts.overrides?.externalCliContract ||
      (continueSnap && intendedRunner !== 'builtin'
        ? buildExternalCliDelegateContract({
            role: 'orchestrator',
            unattended: opts.overrides?.unattended ?? sourceIsAutomation,
            continueGoal: {
              objective: continueSnap.objective,
              definitionOfDone: continueSnap.definitionOfDone,
              missing: continueSnap.missing,
              priorDigest: continueSnap.priorDigest,
              projectRoot: opts.projectRoot?.trim() || opts.overrides?.projectRoot,
              approvalMode: opts.overrides?.approvalMode || settings.approvalMode,
              userHint: continueHint,
            },
          })
        : undefined),
  }

  // Freeze the conversation's effective workspace before hooks or outbound
  // isolation can alter later execution paths. Settlement and recovery receive
  // this same Host-authored object; renderer code never derives Git identity.
  if (!overrides.projectRoot) {
    const boundRoot = useThreadStore.getState().threads.find((thread) => thread.id === tid)?.projectRoot
    overrides.projectRoot =
      opts.projectRoot?.trim() ||
      boundRoot?.trim() ||
      (await import('../store/projectStore.ts')).useProjectStore.getState().root ||
      undefined
  }
  if (overrides.projectRoot) useThreadStore.getState().setThreadProject(tid, overrides.projectRoot)
  reviewAdmission = await admitRunReviewWorkspace({
    runId,
    threadId: tid,
    projectRoot: overrides.projectRoot,
    runnerKind: reviewRunnerKind(intendedRunner),
  })

  // Coordinator owns beforeRun once: deny / append-context / log / notify
  const beforeRun = await evaluateBeforeRunHooks({
    settings,
    sourceKind: opts.sourceKind,
    objective,
    threadId: tid,
    runId,
    projectRoot: opts.projectRoot?.trim() || opts.overrides?.projectRoot,
  })
  if (!beforeRun.ok) {
    // Finalization owns afterRun / Archive / onSettled / release / drain once.
    return finalizeTaskRun({
      runId,
      threadId: tid,
      objective,
      sourceKind: opts.sourceKind,
      projectRoot: opts.projectRoot,
      settings,
      reviewAdmission,
      onSettled: opts.onSettled,
      early: {
        error: `執行被 hook 政策拒絕：${beforeRun.denyReason}`,
      },
    })
  }
  if (beforeRun.appendTexts.length) {
    overrides.extraSystemContext = [
      overrides.extraSystemContext,
      ...beforeRun.appendTexts.map((t) => `## Hook context\n${t}`),
    ]
      .filter(Boolean)
      .join('\n\n')
  }

  // Phase 4 / R7: count user-initiated chat turns only (not success, not automation).
  // Queued items keep their original sourceKind; count once when the run actually admits.
  const userChatTurn =
    opts.sourceKind === 'composer' ||
    opts.sourceKind === 'slash' ||
    opts.sourceKind === 'retry'
  if (userChatTurn && !temporary) {
    try {
      const { learningLoop } = await import('./hermes/learning.ts')
      learningLoop.onUserTurn()
    } catch {
      /* non-fatal */
    }
    // G7 userTurn hook 事件(被動:log / notify)
    try {
      const { collectHookRules, evaluateHooks } = await import('./hooks.ts')
      const ev = evaluateHooks(collectHookRules(settings), {
        point: 'userTurn',
        sourceKind: opts.sourceKind,
        objective,
      })
      for (const line of ev.audits) thr.pushBubble(tid, 'system', line)
      for (const n of ev.notifications) {
        void window.subagents?.notify?.('AgentStudio · Hook', n.slice(0, 160))
      }
    } catch {
      /* non-fatal */
    }
  }

  // Migration is an admission precondition, not a Settings-page side effect.
  // Existing users therefore cannot run once with silently missing legacy
  // personalization merely because they have not opened Personalization yet.
  await ensureHostInstructionMigration(settings)

  // External adapters do not enter Pi's Host-owned turn admission. Resolve at
  // this same canonical Task-run admission point and disclose the actual
  // delivery mode. Codex/Claude keep native filesystem discovery, so only the
  // DB-owned global portion is wrapped explicitly and project text is not
  // duplicated.
  await admitTaskInstructions({
    runner: intendedRunner,
    projectRoot: overrides.projectRoot,
    overrides,
    notice: (text) => thr.pushBubble(tid, 'system', text),
  })

  // Outbound Data Gate: when protection is active, pin tools to a provider-specific
  // Sanitized Workspace (Restricted Project View) created in Electron main.
  // Ticket 17: required fails closed on missing root / prepare / policy (pure admission).
  try {
    const {
      effectiveOutboundGuardFromSettings,
      isProtectionActive,
      decideRestrictedViewAdmission,
    } = await import('./outbound/outboundGate.ts')
    const mode = effectiveOutboundGuardFromSettings(settings)
    // ADR-0047: the builtin shell is gated Host-side, from THIS run's posture.
    // Pinning it here — not in buildRunContextPolicy — keeps one derivation of
    // the mode shared with the Restricted View admission below.
    const basePolicy = overrides.contextPolicySnapshot
      ?? buildRunContextPolicy(settings, { model: overrides.model, temporary, project: overrides.projectRoot })
    // The HITL timeout this run resolved travels to the Host with the rest of
    // the frozen policy; without it the Host could only use its own defaults.
    const admittedPolicy = overrides.hitlTimeoutMs && !basePolicy.approvalTimeoutMs
      ? { ...basePolicy, approvalTimeoutMs: overrides.hitlTimeoutMs }
      : basePolicy
    overrides.contextPolicySnapshot = withRunShellPolicy(admittedPolicy, { effectiveMode: mode })
    if (isProtectionActive(mode)) {
      const bridgeAvailable = typeof window.subagents?.outbound?.prepareRunView === 'function'
      const projectRoot = (overrides.projectRoot || '').trim()

      type PrepOk = {
        ok: true
        viewRoot: string
        exclusionCount: number
        skippedCount: number
        connectionId: string
        profileDegraded?: boolean
      }
      let prepare: PrepOk | { ok: false; reason: string } | null = null
      if (bridgeAvailable && projectRoot) {
        const prep = await window.subagents!.outbound!.prepareRunView!({
          runId,
          projectRoot,
          apiProvider: settings.apiProvider,
          baseUrl: settings.baseUrl,
          effectiveMode: mode,
          // Settings → company classifier. Without these the endpoint the user
          // configured was never contacted on the real outbound path.
          ...(settings.classificationEndpointUrl?.trim()
            ? { classificationEndpointUrl: settings.classificationEndpointUrl.trim() }
            : {}),
          ...(settings.classificationAllowPlaintextHttp === true
            ? { classificationAllowPlaintextHttp: true }
            : {}),
        })
        prepare = prep.ok
          ? {
              ok: true,
              viewRoot: prep.viewRoot,
              exclusionCount: prep.exclusionCount,
              skippedCount: prep.skippedCount,
              connectionId: prep.connectionId,
              profileDegraded: prep.profileDegraded,
            }
          : { ok: false, reason: prep.reason }
      }

      const admission = decideRestrictedViewAdmission({
        effectiveMode: mode,
        projectRoot,
        prepare:
          prepare == null
            ? null
            : prepare.ok
              ? { ok: true, viewRoot: prepare.viewRoot }
              : { ok: false, reason: prepare.reason },
        bridgeAvailable,
      })

      if (admission.action === 'block') {
        return finalizeTaskRun({
          runId,
          threadId: tid,
          objective,
          sourceKind: opts.sourceKind,
          projectRoot: opts.projectRoot,
          settings,
          reviewAdmission,
          onSettled: opts.onSettled,
          early: {
            error: `出站資料閘門：${admission.reason}`,
          },
        })
      }
      if (admission.action === 'use-view' && prepare && prepare.ok) {
        overrides.projectRoot = admission.viewRoot
        // The shell gate refuses absolute paths escaping this view, and under
        // `required` refuses entirely until isolation is proven main-side.
        overrides.contextPolicySnapshot = withRunShellPolicy(admittedPolicy, {
          effectiveMode: mode,
          viewRoot: admission.viewRoot,
          connectionId: prepare.connectionId,
        })
        // Ticket 18: pin local view root so tools resolve via single truth
        // even when a call site omits explicit projectRoot (main remains owner).
        try {
          const { pinRestrictedViewRootForRun } = await import(
            './outbound/sanitizedWorkspace.ts'
          )
          pinRestrictedViewRootForRun(runId, admission.viewRoot)
        } catch {
          /* ignore */
        }
        const deg = prepare.profileDegraded ? ' · profile=baseline-degraded' : ''
        thr.pushBubble(
          tid,
          'system',
          `出站資料閘門：Restricted Project View 已建立（exclusions=${prepare.exclusionCount} · skipped=${prepare.skippedCount} · connection=${prepare.connectionId}${deg}）`,
        )
        // Main prepareOutboundRunView appends the restricted-view evidence.
      } else if (admission.action === 'continue-degraded') {
        thr.pushBubble(
          tid,
          'system',
          `出站資料閘門：${admission.reason}；繼續但 isolation 未驗證（degraded）`,
        )
      }
    }
  } catch (e) {
    // Ticket 17: under required, unexpected errors must not soft-continue to original project.
    try {
      const { effectiveOutboundGuardFromSettings } = await import('./outbound/outboundGate.ts')
      const mode = effectiveOutboundGuardFromSettings(settings)
      if (mode === 'required') {
        return finalizeTaskRun({
          runId,
          threadId: tid,
          objective,
          sourceKind: opts.sourceKind,
          projectRoot: opts.projectRoot,
          settings,
          reviewAdmission,
          onSettled: opts.onSettled,
          early: {
            error: `出站資料閘門：受控視圖準備例外（${e instanceof Error ? e.message : String(e)}）`,
          },
        })
      }
    } catch {
      /* ignore nested */
    }
  }

  const snapshot = buildRunDispatchSnapshot({
    runId,
    threadId: tid,
    objective: dispatchObjective,
    runner: opts.runner,
    forceLoopType: forcedLoopType,
    attachments,
    settings,
    overrides,
    reviewAdmission,
  })

  const result = await dispatchThreadTask(snapshot)
  return finalizeTaskRun({
    runId,
    threadId: tid,
    objective,
    sourceKind: opts.sourceKind,
    projectRoot: snapshot.overrides.projectRoot || opts.projectRoot,
    settings,
    reviewAdmission: snapshot.reviewAdmission,
    dispatchResult: result,
    onSettled: opts.onSettled,
  })
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    const earlyAgent = useAgentStore.getState().getRunState(runId) || undefined
    return finalizeTaskRun({
      runId,
      // A failed bind has no thread to mutate; the runId is a harmless
      // sentinel while Archive/onSettled/release/drain still complete.
      threadId: boundThreadId || runId,
      objective,
      sourceKind: opts.sourceKind,
      projectRoot: opts.projectRoot,
      settings,
      reviewAdmission,
      onSettled: opts.onSettled,
      early: {
        error: `執行失敗：${msg}`,
        path: reserveKind,
        agent: earlyAgent,
      },
    })
  }
}

/** Canonical API for new code. */
export async function runTask(input: TaskRunInput): Promise<TaskRunResult> {
  // Every renderer ingress (composer, scheduler, gateway, webhook, and
  // background delegates) waits behind the one-shot storage/journal recovery.
  // Node-only contract smokes have no renderer lifecycle and continue directly.
  // Renderer/Electron lifecycle recovery has no owner in a plain Node seam.
  // The document check keeps headless runs from waiting on a renderer-only
  // startup barrier while preserving recovery ordering in the product.
  if (typeof window !== 'undefined' && typeof document !== 'undefined') {
    await waitForStartupRecovery()
  }
  const normalized = applyComposerApprovalHandoff(normalizeTaskRunInput(input))
  const runId = normalized.runId || `run_${uuid().slice(0, 12)}`
  // An explicit runId is the caller's durable submission identity. Once its
  // terminal journal fact exists, a delayed transport/UI replay must not pass
  // admission again. Legitimate continuation creates a fresh runId and binds
  // the prior identity through overrides.resumeFromRunId instead.
  if (normalized.runId && hasJournalledEnding(runId)) {
    return {
      path: 'builtin',
      status: 'skipped',
      error: `runId ${runId} 已完成生命週期，略過重送。`,
      threadId: normalized.reuseThreadId || null,
      runId,
      skipped: true,
      skipReason: 'duplicate',
    }
  }
  if (coordinatingRunIds.has(runId)) {
    return {
      path: 'builtin',
      status: 'skipped',
      error: `runId ${runId} 已在執行中，略過重入。`,
      threadId: normalized.reuseThreadId || null,
      runId,
      skipped: true,
      skipReason: 'duplicate',
    }
  }
  coordinatingRunIds.add(runId)
  try {
    return await coordinateTaskRun({ ...normalized, runId })
  } finally {
    coordinatingRunIds.delete(runId)
  }
}

/**
 * Fork/rerun from a persisted user checkpoint through the canonical
 * coordinator. Only the user request is replayed; prior tool calls and side
 * effects are never replayed, and the fork starts with clean capability/DoD
 * state (enforced by forkThreadFromCheckpoint).
 */
export async function rerunFromReplaySafeCheckpoint(input: {
  sourceThreadId: string
  checkpointBubbleId?: string
  runner?: ThreadRunner
  continueHint?: string
}): Promise<TaskRunResult> {
  const { useThreadStore } = await import('../store/threadStore.ts')
  const store = useThreadStore.getState()
  const source = store.threads.find((thread) => thread.id === input.sourceThreadId)
  const checkpoint = source ? findReplaySafeCheckpoint(source, input.checkpointBubbleId) : null
  if (!source || !checkpoint) {
    return {
      path: 'builtin',
      status: 'skipped',
      error: '找不到可重播的 user checkpoint；工具執行結果與 side effect 不可直接 replay。',
      threadId: input.sourceThreadId,
      skipped: true,
      skipReason: 'replay-unsafe',
    }
  }
  const forkedId = store.forkThreadFromCheckpoint(source.id, checkpoint.bubbleId)
  if (!forkedId) {
    return {
      path: 'builtin',
      status: 'skipped',
      error: '建立 replay-safe 分支失敗。',
      threadId: source.id,
      skipped: true,
      skipReason: 'fork-failed',
    }
  }
  return runTask({
    sourceKind: 'retry',
    objective: checkpoint.objective,
    title: `重跑 · ${source.title}`,
    runner: input.runner || source.runner,
    loopType: source.loopType || undefined,
    reuseThreadId: forkedId,
    attachments: checkpoint.attachments,
    sourceLabel: `Replay-safe checkpoint · ${checkpoint.bubbleId}`,
    continueHint: input.continueHint,
  })
}

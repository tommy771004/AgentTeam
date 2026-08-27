import { dirname, isAbsolute, relative, resolve } from 'node:path'
import { existsSync, realpathSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { clampPiIterations } from '../src/agent/loopBounds.ts'
import type { SubscriptionProviderCatalog } from '../src/agent/subscriptionCatalog.ts'
import type { MemoryStorageHealth } from './memoryStorageLifecycle.ts'
import { normalizePiHostPendingApproval, PiHostAttachmentJournal, PI_HOST_ATTACHMENT_PAGE_LIMIT, type PiHostAttachment, type PiHostAttachmentPage, type PiHostFinalizationClaimResult, type PiHostFinalizationCompleteResult } from './piHostAttachment.ts'
import type { RunLearningFinalOutcome } from '../src/agent/runLearningSettlement.ts'

/**
 * Version 2 retired the ambiguous `success` turn settlement for the closed
 * union (`answered` / `empty` / …) and added the Turn Record to a session, so a
 * version-1 peer would both misread a settlement and miss the record entirely.
 * Version 3 added the attachment contract. Version 4 (ADR-0052) exposes the
 * fail-closed subscription catalog in snapshot config; it is additive, so v3
 * and v2 peers stay readable and only v1 is refused.
 * memory-store-v1 is additive on v4 and must be capability-negotiated;
 * legacy peers continue to use the existing memory/* JSON-backed methods.
 */
export const PI_HOST_PROTOCOL_VERSION = 4 as const
export const PI_HOST_CAPABILITIES = ['health', 'settings', 'sessions', 'turns', 'runtime', 'tools', 'tool-contract-v1', 'attachments-v1', 'events', 'automation', 'resources', 'memory', 'memory-store-v1', 'capabilities'] as const

export type PiHostCapability = (typeof PI_HOST_CAPABILITIES)[number]

/** Non-secret provenance exposed to the renderer so users can verify bootstrap behavior. */
export type PiHostConfigStatus = {
  settingsSource: 'native' | 'managed' | 'default'
  settingsLoaded: boolean
  oauthSources: Array<'codex-cli' | 'claude-cli'>
  oauthImportedProviders: string[]
  oauthSkippedProviders: string[]
  oauthConflicts: string[]
  /** Fail-closed selectable-subscription rows; availability metadata only. */
  subscriptionCatalog?: readonly SubscriptionProviderCatalog[]
  /** True when the rows above are the last-good cache, not this boot's build. */
  subscriptionCatalogStale?: boolean
  /** When the published catalog was built (cache keeps its ORIGINAL build time). */
  subscriptionCatalogCachedAt?: number
}

export type PiHostRequest = {
  id: string | number
  method: 'initialize' | 'health/get' | 'lifecycle/shutdown' | 'runtime/status' | 'tools/list' | 'tools/contract' | 'tools/read' | 'tools/grep' | 'tools/find' | 'tools/ls' | 'tools/write' | 'tools/edit' | 'tools/bash' | 'tools/code' | 'tools/mcp' | 'tools/pack' | 'approvals/resolve' | 'state/snapshot' | 'settings/get' | 'settings/update' | 'settings/profile' | 'resources/list' | 'resources/reload' | 'resources/sync-skills' | 'resources/read-skill-files' | 'memory/list' | 'memory/add' | 'memory/delete' | 'memory/clear' | 'memory/recall' | 'memory/v1/upsert' | 'memory/v1/append' | 'memory/v1/get' | 'memory/v1/list' | 'memory/v1/recall' | 'memory/v1/delete' | 'memory/v1/clear' | 'memory/v1/delete-entry' | 'memory/v1/clear-project' | 'memory/v1/clear-global' | 'memory/v1/clear-all' | 'memory/v1/deletion-capability' | 'memory/v1/consolidate-dream' | 'memory/v1/export' | 'memory/v1/import-preview' | 'memory/v1/import-apply' | 'capabilities/list' | 'capabilities/load' | 'capabilities/search' | 'extensions/list' | 'extensions/install' | 'extensions/update' | 'extensions/reload' | 'extensions/set-enabled' | 'extensions/uninstall' | 'sessions/create' | 'sessions/list' | 'sessions/fork' | 'sessions/reset' | 'sessions/archive' | 'sessions/compact' | 'sessions/record' | 'runs/enqueue' | 'runs/claim' | 'runs/settle' | 'runs/list' | 'runs/cancel' | 'runs/active' | 'runs/attach' | 'runs/finalize-claim' | 'runs/finalize-complete' | 'runs/ack' | 'turn/submit' | 'turn/cancel' | 'turn/interrupt'
  params: Record<string, unknown>
}

export type PiHostResponse = {
  id: string | number
  result?: {
    protocolVersion?: number
    capabilities?: PiHostCapability[]
    status?: 'ready'
    memoryHealth?: MemoryStorageHealth
    cursor?: number
    sessions?: unknown[]
    settings?: PiSettings
    config?: PiHostConfigStatus
    profile?: PiSettings
    sessionId?: string
    runId?: string
    /**
     * Three vocabularies still share this one field: a turn settlement, a tool
     * execution settlement (`success`), and an approval settlement (`denied`).
     * They are kept apart by the method that produced the response; the turn
     * side is re-validated with `isPiTurnSettlement` before any consumer trusts
     * it as a settled turn.
     */
    settlement?: PiTurnSettlement | 'success' | 'denied'
    /** Why an `interrupted` settlement stopped short; absent for other settlements. */
    interruptReason?: PiTurnInterruptReason
    page?: import('../src/agent/turnRecord.ts').TurnRecordPage | PiHostAttachmentPage
    items?: unknown[]
    /** The entries this turn appended to the session's Turn Record. */
    record?: TurnRecord
    /** Latest canonical Working State for the admitted builtin Task run. */
    workingState?: WorkingState
    contractRevision?: number
    contractDigest?: string
    contract?: PiTurnToolContract
    contractTool?: import('./piToolContract.ts').PiTurnToolContractTool
    revisionStatus?: 'current' | 'historical'
    queue?: PiQueuedRun[]
    run?: PiQueuedRun
    resources?: PiResource[]
    /** The Host's tool catalog projection: builtins, packs, and MCP in one list. */
    catalog?: PiCatalogEntry[]
    catalogContractRevision?: number
    catalogContractDigest?: string
    diagnostics?: Array<{ path: string; message?: unknown }>
    report?: { skillsDir?: string; results?: PiSkillSyncResult[] }
    /** The Host skills directory projected back out for renderer hydration (resources/read-skill-files). */
    files?: Array<{ path: string; raw: string }>
    resolved?: boolean
    /** Structured payload of one tool execution (tools/pack). */
    item?: unknown
    memories?: PiMemory[]
    memoryStore?: import('./durableMemoryStore.ts').DurableMemoryProtocolResult
    tool?: string
    code?: string
    content?: Array<{ type: string; text?: string; data?: string; mimeType?: string }>
    loaded?: boolean
    package?: string
    version?: string
    builtinTools?: string[]
    orchestration?: { pattern: PiLoopPattern; iterations: number; maxIterations: number; definitionOfDone?: string; dodMet?: boolean }
    queued?: 'steer' | 'queue'
    extension?: PiExtension
    extensions?: PiExtension[]
    removed?: boolean
    pluginExecution?: SubDesignPluginExecutionProjection
    attachments?: PiHostAttachment[]
    attachment?: PiHostAttachment
    activeRuns?: PiHostAttachment[]
    terminalRuns?: PiHostAttachment[]
    finalizationClaim?: PiHostFinalizationClaimResult
    finalizationComplete?: PiHostFinalizationCompleteResult
    learningSettlement?: PiRunLearningSettlement
    availableFromSeq?: number
    total?: number
    latestSeq?: number
    gap?: { missingBefore: number; earliestSeq: number }
  }
  error?: {
    code: 'invalid_request' | 'protocol_mismatch' | 'not_initialized' | 'unknown_method' | 'runtime_error' | 'forbidden' | 'quota_exceeded' | 'not_found' | 'unavailable' | 'closed' | 'invalid_bundle' | 'tool_contract_not_found' | 'tool_contract_unknown_tool' | 'tool_contract_stale' | 'tool_contract_session_mismatch' | 'tool_contract_inactive'
    message: string
  }
}

export type PiHostEvent =
  | {
      event: 'host/storage-health'
      payload: Extract<MemoryStorageHealth, { status: 'degraded' }>
    }
  | {
      event: 'host/ready'
      payload: { protocolVersion: number; capabilities: PiHostCapability[] }
    }
  | {
      event: 'host/turn-item'
      payload: { runId: string; sessionId: string; item: unknown; iteration?: number }
    }
  | {
      /**
       * One entry the running turn just wrote to its Turn Record, carrying the
       * exact `seq` the commit will give it.
       *
       * The live timeline is projected from these, by the same pure function
       * that projects a replayed page — so what the user watches happen and
       * what they read back afterwards cannot come out in different orders.
       * `host/turn-item` stays what it always was: a transport-level stream,
       * and the fallback for runners that keep no record at all.
       */
      event: 'host/record-append'
      payload: { runId: string; sessionId: string; entries: TurnRecordEntry[] }
    }
  | {
      event: 'host/tool-update'
      payload: { runId: string; tool: string; item: unknown; callId?: string }
    }
  | {
      event: 'host/tool-start' | 'host/tool-decision' | 'host/tool-result'
      payload: { runId: string; tool: string; callId?: string; parentRunId?: string; decision?: 'allow' | 'ask' | 'deny'; settlement?: 'success' | 'failed' | 'cancelled' | 'denied'; reason?: string; item?: unknown; executionEvidence?: WorkingExecutionEvidence; contractRevision?: number; contractDigest?: string; schemaDigest?: string; toolSource?: 'builtin' | 'extension-pack' | 'mcp'; toolPack?: string; invocationOrigin?: PiInvocationOrigin }
    }
  | {
      event: 'host/orchestration'
      payload: { runId: string; sessionId: string; phase: 'parse' | 'iterate' | 'dod' | 'replan' | 'settlement' | 'cancelled'; iteration?: number; pattern?: PiLoopPattern; detail?: string }
    }
  | {
      event: 'memory/changed'
      payload: {
        version: 1
        revision: number
        operation: 'upsert' | 'append' | 'delete' | 'clear' | 'delete-entry' | 'clear-project' | 'clear-global' | 'clear-all' | 'consolidate-dream' | 'import'
        changed: number
        scope: 'global' | 'project' | 'all'
        project?: string
        logicalKey: string
      }
    }
  | {
      event: 'host/context'
      payload: {
        runId: string
        sessionId: string
        phase: 'memory-recalled' | 'memory-written' | 'compacted' | 'model-switched' | 'skills-unavailable'
        recalled?: number
        written?: number
        previousModel?: string
        model?: string
        provider?: string
        contextWindowTokens?: number
        reason?: CompactionReason
        replacedMessages?: number
        remainingMessages?: number
        summaryChars?: number
        estimatedTokens?: number
        checkpointed?: boolean
        operation?: 'set' | 'append'
        logicalKey?: string
        scope?: 'project'
        revision?: number
        callId?: string
      }
    }
  | {
      event: 'host/pipeline-stage'
      payload: { runId: string; sessionId: string; stageId: string; providerId: string; state: 'queued' | 'running' | 'completed' | 'failed' | 'blocked' | 'cancelled'; summary: string; at: string }
    }
  | {
      event: 'host/pipeline-stream'
      payload: { runId: string; sessionId: string; stageId: string; providerId: string; update: StreamingUpdate }
    }
  | {
      /** update_plan drove the visible plan panel; steps are the full state. */
      event: 'host/plan-updated'
      payload: { sessionId: string; runId?: string; steps: Array<{ id: string; title: string; status: string }> }
    }
  | {
      event: 'host/approval-requested'
      payload: { runId: string; sessionId: string; tool: string; callId: string; args?: Record<string, unknown>; reason?: string; timeoutMs: number }
    }
  | {
      event: 'host/extension'
      payload: { action: 'installed' | 'updated' | 'enabled' | 'disabled' | 'uninstalled'; extension: PiExtension }
    }

export type PiHostMessage = PiHostResponse | PiHostEvent

import { compileEffectiveAgentProfile, validatePiSettingsPatch, DEFAULT_PI_SETTINGS, type PiSettings } from './piAgentProfile.ts'
import type { StreamingUpdate } from '../src/agent/subdesign/streamingEnvelope.ts'
import { cancelPiTool, cancelPiTurn, compactPiSession, disposePiSession, executePiTool, forkPiSession, getPiSessionFile, interruptPiTurn, persistPiLegacyCredential, persistPiLegacyModelConfig, piCoreRuntimeStatus, piCoreRuntimeToolCatalog, piProviderDefaultBaseUrl, readPiLegacyProviderBaseUrl, runPiTurn, steerPiTurn, type PiBuiltinToolName, type PiTurnInterruptReason } from './piCoreRuntime.ts'
import { cancelPiCodeMode, runPiCodeMode } from './piCodeMode.ts'
import { armTurnDeadline, clampTurnTimeout, systemTurnDeadlineClock, type TurnDeadlineClock } from './piTurnDeadline.ts'
import { PiRunQueue, type PiQueuedRun } from './piRunQueue.ts'
import { PiResourceRegistry, type PiResource } from './piResourceRegistry.ts'
import { createPiChildSession, type PiContextPacket } from './piDelegationExtension.ts'
import type { PiMemory } from './piMemoryExtension.ts'
import { createPiDurableMemoryBridge, handleLegacyMemory, listPiMemories, piMemoryProjection, type PiMemoryChange } from './piDurableMemory.ts'
import type { PiMemoryWriteReceipt } from './piPackBridges.ts'
import {
  authorizeMemoryAccess,
  canonicalMemoryDraft,
  canonicalProjectId,
  DurableMemoryStoreError,
  InMemoryDurableMemoryStore,
  type DurableMemoryStore,
  type MemoryAccessContext,
  type MemoryAppendInput,
  type MemoryClearInput,
  type MemoryEntryDraft,
  type MemoryDreamConsolidateInput,
  type MemoryListInput,
  type MemoryScope,
} from './durableMemoryStore.ts'
import {
  assessPiContextPressure,
  buildPiCompactionManifest,
  buildPiTurnLearningCandidate,
  formatPiCompactionSummary,
  parsePiTurnContextPolicy,
  selectPiMemoryContext,
} from './piSessionContext.ts'
import { settlePiRunLearning, type PiRunLearningSettlement } from './piRunLearningSettlement.ts'
import { DEFAULT_PI_CAPABILITIES, PiCapabilityCatalog } from './piCapabilityExtension.ts'
import { runPiOrchestration, type PiLoopPattern } from './piOrchestrationExtension.ts'
import { decideBashAction } from '../src/agent/tools/shellCommandParser.ts'
import { PiExtensionRegistry, type PiExtension } from './piExtensionRegistry.ts'
import { callPiMcpTool, listPiMcpTools, piMcpGenerationKey, reloadPiMcp, stopPiMcp } from './piMcpClient.ts'
import { isCompletedModelCall, isPiHostDefinitionOfDoneMet, isPiTurnSettlement, piTurnFinalAnswer, piTurnResultText, type PiTurnSettlement } from '../src/agent/piHostRun.ts'
import { appendTurnRecord, asTurnRecordMemoryWrite, derivePiHistory, nextTurnRecordSeq, pageTurnRecord, workingStateFromTurnRecord, type PiRecordedMessage, type TurnRecord, type TurnRecordAppend, type TurnRecordDraft, type TurnRecordEntry, type TurnRecordToolContractIdentity } from '../src/agent/turnRecord.ts'
import {
  checkWorkingStateProposal,
  createInitialWorkingState,
  isWorkingGoalCompletionPredicate,
  type WorkingExecutionEvidence,
  type WorkingState,
  type WorkingStateProposal,
  type WorkingToolSettlement,
} from '../src/agent/workingState.ts'
import type { CompactionCheckpointSaveInput, CompactionManifest, CompactionReason } from '../src/agent/compactionCheckpoint.ts'
import { cancelSubDesignProviderRun, executeSubDesignProviderStage } from './subDesignProviderRuntime.ts'
import { shouldStopForProviderProjection, type SubDesignPluginExecutionProjection } from '../src/agent/subdesign/pluginExecution.ts'
import {
  cancelPiApprovalsForRun,
  consumePiDeniedInTurnCall,
  settlePiModelBuiltinInvocation,
  executePiPackTool,
  findPiPackTool,
  piPackCatalogEntries,
  resolvePiApproval,
  setPiApprovalBridge,
  unbindPiSessionRun,
  bindPiSessionRun,
  setPiPackSessionContractRefresh,
  setPiPolicyEvidenceBridge,
  piSessionRunBinding,
  requestPiToolApproval,
  type PiCatalogEntry,
} from './piToolHost.ts'
import { ensurePiPacksRegistered } from './piExtensionPacks/index.ts'
import {
  bindWorkspaceTextSearchRun,
  isWorkspaceTextSearchCapability,
  isWorkspaceTextSearchTool,
  unbindWorkspaceTextSearchRun,
  workspaceTextSearchAvailability,
} from './piWorkspaceTextSearchRuntime.ts'
import { configurePiMessagingGateway } from './piExtensionPacks/integrations.ts'
import { discoveredPiSkills, readPiSkillFiles, syncPiSkillsFromRenderer, type PiSkillSyncResult } from './piSkills.ts'
import { resolvePiAgentDir } from './piUserConfig.ts'
import { setPiDelegationBridge, setPiMemoryBridge } from './piPackBridges.ts'
import { setPiPlanAnnouncer as installPlanAnnouncer } from './piExtensionPacks/interactionPlanning.ts'
import { isPiMcpInputSchema, piMcpModelToolName, piMcpModelToolNames, setPiMcpExtensionsLookup } from './piExtensionPacks/mcpBridgePack.ts'
import { setPiCapabilityBridge, setPiCodeModeExecutor } from './piExtensionPacks/framework.ts'
import { PiToolContractStore, schemaDigest, type PiTurnToolContract } from './piToolContract.ts'
import { validatePiToolArguments } from './piToolArguments.ts'
import { writeToolOutputSpill } from './attachmentStore.ts'
import { revokeBuiltinShellSandboxEvidence, verifyBuiltinShellSandbox, type BuiltinShellSandboxVerification } from './piBuiltinShellSandbox.ts'
import {
  evaluatePiInvocationPolicy,
  freezePiRunPolicy,
  PiInvocationEvidence,
  type PiFrozenRunPolicy,
  type PiInvocationContractIdentity,
  type PiInvocationOrigin,
  type PiPolicyEvidenceEvent,
  type PiToolPolicyRequirements,
} from './piPolicyEvidence.ts'

type HostState = {
  initialized: boolean
  negotiatedProtocolVersion: number
  snapshot: { cursor: number; sessions: SessionRecord[]; settings: PiSettings; settingsOrigin?: 'native' | 'managed'; config?: PiHostConfigStatus; queue: PiQueuedRun[]; resources: PiResource[]; memories: PiMemory[]; extensions: PiExtension[]; attachments: PiHostAttachment[] }
  capabilities: PiCapabilityCatalog
  extensions: PiExtensionRegistry
  toolContracts: PiToolContractStore
  toolContractNegotiated: boolean
  memoryStoreNegotiated: boolean
  memoryStore: DurableMemoryStore
  publishedMemoryRevisions: Set<number>
  /**
   * The last catalog projection the Host published, by tool name (issue 19).
   *
   * A tool can be CATALOGUED without being in a turn's frozen contract — a
   * deferred capability's tools are the ordinary case. When the model calls one
   * anyway, the frozen contract has nothing to say about it, and the record
   * used to fall back to no identity at all. This is what the Host knew about
   * that tool when it last described the world.
   */
  catalogProjection: Map<string, PiCatalogEntry>
  attachmentJournal: PiHostAttachmentJournal
  shuttingDown: boolean
}

export type PiToolAuditRecord = {
  runId: string
  callId: string
  tool: string
  phase: 'start' | 'decision' | 'result'
  decision?: 'allow' | 'ask' | 'deny'
  settlement?: 'success' | 'failed' | 'cancelled' | 'denied'
  reason?: string
  path?: string
  at: number
}

type PreparedPiCompaction = {
  sourceHash: string
  summary: string
  manifest: CompactionManifest
  preparedAt: string
  estimatedTokens: number
  contextWindow: number
}

export type SessionRecord = { id: string; title: string; threadId?: string; parentSessionId?: string; role?: string; profile?: Record<string, unknown>; context?: PiContextPacket; depth?: number; messages: PiRecordedMessage[]; toolAudit?: PiToolAuditRecord[]; archived?: boolean; piSessionFile?: string; record?: TurnRecord; toolContracts?: PiTurnToolContract[]; toolContractRevisionFloor?: number; preparedCompaction?: PreparedPiCompaction }

function projectSessionSummary(session: SessionRecord) {
  const { record, toolContracts: _toolContracts, toolContractRevisionFloor: _toolContractRevisionFloor, ...summary } = session
  const workingState = workingStateFromTurnRecord(record)
  return {
    ...summary,
    messages: [...session.messages],
    ...(session.toolAudit ? { toolAudit: [...session.toolAudit] } : {}),
    ...(record ? { recordSummary: { version: record.version, entries: record.entries.length, latestSeq: record.entries.at(-1)?.seq ?? 0 } } : {}),
    ...(workingState ? { workingState } : {}),
  }
}

function workingStateForAdmittedTurn(
  session: SessionRecord,
  runId: string,
  objective: string,
  completionPredicate: unknown,
): WorkingState {
  return createInitialWorkingState({
    runId,
    objective,
    constraints: session.context?.constraints,
    ...(isWorkingGoalCompletionPredicate(completionPredicate) ? { completionPredicate } : {}),
  })
}

function requestedWorkingGoal(input: { params?: Record<string, unknown> }): unknown {
  return input.params?.workingGoal
}

function fileWriteStateProposal(
  state: WorkingState,
  tool: string,
  callId: string,
  args: unknown,
): WorkingStateProposal | undefined {
  const goal = state.goals.find((candidate) => candidate.status === 'pending' && candidate.completionPredicate?.kind === 'file-content')
  if (!goal || tool !== 'write' || !args || typeof args !== 'object') return undefined
  const values = args as Record<string, unknown>
  if (typeof values.path !== 'string' || !values.path || typeof values.content !== 'string') return undefined
  const modelEvidenceClaimed = Object.keys(values).some((key) => /^(evidence|evidenceId|attestation|issuedBy)$/i.test(key))
  return {
    schemaVersion: 1,
    proposalId: `proposal:${state.runId}:${callId}`,
    source: 'model',
    baseRevision: state.revision,
    runId: state.runId,
    goalId: goal.id,
    proposedStatus: 'done',
    tool,
    callId,
    file: {
      path: values.path,
      sha256: createHash('sha256').update(values.content).digest('hex'),
    },
    ...(modelEvidenceClaimed ? { modelEvidenceClaimed: true } : {}),
  }
}

function hostFileWriteEvidence(input: {
  state: WorkingState
  proposal: WorkingStateProposal
  identity: TurnRecordToolContractIdentity | undefined
  settlement: WorkingToolSettlement
  trustedResult: unknown
}): WorkingExecutionEvidence | undefined {
  if (input.settlement !== 'success'
    || input.proposal.tool !== 'write'
    || input.identity?.toolSource !== 'builtin'
    || typeof input.identity.contractDigest !== 'string'
    || typeof input.identity.schemaDigest !== 'string') return undefined
  const trustedResultDigest = createHash('sha256').update(JSON.stringify(input.trustedResult) || '').digest('hex')
  const receiptDigest = createHash('sha256').update(JSON.stringify({
    version: 1,
    runId: input.state.runId,
    goalId: input.proposal.goalId,
    tool: input.proposal.tool,
    callId: input.proposal.callId,
    contractDigest: input.identity.contractDigest,
    schemaDigest: input.identity.schemaDigest,
    resource: input.proposal.file,
    trustedResultDigest,
  })).digest('hex')
  return {
    schemaVersion: 1,
    evidenceId: `execution:${receiptDigest}`,
    runId: input.state.runId,
    goalId: input.proposal.goalId,
    tool: input.proposal.tool,
    callId: input.proposal.callId,
    contractDigest: input.identity.contractDigest,
    schemaDigest: input.identity.schemaDigest,
    receiptDigest,
    resource: { kind: 'file-content', ...input.proposal.file },
    issuedBy: 'host',
    attestation: 'non-model',
  }
}

type CompactionCheckpointWriter = {
  save(input: CompactionCheckpointSaveInput): { ok: boolean; error?: string }
}

const readyResult = (protocolVersion: number = PI_HOST_PROTOCOL_VERSION): PiHostResponse['result'] => ({
  protocolVersion,
  capabilities: [...PI_HOST_CAPABILITIES],
  status: 'ready',
})

const errorResponse = (
  id: string | number,
  code: NonNullable<PiHostResponse['error']>['code'],
  message: string,
): PiHostResponse => ({ id, error: { code, message } })

/** A session is the serialization boundary for Pi turns. */
const activeSessionRuns = new Map<string, { runId: string; cancelled: boolean; interrupt?: PiTurnInterruptReason }>()
const PI_HOST_TOOL_UPDATE_MAX_BYTES = 16_384

function isWithinProject(cwd: string, target: string): boolean {
  const projectRoot = resolveExistingPath(resolve(cwd))
  const resolvedTarget = resolve(cwd, target)
  const targetPath = resolveExistingPath(resolvedTarget)
  const rel = relative(projectRoot, targetPath)
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel))
}

/** Resolve symlinks for existing ancestors while retaining a safe lexical tail for new files. */
function resolveExistingPath(path: string): string {
  let cursor = path
  const tail: string[] = []
  while (!existsSync(cursor)) {
    const parent = dirname(cursor)
    if (parent === cursor) break
    tail.unshift(cursor.slice(parent.length + 1))
    cursor = parent
  }
  let resolved = cursor
  try {
    resolved = realpathSync.native(cursor)
  } catch {
    resolved = resolve(cursor)
  }
  return tail.reduce((current, part) => resolve(current, part), resolved)
}

/**
 * The Turn Record being written by the turn currently running in a session.
 *
 * Held per session rather than passed down because the entries come from three
 * places that do not share a call stack: the turn handler, the Pi event
 * stream, and the tool audit. Ordering matters more than tidiness — an entry
 * must be recorded when it happens, not collected afterwards.
 */
type ActiveTurnRecorder = {
  turn: number
  step: number
  entries: TurnRecordAppend[]
  /** Frozen at tool start so a mid-call capability load cannot rewrite history. */
  toolIdentities: Map<string, TurnRecordToolContractIdentity>
  /** Model-authored completion proposals awaiting the exact terminal result. */
  stateProposals: Map<string, WorkingStateProposal>
  /**
   * The seq the commit will start from, read once when the turn opened.
   * `session.record` does not change while a turn runs, so an entry's live
   * seq and its committed seq are the same number by construction.
   */
  seqBase: number
  /**
   * Thinking deltas received since the last flush, still in arrival order.
   *
   * Buffered rather than written per delta for the same reason assistant text
   * is: one thought is one entry. Nothing is dropped — the buffer is joined
   * whole at the next ordered boundary (a message, a tool call, the step's
   * end), which is what puts the reasoning BEFORE the action it explains.
   */
  reasoning: string[]
  /** Publishes a recorded entry to the live stream; absent in batch mode. */
  publish?: (entry: TurnRecordEntry) => void
  /** Updates the Host attachment watermark without copying the entry. */
  onAppend?: (entry: TurnRecordEntry) => void
}

const activeTurnRecorders = new Map<string, ActiveTurnRecorder>()

function recordTurnEntry(
  sessionId: string,
  entry: TurnRecordDraft,
): void {
  const recorder = activeTurnRecorders.get(sessionId)
  if (!recorder) return
  const appended = { turn: recorder.turn, step: recorder.step, at: Date.now(), ...entry } as TurnRecordAppend
  recorder.entries.push(appended)
  // `appendTurnRecord` numbers from the same base in the same order, so this
  // is the entry's real seq and not a live-only placeholder.
  recorder.publish?.({ ...appended, seq: recorder.seqBase + recorder.entries.length - 1 } as TurnRecordEntry)
  recorder.onAppend?.({ ...appended, seq: recorder.seqBase + recorder.entries.length - 1 } as TurnRecordEntry)
}

/** Collect one thinking delta. Nothing is written yet, and nothing is dropped. */
function recordReasoningDelta(sessionId: string, delta: string): void {
  const recorder = activeTurnRecorders.get(sessionId)
  if (!recorder || !delta) return
  recorder.reasoning.push(delta)
}

/**
 * Write everything the model has thought since the last flush as ONE entry.
 *
 * Called at each ordered boundary rather than on a timer: reasoning has to
 * land before the tool call or the message it led to, because "what was it
 * thinking before it ran that" is the question the entry exists to answer.
 * The buffer is joined whole — there is no length cap here, by decision.
 */
function flushReasoning(sessionId: string): void {
  const recorder = activeTurnRecorders.get(sessionId)
  if (!recorder?.reasoning.length) return
  const content = recorder.reasoning.join('')
  recorder.reasoning = []
  if (!content.trim()) return
  recordTurnEntry(sessionId, { kind: 'reasoning', source: 'model', content })
}

/** The next turn number for a session, read from what the record already holds. */
function nextTurnNumber(record: TurnRecord | undefined): number {
  return (record?.entries || []).reduce((highest, entry) => Math.max(highest, entry.turn), 0) + 1
}

function compactionSourceHash(messages: PiRecordedMessage[]): string {
  return createHash('sha256').update(JSON.stringify(messages)).digest('hex')
}

function completedSideEffects(session: SessionRecord): string[] {
  return (session.toolAudit || [])
    .filter((entry) => entry.phase === 'result' && entry.settlement === 'success'
      && /write|edit|create|patch|bash|shell|send|post|publish|delete/i.test(entry.tool))
    .map((entry) => `${entry.tool}:${entry.callId}`)
}

function appendStandaloneCompactionRecord(
  session: SessionRecord,
  replaced: number,
  runId: string,
  emit?: (message: PiHostMessage) => void,
): void {
  const previous = session.record?.entries.at(-1)
  const entry: TurnRecordAppend = {
    kind: 'compaction',
    source: 'host',
    replaced,
    turn: previous?.turn || 1,
    step: previous?.step || 1,
    at: Date.now(),
  }
  session.record = appendTurnRecord(session.record, [entry])
  const committed = session.record.entries.at(-1)
  if (committed && emit) {
    emit({ event: 'host/record-append', payload: { runId, sessionId: session.id, entries: [committed] } })
  }
}

function preparePiCompaction(
  session: SessionRecord,
  runId: string,
  objective: string,
  contextWindow?: number,
): void {
  const keepMessages = 6
  if (!contextWindow || session.messages.length <= keepMessages) {
    session.preparedCompaction = undefined
    return
  }
  const pressure = assessPiContextPressure(session.messages, '', contextWindow)
  if (pressure.level === 'normal') {
    session.preparedCompaction = undefined
    return
  }
  const oldMessages = session.messages.slice(0, -keepMessages)
  const sourceHash = compactionSourceHash(oldMessages)
  const manifest = buildPiCompactionManifest(oldMessages, {
    sessionId: session.id,
    runId,
    sourceHash,
    objective,
    latestSeq: session.record?.entries.at(-1)?.seq,
    completedEffects: completedSideEffects(session),
  })
  session.preparedCompaction = {
    sourceHash,
    summary: formatPiCompactionSummary(manifest, oldMessages),
    manifest,
    preparedAt: new Date().toISOString(),
    estimatedTokens: pressure.estimatedTokens,
    contextWindow,
  }
}

function preparedCompactionSummary(session: SessionRecord, sourceHash: string, objective: string): string | undefined {
  if (session.preparedCompaction?.sourceHash !== sourceHash) return undefined
  const currentObjective = objective.replace(/\s+/g, ' ').trim().slice(0, 800) || '（未記錄）'
  return session.preparedCompaction.summary.replace(/^Current objective:.*$/m, `Current objective: ${currentObjective}`)
}

function compactHostSession(input: {
  state: HostState
  session: SessionRecord
  runId: string
  objective: string
  reason: CompactionReason
  keepMessages: number
  prompt?: string
  contextWindow?: number
  checkpointWriter?: CompactionCheckpointWriter
  emit?: (message: PiHostMessage) => void
}): { ok: boolean; checkpointed: boolean; event?: PiHostEvent; error?: string } {
  const { session, runId, reason, keepMessages } = input
  if (session.messages.length <= keepMessages) return { ok: false, checkpointed: false, error: 'not-enough-messages' }
  const oldMessages = session.messages.slice(0, -keepMessages)
  const sourceHash = compactionSourceHash(oldMessages)
  const pressure = assessPiContextPressure(session.messages, input.prompt || '', input.contextWindow)
  const completedEffects = completedSideEffects(session)
  const manifest = buildPiCompactionManifest(oldMessages, {
    sessionId: session.id,
    runId,
    sourceHash,
    objective: input.objective,
    latestSeq: session.record?.entries.at(-1)?.seq,
    completedEffects,
  })
  const summary = preparedCompactionSummary(session, sourceHash, manifest.objective)
    || formatPiCompactionSummary(manifest, oldMessages)
  const checkpoint = input.checkpointWriter?.save({
    runId,
    threadId: session.threadId,
    objective: input.objective,
    summary,
    messages: oldMessages,
    parkedAtToolBoundary: true,
    // A context checkpoint is recoverable/auditable but is not an interrupted
    // run. Only the interruption path may authorize a replay-safe resume.
    replaySafe: false,
    effects: completedEffects,
    reason,
    sourceHash,
    estimatedTokens: pressure.estimatedTokens,
    contextWindow: input.contextWindow,
    manifest,
  })
  const checkpointFailed = Boolean(input.checkpointWriter && checkpoint?.ok !== true)
  if (checkpointFailed && reason !== 'emergency') {
    return { ok: false, checkpointed: false, error: checkpoint?.error || 'checkpoint-write-failed' }
  }
  if (!compactPiSession(session.id, keepMessages, summary, pressure.estimatedTokens)) {
    return { ok: false, checkpointed: checkpoint?.ok === true, error: 'pi-session-compaction-failed' }
  }
  if (activeTurnRecorders.has(session.id)) {
    recordTurnEntry(session.id, { kind: 'compaction', source: 'host', replaced: oldMessages.length })
  } else {
    appendStandaloneCompactionRecord(session, oldMessages.length, runId, input.emit)
  }
  session.messages = session.messages.slice(-keepMessages)
  session.preparedCompaction = undefined
  input.state.snapshot.cursor += 1
  const event: PiHostEvent = {
    event: 'host/context',
    payload: {
      runId,
      sessionId: session.id,
      phase: 'compacted',
      contextWindowTokens: input.contextWindow,
      reason,
      replacedMessages: oldMessages.length,
      remainingMessages: session.messages.length,
      summaryChars: summary.length,
      estimatedTokens: pressure.estimatedTokens,
      checkpointed: checkpoint?.ok === true,
    },
  }
  return { ok: true, checkpointed: checkpoint?.ok === true, event }
}

function handleManualSessionCompaction(input: {
  state: HostState
  session: SessionRecord
  request: Partial<InternalPiHostRequest>
  id: string | number
  checkpointWriter?: CompactionCheckpointWriter
  emit?: (message: PiHostMessage) => void
}): PiHostMessage[] {
  const runId = typeof input.request.params?.runId === 'string' && input.request.params.runId.trim()
    ? input.request.params.runId.trim()
    : `manual:${input.session.id}`
  const compacted = compactHostSession({
    state: input.state,
    session: input.session,
    runId,
    objective: input.session.context?.objective || input.session.title,
    reason: 'manual',
    keepMessages: 4,
    contextWindow: typeof input.request.params?.contextWindowTokens === 'number'
      ? input.request.params.contextWindowTokens
      : undefined,
    checkpointWriter: input.checkpointWriter,
    emit: input.emit,
  })
  if (!compacted.ok) return [errorResponse(input.id, 'runtime_error', compacted.error || 'Pi session compaction failed')]
  const response: PiHostResponse = { id: input.id, result: { sessionId: input.session.id, sessions: [input.session] } }
  if (!compacted.event || input.emit) {
    if (compacted.event) input.emit?.(compacted.event)
    return [response]
  }
  return [compacted.event, response]
}

function runAutoCompactionPreflight(input: {
  state: HostState
  session: SessionRecord
  runId: string
  prompt: string
  executionPrompt: string
  compaction: PiSettings['compaction']
  contextWindow?: number
  checkpointWriter?: CompactionCheckpointWriter
  emit?: (message: PiHostMessage) => void
  turnEvents: PiHostMessage[]
}): void {
  const keepMessages = 6
  const pressure = assessPiContextPressure(input.session.messages, input.executionPrompt, input.contextWindow)
  const shouldCompact = input.compaction === 'auto'
    && input.session.messages.length > keepMessages
    && (pressure.level === 'compact' || pressure.level === 'emergency')
  if (!shouldCompact) return
  const compacted = compactHostSession({
    state: input.state,
    session: input.session,
    runId: input.runId,
    objective: input.prompt,
    reason: pressure.level === 'emergency' ? 'emergency' : 'auto',
    keepMessages,
    prompt: input.executionPrompt,
    contextWindow: input.contextWindow,
    checkpointWriter: input.checkpointWriter,
    emit: input.emit,
  })
  if (!compacted.ok || !compacted.event) return
  if (input.emit) input.emit(compacted.event)
  else input.turnEvents.push(compacted.event)
}

function modelToolContractIdentity(
  state: HostState,
  sessionId: string,
  toolName: string,
): TurnRecordToolContractIdentity | undefined {
  const lookup = state.toolContracts.lookupCurrent(sessionId, toolName)
  if (!lookup.ok) return catalogToolContractIdentity(state, toolName)
  return {
    contractRevision: lookup.contract.revision,
    contractDigest: lookup.contract.contractDigest,
    schemaDigest: lookup.tool.schemaDigest,
    toolSource: lookup.tool.source,
    ...(lookup.tool.pack ? { toolPack: lookup.tool.pack } : {}),
    invocationOrigin: 'model',
  }
}

/**
 * Identity for a tool the frozen contract does not carry (issue 19).
 *
 * The digest and source come from the catalog the Host published, so the entry
 * still says WHAT was called. `contractRevision` and `contractDigest` are
 * deliberately absent: this tool was not part of that revision, and claiming
 * it was would be a worse lie than saying nothing. `contractStatus` records
 * which case this is, so a refusal never reads as a dropped field.
 */
function catalogToolContractIdentity(state: HostState, toolName: string): TurnRecordToolContractIdentity | undefined {
  const entry = state.catalogProjection.get(toolName)
  if (!entry) return undefined
  return {
    schemaDigest: entry.schemaDigest,
    // `pack` is what distinguishes the three sources; `source` only says
    // whether the tool was discovered or installed.
    toolSource: entry.pack === 'mcp' ? 'mcp' : entry.pack === 'builtin' ? 'builtin' : 'extension-pack',
    ...(entry.pack && entry.pack !== 'mcp' && entry.pack !== 'builtin' ? { toolPack: entry.pack } : {}),
    invocationOrigin: 'model',
    contractStatus: 'catalogued-not-in-turn-contract',
  }
}

/**
 * Publish an in-turn tool lifecycle event and record it in the session audit.
 *
 * The audit sink does this for decisions; execution start and terminal results
 * come from Pi's own turn events instead, so they route through here to keep
 * the event stream and `session.toolAudit` the same single shape (issue 16).
 */
function publishInTurnToolEvent(
  state: HostState,
  sessionId: string,
  emit: ((message: PiHostMessage) => void) | undefined,
  event: PiHostEvent,
): void {
  recordToolAudit(state, sessionId, event)
  if (emit) emit(event)
}

function memoryWriteReceiptFromResult(value: unknown): PiMemoryWriteReceipt | undefined {
  if (!value || typeof value !== 'object') return undefined
  const record = value as Record<string, unknown>
  const details = record.details && typeof record.details === 'object' ? record.details as Record<string, unknown> : record
  return asTurnRecordMemoryWrite(details.memoryWrite)
}

function memoryWriteRecordFields(value: unknown, callId: string): { memoryWrite?: PiMemoryWriteReceipt } {
  const memoryWrite = memoryWriteReceiptFromResult(value)
  return memoryWrite?.callId === callId ? { memoryWrite } : {}
}

function memoryWriteToolResultFields(value: unknown, callId: string): { item?: { memoryWrite: PiMemoryWriteReceipt } } {
  const memoryWrite = memoryWriteReceiptFromResult(value)
  return memoryWrite?.callId === callId ? { item: { memoryWrite } } : {}
}

function workingExecutionEvidenceRecordFields(
  evidence: WorkingExecutionEvidence | undefined,
): { executionEvidence?: WorkingExecutionEvidence } {
  return evidence ? { executionEvidence: evidence } : {}
}

function piToolExecutionFailed(event: Record<string, unknown>, toolName: string): boolean {
  if (event.isError === true) return true
  // Memory writes promise commit durability, so their typed CONTENT failure
  // must settle as failed. Other packs retain their existing transport-level
  // settlement until their own contracts explicitly opt into this semantic.
  if (!toolName.startsWith('memory_')) return false
  if (!event.result || typeof event.result !== 'object') return false
  const details = (event.result as { details?: unknown }).details
  return Boolean(details && typeof details === 'object' && (details as { ok?: unknown }).ok === false)
}

function recordToolAudit(state: HostState, sessionId: unknown, event: PiHostEvent): void {
  if (typeof sessionId !== 'string') return
  const session = state.snapshot.sessions.find((candidate) => candidate.id === sessionId)
  if (!session || (event.event !== 'host/tool-start' && event.event !== 'host/tool-decision' && event.event !== 'host/tool-result')) return
  const payload = event.payload
  const record: PiToolAuditRecord = {
    runId: payload.runId,
    callId: payload.callId || payload.runId,
    tool: payload.tool,
    phase: event.event === 'host/tool-start' ? 'start' : event.event === 'host/tool-decision' ? 'decision' : 'result',
    ...(payload.decision ? { decision: payload.decision } : {}),
    ...(payload.settlement ? { settlement: payload.settlement } : {}),
    ...(payload.reason ? { reason: payload.reason.slice(0, 500) } : {}),
    ...(typeof (payload.item as { path?: unknown } | undefined)?.path === 'string' ? { path: (payload.item as { path: string }).path } : {}),
    at: Date.now(),
  }
  session.toolAudit = [...(session.toolAudit || []), record].slice(-200)
  if (record.phase === 'decision' && record.decision) {
    recordTurnEntry(sessionId, {
      kind: 'approval',
      source: 'host',
      tool: record.tool,
      callId: record.callId,
      decision: record.decision,
      ...(record.reason ? { reason: record.reason } : {}),
    })
  }
  if (record.phase === 'result') {
    recordTurnEntry(sessionId, {
      kind: 'tool-result',
      source: 'host',
      tool: record.tool,
      callId: record.callId,
      settlement: record.settlement === 'success' || record.settlement === 'denied' || record.settlement === 'cancelled'
        ? record.settlement
        : 'failed',
      ...(record.reason ? { detail: record.reason } : {}),
      ...memoryWriteRecordFields(payload.item, record.callId),
      ...workingExecutionEvidenceRecordFields(payload.executionEvidence),
      ...(payload.contractRevision !== undefined ? {
        contractRevision: payload.contractRevision,
        contractDigest: payload.contractDigest,
        schemaDigest: payload.schemaDigest,
        toolSource: payload.toolSource,
        ...(payload.toolPack ? { toolPack: payload.toolPack } : {}),
        invocationOrigin: payload.invocationOrigin,
      } : {}),
    })
  }
}

function publishModelToolTerminal(input: {
  state: HostState
  sessionId: string
  emit: ((message: PiHostMessage) => void) | undefined
  runId: string
  tool: string
  callId: string
  denialReason: string | undefined
  toolFailed: boolean
  identity: TurnRecordToolContractIdentity | undefined
  proposal: WorkingStateProposal | undefined
  workingState: WorkingState
  trustedResult: unknown
  eventIsError: boolean
}): WorkingToolSettlement {
  if (input.denialReason !== undefined) return 'denied'
  const catalogued = input.state.catalogProjection.get(input.tool)
  const refusedAsInactive = input.eventIsError
    && input.identity?.contractStatus === 'catalogued-not-in-turn-contract'
    && catalogued?.available === true
    && catalogued.active === false
    ? catalogued.reason || `${input.tool} is not active in this turn`
    : undefined
  const settlement = refusedAsInactive ? 'denied' as const : input.toolFailed ? 'failed' as const : 'success' as const
  const executionEvidence = input.proposal
    ? hostFileWriteEvidence({
        state: input.workingState,
        proposal: input.proposal,
        identity: input.identity,
        settlement,
        trustedResult: input.trustedResult,
      })
    : undefined
  publishInTurnToolEvent(input.state, input.sessionId, input.emit, {
    event: 'host/tool-result',
    payload: {
      runId: input.runId,
      tool: input.tool,
      callId: input.callId,
      settlement,
      ...(refusedAsInactive ? { reason: refusedAsInactive } : {}),
      ...memoryWriteToolResultFields(input.trustedResult, input.callId),
      ...workingExecutionEvidenceRecordFields(executionEvidence),
      ...(input.identity || {}),
    },
  })
  return settlement
}

function commitCheckedWorkingState(input: {
  sessionId: string
  recorder: ActiveTurnRecorder
  workingState: WorkingState
  proposal: WorkingStateProposal | undefined
  callId: string
  settlement: WorkingToolSettlement
}): WorkingState {
  if (!input.proposal) return input.workingState
  let terminalIndex = -1
  for (let index = input.recorder.entries.length - 1; index >= 0; index -= 1) {
    const entry = input.recorder.entries[index]
    if (entry?.kind === 'tool-result' && entry.callId === input.callId) {
      terminalIndex = index
      break
    }
  }
  const terminalEntry = terminalIndex >= 0 ? input.recorder.entries[terminalIndex] : undefined
  const executionEvidence = terminalEntry?.kind === 'tool-result' ? terminalEntry.executionEvidence : undefined
  const settlement = terminalEntry?.kind === 'tool-result' ? terminalEntry.settlement : input.settlement
  const checked = checkWorkingStateProposal({
    state: input.workingState,
    proposal: input.proposal,
    settlement,
    evidence: executionEvidence,
    evidenceSeq: terminalIndex >= 0 ? input.recorder.seqBase + terminalIndex : 0,
  })
  recordTurnEntry(input.sessionId, { kind: 'state-check', source: 'host', check: checked.check })
  if (checked.verdict !== 'accepted') return input.workingState
  recordTurnEntry(input.sessionId, { kind: 'working-state', source: 'host', state: checked.state })
  return checked.state
}

function recordFileWriteStateProposal(input: {
  sessionId: string
  recorder: ActiveTurnRecorder
  workingState: WorkingState
  tool: string
  callId: string
  args: unknown
}): void {
  const proposal = fileWriteStateProposal(input.workingState, input.tool, input.callId, input.args)
  if (!proposal) return
  input.recorder.stateProposals.set(input.callId, proposal)
  recordTurnEntry(input.sessionId, { kind: 'state-proposal', source: 'model', proposal })
}

const DIRECT_TOOL_ENVELOPE_FIELDS = new Set([
  'cwd',
  'sessionId',
  'runId',
  'callId',
  'parentRunId',
  'approval',
  'contractRevision',
  'schemaDigest',
])

type DirectToolEnvelope = {
  cwd: string
  sessionId?: string
  runId: string
  callId: string
  parentRunId?: string
  approval?: unknown
  contractRevision?: number
  schemaDigest?: string
}

/** Protocol routing coordinates are not model arguments and never enter schema validation. */
function splitDirectToolRequest(
  id: string | number,
  params: Record<string, unknown>,
): { ok: true; envelope: DirectToolEnvelope; arguments: Record<string, unknown> } | { ok: false; message: string } {
  if (typeof params.cwd !== 'string') return { ok: false, message: 'cwd is required' }
  const runId = typeof params.runId === 'string' ? params.runId : String(id)
  const callId = typeof params.callId === 'string' ? params.callId : runId
  const arguments_ = Object.fromEntries(Object.entries(params).filter(([name]) => !DIRECT_TOOL_ENVELOPE_FIELDS.has(name)))
  return {
    ok: true,
    envelope: {
      cwd: params.cwd,
      runId,
      callId,
      ...(typeof params.sessionId === 'string' ? { sessionId: params.sessionId } : {}),
      ...(typeof params.parentRunId === 'string' ? { parentRunId: params.parentRunId } : {}),
      ...(params.approval !== undefined ? { approval: params.approval } : {}),
      ...(typeof params.contractRevision === 'number' ? { contractRevision: params.contractRevision } : {}),
      ...(typeof params.schemaDigest === 'string' ? { schemaDigest: params.schemaDigest } : {}),
    },
    arguments: arguments_,
  }
}

function validateDirectToolCall(
  state: HostState,
  toolName: string,
  envelope: DirectToolEnvelope,
  arguments_: Record<string, unknown>,
): { ok: true; arguments: Record<string, unknown> } | { ok: false; message: string } {
  let schema: Record<string, unknown> | undefined
  if (envelope.sessionId) {
    const lookup = state.toolContracts.lookupCurrent(envelope.sessionId, toolName)
    if (!lookup.ok) {
      const knownPreTurnSession = state.snapshot.sessions.some((session) => session.id === envelope.sessionId)
      if (!knownPreTurnSession || envelope.contractRevision !== undefined || envelope.schemaDigest !== undefined) {
        return { ok: false, message: lookup.message }
      }
      // A newly-created session can receive a diagnostic direct call before
      // its first turn has anything to freeze. That narrow pre-turn case uses
      // the Host's Pi factory schema; once a contract exists, the branch below
      // is mandatory and a claimed revision/digest always fails closed.
      schema = piCoreRuntimeToolCatalog(envelope.cwd).find((tool) => tool.name === toolName)?.parameters
    } else {
      if (envelope.contractRevision !== undefined && envelope.contractRevision !== lookup.contract.revision) {
        return { ok: false, message: `Tool contract revision ${envelope.contractRevision} is not current; current is ${lookup.contract.revision}` }
      }
      if (envelope.schemaDigest !== undefined && envelope.schemaDigest !== lookup.tool.schemaDigest) {
        return { ok: false, message: `Tool schema digest mismatch for ${toolName}` }
      }
      schema = lookup.tool.parameters
    }
  } else {
    // Sessionless diagnostics predate Turn Tool Contracts. They remain usable,
    // but derive their schema from the Host's Pi factories, never renderer
    // definitions. Session-bound calls use the current contract whenever one
    // exists; only the documented pre-turn compatibility case shares this path.
    schema = piCoreRuntimeToolCatalog(envelope.cwd).find((tool) => tool.name === toolName)?.parameters
  }
  if (!schema) return { ok: false, message: `No Host-owned tool schema is available for ${toolName}` }
  const validation = validatePiToolArguments(schema, arguments_)
  return validation.ok
    ? validation
    : { ok: false, message: `${toolName} parameters are invalid: ${validation.message}` }
}

const INTERNAL_INVOCATION_ORIGIN = Symbol('pi-host-invocation-origin')
const INTERNAL_OUTER_CODE_APPROVED = Symbol('pi-host-outer-code-approved')

type InternalPiHostRequest = PiHostRequest & {
  [INTERNAL_INVOCATION_ORIGIN]?: 'code-mode'
  [INTERNAL_OUTER_CODE_APPROVED]?: true
}

function contractIdentityForCurrentTool(
  state: HostState,
  sessionId: string,
  toolName: string,
): { identity: PiInvocationContractIdentity; revision: number } | undefined {
  const lookup = state.toolContracts.lookupCurrent(sessionId, toolName)
  if (!lookup.ok) return undefined
  return {
    revision: lookup.contract.revision,
    identity: {
      contractRevision: lookup.contract.revision,
      contractDigest: lookup.contract.contractDigest,
      schemaDigest: lookup.tool.schemaDigest,
      toolSource: lookup.tool.source,
      ...(lookup.tool.pack ? { toolPack: lookup.tool.pack } : {}),
    },
  }
}

function frozenPolicyForInvocation(state: HostState, sessionId: string, cwd: string): PiFrozenRunPolicy {
  const admitted = piSessionRunBinding(sessionId)?.frozenPolicy
  if (admitted) return admitted
  return freezePiRunPolicy({
    approvalMode: state.snapshot.settings.approvalMode,
    unattended: state.snapshot.settings.unattended,
    projectRoot: cwd,
  })
}

function appendInvocationEvidence(sessionId: string, event: PiPolicyEvidenceEvent): void {
  recordTurnEntry(sessionId, {
    kind: 'tool-evidence',
    source: 'host',
    tool: event.tool,
    runId: event.runId,
    callId: event.callId,
    ...(event.parentRunId ? { parentRunId: event.parentRunId } : {}),
    phase: event.phase,
    ...(event.decision ? { decision: event.decision } : {}),
    ...(event.settlement ? { settlement: event.settlement } : {}),
    ...(event.detail ? { detail: event.detail } : {}),
    contractRevision: event.contractRevision,
    contractDigest: event.contractDigest,
    schemaDigest: event.schemaDigest,
    toolSource: event.toolSource,
    ...(event.toolPack ? { toolPack: event.toolPack } : {}),
    invocationOrigin: event.origin,
  })
}

type InvocationAuthorization = {
  ok: boolean
  decision: 'allow' | 'ask' | 'deny'
  settlement?: 'denied' | 'cancelled'
  reason: string
  args: Record<string, unknown>
  identity: PiInvocationContractIdentity
  evidence: PiInvocationEvidence
}

async function authorizeContractInvocation(input: {
  state: HostState
  sessionId: string
  runId: string
  callId: string
  parentRunId?: string
  cwd: string
  tool: string
  args: Record<string, unknown>
  origin: 'direct-protocol' | 'code-mode'
  approval?: unknown
  requirements?: PiToolPolicyRequirements
  identity?: PiInvocationContractIdentity
}): Promise<InvocationAuthorization | { ok: false; contractError: string }> {
  const resolved = input.identity
    ? { identity: input.identity, revision: input.identity.contractRevision }
    : contractIdentityForCurrentTool(input.state, input.sessionId, input.tool)
  if (!resolved) {
    const lookup = input.state.toolContracts.lookupCurrent(input.sessionId, input.tool)
    return { ok: false, contractError: lookup.ok ? `Tool ${input.tool} is unavailable` : lookup.message }
  }
  const coordinates = {
    sessionId: input.sessionId,
    runId: input.runId,
    callId: input.callId,
    ...(input.parentRunId ? { parentRunId: input.parentRunId } : {}),
  }
  const evidence = new PiInvocationEvidence({
    ...coordinates,
    tool: input.tool,
    origin: input.origin,
    ...resolved.identity,
  }, (event) => appendInvocationEvidence(input.sessionId, event))
  evidence.start()
  const evaluation = evaluatePiInvocationPolicy({
    coordinates,
    origin: input.origin,
    tool: input.tool,
    contract: resolved.identity,
    args: input.args,
    policy: frozenPolicyForInvocation(input.state, input.sessionId, input.cwd),
    requirements: input.requirements,
  })
  evidence.decision(evaluation.verdict, evaluation.reason)
  const base = {
    args: evaluation.normalizedArgs as Record<string, unknown>,
    identity: resolved.identity,
    evidence,
  }
  if (evaluation.verdict === 'deny') {
    evidence.result(false, evaluation.reason)
    evidence.settle('denied', evaluation.reason)
    return { ...base, ok: false, decision: 'deny', settlement: 'denied', reason: evaluation.reason }
  }
  if (evaluation.verdict === 'allow') {
    return { ...base, ok: true, decision: 'allow', reason: evaluation.reason }
  }

  if (input.origin === 'code-mode') {
    const policy = frozenPolicyForInvocation(input.state, input.sessionId, input.cwd)
    const resolution = await requestPiToolApproval({
      runId: input.runId,
      sessionId: input.sessionId,
      tool: input.tool,
      callId: input.callId,
      args: base.args,
      reason: evaluation.reason,
      timeoutMs: policy.approvalTimeoutMs,
      ...(policy.unattended ? { unattended: true } : {}),
    })
    if (resolution.decision === 'allow') {
      evidence.decision('allow', resolution.reason || evaluation.reason)
      return { ...base, ok: true, decision: 'allow', reason: resolution.reason || evaluation.reason }
    }
    const reason = resolution.reason || evaluation.reason
    const cancelled = resolution.decision === 'cancel'
    evidence.decision('deny', reason)
    evidence.result(false, reason)
    evidence.settle(cancelled ? 'cancelled' : 'denied', reason)
    return { ...base, ok: false, decision: 'deny', settlement: cancelled ? 'cancelled' : 'denied', reason }
  }

  if (input.approval === 'allow') {
    evidence.decision('allow', 'Approval supplied for this invocation')
    return { ...base, ok: true, decision: 'allow', reason: 'Approval supplied for this invocation' }
  }
  const cancelled = input.approval === 'cancel' || input.approval === 'cancelled'
  const denied = input.approval === 'deny' || input.approval === 'timeout' || cancelled
  if (denied) {
    const reason = cancelled ? 'Approval cancelled' : input.approval === 'timeout' ? 'Approval timed out' : 'Approval denied by user'
    evidence.decision('deny', reason)
    evidence.result(false, reason)
    evidence.settle(cancelled ? 'cancelled' : 'denied', reason)
    return { ...base, ok: false, decision: 'deny', settlement: cancelled ? 'cancelled' : 'denied', reason }
  }
  return { ...base, ok: false, decision: 'ask', reason: evaluation.reason }
}

function contractValidationFailure(input: {
  state: HostState
  sessionId?: string
  runId: string
  callId: string
  parentRunId?: string
  tool: string
  origin: 'direct-protocol' | 'code-mode'
  reason: string
  id: string | number
  emit?: (message: PiHostMessage) => void
}): PiHostMessage[] {
  if (!input.sessionId) return [errorResponse(input.id, 'invalid_request', input.reason)]
  const found = contractIdentityForCurrentTool(input.state, input.sessionId, input.tool)
  if (!found) return [errorResponse(input.id, 'invalid_request', input.reason)]
  const evidence = new PiInvocationEvidence({
    sessionId: input.sessionId,
    runId: input.runId,
    callId: input.callId,
    ...(input.parentRunId ? { parentRunId: input.parentRunId } : {}),
    tool: input.tool,
    origin: input.origin,
    ...found.identity,
  }, (event) => appendInvocationEvidence(input.sessionId!, event))
  evidence.start()
  evidence.result(false, input.reason)
  evidence.settle('failed', input.reason)
  const identity = { ...found.identity, invocationOrigin: input.origin }
  const events: PiHostEvent[] = [
    { event: 'host/tool-start', payload: { runId: input.runId, tool: input.tool, callId: input.callId, parentRunId: input.parentRunId, ...identity } },
    { event: 'host/tool-result', payload: { runId: input.runId, tool: input.tool, callId: input.callId, parentRunId: input.parentRunId, settlement: 'failed', reason: input.reason, ...identity } },
  ]
  for (const event of events) {
    recordToolAudit(input.state, input.sessionId, event)
    input.emit?.(event)
  }
  return [...(input.emit ? [] : events), errorResponse(input.id, 'invalid_request', input.reason)]
}

/**
 * Clock used to arm per-turn deadlines. Swapped by the deadline smoke so the
 * timeout path is driven by a fake clock instead of by real waiting.
 */
let turnDeadlineClock: TurnDeadlineClock = systemTurnDeadlineClock

export function setPiTurnDeadlineClock(clock: TurnDeadlineClock = systemTurnDeadlineClock): void {
  turnDeadlineClock = clock
}

function attachmentProtocolError(id: string | number, message: string): PiHostMessage[] {
  return [errorResponse(id, 'protocol_mismatch', message)]
}

function attachRunSnapshot(state: HostState, input: Partial<InternalPiHostRequest>, id: string | number, runId: string): PiHostMessage[] {
  const attachment = state.attachmentJournal.get(runId)
  if (!attachment) return [{ id, result: { attachment: undefined, page: undefined } }]
  const session = state.snapshot.sessions.find((candidate) => candidate.id === attachment.sessionId)
  const limit = typeof input.params?.limit === 'number' ? input.params.limit : PI_HOST_ATTACHMENT_PAGE_LIMIT
  const page = state.attachmentJournal.attach(runId, session?.record?.entries || [], input.params?.before as number | undefined, limit)
  return [{ id, result: page ? { attachment: page.attachment, page } : {} }]
}

function claimRunFinalization(state: HostState, input: Partial<InternalPiHostRequest>, id: string | number, runId: string, claimantId: string): PiHostMessage[] {
  const leaseMs = typeof input.params?.leaseMs === 'number' ? input.params.leaseMs : undefined
  const finalizationClaim = state.attachmentJournal.claimFinalization(runId, claimantId, leaseMs)
  return [{ id, result: { runId, finalizationClaim } }]
}

function parseRunLearningFinalOutcome(value: unknown): RunLearningFinalOutcome {
  if (!value || typeof value !== 'object') return { status: 'failed', executionKind: 'external' }
  const candidate = value as Record<string, unknown>
  return {
    status: typeof candidate.status === 'string' ? candidate.status : 'failed',
    executionKind: candidate.executionKind === 'loop' ? 'loop' : 'external',
    ...(candidate.dodMet === true || candidate.dodMet === false
      ? { dodMet: candidate.dodMet }
      : {}),
  }
}

async function completeRunFinalization(
  state: HostState,
  input: Partial<InternalPiHostRequest>,
  id: string | number,
  runId: string,
  claimantId: string,
  emit?: (message: PiHostMessage) => void,
): Promise<PiHostMessage[]> {
  const claimEpoch = typeof input.params?.claimEpoch === 'number' && Number.isFinite(input.params.claimEpoch)
    ? Math.floor(input.params.claimEpoch)
    : undefined
  if (claimEpoch === undefined || claimEpoch < 1) {
    return [errorResponse(id, 'invalid_request', 'runId, claimantId and a positive claimEpoch are required')]
  }
  const renewed = state.attachmentJournal.claimFinalization(runId, claimantId)
  if (!renewed.claimed || !renewed.owner || renewed.claimEpoch !== claimEpoch) {
    const finalizationComplete = state.attachmentJournal.completeFinalization(runId, claimantId, claimEpoch)
    return [{ id, result: { runId, finalizationComplete } }]
  }
  const finalOutcome = parseRunLearningFinalOutcome(input.params?.finalOutcome)
  const attachment = state.attachmentJournal.get(runId)
  const learningSettlement = await settlePiRunLearning({
    store: state.memoryStore,
    candidate: state.attachmentJournal.learningCandidate(runId),
    outcome: finalOutcome,
    publish: (change) => publishPiMemoryChange(state, change, emit || (() => undefined)),
  })
  const finalizationComplete = state.attachmentJournal.completeFinalization(runId, claimantId, claimEpoch)
  if (learningSettlement.committed) {
    emit?.({
      event: 'host/context',
      payload: { runId, sessionId: attachment?.sessionId || '', phase: 'memory-written', written: 1 },
    })
  }
  return [{ id, result: { runId, finalizationComplete, learningSettlement } }]
}

function handleAttachmentRequest(
  state: HostState,
  input: Partial<InternalPiHostRequest>,
  id: string | number,
  emit?: (message: PiHostMessage) => void,
): PiHostMessage[] | Promise<PiHostMessage[]> | undefined {
  const method = input.method
  if (!method?.startsWith('runs/')) return undefined
  if (!['runs/active', 'runs/attach', 'runs/finalize-claim', 'runs/finalize-complete', 'runs/ack'].includes(method)) return undefined
  if (state.negotiatedProtocolVersion < 3) return attachmentProtocolError(id, 'Pi Host attachment/finalization requires Protocol v3')
  if (method === 'runs/active') {
    return [{ id, result: { activeRuns: state.attachmentJournal.active(), terminalRuns: state.attachmentJournal.pendingTerminal() } }]
  }
  const runId = typeof input.params?.runId === 'string' ? input.params.runId : ''
  if (method === 'runs/attach') return attachRunSnapshot(state, input, id, runId)
  if (method === 'runs/ack') {
    if (!runId) return [errorResponse(id, 'invalid_request', 'runId is required')]
    return [{ id, result: { runId, resolved: state.attachmentJournal.acknowledge(runId) } }]
  }
  const claimantId = typeof input.params?.claimantId === 'string' ? input.params.claimantId : ''
  if (!runId || !claimantId) return [errorResponse(id, 'invalid_request', 'runId and claimantId are required')]
  return method === 'runs/finalize-claim'
    ? claimRunFinalization(state, input, id, runId, claimantId)
    : completeRunFinalization(state, input, id, runId, claimantId, emit)
}

function handleInitialization(
  state: HostState,
  input: Partial<InternalPiHostRequest>,
  id: string | number,
): PiHostMessage[] | undefined {
  if (input.method !== 'initialize') return undefined
  const requestedVersion = (input.params as { protocolVersion?: unknown } | undefined)?.protocolVersion
  if (requestedVersion !== PI_HOST_PROTOCOL_VERSION && requestedVersion !== 3 && requestedVersion !== 2) {
    return [errorResponse(id, 'protocol_mismatch', `Unsupported Pi Host Protocol version: ${String(requestedVersion)}`)]
  }
  state.initialized = true
  state.negotiatedProtocolVersion = requestedVersion as number
  const requestedCapabilities = (input.params as { capabilities?: unknown } | undefined)?.capabilities
  state.toolContractNegotiated = !Array.isArray(requestedCapabilities) || requestedCapabilities.includes('tool-contract-v1')
  state.memoryStoreNegotiated = Array.isArray(requestedCapabilities) && requestedCapabilities.includes('memory-store-v1')
  const result = readyResult(state.negotiatedProtocolVersion)
  return [
    { event: 'host/ready', payload: {
      protocolVersion: result?.protocolVersion ?? state.negotiatedProtocolVersion,
      capabilities: result?.capabilities ?? [...PI_HOST_CAPABILITIES],
    } },
    { id, result },
  ]
}

function durableMemoryScope(value: unknown): MemoryScope {
  if (!value || typeof value !== 'object') throw new DurableMemoryStoreError('invalid_input', 'memory scope is required')
  const scope = value as { kind?: unknown; project?: unknown }
  if (scope.kind === 'global') return { kind: 'global' }
  if (scope.kind === 'project' && typeof scope.project === 'string') {
    return { kind: 'project', project: canonicalProjectId(scope.project) }
  }
  throw new DurableMemoryStoreError('invalid_input', 'memory scope must be global or a canonical project')
}

function durableMemoryAccess(value: unknown): MemoryAccessContext {
  if (!value || typeof value !== 'object') throw new DurableMemoryStoreError('invalid_input', 'memory access context is required')
  const access = value as Partial<MemoryAccessContext> & { canonicalProject?: unknown }
  if (!['runtime', 'admin', 'migration', 'consolidation'].includes(String(access.origin))) {
    throw new DurableMemoryStoreError('invalid_input', 'memory access origin is invalid')
  }
  if (typeof access.memoryReadEnabled !== 'boolean' || typeof access.memoryWriteEnabled !== 'boolean' || typeof access.temporary !== 'boolean') {
    throw new DurableMemoryStoreError('invalid_input', 'memory access flags are required')
  }
  return {
    origin: access.origin as MemoryAccessContext['origin'],
    ...(typeof access.canonicalProject === 'string' ? { canonicalProject: canonicalProjectId(access.canonicalProject) } : {}),
    memoryReadEnabled: access.memoryReadEnabled,
    memoryWriteEnabled: access.memoryWriteEnabled,
    temporary: access.temporary,
    ...(typeof access.runId === 'string' ? { runId: access.runId } : {}),
    ...(typeof access.sessionId === 'string' ? { sessionId: access.sessionId } : {}),
    ...(typeof access.callId === 'string' ? { callId: access.callId } : {}),
  }
}

function durableMemoryDraft(value: unknown): MemoryEntryDraft {
  if (!value || typeof value !== 'object') throw new DurableMemoryStoreError('invalid_input', 'memory entry is required')
  const draft = value as Partial<MemoryEntryDraft> & { scope?: unknown }
  if (typeof draft.logicalKey !== 'string' || !draft.logicalKey.trim()) {
    throw new DurableMemoryStoreError('invalid_input', 'memory logicalKey is required')
  }
  if (draft.kind !== 'memory' && draft.kind !== 'profile' && draft.kind !== 'document') {
    throw new DurableMemoryStoreError('invalid_input', 'memory kind is invalid')
  }
  if (typeof draft.text !== 'string' || typeof draft.createdAt !== 'string' || !Array.isArray(draft.tags) || !draft.tags.every((tag) => typeof tag === 'string')) {
    throw new DurableMemoryStoreError('invalid_input', 'memory text, tags, and createdAt are required')
  }
  return canonicalMemoryDraft({
    scope: durableMemoryScope(draft.scope),
    logicalKey: draft.logicalKey,
    kind: draft.kind,
    text: draft.text,
    tags: draft.tags,
    createdAt: draft.createdAt,
  } as MemoryEntryDraft)
}

function durableMemoryChangedEvent(
  operation: 'upsert' | 'append' | 'delete' | 'clear' | 'delete-entry' | 'clear-project' | 'clear-global' | 'clear-all' | 'consolidate-dream' | 'import',
  revision: number,
  changed: number,
  scope: MemoryScope | { kind: 'all' },
  logicalKey: string,
): PiHostEvent {
  return {
    event: 'memory/changed',
    payload: {
      version: 1,
      revision,
      operation,
      changed,
      scope: scope.kind,
      ...(scope.kind === 'project' ? { project: scope.project } : {}),
      logicalKey,
    },
  }
}

function claimMemoryRevision(state: HostState, revision: number, changed: boolean): boolean {
  if (!changed || state.publishedMemoryRevisions.has(revision)) return false
  state.publishedMemoryRevisions.add(revision)
  return true
}

function publishPiMemoryChange(state: HostState, change: PiMemoryChange, emit: (message: PiHostEvent) => void): void {
  if (claimMemoryRevision(state, change.revision, change.changed > 0)) {
    emit(durableMemoryChangedEvent(change.operation, change.revision, change.changed, change.scope, change.logicalKey))
    if (change.write) {
      emit({
        event: 'host/context',
        payload: {
          runId: change.write.runId,
          sessionId: change.write.sessionId,
          phase: 'memory-written',
          written: 1,
          operation: change.write.operation,
          logicalKey: change.write.logicalKey,
          scope: change.write.scope,
          revision: change.write.revision,
          callId: change.write.callId,
        },
      })
    }
  }
}

type DurableMemoryRequestParams = Record<string, unknown>

function durableMemoryLogicalKey(params: DurableMemoryRequestParams): string {
  const logicalKey = typeof params.logicalKey === 'string' ? params.logicalKey : ''
  if (!logicalKey) throw new DurableMemoryStoreError('invalid_input', 'memory logicalKey is required')
  return logicalKey
}

async function upsertDurableMemory(
  state: HostState,
  params: DurableMemoryRequestParams,
  access: MemoryAccessContext,
  id: string | number,
  emit?: (message: PiHostMessage) => void,
): Promise<PiHostMessage[]> {
  const beforeRevision = await state.memoryStore.revision()
  const entry = await state.memoryStore.upsert({ access, ...durableMemoryDraft(params.entry) })
  const event = durableMemoryChangedEvent('upsert', entry.revision, 1, entry.scope, entry.logicalKey)
  const changed = claimMemoryRevision(state, entry.revision, entry.revision > beforeRevision)
  if (changed && emit) emit(event)
  return [...(changed && !emit ? [event] : []), { id, result: { memoryStore: { version: 1, operation: 'upsert', revision: entry.revision, entry } } }]
}

async function appendDurableMemory(
  state: HostState,
  params: DurableMemoryRequestParams,
  access: MemoryAccessContext,
  id: string | number,
  emit?: (message: PiHostMessage) => void,
): Promise<PiHostMessage[]> {
  const beforeRevision = await state.memoryStore.revision()
  const entry = await state.memoryStore.append({ access, ...durableMemoryDraft(params.entry) } as MemoryAppendInput)
  const event = durableMemoryChangedEvent('append', entry.revision, 1, entry.scope, entry.logicalKey)
  const changed = claimMemoryRevision(state, entry.revision, entry.revision > beforeRevision)
  if (changed && emit) emit(event)
  return [...(changed && !emit ? [event] : []), { id, result: { memoryStore: { version: 1, operation: 'append', revision: entry.revision, entry } } }]
}

async function getDurableMemory(
  state: HostState,
  params: DurableMemoryRequestParams,
  access: MemoryAccessContext,
  id: string | number,
): Promise<PiHostMessage[]> {
  const entry = await state.memoryStore.get({ access, scope: durableMemoryScope(params.scope), logicalKey: durableMemoryLogicalKey(params) })
  const revision = await state.memoryStore.revision()
  return [{ id, result: { memoryStore: { version: 1, operation: 'get', revision, ...(entry ? { entry } : {}) } } }]
}

async function listDurableMemory(
  state: HostState,
  params: DurableMemoryRequestParams,
  access: MemoryAccessContext,
  id: string | number,
): Promise<PiHostMessage[]> {
  const scope = params.scope === undefined ? undefined : durableMemoryScope(params.scope)
  const page = await state.memoryStore.list({
    access,
    ...(scope ? { scope } : {}),
    kinds: params.kinds as MemoryListInput['kinds'],
    cursor: params.cursor as string | undefined,
    limit: params.limit as number | undefined,
  })
  return [{ id, result: { memoryStore: { version: 1, operation: 'list', revision: page.revision, page } } }]
}

async function recallDurableMemory(
  state: HostState,
  params: DurableMemoryRequestParams,
  access: MemoryAccessContext,
  id: string | number,
): Promise<PiHostMessage[]> {
  const query = typeof params.query === 'string' ? params.query : ''
  if (!query.trim()) throw new DurableMemoryStoreError('invalid_input', 'memory query is required')
  const recall = await state.memoryStore.recall({ access, query, limit: params.limit as number | undefined })
  return [{ id, result: { memoryStore: { version: 1, operation: 'recall', revision: recall.revision, recall } } }]
}

async function deleteDurableMemory(
  state: HostState,
  params: DurableMemoryRequestParams,
  access: MemoryAccessContext,
  id: string | number,
  emit?: (message: PiHostMessage) => void,
  operation: 'delete' | 'delete-entry' = 'delete',
): Promise<PiHostMessage[]> {
  const scope = durableMemoryScope(params.scope)
  const logicalKey = durableMemoryLogicalKey(params)
  const mutation = await state.memoryStore.delete({ access, scope, logicalKey, auditOperation: operation })
  const event = durableMemoryChangedEvent(operation, mutation.revision, mutation.changed, scope, logicalKey)
  const changed = claimMemoryRevision(state, mutation.revision, mutation.changed > 0)
  if (changed && emit) emit(event)
  return [...(changed && !emit ? [event] : []), { id, result: { memoryStore: { version: 1, operation, revision: mutation.revision, mutation } } }]
}

async function clearDurableMemory(
  state: HostState,
  params: DurableMemoryRequestParams,
  access: MemoryAccessContext,
  id: string | number,
  emit?: (message: PiHostMessage) => void,
): Promise<PiHostMessage[]> {
  const rawScope = params.scope as { kind?: unknown } | undefined
  const scope: MemoryClearInput['scope'] = rawScope?.kind === 'all' ? { kind: 'all' } : durableMemoryScope(params.scope)
  const mutation = await state.memoryStore.clear({ access, scope })
  const event = durableMemoryChangedEvent('clear', mutation.revision, mutation.changed, scope, '*')
  const changed = claimMemoryRevision(state, mutation.revision, mutation.changed > 0)
  if (changed && emit) emit(event)
  return [...(changed && !emit ? [event] : []), { id, result: { memoryStore: { version: 1, operation: 'clear', revision: mutation.revision, mutation } } }]
}

async function clearTypedDurableMemory(
  state: HostState,
  operation: 'clear-project' | 'clear-global' | 'clear-all',
  params: DurableMemoryRequestParams,
  access: MemoryAccessContext,
  id: string | number,
  emit?: (message: PiHostMessage) => void,
): Promise<PiHostMessage[]> {
  if (params.scope !== undefined) throw new DurableMemoryStoreError('invalid_input', `${operation} does not accept a generic scope`)
  if (operation !== 'clear-project' && params.project !== undefined) {
    throw new DurableMemoryStoreError('invalid_input', `${operation} does not accept a project`)
  }
  const scope: MemoryClearInput['scope'] = operation === 'clear-project'
    ? { kind: 'project', project: canonicalProjectId(typeof params.project === 'string' ? params.project : '') }
    : operation === 'clear-global' ? { kind: 'global' } : { kind: 'all' }
  const mutation = await state.memoryStore.clear({
    access,
    scope,
    includeSpecial: operation === 'clear-all',
    auditOperation: operation,
  })
  const event = durableMemoryChangedEvent(operation, mutation.revision, mutation.changed, scope, '*')
  const changed = claimMemoryRevision(state, mutation.revision, mutation.changed > 0)
  if (changed && emit) emit(event)
  return [...(changed && !emit ? [event] : []), {
    id,
    result: { memoryStore: { version: 1, operation, revision: mutation.revision, mutation } },
  }]
}

async function deletionCapabilityDurableMemory(
  state: HostState,
  access: MemoryAccessContext,
  id: string | number,
): Promise<PiHostMessage[]> {
  authorizeMemoryAccess('clear', access, { kind: 'all' })
  const capability = await state.memoryStore.deletionCapability()
  const revision = await state.memoryStore.revision()
  return [{ id, result: { memoryStore: { version: 1, operation: 'deletion-capability', revision, capability } } }]
}

async function consolidateDreamDurableMemory(
  state: HostState,
  params: DurableMemoryRequestParams,
  access: MemoryAccessContext,
  id: string | number,
  emit?: (message: PiHostMessage) => void,
): Promise<PiHostMessage[]> {
  const scope = durableMemoryScope(params.scope)
  const operationId = typeof params.operationId === 'string' ? params.operationId : ''
  if (!operationId) throw new DurableMemoryStoreError('invalid_input', 'Dream consolidation operationId is required')
  const consolidation = await state.memoryStore.consolidateDream({
    access, scope, operationId, force: params.force === true,
  } as MemoryDreamConsolidateInput)
  const event = durableMemoryChangedEvent('consolidate-dream', consolidation.revision, consolidation.changed, scope, '*')
  const changed = claimMemoryRevision(state, consolidation.revision, consolidation.changed > 0)
  if (changed && emit) emit(event)
  return [...(changed && !emit ? [event] : []), {
    id,
    result: { memoryStore: { version: 1, operation: 'consolidate-dream', revision: consolidation.revision, consolidation } },
  }]
}

async function exportDurableMemory(
  state: HostState,
  params: DurableMemoryRequestParams,
  access: MemoryAccessContext,
  id: string | number,
): Promise<PiHostMessage[]> {
  const scope = params.scope === undefined ? undefined : durableMemoryScope(params.scope)
  const bundle = await state.memoryStore.exportBundle({ access, ...(scope ? { scope } : {}) })
  return [{ id, result: { memoryStore: { version: 1, operation: 'export', revision: bundle.revision, bundle } } }]
}

async function previewImportDurableMemory(state: HostState, params: DurableMemoryRequestParams, access: MemoryAccessContext, id: string | number): Promise<PiHostMessage[]> {
  const preview = await state.memoryStore.previewImport({ access, bundle: params.bundle, mode: params.mode as import('./durableMemoryImport.ts').MemoryImportMode })
  return [{ id, result: { memoryStore: { version: 1, operation: 'import-preview', revision: preview.revision, preview } } }]
}

async function applyImportDurableMemory(state: HostState, params: DurableMemoryRequestParams, access: MemoryAccessContext, id: string | number, emit?: (message: PiHostMessage) => void): Promise<PiHostMessage[]> {
  const importResult = await state.memoryStore.applyImport({
    access, bundle: params.bundle, mode: params.mode as import('./durableMemoryImport.ts').MemoryImportMode,
    operationId: params.operationId as string, previewId: params.previewId as string, expectedRevision: params.expectedRevision as number,
  })
  const event = durableMemoryChangedEvent('import', importResult.revision, importResult.changed, { kind: 'all' }, '*')
  const changed = claimMemoryRevision(state, importResult.revision, importResult.changed > 0)
  if (changed && emit) emit(event)
  return [...(changed && !emit ? [event] : []), { id, result: { memoryStore: { version: 1, operation: 'import-apply', revision: importResult.revision, importResult } } }]
}

function executeDurableMemoryRequest(
  state: HostState,
  method: string,
  params: DurableMemoryRequestParams,
  access: MemoryAccessContext,
  id: string | number,
  emit?: (message: PiHostMessage) => void,
): Promise<PiHostMessage[]> {
  switch (method) {
    case 'memory/v1/upsert': return upsertDurableMemory(state, params, access, id, emit)
    case 'memory/v1/append': return appendDurableMemory(state, params, access, id, emit)
    case 'memory/v1/get': return getDurableMemory(state, params, access, id)
    case 'memory/v1/list': return listDurableMemory(state, params, access, id)
    case 'memory/v1/recall': return recallDurableMemory(state, params, access, id)
    case 'memory/v1/delete': return deleteDurableMemory(state, params, access, id, emit)
    case 'memory/v1/clear': return clearDurableMemory(state, params, access, id, emit)
    case 'memory/v1/delete-entry': return deleteDurableMemory(state, params, access, id, emit, 'delete-entry')
    case 'memory/v1/clear-project': return clearTypedDurableMemory(state, 'clear-project', params, access, id, emit)
    case 'memory/v1/clear-global': return clearTypedDurableMemory(state, 'clear-global', params, access, id, emit)
    case 'memory/v1/clear-all': return clearTypedDurableMemory(state, 'clear-all', params, access, id, emit)
    case 'memory/v1/deletion-capability': return deletionCapabilityDurableMemory(state, access, id)
    case 'memory/v1/consolidate-dream': return consolidateDreamDurableMemory(state, params, access, id, emit)
    case 'memory/v1/export': return exportDurableMemory(state, params, access, id)
    case 'memory/v1/import-preview': return previewImportDurableMemory(state, params, access, id)
    case 'memory/v1/import-apply': return applyImportDurableMemory(state, params, access, id, emit)
    default: return Promise.resolve([errorResponse(id, 'unknown_method', `Unknown durable memory method: ${method}`)])
  }
}

function handleDurableMemoryRequest(
  state: HostState,
  input: Partial<InternalPiHostRequest>,
  id: string | number,
  emit?: (message: PiHostMessage) => void,
): Promise<PiHostMessage[]> | undefined {
  if (!input.method?.startsWith('memory/v1/')) return undefined
  if (state.negotiatedProtocolVersion !== PI_HOST_PROTOCOL_VERSION || !state.memoryStoreNegotiated) {
    return Promise.resolve([errorResponse(id, 'protocol_mismatch', 'memory-store-v1 capability was not negotiated')])
  }
  const params = input.params || {}
  try {
    return executeDurableMemoryRequest(state, input.method, params, durableMemoryAccess(params.access), id, emit)
      .catch((error: unknown) => {
        const message = error instanceof Error ? error.message : 'Durable memory request failed'
        const code = error instanceof DurableMemoryStoreError
          ? error.code === 'invalid_input' ? 'invalid_request' : error.code
          : 'runtime_error'
        return [errorResponse(id, code, message)]
      })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Durable memory request failed'
    const code = error instanceof DurableMemoryStoreError
      ? error.code === 'invalid_input' ? 'invalid_request' : error.code
      : 'runtime_error'
    return Promise.resolve([errorResponse(id, code, message)])
  }
}

function handleCapabilityRequest(
  state: HostState,
  input: Partial<InternalPiHostRequest>,
  id: string | number,
): PiHostMessage[] | undefined {
  if (!input.method?.startsWith('capabilities/')) return undefined
  const sessionId = typeof input.params?.sessionId === 'string' ? input.params.sessionId : undefined
  const gate = workspaceTextSearchAvailability({
    sessionId,
    enabled: state.snapshot.settings.workspaceTextSearch === true,
    workspaceRoot: typeof input.params?.cwd === 'string' ? input.params.cwd : undefined,
  })
  if (input.method === 'capabilities/list') {
    return [{ id, result: { items: state.capabilities.catalog(sessionId)
      .filter((capability) => gate.available || !isWorkspaceTextSearchCapability(capability.id)) } }]
  }
  if (input.method === 'capabilities/search') {
    const query = typeof input.params?.query === 'string' ? input.params.query : ''
    if (!query.trim()) return [errorResponse(id, 'invalid_request', 'query is required')]
    return [{ id, result: { items: state.capabilities.search(
      query,
      sessionId,
      (capability) => gate.available || !isWorkspaceTextSearchCapability(capability.id),
    ) } }]
  }
  const capabilityId = typeof input.params?.id === 'string' ? input.params.id : ''
  if (!capabilityId) return [errorResponse(id, 'invalid_request', 'capability id is required')]
  if (isWorkspaceTextSearchCapability(capabilityId) && !gate.available) {
    return [errorResponse(id, 'invalid_request', gate.reason || 'Workspace text search is unavailable')]
  }
  try {
    return [{ id, result: { items: [state.capabilities.load(capabilityId, sessionId)], loaded: true } }]
  } catch (error) {
    return [errorResponse(id, 'invalid_request', error instanceof Error ? error.message : 'Unknown Pi capability')]
  }
}

function handleMemoryOrCapabilityRequest(
  state: HostState,
  input: Partial<InternalPiHostRequest>,
  id: string | number,
  emit?: (message: PiHostMessage) => void,
): PiHostMessage[] | Promise<PiHostMessage[]> | undefined {
  return handleDurableMemoryRequest(state, input, id, emit) || handleCapabilityRequest(state, input, id)
}

function frozenRunLearningCandidate(input: {
  prompt: string
  runId: string
  sessionId: string
  canonicalProject: string
  memoryAccess: MemoryAccessContext
  automaticLearning: boolean
}) {
  const candidate = buildPiTurnLearningCandidate(
    input.prompt,
    {
      runId: input.runId,
      sessionId: input.sessionId,
      project: input.canonicalProject,
    },
    input.automaticLearning,
  )
  if (!candidate) return undefined
  return {
    ...candidate,
    access: {
      runId: input.runId,
      sessionId: input.sessionId,
      memoryReadEnabled: input.memoryAccess.memoryReadEnabled,
      memoryWriteEnabled: input.memoryAccess.memoryWriteEnabled,
      temporary: input.memoryAccess.temporary,
      canonicalProject: input.canonicalProject,
    },
  }
}

export function handlePiHostRequest(
  state: HostState,
  request: unknown,
  emit?: (message: PiHostMessage) => void,
  checkpointWriter?: CompactionCheckpointWriter,
): PiHostMessage[] | Promise<PiHostMessage[]> {
  if (!request || typeof request !== 'object') {
    return [errorResponse('', 'invalid_request', 'Pi Host request must be an object')]
  }

  const input = request as Partial<InternalPiHostRequest>
  const invocationOrigin = input[INTERNAL_INVOCATION_ORIGIN] || 'direct-protocol'
  const id = typeof input.id === 'string' || typeof input.id === 'number' ? input.id : ''
  if (!input.method) return [errorResponse(id, 'invalid_request', 'Pi Host request method is required')]

  const initialization = handleInitialization(state, input, id)
  if (initialization) return initialization

  if (!state.initialized) return [errorResponse(id, 'not_initialized', 'Pi Host must be initialized first')]
  if (isPiHostLifecycleRequest(state, input.method)) {
    return handlePiHostLifecycleRequest(state, input.method, id)
  }
  if (input.method === 'runtime/status') return [{ id, result: piCoreRuntimeStatus() }]
  if (input.method === 'tools/list') {
    if (input.params?.requireContract === true && !state.toolContractNegotiated) {
      return [errorResponse(id, 'invalid_request', 'Pi Host tool catalog requires tool-contract-v1 negotiation')]
    }
    ensurePiPacksRegistered()
    const mcpExtensions = state.extensions.list().filter((extension) => extension.kind === 'mcp' && extension.mcp)
    const activeTools = state.snapshot.settings.activeTools
    const requestedSessionId = typeof input.params?.sessionId === 'string' ? input.params.sessionId : undefined
    const workspaceTextSearch = workspaceTextSearchAvailability({
      sessionId: requestedSessionId,
      enabled: state.snapshot.settings.workspaceTextSearch === true,
      workspaceRoot: typeof input.params?.cwd === 'string' ? input.params.cwd : undefined,
    })
    const unlocked = state.capabilities.activeTools(requestedSessionId)
      .filter((tool) => workspaceTextSearch.available || !isWorkspaceTextSearchTool(tool))
    const mcpCapabilityActive = state.capabilities.catalog(requestedSessionId)
      .find((capability) => capability.id === 'mcp-bridge')?.deferred === false
    const packEntries = piPackCatalogEntries({ activeTools, unlockedTools: [...unlocked] })
      .filter((entry) => workspaceTextSearch.available || !isWorkspaceTextSearchTool(entry.name))
    const builtinEntries: PiCatalogEntry[] = piCoreRuntimeToolCatalog().map((definition) => ({
      name: definition.name,
      description: definition.description,
      pack: 'builtin',
      source: 'discovered' as const,
      // Empty settings.activeTools means "everything on" (the historical
      // contract); a non-empty list is the user's explicit set.
      active: activeTools.length === 0 || activeTools.includes(definition.name),
      available: true,
      schemaDigest: schemaDigest(definition.parameters),
      ...(!(activeTools.length === 0 || activeTools.includes(definition.name)) ? { reason: `${definition.name} is disabled by Pi active tools settings` } : {}),
    }))
    const latestContract = (() => {
      const sessions = requestedSessionId
        ? state.snapshot.sessions.filter((session) => session.id === requestedSessionId)
        : state.snapshot.sessions
      return sessions.flatMap((session) => state.toolContracts.list(session.id)).sort((left, right) => right.revision - left.revision)[0]
    })()
    const applyContractFacts = (entries: PiCatalogEntry[]): PiCatalogEntry[] => {
      if (!latestContract) return entries
      const facts = new Map(latestContract.tools.map((tool) => [tool.name, tool]))
      return entries.map((entry) => {
        const fact = facts.get(entry.name)
        if (!fact) return entry
        if (entry.pack === 'mcp' && entry.available && entry.schemaDigest !== fact.schemaDigest) {
          return {
            ...entry,
            active: false,
            available: false,
            contractRevision: latestContract.revision,
            contractDigest: latestContract.contractDigest,
            reason: 'MCP tool stale: upstream schema changed after the frozen turn contract; reload applies on the next turn',
          }
        }
        if (!entry.available) return entry
        return {
          ...entry,
          active: fact.active,
          schemaDigest: fact.schemaDigest,
          contractRevision: latestContract.revision,
          contractDigest: latestContract.contractDigest,
          ...(fact.active ? { reason: undefined } : { reason: entry.reason || 'Inactive in the selected Pi turn contract' }),
        }
      })
    }
    return Promise.all(mcpExtensions.map(async (extension): Promise<PiCatalogEntry[]> => {
      const unavailable = (toolName: string, category: 'disabled' | 'missing' | 'schema-invalid' | 'transport-failed', detail: string): PiCatalogEntry => ({
        name: piMcpModelToolName(extension.id, toolName),
        description: 'Tool provided by an installed MCP extension',
        pack: 'mcp',
        source: 'installed',
        active: false,
        available: false,
        schemaDigest: schemaDigest({ unavailable: true, category, extensionId: extension.id, tool: toolName }),
        reason: `MCP ${category}: ${detail}`,
        extensionId: extension.id,
        upstreamToolName: toolName,
      })
      if (!extension.enabled) {
        return extension.tools.map((toolName) => unavailable(toolName, 'disabled', `extension ${extension.id} is disabled`))
      }
      try {
        const tools = await listPiMcpTools(extension.id, extension.mcp!)
        const entries = new Map<string, PiCatalogEntry>()
        const present = new Set<string>()
        for (const tool of tools) {
          if (typeof tool.name !== 'string' || !tool.name.trim()) continue
          present.add(tool.name)
          if (!isPiMcpInputSchema(tool.inputSchema)) {
            entries.set(tool.name, unavailable(tool.name, 'schema-invalid', `tool ${tool.name} did not provide a valid object input schema`))
            continue
          }
          entries.set(tool.name, {
            name: piMcpModelToolName(extension.id, tool.name),
            description: typeof tool.description === 'string' ? tool.description : 'Tool provided by an installed MCP extension',
            pack: 'mcp',
            source: 'installed',
            active: false,
            available: true,
            schemaDigest: schemaDigest(tool.inputSchema),
            extensionId: extension.id,
            upstreamToolName: tool.name,
          })
        }
        for (const toolName of extension.tools) {
          if (!present.has(toolName)) entries.set(toolName, unavailable(toolName, 'missing', `declared tool ${toolName} was not returned by the server`))
        }
        return [...entries.values()]
      } catch (error) {
        const reason = error instanceof Error ? error.message : 'MCP server did not provide a trusted schema'
        return extension.tools.map((toolName) => unavailable(toolName, 'transport-failed', reason))
      }
    })).then((discovered) => {
      const flattened = discovered.flat()
      const assigned = piMcpModelToolNames(flattened.flatMap((entry) => entry.extensionId && entry.upstreamToolName
        ? [{ extensionId: entry.extensionId, upstreamToolName: entry.upstreamToolName }]
        : []))
      const mcpEntries = flattened.map((entry): PiCatalogEntry => {
        if (!entry.extensionId || !entry.upstreamToolName) return entry
        const name = assigned.get(`${entry.extensionId}\u0000${entry.upstreamToolName}`) || entry.name
        const active = entry.available && (mcpCapabilityActive || activeTools.includes(name))
        return {
          ...entry,
          name,
          active,
          ...(entry.available && !active ? { reason: 'Inactive this turn: load the mcp-bridge capability' } : {}),
        }
      })
      // One list, three sources beside each other with their own facts
      // carried per entry (issue 03). Sorted by name so the union reads
      // stably regardless of which source answered first.
      const catalog = applyContractFacts([...builtinEntries, ...packEntries, ...mcpEntries]).sort((left, right) => left.name.localeCompare(right.name))
      // Remember what was described, so a later call to a tool the frozen
      // contract does not carry can still be identified and refused by name.
      state.catalogProjection = new Map(catalog.map((entry) => [entry.name, entry]))
      return [{ id, result: {
        builtinTools: catalog.filter((entry) => entry.available && entry.active).map((entry) => entry.name),
        catalog,
        ...(latestContract ? { catalogContractRevision: latestContract.revision, catalogContractDigest: latestContract.contractDigest } : {}),
      } }]
    })
  }
  if (input.method === 'tools/contract') {
    if (!state.toolContractNegotiated) return [errorResponse(id, 'invalid_request', 'Client did not negotiate tool-contract-v1')]
    const sessionId = typeof input.params?.sessionId === 'string' ? input.params.sessionId : ''
    const revision = typeof input.params?.revision === 'number' ? input.params.revision : Number(input.params?.revision)
    const toolName = typeof input.params?.toolName === 'string' ? input.params.toolName : ''
    const lookup = state.toolContracts.lookup(sessionId, revision, toolName)
    if (!lookup.ok) return [errorResponse(id, lookup.code, lookup.message)]
    return [{ id, result: { contract: lookup.contract, contractTool: lookup.tool, revisionStatus: lookup.status } }]
  }
  if (input.method === 'tools/pack') {
    const params = input.params || {}
    const name = typeof params.name === 'string' ? params.name : ''
    const definition = findPiPackTool(name)
    if (!definition) return [errorResponse(id, 'invalid_request', `Unknown Pi extension tool: ${name}`)]
    if (isWorkspaceTextSearchTool(name)) {
      const explicitWorkspaceRoot = typeof params.cwd === 'string' && params.cwd.trim() ? params.cwd : undefined
      if (!explicitWorkspaceRoot) {
        return [errorResponse(id, 'invalid_request', '工作區文字檢索需要明確的 workspace cwd；不允許使用 process.cwd() fallback。')]
      }
      const gate = workspaceTextSearchAvailability({
        sessionId: typeof params.sessionId === 'string' ? params.sessionId : undefined,
        enabled: state.snapshot.settings.workspaceTextSearch === true,
        workspaceRoot: explicitWorkspaceRoot,
      })
      if (!gate.available) {
        return [errorResponse(id, 'invalid_request', gate.reason || 'Workspace text search is unavailable')]
      }
    }
    const rawArgs = (params.arguments && typeof params.arguments === 'object' && !Array.isArray(params.arguments) ? params.arguments : {}) as Record<string, unknown>
    const sessionId = typeof params.sessionId === 'string' ? params.sessionId : 'direct'
    const runId = typeof params.runId === 'string' ? params.runId : String(id)
    const callId = typeof params.callId === 'string' ? params.callId : runId
    const cwd = typeof params.cwd === 'string' ? params.cwd : process.cwd()
    const hasCurrentContract = typeof params.sessionId === 'string' && Boolean(state.toolContracts.latest(params.sessionId))
    const validation = hasCurrentContract || params.contractRevision !== undefined || params.schemaDigest !== undefined
      ? validateDirectToolCall(state, name, {
          cwd,
          ...(typeof params.sessionId === 'string' ? { sessionId: params.sessionId } : {}),
          runId,
          callId,
          ...(typeof params.contractRevision === 'number' ? { contractRevision: params.contractRevision } : {}),
          ...(typeof params.schemaDigest === 'string' ? { schemaDigest: params.schemaDigest } : {}),
        }, rawArgs)
      : validatePiToolArguments(definition.tool.parameters, rawArgs)
    if (!validation.ok) {
      const reason = `${name} parameters are invalid: ${validation.message}`
      return contractValidationFailure({
        state,
        sessionId: typeof params.sessionId === 'string' ? params.sessionId : undefined,
        runId,
        callId,
        parentRunId: typeof params.parentRunId === 'string' ? params.parentRunId : undefined,
        tool: name,
        origin: invocationOrigin,
        reason,
        id,
        emit,
      })
    }
    const args = validation.arguments
    const updates: PiHostEvent[] = []
    const publish = (event: PiHostEvent) => {
      recordToolAudit(state, params.sessionId, event)
      if (emit) emit(event); else updates.push(event)
    }
    return (async () => {
      const parentRunId = typeof params.parentRunId === 'string' ? params.parentRunId : undefined
      const foundIdentity = typeof params.sessionId === 'string'
        ? contractIdentityForCurrentTool(state, sessionId, name)
        : undefined
      const ctx = { sessionId, cwd, runId }
      const approvalPlan = definition.tool.approval?.(args, ctx)
      const requirements: PiToolPolicyRequirements = {
        ...(definition.tool.policyMigration || {}),
        ...(approvalPlan?.need && !definition.tool.policyMigration?.capabilityApproval
          && !definition.tool.policyMigration?.approvalRequired
          ? { approvalRequired: approvalPlan.reason, sideEffect: true }
          : {}),
      }
      const detachedIdentity: PiInvocationContractIdentity = {
        contractRevision: 1,
        contractDigest: schemaDigest({ compatibility: 'direct-pack', tool: name, schema: definition.tool.parameters }),
        schemaDigest: schemaDigest(definition.tool.parameters),
        toolSource: 'extension-pack',
        toolPack: definition.pack.id,
      }
      const authorized = await authorizeContractInvocation({
        state, sessionId, runId, callId, parentRunId, cwd, tool: name, args,
        origin: invocationOrigin,
        approval: params.approval,
        requirements,
        identity: foundIdentity?.identity || detachedIdentity,
      })
      if ('contractError' in authorized) return [errorResponse(id, 'invalid_request', authorized.contractError)]
      const authorization: InvocationAuthorization = authorized
      const executionArgs = authorized.args
      const identity = authorization.identity
      const identityPayload = identity ? { ...identity, invocationOrigin } : {}
      publish({ event: 'host/tool-start', payload: { runId, tool: name, callId, parentRunId, ...identityPayload } })
      if (!authorization.ok) {
        publish({ event: 'host/tool-decision', payload: {
          runId, tool: name, callId, parentRunId, decision: authorization.decision,
          ...(authorization.settlement ? { settlement: authorization.settlement } : {}),
          reason: authorization.reason,
          ...identityPayload,
        } })
        if (authorization.settlement) publish({ event: 'host/tool-result', payload: {
          runId, tool: name, callId, parentRunId, settlement: authorization.settlement,
          reason: authorization.reason,
          ...identityPayload,
        } })
        return [...updates, errorResponse(id, 'invalid_request', authorization.decision === 'ask'
          ? `Approval required: ${authorization.reason}`
          : authorization.reason)]
      }
      publish({ event: 'host/tool-decision', payload: {
        runId, tool: name, callId, parentRunId, decision: 'allow', reason: authorization.reason, ...identityPayload,
      } })
      const outcome = await executePiPackTool(name, executionArgs, { sessionId, cwd, runId }, {
        callId,
      })
      const structuredFailure = Boolean(outcome.data && typeof outcome.data === 'object'
        && (outcome.data as { ok?: unknown }).ok === false)
      const resultOk = outcome.ok && !structuredFailure
      authorization.evidence.update(resultOk ? 'Extension Pack execution completed' : outcome.text)
      authorization.evidence.result(resultOk, resultOk ? 'structured result returned' : outcome.text)
      authorization.evidence.settle(outcome.denied ? 'denied' : resultOk ? 'success' : 'failed', resultOk ? undefined : outcome.text)
      publish({ event: 'host/tool-result', payload: {
        runId, tool: name, callId, parentRunId,
        settlement: outcome.denied ? 'denied' as const : resultOk ? 'success' as const : 'failed' as const,
        item: outcome.data ?? { text: outcome.text },
        ...(outcome.ok ? {} : { reason: outcome.text }),
        ...identityPayload,
      } })
      if (!outcome.ok && !outcome.denied) return [...updates, errorResponse(id, 'invalid_request', outcome.text)]
      return [...updates, { id, result: { tool: name, content: [{ type: 'text', text: outcome.text }], ...(outcome.data !== undefined ? { item: outcome.data } : {}) } }]
    })()
  }
  if (input.method === 'approvals/resolve') {
    const resolved = resolvePiApproval(input.params || {})
    if (!resolved) return [errorResponse(id, 'invalid_request', 'No pending Pi approval matches runId and callId')]
    return [{ id, result: { resolved: true } }]
  }
  if (input.method === 'tools/mcp') {
    const extensionId = typeof input.params?.extensionId === 'string' ? input.params.extensionId : ''
    const toolName = typeof input.params?.toolName === 'string' ? input.params.toolName : ''
    const args = input.params?.arguments
    const extension = state.extensions.list().find((candidate) => candidate.id === extensionId && candidate.kind === 'mcp' && candidate.enabled)
    if (!extension?.mcp || !toolName || !args || typeof args !== 'object' || Array.isArray(args)) return [errorResponse(id, 'invalid_request', 'enabled MCP extensionId, toolName, and arguments are required')]
    const mcpConfig = extension.mcp
    const runId = typeof input.params?.runId === 'string' ? input.params.runId : String(id)
    const callId = typeof input.params?.callId === 'string' ? input.params.callId : runId
    return (async () => {
      const sessionId = typeof input.params?.sessionId === 'string' ? input.params.sessionId : 'direct'
      const cwd = typeof input.params?.cwd === 'string' ? input.params.cwd : process.cwd()
      const discovered = await listPiMcpTools(extension.id, mcpConfig)
      const upstream = discovered.find((candidate) => candidate.name === toolName)
      if (!upstream || !isPiMcpInputSchema(upstream.inputSchema)) return [errorResponse(id, 'invalid_request', `Unknown or schema-invalid MCP tool: ${toolName}`)]
      const tool = piMcpModelToolName(extension.id, toolName)
      const current = contractIdentityForCurrentTool(state, sessionId, tool)?.identity
      const inputDigest = schemaDigest(upstream.inputSchema)
      const identity: PiInvocationContractIdentity = current || {
        contractRevision: 1,
        contractDigest: schemaDigest({ compatibility: 'tools/mcp', extensionId: extension.id, toolName, inputDigest }),
        schemaDigest: inputDigest,
        toolSource: 'mcp',
        toolPack: `mcp-${extension.id}`,
      }
      const validation = validatePiToolArguments(upstream.inputSchema, args as Record<string, unknown>)
      if (!validation.ok) return [errorResponse(id, 'invalid_request', `${tool} parameters are invalid: ${validation.message}`)]
      const authorization = await authorizeContractInvocation({
        state, sessionId, runId, callId, cwd, tool,
        args: validation.arguments,
        origin: 'direct-protocol',
        approval: input.params?.approval,
        requirements: { outbound: true, sideEffect: true, approvalRequired: `MCP ${extension.id}/${toolName} requires approval` },
        identity,
      })
      if ('contractError' in authorization) return [errorResponse(id, 'invalid_request', authorization.contractError)]
      const updates: PiHostEvent[] = []
      const publish = (event: PiHostEvent) => {
        recordToolAudit(state, typeof input.params?.sessionId === 'string' ? sessionId : undefined, event)
        if (emit) emit(event); else updates.push(event)
      }
      const identityPayload = { ...identity, invocationOrigin: 'direct-protocol' as const }
      publish({ event: 'host/tool-start', payload: { runId, tool, callId, ...identityPayload } })
      if (!authorization.ok) {
        publish({ event: 'host/tool-decision', payload: { runId, tool, callId, decision: authorization.decision, ...(authorization.settlement ? { settlement: authorization.settlement } : {}), reason: authorization.reason, ...identityPayload } })
        if (authorization.settlement) publish({ event: 'host/tool-result', payload: { runId, tool, callId, settlement: authorization.settlement, reason: authorization.reason, ...identityPayload } })
        return [...updates, errorResponse(id, 'invalid_request', authorization.decision === 'ask' ? `Approval required: ${authorization.reason}` : authorization.reason)]
      }
      publish({ event: 'host/tool-decision', payload: { runId, tool, callId, decision: 'allow', reason: authorization.reason, ...identityPayload } })
      try {
        const content = await callPiMcpTool(extension.id, mcpConfig, toolName, authorization.args)
        authorization.evidence.update('MCP execution completed')
        authorization.evidence.result(true, 'result returned')
        authorization.evidence.settle('success')
        publish({ event: 'host/tool-result', payload: { runId, tool, callId, settlement: 'success', item: { content }, ...identityPayload } })
        return [...updates, { id, result: { tool, content: [{ type: 'text', text: content }] } }]
      } catch (error) {
        const reason = error instanceof Error ? error.message : 'MCP tool failed'
        authorization.evidence.result(false, reason)
        authorization.evidence.settle('failed', reason)
        publish({ event: 'host/tool-result', payload: { runId, tool, callId, settlement: 'failed', reason, ...identityPayload } })
        return [...updates, errorResponse(id, 'invalid_request', reason)]
      }
    })()
  }
  if (input.method === 'tools/code') {
    const params = input.params || {}
    if (typeof params.cwd !== 'string' || typeof params.code !== 'string') return [errorResponse(id, 'invalid_request', 'cwd and code are required')]
    const codeCwd = params.cwd
    const runId = typeof params.runId === 'string' ? params.runId : String(id)
    const codeSessionId = typeof params.sessionId === 'string' ? params.sessionId : 'direct'
    const contract = state.toolContracts.latest(codeSessionId)
    if (!contract) return [errorResponse(id, 'tool_contract_not_found', `No current tool contract exists for session: ${codeSessionId}`)]
    const claimedRevision = typeof params.contractRevision === 'number' ? params.contractRevision : contract.revision
    if (claimedRevision !== contract.revision) return [errorResponse(id, 'tool_contract_stale', `Tool contract revision ${claimedRevision} is not current; current is ${contract.revision}`)]
    const runCodeContract = state.toolContracts.lookup(codeSessionId, contract.revision, 'run_code')
    if (!runCodeContract.ok) return [errorResponse(id, runCodeContract.code, runCodeContract.message)]
    if (typeof params.schemaDigest === 'string' && params.schemaDigest !== runCodeContract.tool.schemaDigest) {
      return [errorResponse(id, 'invalid_request', 'Tool schema digest mismatch for run_code')]
    }
    const codeValidation = validatePiToolArguments(runCodeContract.tool.parameters, {
      code: params.code,
      ...(typeof params.maxToolCalls === 'number' ? { maxToolCalls: params.maxToolCalls } : {}),
      ...(typeof params.timeoutMs === 'number' ? { timeoutMs: params.timeoutMs } : {}),
    })
    if (!codeValidation.ok) return [errorResponse(id, 'invalid_request', `run_code parameters are invalid: ${codeValidation.message}`)]
    return (async () => {
      const outerCallId = typeof params.callId === 'string' ? params.callId : `${runId}:code`
      let outerAuthorization: InvocationAuthorization | undefined
      if (!input[INTERNAL_OUTER_CODE_APPROVED]) {
      const authorized = await authorizeContractInvocation({
        state,
        sessionId: codeSessionId,
        runId,
        callId: outerCallId,
        cwd: codeCwd,
        tool: 'run_code',
        args: codeValidation.arguments,
        origin: 'direct-protocol',
        approval: params.approval,
        requirements: { sideEffect: true, approvalRequired: 'run_code requires approval before execution' },
      })
      if ('contractError' in authorized) return [errorResponse(id, 'invalid_request', authorized.contractError)]
      if (!authorized.ok) return [errorResponse(id, 'invalid_request', authorized.decision === 'ask' ? `Approval required: ${authorized.reason}` : authorized.reason)]
      outerAuthorization = authorized
      }
      // Snapshot the surrounding contract once. Capability changes cannot add a
    // new callable name to a script that already started.
    const activeTools = contract.tools.filter((tool) => tool.active).map((tool) => tool.name)
    let nestedSequence = 0
      return runPiCodeMode({
      runId,
      code: String(codeValidation.arguments.code),
      activeTools,
      maxToolCalls: typeof codeValidation.arguments.maxToolCalls === 'number' ? codeValidation.arguments.maxToolCalls : undefined,
      timeoutMs: typeof codeValidation.arguments.timeoutMs === 'number' ? codeValidation.arguments.timeoutMs : undefined,
      callTool: async (toolName, args) => {
        const nestedId = `${String(id)}:code:${nestedSequence++}`
        const nestedContract = contract.tools.find((tool) => tool.name === toolName && tool.active)
        if (!nestedContract) throw new Error(`Tool «${toolName}» is not active in this Pi turn contract.`)
        let nestedRequest: InternalPiHostRequest
        if (findPiPackTool(toolName)) {
          nestedRequest = {
            id: nestedId,
            method: 'tools/pack',
            params: {
              name: toolName,
              arguments: args,
              cwd: codeCwd,
              sessionId: codeSessionId,
              runId,
              callId: nestedId,
              parentRunId: runId,
              contractRevision: contract.revision,
              schemaDigest: nestedContract.schemaDigest,
            },
          }
        } else {
          if (!piCoreRuntimeStatus().builtinTools.includes(toolName)) throw new Error(`Unknown Pi tool: ${toolName}`)
          nestedRequest = {
            id: nestedId,
            method: `tools/${toolName}` as PiHostRequest['method'],
            params: {
              ...args,
              cwd: codeCwd,
              sessionId: codeSessionId,
              runId,
              callId: nestedId,
              parentRunId: runId,
              contractRevision: contract.revision,
              schemaDigest: nestedContract.schemaDigest,
            },
          }
        }
        nestedRequest[INTERNAL_INVOCATION_ORIGIN] = 'code-mode'
        // Deliberately no approval field: the outer run_code decision never
        // authorizes a nested effectful invocation.
        const nested = await handlePiHostRequest(state, nestedRequest, emit)
        const response = nested.find((message) => !('event' in message) && message.id === nestedId) as PiHostResponse | undefined
        if (!response || response.error) throw new Error(response?.error?.message || `Pi nested tool failed: ${toolName}`)
        return JSON.stringify(response.result?.content ?? response.result ?? null)
      },
    }).then((result) => {
      if (outerAuthorization) {
        const succeeded = result.settlement === 'success'
        outerAuthorization.evidence.update(`Code Mode ${result.settlement}`)
        outerAuthorization.evidence.result(succeeded, result.content)
        outerAuthorization.evidence.settle(result.settlement === 'cancelled' ? 'cancelled' : succeeded ? 'success' : 'failed', result.content)
      }
      return [{ id, result: { tool: 'code', runId, settlement: result.settlement, content: [{ type: 'text', text: result.content }], code: result.content, items: [{ toolCallCount: result.toolCallCount, logs: result.logs }] } }]
      })
    })()
  }
  if (input.method === 'tools/read' || input.method === 'tools/grep' || input.method === 'tools/find' || input.method === 'tools/ls' || input.method === 'tools/write' || input.method === 'tools/edit' || input.method === 'tools/bash') {
    const params = input.params || {}
    const split = splitDirectToolRequest(id, params)
    if (!split.ok) return [errorResponse(id, 'invalid_request', split.message)]
    const toolName = input.method.slice('tools/'.length) as PiBuiltinToolName
    if (state.snapshot.settings.activeTools.length > 0 && !state.snapshot.settings.activeTools.includes(toolName)) return [errorResponse(id, 'invalid_request', `${toolName} is disabled by Pi active tools settings`)]
    const validation = validateDirectToolCall(state, toolName, split.envelope, split.arguments)
    if (!validation.ok) return contractValidationFailure({
      state,
      sessionId: split.envelope.sessionId,
      runId: split.envelope.runId,
      callId: split.envelope.callId,
      parentRunId: split.envelope.parentRunId,
      tool: toolName,
      origin: invocationOrigin,
      reason: validation.message,
      id,
      emit,
    })
    const args = validation.arguments
    const { envelope } = split
    const { runId, callId } = envelope
    const updates: PiHostEvent[] = []
    const publish = (event: PiHostEvent) => {
      recordToolAudit(state, envelope.sessionId, event)
      if (emit) emit(event)
      else updates.push(event)
    }
    const sideEffect = toolName === 'write' || toolName === 'edit' || toolName === 'bash'
    const bashDecision = toolName === 'bash'
      ? decideBashAction(String(args.command || ''), () => 'allow', state.snapshot.settings.bashRequireAsk ? 'ask' : 'allow')
      : undefined
    return (async () => {
      const foundIdentity = envelope.sessionId
        ? contractIdentityForCurrentTool(state, envelope.sessionId, toolName)
        : undefined
      const builtinDefinition = piCoreRuntimeToolCatalog(envelope.cwd).find((candidate) => candidate.name === toolName)
      const detachedIdentity: PiInvocationContractIdentity = {
        contractRevision: 1,
        contractDigest: schemaDigest({ compatibility: 'direct-builtin', tool: toolName, schema: builtinDefinition?.parameters || {} }),
        schemaDigest: schemaDigest(builtinDefinition?.parameters || {}),
        toolSource: 'builtin',
      }
      let executionArgs = args
      const requirements: PiToolPolicyRequirements = {
        ...(toolName !== 'bash' ? { pathArguments: ['path'] } : {}),
        ...(toolName === 'bash' ? { outbound: true } : {}),
        ...(sideEffect ? { sideEffect: true, approvalRequired: bashDecision?.reason || `${toolName} requires approval before execution` } : {}),
        // A dangerous or unsplittable command asks REGARDLESS of Approval
        // Mode. `approvalRequired` alone is bypassed by `full`, which would let
        // the broad mode silently widen exactly the commands `bashRequireAsk`
        // exists to stop; `capabilityApproval` is the channel that survives
        // complete access, so the segment-aware decision travels on it.
        ...(bashDecision?.action === 'ask' ? { capabilityApproval: bashDecision.reason } : {}),
      }
      const authorized = await authorizeContractInvocation({
        state, sessionId: envelope.sessionId || 'direct', runId, callId,
        parentRunId: envelope.parentRunId,
        cwd: envelope.cwd,
        tool: toolName,
        args,
        origin: invocationOrigin,
        approval: envelope.approval,
        requirements,
        identity: foundIdentity?.identity || detachedIdentity,
      })
      if ('contractError' in authorized) return [errorResponse(id, 'invalid_request', authorized.contractError)]
      const authorization: InvocationAuthorization = authorized
      executionArgs = authorized.args
      const identity = authorization.identity
      const identityPayload = identity ? { ...identity, invocationOrigin } : {}
      const scopedPath = typeof executionArgs.path === 'string' ? executionArgs.path : undefined
      publish({ event: 'host/tool-start', payload: {
        runId, tool: toolName, callId, parentRunId: envelope.parentRunId,
        item: scopedPath ? { path: scopedPath } : undefined,
        ...identityPayload,
      } })
      if (bashDecision?.action === 'deny') {
        authorization?.evidence.result(false, bashDecision.reason)
        authorization?.evidence.settle('denied', bashDecision.reason)
        publish({ event: 'host/tool-decision', payload: { runId, tool: toolName, callId, parentRunId: envelope.parentRunId, decision: 'deny', settlement: 'denied', reason: bashDecision.reason, ...identityPayload } })
        publish({ event: 'host/tool-result', payload: { runId, tool: toolName, callId, parentRunId: envelope.parentRunId, settlement: 'denied', reason: bashDecision.reason, ...identityPayload } })
        return [...updates, errorResponse(id, 'invalid_request', `bash denied: ${bashDecision.reason}`)]
      }
      if (!authorization.ok) {
        publish({ event: 'host/tool-decision', payload: {
          runId, tool: toolName, callId, parentRunId: envelope.parentRunId,
          decision: authorization.decision,
          ...(authorization.settlement ? { settlement: authorization.settlement } : {}),
          reason: authorization.reason,
          ...identityPayload,
        } })
        if (authorization.settlement) publish({ event: 'host/tool-result', payload: {
          runId, tool: toolName, callId, parentRunId: envelope.parentRunId,
          settlement: authorization.settlement,
          reason: authorization.reason,
          ...identityPayload,
        } })
        return [...updates, errorResponse(id, 'invalid_request', authorization.decision === 'ask'
          ? `Approval required: ${authorization.reason}`
          : authorization.reason)]
      }
      if (sideEffect) publish({ event: 'host/tool-decision', payload: {
        runId, tool: toolName, callId, parentRunId: envelope.parentRunId,
        decision: 'allow', reason: authorization.reason, ...identityPayload,
      } })
      const executionRoot = envelope.sessionId
        ? frozenPolicyForInvocation(state, envelope.sessionId, envelope.cwd).outbound.restrictedViewRoot || envelope.cwd
        : envelope.cwd
      if (scopedPath && !isWithinProject(executionRoot, scopedPath)) {
        const reason = `${toolName} path is outside the requested project scope`
        authorization?.evidence.result(false, reason)
        authorization?.evidence.settle('failed', reason)
        publish({ event: 'host/tool-result', payload: { runId, tool: toolName, callId, parentRunId: envelope.parentRunId, settlement: 'failed', reason, ...identityPayload } })
        return [...updates, errorResponse(id, 'invalid_request', reason)]
      }
      let updateBytes = 0
      let updateTruncated = false
      try {
        const result = await executePiTool(toolName, executionRoot, executionArgs, {
          runId: typeof params.runId === 'string' ? runId : undefined,
          onUpdate: (item) => {
            if (typeof params.runId !== 'string' || updateTruncated) return
            const serialized = JSON.stringify(item)
            const serializedBytes = Buffer.byteLength(serialized, 'utf8')
            const remaining = PI_HOST_TOOL_UPDATE_MAX_BYTES - updateBytes
            if (serializedBytes <= remaining) {
              updateBytes += serializedBytes
              publish({ event: 'host/tool-update', payload: { runId, tool: toolName, callId, item } })
            } else {
              updateTruncated = true
              const spill = writeToolOutputSpill({ runId, tool: toolName, output: serialized, projectRoot: executionRoot })
              publish({ event: 'host/tool-update', payload: { runId, tool: toolName, callId, item: {
                type: 'truncated',
                content: Buffer.from(serialized, 'utf8').subarray(0, Math.max(0, remaining)).toString('utf8'),
                originalBytes: serializedBytes,
                spill,
              } } })
            }
          },
        })
        const settlement = result.cancelled ? 'cancelled' as const : 'success' as const
        authorization?.evidence.update(result.cancelled ? 'Builtin execution cancelled' : 'Builtin execution completed')
        authorization?.evidence.result(!result.cancelled, result.cancelled ? 'cancelled' : 'result returned')
        authorization?.evidence.settle(settlement)
        publish({ event: 'host/tool-result', payload: { runId, tool: toolName, callId, parentRunId: envelope.parentRunId, settlement, item: result, ...identityPayload } })
        return result.cancelled
          ? [...updates, { id, result: { runId, settlement: 'cancelled' as const, tool: toolName, content: result.content } }]
          : [...updates, { id, result: { tool: toolName, content: result.content } }]
      } catch (error) {
        const reason = error instanceof Error ? error.message : `Pi ${toolName} failed`
        authorization?.evidence.result(false, reason)
        authorization?.evidence.settle('failed', reason)
        publish({ event: 'host/tool-result', payload: { runId, tool: toolName, callId, parentRunId: envelope.parentRunId, settlement: 'failed', reason, ...identityPayload } })
        return [...updates, errorResponse(id, 'invalid_request', reason)]
      }
    })()
  }
  if (input.method === 'state/snapshot') {
    return listPiMemories(state.memoryStore).then((memories) => [{ id, result: { cursor: state.snapshot.cursor, sessions: [...state.snapshot.sessions], queue: state.snapshot.queue.map((item) => ({ ...item, profile: { ...item.profile } })), resources: state.snapshot.resources.map((resource) => ({ ...resource })), memories } }])
  }
  const attachmentResponse = handleAttachmentRequest(state, input, id, emit)
  if (attachmentResponse) return attachmentResponse
  // The list carries what a session IS, not everything it did: a long run's
  // record is read a page at a time through `sessions/record`, so listing
  // sessions cannot grow with the length of their history.
  if (input.method === 'sessions/list') return [{ id, result: { sessions: state.snapshot.sessions.map(projectSessionSummary) } }]
  if (input.method === 'sessions/record') {
    const sessionId = typeof input.params?.sessionId === 'string' ? input.params.sessionId : ''
    const session = state.snapshot.sessions.find((candidate) => candidate.id === sessionId)
    if (!session) return [errorResponse(id, 'invalid_request', 'Unknown Pi session')]
    const before = typeof input.params?.before === 'number' ? input.params.before : undefined
    const limit = typeof input.params?.limit === 'number' ? input.params.limit : undefined
    return [{ id, result: { sessionId, page: pageTurnRecord(session.record, { before, limit }) } }]
  }
  if (input.method === 'resources/list') {
    // Skills come straight from what the resource loader actually found on
    // its last reload, so the registry describes reality instead of an empty
    // array (issue 02). A skill archived via disable-model-invocation stays
    // listed here while staying out of <available_skills>.
    const found = discoveredPiSkills()
    // Each skill entry carries its own availability fact (issue 03/17):
    // with `read` disabled the whole advertised block disappears from the
    // prompt, and the projection says exactly that per entry.
    const readActive = state.snapshot.settings.activeTools.length === 0 || state.snapshot.settings.activeTools.includes('read')
    const skillResources: Array<PiResource & { reason?: string }> = found.skills
      .filter((skill) => skill.name)
      .map((skill) => ({
        id: skill.name,
        kind: 'skill' as const,
        source: skill.filePath,
        enabled: !skill.disableModelInvocation,
        ...(!readActive && !skill.disableModelInvocation ? { reason: 'read 工具未啟用：此技能在 run 中不可用' } : {}),
      }))
    return [{ id, result: { resources: [...skillResources, ...state.snapshot.resources.map((resource) => ({ ...resource }))].sort((left, right) => left.id.localeCompare(right.id)), ...(found.diagnostics.length ? { diagnostics: found.diagnostics.map((diagnostic) => ({ path: diagnostic.path, message: diagnostic.message })) } : {}) } }]
  }
  if (input.method === 'resources/reload') {
    const resources = input.params?.resources
    if (!Array.isArray(resources)) return [errorResponse(id, 'invalid_request', 'resources must be an array')]
    const registry = new PiResourceRegistry()
    try {
      registry.reload(resources as PiResource[])
    } catch (error) {
      return [errorResponse(id, 'invalid_request', error instanceof Error ? error.message : 'Invalid Pi resources')]
    }
    state.snapshot.resources = registry.list(); state.snapshot.cursor += 1
    return [{ id, result: { resources: state.snapshot.resources.map((resource) => ({ ...resource })) } }]
  }
  if (input.method === 'resources/sync-skills') {
    // One-way migration from the renderer's localStorage copy into the
    // Host-owned skills directory. Per-skill results travel back so a partial
    // migration is visible rather than assumed (issue 16).
    const skills = input.params?.skills
    if (!Array.isArray(skills)) return [errorResponse(id, 'invalid_request', 'skills must be an array')]
    return syncPiSkillsFromRenderer(resolvePiAgentDir(), skills as never).then((report) => ({
      id,
      result: { report: { skillsDir: report.skillsDir, results: report.results } },
    })).catch((error: unknown) => errorResponse(id, 'runtime_error', error instanceof Error ? error.message : 'Skill sync failed')).then((message) => [message])
  }
  if (input.method === 'resources/read-skill-files') {
    // The renderer projects the Host-owned skills directory into the 技能庫
    // (ADR-0034: Pi is the only discovery system). Read-only by contract —
    // writes go back through resources/sync-skills.
    return readPiSkillFiles(resolvePiAgentDir()).then((files) => ({
      id,
      result: { files },
    })).catch((error: unknown) => errorResponse(id, 'runtime_error', error instanceof Error ? error.message : 'Skill file read failed')).then((message) => [message])
  }
  if (['memory/list', 'memory/add', 'memory/delete', 'memory/clear', 'memory/recall'].includes(input.method)) {
    const events: PiHostMessage[] = []
    return handleLegacyMemory(state.memoryStore, input.method, input.params || {}, (change) => publishPiMemoryChange(state, change, emit || ((event) => events.push(event))))
      .then((memories) => [...events, { id, result: { memories } }])
      .catch((error) => [errorResponse(id, error instanceof DurableMemoryStoreError && error.code === 'invalid_input' ? 'invalid_request' : 'runtime_error', error instanceof Error ? error.message : 'Memory operation failed')])
  }
  const capabilityResponse = handleMemoryOrCapabilityRequest(state, input, id, emit)
  if (capabilityResponse) return capabilityResponse
  if (input.method === 'extensions/list') return [{ id, result: { extensions: state.extensions.list() } }]
  if (input.method === 'extensions/install' || input.method === 'extensions/update' || input.method === 'extensions/reload') {
    try {
      const extension = input.method === 'extensions/install'
        ? state.extensions.install(input.params || {})
        : state.extensions.update(input.params || {})
      const action = input.method === 'extensions/install' ? 'installed' as const : 'updated' as const
      if (extension.kind === 'mcp') reloadPiMcp(extension.id)
      const event: PiHostEvent = { event: 'host/extension', payload: { action, extension } }
      if (emit) emit(event)
      state.snapshot.extensions = state.extensions.list()
      state.snapshot.cursor += 1
      return [...(emit ? [] : [event]), { id, result: { extension } }]
    } catch (error) {
      return [errorResponse(id, 'invalid_request', error instanceof Error ? error.message : 'Invalid Pi extension')]
    }
  }
  if (input.method === 'extensions/set-enabled') {
    const extensionId = typeof input.params?.id === 'string' ? input.params.id : ''
    if (!extensionId || typeof input.params?.enabled !== 'boolean') return [errorResponse(id, 'invalid_request', 'id and enabled are required')]
    try {
      const extension = state.extensions.setEnabled(extensionId, input.params.enabled)
      if (extension.kind === 'mcp') reloadPiMcp(extension.id)
      const event: PiHostEvent = { event: 'host/extension', payload: { action: extension.enabled ? 'enabled' : 'disabled', extension } }
      if (emit) emit(event)
      state.snapshot.extensions = state.extensions.list(); state.snapshot.cursor += 1
      return [...(emit ? [] : [event]), { id, result: { extension } }]
    } catch (error) {
      return [errorResponse(id, 'invalid_request', error instanceof Error ? error.message : 'Unknown Pi extension')]
    }
  }
  if (input.method === 'extensions/uninstall') {
    const extensionId = typeof input.params?.id === 'string' ? input.params.id : ''
    if (!extensionId) return [errorResponse(id, 'invalid_request', 'id is required')]
    const extension = state.extensions.list().find((candidate) => candidate.id === extensionId)
    if (!extension) return [errorResponse(id, 'invalid_request', `Unknown Pi extension: ${extensionId}`)]
    try {
      state.extensions.uninstall(extensionId)
      if (extension.kind === 'mcp') stopPiMcp(extensionId)
      const event: PiHostEvent = { event: 'host/extension', payload: { action: 'uninstalled', extension } }
      if (emit) emit(event)
      state.snapshot.extensions = state.extensions.list(); state.snapshot.cursor += 1
      return [...(emit ? [] : [event]), { id, result: { removed: true } }]
    } catch (error) {
      return [errorResponse(id, 'invalid_request', error instanceof Error ? error.message : 'Unable to uninstall Pi extension')]
    }
  }
    if (input.method === 'runs/list') return [{ id, result: { queue: state.snapshot.queue.map((item) => ({ ...item, profile: { ...item.profile } })) } }]
  if (input.method === 'runs/claim') {
    const runId = typeof input.params?.runId === 'string' ? input.params.runId : undefined
    const queue = new PiRunQueue(24, state.snapshot.queue)
    const run = queue.claim(runId)
    if (!run) return [errorResponse(id, 'invalid_request', runId ? 'Unknown queued Pi run' : 'No queued Pi run available')]
    state.snapshot.queue = queue.snapshot(); state.snapshot.cursor += 1
    return [{ id, result: { run, queue: state.snapshot.queue } }]
  }
  if (input.method === 'runs/settle') {
    const runId = typeof input.params?.runId === 'string' ? input.params.runId : ''
    const settlement = input.params?.settlement
    if (!runId || !isPiTurnSettlement(settlement)) return [errorResponse(id, 'invalid_request', 'runId and settlement are required')]
    const queue = new PiRunQueue(24, state.snapshot.queue)
    const run = queue.settle(runId)
    if (!run) return [errorResponse(id, 'invalid_request', 'Unknown active Pi run')]
    state.snapshot.queue = queue.snapshot(); state.snapshot.cursor += 1
    return [{ id, result: { run, queue: state.snapshot.queue, settlement } }]
  }
  if (input.method === 'runs/enqueue') {
    const params = input.params || {}
    if (typeof params.runId !== 'string' || typeof params.sessionId !== 'string' || typeof params.prompt !== 'string' || !['interactive', 'time', 'proactive'].includes(String(params.trigger)) || !params.profile || typeof params.profile !== 'object') {
      return [errorResponse(id, 'invalid_request', 'runId, sessionId, prompt, trigger, and profile are required')]
    }
    const queue = new PiRunQueue(24, state.snapshot.queue)
    const outcome = queue.enqueue({
      runId: params.runId,
      sessionId: params.sessionId,
      prompt: params.prompt,
      trigger: params.trigger as PiQueuedRun['trigger'],
      evidence: typeof params.evidence === 'string' ? params.evidence : undefined,
      profile: { ...(params.profile as Record<string, unknown>) },
      status: 'queued',
    })
    if (!outcome.ok) return [errorResponse(id, 'invalid_request', `Pi run queue ${outcome.code}`)]
    state.snapshot.queue = queue.snapshot(); state.snapshot.cursor += 1
    return [{ id, result: { queue: state.snapshot.queue } }]
  }
  if (input.method === 'runs/cancel') {
    const runId = typeof input.params?.runId === 'string' ? input.params.runId : ''
    if (!runId) return [errorResponse(id, 'invalid_request', 'runId is required')]
    const queue = new PiRunQueue(24, state.snapshot.queue)
    if (!queue.snapshot().some((item) => item.runId === runId)) return [errorResponse(id, 'invalid_request', 'Unknown queued Pi run')]
    queue.markInterrupted(runId); state.snapshot.queue = queue.snapshot(); state.snapshot.cursor += 1
    return [{ id, result: { queue: state.snapshot.queue } }]
  }
  if (input.method === 'sessions/create') {
    const params = input.params || {}
    const parentSessionId = typeof params.parentSessionId === 'string' ? params.parentSessionId : undefined
    let sessionId = `pi-session-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    let childMetadata: Pick<SessionRecord, 'parentSessionId' | 'role' | 'profile' | 'context' | 'depth'> = {}
    if (parentSessionId) {
      if (!state.snapshot.sessions.some((candidate) => candidate.id === parentSessionId)) return [errorResponse(id, 'invalid_request', 'parentSessionId is unknown')]
      if (typeof params.role !== 'string' || !params.profile || typeof params.profile !== 'object' || !params.context || typeof params.context !== 'object' || typeof params.depth !== 'number') {
        return [errorResponse(id, 'invalid_request', 'Child Pi session requires role, profile, context, and depth')]
      }
      try {
        const child = createPiChildSession({
          role: params.role,
          profile: params.profile as Record<string, unknown>,
          context: params.context as PiContextPacket,
          depth: params.depth,
        })
        sessionId = child.id
        childMetadata = { parentSessionId, role: child.role, profile: child.profile, context: child.context, depth: child.depth }
      } catch (error) {
        return [errorResponse(id, 'invalid_request', error instanceof Error ? error.message : 'Invalid child Pi session')]
      }
    }
    const session: SessionRecord = {
      id: sessionId,
      title: typeof params.title === 'string' ? params.title : 'New Pi session',
      threadId: typeof params.threadId === 'string' ? params.threadId : undefined,
      ...childMetadata,
      messages: [],
    }
    state.snapshot.sessions = [...state.snapshot.sessions, session]
    state.snapshot.cursor += 1
    return [{ id, result: { sessionId: session.id, sessions: [session] } }]
  }
  if (input.method === 'sessions/fork') {
    const sourceId = typeof input.params?.sessionId === 'string' ? input.params.sessionId : ''
    const source = state.snapshot.sessions.find((candidate) => candidate.id === sourceId)
    if (!source) return [errorResponse(id, 'invalid_request', 'sessionId is required')]
    const fork: SessionRecord = {
      id: `pi-session-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      title: `${source.title} (fork)`,
      parentSessionId: source.id,
      role: source.role,
      profile: source.profile ? { ...source.profile } : undefined,
      context: source.context ? { objective: source.context.objective, facts: [...source.context.facts], constraints: [...source.context.constraints] } : undefined,
      depth: source.depth,
      messages: source.messages.map((message) => ({ ...message })),
      piSessionFile: forkPiSession(sourceId),
    }
    state.snapshot.sessions = [...state.snapshot.sessions, fork]; state.snapshot.cursor += 1
    return [{ id, result: { sessionId: fork.id, sessions: [fork] } }]
  }
  if (input.method === 'sessions/reset') {
    const sessionId = typeof input.params?.sessionId === 'string' ? input.params.sessionId : ''
    const session = state.snapshot.sessions.find((candidate) => candidate.id === sessionId)
    if (!session) return [errorResponse(id, 'invalid_request', 'sessionId is required')]
    if (activeSessionRuns.has(sessionId)) return [errorResponse(id, 'invalid_request', 'Cannot reset an active Pi session')]
    return disposePiSession(sessionId).then(() => {
      session.messages = []
      session.profile = undefined
      session.context = undefined
      session.piSessionFile = undefined
      session.toolAudit = []
      session.toolContractRevisionFloor = state.toolContracts.nextRevision(sessionId)
      session.toolContracts = []
      state.toolContracts.clear(sessionId)
      state.capabilities.clear(sessionId)
      session.archived = false
      state.snapshot.cursor += 1
      return [{ id, result: { sessionId, sessions: [session] } }]
    })
  }
  if (input.method === 'sessions/archive' || input.method === 'sessions/compact') {
    const sessionId = typeof input.params?.sessionId === 'string' ? input.params.sessionId : ''
    const session = state.snapshot.sessions.find((candidate) => candidate.id === sessionId)
    if (!session) return [errorResponse(id, 'invalid_request', 'sessionId is required')]
    if (input.method === 'sessions/archive') {
      return disposePiSession(sessionId).then(() => {
        session.archived = true
        state.snapshot.cursor += 1
        return [{ id, result: { sessionId, sessions: [session] } }]
      })
    }
    return handleManualSessionCompaction({ state, session, request: input, id, checkpointWriter, emit })
  }
  if (input.method === 'turn/interrupt') {
    const runId = typeof input.params?.runId === 'string' ? input.params.runId : ''
    if (!runId) return [errorResponse(id, 'invalid_request', 'runId is required')]
    const reason: PiTurnInterruptReason = input.params?.reason === 'timeout' ? 'timeout' : 'user'
    // Safe park: the orchestration loop stops after the current iteration and
    // the session aborts at its next tool boundary. In-flight tools are never
    // severed, so anything already started still reports its own evidence.
    const orchestrationRun = [...activeSessionRuns.values()].find((run) => run.runId === runId)
    if (orchestrationRun) orchestrationRun.interrupt = reason
    const parked = interruptPiTurn(runId, reason)
    return parked || orchestrationRun
      ? [{ id, result: { runId, settlement: 'interrupted' as const, interruptReason: reason } }]
      : [errorResponse(id, 'invalid_request', `Unknown Pi run: ${runId}`)]
  }
  if (input.method === 'turn/cancel') {
    const runId = typeof input.params?.runId === 'string' ? input.params.runId : ''
    if (!runId) return [errorResponse(id, 'invalid_request', 'runId is required')]
    const orchestrationRun = [...activeSessionRuns.values()].find((run) => run.runId === runId)
    if (orchestrationRun) orchestrationRun.cancelled = true
    const codeCancelled = cancelPiCodeMode(runId)
    if (codeCancelled) cancelPiApprovalsForRun(runId)
    const providerCancelled = cancelSubDesignProviderRun(runId)
    return Promise.all([cancelPiTurn(runId), Promise.resolve(cancelPiTool(runId))]).then(([turnCancelled, toolCancelled]) => (turnCancelled || toolCancelled || codeCancelled || providerCancelled || Boolean(orchestrationRun))
      ? [{ id, result: { runId, settlement: 'cancelled' as const } }]
      : [errorResponse(id, 'invalid_request', `Unknown Pi run: ${runId}`)])
  }
  if (input.method === 'turn/submit') {
    const sessionId = typeof input.params?.sessionId === 'string' ? input.params.sessionId : ''
    const prompt = typeof input.params?.prompt === 'string' ? input.params.prompt : ''
    const session = state.snapshot.sessions.find((candidate) => candidate.id === sessionId)
    if (!session || !prompt.trim()) return [errorResponse(id, 'invalid_request', 'sessionId and prompt are required')]
    const runId = typeof input.params?.runId === 'string' ? input.params.runId : `pi-run-${Date.now()}`
    const existingAttachment = state.attachmentJournal.get(runId)
    if (existingAttachment) {
      return [errorResponse(id, 'invalid_request', `Pi run already exists: ${runId}`)]
    }
    const activeRun = activeSessionRuns.get(sessionId)
    if (activeRun && activeRun.runId !== runId) {
      const mode = input.params?.followUpMode === 'steer' || input.params?.mode === 'steer'
        ? 'steer'
        : input.params?.followUpMode === 'queue' || input.params?.mode === 'queue' || input.params?.queue === true
          ? 'queue'
          : undefined
      if (mode === 'steer') {
        try {
          if (!steerPiTurn(sessionId, prompt)) return [errorResponse(id, 'invalid_request', 'Active Pi session cannot accept steering messages')]
        } catch (error) {
          return [errorResponse(id, 'invalid_request', error instanceof Error ? error.message : 'Unable to steer active Pi session')]
        }
        return [{ id, result: { sessionId, runId: activeRun.runId, settlement: 'interrupted' as const, queued: 'steer' as const } }]
      }
      if (mode === 'queue') {
        const queue = new PiRunQueue(24, state.snapshot.queue)
        const outcome = queue.enqueue({ runId, sessionId, prompt, trigger: 'interactive', profile: {}, status: 'queued' })
        if (!outcome.ok) return [errorResponse(id, 'invalid_request', `Pi run queue ${outcome.code}`)]
        state.snapshot.queue = queue.snapshot(); state.snapshot.cursor += 1
        return [{ id, result: { sessionId, runId, settlement: 'interrupted' as const, queued: 'queue' as const, queue: state.snapshot.queue } }]
      }
      return [errorResponse(id, 'invalid_request', `Pi session already has an active run: ${activeRun.runId}`)]
    }
    const explicitWorkspaceRoot = typeof input.params?.cwd === 'string' && input.params.cwd.trim()
      ? input.params.cwd
      : undefined
    const cwd = explicitWorkspaceRoot || process.cwd()
    // Validate memory scope before opening an attachment/recorder. A failed
    // realpath must not leave an active run that can never settle or retry.
    const contextPolicy = parsePiTurnContextPolicy(input.params?.contextPolicy)
    let canonicalWorkspace
    try {
      canonicalWorkspace = canonicalProjectId(cwd)
      if (contextPolicy.project && canonicalProjectId(contextPolicy.project) !== canonicalWorkspace) {
        return [errorResponse(id, 'invalid_request', 'Memory project must match the admitted workspace')]
      }
    } catch (error) {
      return [errorResponse(id, 'invalid_request', error instanceof Error ? error.message : 'Invalid admitted workspace')]
    }
    const memoryAccess: MemoryAccessContext = {
      origin: 'runtime', runId, sessionId,
      memoryReadEnabled: contextPolicy.memoryEnabled,
      memoryWriteEnabled: contextPolicy.memoryEnabled && contextPolicy.memoryWriteEnabled,
      temporary: contextPolicy.temporary,
      canonicalProject: canonicalWorkspace,
    }
    const patternValue = input.params?.pattern
    const pattern: PiLoopPattern = patternValue === 'Goal-based' || patternValue === 'Time-based' || patternValue === 'Proactive'
      ? patternValue
      : 'Turn-based'
    const maxIterations = typeof input.params?.maxIterations === 'number' ? input.params.maxIterations : 1
    const definitionOfDone = typeof input.params?.definitionOfDone === 'string' ? input.params.definitionOfDone.trim().slice(0, 2_000) : undefined
    // Same shared clamp as the renderer's config builder (loopBounds.ts):
    // both sides must agree or a requested budget silently diverges.
    const iterationLimit = clampPiIterations(maxIterations)
    let turnSettings = state.snapshot.settings
    if (input.params?.profile && typeof input.params.profile === 'object') {
      try {
        const profilePatch = validatePiSettingsPatch(input.params.profile as Record<string, unknown>)
        turnSettings = compileEffectiveAgentProfile(state.snapshot.settings, profilePatch, {})
      } catch (error) {
        return [errorResponse(id, 'invalid_request', error instanceof Error ? error.message : 'Invalid Pi turn profile')]
      }
    }
    const turnEvents: PiHostEvent[] = []
    // Reloads advance this key, but the value is frozen here for the whole
    // logical Host turn (including retries/iterations). Existing registered
    // native tools therefore cannot change underneath an in-flight turn.
    const mcpTurnGenerationKey = piMcpGenerationKey(
      state.extensions.list().filter((extension) => extension.kind === 'mcp').map((extension) => extension.id),
    )
    // Per-thread prefs ride in as preloaded capabilities (issue 12): the
    // renderer persists what last run loaded, and this run starts with those
    // already active. The authority on what is active is still the Host —
    // preload goes through capabilities/load, not a side door.
    const preloaded = Array.isArray(input.params?.preloadedCapabilities) ? input.params?.preloadedCapabilities : []
    // One turn, one record. Opened here so every later entry — the model's,
    // the tools', the approvals' — lands in the order it actually happened.
    const recorder: ActiveTurnRecorder = {
      turn: nextTurnNumber(session.record),
      step: 1,
      entries: [],
      toolIdentities: new Map(),
      stateProposals: new Map(),
      seqBase: nextTurnRecordSeq(session.record),
      reasoning: [],
      // Only when there is a live stream to feed. A batch caller receives the
      // whole committed slice in the turn's result, so republishing each entry
      // there would be a second copy of the same account, not a live view.
      ...(emit ? { publish: (entry: TurnRecordEntry) => emit({ event: 'host/record-append', payload: { runId, sessionId, entries: [entry] } }) } : {}),
      onAppend: (entry) => state.attachmentJournal.append(runId, [entry], entry.seq),
    }
    state.attachmentJournal.begin({
      runId,
      sessionId,
      threadId: session.threadId,
      turn: recorder.turn,
      learning: frozenRunLearningCandidate({
        prompt,
        runId,
        sessionId,
        canonicalProject: canonicalWorkspace,
        memoryAccess,
        automaticLearning: contextPolicy.memoryWriteEnabled,
      }),
    })
    activeTurnRecorders.set(sessionId, recorder)
    recordTurnEntry(sessionId, { kind: 'turn-start', source: 'host' })
    let workingState = workingStateForAdmittedTurn(session, runId, prompt, requestedWorkingGoal(input))
    recordTurnEntry(sessionId, { kind: 'working-state', source: 'host', state: workingState })
    // Trusted Host verification starts from the admitted run/view. No field in
    // contextPolicy, model text, or tool args can supply or deserialize it.
    const shellSandboxVerification: Promise<BuiltinShellSandboxVerification> | undefined =
      contextPolicy.outboundShellMode === 'required'
        ? verifyBuiltinShellSandbox({ runId, viewRoot: contextPolicy.viewRoot || '' })
        : undefined
    const workspaceTextSearchRun = bindWorkspaceTextSearchRun(sessionId, {
      runId,
      enabled: turnSettings.workspaceTextSearch === true,
      workspaceRoot: explicitWorkspaceRoot,
    })
    for (const capabilityId of preloaded) {
      if (typeof capabilityId !== 'string') continue
      if (isWorkspaceTextSearchCapability(capabilityId) && !workspaceTextSearchRun.available) continue
      try {
        state.capabilities.load(capabilityId, sessionId)
      } catch {
        /* an unknown preloaded id is skipped; the catalog still reports truth */
      }
    }
    // Capability-unlocked tools join the turn's active set: loading a
    // capability changes what this turn can call, immediately.
    const unlockedTools = state.capabilities.activeTools(sessionId)
      .filter((tool) => workspaceTextSearchRun.available || !isWorkspaceTextSearchTool(tool))
    const configuredActiveTools = turnSettings.activeTools
      .filter((tool) => workspaceTextSearchRun.available || !isWorkspaceTextSearchTool(tool))
    const turnVisibleActiveTools = turnSettings.activeTools.length > 0 && configuredActiveTools.length === 0
      ? ['load_capability']
      : configuredActiveTools
    const mcpCapabilityLoaded = state.capabilities.catalog(sessionId)
      .find((capability) => capability.id === 'mcp-bridge')?.deferred === false
    const previousModel = typeof session.profile?.model === 'string' ? session.profile.model : undefined
    const nextProfile: Record<string, unknown> = {
      ...(session.profile || {}),
      provider: turnSettings.provider,
      model: turnSettings.model,
      thinkingLevel: turnSettings.thinkingLevel,
    }
    let profileCommitted = false
    let contractRevision: number | undefined
    let contractDigest: string | undefined
    // Skills ride Pi's `<available_skills>` block, which is only appended
    // when the `read` tool is active. A capability configuration that turns
    // `read` off would otherwise make EVERY skill vanish silently — exactly
    // the failure mode this effort exists to kill (issue 17), so the
    // dependency is reported instead.
    const visibleSkills = discoveredPiSkills().skills.filter((skill) => skill.name && !skill.disableModelInvocation)
    const readActive = turnSettings.activeTools.length === 0 || turnSettings.activeTools.includes('read')
    if (visibleSkills.length > 0 && !readActive) {
      recordTurnEntry(sessionId, {
        kind: 'notice',
        source: 'host',
        topic: 'skills-unavailable',
        text: `技能在此 run 不可用：read 工具未啟用，系統提示無法列出 ${visibleSkills.length} 個技能（${visibleSkills.slice(0, 3).map((skill) => skill.name).join('、')}${visibleSkills.length > 3 ? ' 等' : ''}）。重新啟用 read 後即自動恢復。`,
      })
      const event: PiHostEvent = { event: 'host/context', payload: { runId, sessionId, phase: 'skills-unavailable', recalled: visibleSkills.length } }
      if (emit) emit(event)
      else turnEvents.push(event)
    }
    let memoryContext = ''
    let executionPrompt = prompt
    let contextPreflightComplete = false
    let resolvedContextWindow = contextPolicy.contextWindowTokens
    activeSessionRuns.set(sessionId, { runId, cancelled: false })
    // In-turn pack tools read their coordinates and approval policy from this
    // binding; it is cleared when the run ends so a stale policy can never
    // answer for the next one.
    bindPiSessionRun(sessionId, {
      runId,
      approvalMode: turnSettings.approvalMode,
      unattended: turnSettings.unattended,
      temporaryChat: contextPolicy.temporary,
      memoryAccess,
      frozenPolicy: freezePiRunPolicy({
        approvalMode: turnSettings.approvalMode,
        unattended: turnSettings.unattended,
        projectRoot: cwd,
        outboundMode: contextPolicy.outboundShellMode,
        restrictedViewRoot: contextPolicy.viewRoot,
        deniedTools: contextPolicy.deniedTools,
        approvalTools: contextPolicy.approvalTools,
        ...(contextPolicy.approvalTimeoutMs ? { approvalTimeoutMs: contextPolicy.approvalTimeoutMs } : {}),
      }),
      ...(contextPolicy.gitPolicy ? { gitPolicy: contextPolicy.gitPolicy } : {}),
      ...(contextPolicy.outboundShellMode ? { shellPolicy: {
        effectiveMode: contextPolicy.outboundShellMode,
        viewRoot: contextPolicy.viewRoot,
        ...(shellSandboxVerification ? { sandboxVerification: shellSandboxVerification } : {}),
      } } : {}),
    })
    // A stuck turn must not hold the conversation forever. Expiry walks the
    // same safe-park path as a user's stop, so an in-flight tool still lands.
    const timeoutMs = clampTurnTimeout(input.params?.timeoutMs)
    const deadline = timeoutMs
      ? armTurnDeadline(timeoutMs, () => {
          const run = activeSessionRuns.get(sessionId)
          if (run?.runId === runId && !run.interrupt) run.interrupt = 'timeout'
          interruptPiTurn(runId, 'timeout')
          const event: PiHostEvent = {
            event: 'host/orchestration',
            payload: { runId, sessionId, phase: 'cancelled', pattern, detail: 'interrupted:timeout' },
          }
          if (emit) emit(event)
          else turnEvents.push(event)
        }, turnDeadlineClock)
      : undefined
    const publishOrchestration = (phase: 'parse' | 'iterate' | 'dod' | 'replan' | 'settlement' | 'cancelled', iteration?: number, detail?: string) => {
      const event: PiHostEvent = { event: 'host/orchestration', payload: { runId, sessionId, phase, iteration, pattern, detail } }
      if (emit) emit(event)
      else turnEvents.push(event)
    }
    publishOrchestration('parse', undefined, definitionOfDone || 'Pi turn settlement is the default DoD')
    const pluginExecutionPromise = input.params?.pluginExecution
      ? executeSubDesignProviderStage({
          request: input.params.pluginExecution,
          runId,
          threadId: session.threadId || sessionId,
          projectRoot: cwd,
          onEvent: (stageEvent) => {
            const event: PiHostEvent = { event: 'host/pipeline-stage', payload: { ...stageEvent, sessionId } }
            if (emit) emit(event)
            else turnEvents.push(event)
          },
          onStreamEvent: (streamEvent) => {
            const event: PiHostEvent = {
              event: 'host/pipeline-stream',
              payload: {
                runId: streamEvent.runId,
                sessionId,
                stageId: streamEvent.stageId,
                providerId: streamEvent.providerId,
                update: streamEvent.update,
              },
            }
            if (emit) emit(event)
            else turnEvents.push(event)
          },
        })
      : Promise.resolve(undefined)
    return pluginExecutionPromise.then(async (pluginExecution) => {
      if (pluginExecution && shouldStopForProviderProjection(pluginExecution)) {
        const settlement = pluginExecution.state === 'cancelled' ? 'cancelled' as const : 'failed' as const
        publishOrchestration(settlement === 'cancelled' ? 'cancelled' : 'settlement', 0, pluginExecution.state)
        // A turn stopped by its provider stage is still a turn: it closes on
        // the record like any other, so the account has no silent gap.
        recordTurnEntry(sessionId, { kind: 'turn-end', source: 'host', settlement })
        session.record = appendTurnRecord(session.record, recorder.entries)
        const stoppedRecord: TurnRecord = {
          version: session.record.version,
          entries: session.record.entries.slice(-recorder.entries.length),
        }
        state.snapshot.cursor += 1
        state.attachmentJournal.settle(runId, settlement, pluginExecution.summary, session.record.entries.at(-1)?.seq)
        return [...turnEvents, {
          id,
          result: {
            sessionId,
            runId,
            settlement,
            items: [{ type: 'assistant_message', content: pluginExecution.summary }],
            record: stoppedRecord,
            workingState,
            pluginExecution,
            orchestration: { pattern, iterations: 0, maxIterations: iterationLimit, definitionOfDone, dodMet: false },
          },
        }]
      }
      const orchestrationPrompt = pluginExecution
        ? `${prompt}\n\n## Trusted provider stage result\n${JSON.stringify(pluginExecution)}`
        : prompt
      const recalledResult = memoryAccess.memoryReadEnabled && !memoryAccess.temporary
        ? await state.memoryStore.recall({ access: memoryAccess, query: prompt, limit: 5 })
        : undefined
      const selectedMemory = selectPiMemoryContext(recalledResult?.items.map(piMemoryProjection) || [])
      const recalledItems = recalledResult?.items.slice(0, selectedMemory.memories.length) || []
      memoryContext = selectedMemory.context
      executionPrompt = memoryContext ? `${memoryContext}\n## Current request\n${prompt}` : prompt
      if (recalledItems.length && recalledResult) {
        recordTurnEntry(sessionId, {
          kind: 'memory-recall',
          source: 'host',
          revision: recalledResult.revision,
          items: recalledItems.map((item) => ({
            id: item.id,
            logicalKey: item.logicalKey,
            scope: item.scope.kind,
            memoryKind: item.kind,
            revision: item.revision,
          })),
        })
        const event: PiHostEvent = { event: 'host/context', payload: { runId, sessionId, phase: 'memory-recalled', recalled: recalledItems.length } }
        if (emit) emit(event)
        else turnEvents.push(event)
      }
      return runPiOrchestration({
      pattern,
      prompt: orchestrationPrompt,
      maxIterations,
      interrupted: () => activeSessionRuns.get(sessionId)?.interrupt,
      turn: async (iterationPrompt, iteration) => {
        const activeRunState = activeSessionRuns.get(sessionId)
        if (activeRunState?.interrupt) {
          return { settlement: 'interrupted' as const, interruptReason: activeRunState.interrupt, result: '' }
        }
        if (activeRunState?.cancelled) return { settlement: 'cancelled' as const, result: '' }
        publishOrchestration('iterate', iteration)
        recorder.step = iteration
        // Whether this step recorded any assistant message of its own; if the
        // stream carried none, the settled answer stands in for them.
        let spokenThisStep = false
        recordTurnEntry(sessionId, { kind: 'step-start', source: 'host' })
        recordTurnEntry(sessionId, { kind: 'user-text', source: 'user', content: iteration === 1 ? prompt : iterationPrompt })
        const turn = await runPiTurn(sessionId, cwd, iterationPrompt, session.messages, (event) => {
          // A tool call is the model asking; the audit records what the Host
          // then decided and did (ADR-0048).
          // Each assistant message is recorded where it happened, so the
          // opening narration keeps its place before the tool it preceded.
          // Recording only the settled answer left everything the model said
          // on the way there unreconstructable from the record (ADR-0049).
          // Thinking arrives as a stream of deltas on the same channel as
          // text. It is collected here and written at the next boundary, so
          // the record answers «它跑那個指令之前在想什麼» instead of only
          // «它跑了那個指令» (model-visible means logged).
          const streamedEvent = (event as { assistantMessageEvent?: { type?: unknown; delta?: unknown } }).assistantMessageEvent
          if (streamedEvent?.type === 'thinking_delta' && typeof streamedEvent.delta === 'string') {
            recordReasoningDelta(sessionId, streamedEvent.delta)
          }
          if (event.type === 'message_end') {
            flushReasoning(sessionId)
            const message = (event as { message?: { role?: unknown; content?: unknown } }).message
            if (message?.role === 'assistant') {
              const text = Array.isArray(message.content)
                ? message.content
                    .filter((part): part is { type: string; text: string } => Boolean(
                      part && typeof part === 'object'
                      && (part as { type?: unknown }).type === 'text'
                      && typeof (part as { text?: unknown }).text === 'string',
                    ))
                    .map((part) => part.text)
                    .join('')
                : typeof message.content === 'string' ? message.content : ''
              if (text.trim()) {
                spokenThisStep = true
                recordTurnEntry(sessionId, { kind: 'assistant-text', source: 'model', content: text })
              }
            }
          }
          if (event.type === 'tool_execution_start') {
            // Before the call, never after: the reasoning is the answer to
            // «為什麼是這個指令», and an entry recorded afterwards would read
            // as a reaction to a result it never saw.
            flushReasoning(sessionId)
            const callId = typeof event.toolCallId === 'string' ? event.toolCallId : `${runId}:${iteration}`
            const toolName = typeof event.toolName === 'string' ? event.toolName : 'tool'
            const identity = modelToolContractIdentity(state, sessionId, toolName)
            if (identity) recorder.toolIdentities.set(callId, identity)
            recordTurnEntry(sessionId, {
              kind: 'tool-call',
              source: 'model',
              tool: toolName,
              callId,
              // A tool the model named that this turn's contract never
              // described — an inactive capability tool, or an unknown name.
              // Saying so is the point: an absent identity would otherwise be
              // indistinguishable from a record that dropped one (issue 19).
              ...(identity ? {} : { contractStatus: 'not-in-turn-contract' as const }),
              // The arguments travel with the call so a replay can re-derive
              // the tool's declared presentation (ADR-0050) — a diff card
              // needs the edit pairs, not the tool's name.
              ...(event.args !== undefined ? { args: event.args } : {}),
              ...(identity || {}),
            })
            recordFileWriteStateProposal({ sessionId, recorder, workingState, tool: toolName, callId, args: event.args })
            // Issue 16: an in-turn call gets the same observable lifecycle as
            // a direct-protocol one — start, decision, exactly one terminal.
            // Previously only the DENY path published anything terminal, so an
            // allowed call left the UI holding a decision that never resolved.
            publishInTurnToolEvent(state, sessionId, emit, {
              event: 'host/tool-start',
              payload: { runId, tool: toolName, callId, ...(identity || {}) },
            })
          }
          if (event.type === 'tool_execution_end') {
            // Pi executes in-turn tools inside this process, so its own report
            // is the Host's account of what ran — not the model's claim. A
            // call the Approval Decision blocked settles as `denied`, never as
            // an ordinary failure: "the agent could not" and "the gate said
            // no" are different facts.
            const toolCallId = typeof event.toolCallId === 'string' ? event.toolCallId : `${runId}:${iteration}`
            const toolName = typeof event.toolName === 'string' ? event.toolName : 'tool'
            const denialReason = consumePiDeniedInTurnCall(sessionId, toolCallId)
            const toolFailed = piToolExecutionFailed(event, toolName)
            settlePiModelBuiltinInvocation({
              sessionId,
              callId: toolCallId,
              failed: toolFailed,
              detail: denialReason,
            })
            const identity = recorder.toolIdentities.get(toolCallId)
            const proposal = recorder.stateProposals.get(toolCallId)
            // The in-turn denial audit already emitted and durably recorded
            // its one terminal result. Pi's blocked execution_end confirms the
            // gate held, but must not create a second terminal result.
            const terminalSettlement = publishModelToolTerminal({
              state,
              sessionId,
              emit,
              runId,
              tool: toolName,
              callId: toolCallId,
              denialReason,
              toolFailed,
              identity,
              proposal,
              workingState,
              trustedResult: event.result,
              eventIsError: event.isError === true,
            })
            workingState = commitCheckedWorkingState({
              sessionId,
              recorder,
              workingState,
              proposal,
              callId: toolCallId,
              settlement: terminalSettlement,
            })
            recorder.toolIdentities.delete(toolCallId)
            recorder.stateProposals.delete(toolCallId)
          }
          /* Events are collected below so the response remains ordered after them. */
          // Real progress resets the budget: a turn still emitting work is
          // working, not stuck, and long tasks are the point of this feature.
          deadline?.extend()
          const turnEvent: PiHostEvent = { event: 'host/turn-item', payload: { runId, sessionId, item: event, iteration } }
          if (emit) emit(turnEvent)
          else turnEvents.push(turnEvent)
        }, runId, session.piSessionFile, {
          ...turnSettings,
          temporaryChat: contextPolicy.temporary === true,
          // A restricted allowlist unions the unlocked capability tools; an
          // empty list already means everything is on.
          activeTools: turnSettings.activeTools.length
            ? [...new Set([...turnVisibleActiveTools, ...unlockedTools])]
            : turnSettings.activeTools,
          unlockedTools,
          mcpGenerationKey: mcpTurnGenerationKey,
          mcpCapabilityActive: mcpCapabilityLoaded,
        }, memoryContext, contextPolicy.referenceChatHistory, (registryContextWindow, runtimeSession) => {
          const liveSession = runtimeSession as { getAllTools?: () => readonly unknown[]; getActiveToolNames?: () => readonly string[] } | undefined
          if (liveSession && typeof liveSession.getAllTools === 'function' && typeof liveSession.getActiveToolNames === 'function') {
            const publishContract = () => {
              const contract = state.toolContracts.publish(sessionId, liveSession as never)
              contractRevision = contract.revision
              contractDigest = contract.contractDigest
              session.toolContracts = [...state.toolContracts.list(sessionId)]
            }
            publishContract()
            // load_capability calls this after Pi's native active-tool update,
            // so the next model request receives a fresh immutable revision.
            setPiPackSessionContractRefresh(sessionId, publishContract)
          }
          if (contextPreflightComplete) return
          contextPreflightComplete = true
          resolvedContextWindow = registryContextWindow || contextPolicy.contextWindowTokens
          if (resolvedContextWindow) nextProfile.contextWindowTokens = resolvedContextWindow
          runAutoCompactionPreflight({
            state,
            session,
            runId,
            prompt,
            executionPrompt,
            compaction: turnSettings.compaction,
            contextWindow: resolvedContextWindow,
            checkpointWriter,
            emit,
            turnEvents,
          })
        })
        session.piSessionFile ||= getPiSessionFile(sessionId)
        // A completed model call records its round; only an answered one has
        // text to join the conversation history.
        if (isCompletedModelCall(turn.settlement)) {
          if (!profileCommitted) {
            session.profile = nextProfile
            profileCommitted = true
            if (previousModel && previousModel !== turnSettings.model) {
              const event: PiHostEvent = {
                event: 'host/context',
                payload: {
                  runId,
                  sessionId,
                  phase: 'model-switched',
                  previousModel,
                  model: turnSettings.model,
                  provider: turnSettings.provider,
                  contextWindowTokens: resolvedContextWindow,
                },
              }
              if (emit) emit(event)
              else turnEvents.push(event)
            }
          }
          const answer = piTurnFinalAnswer(turn.items)
          if (turn.settlement === 'answered' && !spokenThisStep) {
            recordTurnEntry(sessionId, { kind: 'assistant-text', source: 'model', content: answer })
          }
          // A step whose thinking was never followed by a message or a tool
          // still thought; closing the step is the last ordered boundary it has.
          flushReasoning(sessionId)
          recordTurnEntry(sessionId, { kind: 'step-end', source: 'host', ...('timing' in turn && turn.timing ? { timing: turn.timing } : {}) })
          // History is derived from the record, never accumulated beside it:
          // one write path means the model's context and the record cannot
          // drift apart. Derived AFTER this round's entries, so the next round
          // sees what this one just did. The prompt is on the record either
          // way — it was model-visible — while only an answered turn recorded
          // an answer.
          session.messages = derivePiHistory(appendTurnRecord(session.record, recorder.entries))
          preparePiCompaction(session, runId, prompt, resolvedContextWindow)
          // Learning is only a frozen candidate here. The renderer's unique
          // app-finalization claim supplies the final status/DoD evidence and
          // the Host commits it atomically with finalization completion.
          const done = isPiHostDefinitionOfDoneMet(
            definitionOfDone,
            turn.settlement,
            workingState,
          )
          if (definitionOfDone) {
            publishOrchestration('dod', iteration, done ? 'met' : 'unmet')
            if (!done && iteration < iterationLimit) publishOrchestration('replan', iteration, 'DoD unmet; retrying the Pi turn')
          }
          return { settlement: turn.settlement, result: answer, ...(done === undefined ? {} : { done }) }
        }
        const stoppedText = piTurnResultText(turn.settlement, turn.items)
        if (turn.settlement === 'interrupted' && stoppedText && !spokenThisStep) {
          recordTurnEntry(sessionId, { kind: 'assistant-text', source: 'model', content: stoppedText })
        }
        flushReasoning(sessionId)
        recordTurnEntry(sessionId, { kind: 'step-end', source: 'host', ...('timing' in turn && turn.timing ? { timing: turn.timing } : {}) })
        return {
          settlement: turn.settlement,
          ...(turn.settlement === 'interrupted' && 'interruptReason' in turn
            ? { interruptReason: (turn as { interruptReason?: PiTurnInterruptReason }).interruptReason }
            : {}),
          result: stoppedText,
        }
      },
      }).then((orchestration) => {
      publishOrchestration(
        orchestration.settlement === 'cancelled' || orchestration.settlement === 'interrupted' ? 'cancelled' : 'settlement',
        orchestration.iterations,
        orchestration.settlement === 'interrupted'
          ? `interrupted:${orchestration.interruptReason || 'user'}`
          : orchestration.settlement,
      )
      recorder.step = orchestration.iterations || recorder.step
      recordTurnEntry(sessionId, {
        kind: 'turn-end',
        source: 'host',
        settlement: orchestration.settlement,
        ...(orchestration.settlement === 'interrupted'
          ? { interruptReason: orchestration.interruptReason || ('user' as PiTurnInterruptReason) }
          : {}),
      })
      session.record = appendTurnRecord(session.record, recorder.entries)
      // The turn's own slice travels with its result so the renderer projects
      // the conversation from the Host's account instead of authoring one.
      const turnRecordSlice: TurnRecord = {
        version: session.record.version,
        entries: session.record.entries.slice(-recorder.entries.length),
      }
      state.snapshot.cursor += 1
      state.attachmentJournal.settle(
        runId,
        orchestration.settlement,
        orchestration.result,
        session.record.entries.at(-1)?.seq,
      )
      return [...turnEvents, {
        id,
          result: {
            sessionId,
            runId,
            settlement: orchestration.settlement,
            ...(contractRevision !== undefined ? { contractRevision, contractDigest } : {}),
          ...(orchestration.settlement === 'interrupted'
            ? { interruptReason: orchestration.interruptReason || ('user' as PiTurnInterruptReason) }
            : {}),
          items: orchestration.result ? [{ type: 'assistant_message', content: orchestration.result }] : [],
          record: turnRecordSlice,
          workingState,
          orchestration: {
            pattern: orchestration.pattern,
            iterations: orchestration.iterations,
            maxIterations: iterationLimit,
            definitionOfDone,
            dodMet: orchestration.dodMet,
          },
          ...(pluginExecution ? { pluginExecution } : {}),
        },
      }]
      })
      }).catch((error) => {
        // Async storage failures must close the same record/attachment as a
        // normal settlement, not just release the in-memory run lock.
        const reason = error instanceof Error ? error.message : 'Pi Host turn failed'
        flushReasoning(sessionId)
        recordTurnEntry(sessionId, { kind: 'notice', source: 'host', topic: 'host-error', text: reason })
        recordTurnEntry(sessionId, { kind: 'turn-end', source: 'host', settlement: 'failed' })
        session.record = appendTurnRecord(session.record, recorder.entries)
        state.snapshot.cursor += 1
        state.attachmentJournal.settle(runId, 'failed', reason, session.record.entries.at(-1)?.seq)
        return [...turnEvents, errorResponse(id, 'runtime_error', reason)]
      }).finally(() => {
      deadline?.cancel()
      cancelPiApprovalsForRun(runId)
      if (shellSandboxVerification) {
        void shellSandboxVerification.then((verification) => {
          if (verification.status === 'supported+verified') revokeBuiltinShellSandboxEvidence(verification.evidence)
        })
      }
        unbindWorkspaceTextSearchRun(sessionId, runId)
        unbindPiSessionRun(sessionId)
      setPiPackSessionContractRefresh(sessionId)
      if (activeTurnRecorders.get(sessionId) === recorder) activeTurnRecorders.delete(sessionId)
      if (activeSessionRuns.get(sessionId)?.runId === runId) activeSessionRuns.delete(sessionId)
    })
  }
  if (input.method === 'settings/get') return [{ id, result: { settings: { ...state.snapshot.settings }, config: state.snapshot.config } }]
  if (input.method === 'settings/update') {
    return (async () => {
      const patch = validatePiSettingsPatch(input.params || {})
      const provider = patch.provider ?? state.snapshot.settings.provider
      const model = patch.model ?? state.snapshot.settings.model
      const settingsParams = input.params || {}
      const explicitBaseUrl = typeof settingsParams.baseUrl === 'string' ? settingsParams.baseUrl.trim() : ''
      const connectionChanged = 'provider' in settingsParams || 'model' in settingsParams
      // The renderer cannot resend an endpoint it no longer stores (baseUrl is
      // a Pi-owned key, stripped client-side). A model-only save must reuse the
      // endpoint already persisted for this provider — otherwise the Host would
      // adopt a provider/model pair that models.json never registered and every
      // turn would fail with "Pi model is not configured".
      const persistedBaseUrl = explicitBaseUrl
        || (connectionChanged ? await readPiLegacyProviderBaseUrl(provider) : '')
      const baseUrl = persistedBaseUrl || (connectionChanged ? piProviderDefaultBaseUrl(provider) : '') || ''
      const apiKey = typeof input.params?.apiKey === 'string' ? input.params.apiKey.trim() : ''
      if (baseUrl) {
        const persisted = await persistPiLegacyModelConfig({ provider, model, baseUrl })
        if (!persisted) throw new Error('Pi model endpoint requires provider, model, and baseUrl')
      }
      if (apiKey) {
        if (!provider) throw new Error('Pi credential requires a provider')
        await persistPiLegacyCredential(provider, apiKey)
      }
      state.snapshot.settings = {
        ...state.snapshot.settings,
        ...patch,
        activeTools: patch.activeTools || state.snapshot.settings.activeTools,
      }
      state.snapshot.settingsOrigin = 'managed'
      if (state.snapshot.config) state.snapshot.config = { ...state.snapshot.config, settingsSource: 'managed' }
      state.snapshot.cursor += 1
      return [{ id, result: { settings: { ...state.snapshot.settings }, config: state.snapshot.config } }]
    })().catch((error) => {
      return [errorResponse(id, 'invalid_request', error instanceof Error ? error.message : 'Invalid settings')]
    })
  }
  if (input.method === 'settings/profile') {
    const params = input.params || {}
    return [{
      id,
      result: {
        profile: compileEffectiveAgentProfile(
          state.snapshot.settings as never,
          (params.role || {}) as never,
          (params.taskOverride || {}) as never,
        ),
      },
    }]
  }
  return [errorResponse(id, 'unknown_method', `Unknown Pi Host method: ${input.method}`)]
}

function handlePiHostLifecycleRequest(
  state: HostState,
  method: PiHostRequest['method'],
  id: string | number,
): PiHostMessage[] | Promise<PiHostMessage[]> {
  if (method === 'health/get') {
    return state.memoryStore.health().then((memoryHealth) => [{ id, result: { ...readyResult(state.negotiatedProtocolVersion), memoryHealth } }])
  }
  if (method === 'lifecycle/shutdown') {
    state.shuttingDown = true
    return state.memoryStore.close().then(async () => [{ id, result: { memoryHealth: await state.memoryStore.health() } }])
  }
  return [errorResponse(id, 'closed', 'Pi Host is shutting down; new requests are refused')]
}

function isPiHostLifecycleRequest(state: HostState, method: PiHostRequest['method']): boolean {
  return method === 'health/get' || method === 'lifecycle/shutdown' || state.shuttingDown
}

export function createPiHostServer(
  send: (message: PiHostMessage) => void,
  initialSnapshot: { cursor: number; sessions: SessionRecord[]; settings: PiSettings; settingsOrigin?: 'native' | 'managed'; config?: PiHostConfigStatus; queue: PiQueuedRun[]; resources: PiResource[]; memories: PiMemory[]; extensions?: PiExtension[]; attachments?: PiHostAttachment[] } = {
    cursor: 0,
    sessions: [],
    settings: { ...DEFAULT_PI_SETTINGS },
    queue: [],
    resources: [],
    memories: [],
    extensions: [],
    attachments: [],
  },
  onStateChange?: (snapshot: { cursor: number; sessions: SessionRecord[]; settings: PiSettings; settingsOrigin?: 'native' | 'managed'; config?: PiHostConfigStatus; queue: PiQueuedRun[]; resources: PiResource[]; memories: PiMemory[]; extensions: PiExtension[]; attachments: PiHostAttachment[] }) => void,
  refreshConfig?: () => Promise<PiHostConfigStatus>,
  checkpointWriter?: CompactionCheckpointWriter,
  suppliedMemoryStore?: DurableMemoryStore,
) {
  const memoryStore = suppliedMemoryStore || new InMemoryDurableMemoryStore()
  // In-process callers seed the real contract once; the shipped entry passes
  // an already-migrated SQLite store and an empty JSON projection.
  if (suppliedMemoryStore && initialSnapshot.memories.length) throw new Error('SQLite authority cannot accept live JSON memories')
  const memoryReady = !suppliedMemoryStore && initialSnapshot.memories.length
    ? memoryStore.migrateLegacy({ access: { origin: 'migration', memoryReadEnabled: false, memoryWriteEnabled: false, temporary: false }, sourceHash: schemaDigest(initialSnapshot.memories), sourceSchema: 2, memories: initialSnapshot.memories })
    : Promise.resolve()
  const snapshot = { ...initialSnapshot, memories: [], extensions: initialSnapshot.extensions || [], attachments: initialSnapshot.attachments || [] }
  const attachmentJournal = new PiHostAttachmentJournal({ records: snapshot.attachments }, (next) => {
    snapshot.attachments = next.records
    onStateChange?.(snapshot)
  })
  const state: HostState = {
    initialized: false,
    negotiatedProtocolVersion: PI_HOST_PROTOCOL_VERSION,
    snapshot,
    capabilities: new PiCapabilityCatalog(DEFAULT_PI_CAPABILITIES),
    extensions: new PiExtensionRegistry(snapshot.extensions),
    toolContracts: new PiToolContractStore(snapshot.sessions.flatMap((session) => session.toolContracts || [])),
    toolContractNegotiated: false,
    memoryStoreNegotiated: false,
    memoryStore,
    publishedMemoryRevisions: new Set(),
    catalogProjection: new Map(),
    attachmentJournal,
    shuttingDown: false,
  }
  // A persisted active record has no live witness in a new Host child. Keep
  // the Host honest across process restart; renderer reloads do not recreate
  // this server and therefore preserve their active records.
  attachmentJournal.recoverOrphanedActive()
  for (const session of snapshot.sessions) {
    state.toolContracts.reserveNextRevision(session.id, session.toolContractRevisionFloor || 1)
  }
  ensurePiPacksRegistered()
  // The gateway credential is operator configuration, never a model argument.
  configurePiMessagingGateway({ botToken: process.env.SUBAGENTS_TELEGRAM_BOT_TOKEN })
  // Packs reach durable Host state ONLY through these accessors: one memory
  // store, the real child-session/run-queue path, and the live extension
  // registry. No pack holds a copy of any of them.
  setPiMemoryBridge(createPiDurableMemoryBridge(memoryStore, (change) => publishPiMemoryChange(state, change, send)))
  setPiDelegationBridge({
    createChild: async ({ parentSessionId, role, profile, context, depth }) => {
      const request = {
        id: `pack-child-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        method: 'sessions/create' as const,
        params: { parentSessionId, role, profile, context, depth },
      }
      const responses = await Promise.resolve(handlePiHostRequest(state, request))
      const response = (Array.isArray(responses) ? responses : []).find((message) => !('event' in message)) as PiHostResponse | undefined
      if (!response || response.error) throw new Error(response?.error?.message || 'child session failed')
      return { sessionId: String(response.result?.sessionId) }
    },
    enqueueChildRun: async ({ runId, sessionId, prompt }) => {
      const queue = new PiRunQueue(24, state.snapshot.queue)
      const outcome = queue.enqueue({ runId, sessionId, prompt, trigger: 'interactive', profile: {}, status: 'queued' })
      if (!outcome.ok) throw new Error(`Pi run queue ${outcome.code}`)
      state.snapshot.queue = queue.snapshot()
      state.snapshot.cursor += 1
    },
    listRuns: () => [
      ...state.snapshot.queue.map((run) => ({
        runId: run.runId,
        sessionId: run.sessionId,
        status: 'queued' as const,
        parentSessionId: state.snapshot.sessions.find((session) => session.id === run.sessionId)?.parentSessionId,
        role: state.snapshot.sessions.find((session) => session.id === run.sessionId)?.role,
        depth: state.snapshot.sessions.find((session) => session.id === run.sessionId)?.depth,
      })),
    ],
  })
  setPiMcpExtensionsLookup(() => state.extensions.list())
  // The framework pack's reserved verbs drive the SAME catalog instance the
  // protocol methods answer from — one authority on what is active (issue 12).
  setPiCapabilityBridge({
    catalog: (sessionId) => {
      const gate = workspaceTextSearchAvailability({
        sessionId,
        enabled: state.snapshot.settings.workspaceTextSearch === true,
      })
      return state.capabilities.catalog(sessionId)
        .filter((capability) => gate.available || !isWorkspaceTextSearchCapability(capability.id))
    },
    load: (id, sessionId) => {
      try {
        const gate = workspaceTextSearchAvailability({
          sessionId,
          enabled: state.snapshot.settings.workspaceTextSearch === true,
        })
        if (isWorkspaceTextSearchCapability(id) && !gate.available) return undefined
        const capability = state.capabilities.load(id, sessionId)
        const nativeMcpTools = id === 'mcp-bridge' && sessionId
          ? (state.toolContracts.latest(sessionId)?.tools || [])
              .filter((tool) => tool.source === 'mcp')
              .map((tool) => tool.name)
          : []
        return { id: capability.id, tools: [...new Set([...capability.tools, ...nativeMcpTools])] }
      } catch {
        return undefined
      }
    },
    search: (query, sessionId) => {
      const contract = sessionId
        ? state.toolContracts.list(sessionId).at(-1)
        : undefined
      if (!contract) return []
      const gate = workspaceTextSearchAvailability({
        sessionId,
        enabled: state.snapshot.settings.workspaceTextSearch === true,
      })
      return contract.tools
        .filter((tool) => gate.available || !isWorkspaceTextSearchTool(tool.name))
        .filter((tool) => tool.name.toLowerCase().includes(query.toLowerCase()) || tool.description.toLowerCase().includes(query.toLowerCase()) || (tool.pack || '').toLowerCase().includes(query.toLowerCase()))
        .map((tool) => ({ name: tool.name, pack: tool.pack, description: tool.description, schemaDigest: tool.schemaDigest, active: tool.active }))
    },
  })
  // run_code nests through Code Mode, and every nested call re-enters the
  // same Approval Decision the outer call faced (issue 13): no blanket pass
  // because the model is inside a script.
  setPiCodeModeExecutor(async ({ code, sessionId, cwd, runId }) => {
    const contract = state.toolContracts.latest(sessionId)
    const runCode = contract?.tools.find((tool) => tool.name === 'run_code' && tool.active)
    const request: InternalPiHostRequest = {
      id: `pack-code-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      method: 'tools/code' as const,
      params: {
        code, cwd, sessionId,
        ...(runId ? { runId } : {}),
        ...(contract ? { contractRevision: contract.revision } : {}),
        ...(runCode ? { schemaDigest: runCode.schemaDigest } : {}),
      },
    }
    // The model-facing run_code tool has already received its own decision.
    // This internal bit skips only that outer duplicate; nested calls never
    // receive it and therefore make their own decisions.
    request[INTERNAL_OUTER_CODE_APPROVED] = true
    const responses = await Promise.resolve(handlePiHostRequest(state, request))
    const response = (Array.isArray(responses) ? responses : []).find((message) => !('event' in message)) as PiHostResponse | undefined
    if (!response || response.error) return { ok: false, content: response?.error?.message || 'code mode failed' }
    return {
      ok: true,
      settlement: String(response.result?.settlement || 'success'),
      content: response.result?.content?.map((part) => part.text || '').join('') || '',
      toolCallCount: Number((response.result?.items?.[0] as { toolCallCount?: number } | undefined)?.toolCallCount ?? 0),
    }
  })
  installPlanAnnouncer((announcement) => {
    send({ event: 'host/plan-updated', payload: { ...announcement } })
  })
  // In-turn asks travel out as events on the same channel as every other
  // host event; their verdicts are audited into the same tool audit stream
  // as direct calls.
  setPiApprovalBridge({
    request: (request) => {
      // Journal before publishing so a renderer that reloads immediately
      // after this event can recover the same actionable approval from
      // runs/active or runs/attach. The journal owns redaction and bounds.
      state.attachmentJournal.setPendingApproval(request.runId, request)
      const pendingApproval = state.attachmentJournal.get(request.runId)?.pendingApproval
      // Direct protocol/code-mode calls may not have a run attachment; retain
      // their existing event behavior while attached turns use the bounded
      // journal projection above.
      send({ event: 'host/approval-requested', payload: { ...(pendingApproval || normalizePiHostPendingApproval(request) || request) } })
    },
    resolved: (request) => {
      state.attachmentJournal.clearPendingApproval(request.runId, request.callId)
    },
  }, (record) => {
    const identity = modelToolContractIdentity(state, record.sessionId, record.tool)
    const event: PiHostEvent = { event: 'host/tool-decision', payload: {
      runId: record.runId,
      tool: record.tool,
      callId: record.callId,
      decision: record.decision,
      ...(record.settlement ? { settlement: record.settlement } : {}),
      ...(record.reason ? { reason: record.reason } : {}),
      ...(identity || {}),
    } }
    recordToolAudit(state, record.sessionId, event)
    send(event)
    if (record.decision !== 'allow') {
      const resultEvent: PiHostEvent = { event: 'host/tool-result', payload: {
        runId: record.runId,
        tool: record.tool,
        callId: record.callId,
        settlement: record.settlement || 'denied',
        ...(record.reason ? { reason: record.reason } : {}),
        ...(identity || {}),
      } }
      recordToolAudit(state, record.sessionId, resultEvent)
      send(resultEvent)
    }
  })
  setPiPolicyEvidenceBridge({
    contractIdentity: (sessionId, toolName) => {
      const lookup = state.toolContracts.lookupCurrent(sessionId, toolName)
      if (!lookup.ok) return undefined
      return {
        contractRevision: lookup.contract.revision,
        contractDigest: lookup.contract.contractDigest,
        schemaDigest: lookup.tool.schemaDigest,
        toolSource: lookup.tool.source,
        ...(lookup.tool.pack ? { toolPack: lookup.tool.pack } : {}),
      }
    },
    append: (sessionId, event) => {
      recordTurnEntry(sessionId, {
        kind: 'tool-evidence',
        source: 'host',
        tool: event.tool,
        runId: event.runId,
        callId: event.callId,
        ...(event.parentRunId ? { parentRunId: event.parentRunId } : {}),
        phase: event.phase,
        ...(event.decision ? { decision: event.decision } : {}),
        ...(event.settlement ? { settlement: event.settlement } : {}),
        ...(event.detail ? { detail: event.detail } : {}),
        contractRevision: event.contractRevision,
        contractDigest: event.contractDigest,
        schemaDigest: event.schemaDigest,
        toolSource: event.toolSource,
        ...(event.toolPack ? { toolPack: event.toolPack } : {}),
        invocationOrigin: event.origin,
      })
    },
  })
  return {
    async handle(request: unknown) {
      const input = request && typeof request === 'object' ? request as Partial<PiHostRequest> : undefined
      const id = typeof input?.id === 'string' || typeof input?.id === 'number' ? input.id : ''
      try {
        await memoryReady
        // Re-read CLI OAuth immediately before a builtin turn as well as when
        // Settings asks for status. Codex/Claude may rotate their credential
        // while this long-lived Host is running; piCoreRuntime includes the
        // resulting auth-file revision in its session identity and rebuilds
        // the ModelRuntime instead of reusing an invalidated token snapshot.
        await refreshHostConfigForRequest(state, input, refreshConfig)
        const messages = await handlePiHostRequest(state, request, send, checkpointWriter)
        const method = input?.method
        if (hostRequestMutatesState(method)) onStateChange?.(state.snapshot)
        for (const message of messages) send(message)
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Pi Core Host request failed'
        send(errorResponse(id, 'runtime_error', message))
      }
    },
  }
}

function hostRequestNeedsFreshOAuth(method: string | undefined): boolean {
  return method === 'settings/get' || method === 'turn/submit'
}

function hostRequestMutatesState(method: string | undefined): boolean {
  return Boolean(method && (
    method.startsWith('settings/')
    || method.startsWith('sessions/')
    || method.startsWith('runs/')
    || method.startsWith('resources/')
    || method.startsWith('memory/')
    || method.startsWith('extensions/')
    || method === 'turn/submit'
  ))
}

async function refreshHostConfigForRequest(
  state: HostState,
  input: Partial<PiHostRequest> | undefined,
  refreshConfig?: () => Promise<PiHostConfigStatus>,
): Promise<void> {
  if (!refreshConfig || !hostRequestNeedsFreshOAuth(input?.method)) return
  state.snapshot.config = await refreshConfig()
  state.snapshot.cursor += 1
}

import { dirname, isAbsolute, relative, resolve } from 'node:path'
import { existsSync, readFileSync, realpathSync } from 'node:fs'
import { createHash, timingSafeEqual } from 'node:crypto'
import { execFile } from 'node:child_process'
import { clampPiIterations } from '../src/agent/loopBounds.ts'
import type { SubscriptionProviderCatalog } from '../src/agent/subscriptionCatalog.ts'
import type { MemoryStorageHealth } from './memoryStorageLifecycle.ts'
import { normalizePiHostPendingApproval, PiHostAttachmentJournal, PI_HOST_ATTACHMENT_PAGE_LIMIT, type PiHostAttachment, type PiHostAttachmentPage, type PiHostFinalizationClaimResult, type PiHostFinalizationCompleteResult } from './piHostAttachment.ts'
import type { RunLearningFinalOutcome } from '../src/agent/runLearningSettlement.ts'
import { isMemoryControlPackageIdentity, memoryControlPackageIdentity, MEMORY_CONTROL_COMPONENT_KEYS, type MemoryControlComponentKey, type MemoryControlJsonPatchOperation, type MemoryControlLineage, type MemoryControlPackage, type MemoryControlPackageAuthority, type MemoryControlPackageIdentity, type MemoryControlPackageReader } from '../src/agent/memoryControlPackage.ts'
import { createMemoryControlMetaCandidate, type MemoryControlDiagnosis } from '../src/agent/memoryControlMetaAgent.ts'
import { baselineMemoryControlPackageReader } from './memoryControlPackageRepository.ts'
import type { MemoryControlEvaluationAuthority } from './memoryControlEvaluationAuthority.ts'
import { BUILTIN_RUNNER_CAPABILITIES } from '../src/agent/runners/types.ts'
import { agentLifecycleFromTurnSettlement, type AgentLifecycleEvent } from '../src/agent/agentLifecycle.ts'
import { boundedAgentText, isRestrictiveAgentPolicy, normalizeAgentPolicy, type AgentAdmissionSnapshot, type AgentEffectivePolicy, type AgentMessageEnvelope } from '../src/agent/agentCollaboration.ts'
import { piToolFailureDetail } from './piToolFailureDetail.ts'
import { InMemoryInstructionRepository, InstructionRepositoryError, type InstructionRepository, type LegacyInstructionMigrationReport, type PersonalizationImportPreview, type PersonalizationInstructionSnapshot } from './instructionRepository.ts'
import { resolveInstructionSnapshot, writeProjectInstruction, type InstructionSnapshot } from './instructionResolver.ts'
import { ProjectInstructionWriteError, readProjectInstruction } from './projectInstructionWriter.ts'
import { mapSanitizedInstructionSnapshot } from '../src/agent/instructionSnapshot.ts'
import { prepareLlmEgressMessages } from '../src/agent/outbound/llmEgress.ts'
import { BUILTIN_BASELINE_POLICY, emptySupplementalPolicy } from '../src/agent/outbound/policySchema.ts'
import { compileProviderSecurityProfile } from '../src/agent/outbound/policyMerge.ts'
import { ensureLocalPolicyTree } from '../src/agent/outbound/policyStore.ts'
import { connectionIdForBuiltinLlm } from '../src/agent/outbound/providerConnectionId.ts'
import { captureReviewWorkspaceAdmission } from './reviewWorkspaceBinding.ts'
import { InMemoryReviewArtifactStore, type ReviewArtifactStore } from './reviewArtifactStore.ts'
import { captureRunReviewSnapshot, type TrustedReviewMutation } from './reviewSnapshotCapture.ts'
import { WorkspaceReviewProjection, type ReviewDiffHunk, type ReviewTargetDescription } from './workspaceReviewProjection.ts'
import type { ReviewFileManifestEntry, ReviewPageEnvelope, ReviewTarget, ReviewWorkspaceBinding } from '../src/agent/reviewContract.ts'
import { InMemoryReviewStateStore, type ReviewStateStore } from './reviewStateStore.ts'
import { applyReviewArtifactRetention, exportReviewArtifact, hardDeleteReviewArtifact, importReviewArtifact, previewReviewArtifactImport } from './reviewArtifactTransfer.ts'
import type { ReviewComment, ReviewFileState } from '../src/agent/reviewStateContract.ts'
import { InMemoryReviewVerificationStore, type ReviewVerificationStore } from './reviewVerificationStore.ts'
import { projectReviewVerification, type ReviewVerificationKind, type ReviewVerificationProjection } from '../src/agent/reviewVerificationContract.ts'
import { ReviewMutationCoordinator } from './reviewMutationCoordinator.ts'
import type { ReviewMutationApproval, ReviewMutationIntent, ReviewMutationPreview, ReviewMutationReceipt } from '../src/agent/reviewMutationContract.ts'
import { ReviewDeliveryCoordinator } from './reviewDeliveryCoordinator.ts'
import type { ReviewDeliveryApproval, ReviewDeliveryIntent, ReviewDeliveryPreview, ReviewDeliveryReceipt } from '../src/agent/reviewDeliveryContract.ts'

/**
 * Version 2 retired the ambiguous `success` turn settlement for the closed
 * union (`answered` / `empty` / …) and added the Turn Record to a session, so a
 * version-1 peer would both misread a settlement and miss the record entirely.
 * Version 3 added the attachment contract. Version 4 (ADR-0052) exposes the
 * fail-closed subscription catalog in snapshot config; it is additive, so v3
 * and v2 peers stay readable and only v1 is refused.
 * Version 5 contracts the retired whole-bundle memory methods and snapshot
 * field. Durable memory is available only through negotiated memory-store-v1.
 */
export const PI_HOST_PROTOCOL_VERSION = 5 as const
export const PI_HOST_CAPABILITIES = ['health', 'settings', 'sessions', 'turns', 'runtime', 'tools', 'tool-contract-v1', 'attachments-v1', 'events', 'automation', 'resources', 'memory', 'memory-store-v1', 'memory-control-v1', 'instructions-v1', 'review-v1', 'agent-tree-v1', 'agent-collaboration-v1', 'capabilities'] as const

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
  method: 'initialize' | 'health/get' | 'lifecycle/shutdown' | 'runtime/status' | 'tools/list' | 'tools/contract' | 'tools/read' | 'tools/grep' | 'tools/find' | 'tools/ls' | 'tools/write' | 'tools/edit' | 'tools/bash' | 'tools/code' | 'tools/mcp' | 'tools/pack' | 'approvals/resolve' | 'state/snapshot' | 'settings/get' | 'settings/update' | 'settings/profile' | 'resources/list' | 'resources/reload' | 'resources/sync-skills' | 'resources/read-skill-files' | 'instructions/v1/get' | 'instructions/v1/save' | 'instructions/v1/migrate-legacy' | 'instructions/v1/resolve' | 'instructions/v1/authorize-include' | 'instructions/v1/project-write' | 'instructions/v1/project-read' | 'instructions/v1/export' | 'instructions/v1/import-preview' | 'instructions/v1/import-apply' | 'review/v1/admit' | 'memory-control/v1/package/get' | 'memory/v1/upsert' | 'memory/v1/append' | 'memory/v1/get' | 'memory/v1/list' | 'memory/v1/recall' | 'memory/v1/delete' | 'memory/v1/clear' | 'memory/v1/delete-entry' | 'memory/v1/clear-project' | 'memory/v1/clear-global' | 'memory/v1/clear-all' | 'memory/v1/deletion-capability' | 'memory/v1/consolidate-dream' | 'memory/v1/export' | 'memory/v1/import-preview' | 'memory/v1/import-apply' | 'capabilities/list' | 'capabilities/load' | 'capabilities/search' | 'extensions/list' | 'extensions/install' | 'extensions/update' | 'extensions/reload' | 'extensions/set-enabled' | 'extensions/uninstall' | 'agents/list' | 'agents/spawn' | 'agents/send' | 'agents/mailbox' | 'agents/ack' | 'agents/follow-up' | 'agents/wait' | 'agents/lease/resolve' | 'agents/interrupt' | 'agents/cancel' | 'agents/close' | 'sessions/create' | 'sessions/list' | 'sessions/fork' | 'sessions/reset' | 'sessions/archive' | 'sessions/compact' | 'sessions/record' | 'runs/enqueue' | 'runs/claim' | 'runs/settle' | 'runs/list' | 'runs/cancel' | 'runs/update' | 'runs/reorder' | 'runs/active' | 'runs/attach' | 'runs/finalize-claim' | 'runs/finalize-complete' | 'runs/ack' | 'turn/submit' | 'turn/cancel' | 'turn/interrupt'
    | 'review/v1/finalize' | 'review/v1/read' | 'review/v1/payload-page' | 'review/v1/describe' | 'review/v1/files' | 'review/v1/file-diff' | 'review/v1/refresh' | 'review/v1/comments/list' | 'review/v1/draft/save' | 'review/v1/draft/delete' | 'review/v1/comment/transition' | 'review/v1/file-state/list' | 'review/v1/file-state/mark' | 'review/v1/state/inherit' | 'review/v1/feedback/prepare' | 'review/v1/feedback/claim' | 'review/v1/feedback/release' | 'review/v1/verification/list' | 'review/v1/verification/run' | 'review/v1/verification/output' | 'review/v1/mutation/preview' | 'review/v1/mutation/apply' | 'review/v1/delivery/preview' | 'review/v1/delivery/apply' | 'review/v1/artifact/export' | 'review/v1/artifact/import-preview' | 'review/v1/artifact/import-apply' | 'review/v1/artifact/rebind' | 'review/v1/artifact/retention' | 'review/v1/artifact/hard-delete'
  params: Record<string, unknown>
}

export type PiHostResponse = {
  id: string | number
  result?: {
    protocolVersion?: number
    capabilities?: PiHostCapability[]
    status?: 'ready'
    memoryHealth?: MemoryStorageHealth
    memoryControlPackage?: MemoryControlPackage
    memoryControlLineage?: MemoryControlLineage
    memoryControlEvaluations?: ReadonlyArray<import('../src/agent/memoryControlEvaluationContract.ts').MemoryControlEvaluationReport>
    memoryControlDiagnosis?: MemoryControlDiagnosis
    cursor?: number
    sessions?: unknown[]
    agents?: import('../src/agent/agentTree.ts').AgentTreeNode[]
    rootAgentId?: string
    selectedAgentId?: string
    settings?: PiSettings
    settingsRevision?: number
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
    files?: import('./piSkills.ts').PiSkillCatalogFile[]
    skillDiagnostics?: Array<{ path: string; message: string }>
    resolved?: boolean
    /** Structured payload of one tool execution (tools/pack). */
    item?: unknown
    memoryStore?: import('./durableMemoryStore.ts').DurableMemoryProtocolResult
    instructions?: PersonalizationInstructionSnapshot
    instructionSnapshot?: InstructionSnapshot
    instructionImportPreview?: PersonalizationImportPreview
    instructionMigrationReport?: LegacyInstructionMigrationReport
    instructionExport?: import('./instructionRepository.ts').PersonalizationExportBundle
    reviewAdmission?: import('../src/agent/reviewContract.ts').ReviewAdmissionSnapshot
    reviewSnapshotRef?: import('../src/agent/reviewContract.ts').ReviewSnapshotRef
    reviewArtifact?: import('./reviewArtifactStore.ts').ReviewArtifactProjection
    reviewPayloadPage?: { payloadId: string; contentBase64: string; offset: number; bytes: number; nextOffset?: number }
    reviewTargetDescription?: ReviewTargetDescription
    reviewFiles?: ReviewPageEnvelope<ReviewFileManifestEntry>
    reviewDiff?: ReviewPageEnvelope<ReviewDiffHunk>
    reviewComments?: ReviewComment[]
    reviewComment?: ReviewComment
    reviewFileStates?: ReviewFileState[]
    reviewFileState?: ReviewFileState
    reviewFeedbackBundle?: import('../src/agent/reviewStateContract.ts').ReviewFeedbackBundle
    reviewFeedbackClaimed?: boolean
    reviewVerifications?: ReviewVerificationProjection[]
    reviewVerification?: ReviewVerificationProjection
    reviewVerificationOutput?: { outputRef: string; contentBase64: string; offset: number; bytes: number; nextOffset?: number }
    reviewMutationPreview?: ReviewMutationPreview
    reviewMutationReceipt?: ReviewMutationReceipt
    reviewDeliveryPreview?: ReviewDeliveryPreview
    reviewDeliveryReceipt?: ReviewDeliveryReceipt
    reviewArtifactExport?: import('./reviewArtifactStore.ts').ReviewArtifactExportBundle
    reviewArtifactImportPreview?: import('./reviewArtifactStore.ts').ReviewArtifactImportPreview
    reviewArtifactRetention?: import('./reviewArtifactStore.ts').ReviewArtifactRetentionReport
    reviewArtifactHardDeleted?: boolean
    projectInstructionWrite?: { path: string; hash: string; bytes: number }
    projectInstructionRead?: { path: string; hash: string; bytes: number; content: string }
    authorizedIncludeTargets?: readonly string[]
    tool?: string
    code?: string
    content?: Array<{ type: string; text?: string; data?: string; mimeType?: string }>
    loaded?: boolean
    package?: string
    version?: string
    builtinTools?: string[]
    orchestration?: { pattern: PiLoopPattern; iterations: number; maxIterations: number; definitionOfDone?: string; dodMet?: boolean }
    queued?: 'steer' | 'queue'
    followUp?: PiQueuedRun
    queueRevision?: number
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
      | 'conflict' | 'read_only' | 'busy' | 'io_error' | 'unsupported_schema' | 'corrupt' | 'integrity_failure' | 'migration_failed' | 'invalid_import'
      | 'invalid_target' | 'invalid_content' | 'project_missing' | 'permission_denied'
      | 'disk_full' | 'rename_failure' | 'encoding_failure'
    message: string
  }
}

export type PiHostEvent =
  | {
      event: 'host/storage-health'
      payload: Extract<MemoryStorageHealth, { status: 'degraded' }>
    }
  | {
      event: 'instruction/changed'
      payload: {
        version: 1
        revision: number
        operation: 'save' | 'import' | 'migration' | 'project-write' | 'filesystem-observed' | 'include-authorization'
        /** Host facts that let an after-cursor consumer identify what changed without reading content from the event. */
        projectIdentity?: string
        workPath?: string
        effectiveHash?: string
        source?: {
          identity: string
          path?: string
          hash: string
          bytes: number
        }
        sources?: readonly {
          id: string
          scope: 'global' | 'project'
          path?: string
          parentPath?: string
          hash: string
          bytes: number
          applied: boolean
          metadataStatus: 'content' | 'metadata' | 'unavailable' | 'unauthorized'
        }[]
      }
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
      event: 'host/agent-lifecycle'
      payload: { sessionId: string; entry: TurnRecordEntry }
    }
  | {
      event: 'host/agent-collaboration'
      payload: { sessionId: string; entry: TurnRecordEntry }
    }
  | {
      event: 'host/queue'
      payload: { cursor: number; queueRevision: number }
    }
  | {
      event: 'host/tool-update'
      payload: { runId: string; tool: string; item: unknown; callId?: string }
    }
  | {
      event: 'host/tool-start' | 'host/tool-decision' | 'host/tool-result'
      payload: { runId: string; tool: string; callId?: string; parentRunId?: string; decision?: 'allow' | 'ask' | 'deny'; settlement?: 'success' | 'failed' | 'cancelled' | 'denied' | 'not-executed'; reason?: string; item?: unknown; idleLeaseMs?: number; executionEvidence?: WorkingExecutionEvidence; contractRevision?: number; contractDigest?: string; schemaDigest?: string; toolSource?: 'builtin' | 'extension-pack' | 'mcp'; toolPack?: string; invocationOrigin?: PiInvocationOrigin }
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
      payload: { sessionId: string; runId?: string; steps: Array<{ id: string; title: string; status: string; meta?: string; details?: Array<{ label: string; meta?: string }> }> }
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
import { cancelPiTool, cancelPiTurn, compactPiSession, disposePiSession, executePiTool, getPiSessionFile, interruptPiTurn, persistPiLegacyCredential, persistPiLegacyModelConfig, piCoreRuntimeStatus, piCoreRuntimeToolCatalog, piProviderDefaultBaseUrl, readPiLegacyProviderBaseUrl, runPiTurn, steerPiTurn, type PiBuiltinToolName, type PiTurnInterruptReason } from './piCoreRuntime.ts'
import { cancelPiCodeMode, runPiCodeMode } from './piCodeMode.ts'
import { armTurnDeadline, clampTurnTimeout, systemTurnDeadlineClock, toolExecutionDeadlineLeaseMs, type TurnDeadlineClock } from './piTurnDeadline.ts'
import { PiRunQueue, type PiQueuedRun } from './piRunQueue.ts'
import type { PiResource } from './piResourceRegistry.ts'
import type { PiContextPacket } from './piDelegationExtension.ts'
import { createPiDurableMemoryBridge, piMemoryProjection, type PiMemoryChange } from './piDurableMemory.ts'
import { compileMemoryControlRuntime, type MemoryControlRuntime } from './memoryControlRuntime.ts'
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
  selectPiMemoryContextWithinBytes,
} from './piSessionContext.ts'
import { settlePiRunLearning, type PiRunLearningSettlement } from './piRunLearningSettlement.ts'
import { DEFAULT_PI_CAPABILITIES, PiCapabilityCatalog } from './piCapabilityExtension.ts'
import { handlePiHostCapabilityDomain } from './piHostCapabilityDomain.ts'
import { handlePiHostResourceDomain } from './piHostResourceDomain.ts'
import { handlePiHostExtensionDomain } from './piHostExtensionDomain.ts'
import { runPiOrchestration, type PiLoopPattern, type PiOrchestrationTurn } from './piOrchestrationExtension.ts'
import { decideBashAction } from '../src/agent/tools/shellCommandParser.ts'
import { PiExtensionRegistry, type PiExtension } from './piExtensionRegistry.ts'
import { callPiMcpTool, listPiMcpTools, piMcpGenerationKey } from './piMcpClient.ts'
import { isCompletedModelCall, isPiHostDefinitionOfDoneMet, isPiTurnSettlement, piTurnFinalAnswer, piTurnResultText, type PiTurnSettlement } from '../src/agent/piHostRun.ts'
import { piAssistantTextSegments } from './piPublicCommentary.ts'
import { appendTurnRecord, asTurnRecordMemoryWrite, derivePiHistory, nextTurnRecordSeq, workingStateFromTurnRecord, type PiRecordedMessage, type TurnRecord, type TurnRecordAppend, type TurnRecordDraft, type TurnRecordEntry, type TurnRecordToolContractIdentity } from '../src/agent/turnRecord.ts'
import {
  checkDelegatedGoalObservation,
  checkWorkingStateProposal,
  invalidateCompletedWorkingGoal,
  createDelegatedGoalAssignment,
  createInitialWorkingState,
  isWorkingExecutionEvidence,
  isWorkingGoalCompletionPredicate,
  isWorkingState,
  type WorkingExecutionEvidence,
  type WorkingGoalSeed,
  type WorkingState,
  type WorkingStateProposal,
  type WorkingToolSettlement,
  type DelegatedGoalAssignment,
  type DelegatedGoalObservation,
  type WorkingEvidenceRef,
} from '../src/agent/workingState.ts'
import type { CompactionCheckpointSaveInput, CompactionManifest, CompactionReason } from '../src/agent/compactionCheckpoint.ts'
import { cancelSubDesignProviderRun, executeSubDesignProviderStage } from './subDesignProviderRuntime.ts'
import { shouldStopForProviderProjection, type SubDesignPluginExecutionProjection } from '../src/agent/subdesign/pluginExecution.ts'
import {
  cancelPiApprovalsForRun,
  canonicalPiToolPath,
  consumePiDeniedInTurnCall,
  consumePiSkillNotExecutedInTurnCall,
  consumePiWorkingWriteCanonicalPath,
  settlePiModelBuiltinInvocation,
  executePiPackTool,
  findPiPackTool,
  setPiApprovalBridge,
  unbindPiSessionRun,
  bindPiSessionRun,
  transitionPiSessionAgentMode,
  tightenPiSessionApprovalMode,
  tightenPiSessionUnattended,
  setPiPackSessionContractRefresh,
  setPiPolicyEvidenceBridge,
  setPiSkillPreflightBridge,
  piSessionRunBinding,
  WORKING_EXECUTION_EVIDENCE_DETAIL_KEY,
  requestPiToolApproval,
  type PiCatalogEntry,
} from './piToolHost.ts'
import { ensurePiPacksRegistered } from './piExtensionPacks/index.ts'
import { createSkillPreflight } from './piSkillPreflight.ts'
import {
  bindWorkspaceTextSearchRun,
  isWorkspaceTextSearchCapability,
  isWorkspaceTextSearchTool,
  unbindWorkspaceTextSearchRun,
  workspaceTextSearchAvailability,
} from './piWorkspaceTextSearchRuntime.ts'
import { configurePiMessagingGateway } from './piExtensionPacks/integrations.ts'
import { discoveredPiSkills, selectFrozenPiPreflightSkills, type PiSkillSyncResult } from './piSkills.ts'
import {
  clearPiPlanGateCandidate,
  clearPiContinuationItems,
  consumePiPlanGateCandidate,
  getPiContinuationItems,
  setPiContinuationItems,
  setPiDelegationBridge,
  setPiMemoryBridge,
  type PiPlanGateCandidate,
} from './piPackBridges.ts'
import { continuationSignature, normalizeContinuationItems, selectContinuationItem, type ContinuationItem } from '../src/agent/continuation.ts'
import { setPiPlanAnnouncer as installPlanAnnouncer } from './piExtensionPacks/interactionPlanning.ts'
import { isPiMcpInputSchema, piMcpModelToolName, setPiMcpExtensionsLookup } from './piExtensionPacks/mcpBridgePack.ts'
import { setPiCapabilityBridge, setPiCodeModeExecutor } from './piExtensionPacks/framework.ts'
import { PiToolContractStore, schemaDigest, type PiTurnToolContract } from './piToolContract.ts'
import { enqueuePiHostRun, handlePiHostRunDomain } from './piHostRunDomain.ts'
import { handlePiHostAgentDomain } from './piHostAgentDomain.ts'
import { PiAgentCommunicationDomain, type PiAgentCommunicationState } from './piAgentCommunicationDomain.ts'
import { agentLifecycleEventForSession, hasRecordedAgentLifecycle, recordAgentCollaborationEvent, recordAgentLifecycle } from './piAgentLifecycleRecord.ts'
import { handlePiHostSessionDomain } from './piHostSessionDomain.ts'
import { handlePiHostToolDomain } from './piHostToolDomain.ts'
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
  snapshot: { cursor: number; sessions: SessionRecord[]; settings: PiSettings; settingsOrigin?: 'native' | 'managed'; config?: PiHostConfigStatus; queue: PiQueuedRun[]; resources: PiResource[]; extensions: PiExtension[]; attachments: PiHostAttachment[] }
  capabilities: PiCapabilityCatalog
  extensions: PiExtensionRegistry
  toolContracts: PiToolContractStore
  toolContractNegotiated: boolean
  memoryStoreNegotiated: boolean
  memoryControlNegotiated: boolean
  instructionRepositoryNegotiated: boolean
  reviewNegotiated: boolean
  agentTreeNegotiated: boolean
  agentCollaborationNegotiated: boolean
  agentCommunication: PiAgentCommunicationDomain
  reviewArtifactStore: ReviewArtifactStore
  reviewWorkspaces: Map<string, ReviewWorkspaceBinding>
  reviewProjection: WorkspaceReviewProjection
  reviewStateStore: ReviewStateStore
  reviewVerificationStore: ReviewVerificationStore
  reviewMutationCoordinator: ReviewMutationCoordinator
  reviewDeliveryCoordinator: ReviewDeliveryCoordinator
  reviewImportPreviews: Set<string>
  memoryStore: DurableMemoryStore
  instructionRepository: InstructionRepository
  instructionProjections: Map<string, { signature: string; sourceRevisions: Map<string, { signature: string; revision: number }> }>
  memoryControlPackages: MemoryControlPackageReader
  memoryControlEvaluationAuthority?: MemoryControlEvaluationAuthority
  memoryControlMaintenanceToken?: string
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
  settlement?: 'success' | 'failed' | 'cancelled' | 'denied' | 'not-executed'
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

export type SessionRecord = { id: string; title: string; threadId?: string; parentSessionId?: string; forkedFromSessionId?: string; role?: string; profile?: Record<string, unknown>; context?: PiContextPacket; depth?: number; agentAdmission?: AgentAdmissionSnapshot; messages: PiRecordedMessage[]; toolAudit?: PiToolAuditRecord[]; archived?: boolean; piSessionFile?: string; record?: TurnRecord; toolContracts?: PiTurnToolContract[]; toolContractRevisionFloor?: number; preparedCompaction?: PreparedPiCompaction }

function projectPiHostStateSnapshot(state: HostState, id: string | number): PiHostMessage[] {
  if (state.negotiatedProtocolVersion < 5) {
    return [errorResponse(id, 'protocol_mismatch', 'state/snapshot without memories requires Pi Host Protocol v5')]
  }
  return [{
    id,
    result: {
      cursor: state.snapshot.cursor,
      sessions: [...state.snapshot.sessions],
      queue: state.snapshot.queue.map((item) => ({ ...item, profile: { ...item.profile } })),
      resources: state.snapshot.resources.map((resource) => ({ ...resource })),
    },
  }]
}

function workingStateForAdmittedTurn(
  session: SessionRecord,
  runId: string,
  objective: string,
  completionPredicate: unknown,
  goals: readonly WorkingGoalSeed[] | undefined,
): WorkingState {
  const delegated = session.context?.delegatedGoal
  return createInitialWorkingState({
    runId,
    objective: delegated?.goal.description || objective,
    constraints: session.context?.constraints,
    ...(isWorkingGoalCompletionPredicate(completionPredicate) ? { completionPredicate } : {}),
    ...(delegated
      ? { goals: [{ description: delegated.goal.description, completionPredicate: delegated.goal.completionPredicate }] }
      : goals?.length
        ? { goals }
        : {}),
  })
}

function childExecutionPrompt(session: SessionRecord, prompt: string): string {
  if (!session.agentAdmission || !session.context) return prompt
  const context = {
    role: session.role || session.agentAdmission.role,
    objective: session.context.objective,
    facts: session.context.facts,
    constraints: session.context.constraints,
  }
  return `<agent_context>\n${JSON.stringify(context)}\n</agent_context>\n\n<task>\n${prompt}\n</task>`
}

function requestedWorkingGoal(input: { params?: Record<string, unknown> }): unknown {
  return input.params?.workingGoal
}

function requestedWorkingGoals(input: { params?: Record<string, unknown> }): WorkingGoalSeed[] | undefined {
  const value = input.params?.workingGoals
  if (value === undefined) return undefined
  if (!Array.isArray(value) || value.length < 1 || value.length > 100) throw new Error('workingGoals must contain 1 to 100 valid goals')
  return value.map((item) => {
    if (!item || typeof item !== 'object') throw new Error('workingGoals contains a malformed goal')
    const seed = item as Record<string, unknown>
    if (Object.keys(seed).some((key) => key !== 'description' && key !== 'completionPredicate')) throw new Error('workingGoals contains an unknown field')
    if (typeof seed.description !== 'string' || !seed.description.trim() || seed.description.length > 800) throw new Error('workingGoals contains an invalid description')
    if (seed.completionPredicate !== undefined && !isWorkingGoalCompletionPredicate(seed.completionPredicate)) throw new Error('workingGoals contains an invalid completion predicate')
    return {
      description: seed.description,
      ...(seed.completionPredicate ? { completionPredicate: seed.completionPredicate } : {}),
    }
  })
}

function admitRequestedWorkingGoals(
  session: SessionRecord,
  input: { params?: Record<string, unknown> },
): { goals?: WorkingGoalSeed[]; error?: string } {
  try {
    const goals = requestedWorkingGoals(input)
    if (session.context?.delegatedGoal
      && (requestedWorkingGoal(input) !== undefined || goals !== undefined)) {
      return { error: 'delegated child cannot replace its Host-assigned Working State goal' }
    }
    return { goals }
  } catch (error) {
    return { error: error instanceof Error ? error.message : 'Invalid workingGoals' }
  }
}

function resolveCheckpointGoverningPackage(
  identity: unknown,
  packages: MemoryControlPackageReader,
): { package?: MemoryControlPackage; error?: string } {
  if (!isMemoryControlPackageIdentity(identity)) return { error: 'resume checkpoint governing package is missing or malformed' }
  let found: MemoryControlPackage
  try {
    found = packages.read({ schemaVersion: 1, revision: identity.revision })
  } catch {
    return { error: 'resume checkpoint governing package is unavailable' }
  }
  return found.id === identity.id && found.digest === identity.digest
    ? { package: found }
    : { error: 'resume checkpoint governing package identity mismatch' }
}

function validCheckpointWorkingState(checkpoint: {
  workingState?: unknown
  workingStateRevision?: number
}): WorkingState | undefined {
  return isWorkingState(checkpoint.workingState)
    && checkpoint.workingStateRevision === checkpoint.workingState.revision
    ? checkpoint.workingState
    : undefined
}

function checkpointContinuationItems(checkpoint: {
  continuationItems?: unknown
}): { items?: ContinuationItem[]; error?: string } {
  if (checkpoint.continuationItems === undefined) return {}
  if (!Array.isArray(checkpoint.continuationItems)) return { error: 'resume checkpoint continuation backlog is malformed' }
  const items = normalizeContinuationItems(checkpoint.continuationItems)
  return items.length === checkpoint.continuationItems.length
    ? { items }
    : { error: 'resume checkpoint continuation backlog is malformed' }
}

function claimResumeCheckpoint(input: {
  checkpoints?: CompactionCheckpointWriter
  requestedRunId: string
  checkpoint: import('../src/agent/compactionCheckpoint.ts').CompactionCheckpoint
  checkpointState: WorkingState
  governingPackage: MemoryControlPackage
}): { state?: WorkingState; governingPackage?: MemoryControlPackage; continuationItems?: ContinuationItem[]; error?: string } {
  const claim = input.checkpoints?.claimResume?.(input.requestedRunId)
  if (!claim?.ok) return { error: `resume checkpoint refused: ${claim?.reason || 'claim-unavailable'}` }
  const continuation = checkpointContinuationItems(input.checkpoint)
  if (continuation.error) return { error: continuation.error }
  return {
    state: structuredClone(input.checkpointState),
    governingPackage: input.governingPackage,
    ...(continuation.items ? { continuationItems: continuation.items } : {}),
  }
}

function resumeWorkingState(input: {
  request: { params?: Record<string, unknown> }
  session: SessionRecord
  runId: string
  checkpoints?: CompactionCheckpointWriter
  packages: MemoryControlPackageReader
}): { state?: WorkingState; governingPackage?: MemoryControlPackage; continuationItems?: ContinuationItem[]; error?: string } {
  const requestedRunId = input.request.params?.resumeFromRunId
  if (requestedRunId === undefined) return {}
  if (typeof requestedRunId !== 'string' || !requestedRunId.trim()) return { error: 'resumeFromRunId must be a non-empty run id' }
  const checkpoint = input.checkpoints?.load?.(requestedRunId)
  if (!checkpoint) return { error: 'resume checkpoint is missing' }
  if (checkpoint.replaySafe !== true || checkpoint.parkedAtToolBoundary !== true) return { error: 'resume checkpoint is not replay-safe' }
  const checkpointState = validCheckpointWorkingState(checkpoint)
  if (!checkpointState) return { error: 'resume checkpoint Working State is missing or malformed' }
  const governing = resolveCheckpointGoverningPackage(checkpoint.governingPackage, input.packages)
  if (!governing.package) return { error: governing.error }
  const durableState = workingStateFromTurnRecord(input.session.record)
  if (!durableState
    || durableState.revision !== checkpoint.workingStateRevision
    || JSON.stringify(durableState) !== JSON.stringify(checkpointState)) return { error: 'resume Working State revision mismatch' }
  const checkpointSeq = checkpoint.manifest?.latestSeq
  if (!Number.isSafeInteger(checkpointSeq)) return { error: 'resume checkpoint effect boundary is missing' }
  // Tool contracts may gain new side-effecting verbs. Treat every later
  // successful tool result as replay-unsafe instead of guessing from names.
  const laterEffect = input.session.record?.entries.some((entry) => entry.seq > Number(checkpointSeq)
    && entry.kind === 'tool-result'
    && entry.settlement === 'success')
  if (laterEffect) return { error: 'resume checkpoint has newer completed effects' }
  return claimResumeCheckpoint({
    checkpoints: input.checkpoints,
    requestedRunId,
    checkpoint,
    checkpointState,
    governingPackage: governing.package,
  })
}

function fileWriteStateProposal(
  state: WorkingState,
  tool: string,
  callId: string,
  args: unknown,
): WorkingStateProposal | undefined {
  if (tool !== 'write' || !args || typeof args !== 'object') return undefined
  const values = args as Record<string, unknown>
  if (typeof values.path !== 'string' || !values.path || typeof values.content !== 'string') return undefined
  const contentSha256 = createHash('sha256').update(values.content).digest('hex')
  const goal = state.goals.find((candidate) => candidate.status !== 'done'
    && candidate.completionPredicate?.kind === 'file-content'
    && candidate.completionPredicate.path === values.path
    && candidate.completionPredicate.sha256 === contentSha256)
    || state.goals.find((candidate) => candidate.status !== 'done'
      && candidate.completionPredicate?.kind === 'file-content'
      && candidate.completionPredicate.path === values.path)
  if (!goal) return undefined
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
      sha256: contentSha256,
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
  executionRunId: string
}): WorkingExecutionEvidence | undefined {
  if (input.settlement !== 'success'
    || input.proposal.proposedStatus !== 'done'
    || input.proposal.tool !== 'write'
    || input.identity?.toolSource !== 'builtin'
    || typeof input.identity.contractDigest !== 'string'
    || typeof input.identity.schemaDigest !== 'string') return undefined
  if (!input.trustedResult || typeof input.trustedResult !== 'object') return undefined
  const details = (input.trustedResult as { details?: unknown }).details
  if (!details || typeof details !== 'object') return undefined
  const evidence = (details as Record<string, unknown>)[WORKING_EXECUTION_EVIDENCE_DETAIL_KEY]
  if (!isWorkingExecutionEvidence(evidence)) return undefined
  if (evidence.runId !== input.executionRunId
    || evidence.tool !== input.proposal.tool
    || evidence.callId !== input.proposal.callId
    || evidence.contractDigest !== input.identity.contractDigest
    || evidence.schemaDigest !== input.identity.schemaDigest) return undefined
  const expectedReceiptDigest = createHash('sha256').update(JSON.stringify({
    schemaVersion: evidence.schemaVersion,
    runId: evidence.runId,
    tool: evidence.tool,
    callId: evidence.callId,
    contractDigest: evidence.contractDigest,
    schemaDigest: evidence.schemaDigest,
    resource: evidence.resource,
  })).digest('hex')
  if (evidence.receiptDigest !== expectedReceiptDigest || evidence.evidenceId !== `execution:${expectedReceiptDigest}`) return undefined
  return evidence
}

type CompactionCheckpointWriter = {
  save(input: CompactionCheckpointSaveInput): { ok: boolean; error?: string }
  load?(runId: string): import('../src/agent/compactionCheckpoint.ts').CompactionCheckpoint | null
  claimResume?(runId: string): { ok: boolean; checkpoint?: import('../src/agent/compactionCheckpoint.ts').CompactionCheckpoint; reason?: string }
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

async function prepareHostLlmEgress(input: {
  text: string
  mode?: 'required' | 'optional' | 'demo' | 'off'
  connectionId?: string
  provider: string
  runId: string
}): Promise<string> {
  if (!input.mode || input.mode === 'off') return input.text
  const connectionId = input.connectionId || connectionIdForBuiltinLlm({ apiProvider: input.provider, baseUrl: '' })
  const policyDir = process.env.SUBAGENTS_OUTBOUND_POLICY_DIR
  const prepared = await prepareLlmEgressMessages({
    effectiveMode: input.mode,
    messages: [{ role: 'user', content: input.text }],
    baselineProfile: compileProviderSecurityProfile(BUILTIN_BASELINE_POLICY, emptySupplementalPolicy(connectionId)),
    loadCompanyProfile: async () => {
      if (!policyDir) return { ok: false as const, reason: 'Pi Host outbound policy directory is unavailable' }
      const loaded = await ensureLocalPolicyTree(policyDir, connectionId)
      return loaded.ok ? { ok: true as const, profile: loaded.profile } : { ok: false as const, reason: loaded.reason }
    },
    cacheKey: input.runId,
  })
  if (!prepared.ok) throw new Error(`出站資料閘門拒絕 model prompt：${prepared.reason}`)
  return prepared.messages[0]?.content || ''
}

export async function sanitizeInstructionSnapshotForProvider(input: {
  snapshot: InstructionSnapshot
  mode?: 'required' | 'optional' | 'demo' | 'off'
  connectionId?: string
  provider: string
  runId: string
}): Promise<InstructionSnapshot> {
  if (!input.mode || input.mode === 'off') return input.snapshot
  const effectiveText = await prepareHostLlmEgress({ ...input, text: input.snapshot.effectiveText })
  const globalEffectiveText = await prepareHostLlmEgress({ ...input, text: input.snapshot.globalEffectiveText })
  const sourceContents = await Promise.all(input.snapshot.sources.map((source) => source.content
    ? prepareHostLlmEgress({ ...input, text: source.content })
    : Promise.resolve(source.content)))
  return mapSanitizedInstructionSnapshot(input.snapshot, { effectiveText, globalEffectiveText, sourceContents }, (text) =>
    createHash('sha256').update(text).digest('hex'))
}

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
  /** Frozen project root used when the parent rechecks delegated file evidence. */
  cwd: string
  turn: number
  step: number
  entries: TurnRecordAppend[]
  /** Frozen at tool start so a mid-call capability load cannot rewrite history. */
  toolIdentities: Map<string, TurnRecordToolContractIdentity>
  /** Model-authored completion proposals awaiting the exact terminal result. */
  stateProposals: Map<string, WorkingStateProposal>
  /** Immutable state all sibling tool drafts in the current model step saw. */
  proposalState: WorkingState
  /** Atomically admitted package identity; later activation cannot rewrite it. */
  governingPackage: MemoryControlPackageIdentity
  memoryControl: MemoryControlRuntime
  /** Host maintenance already admitted to this run and not yet durably audited. */
  pendingMemoryControlAudits: Set<Promise<void>>
  /** Settlement closes admission synchronously before awaiting reserved audits. */
  memoryControlAuditsClosed: boolean
  /** Parent Checker commits adopted child evidence here during a pack call. */
  delegatedWorkingState?: WorkingState
  /** Set by the mutating pack tool; consumed only after sibling effects settle. */
  delegatedAdoptionRequested?: boolean
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
  /** Follow-up runs queued while this turn is active begin at the next turn. */
  deferredLifecycle?: AgentLifecycleEvent[]
  pendingApprovalCount?: number
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

function recordInTurnAgentLifecycle(
  state: HostState,
  sessionId: string,
  lifecycle: 'waiting-approval' | 'running',
  runId: string,
): void {
  const recorder = activeTurnRecorders.get(sessionId)
  if (!recorder) return
  const event = agentLifecycleEventForSession(
    state.snapshot.sessions,
    sessionId,
    lifecycle,
    runId,
    undefined,
    recorder.entries,
  )
  if (event) recordTurnEntry(sessionId, { kind: 'agent-lifecycle', source: 'host', event })
}

function parentDelegationEntries(session: SessionRecord, recorder: ActiveTurnRecorder) {
  return [...(session.record?.entries || []), ...recorder.entries]
}

function matchingDelegatedEvidenceEntry(
  record: TurnRecord,
  evidence: WorkingEvidenceRef | undefined,
) {
  if (!evidence) return undefined
  return record.entries.find((entry) => entry.seq === evidence.seq
    && entry.kind === 'tool-result'
    && entry.executionEvidence?.evidenceId === evidence.evidenceId
    && entry.executionEvidence.runId === evidence.runId
    && entry.executionEvidence.tool === evidence.tool
    && entry.executionEvidence.callId === evidence.callId
    && entry.executionEvidence.contractDigest === evidence.contractDigest
    && entry.executionEvidence.schemaDigest === evidence.schemaDigest
    && entry.executionEvidence.receiptDigest === evidence.receiptDigest)
}

function delegatedChildSummary(record: TurnRecord): string {
  return record.entries
    .filter((entry) => entry.kind === 'assistant-text')
    .at(-1)?.content.replace(/\s+/g, ' ').trim().slice(0, 800) || 'child returned no completion observation'
}

function delegatedObservationStatus(
  verified: boolean,
  evidenceStillApplicable: boolean,
): DelegatedGoalObservation['status'] {
  if (!verified) return 'unverified'
  return evidenceStillApplicable ? 'verified' : 'invalidated'
}

function delegatedGoalObservationFromChild(
  assignment: DelegatedGoalAssignment,
  child: SessionRecord,
  evidenceStillApplicable: boolean,
): DelegatedGoalObservation | undefined {
  const record = child.record
  if (!record?.entries.some((entry) => entry.kind === 'turn-end')) return undefined
  const childState = workingStateFromTurnRecord(record)
  const childGoal = childState?.goals[0]
  const evidence = childGoal?.status === 'done' ? childGoal.evidence.at(-1) : undefined
  const terminal = matchingDelegatedEvidenceEntry(record, evidence)
  const summary = delegatedChildSummary(record)
  const verified = Boolean(childState && childGoal?.status === 'done' && evidence && terminal?.kind === 'tool-result')
  const evidenceRef: WorkingEvidenceRef | undefined = verified && evidence ? {
    ...evidence,
    goalId: assignment.goal.id,
    parentRunId: assignment.parentRunId,
    delegationId: assignment.delegationId,
    childSessionId: assignment.childSessionId,
    childRecordSeq: evidence.seq,
  } : undefined
  return {
    schemaVersion: 1,
    delegationId: assignment.delegationId,
    parentRunId: assignment.parentRunId,
    parentSessionId: assignment.parentSessionId,
    childSessionId: assignment.childSessionId,
    childRunId: childState?.runId || 'unverified-child-run',
    goalId: assignment.goal.id,
    baseRevision: assignment.baseRevision,
    status: delegatedObservationStatus(verified, evidenceStillApplicable),
    summary,
    ...(verified && childGoal?.completionPredicate && evidenceRef
      ? { resource: childGoal.completionPredicate, evidenceRef }
      : {}),
  }
}

function delegatedEvidenceStillApplies(recorder: ActiveTurnRecorder, assignment: DelegatedGoalAssignment): boolean {
  const predicate = assignment.goal.completionPredicate
  const canonicalPath = canonicalPiToolPath(recorder.cwd, predicate.path)
  if (!isWithinProject(recorder.cwd, canonicalPath)) return false
  return proposalEvidenceStillApplies(canonicalPath, {
    schemaVersion: 1,
    proposalId: `delegation-recheck:${assignment.delegationId}`,
    source: 'host',
    baseRevision: assignment.baseRevision,
    runId: assignment.parentRunId,
    goalId: assignment.goal.id,
    proposedStatus: 'done',
    tool: 'write',
    callId: assignment.delegationId,
    file: predicate,
  })
}

function delegatedSiblingEffectsSettled(state: HostState, parentSessionId: string, childSessionId: string): boolean {
  const siblings = new Set(state.snapshot.sessions
    .filter((session) => session.parentSessionId === parentSessionId && session.id !== childSessionId)
    .map((session) => session.id))
  if ([...siblings].some((sessionId) => activeSessionRuns.has(sessionId))) return false
  return !state.snapshot.queue.some((run) => siblings.has(run.sessionId) && (run.status === 'queued' || run.status === 'running'))
}

function recordDelegatedAdoptionProjection(
  parentSessionId: string,
  rootAgentId: string,
  recorder: ActiveTurnRecorder,
  assignment: DelegatedGoalAssignment,
  childRunId: string,
  outcome: 'pending' | 'accepted' | 'stale' | 'rejected',
  reason: string,
): void {
  const resultId = `${childRunId}:result`
  const duplicate = recorder.entries.some((entry) => entry.kind === 'agent-collaboration'
    && entry.event.type === 'adoption'
    && entry.event.resultId === resultId
    && entry.event.outcome === outcome)
  if (duplicate) return
  const event = {
    type: 'adoption' as const,
    agentId: assignment.childSessionId,
    resultId,
    outcome,
    reason: boundedAgentText(reason, 2_048),
  }
  recordTurnEntry(parentSessionId, { kind: 'agent-collaboration', source: 'host', event })
  const message: AgentMessageEnvelope = {
    version: 1,
    messageId: `${resultId}:adoption:${outcome}`,
    rootAgentId,
    senderAgentId: assignment.childSessionId,
    receiverAgentId: parentSessionId,
    originTurn: recorder.turn,
    originRunId: assignment.parentRunId,
    kind: 'adoption',
    content: event.reason,
    createdAt: Date.now(),
    deliveryState: 'queued',
    resultRef: resultId,
  }
  recordTurnEntry(parentSessionId, { kind: 'agent-collaboration', source: 'host', event: { type: 'mail', message } })
}

function collectDelegatedGoalResults(
  state: HostState,
  parentSessionId: string,
): import('../src/agent/workingState.ts').DelegatedGoalCheck[] {
  const parent = state.snapshot.sessions.find((session) => session.id === parentSessionId)
  const recorder = activeTurnRecorders.get(parentSessionId)
  if (!parent || !recorder) return []
  const entries = parentDelegationEntries(parent, recorder)
  const checkedIds = new Set(entries
    .filter((entry) => entry.kind === 'delegation-check')
    .map((entry) => entry.check.delegationId))
  const assignments = entries
    .filter((entry) => entry.kind === 'delegation-assignment')
    .map((entry) => entry.assignment)
  const checks: import('../src/agent/workingState.ts').DelegatedGoalCheck[] = []
  let workingState = recorder.delegatedWorkingState || recorder.proposalState
  for (const assignment of assignments) {
    if (checkedIds.has(assignment.delegationId)) continue
    const child = state.snapshot.sessions.find((session) => session.id === assignment.childSessionId)
    if (!child) continue
    if (!delegatedSiblingEffectsSettled(state, parentSessionId, child.id)) {
      recordDelegatedAdoptionProjection(
        parentSessionId,
        child.agentAdmission?.rootAgentId || parentSessionId,
        recorder,
        assignment,
        `${child.id}:pending:${assignment.delegationId}`,
        'pending',
        'sibling-effects-not-settled',
      )
      continue
    }
    const observation = delegatedGoalObservationFromChild(
      assignment,
      child,
      delegatedEvidenceStillApplies(recorder, assignment),
    )
    if (!observation) continue
    recordTurnEntry(parentSessionId, { kind: 'delegation-observation', source: 'host', observation })
    const checked = checkDelegatedGoalObservation({ state: workingState, assignment, observation, enabled: recorder.memoryControl.delegatedGoalChecker })
    recordTurnEntry(parentSessionId, {
    kind: 'delegation-check', source: 'host', check: checked.check,
    packageIdentity: recorder.governingPackage,
  })
    checks.push(checked.check)
    const outcome = checked.check.verdict === 'accepted' || checked.check.verdict === 'rebased'
      ? 'accepted'
      : checked.check.reason.includes('stale') || checked.check.reason.includes('invalidated')
        ? 'stale'
        : 'rejected'
    recordDelegatedAdoptionProjection(parentSessionId, child.agentAdmission?.rootAgentId || parentSessionId, recorder, assignment, observation.childRunId, outcome, checked.check.reason)
    if (!checked.state) continue
    workingState = checked.state
    recorder.delegatedWorkingState = checked.state
    recordTurnEntry(parentSessionId, { kind: 'working-state', source: 'host', state: checked.state })
  }
  return checks
}

function adoptDelegatedWorkingState(current: WorkingState, recorder: ActiveTurnRecorder): WorkingState {
  const delegated = recorder.delegatedWorkingState
  return delegated && delegated.revision > current.revision ? delegated : current
}

function settleDelegatedGoalAdoption(state: HostState, sessionId: string, recorder: ActiveTurnRecorder): void {
  if (!recorder.delegatedAdoptionRequested) return
  collectDelegatedGoalResults(state, sessionId)
  recorder.delegatedAdoptionRequested = false
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
  // Admission/queue lifecycle can be recorded before a model turn exists;
  // those entries share the upcoming turn coordinate and must not consume it.
  return (record?.entries || []).reduce(
    (highest, entry) => entry.kind === 'agent-lifecycle' || entry.kind === 'agent-collaboration' ? highest : Math.max(highest, entry.turn),
    0,
  ) + 1
}

function publishAgentLifecycleEntry(
  emit: ((message: PiHostMessage) => void) | undefined,
  sessionId: string,
  entry: TurnRecordEntry,
): void {
  if (!emit || entry.kind !== 'agent-lifecycle') return
  emit({ event: 'host/agent-lifecycle', payload: { sessionId, entry } })
  if (entry.event.runId) {
    emit({ event: 'host/record-append', payload: { runId: entry.event.runId, sessionId, entries: [entry] } })
  }
}

function publishAgentCollaborationEntry(
  emit: ((message: PiHostMessage) => void) | undefined,
  sessionId: string,
  entry: TurnRecordEntry,
): void {
  if (!emit || entry.kind !== 'agent-collaboration') return
  emit({ event: 'host/agent-collaboration', payload: { sessionId, entry } })
  const runId = entry.event.type === 'spawned'
    ? entry.event.runId
    : entry.event.type === 'follow-up-started'
      ? entry.event.runId
      : entry.event.type === 'completion'
        ? entry.event.result.runId
        : undefined
  if (runId) emit({ event: 'host/record-append', payload: { runId, sessionId, entries: [entry] } })
}

function defaultAgentPolicy(settings: PiSettings): AgentEffectivePolicy {
  return {
    ...(settings.provider.trim() ? { provider: settings.provider } : {}),
    ...(settings.model.trim() ? { model: settings.model } : {}),
    approvalMode: settings.approvalMode,
    unattended: settings.unattended,
    sandbox: settings.approvalMode === 'full' ? 'read-only' : 'workspace-write',
    outbound: 'off',
    capabilities: [...settings.activeTools],
    mcpServers: [],
  }
}

function admittedChildTurnPolicy(
  admission: AgentAdmissionSnapshot,
  settings: PiSettings,
): AgentEffectivePolicy | undefined {
  return normalizeAgentPolicy({
    provider: settings.provider,
    model: settings.model,
    approvalMode: settings.approvalMode,
    unattended: settings.unattended,
    sandbox: admission.policy.sandbox,
    outbound: admission.policy.outbound,
    capabilities: settings.activeTools,
    mcpServers: admission.policy.mcpServers,
  })
}

function agentCommunicationState(
  state: HostState,
  emit?: (message: PiHostMessage) => void,
): PiAgentCommunicationState {
  return {
    sessions: state.snapshot.sessions,
    queue: state.snapshot.queue,
    activeSessionIds: new Set(activeSessionRuns.keys()),
    defaultPolicy: defaultAgentPolicy(state.snapshot.settings),
    commit: (sessions, queue) => {
      state.snapshot.sessions = sessions
      state.snapshot.queue = queue
      state.snapshot.cursor += 1
    },
    publish: (sessionId, entry) => publishAgentCollaborationEntry(emit, sessionId, entry),
    activeRunId: (sessionId) => activeSessionRuns.get(sessionId)?.runId,
    steer: (sessionId, content) => steerPiTurn(sessionId, content),
    recordCollaboration: (sessionId, event) => {
      const recorder = activeTurnRecorders.get(sessionId)
      if (recorder) {
        recordTurnEntry(sessionId, { kind: 'agent-collaboration', source: 'host', event })
        return true
      }
      return recordAgentCollaborationEvent(
        state.snapshot.sessions,
        sessionId,
        event,
        (entry) => publishAgentCollaborationEntry(emit, sessionId, entry),
      )
    },
    recordLifecycle: (sessionId, lifecycle, runId, reason) => {
      const recorder = activeTurnRecorders.get(sessionId)
      if (recorder) {
        const event = agentLifecycleEventForSession(state.snapshot.sessions, sessionId, lifecycle, runId, reason, recorder.entries)
        if (!event) return false
        recordTurnEntry(sessionId, { kind: 'agent-lifecycle', source: 'host', event })
        return true
      }
      return recordAgentLifecycle(
        state.snapshot.sessions,
        sessionId,
        lifecycle,
        runId,
        reason,
        (entry) => publishAgentLifecycleEntry(emit, sessionId, entry),
      )
    },
    interrupt: (_sessionId, runId) => {
      const queued = state.snapshot.queue.find((run) => run.runId === runId && run.status === 'queued')
      if (queued) {
        queued.status = 'interrupted'
        return true
      }
      const active = [...activeSessionRuns.values()].find((run) => run.runId === runId)
      if (active) active.interrupt = 'user'
      return interruptPiTurn(runId, 'user') || Boolean(active)
    },
  }
}

function flushDeferredAgentLifecycle(
  state: HostState,
  sessionId: string,
  recorder: ActiveTurnRecorder,
  emit?: (message: PiHostMessage) => void,
): void {
  for (const deferred of recorder.deferredLifecycle || []) {
    recordAgentLifecycle(
      state.snapshot.sessions,
      sessionId,
      deferred.state,
      deferred.runId,
      deferred.reason,
      (entry) => publishAgentLifecycleEntry(emit, sessionId, entry),
    )
  }
  recorder.deferredLifecycle = []
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

function governingPackageForSession(session: SessionRecord): MemoryControlPackageIdentity | undefined {
  return activeTurnRecorders.get(session.id)?.governingPackage
    || [...(session.record?.entries || [])].reverse()
      .find((entry) => entry.kind === 'memory-control-package')?.packageIdentity
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
  const workingState = workingStateFromTurnRecord(session.record)
  const manifest = buildPiCompactionManifest(oldMessages, {
    sessionId: session.id,
    runId,
    sourceHash,
    objective,
    latestSeq: session.record?.entries.at(-1)?.seq,
    completedEffects: completedSideEffects(session),
    ...(workingState ? { workingState } : {}),
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
  const workingState = workingStateFromTurnRecord(session.record)
  const governingPackage = governingPackageForSession(session)
  const manifest = buildPiCompactionManifest(oldMessages, {
    sessionId: session.id,
    runId,
    sourceHash,
    objective: input.objective,
    latestSeq: session.record?.entries.at(-1)?.seq,
    completedEffects,
    ...(workingState ? { workingState } : {}),
  })
  const summary = workingState
    ? formatPiCompactionSummary(manifest, oldMessages)
    : preparedCompactionSummary(session, sourceHash, manifest.objective)
      || formatPiCompactionSummary(manifest, oldMessages)
  const checkpoint = input.checkpointWriter?.save({
    runId,
    threadId: session.threadId,
    objective: input.objective,
    summary,
    messages: oldMessages,
    parkedAtToolBoundary: true,
    // This snapshot is captured at a clean tool boundary. A later resume must
    // still prove its revision equals the durable session record.
    replaySafe: true,
    effects: completedEffects,
    reason,
    sourceHash,
    estimatedTokens: pressure.estimatedTokens,
    contextWindow: input.contextWindow,
    manifest,
    ...(workingState ? { workingStateRevision: workingState.revision, workingState } : {}),
    governingPackage,
    continuationItems: getPiContinuationItems(session.id, runId),
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
  if (activeSessionRuns.has(input.session.id)) {
    return [errorResponse(input.id, 'invalid_request', 'Pi session compaction requires a clean tool boundary')]
  }
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

function turnRecordToolSettlement(value: PiToolAuditRecord['settlement']): Extract<TurnRecordEntry, { kind: 'tool-result' }>['settlement'] {
  return value === 'success' || value === 'denied' || value === 'cancelled' || value === 'not-executed'
    ? value
    : 'failed'
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
      settlement: turnRecordToolSettlement(record.settlement),
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
  notExecutedReason: string | undefined
  toolFailed: boolean
  identity: TurnRecordToolContractIdentity | undefined
  proposal: WorkingStateProposal | undefined
  workingState: WorkingState
  trustedResult: unknown
  eventIsError: boolean
}): WorkingToolSettlement {
  if (input.notExecutedReason !== undefined) {
    publishInTurnToolEvent(input.state, input.sessionId, input.emit, {
      event: 'host/tool-result',
      payload: {
        runId: input.runId,
        tool: input.tool,
        callId: input.callId,
        settlement: 'not-executed',
        reason: input.notExecutedReason,
        ...(input.identity || {}),
      },
    })
    return 'not-executed'
  }
  if (input.denialReason !== undefined) return 'denied'
  const catalogued = input.state.catalogProjection.get(input.tool)
  const refusedAsInactive = input.eventIsError
    && input.identity?.contractStatus === 'catalogued-not-in-turn-contract'
    && catalogued?.available === true
    && catalogued.active === false
    ? catalogued.reason || `${input.tool} is not active in this turn`
    : undefined
  const settlement = refusedAsInactive ? 'denied' as const : input.toolFailed ? 'failed' as const : 'success' as const
  const failureReason = input.toolFailed
    ? piToolFailureDetail(input.trustedResult) || '工具執行失敗，Host 未收到錯誤說明'
    : undefined
  const executionEvidence = input.proposal
    ? hostFileWriteEvidence({
        state: input.workingState,
        proposal: input.proposal,
        identity: input.identity,
        settlement,
        trustedResult: input.trustedResult,
        executionRunId: input.runId,
      })
    : undefined
  publishInTurnToolEvent(input.state, input.sessionId, input.emit, {
    event: 'host/tool-result',
    payload: {
      runId: input.runId,
      tool: input.tool,
      callId: input.callId,
      settlement,
      ...(refusedAsInactive ? { reason: refusedAsInactive } : failureReason ? { reason: failureReason } : {}),
      ...memoryWriteToolResultFields(input.trustedResult, input.callId),
      ...workingExecutionEvidenceRecordFields(executionEvidence),
      ...(input.identity || {}),
    },
  })
  return settlement
}

function consumeModelToolInterception(sessionId: string, callId: string): {
  notExecutedReason: string | undefined
  denialReason: string | undefined
} {
  const notExecutedReason = consumePiSkillNotExecutedInTurnCall(sessionId, callId)
  return {
    notExecutedReason,
    denialReason: notExecutedReason === undefined ? consumePiDeniedInTurnCall(sessionId, callId) : undefined,
  }
}

function commitCheckedWorkingState(input: {
  sessionId: string
  recorder: ActiveTurnRecorder
  workingState: WorkingState
  proposal: WorkingStateProposal | undefined
  callId: string
  settlement: WorkingToolSettlement
  evidenceStillApplicable?: boolean
  executionRunId: string
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
  const proposal = settlement === 'success' || input.proposal.proposedStatus === 'blocked'
    ? input.proposal
    : blockedProposalFromToolOutcome(input.proposal, settlement, terminalEntry?.kind === 'tool-result' ? terminalEntry.detail : undefined)
  if (proposal !== input.proposal) {
    recordTurnEntry(input.sessionId, { kind: 'state-proposal', source: 'host', proposal })
  }
  const checked = checkWorkingStateProposal({
    enabled: input.recorder.memoryControl.fileContentChecker,
    state: input.workingState,
    proposal,
    settlement,
    evidence: executionEvidence,
    evidenceSeq: terminalIndex >= 0 ? input.recorder.seqBase + terminalIndex : 0,
    currentSequence: input.recorder.seqBase + input.recorder.entries.length - 1,
    maxEvidenceSequenceLag: input.recorder.memoryControl.maxEvidenceSequenceLag,
    evidenceStillApplicable: input.evidenceStillApplicable,
    executionRunId: input.executionRunId,
  })
  recordTurnEntry(input.sessionId, {
    kind: 'state-check', source: 'host', check: checked.check,
    packageIdentity: input.recorder.governingPackage,
  })
  if (checked.verdict === 'rejected') return input.workingState
  recordTurnEntry(input.sessionId, { kind: 'working-state', source: 'host', state: checked.state })
  return checked.state
}

function proposalEvidenceStillApplies(canonicalPath: string | undefined, proposal: WorkingStateProposal): boolean {
  if (proposal.proposedStatus !== 'done') return true
  if (!canonicalPath) return false
  try {
    return createHash('sha256').update(readFileSync(canonicalPath)).digest('hex') === proposal.file.sha256
  } catch {
    return false
  }
}

/** Recheck every done predicate, including goals completed in earlier iterations. */
function revalidateCompletedGoals(sessionId: string, recorder: ActiveTurnRecorder, state: WorkingState): WorkingState {
  let current = state
  for (const goal of state.goals) {
    if (goal.status !== 'done' || goal.completionPredicate?.kind !== 'file-content') continue
    let valid = false
    try {
      const path = canonicalPiToolPath(recorder.cwd, goal.completionPredicate.path)
      valid = isWithinProject(recorder.cwd, path)
        && createHash('sha256').update(readFileSync(path)).digest('hex') === goal.completionPredicate.sha256
    } catch { /* unavailable evidence cannot continue supporting done */ }
    if (valid) continue
    const invalidated = invalidateCompletedWorkingGoal(current, goal.id)
    recordTurnEntry(sessionId, { kind: 'state-check', source: 'host', check: invalidated.check, packageIdentity: recorder.governingPackage })
    current = invalidated.state
    recordTurnEntry(sessionId, { kind: 'working-state', source: 'host', state: current })
  }
  recorder.proposalState = current
  return current
}

function blockedProposalFromToolOutcome(
  proposal: WorkingStateProposal,
  settlement: Exclude<WorkingToolSettlement, 'success'>,
  detail?: string,
): WorkingStateProposal {
  const boundedDetail = detail?.replace(/\s+/g, ' ').trim().slice(0, 500)
  return {
    schemaVersion: 1,
    proposalId: `${proposal.proposalId}:blocked:${settlement}`,
    source: 'host',
    baseRevision: proposal.baseRevision,
    runId: proposal.runId,
    goalId: proposal.goalId,
    proposedStatus: 'blocked',
    tool: proposal.tool,
    callId: proposal.callId,
    blocker: boundedDetail || `${proposal.tool} ${settlement}; the requested effect was not verified`,
  }
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
  recordTurnEntry(input.sessionId, { kind: 'state-proposal', source: proposal.source, proposal })
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

type MemoryControlMaintenanceRequest = Omit<PiHostRequest, 'method'> & { method: 'memory-control/v1/maintain' }

type InternalPiHostRequest = (PiHostRequest | MemoryControlMaintenanceRequest) & {
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

type PiAgentMode = 'build' | 'plan'
type PiPlanCompletionAction = 'wait_for_user' | 'auto_start_build'

function admittedAgentMode(profile: unknown): PiAgentMode {
  return profile && typeof profile === 'object' && (profile as Record<string, unknown>).agentMode === 'plan'
    ? 'plan'
    : 'build'
}

function admittedPlanCompletionAction(profile: unknown): PiPlanCompletionAction {
  return profile && typeof profile === 'object'
    && (profile as Record<string, unknown>).planCompletionAction === 'auto_start_build'
    ? 'auto_start_build'
    : 'wait_for_user'
}

function admittedProfileObject(profile: unknown): Record<string, unknown> {
  return profile && typeof profile === 'object' ? profile as Record<string, unknown> : {}
}

function admittedDefinitionOfDone(value: unknown): string | undefined {
  return typeof value === 'string' ? value.trim().slice(0, 2_000) : undefined
}

function restoreContinuationItems(sessionId: string, runId: string, items?: ContinuationItem[]): void {
  if (items) setPiContinuationItems(sessionId, runId, items)
}

function planGateDecision(candidate: PiPlanGateCandidate | undefined): { ok: true; candidate: PiPlanGateCandidate } | { ok: false; reason: string } {
  if (!candidate) return { ok: false, reason: 'complete_plan 尚未提交結構化計畫' }
  if (!candidate.summary.trim() || candidate.steps.length === 0 || candidate.acceptanceCriteria.length === 0) {
    return { ok: false, reason: '計畫缺少 summary、steps 或 acceptance criteria' }
  }
  if (candidate.unresolvedQuestions.length > 0) return { ok: false, reason: '計畫仍有未決問題' }
  if (candidate.requiresAdditionalAuthority) return { ok: false, reason: '計畫需要目前 run 尚未取得的額外權限' }
  return { ok: true, candidate }
}

function planPhasePrompt(prompt: string, action: PiPlanCompletionAction): string {
  return [
    prompt,
    '## Host Plan phase',
    '目前只能分析、讀取及更新 .scratch/ 內的計畫文件，不可修改產品程式碼或執行其他副作用工具。',
    '完成規劃後必須呼叫 complete_plan，提交 summary、steps、acceptanceCriteria、unresolvedQuestions 與 requiresAdditionalAuthority。',
    action === 'auto_start_build'
      ? 'Host 只有在 Plan Gate 通過後才會建立新的 Build phase，並在同一個 run 內自動開始實作。'
      : 'Plan Gate 通過後停止，等待使用者另行開始 Build。',
  ].join('\n\n')
}

function buildPhasePrompt(originalPrompt: string, candidate: PiPlanGateCandidate): string {
  return [
    originalPrompt,
    '## Host Plan Gate passed: begin Build phase',
    candidate.summary,
    'Implementation steps:',
    ...candidate.steps.map((step, index) => `${index + 1}. ${step}`),
    'Acceptance criteria:',
    ...candidate.acceptanceCriteria.map((criterion) => `- ${criterion}`),
    '依照此計畫直接實作及驗證。不要重新停在規劃階段。',
  ].join('\n')
}

function continuationPrompt(originalPrompt: string, item: import('../src/agent/continuation.ts').ContinuationItem): string {
  return [
    originalPrompt,
    '## Host-selected next iteration item',
    `${item.title}: ${item.description}`,
    'Acceptance criteria:',
    ...item.acceptanceCriteria.map((criterion) => `- ${criterion}`),
    '直接完成此項目並驗證。若原始目標仍有未完成工作，settlement 前用 record_continuation_items 更新完整續行清單。不要送出新的使用者對話。',
  ].join('\n')
}

type IterationControlState = {
  effectiveAgentMode: PiAgentMode
  priorContinuationSignature: string
  repeatedContinuationCount: number
  outcome?: PiOrchestrationTurn
}

function settlePlanIteration(input: {
  sessionId: string
  runId: string
  settlement: PiOrchestrationTurn['settlement']
  answer: string
  action: PiPlanCompletionAction
  orchestrationPrompt: string
  goalAwarePrompt: string
  approvalMode: string
  iteration: number
  publish: (phase: 'replan', iteration: number, detail: string) => void
}): IterationControlState {
  const gate = planGateDecision(consumePiPlanGateCandidate(input.sessionId, input.runId))
  recordTurnEntry(input.sessionId, {
    kind: 'notice',
    source: 'host',
    topic: gate.ok ? 'plan-gate-passed' : 'plan-gate-blocked',
    text: gate.ok
      ? JSON.stringify({ summary: gate.candidate.summary, steps: gate.candidate.steps.length, acceptanceCriteria: gate.candidate.acceptanceCriteria.length })
      : gate.reason,
  })
  const unchanged = { effectiveAgentMode: 'plan' as const, priorContinuationSignature: '', repeatedContinuationCount: 0 }
  if (input.action === 'wait_for_user') return { ...unchanged, outcome: { settlement: input.settlement, result: input.answer, continue: false } }
  if (!gate.ok) {
    input.publish('replan', input.iteration, gate.reason)
    return {
      ...unchanged,
      outcome: {
        settlement: input.settlement,
        result: input.answer,
        done: false,
        nextPrompt: [input.orchestrationPrompt, '## Plan Gate blocked', gate.reason, '補齊計畫後再次呼叫 complete_plan。尚未通過前不可實作。'].join('\n\n'),
      },
    }
  }
  if (!transitionPiSessionAgentMode(input.sessionId, input.runId, 'plan', 'build')) {
    throw new Error('Plan Gate passed but Host policy phase transition failed')
  }
  recordTurnEntry(input.sessionId, {
    kind: 'notice',
    source: 'host',
    topic: 'agent-mode-transition',
    text: JSON.stringify({ from: 'plan', to: 'build', approvalMode: input.approvalMode }),
  })
  input.publish('replan', input.iteration, 'Plan Gate passed; Build phase admitted')
  return {
    ...unchanged,
    effectiveAgentMode: 'build',
    outcome: { settlement: input.settlement, result: input.answer, done: false, nextPrompt: buildPhasePrompt(input.goalAwarePrompt, gate.candidate) },
  }
}

function settleContinuationIteration(input: {
  sessionId: string
  runId: string
  settlement: PiOrchestrationTurn['settlement']
  answer: string
  goalAwarePrompt: string
  iteration: number
  effectiveAgentMode: PiAgentMode
  priorContinuationSignature: string
  repeatedContinuationCount: number
  publish: (phase: 'replan', iteration: number, detail: string) => void
}): IterationControlState {
  const continuationItems = getPiContinuationItems(input.sessionId, input.runId)
  const selection = selectContinuationItem(continuationItems)
  const unchanged = {
    effectiveAgentMode: input.effectiveAgentMode,
    priorContinuationSignature: input.priorContinuationSignature,
    repeatedContinuationCount: input.repeatedContinuationCount,
  }
  if (selection.blockedReason) {
    recordTurnEntry(input.sessionId, { kind: 'notice', source: 'host', topic: 'continuation-blocked', text: selection.blockedReason })
    return { ...unchanged, outcome: { settlement: 'failed', result: `${input.answer}\n\n自動續行已停止：${selection.blockedReason}`.trim(), continue: false, done: false } }
  }
  if (!selection.item) return unchanged
  const signature = continuationSignature(selection.item)
  const repeated = signature === input.priorContinuationSignature ? input.repeatedContinuationCount + 1 : 0
  if (repeated >= 2) {
    const reason = `續行項目「${selection.item.title}」連續沒有更新，已停止避免無限迴圈。`
    recordTurnEntry(input.sessionId, { kind: 'notice', source: 'host', topic: 'continuation-no-progress', text: reason })
    return { ...unchanged, priorContinuationSignature: signature, repeatedContinuationCount: repeated, outcome: { settlement: 'failed', result: `${input.answer}\n\n${reason}`.trim(), continue: false, done: false } }
  }
  setPiContinuationItems(input.sessionId, input.runId, continuationItems.map((item) =>
    item.id === selection.item!.id ? { ...item, status: 'running' as const } : item,
  ))
  recordTurnEntry(input.sessionId, {
    kind: 'notice',
    source: 'host',
    topic: 'continuation-selected',
    text: JSON.stringify({ id: selection.item.id, title: selection.item.title, priority: selection.item.priority, acceptanceCriteria: selection.item.acceptanceCriteria, effectiveFromIteration: input.iteration + 1 }),
  })
  input.publish('replan', input.iteration, `Next item: ${selection.item.title}`)
  return {
    ...unchanged,
    priorContinuationSignature: signature,
    repeatedContinuationCount: repeated,
    outcome: { settlement: input.settlement, result: input.answer, done: false, nextPrompt: continuationPrompt(input.goalAwarePrompt, selection.item) },
  }
}

function settleIterationControl(input: {
  pattern: PiLoopPattern
  done?: boolean
  state: IterationControlState
  plan: Parameters<typeof settlePlanIteration>[0]
  continuation: Omit<Parameters<typeof settleContinuationIteration>[0], 'effectiveAgentMode' | 'priorContinuationSignature' | 'repeatedContinuationCount'>
}): IterationControlState {
  if (input.state.effectiveAgentMode === 'plan') return settlePlanIteration(input.plan)
  if (input.pattern === 'Goal-based' && input.done === false) {
    return settleContinuationIteration({ ...input.continuation, ...input.state })
  }
  return input.state
}

function publishDefinitionOfDone(input: {
  definitionOfDone?: string
  done?: boolean
  iteration: number
  iterationLimit: number
  publish: (phase: 'dod' | 'replan', iteration: number, detail: string) => void
}): void {
  if (!input.definitionOfDone) return
  input.publish('dod', input.iteration, input.done ? 'met' : 'unmet')
  if (!input.done && input.iteration < input.iterationLimit) input.publish('replan', input.iteration, 'DoD unmet; retrying the Pi turn')
}

function iterationControlToolNames(mode: PiAgentMode, pattern: PiLoopPattern): string[] {
  if (mode === 'plan') return ['complete_plan']
  return pattern === 'Goal-based' ? ['record_continuation_items'] : []
}

function goalContinuationPrompt(prompt: string): string {
  return [
    prompt,
    '## Goal continuation contract',
    '若此 iteration 結束時原始目標仍有可實作或可改善的工作，先呼叫 record_continuation_items，提交完整 backlog。',
    '每個項目必須留在 original-objective、帶 acceptance criteria，並明確標示是否需要額外權限。Host 會在 settlement 後選擇下一項，直接啟動內部 iteration，不會建立使用者訊息。',
  ].join('\n\n')
}

function restrictActiveTools(current: readonly string[], latest: readonly string[]): string[] {
  if (latest.length === 0) return [...current]
  if (current.length === 0) return [...new Set(latest)]
  const allowed = new Set(latest)
  return current.filter((tool) => allowed.has(tool))
}

const APPROVAL_STRICTNESS = { always: 0, auto: 1, full: 2 } as const

function stricterApprovalMode(
  current: 'always' | 'auto' | 'full',
  latest: 'always' | 'auto' | 'full',
): 'always' | 'auto' | 'full' {
  return APPROVAL_STRICTNESS[latest] < APPROVAL_STRICTNESS[current] ? latest : current
}

function refreshIterationSettings(input: {
  current: PiSettings
  latest: PiSettings
  effectiveRevision: number
  latestRevision: number
  admittedProfile: Record<string, unknown>
  sessionId: string
  runId: string
  iteration: number
  freezeUnattended?: boolean
}): { settings: PiSettings; revision: number } {
  if (input.latestRevision === input.effectiveRevision) {
    return { settings: input.current, revision: input.effectiveRevision }
  }
  const approvalMode = stricterApprovalMode(input.current.approvalMode, input.latest.approvalMode)
  const unattended = input.freezeUnattended
    ? input.current.unattended
    : input.current.unattended || input.latest.unattended
  const settings: PiSettings = {
    ...input.current,
    ...(!('provider' in input.admittedProfile) ? { provider: input.latest.provider } : {}),
    ...(!('model' in input.admittedProfile) ? { model: input.latest.model } : {}),
    ...(!('thinkingLevel' in input.admittedProfile) ? { thinkingLevel: input.latest.thinkingLevel } : {}),
    // An explicit per-turn allowlist was admitted and frozen before this
    // refresh. Persisted settings are not authority to revoke that already
    // approved profile; only profile-less turns tighten against latest state.
    // This keeps explicit `grep` from being cleared by an unrelated cursor
    // advance while preserving fail-closed empty intersections below.
    activeTools: 'activeTools' in input.admittedProfile
      ? input.current.activeTools
      : restrictActiveTools(input.current.activeTools, input.latest.activeTools),
    approvalMode,
    unattended,
  }
  tightenPiSessionApprovalMode(input.sessionId, input.runId, approvalMode)
  if (unattended) tightenPiSessionUnattended(input.sessionId, input.runId)
  recordTurnEntry(input.sessionId, {
    kind: 'notice',
    source: 'host',
    topic: 'runtime-settings-effective',
    text: JSON.stringify({
      revision: input.latestRevision,
      effectiveFromIteration: input.iteration,
      model: settings.model,
      thinkingLevel: settings.thinkingLevel,
      approvalMode: settings.approvalMode,
      unattended: settings.unattended,
      activeTools: settings.activeTools,
    }),
  })
  return { settings, revision: input.latestRevision }
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

type DirectBuiltinToolDispatchInput = {
  state: HostState
  id: string | number
  envelope: DirectToolEnvelope
  toolName: PiBuiltinToolName
  args: Record<string, unknown>
  invocationOrigin: 'direct-protocol' | 'code-mode'
  emit?: (message: PiHostMessage) => void
  sideEffect: boolean
  bashDecision?: ReturnType<typeof decideBashAction>
  hasRunId: boolean
}

function directBuiltinToolRequirements(
  toolName: PiBuiltinToolName,
  sideEffect: boolean,
  bashDecision: ReturnType<typeof decideBashAction> | undefined,
): PiToolPolicyRequirements {
  return {
    ...(toolName !== 'bash' ? { pathArguments: ['path'] } : {}),
    ...(toolName === 'bash' ? { outbound: true } : {}),
    ...(sideEffect ? { sideEffect: true, approvalRequired: bashDecision?.reason || `${toolName} requires approval before execution` } : {}),
    ...(bashDecision?.action === 'ask' ? { capabilityApproval: bashDecision.reason } : {}),
  }
}

async function authorizeDirectBuiltinTool(
  input: DirectBuiltinToolDispatchInput,
): Promise<InvocationAuthorization | { ok: false; contractError: string }> {
  const { envelope, state, toolName } = input
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
  return authorizeContractInvocation({
    state,
    sessionId: envelope.sessionId || 'direct',
    runId: envelope.runId,
    callId: envelope.callId,
    parentRunId: envelope.parentRunId,
    cwd: envelope.cwd,
    tool: toolName,
    args: input.args,
    origin: input.invocationOrigin,
    approval: envelope.approval,
    requirements: directBuiltinToolRequirements(input.toolName, input.sideEffect, input.bashDecision),
    identity: foundIdentity?.identity || detachedIdentity,
  })
}

function createBuiltinToolPublisher(input: DirectBuiltinToolDispatchInput): {
  updates: PiHostEvent[]
  publish: (event: PiHostEvent) => void
} {
  const updates: PiHostEvent[] = []
  const publish = (event: PiHostEvent) => {
    recordToolAudit(input.state, input.envelope.sessionId, event)
    if (input.emit) input.emit(event)
    else updates.push(event)
  }
  return { updates, publish }
}

function builtinToolAuthorizationFailure(input: {
  id: string | number
  envelope: DirectToolEnvelope
  toolName: PiBuiltinToolName
  authorization: InvocationAuthorization
  identityPayload: Record<string, unknown>
  updates: PiHostEvent[]
  publish: (event: PiHostEvent) => void
}): PiHostMessage[] {
  const { authorization, envelope, id, identityPayload, publish, toolName, updates } = input
  publish({ event: 'host/tool-decision', payload: {
    runId: envelope.runId,
    tool: toolName,
    callId: envelope.callId,
    parentRunId: envelope.parentRunId,
    decision: authorization.decision,
    ...(authorization.settlement ? { settlement: authorization.settlement } : {}),
    reason: authorization.reason,
    ...identityPayload,
  } })
  if (authorization.settlement) publish({ event: 'host/tool-result', payload: {
    runId: envelope.runId,
    tool: toolName,
    callId: envelope.callId,
    parentRunId: envelope.parentRunId,
    settlement: authorization.settlement,
    reason: authorization.reason,
    ...identityPayload,
  } })
  return [...updates, errorResponse(id, 'invalid_request', authorization.decision === 'ask'
    ? `Approval required: ${authorization.reason}`
    : authorization.reason)]
}

function builtinToolDeniedResponse(input: {
  id: string | number
  envelope: DirectToolEnvelope
  toolName: PiBuiltinToolName
  decision: { reason: string }
  authorization: InvocationAuthorization
  identityPayload: Record<string, unknown>
  updates: PiHostEvent[]
  publish: (event: PiHostEvent) => void
}): PiHostMessage[] {
  const { authorization, decision, envelope, id, identityPayload, publish, toolName, updates } = input
  authorization.evidence.result(false, decision.reason)
  authorization.evidence.settle('denied', decision.reason)
  publish({ event: 'host/tool-decision', payload: {
    runId: envelope.runId,
    tool: toolName,
    callId: envelope.callId,
    parentRunId: envelope.parentRunId,
    decision: 'deny',
    settlement: 'denied',
    reason: decision.reason,
    ...identityPayload,
  } })
  publish({ event: 'host/tool-result', payload: {
    runId: envelope.runId,
    tool: toolName,
    callId: envelope.callId,
    parentRunId: envelope.parentRunId,
    settlement: 'denied',
    reason: decision.reason,
    ...identityPayload,
  } })
  return [...updates, errorResponse(id, 'invalid_request', `bash denied: ${decision.reason}`)]
}

function builtinToolScopeFailure(input: {
  id: string | number
  envelope: DirectToolEnvelope
  toolName: PiBuiltinToolName
  authorization: InvocationAuthorization
  identityPayload: Record<string, unknown>
  updates: PiHostEvent[]
  publish: (event: PiHostEvent) => void
}): PiHostMessage[] {
  const { authorization, envelope, id, identityPayload, publish, toolName, updates } = input
  const reason = `${toolName} path is outside the requested project scope`
  authorization.evidence.result(false, reason)
  authorization.evidence.settle('failed', reason)
  publish({ event: 'host/tool-result', payload: {
    runId: envelope.runId,
    tool: toolName,
    callId: envelope.callId,
    parentRunId: envelope.parentRunId,
    settlement: 'failed',
    reason,
    ...identityPayload,
  } })
  return [...updates, errorResponse(id, 'invalid_request', reason)]
}

function createBuiltinToolUpdateHandler(input: {
  runId: string
  toolName: PiBuiltinToolName
  callId: string
  projectRoot: string
  hasRunId: boolean
  publish: (event: PiHostEvent) => void
}): (item: unknown) => void {
  let updateBytes = 0
  let updateTruncated = false
  return (item: unknown) => {
    if (!input.hasRunId || updateTruncated) return
    const serialized = JSON.stringify(item)
    const serializedBytes = Buffer.byteLength(serialized, 'utf8')
    const remaining = PI_HOST_TOOL_UPDATE_MAX_BYTES - updateBytes
    if (serializedBytes <= remaining) {
      updateBytes += serializedBytes
      input.publish({ event: 'host/tool-update', payload: { runId: input.runId, tool: input.toolName, callId: input.callId, item } })
      return
    }
    updateTruncated = true
    const spill = writeToolOutputSpill({ runId: input.runId, tool: input.toolName, output: serialized, projectRoot: input.projectRoot })
    input.publish({ event: 'host/tool-update', payload: { runId: input.runId, tool: input.toolName, callId: input.callId, item: {
      type: 'truncated',
      content: Buffer.from(serialized, 'utf8').subarray(0, Math.max(0, remaining)).toString('utf8'),
      originalBytes: serializedBytes,
      spill,
    } } })
  }
}

async function executeAuthorizedBuiltinTool(input: {
  id: string | number
  envelope: DirectToolEnvelope
  toolName: PiBuiltinToolName
  executionArgs: Record<string, unknown>
  executionRoot: string
  hasRunId: boolean
  authorization: InvocationAuthorization
  identityPayload: Record<string, unknown>
  updates: PiHostEvent[]
  publish: (event: PiHostEvent) => void
}): Promise<PiHostMessage[]> {
  const scopedPath = typeof input.executionArgs.path === 'string' ? input.executionArgs.path : undefined
  if (scopedPath && !isWithinProject(input.executionRoot, scopedPath)) {
    return builtinToolScopeFailure({
      id: input.id,
      envelope: input.envelope,
      toolName: input.toolName,
      authorization: input.authorization,
      identityPayload: input.identityPayload,
      updates: input.updates,
      publish: input.publish,
    })
  }
  try {
    const result = await executePiTool(input.toolName, input.executionRoot, input.executionArgs, {
      runId: input.hasRunId ? input.envelope.runId : undefined,
      onUpdate: createBuiltinToolUpdateHandler({
        runId: input.envelope.runId,
        toolName: input.toolName,
        callId: input.envelope.callId,
        projectRoot: input.executionRoot,
        hasRunId: input.hasRunId,
        publish: input.publish,
      }),
    })
    const settlement = result.cancelled ? 'cancelled' as const : 'success' as const
    input.authorization.evidence.update(result.cancelled ? 'Builtin execution cancelled' : 'Builtin execution completed')
    input.authorization.evidence.result(!result.cancelled, result.cancelled ? 'cancelled' : 'result returned')
    input.authorization.evidence.settle(settlement)
    input.publish({ event: 'host/tool-result', payload: { runId: input.envelope.runId, tool: input.toolName, callId: input.envelope.callId, parentRunId: input.envelope.parentRunId, settlement, item: result, ...input.identityPayload } })
    return result.cancelled
      ? [...input.updates, { id: input.id, result: { runId: input.envelope.runId, settlement: 'cancelled' as const, tool: input.toolName, content: result.content } }]
      : [...input.updates, { id: input.id, result: { tool: input.toolName, content: result.content } }]
  } catch (error) {
    const reason = error instanceof Error ? error.message : `Pi ${input.toolName} failed`
    input.authorization.evidence.result(false, reason)
    input.authorization.evidence.settle('failed', reason)
    input.publish({ event: 'host/tool-result', payload: { runId: input.envelope.runId, tool: input.toolName, callId: input.envelope.callId, parentRunId: input.envelope.parentRunId, settlement: 'failed', reason, ...input.identityPayload } })
    return [...input.updates, errorResponse(input.id, 'invalid_request', reason)]
  }
}

async function dispatchDirectBuiltinTool(input: DirectBuiltinToolDispatchInput): Promise<PiHostMessage[]> {
  const { updates, publish } = createBuiltinToolPublisher(input)
  const authorized = await authorizeDirectBuiltinTool(input)
  if ('contractError' in authorized) return [errorResponse(input.id, 'invalid_request', authorized.contractError)]
  const identityPayload = { ...authorized.identity, invocationOrigin: input.invocationOrigin }
  publish({ event: 'host/tool-start', payload: {
    runId: input.envelope.runId,
    tool: input.toolName,
    callId: input.envelope.callId,
    parentRunId: input.envelope.parentRunId,
    item: typeof authorized.args.path === 'string' ? { path: authorized.args.path } : undefined,
    ...identityPayload,
  } })
  if (input.bashDecision?.action === 'deny') {
    return builtinToolDeniedResponse({ ...input, authorization: authorized, decision: input.bashDecision, identityPayload, updates, publish })
  }
  if (!authorized.ok) return builtinToolAuthorizationFailure({ ...input, authorization: authorized, identityPayload, updates, publish })
  if (input.sideEffect) publish({ event: 'host/tool-decision', payload: {
    runId: input.envelope.runId,
    tool: input.toolName,
    callId: input.envelope.callId,
    parentRunId: input.envelope.parentRunId,
    decision: 'allow',
    reason: authorized.reason,
    ...identityPayload,
  } })
  const executionRoot = input.envelope.sessionId
    ? frozenPolicyForInvocation(input.state, input.envelope.sessionId, input.envelope.cwd).outbound.restrictedViewRoot || input.envelope.cwd
    : input.envelope.cwd
  return executeAuthorizedBuiltinTool({
    id: input.id,
    envelope: input.envelope,
    toolName: input.toolName,
    executionArgs: authorized.args,
    executionRoot,
    hasRunId: input.hasRunId,
    authorization: authorized,
    identityPayload,
    updates,
    publish,
  })
}

/**
 * Clock used to arm per-turn deadlines. Swapped by the deadline smoke so the
 * timeout path is driven by a fake clock instead of by real waiting.
 */
let turnDeadlineClock: TurnDeadlineClock = systemTurnDeadlineClock

export function setPiTurnDeadlineClock(clock: TurnDeadlineClock = systemTurnDeadlineClock): void {
  turnDeadlineClock = clock
}

function piTurnEventDeadlineLeaseMs(event: {
  type?: unknown
  toolName?: unknown
  args?: unknown
}): number | undefined {
  if (event.type !== 'tool_execution_start') return undefined
  return toolExecutionDeadlineLeaseMs(
    typeof event.toolName === 'string' ? event.toolName : 'tool',
    event.args,
  )
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
  if (requestedVersion !== PI_HOST_PROTOCOL_VERSION && requestedVersion !== 4 && requestedVersion !== 3 && requestedVersion !== 2) {
    return [errorResponse(id, 'protocol_mismatch', `Unsupported Pi Host Protocol version: ${String(requestedVersion)}`)]
  }
  state.initialized = true
  state.negotiatedProtocolVersion = requestedVersion as number
  const requestedCapabilities = (input.params as { capabilities?: unknown } | undefined)?.capabilities
  state.toolContractNegotiated = !Array.isArray(requestedCapabilities) || requestedCapabilities.includes('tool-contract-v1')
  state.memoryStoreNegotiated = Array.isArray(requestedCapabilities) && requestedCapabilities.includes('memory-store-v1')
  state.memoryControlNegotiated = negotiatedV5Capability(requestedVersion, requestedCapabilities, 'memory-control-v1')
  state.instructionRepositoryNegotiated = negotiatedV5Capability(requestedVersion, requestedCapabilities, 'instructions-v1')
  state.reviewNegotiated = negotiatedV5Capability(requestedVersion, requestedCapabilities, 'review-v1')
  state.agentTreeNegotiated = negotiatedV5Capability(requestedVersion, requestedCapabilities, 'agent-tree-v1')
  state.agentCollaborationNegotiated = negotiatedV5Capability(requestedVersion, requestedCapabilities, 'agent-collaboration-v1')
  const result = readyResult(state.negotiatedProtocolVersion)
  return [
    { event: 'host/ready', payload: {
      protocolVersion: result?.protocolVersion ?? state.negotiatedProtocolVersion,
      capabilities: result?.capabilities ?? [...PI_HOST_CAPABILITIES],
    } },
    { id, result },
  ]
}

function negotiatedV5Capability(version: unknown, requested: unknown, capability: PiHostCapability): boolean {
  return version === PI_HOST_PROTOCOL_VERSION && Array.isArray(requested) && requested.includes(capability)
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

function handleMemoryOrCapabilityRequest(
  state: HostState,
  input: Partial<InternalPiHostRequest>,
  id: string | number,
  emit?: (message: PiHostMessage) => void,
): PiHostMessage[] | Promise<PiHostMessage[]> | undefined {
  return handleDurableMemoryRequest(state, input, id, emit) || (input.method ? handlePiHostCapabilityDomain({
    state: {
      capabilities: state.capabilities,
      workspaceTextSearchEnabled: state.snapshot.settings.workspaceTextSearch === true,
    },
    method: input.method,
    params: input.params,
    id,
  }) : undefined)
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

async function handleInstructionRequest(
  state: HostState,
  input: Partial<PiHostRequest>,
  id: string | number,
  emit?: (message: PiHostMessage) => void,
): Promise<PiHostMessage[] | undefined> {
  if (!input.method?.startsWith('instructions/v1/')) return undefined
  if (!state.instructionRepositoryNegotiated) {
    return [errorResponse(id, 'protocol_mismatch', 'Instruction Repository requires current protocol and instructions-v1 negotiation')]
  }
  try {
    const params = input.params || {}
    if (input.method === 'instructions/v1/get') return [{ id, result: { instructions: await state.instructionRepository.read() } }]
    if (input.method === 'instructions/v1/save') return await saveInstructionRequest(state, id, params, emit)
    if (input.method === 'instructions/v1/migrate-legacy') return await migrateLegacyInstructionRequest(state, id, params, emit)
    if (input.method === 'instructions/v1/resolve') return await resolveInstructionRequest(state, id, params, emit)
    if (input.method === 'instructions/v1/authorize-include') return await authorizeInstructionIncludeRequest(state, id, params, emit)
    if (input.method === 'instructions/v1/project-write') return await writeInstructionRequest(state, id, params, emit)
    if (input.method === 'instructions/v1/project-read') return await readInstructionRequest(state, id, params)
    if (input.method === 'instructions/v1/export') return [{ id, result: { instructionExport: await state.instructionRepository.exportBundle() } }]
    if (input.method === 'instructions/v1/import-preview') return [{ id, result: { instructionImportPreview: await state.instructionRepository.previewImport(params.bundle) } }]
    if (input.method === 'instructions/v1/import-apply') return await applyInstructionImportRequest(state, id, params, emit)
    return [errorResponse(id, 'unknown_method', `Unknown instruction method: ${input.method}`)]
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Instruction Repository request failed'
    if (error instanceof InstructionRepositoryError || error instanceof ProjectInstructionWriteError) {
      return [errorResponse(id, error.code, message)]
    }
    return [errorResponse(id, 'invalid_request', message)]
  }
}

async function readReviewArtifactRequest(
  state: HostState,
  params: Record<string, unknown>,
  id: string | number,
): Promise<PiHostMessage[]> {
  const snapshotId = typeof params.snapshotId === 'string' ? params.snapshotId.trim() : ''
  if (!snapshotId) return [errorResponse(id, 'invalid_request', 'snapshotId is required')]
  const reviewArtifact = await state.reviewArtifactStore.read(snapshotId)
  return [{ id, result: { reviewArtifact } }]
}

async function readReviewPayloadPageRequest(
  state: HostState,
  params: Record<string, unknown>,
  id: string | number,
): Promise<PiHostMessage[]> {
  const snapshotId = typeof params.snapshotId === 'string' ? params.snapshotId.trim() : ''
  const payloadId = typeof params.payloadId === 'string' ? params.payloadId.trim() : ''
  if (!snapshotId || !payloadId) return [errorResponse(id, 'invalid_request', 'snapshotId and payloadId are required')]
  const page = await state.reviewArtifactStore.readPayloadPage({
    snapshotId,
    payloadId,
    offset: Number(params.offset) || 0,
    maxBytes: Number(params.maxBytes) || 16 * 1024,
  })
  return [{ id, result: { reviewPayloadPage: {
    payloadId: page.payloadId,
    contentBase64: Buffer.from(page.content).toString('base64'),
    offset: page.offset,
    bytes: page.bytes,
    ...(page.nextOffset === undefined ? {} : { nextOffset: page.nextOffset }),
  } } }]
}

async function finalizeReviewRequest(
  state: HostState,
  params: Record<string, unknown>,
  id: string | number,
): Promise<PiHostMessage[]> {
  let snapshotId = typeof params.snapshotId === 'string' ? params.snapshotId.trim() : ''
  const runId = typeof params.runId === 'string' ? params.runId.trim() : ''
  const settlementKind = ['completed', 'failed', 'cancelled', 'timeout', 'crash'].includes(String(params.settlementKind))
    ? params.settlementKind as 'completed' | 'failed' | 'cancelled' | 'timeout' | 'crash'
    : 'failed'
  const activeWorkspaceRuns = Number.isSafeInteger(Number(params.activeWorkspaceRuns)) && Number(params.activeWorkspaceRuns) > 0
    ? Number(params.activeWorkspaceRuns)
    : 1
  if (!snapshotId && runId) snapshotId = (await state.reviewArtifactStore.findByRunId(runId))?.snapshotId || ''
  if (!snapshotId) return [errorResponse(id, 'not_found', 'Review snapshot identity is unavailable')]
  const current = await state.reviewArtifactStore.read(snapshotId)
  if (current.status === 'ready' || current.status === 'partial' || current.status === 'failed') {
    return [{ id, result: { reviewSnapshotRef: { snapshotId, runId: current.runId, status: current.status, attributionFidelity: current.attributionFidelity, ...(current.manifestHash ? { manifestHash: current.manifestHash } : {}) } } }]
  }
  const trustedMutations: TrustedReviewMutation[] = state.snapshot.sessions.flatMap((session) =>
    (session.record?.entries || []).flatMap((entry) => {
      if (entry.kind !== 'tool-result' || entry.settlement !== 'success' || !entry.executionEvidence || entry.executionEvidence.runId !== current.runId) return []
      const tool = entry.executionEvidence.tool
      if (tool !== 'write' && tool !== 'edit' && tool !== 'delete' && tool !== 'move') return []
      return [{ source: 'host' as const, runId: current.runId, callId: entry.callId, tool, paths: [entry.executionEvidence.resource.path], settlement: 'success' as const }]
    }),
  )
  const captured = await captureRunReviewSnapshot({ admission: current.admission, threadId: current.threadId, trustedMutations, settlementKind, activeWorkspaceRuns })
  const finalized = await state.reviewArtifactStore.finalizeRun(captured)
  return [{ id, result: { reviewSnapshotRef: { snapshotId, runId: finalized.runId, status: finalized.status, attributionFidelity: finalized.attributionFidelity, ...(finalized.manifestHash ? { manifestHash: finalized.manifestHash } : {}) } } }]
}

type ReviewTargetRequestMethod = 'review/v1/describe' | 'review/v1/refresh' | 'review/v1/files' | 'review/v1/file-diff'

function isReviewTargetMethod(method: unknown): method is ReviewTargetRequestMethod {
  return method === 'review/v1/describe'
    || method === 'review/v1/refresh'
    || method === 'review/v1/files'
    || method === 'review/v1/file-diff'
}

async function handleReviewTargetRequest(
  state: HostState,
  method: ReviewTargetRequestMethod,
  params: Record<string, unknown>,
  id: string | number,
): Promise<PiHostMessage[]> {
  const target = params.target as ReviewTarget | undefined
  if (!target || typeof target !== 'object' || typeof target.kind !== 'string') {
    return [errorResponse(id, 'invalid_request', 'typed review target is required')]
  }
  if (method === 'review/v1/describe') return [{ id, result: { reviewTargetDescription: await state.reviewProjection.describeTarget(target) } }]
  if (method === 'review/v1/refresh') return [{ id, result: { reviewTargetDescription: await state.reviewProjection.refresh(target) } }]
  if (method === 'review/v1/files') return [{ id, result: { reviewFiles: await state.reviewProjection.listFiles(target, {
    cursor: typeof params.cursor === 'string' ? params.cursor : undefined,
    limit: Number(params.limit) || undefined,
    query: typeof params.query === 'string' ? params.query : undefined,
  }) } }]
  const path = typeof params.path === 'string' ? params.path : ''
  if (!path) return [errorResponse(id, 'invalid_request', 'review file path is required')]
  return [{ id, result: { reviewDiff: await state.reviewProjection.readFileDiff(target, path, {
    cursor: typeof params.cursor === 'string' ? params.cursor : undefined,
    maxBytes: Number(params.maxBytes) || undefined,
  }) } }]
}

async function admitReviewRequest(
  state: HostState,
  params: Record<string, unknown>,
  id: string | number,
): Promise<PiHostMessage[]> {
  const runId = typeof params.runId === 'string' ? params.runId.trim() : ''
  const projectRoot = typeof params.projectRoot === 'string' ? params.projectRoot.trim() : ''
  const runnerKind = params.runnerKind === 'external' ? 'external' : params.runnerKind === 'builtin' ? 'builtin' : undefined
  if (!runId || !projectRoot || !runnerKind) {
    return [errorResponse(id, 'invalid_request', 'runId, projectRoot, and runnerKind are required')]
  }
  const reviewAdmission = await captureReviewWorkspaceAdmission({ runId, projectRoot, runnerKind })
  if (reviewAdmission.canonical && reviewAdmission.workspace) state.reviewWorkspaces.set(reviewAdmission.workspace.workspaceId, reviewAdmission.workspace)
  await state.reviewArtifactStore.beginRun({ admission: reviewAdmission, threadId: typeof params.threadId === 'string' && params.threadId.trim() ? params.threadId.trim() : runId })
  return [{ id, result: { reviewAdmission } }]
}

type ReviewStateRequestMethod = 'review/v1/comments/list' | 'review/v1/draft/save' | 'review/v1/draft/delete' | 'review/v1/comment/transition' | 'review/v1/file-state/list' | 'review/v1/file-state/mark' | 'review/v1/state/inherit' | 'review/v1/feedback/prepare' | 'review/v1/feedback/claim' | 'review/v1/feedback/release'

function isReviewStateMethod(method: unknown): method is ReviewStateRequestMethod {
  return method === 'review/v1/comments/list' || method === 'review/v1/draft/save' || method === 'review/v1/draft/delete'
    || method === 'review/v1/comment/transition' || method === 'review/v1/file-state/list' || method === 'review/v1/file-state/mark'
    || method === 'review/v1/feedback/prepare' || method === 'review/v1/feedback/claim' || method === 'review/v1/feedback/release'
    || method === 'review/v1/state/inherit'
}

function reviewHunkAnchor(snapshotId: string, path: string, hunk: ReviewDiffHunk, side: 'old' | 'new', line: number) {
  const context = hunk.content.split('\n').filter((value) => !value.startsWith('diff ') && !value.startsWith('index ') && !value.startsWith('---') && !value.startsWith('+++') && !value.startsWith('@@')).slice(0, 7).join('\n')
  return { snapshotId, path, side, line, hunkFingerprint: createHash('sha256').update(hunk.header).digest('hex'), contextHash: createHash('sha256').update(context).digest('hex'), originalContext: context }
}

function reviewHunkContainsLine(hunk: ReviewDiffHunk, side: 'old' | 'new', line: number): boolean {
  const match = hunk.header.match(/^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/)
  if (!match) return false
  const start = Number(side === 'old' ? match[1] : match[3])
  const count = Number((side === 'old' ? match[2] : match[4]) || 1)
  return count > 0 && line >= start && line < start + count
}

async function resolveReviewCommentHunk(
  state: HostState,
  snapshotId: string,
  path: string,
  requestedHunkId?: string,
): Promise<ReviewDiffHunk | undefined> {
  let cursor: string | undefined
  const candidates: ReviewDiffHunk[] = []
  do {
    const page = await state.reviewProjection.readFileDiff(
      { kind: 'run-snapshot', snapshotId },
      path,
      { ...(cursor ? { cursor } : {}), maxBytes: 256 * 1024 },
    )
    const hunks = page.items.filter((item) => item.header.startsWith('@@'))
    if (requestedHunkId) {
      const selected = hunks.find((item) => item.id === requestedHunkId)
      if (selected) return selected
    } else {
      candidates.push(...hunks)
    }
    cursor = page.nextCursor
  } while (cursor)
  return requestedHunkId ? undefined : candidates.length === 1 ? candidates[0] : undefined
}

async function saveReviewDraftRequest(state: HostState, params: Record<string, unknown>, id: string | number): Promise<PiHostMessage[]> {
  const snapshotId = typeof params.snapshotId === 'string' ? params.snapshotId : ''
  const path = typeof params.path === 'string' ? params.path : ''
  const body = typeof params.body === 'string' ? params.body : ''
  const draftId = typeof params.id === 'string' ? params.id : undefined
  let anchor = draftId ? (await state.reviewStateStore.listComments(snapshotId)).find((comment) => comment.id === draftId)?.anchor : undefined
  if (!anchor) {
    if (!snapshotId || !path) return [errorResponse(id, 'invalid_request', 'snapshotId and path are required')]
    const requestedHunkId = typeof params.hunkId === 'string' ? params.hunkId : undefined
    const hunk = await resolveReviewCommentHunk(state, snapshotId, path, requestedHunkId)
    if (!hunk) return [errorResponse(id, 'invalid_request', requestedHunkId ? 'Selected review hunk is unavailable' : 'A hunkId is required when a file has multiple hunks')]
    const requestedLine = Number.isSafeInteger(Number(params.line)) && Number(params.line) > 0 ? Number(params.line) : 1
    const side = params.side === 'old' ? 'old' : 'new'
    if (!reviewHunkContainsLine(hunk, side, requestedLine)) return [errorResponse(id, 'invalid_request', 'Selected line does not belong to the selected hunk')]
    anchor = reviewHunkAnchor(snapshotId, path, hunk, side, requestedLine)
  }
  return [{ id, result: { reviewComment: await state.reviewStateStore.saveDraft({ id: draftId, anchor, body }) } }]
}

async function inheritReviewStateRequest(state: HostState, params: Record<string, unknown>, id: string | number): Promise<PiHostMessage[]> {
  const fromSnapshotId = typeof params.fromSnapshotId === 'string' ? params.fromSnapshotId : ''
  const toSnapshotId = typeof params.toSnapshotId === 'string' ? params.toSnapshotId : ''
  if (!fromSnapshotId || !toSnapshotId) return [errorResponse(id, 'invalid_request', 'fromSnapshotId and toSnapshotId are required')]
  const [comments, after] = await Promise.all([state.reviewStateStore.listComments(fromSnapshotId), state.reviewArtifactStore.read(toSnapshotId)])
  const anchorCandidates = []
  for (const comment of comments) {
    const file = after.manifest.find((entry) => entry.path === comment.anchor.path)
    if (!file || file.binary) continue
    const page = await state.reviewProjection.readFileDiff({ kind: 'run-snapshot', snapshotId: toSnapshotId }, file.path, { maxBytes: 256 * 1024 })
    for (const hunk of page.items.filter((item) => item.header.startsWith('@@'))) anchorCandidates.push(reviewHunkAnchor(toSnapshotId, file.path, hunk, comment.anchor.side, comment.anchor.line))
  }
  const inherited = await state.reviewStateStore.inheritSnapshot({ fromSnapshotId, toSnapshotId, nextManifest: after.manifest, anchorCandidates })
  return [{ id, result: { reviewComments: inherited.comments, reviewFileStates: inherited.fileStates } }]
}

async function handleReviewFeedbackRequest(state: HostState, method: Extract<ReviewStateRequestMethod, `review/v1/feedback/${string}`>, params: Record<string, unknown>, id: string | number): Promise<PiHostMessage[]> {
  if (method === 'review/v1/feedback/prepare') {
    const snapshotId = typeof params.snapshotId === 'string' ? params.snapshotId.trim() : ''
    if (!snapshotId) return [errorResponse(id, 'invalid_request', 'snapshotId is required')]
    const artifact = await state.reviewArtifactStore.read(snapshotId)
    if (!artifact.admission.workspace) return [errorResponse(id, 'invalid_request', 'Review snapshot has no canonical workspace binding')]
    const reviewFeedbackBundle = await state.reviewStateStore.prepareFeedback({ snapshotId, threadId: artifact.threadId, workspace: artifact.admission.workspace })
    return [{ id, result: { reviewFeedbackBundle } }]
  }
  if (method === 'review/v1/feedback/claim') { const claim = await state.reviewStateStore.claimFeedback(String(params.id || ''), String(params.runId || '')); return [{ id, result: { reviewFeedbackBundle: claim.bundle, reviewFeedbackClaimed: claim.claimed } }] }
  await state.reviewStateStore.releaseFeedback(String(params.id || ''), String(params.runId || ''))
  return [{ id, result: {} }]
}

async function handleReviewStateRequest(state: HostState, method: ReviewStateRequestMethod, params: Record<string, unknown>, id: string | number): Promise<PiHostMessage[]> {
  const snapshotId = typeof params.snapshotId === 'string' ? params.snapshotId.trim() : ''
  if (method === 'review/v1/draft/save') return saveReviewDraftRequest(state, params, id)
  if (method.startsWith('review/v1/feedback/')) return handleReviewFeedbackRequest(state, method as Extract<ReviewStateRequestMethod, `review/v1/feedback/${string}`>, params, id)
  if (method === 'review/v1/state/inherit') return inheritReviewStateRequest(state, params, id)
  if (method === 'review/v1/draft/delete') { await state.reviewStateStore.deleteDraft(String(params.id || '')); return [{ id, result: {} }] }
  if (method === 'review/v1/comment/transition') return [{ id, result: { reviewComment: await state.reviewStateStore.transitionComment(String(params.id || ''), params.status as never) } }]
  if (!snapshotId && method !== 'review/v1/file-state/mark') return [errorResponse(id, 'invalid_request', 'snapshotId is required')]
  if (method === 'review/v1/comments/list') return [{ id, result: { reviewComments: await state.reviewStateStore.listComments(snapshotId) } }]
  if (method === 'review/v1/file-state/list') return [{ id, result: { reviewFileStates: await state.reviewStateStore.listFileStates(snapshotId) } }]
  return [{ id, result: { reviewFileState: await state.reviewStateStore.markReviewed(params as never) } }]
}

function reviewVerificationScript(projectRoot: string, kind: ReviewVerificationKind): { command: string; args: string[]; cwd: string } | undefined {
  const roots = [projectRoot, resolve(projectRoot, 'app')]
  for (const cwd of roots) {
    const packagePath = resolve(cwd, 'package.json')
    if (!existsSync(packagePath)) continue
    try {
      const parsed = JSON.parse(readFileSync(packagePath, 'utf8')) as { scripts?: Record<string, unknown> }
      if (typeof parsed.scripts?.[kind] !== 'string') continue
      return { command: 'npm', args: ['run', kind], cwd }
    } catch { /* malformed package metadata is reported as not-run below */ }
  }
  return undefined
}

function executeReviewVerification(command: string, args: string[], cwd: string): Promise<{ exitCode: number; signal?: string; output: string; durationMs: number }> {
  const started = Date.now()
  return new Promise((resolveExecution) => {
    execFile(command, args, { cwd, encoding: 'utf8', maxBuffer: 1024 * 1024, timeout: 10 * 60 * 1000 }, (error, stdout, stderr) => {
      const failure = error as NodeJS.ErrnoException & { code?: number | string; signal?: string } | null
      resolveExecution({
        exitCode: failure ? (typeof failure.code === 'number' ? failure.code : 1) : 0,
        ...(failure?.signal ? { signal: String(failure.signal) } : {}),
        output: `${stdout || ''}${stderr || ''}`,
        durationMs: Date.now() - started,
      })
    })
  })
}

async function currentReviewRevision(state: HostState, snapshotId: string): Promise<{ artifact: Awaited<ReturnType<ReviewArtifactStore['read']>>; revision?: string }> {
  const artifact = await state.reviewArtifactStore.read(snapshotId)
  const expected = artifact.settlement?.workingRevision || artifact.admission.baseline?.workingRevision
  const projectRoot = artifact.admission.workspace?.projectRoot
  if (!projectRoot) return { artifact, revision: expected }
  try {
    const admission = await captureReviewWorkspaceAdmission({ runId: `verification:${snapshotId}`, projectRoot, runnerKind: 'builtin' })
    return { artifact, revision: admission.canonical ? admission.baseline?.workingRevision : undefined }
  } catch { return { artifact, revision: undefined } }
}

async function readReviewVerificationOutput(
  state: HostState,
  params: Record<string, unknown>,
  id: string | number,
): Promise<PiHostMessage[]> {
  const outputRef = typeof params.outputRef === 'string' ? params.outputRef : ''
  if (!outputRef) return [errorResponse(id, 'invalid_request', 'outputRef is required')]
  const page = await state.reviewVerificationStore.readOutput({
    outputRef,
    offset: Number(params.offset) || 0,
    maxBytes: Number(params.maxBytes) || undefined,
  })
  return [{ id, result: { reviewVerificationOutput: {
    outputRef: page.outputRef,
    contentBase64: Buffer.from(page.content).toString('base64'),
    offset: page.offset,
    bytes: page.bytes,
    ...(page.nextOffset === undefined ? {} : { nextOffset: page.nextOffset }),
  } } }]
}

function verificationKind(value: unknown): ReviewVerificationKind | undefined {
  return value === 'build' || value === 'smoke' || value === 'test' ? value : undefined
}

async function runReviewVerification(
  state: HostState,
  snapshotId: string,
  params: Record<string, unknown>,
  id: string | number,
): Promise<PiHostMessage[]> {
  const kind = verificationKind(params.kind)
  if (!kind) return [errorResponse(id, 'invalid_request', 'verification kind is required')]
  const current = await currentReviewRevision(state, snapshotId)
  const expectedRevision = current.artifact.settlement?.workingRevision || current.artifact.admission.baseline?.workingRevision || ''
  const workspace = current.artifact.admission.workspace
  if (!workspace || !expectedRevision) return [errorResponse(id, 'unavailable', 'Snapshot workspace revision is unavailable')]
  const script = reviewVerificationScript(workspace.projectRoot, kind)
  const startedAt = new Date().toISOString()
  if (!script || current.revision !== expectedRevision) {
    const record = await state.reviewVerificationStore.record({
      snapshotId, runId: current.artifact.runId, workspaceId: workspace.workspaceId, verifiedRevision: expectedRevision,
      kind, command: script?.command || 'npm', args: script?.args || ['run', kind], cwd: script?.cwd || workspace.projectRoot,
      runner: 'host', startedAt, durationMs: 0,
      detail: script ? 'Workspace revision changed before verification; refresh the review snapshot.' : `No ${kind} script was found for this workspace.`,
    })
    return [{ id, result: { reviewVerification: projectReviewVerification(record, current.revision) } }]
  }
  const execution = await executeReviewVerification(script.command, script.args, script.cwd)
  const record = await state.reviewVerificationStore.record({
    snapshotId, runId: current.artifact.runId, workspaceId: workspace.workspaceId, verifiedRevision: expectedRevision,
    kind, command: script.command, args: script.args, cwd: script.cwd, runner: 'host', startedAt,
    durationMs: execution.durationMs, exitCode: execution.exitCode, signal: execution.signal, output: execution.output,
  })
  const after = await currentReviewRevision(state, snapshotId)
  return [{ id, result: { reviewVerification: projectReviewVerification(record, after.revision) } }]
}

async function handleReviewVerificationRequest(
  state: HostState,
  method: 'review/v1/verification/list' | 'review/v1/verification/run' | 'review/v1/verification/output',
  params: Record<string, unknown>,
  id: string | number,
): Promise<PiHostMessage[]> {
  if (method === 'review/v1/verification/output') return readReviewVerificationOutput(state, params, id)
  const snapshotId = typeof params.snapshotId === 'string' ? params.snapshotId : ''
  if (!snapshotId) return [errorResponse(id, 'invalid_request', 'snapshotId is required')]
  if (method === 'review/v1/verification/list') {
    const current = await currentReviewRevision(state, snapshotId)
    const records = await state.reviewVerificationStore.list(snapshotId)
    return [{ id, result: { reviewVerifications: records.map((record) => projectReviewVerification(record, current.revision)) } }]
  }
  return runReviewVerification(state, snapshotId, params, id)
}

async function handleReviewMutationRequest(
  state: HostState,
  method: 'review/v1/mutation/preview' | 'review/v1/mutation/apply',
  params: Record<string, unknown>,
  id: string | number,
): Promise<PiHostMessage[]> {
  if (method === 'review/v1/mutation/preview') {
    const reviewMutationPreview = await state.reviewMutationCoordinator.preview(params.intent as ReviewMutationIntent)
    return [{ id, result: { reviewMutationPreview } }]
  }
  const previewId = typeof params.previewId === 'string' ? params.previewId : ''
  if (!previewId) return [errorResponse(id, 'invalid_request', 'previewId is required')]
  const preview = state.reviewMutationCoordinator.describePreview(previewId)
  const approvalRunId = `review-mutation:${preview.id}`
  const resolution = await requestPiToolApproval({
    runId: approvalRunId,
    sessionId: approvalRunId,
    tool: 'review_mutation',
    callId: preview.id,
    args: {
      operation: preview.operation,
      selection: preview.selection,
      patchHash: preview.patchHash,
      patchBytes: preview.patchBytes,
      patch: preview.patch,
      expectedRevision: preview.expectedRevision,
    },
    reason: `Approve ${preview.operation} for ${preview.selection.path}`,
  })
  const approval: ReviewMutationApproval = {
    decision: resolution.decision === 'allow' ? 'allow' : resolution.decision === 'deny' ? 'deny' : 'cancel',
    source: 'electron-main',
    decidedAt: new Date().toISOString(),
  }
  const reviewMutationReceipt = await state.reviewMutationCoordinator.apply(previewId, approval)
  return [{ id, result: { reviewMutationReceipt } }]
}

async function handleReviewDeliveryRequest(
  state: HostState,
  method: 'review/v1/delivery/preview' | 'review/v1/delivery/apply',
  params: Record<string, unknown>,
  id: string | number,
): Promise<PiHostMessage[]> {
  if (method === 'review/v1/delivery/preview') {
    const reviewDeliveryPreview = await state.reviewDeliveryCoordinator.preview(params.intent as ReviewDeliveryIntent)
    return [{ id, result: { reviewDeliveryPreview } }]
  }
  const previewId = typeof params.previewId === 'string' ? params.previewId : ''
  if (!previewId) return [errorResponse(id, 'invalid_request', 'previewId is required')]
  const preview = state.reviewDeliveryCoordinator.describePreview(previewId)
  const approvalRunId = `review-delivery:${preview.id}`
  const resolution = await requestPiToolApproval({
    runId: approvalRunId,
    sessionId: approvalRunId,
    tool: `review_delivery_${preview.kind}`,
    callId: preview.id,
    args: { title: preview.title, detail: preview.detail, workspaceId: preview.workspaceId },
    reason: `Approve review delivery ${preview.kind}`,
  })
  const approval: ReviewDeliveryApproval = {
    decision: resolution.decision === 'allow' ? 'allow' : resolution.decision === 'deny' ? 'deny' : 'cancel',
    source: 'electron-main',
    decidedAt: new Date().toISOString(),
  }
  const reviewDeliveryReceipt = await state.reviewDeliveryCoordinator.apply(previewId, approval)
  return [{ id, result: { reviewDeliveryReceipt } }]
}

async function approveReviewLifecycle(input: { action: string; identity: string; detail: Record<string, unknown> }): Promise<boolean> {
  const callId = `review-lifecycle:${input.action}:${input.identity}`
  const resolution = await requestPiToolApproval({
    runId: callId,
    sessionId: callId,
    tool: `review_artifact_${input.action}`,
    callId,
    args: input.detail,
    reason: `Approve Review artifact ${input.action}: ${input.identity}`,
  })
  return resolution.decision === 'allow'
}

function lifecycleSnapshotId(params: Record<string, unknown>): string {
  return typeof params.snapshotId === 'string' ? params.snapshotId : ''
}

async function exportReviewArtifactLifecycle(state: HostState, params: Record<string, unknown>, id: string | number): Promise<PiHostMessage[]> {
  const snapshotId = lifecycleSnapshotId(params)
  return snapshotId ? [{ id, result: { reviewArtifactExport: await exportReviewArtifact(state.reviewArtifactStore, state.reviewStateStore, snapshotId) } }] : [errorResponse(id, 'invalid_request', 'snapshotId is required')]
}

async function previewReviewArtifactLifecycle(state: HostState, bundle: unknown, id: string | number): Promise<PiHostMessage[]> {
  const preview = await previewReviewArtifactImport(state.reviewArtifactStore, bundle)
  if (preview.status === 'ready' && preview.bundleHash) state.reviewImportPreviews.add(preview.bundleHash)
  return [{ id, result: { reviewArtifactImportPreview: preview } }]
}

async function importReviewArtifactLifecycle(state: HostState, params: Record<string, unknown>, id: string | number): Promise<PiHostMessage[]> {
  const expectedBundleHash = typeof params.expectedBundleHash === 'string' ? params.expectedBundleHash : ''
  if (!expectedBundleHash || !state.reviewImportPreviews.has(expectedBundleHash)) return [errorResponse(id, 'conflict', 'Review import requires an unconsumed Host preview')]
  state.reviewImportPreviews.delete(expectedBundleHash)
  if (!await approveReviewLifecycle({ action: 'import', identity: expectedBundleHash, detail: { bundleHash: expectedBundleHash } })) return [errorResponse(id, 'forbidden', 'Review import was denied')]
  const reviewArtifact = await importReviewArtifact(state.reviewArtifactStore, state.reviewStateStore, params.bundle, expectedBundleHash)
  const workspace = reviewArtifact.admission.workspace
  if (workspace) state.reviewWorkspaces.set(workspace.workspaceId, workspace)
  return [{ id, result: { reviewArtifact } }]
}

async function rebindReviewArtifactLifecycle(state: HostState, params: Record<string, unknown>, id: string | number): Promise<PiHostMessage[]> {
  const snapshotId = lifecycleSnapshotId(params)
  const projectRoot = typeof params.projectRoot === 'string' ? params.projectRoot : ''
  if (!snapshotId || !projectRoot) return [errorResponse(id, 'invalid_request', 'snapshotId and projectRoot are required')]
  const current = await state.reviewArtifactStore.read(snapshotId)
  const originalWorkspace = current.admission.workspace
  if (!originalWorkspace) return [errorResponse(id, 'invalid_target', 'Review artifact has no workspace identity to rebind')]
  const rebound = await captureReviewWorkspaceAdmission({ runId: `review-rebind:${snapshotId}`, projectRoot, runnerKind: current.admission.runnerKind })
  if (!rebound.canonical || !rebound.workspace) return [errorResponse(id, 'invalid_target', rebound.error?.message || 'Rebind target is not a canonical workspace')]
  state.reviewWorkspaces.set(originalWorkspace.workspaceId, { ...rebound.workspace, workspaceId: originalWorkspace.workspaceId })
  return [{ id, result: { reviewArtifact: await state.reviewArtifactStore.rebindWorkspace(snapshotId, projectRoot) } }]
}

async function retainReviewArtifactLifecycle(state: HostState, params: Record<string, unknown>, id: string | number): Promise<PiHostMessage[]> {
  const requested = Array.isArray(params.retainedSnapshotIds) ? params.retainedSnapshotIds.filter((value): value is string => typeof value === 'string') : []
  const retainedSnapshotIds = [...new Set([...requested, ...await state.reviewStateStore.referencedSnapshotIds()])]
  const retainedThreadIds = [...new Set(state.snapshot.sessions.flatMap((session) => [session.id, session.threadId].filter((value): value is string => Boolean(value))))]
  const reason = typeof params.reason === 'string' && params.reason.trim() ? params.reason.trim() : 'Review retention policy'
  if (!await approveReviewLifecycle({ action: 'retention', identity: `${retainedSnapshotIds.length}-refs`, detail: { retainedSnapshotIds, retainedThreadIds, reason } })) return [errorResponse(id, 'forbidden', 'Review retention was denied')]
  const reviewArtifactRetention = await applyReviewArtifactRetention(state.reviewArtifactStore, { retainedSnapshotIds, retainedThreadIds, reason, ...(typeof params.olderThan === 'string' ? { olderThan: params.olderThan } : {}) })
  return [{ id, result: { reviewArtifactRetention } }]
}

async function hardDeleteReviewArtifactLifecycle(state: HostState, params: Record<string, unknown>, id: string | number): Promise<PiHostMessage[]> {
  const snapshotId = lifecycleSnapshotId(params)
  if (!snapshotId) return [errorResponse(id, 'invalid_request', 'snapshotId is required')]
  const artifact = await state.reviewArtifactStore.read(snapshotId)
  if (!await approveReviewLifecycle({ action: 'hard-delete', identity: snapshotId, detail: { snapshotId, status: artifact.status, manifestHash: artifact.manifestHash } })) return [errorResponse(id, 'forbidden', 'Review hard delete was denied')]
  await hardDeleteReviewArtifact(state.reviewArtifactStore, state.reviewStateStore, state.reviewVerificationStore, snapshotId, 'Explicit Review hard delete')
  return [{ id, result: { reviewArtifactHardDeleted: true } }]
}

async function handleReviewArtifactLifecycleRequest(state: HostState, method: Extract<PiHostRequest['method'], `review/v1/artifact/${string}`>, params: Record<string, unknown>, id: string | number): Promise<PiHostMessage[]> {
  if (method === 'review/v1/artifact/export') return exportReviewArtifactLifecycle(state, params, id)
  if (method === 'review/v1/artifact/import-preview') return previewReviewArtifactLifecycle(state, params.bundle, id)
  if (method === 'review/v1/artifact/import-apply') return importReviewArtifactLifecycle(state, params, id)
  if (method === 'review/v1/artifact/rebind') return rebindReviewArtifactLifecycle(state, params, id)
  if (method === 'review/v1/artifact/retention') return retainReviewArtifactLifecycle(state, params, id)
  return hardDeleteReviewArtifactLifecycle(state, params, id)
}

async function handleReviewRequest(
  state: HostState,
  input: Partial<PiHostRequest>,
  id: string | number,
): Promise<PiHostMessage[] | undefined> {
  if (!isReviewRequestMethod(input.method)) return undefined
  if (!state.reviewNegotiated) {
    return [errorResponse(id, 'protocol_mismatch', 'Run Review requires current protocol and review-v1 negotiation')]
  }
  const params = input.params || {}
  if (input.method.startsWith('review/v1/artifact/')) return handleReviewArtifactLifecycleRequest(state, input.method as Extract<PiHostRequest['method'], `review/v1/artifact/${string}`>, params, id)
  if (input.method === 'review/v1/read') return readReviewArtifactRequest(state, params, id)
  if (input.method === 'review/v1/payload-page') return readReviewPayloadPageRequest(state, params, id)
  if (input.method === 'review/v1/finalize') return finalizeReviewRequest(state, params, id)
  if (input.method === 'review/v1/verification/list' || input.method === 'review/v1/verification/run' || input.method === 'review/v1/verification/output') {
    return handleReviewVerificationRequest(state, input.method, params, id)
  }
  if (input.method === 'review/v1/mutation/preview' || input.method === 'review/v1/mutation/apply') {
    return handleReviewMutationRequest(state, input.method, params, id)
  }
  if (input.method === 'review/v1/delivery/preview' || input.method === 'review/v1/delivery/apply') {
    return handleReviewDeliveryRequest(state, input.method, params, id)
  }
  if (isReviewStateMethod(input.method)) return handleReviewStateRequest(state, input.method, params, id)
  if (isReviewTargetMethod(input.method)) return handleReviewTargetRequest(state, input.method, params, id)
  return admitReviewRequest(state, params, id)
}

async function migrateLegacyInstructionRequest(state: HostState, id: string | number, params: Record<string, unknown>, emit?: (message: PiHostMessage) => void): Promise<PiHostMessage[]> {
  const migrated = await state.instructionRepository.migrateLegacy(params)
  if (migrated.report.status === 'migrated') {
    state.snapshot.cursor += 1
    emit?.({ event: 'instruction/changed', payload: {
      version: 1,
      revision: state.snapshot.cursor,
      operation: 'migration',
      source: { identity: 'global:instruction-state', hash: migrated.instructions.hash, bytes: Buffer.byteLength(migrated.instructions.globalCustomInstructions, 'utf8') },
    } })
  }
  return [{ id, result: { instructions: migrated.instructions, instructionMigrationReport: migrated.report } }]
}

async function authorizeInstructionIncludeRequest(state: HostState, id: string | number, params: Record<string, unknown>, emit?: (message: PiHostMessage) => void): Promise<PiHostMessage[]> {
  const requested = typeof params.target === 'string' ? params.target : ''
  if (!isAbsolute(requested) || !existsSync(requested)) throw new Error('include authorization requires an existing absolute target')
  const target = realpathSync.native(requested)
  const authorizedIncludeTargets = await state.instructionRepository.authorizeIncludeTarget(target)
  state.snapshot.cursor += 1
  emit?.({ event: 'instruction/changed', payload: { version: 1, revision: state.snapshot.cursor, operation: 'include-authorization' } })
  return [{ id, result: { authorizedIncludeTargets } }]
}

async function saveInstructionRequest(state: HostState, id: string | number, params: Record<string, unknown>, emit?: (message: PiHostMessage) => void): Promise<PiHostMessage[]> {
  const saved = await state.instructionRepository.save({
    expectedRevision: Number(params.expectedRevision),
    globalCustomInstructions: typeof params.globalCustomInstructions === 'string' ? params.globalCustomInstructions : '',
    advancedPersonalityInstructions: typeof params.advancedPersonalityInstructions === 'string' ? params.advancedPersonalityInstructions : '',
    ...(typeof params.personality === 'string' ? { personality: params.personality } : {}),
    ...(typeof params.aboutUser === 'string' ? { aboutUser: params.aboutUser } : {}),
    ...(typeof params.responseStyle === 'string' ? { responseStyle: params.responseStyle } : {}),
    ...(['unset', 'blank', 'value'].includes(String(params.globalCustomInstructionsPresence)) ? { globalCustomInstructionsPresence: params.globalCustomInstructionsPresence as 'unset' | 'blank' | 'value' } : {}),
    ...(['unset', 'blank', 'value'].includes(String(params.advancedPersonalityInstructionsPresence)) ? { advancedPersonalityInstructionsPresence: params.advancedPersonalityInstructionsPresence as 'unset' | 'blank' | 'value' } : {}),
  })
  return publishInstructionMutation(state, id, saved, 'save', emit)
}

function observeInstructionProjection(
  state: HostState,
  snapshot: InstructionSnapshot,
  emit?: (message: PiHostMessage) => void,
): InstructionSnapshot {
  const key = `${snapshot.projectIdentity || 'global'}\u0000${snapshot.workPath || ''}`
  const signature = createHash('sha256').update(JSON.stringify({
    effectiveHash: snapshot.effectiveHash,
    globalEffectiveText: snapshot.globalEffectiveText,
    usage: snapshot.usage,
    sources: snapshot.sources.map(({ revision: _revision, ...source }) => source),
    diagnostics: snapshot.diagnostics,
  })).digest('hex')
  const previous = state.instructionProjections.get(key)
  if (previous?.signature !== signature) {
    state.snapshot.cursor += 1
    const event: PiHostEvent = { event: 'instruction/changed', payload: {
      version: 1,
      revision: state.snapshot.cursor,
      operation: 'filesystem-observed',
      ...(snapshot.projectIdentity ? { projectIdentity: snapshot.projectIdentity } : {}),
      ...(snapshot.workPath ? { workPath: snapshot.workPath } : {}),
      effectiveHash: snapshot.effectiveHash,
      // Provenance metadata is enough for a renderer to decide whether it is
      // looking at the right projection. Bodies stay in the after-cursor
      // snapshot and never travel on an invalidation event.
      sources: snapshot.sources.map((source) => ({
        id: source.id,
        scope: source.scope,
        ...(source.path ? { path: source.path } : {}),
        ...(source.parentPath ? { parentPath: source.parentPath } : {}),
        hash: source.hash,
        bytes: source.bytes,
        applied: source.applied,
        metadataStatus: source.metadataStatus,
      })),
    } }
    emit?.(event)
  }
  const sourceRevisions = new Map<string, { signature: string; revision: number }>()
  const sources = snapshot.sources.map((source) => {
    const sourceKey = `${source.scope}:${source.path || source.id}:${source.parentPath || ''}`
    const sourceSignature = createHash('sha256').update(JSON.stringify({ ...source, revision: undefined })).digest('hex')
    const observed = previous?.sourceRevisions.get(sourceKey)
    const revision = observed?.signature === sourceSignature ? observed.revision : state.snapshot.cursor
    sourceRevisions.set(sourceKey, { signature: sourceSignature, revision })
    return Object.freeze({ ...source, revision })
  })
  state.instructionProjections.set(key, { signature, sourceRevisions })
  return Object.freeze({
    ...snapshot,
    revision: state.snapshot.cursor,
    sources: Object.freeze(sources),
  })
}

async function resolveInstructionRequest(state: HostState, id: string | number, params: Record<string, unknown>, emit?: (message: PiHostMessage) => void): Promise<PiHostMessage[]> {
  const current = await state.instructionRepository.read()
  const strings = (value: unknown) => Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : undefined
  const instructionSnapshot = await resolveInstructionSnapshot({
    globalRevision: current.revision,
    globalCustomInstructions: current.globalCustomInstructions,
    advancedPersonalityInstructions: current.advancedPersonalityInstructions,
    globalCustomInstructionsPresence: current.globalCustomInstructionsPresence,
    advancedPersonalityInstructionsPresence: current.advancedPersonalityInstructionsPresence,
    personality: current.personality,
    aboutUser: current.aboutUser,
    responseStyle: current.responseStyle,
    projectRoot: typeof params.projectRoot === 'string' ? params.projectRoot : undefined,
    workPath: typeof params.workPath === 'string' ? params.workPath : undefined,
    fallbackFilenames: strings(params.fallbackFilenames),
    authorizedIncludeTargets: await state.instructionRepository.listAuthorizedIncludeTargets(),
  })
  return [{ id, result: { instructionSnapshot: observeInstructionProjection(state, instructionSnapshot, emit) } }]
}

async function writeInstructionRequest(state: HostState, id: string | number, params: Record<string, unknown>, emit?: (message: PiHostMessage) => void): Promise<PiHostMessage[]> {
  if (typeof params.expectedHash !== 'string') throw new Error('expectedHash is required for project instruction CAS')
  // Validate repository health before committing the independent filesystem
  // authority. After rename succeeds, acknowledgement/event publication has
  // no fallible repository operation left.
  const current = await state.instructionRepository.read()
  const written = await writeProjectInstruction({ projectRoot: String(params.projectRoot || ''), target: String(params.target || ''), expectedHash: params.expectedHash, content: typeof params.content === 'string' ? params.content : '' })
  return publishInstructionMutation(state, id, current, 'project-write', emit, written)
}

async function readInstructionRequest(state: HostState, id: string | number, params: Record<string, unknown>): Promise<PiHostMessage[]> {
  const projectRoot = typeof params.projectRoot === 'string' ? params.projectRoot : ''
  const workPath = typeof params.workPath === 'string' ? params.workPath : projectRoot
  const target = typeof params.target === 'string' ? params.target : ''
  const current = await state.instructionRepository.read()
  const snapshot = await resolveInstructionSnapshot({
    globalRevision: current.revision,
    globalCustomInstructions: current.globalCustomInstructions,
    advancedPersonalityInstructions: current.advancedPersonalityInstructions,
    globalCustomInstructionsPresence: current.globalCustomInstructionsPresence,
    advancedPersonalityInstructionsPresence: current.advancedPersonalityInstructionsPresence,
    personality: current.personality,
    aboutUser: current.aboutUser,
    responseStyle: current.responseStyle,
    projectRoot,
    workPath,
    authorizedIncludeTargets: await state.instructionRepository.listAuthorizedIncludeTargets(),
  })
  const canonicalRoot = snapshot.projectIdentity
  if (!canonicalRoot) throw new ProjectInstructionWriteError('project_missing', '目前 canonical project root 不存在。')
  const canonicalTarget = resolve(canonicalRoot, target)
  const source = snapshot.sources.find((candidate) => candidate.scope === 'project' && candidate.path === canonicalTarget)
  if (!source || !source.openable || source.metadataStatus !== 'content') {
    throw new ProjectInstructionWriteError('invalid_target', '目前 Host projection 不允許讀取這個 project source。')
  }
  const read = await readProjectInstruction({ projectRoot: canonicalRoot, target })
  return [{ id, result: { projectInstructionRead: read } }]
}

async function applyInstructionImportRequest(state: HostState, id: string | number, params: Record<string, unknown>, emit?: (message: PiHostMessage) => void): Promise<PiHostMessage[]> {
  const preview = await state.instructionRepository.previewImport(params.bundle)
  const imported = await state.instructionRepository.applyImport(preview, Number(params.expectedRevision))
  if (preview.status === 'unchanged') return [{ id, result: { instructions: imported } }]
  return publishInstructionMutation(state, id, imported, 'import', emit)
}

function publishInstructionMutation(
  state: HostState,
  id: string | number,
  instructions: PersonalizationInstructionSnapshot,
  operation: 'save' | 'import' | 'project-write',
  emit?: (message: PiHostMessage) => void,
  projectInstructionWrite?: { path: string; hash: string; bytes: number },
): PiHostMessage[] {
  state.snapshot.cursor += 1
  const event: PiHostEvent = { event: 'instruction/changed', payload: {
    version: 1,
    revision: state.snapshot.cursor,
    operation,
    ...(projectInstructionWrite
      ? {
          projectIdentity: dirname(projectInstructionWrite.path),
          source: {
            identity: projectInstructionWrite.path,
            path: projectInstructionWrite.path,
            hash: projectInstructionWrite.hash,
            bytes: projectInstructionWrite.bytes,
          },
        }
      : {
          source: {
            identity: 'global:instruction-state',
            hash: instructions.hash,
            bytes: Buffer.byteLength(instructions.globalCustomInstructions, 'utf8'),
          },
        }),
  } }
  if (emit) emit(event)
  return [...(emit ? [] : [event]), { id, result: { instructions, ...(projectInstructionWrite ? { projectInstructionWrite } : {}) } }]
}

type ReviewRequestMethod = Extract<PiHostRequest['method'], `review/${string}`>

const REVIEW_REQUEST_METHODS = new Set<ReviewRequestMethod>([
  'review/v1/admit', 'review/v1/finalize', 'review/v1/read', 'review/v1/payload-page',
  'review/v1/describe', 'review/v1/files', 'review/v1/file-diff', 'review/v1/refresh',
  'review/v1/comments/list', 'review/v1/draft/save', 'review/v1/draft/delete',
  'review/v1/comment/transition', 'review/v1/file-state/list', 'review/v1/file-state/mark',
  'review/v1/state/inherit', 'review/v1/feedback/prepare', 'review/v1/feedback/claim',
  'review/v1/feedback/release', 'review/v1/verification/list', 'review/v1/verification/run',
  'review/v1/verification/output', 'review/v1/mutation/preview', 'review/v1/mutation/apply',
  'review/v1/delivery/preview', 'review/v1/delivery/apply',
  'review/v1/artifact/export', 'review/v1/artifact/import-preview', 'review/v1/artifact/import-apply',
  'review/v1/artifact/rebind', 'review/v1/artifact/retention', 'review/v1/artifact/hard-delete',
])

function isReviewRequestMethod(method: unknown): method is ReviewRequestMethod {
  return typeof method === 'string' && REVIEW_REQUEST_METHODS.has(method as ReviewRequestMethod)
}

function handleInstructionOrReviewRequest(
  state: HostState,
  input: Partial<InternalPiHostRequest>,
  id: string | number,
  emit?: (message: PiHostMessage) => void,
): Promise<PiHostMessage[]> | undefined {
  if (input.method?.startsWith('instructions/v1/')) return handleInstructionRequest(state, input as Partial<PiHostRequest>, id, emit) as Promise<PiHostMessage[]>
  if (isReviewRequestMethod(input.method)) return handleReviewRequest(state, input as Partial<PiHostRequest>, id) as Promise<PiHostMessage[]>
  return undefined
}

type PiHostToolExecutionInput = {
  state: HostState
  input: Partial<InternalPiHostRequest>
  id: string | number
  invocationOrigin: 'direct-protocol' | 'code-mode'
  emit?: (message: PiHostMessage) => void
}

function executePiHostToolRequest(
  state: HostState,
  input: Partial<InternalPiHostRequest>,
  id: string | number,
  invocationOrigin: 'direct-protocol' | 'code-mode',
  emit?: (message: PiHostMessage) => void,
): PiHostMessage[] | Promise<PiHostMessage[]> {
  const execution = { state, input, id, invocationOrigin, emit }
  if (input.method === 'tools/pack') return executePiHostPackRequest(execution)
  if (input.method === 'tools/mcp') return executePiHostMcpRequest(execution)
  if (input.method === 'tools/code') return executePiHostCodeRequest(execution)
  if (['tools/read', 'tools/grep', 'tools/find', 'tools/ls', 'tools/write', 'tools/edit', 'tools/bash'].includes(input.method || '')) {
    return executePiHostBuiltinRequest(execution)
  }
  return [errorResponse(id, 'unknown_method', `Unknown Pi Host tool method: ${input.method}`)]
}

function executePiHostPackRequest(execution: PiHostToolExecutionInput): PiHostMessage[] | Promise<PiHostMessage[]> {
  const { state, input, id, invocationOrigin, emit } = execution
  const params = input.params || {}
  const name = typeof params.name === 'string' ? params.name : ''
  const definition = findPiPackTool(name)
  if (!definition) return [errorResponse(id, 'invalid_request', `Unknown Pi extension tool: ${name}`)]
  const workspaceError = piHostPackWorkspaceError(state, name, params, id)
  if (workspaceError) return workspaceError
  const coordinates = piHostPackCoordinates(params, id)
  const validation = validatePiHostPackInvocation({ state, params, id, invocationOrigin, emit, name, definition, ...coordinates })
  if (!validation.ok) return validation.response
  const updates: PiHostEvent[] = []
  const publish = (event: PiHostEvent) => {
    recordToolAudit(state, params.sessionId, event)
    if (emit) emit(event); else updates.push(event)
  }
  return executeAuthorizedPiPackRequest({
    state, params, id, invocationOrigin, name, definition, ...coordinates, args: validation.args, updates, publish,
  })
}

type PiHostPackCoordinates = { sessionId: string; runId: string; callId: string; cwd: string }

function piHostPackCoordinates(params: Record<string, unknown>, id: string | number): PiHostPackCoordinates {
  const sessionId = typeof params.sessionId === 'string' ? params.sessionId : 'direct'
  const runId = typeof params.runId === 'string' ? params.runId : String(id)
  return {
    sessionId,
    runId,
    callId: typeof params.callId === 'string' ? params.callId : runId,
    cwd: typeof params.cwd === 'string' ? params.cwd : process.cwd(),
  }
}

function piHostPackWorkspaceError(
  state: HostState,
  name: string,
  params: Record<string, unknown>,
  id: string | number,
): PiHostMessage[] | undefined {
  if (!isWorkspaceTextSearchTool(name)) return undefined
  const workspaceRoot = typeof params.cwd === 'string' && params.cwd.trim() ? params.cwd : undefined
  if (!workspaceRoot) return [errorResponse(id, 'invalid_request', '工作區文字檢索需要明確的 workspace cwd；不允許使用 process.cwd() fallback。')]
  const gate = workspaceTextSearchAvailability({
    sessionId: typeof params.sessionId === 'string' ? params.sessionId : undefined,
    enabled: state.snapshot.settings.workspaceTextSearch === true,
    workspaceRoot,
  })
  return gate.available ? undefined : [errorResponse(id, 'invalid_request', gate.reason || 'Workspace text search is unavailable')]
}

function piHostPackArguments(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

function validatePiHostPackInvocation(input: {
  state: HostState
  params: Record<string, unknown>
  id: string | number
  invocationOrigin: 'direct-protocol' | 'code-mode'
  emit?: (message: PiHostMessage) => void
  name: string
  definition: NonNullable<ReturnType<typeof findPiPackTool>>
} & PiHostPackCoordinates): { ok: true; args: Record<string, unknown> } | { ok: false; response: PiHostMessage[] } {
  const { state, params, id, invocationOrigin, emit, name, definition, sessionId, runId, callId, cwd } = input
  const hasCurrentContract = typeof params.sessionId === 'string' && Boolean(state.toolContracts.latest(params.sessionId))
  const envelope = {
    cwd,
    ...(typeof params.sessionId === 'string' ? { sessionId: params.sessionId } : {}),
    runId,
    callId,
    ...(typeof params.contractRevision === 'number' ? { contractRevision: params.contractRevision } : {}),
    ...(typeof params.schemaDigest === 'string' ? { schemaDigest: params.schemaDigest } : {}),
  }
  const rawArgs = piHostPackArguments(params.arguments)
  const validation = hasCurrentContract || params.contractRevision !== undefined || params.schemaDigest !== undefined
    ? validateDirectToolCall(state, name, envelope, rawArgs)
    : validatePiToolArguments(definition.tool.parameters, rawArgs)
  if (validation.ok) return { ok: true, args: validation.arguments }
  const reason = `${name} parameters are invalid: ${validation.message}`
  return { ok: false, response: contractValidationFailure({
    state,
    sessionId: typeof params.sessionId === 'string' ? sessionId : undefined,
    runId,
    callId,
    parentRunId: typeof params.parentRunId === 'string' ? params.parentRunId : undefined,
    tool: name,
    origin: invocationOrigin,
    reason,
    id,
    emit,
  }) }
}

type AuthorizedPiPackInput = {
  state: HostState
  params: Record<string, unknown>
  id: string | number
  invocationOrigin: 'direct-protocol' | 'code-mode'
  name: string
  definition: NonNullable<ReturnType<typeof findPiPackTool>>
  sessionId: string
  runId: string
  callId: string
  cwd: string
  args: Record<string, unknown>
  updates: PiHostEvent[]
  publish: (event: PiHostEvent) => void
}

async function executeAuthorizedPiPackRequest(input: AuthorizedPiPackInput): Promise<PiHostMessage[]> {
  const { state, params, id, invocationOrigin, name, sessionId, runId, callId, cwd, args, publish } = input
  const policy = piPackAuthorizationPolicy(input)
  const authorized = await authorizeContractInvocation({
    state, sessionId, runId, callId, parentRunId: policy.parentRunId, cwd, tool: name, args,
    origin: invocationOrigin,
    approval: params.approval,
    requirements: policy.requirements,
    identity: policy.identity,
  })
  if ('contractError' in authorized) return [errorResponse(id, 'invalid_request', authorized.contractError)]
  const authorization: InvocationAuthorization = authorized
  const identityPayload = authorization.identity ? { ...authorization.identity, invocationOrigin } : {}
  publish({ event: 'host/tool-start', payload: { runId, tool: name, callId, parentRunId: policy.parentRunId, ...identityPayload } })
  if (!authorization.ok) return piPackAuthorizationFailure(input, authorization, identityPayload, policy.parentRunId)
  publish({ event: 'host/tool-decision', payload: {
    runId, tool: name, callId, parentRunId: policy.parentRunId, decision: 'allow', reason: authorization.reason, ...identityPayload,
  } })
  const outcome = await executePiPackTool(name, authorization.args, { sessionId, cwd, runId }, { callId })
  return settlePiPackExecution(input, authorization, outcome, identityPayload, policy.parentRunId)
}

function piPackAuthorizationPolicy(input: AuthorizedPiPackInput): {
  parentRunId?: string
  requirements: PiToolPolicyRequirements
  identity: PiInvocationContractIdentity
} {
  const { state, params, name, definition, sessionId, runId, args } = input
  const parentRunId = typeof params.parentRunId === 'string' ? params.parentRunId : undefined
  const foundIdentity = typeof params.sessionId === 'string' ? contractIdentityForCurrentTool(state, sessionId, name) : undefined
  const approvalPlan = definition.tool.approval?.(args, { sessionId, cwd: input.cwd, runId })
  const requirements: PiToolPolicyRequirements = {
    ...(definition.tool.policyMigration || {}),
    ...(approvalPlan?.need && !definition.tool.policyMigration?.capabilityApproval && !definition.tool.policyMigration?.approvalRequired
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
  return { parentRunId, requirements, identity: foundIdentity?.identity || detachedIdentity }
}

function piPackAuthorizationFailure(
  input: AuthorizedPiPackInput,
  authorization: InvocationAuthorization,
  identityPayload: Record<string, unknown>,
  parentRunId?: string,
): PiHostMessage[] {
  const { id, runId, name, callId, updates, publish } = input
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
  const reason = authorization.decision === 'ask' ? `Approval required: ${authorization.reason}` : authorization.reason
  return [...updates, errorResponse(id, 'invalid_request', reason)]
}

function settlePiPackExecution(
  input: AuthorizedPiPackInput,
  authorization: InvocationAuthorization,
  outcome: Awaited<ReturnType<typeof executePiPackTool>>,
  identityPayload: Record<string, unknown>,
  parentRunId?: string,
): PiHostMessage[] {
  const { id, runId, name, callId, updates, publish } = input
  const structuredFailure = Boolean(outcome.data && typeof outcome.data === 'object' && (outcome.data as { ok?: unknown }).ok === false)
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
}

function executePiHostMcpRequest(execution: PiHostToolExecutionInput): PiHostMessage[] | Promise<PiHostMessage[]> {
  const { state, input, id, emit } = execution
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

function executePiHostCodeRequest(execution: PiHostToolExecutionInput): PiHostMessage[] | Promise<PiHostMessage[]> {
  const { state, input, id, emit } = execution
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

function childWorkspaceToolFailure(
  state: HostState,
  sessionId: string | undefined,
  toolName: PiBuiltinToolName,
  cwd: string,
  args: Record<string, unknown>,
  id: string | number,
): PiHostMessage[] | undefined {
  if (!sessionId || (toolName !== 'write' && toolName !== 'edit' && toolName !== 'bash')) return undefined
  const session = state.snapshot.sessions.find((candidate) => candidate.id === sessionId)
  const workspace = session?.agentAdmission?.workspace
  if (!session || !workspace) return undefined
  if (toolName === 'bash' && workspace.mode !== 'isolated-worktree') {
    return [errorResponse(id, 'forbidden', 'Shared child workspace cannot prove Bash write scope; use an isolated worktree')]
  }
  const target = toolName === 'bash' ? cwd : typeof args.path === 'string' ? resolve(cwd, args.path) : ''
  const access = state.agentCommunication.assertWrite(session, target)
  return access.ok ? undefined : [errorResponse(id, 'forbidden', access.reason)]
}

function executePiHostBuiltinRequest(execution: PiHostToolExecutionInput): PiHostMessage[] | Promise<PiHostMessage[]> {
  const { state, input, id, invocationOrigin, emit } = execution
  const params = input.params || {}
  const split = splitDirectToolRequest(id, params)
  if (!split.ok) return [errorResponse(id, 'invalid_request', split.message)]
  const toolName = input.method!.slice('tools/'.length) as PiBuiltinToolName
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
  const sideEffect = toolName === 'write' || toolName === 'edit' || toolName === 'bash'
  const workspaceFailure = childWorkspaceToolFailure(state, envelope.sessionId, toolName, envelope.cwd, args, id)
  if (workspaceFailure) return workspaceFailure
  const bashDecision = toolName === 'bash'
    ? decideBashAction(String(args.command || ''), () => 'allow', state.snapshot.settings.bashRequireAsk ? 'ask' : 'allow')
    : undefined
  return dispatchDirectBuiltinTool({
    state,
    id,
    envelope,
    toolName,
    args,
    invocationOrigin,
    emit,
    sideEffect,
    bashDecision,
    hasRunId: typeof params.runId === 'string',
  })
}

function handleRunRequest(state: HostState, input: Partial<InternalPiHostRequest>, id: string | number, emit?: (message: PiHostMessage) => void) {
  return handlePiHostRunDomain({
    method: input.method!, params: input.params, id, snapshot: state.snapshot,
    commitQueue: (queue) => {
      state.snapshot.queue = queue
      state.snapshot.cursor += 1
      emit?.({ event: 'host/queue', payload: { cursor: state.snapshot.cursor, queueRevision: new PiRunQueue(24, queue).revision() } })
    },
    isSettlement: isPiTurnSettlement,
    handleAttachment: () => handleAttachmentRequest(state, input, id, emit),
    recordLifecycle: (sessionId, lifecycle, runId, reason) => {
      const recorded = recordAgentLifecycle(state.snapshot.sessions, sessionId, lifecycle, runId, reason, (entry) => publishAgentLifecycleEntry(emit, sessionId, entry))
      if (recorded) state.snapshot.cursor += 1
      return recorded
    },
    hasRecordedLifecycle: (sessionId, lifecycle, runId) => hasRecordedAgentLifecycle(
      state.snapshot.sessions,
      sessionId,
      lifecycle,
      runId,
    ),
    onSettled: async (run, settlement) => {
      const communicationState = agentCommunicationState(state, emit)
      // Review evidence is optional at this boundary; a degraded Review Store
      // must not prevent the canonical child completion or follow-up drain.
      const reviewArtifact = await state.reviewArtifactStore.findByRunId(run.runId).catch(() => undefined)
      const reviewSnapshotRef = reviewArtifact
        ? {
            snapshotId: reviewArtifact.snapshotId,
            runId: reviewArtifact.runId,
            status: reviewArtifact.status,
            attributionFidelity: reviewArtifact.attributionFidelity,
            ...(reviewArtifact.manifestHash ? { manifestHash: reviewArtifact.manifestHash } : {}),
          }
        : undefined
      state.agentCommunication.recordCompletion(communicationState, {
        sessionId: run.sessionId, runId: run.runId,
        settlement: agentLifecycleFromTurnSettlement(settlement) as 'completed' | 'failed' | 'cancelled' | 'interrupted',
        summary: `Child run settled as ${settlement}`,
        reviewSnapshotRef,
      })
      state.agentCommunication.drainNextFollowUp(communicationState, run.sessionId)
    },
    canClaim: (run) => !activeSessionRuns.has(run.sessionId),
  })
}

function handleAgentRequest(state: HostState, input: Partial<InternalPiHostRequest>, id: string | number, emit?: (message: PiHostMessage) => void) {
  if (!input.method?.startsWith('agents/')) return undefined
  if (input.method === 'agents/list') {
    if (!state.agentTreeNegotiated) return [errorResponse(id, 'protocol_mismatch', 'agent-tree-v1 capability was not negotiated')]
    return handlePiHostAgentDomain({
      method: input.method, params: input.params, id, sessions: state.snapshot.sessions,
      queue: state.snapshot.queue, activeSessionIds: new Set(activeSessionRuns.keys()),
      activeRunIds: new Map([...activeSessionRuns].map(([sessionId, run]) => [sessionId, run.runId])),
    })
  }
  if (!state.agentCollaborationNegotiated) return [errorResponse(id, 'protocol_mismatch', 'agent-collaboration-v1 capability was not negotiated')]
  return state.agentCommunication.handle({ id, method: input.method, params: input.params, state: agentCommunicationState(state, emit) })
}

type ActiveTurnSubmissionInput = {
  state: HostState
  request: Partial<InternalPiHostRequest>
  id: string | number
  sessionId: string
  runId: string
  prompt: string
  activeRun: { runId: string; cancelled: boolean; interrupt?: PiTurnInterruptReason }
  emit?: (message: PiHostMessage) => void
}

function activeFollowUpMode(request: Partial<InternalPiHostRequest>): 'steer' | 'queue' | undefined {
  if (request.params?.followUpMode === 'steer' || request.params?.mode === 'steer') return 'steer'
  if (request.params?.followUpMode === 'queue' || request.params?.mode === 'queue' || request.params?.queue === true) return 'queue'
  return undefined
}

function activeFollowUpIdentity(request: Partial<InternalPiHostRequest>) {
  const clientMessageId = typeof request.params?.clientMessageId === 'string' && request.params.clientMessageId.trim()
    ? request.params.clientMessageId.trim().slice(0, 256)
    : undefined
  const expectedActiveRunId = typeof request.params?.expectedActiveRunId === 'string'
    ? request.params.expectedActiveRunId
    : undefined
  return { clientMessageId, expectedActiveRunId }
}

function handleActiveSteer(input: ActiveTurnSubmissionInput): PiHostMessage[] {
  const { state, request, id, sessionId, runId, prompt, activeRun, emit } = input
  const { clientMessageId, expectedActiveRunId } = activeFollowUpIdentity(request)
  if (expectedActiveRunId && expectedActiveRunId !== activeRun.runId) return [errorResponse(id, 'conflict', `Active Pi run changed: ${activeRun.runId}`)]
  const queue = new PiRunQueue(24, state.snapshot.queue)
  const duplicate = clientMessageId ? queue.findByClientMessageId(clientMessageId) : undefined
  if (duplicate) return [{ id, result: { sessionId, runId: duplicate.targetRunId || activeRun.runId, settlement: 'interrupted' as const, queued: 'steer' as const, followUp: duplicate, queue: queue.snapshot(), queueRevision: queue.revision() } }]
  try {
    if (!steerPiTurn(sessionId, prompt)) return [errorResponse(id, 'invalid_request', 'Active Pi session cannot accept steering messages')]
  } catch (error) {
    return [errorResponse(id, 'invalid_request', error instanceof Error ? error.message : 'Unable to steer active Pi session')]
  }
  const receipt = queue.recordAcceptedSteer({
    runId, sessionId, prompt, trigger: 'interactive',
    profile: request.params?.profile && typeof request.params.profile === 'object' ? { ...(request.params.profile as Record<string, unknown>) } : {},
    ...(clientMessageId ? { clientMessageId } : {}), targetRunId: activeRun.runId,
  })
  state.snapshot.queue = queue.snapshot()
  state.snapshot.cursor += 1
  emit?.({ event: 'host/queue', payload: { cursor: state.snapshot.cursor, queueRevision: queue.revision() } })
  state.agentCommunication.notify(sessionId, { outcome: 'steer' })
  return [{ id, result: { sessionId, runId: activeRun.runId, settlement: 'interrupted' as const, queued: 'steer' as const, followUp: receipt, queue: state.snapshot.queue, queueRevision: queue.revision() } }]
}

function handleActiveQueue(input: ActiveTurnSubmissionInput): PiHostMessage[] {
  const { state, request, id, sessionId, runId, prompt, emit } = input
  const { clientMessageId } = activeFollowUpIdentity(request)
  const queuedLifecycle = agentLifecycleEventForSession(
    state.snapshot.sessions,
    sessionId,
    'queued',
    runId,
    undefined,
    activeTurnRecorders.get(sessionId)?.entries,
  )
  if (!queuedLifecycle) return [errorResponse(id, 'invalid_request', 'Illegal agent lifecycle transition')]
  const outcome = enqueuePiHostRun({
    queue: state.snapshot.queue,
    run: {
      runId,
      sessionId,
      prompt,
      trigger: 'interactive',
      profile: request.params?.profile && typeof request.params.profile === 'object'
        ? { ...(request.params.profile as Record<string, unknown>) }
        : {},
      status: 'queued',
      action: 'queue',
      ...(clientMessageId ? { clientMessageId } : {}),
    },
    recordLifecycle: () => {
      const recorder = activeTurnRecorders.get(sessionId)
      if (!recorder) return false
      recorder.deferredLifecycle = [...(recorder.deferredLifecycle || []), queuedLifecycle]
      return true
    },
  })
  if (!outcome.ok) return [errorResponse(id, 'invalid_request', outcome.message)]
  state.snapshot.queue = outcome.queue
  state.snapshot.cursor += 1
  emit?.({ event: 'host/queue', payload: { cursor: state.snapshot.cursor, queueRevision: new PiRunQueue(24, state.snapshot.queue).revision() } })
  const accepted = state.snapshot.queue.find((item) => item.runId === runId)
  return [{ id, result: { sessionId, runId, settlement: 'interrupted' as const, queued: 'queue' as const, queue: state.snapshot.queue, followUp: accepted, queueRevision: new PiRunQueue(24, state.snapshot.queue).revision() } }]
}

function handleActiveTurnSubmission(input: ActiveTurnSubmissionInput): PiHostMessage[] {
  const mode = activeFollowUpMode(input.request)
  if (mode === 'steer') return handleActiveSteer(input)
  if (mode === 'queue') return handleActiveQueue(input)
  return [errorResponse(input.id, 'invalid_request', `Pi session already has an active run: ${input.activeRun.runId}`)]
}

function admittedTurnWorkspace(
  session: SessionRecord,
  explicitWorkspaceRoot: string | undefined,
): { cwd: string } | { error: string } {
  const admittedWorkspaceRoot = session.agentAdmission?.workspace.mode === 'isolated-worktree'
    ? session.agentAdmission.workspace.worktreePath
    : session.agentAdmission?.workspace.projectRoot
  if (session.agentAdmission?.workspace.mode === 'isolated-worktree'
    && (!session.agentAdmission.workspace.verified || !admittedWorkspaceRoot)) {
    return { error: 'Isolated child worktree has no verified workspace identity' }
  }
  if (admittedWorkspaceRoot && explicitWorkspaceRoot) {
    try {
      if (realpathSync(explicitWorkspaceRoot) !== realpathSync(admittedWorkspaceRoot)) {
        return { error: 'Turn cwd does not match the Host-admitted child workspace' }
      }
    } catch {
      return { error: 'Turn cwd cannot be verified against the admitted workspace' }
    }
  }
  return { cwd: admittedWorkspaceRoot || explicitWorkspaceRoot || process.cwd() }
}

function recordRunningAgentLifecycle(state: HostState, sessionId: string, runId: string): void {
  const event = agentLifecycleEventForSession(state.snapshot.sessions, sessionId, 'running', runId)
  if (event) recordTurnEntry(sessionId, { kind: 'agent-lifecycle', source: 'host', event })
}

function recordTerminalAgentLifecycle(
  state: HostState,
  sessionId: string,
  runId: string,
  settlement: PiTurnSettlement,
  entries: readonly { kind: string; event?: unknown }[],
): void {
  const event = agentLifecycleEventForSession(
    state.snapshot.sessions,
    sessionId,
    agentLifecycleFromTurnSettlement(settlement),
    runId,
    undefined,
    entries,
  )
  if (event) recordTurnEntry(sessionId, { kind: 'agent-lifecycle', source: 'host', event })
}

function duplicateFollowUpResponse(state: HostState, request: unknown): PiHostMessage[] | undefined {
  if (!state.initialized || !request || typeof request !== 'object') return undefined
  const input = request as Partial<InternalPiHostRequest>
  if (input.method !== 'turn/submit' || typeof input.params?.clientMessageId !== 'string') return undefined
  const clientMessageId = input.params.clientMessageId.trim()
  const duplicate = state.snapshot.queue.find((item) => item.clientMessageId === clientMessageId)
  if (!duplicate || duplicate.sessionId !== input.params?.sessionId) return undefined
  const id = typeof input.id === 'string' || typeof input.id === 'number' ? input.id : ''
  const queue = new PiRunQueue(24, state.snapshot.queue)
  return [{ id, result: {
    sessionId: duplicate.sessionId,
    runId: duplicate.action === 'steer' ? duplicate.targetRunId || duplicate.runId : duplicate.runId,
    settlement: 'interrupted' as const,
    queued: duplicate.action === 'steer' ? 'steer' as const : 'queue' as const,
    followUp: duplicate,
    queue: queue.snapshot(),
    queueRevision: queue.revision(),
  } }]
}

function handlePiHostRequestWithFollowUpDedupe(
  state: HostState,
  request: unknown,
  emit?: (message: PiHostMessage) => void,
  checkpointWriter?: CompactionCheckpointWriter,
) {
  return duplicateFollowUpResponse(state, request)
    ?? handlePiHostRequest(state, request, emit, checkpointWriter)
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
  const standardInput = input as Partial<PiHostRequest>
  if (isPiHostLifecycleRequest(state, standardInput.method!)) {
    return handlePiHostLifecycleRequest(state, standardInput.method!, id)
  }
  if (input.method === 'runtime/status') return [{ id, result: piCoreRuntimeStatus() }]
  const toolDomainResponse = handlePiHostToolDomain({
    method: input.method,
    params: input.params,
    id,
    state,
    execute: () => executePiHostToolRequest(state, input, id, invocationOrigin, emit),
  })
  if (toolDomainResponse) return toolDomainResponse
  if (input.method === 'state/snapshot') {
    return projectPiHostStateSnapshot(state, id)
  }
  const runResponse = handleRunRequest(state, input, id, emit)
  if (runResponse) return runResponse
  const agentResponse = handleAgentRequest(state, input, id, emit)
  if (agentResponse) return agentResponse
  const sessionResponse = handlePiHostSessionDomain({
    method: input.method,
    params: input.params,
    id,
    state: {
      sessions: state.snapshot.sessions,
      isActive: (sessionId) => activeSessionRuns.has(sessionId),
      nextToolContractRevision: (sessionId) => state.toolContracts.nextRevision(sessionId),
      clearToolContracts: (sessionId) => state.toolContracts.clear(sessionId),
      clearCapabilities: (sessionId) => state.capabilities.clear(sessionId),
      publishLifecycle: (sessionId, entry) => publishAgentLifecycleEntry(emit, sessionId, entry),
      commit: (sessions) => { state.snapshot.sessions = sessions; state.snapshot.cursor += 1 },
    },
    compact: (session) => handleManualSessionCompaction({ state, session, request: input, id, checkpointWriter, emit }),
  })
  if (sessionResponse) return sessionResponse
  const boundedReadResponse = handleBoundedHostRead(state, input, id)
  if (boundedReadResponse) return boundedReadResponse
  const resourceResponse = handlePiHostResourceDomain({
    method: input.method,
    params: input.params,
    id,
    resources: state.snapshot.resources,
    activeTools: state.snapshot.settings.activeTools,
    commit: (resources) => { state.snapshot.resources = resources; state.snapshot.cursor += 1 },
  })
  if (resourceResponse) return resourceResponse
  const capabilityResponse = handleMemoryOrCapabilityRequest(state, input, id, emit)
  if (capabilityResponse) return capabilityResponse
  const extensionResponse = handlePiHostExtensionDomain({
    method: input.method,
    params: input.params,
    id,
    registry: state.extensions,
    emit,
    commit: (extensions) => { state.snapshot.extensions = extensions; state.snapshot.cursor += 1 },
  })
  if (extensionResponse) return extensionResponse
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
      return handleActiveTurnSubmission({ state, request: input, id, sessionId, runId, prompt, activeRun, emit })
    }
    const explicitWorkspaceRoot = typeof input.params?.cwd === 'string' && input.params.cwd.trim()
      ? input.params.cwd
      : undefined
    const workspaceAdmission = admittedTurnWorkspace(session, explicitWorkspaceRoot)
    if ('error' in workspaceAdmission) return [errorResponse(id, 'forbidden', workspaceAdmission.error)]
    const cwd = workspaceAdmission.cwd
    // Validate memory scope before opening an attachment/recorder. A failed
    // realpath must not leave an active run that can never settle or retry.
    const requestedContextPolicy = parsePiTurnContextPolicy(input.params?.contextPolicy)
    const contextPolicy = session.agentAdmission
      ? {
          ...requestedContextPolicy,
          memoryEnabled: false,
          memoryWriteEnabled: false,
          referenceChatHistory: false,
          temporary: true,
          project: cwd,
          outboundShellMode: session.agentAdmission.policy.outbound || 'off',
        }
      : requestedContextPolicy
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
    // Admission starts resolution now and the resulting immutable value is
    // captured by this closure for every iteration. Later saves/filesystem
    // changes can only affect a separately admitted run.
    const rawInstructionSnapshotPromise = Promise.all([
      state.instructionRepository.read(),
      state.instructionRepository.listAuthorizedIncludeTargets(),
    ]).then(async ([instructions, authorizedIncludeTargets]) =>
      observeInstructionProjection(state, await resolveInstructionSnapshot({
        globalRevision: instructions.revision,
        globalCustomInstructions: instructions.globalCustomInstructions,
        advancedPersonalityInstructions: instructions.advancedPersonalityInstructions,
        globalCustomInstructionsPresence: instructions.globalCustomInstructionsPresence,
        advancedPersonalityInstructionsPresence: instructions.advancedPersonalityInstructionsPresence,
        personality: instructions.personality,
        aboutUser: instructions.aboutUser,
        responseStyle: instructions.responseStyle,
        projectRoot: canonicalWorkspace,
        workPath: cwd,
        fallbackFilenames: Array.isArray(input.params?.instructionFallbackFilenames)
          ? input.params.instructionFallbackFilenames.filter((item): item is string => typeof item === 'string')
          : undefined,
        authorizedIncludeTargets,
      }), emit),
    )
    const patternValue = input.params?.pattern
    const pattern: PiLoopPattern = patternValue === 'Goal-based' || patternValue === 'Time-based' || patternValue === 'Proactive'
      ? patternValue
      : 'Turn-based'
    const maxIterations = typeof input.params?.maxIterations === 'number' ? input.params.maxIterations : 1
    const definitionOfDone = admittedDefinitionOfDone(input.params?.definitionOfDone)
    // Same shared clamp as the renderer's config builder (loopBounds.ts):
    // both sides must agree or a requested budget silently diverges.
    const iterationLimit = clampPiIterations(maxIterations)
    const requestedAgentMode = admittedAgentMode(input.params?.profile)
    const planCompletionAction = admittedPlanCompletionAction(input.params?.profile)
    let effectiveAgentMode: PiAgentMode = requestedAgentMode
    const requestedProfile = admittedProfileObject(input.params?.profile)
    const admittedProfile = session.agentAdmission
      ? { ...(session.profile || {}), ...requestedProfile }
      : requestedProfile
    let effectiveSettingsRevision = state.snapshot.cursor
    let turnSettings = session.agentAdmission
      ? compileEffectiveAgentProfile(state.snapshot.settings, session.profile as Partial<PiSettings>, {})
      : state.snapshot.settings
    if (input.params?.profile && typeof input.params.profile === 'object') {
      try {
        const profilePatch = validatePiSettingsPatch(input.params.profile as Record<string, unknown>)
        turnSettings = compileEffectiveAgentProfile(turnSettings, profilePatch, {})
      } catch (error) {
        return [errorResponse(id, 'invalid_request', error instanceof Error ? error.message : 'Invalid Pi turn profile')]
      }
    }
    if (session.agentAdmission) {
      const turnPolicy = admittedChildTurnPolicy(session.agentAdmission, turnSettings)
      if (!turnPolicy || !isRestrictiveAgentPolicy(session.agentAdmission.policy, turnPolicy)) {
        return [errorResponse(id, 'forbidden', 'Child turn profile would widen its Host-admitted policy')]
      }
    }
    // Pi historically interprets an empty activeTools array as unrestricted.
    // Keep a separate admission fact so a profile-less settings intersection
    // that becomes empty remains restrictive instead of widening to all tools.
    let turnActiveToolsRestricted = turnSettings.activeTools.length > 0
      || Object.prototype.hasOwnProperty.call(admittedProfile, 'activeTools')
      || Boolean(session.agentAdmission)
    const instructionSnapshotPromise = rawInstructionSnapshotPromise.then((snapshot) =>
      sanitizeInstructionSnapshotForProvider({
        snapshot,
        mode: contextPolicy.outboundShellMode,
        connectionId: contextPolicy.outboundConnectionId,
        provider: turnSettings.provider,
        runId,
      }),
    )
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
    const workingGoalAdmission = admitRequestedWorkingGoals(session, input)
    if (workingGoalAdmission.error) return [errorResponse(id, 'invalid_request', workingGoalAdmission.error)]
    const admittedWorkingGoals = workingGoalAdmission.goals
    if (input.params?.resumeFromRunId !== undefined
      && (requestedWorkingGoal(input) !== undefined || admittedWorkingGoals !== undefined)) {
      return [errorResponse(id, 'invalid_request', 'resume cannot replace checkpoint Working State goals')]
    }
    const resumed = resumeWorkingState({
      request: input, session, runId, checkpoints: checkpointWriter, packages: state.memoryControlPackages,
    })
    if (resumed.error) return [errorResponse(id, 'invalid_request', resumed.error)]
    const initialWorkingState = resumed.state
      || workingStateForAdmittedTurn(session, runId, prompt, requestedWorkingGoal(input), admittedWorkingGoals)
    const admittedPackage = admitTurnMemoryControlPackage(state, input.params, resumed.governingPackage)
    const governingPackage = memoryControlPackageIdentity(admittedPackage)
    const memoryControl = compileMemoryControlRuntime(admittedPackage, initialWorkingState.goals.length)
    const recorder: ActiveTurnRecorder = {
      cwd,
      turn: nextTurnNumber(session.record),
      step: 1,
      entries: [],
      toolIdentities: new Map(),
      stateProposals: new Map(),
      proposalState: initialWorkingState,
      governingPackage,
      memoryControl,
      pendingMemoryControlAudits: new Set(),
      memoryControlAuditsClosed: false,
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
    clearPiPlanGateCandidate(sessionId)
    clearPiContinuationItems(sessionId)
    restoreContinuationItems(sessionId, runId, resumed.continuationItems)
    recordTurnEntry(sessionId, {
      kind: 'turn-start',
      source: 'host',
      runner: 'builtin',
      capabilities: { ...BUILTIN_RUNNER_CAPABILITIES },
      instructionDelivery: { mode: 'explicit', exactSnapshot: true, detail: 'Pi Host admission snapshot' },
    })
    recordRunningAgentLifecycle(state, sessionId, runId)
    recordTurnEntry(sessionId, {
      kind: 'notice',
      source: 'host',
      topic: 'agent-mode',
      text: JSON.stringify({ requested: requestedAgentMode, effective: effectiveAgentMode, planCompletionAction }),
    })
    recordGoverningMemoryControlPackage(state, sessionId, governingPackage)
    let workingState = initialWorkingState
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
    let executionPrompt = childExecutionPrompt(session, prompt)
    let contextPreflightComplete = false
    let resolvedContextWindow = contextPolicy.contextWindowTokens
    activeSessionRuns.set(sessionId, { runId, cancelled: false })
    // In-turn pack tools read their coordinates and approval policy from this
    // binding; it is cleared when the run ends so a stale policy can never
    // answer for the next one.
    bindPiSessionRun(sessionId, {
      runId,
      memoryControlPackage: governingPackage,
      approvalMode: turnSettings.approvalMode,
      unattended: turnSettings.unattended,
      temporaryChat: contextPolicy.temporary,
      memoryAccess,
      frozenPolicy: freezePiRunPolicy({
        agentMode: requestedAgentMode,
        planCompletionAction,
        approvalMode: turnSettings.approvalMode,
        unattended: turnSettings.unattended,
        projectRoot: cwd,
        outboundMode: contextPolicy.outboundShellMode,
        restrictedViewRoot: contextPolicy.viewRoot,
        deniedTools: contextPolicy.deniedTools,
        approvalTools: contextPolicy.approvalTools,
        ...(contextPolicy.approvalTimeoutMs ? { approvalTimeoutMs: contextPolicy.approvalTimeoutMs } : {}),
      }),
      ...(resumed.state ? {
        completedFileEffects: resumed.state.goals.flatMap((goal) =>
          goal.status === 'done' && goal.completionPredicate?.kind === 'file-content'
            ? [{ path: goal.completionPredicate.path, sha256: goal.completionPredicate.sha256 }]
            : []),
      } : {}),
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
    let providerHistory = session.messages
    return instructionSnapshotPromise.then(async (instructionSnapshot) => {
      // The immutable snapshot is admitted and recorded before any provider
      // stage starts, including stages that stop the turn early.
      recordTurnEntry(sessionId, { kind: 'instruction-snapshot', source: 'host', snapshot: instructionSnapshot })
      if (contextPolicy.outboundShellMode && contextPolicy.outboundShellMode !== 'off') {
        providerHistory = await Promise.all(session.messages.map(async (message) => ({
          ...message,
          content: await prepareHostLlmEgress({
            text: message.content,
            mode: contextPolicy.outboundShellMode,
            connectionId: contextPolicy.outboundConnectionId,
            provider: turnSettings.provider,
            runId,
          }),
        })))
        // Pi owns a persistent native conversation. Recreate it from the
        // sanitized Host history so an older unprotected turn cannot re-enter
        // a newly protected provider request through Pi's hidden history.
        await disposePiSession(sessionId)
        session.piSessionFile = undefined
      }
      // Keep the exact persistent context handed to Pi beside the admitted
      // snapshot.  The session record must be able to reconstruct what the
      // provider saw after history egress protection, rather than rereading
      // the mutable session messages later.
      recordTurnEntry(sessionId, {
        kind: 'provider-history',
        source: 'host',
        messages: providerHistory.map((message) => ({ ...message })),
      })
      const pluginExecution = input.params?.pluginExecution
        ? await executeSubDesignProviderStage({
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
        : undefined
      return { pluginExecution, instructionSnapshot }
    }).then(async ({ pluginExecution, instructionSnapshot }) => {
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
      const requestWithInstructions = instructionSnapshot.effectiveText
        ? `${instructionSnapshot.effectiveText}\n\n## 當前請求\n${prompt}`
        : prompt
      const baseOrchestrationPrompt = [
        instructionSnapshot.effectiveText,
        pluginExecution ? `## Trusted provider stage result\n${JSON.stringify(pluginExecution)}` : '',
        `## 當前請求\n${prompt}`,
      ].filter(Boolean).join('\n\n')
      const goalAwarePrompt = pattern === 'Goal-based'
        ? goalContinuationPrompt(baseOrchestrationPrompt)
        : baseOrchestrationPrompt
      const orchestrationPrompt = requestedAgentMode === 'plan'
        ? planPhasePrompt(goalAwarePrompt, planCompletionAction)
        : goalAwarePrompt
      let priorContinuationSignature = ''
      let repeatedContinuationCount = 0
      const recalledResult = memoryAccess.memoryReadEnabled && !memoryAccess.temporary
        ? await state.memoryStore.recall({ access: memoryAccess, query: prompt, limit: 5 })
        : undefined
      const lowerAuthorityAvailableBytes = instructionSnapshot.usage.lowerAuthorityAvailableBytes
        ?? Math.max(0, instructionSnapshot.usage.budgetBytes - instructionSnapshot.usage.totalBytes)
      const selectedMemory = selectPiMemoryContextWithinBytes(
        recalledResult?.items.map(piMemoryProjection) || [],
        Math.min(3 * 1024, lowerAuthorityAvailableBytes),
      )
      const recalledItems = recalledResult?.items.slice(0, selectedMemory.memories.length) || []
      memoryContext = selectedMemory.context
      executionPrompt = memoryContext ? `${memoryContext}\n${requestWithInstructions}` : requestWithInstructions
      recordTurnEntry(sessionId, {
        kind: 'notice',
        source: 'host',
        topic: 'instruction-context-budget',
        text: JSON.stringify({
          totalBudgetBytes: instructionSnapshot.usage.budgetBytes,
          globalPersonalization: {
            includedBytes: instructionSnapshot.usage.personalizationBytes,
            budgetBytes: instructionSnapshot.usage.personalizationBudgetBytes,
          },
          projectInstructions: {
            includedBytes: instructionSnapshot.usage.projectInstructionBytes,
            budgetBytes: instructionSnapshot.usage.projectInstructionBudgetBytes,
          },
          learnedMemory: {
            requestedBytes: selectedMemory.requestedBytes,
            includedBytes: selectedMemory.includedBytes,
            droppedBytes: selectedMemory.droppedBytes,
          },
          totalIncludedBytes: instructionSnapshot.usage.totalBytes + selectedMemory.includedBytes,
        }),
      })
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
        const refreshedSettings = refreshIterationSettings({
          current: turnSettings,
          latest: state.snapshot.settings,
          effectiveRevision: effectiveSettingsRevision,
          latestRevision: state.snapshot.cursor,
          admittedProfile,
          sessionId,
          runId,
          iteration,
          freezeUnattended: Boolean(session.agentAdmission),
        })
        turnSettings = refreshedSettings.settings
        effectiveSettingsRevision = refreshedSettings.revision
        turnActiveToolsRestricted = turnActiveToolsRestricted || turnSettings.activeTools.length > 0
        publishOrchestration('iterate', iteration)
        recorder.step = iteration
        recorder.proposalState = workingState
        // Whether this step recorded any assistant message of its own; if the
        // stream carried none, the settled answer stands in for them.
        let spokenThisStep = false
        const pendingStateSettlements: Array<{
          proposal: WorkingStateProposal
          callId: string
          settlement: WorkingToolSettlement
          canonicalPath?: string
        }> = []
        recordTurnEntry(sessionId, { kind: 'step-start', source: 'host' })
        const iterationConfiguredActiveTools = turnSettings.activeTools
          .filter((tool) => workspaceTextSearchRun.available || !isWorkspaceTextSearchTool(tool))
        const iterationVisibleActiveTools = turnSettings.activeTools.length > 0 && iterationConfiguredActiveTools.length === 0
          ? ['load_capability']
          : iterationConfiguredActiveTools
        const iterationControlTools = iterationControlToolNames(effectiveAgentMode, pattern)
        const iterationUnlockedTools = [...new Set([...unlockedTools, ...iterationControlTools])]
        // This is the last Host-owned boundary before Pi dispatches to a
        // remote model. Sanitize the complete iteration and recalled memory,
        // not only project files prepared earlier by the renderer.
        const providerPrompt = await prepareHostLlmEgress({
          text: iterationPrompt,
          mode: contextPolicy.outboundShellMode,
          connectionId: contextPolicy.outboundConnectionId,
          provider: turnSettings.provider,
          runId,
        })
        const providerMemoryContext = await prepareHostLlmEgress({
          text: memoryContext,
          mode: contextPolicy.outboundShellMode,
          connectionId: contextPolicy.outboundConnectionId,
          provider: turnSettings.provider,
          runId,
        })
        // Persist the exact bounded prompt sent to Pi.  The raw orchestration
        // prompt may contain protected instruction text that must not be
        // written to the Turn Record after provider sanitization.
        const providerUserText = await prepareHostLlmEgress({
          // The conversation projection is the user's request, while the
          // provider-prompt entry below preserves the complete model payload.
          // Keeping these separate prevents standing instructions from being
          // rendered as if the user had typed them.
          text: prompt,
          mode: contextPolicy.outboundShellMode,
          connectionId: contextPolicy.outboundConnectionId,
          provider: turnSettings.provider,
          runId,
        })
        recordTurnEntry(sessionId, { kind: 'user-text', source: 'user', content: providerUserText })
        recordTurnEntry(sessionId, { kind: 'provider-prompt', source: 'host', content: providerPrompt })
        const turn = await runPiTurn(sessionId, cwd, providerPrompt, providerHistory, (event) => {
          const executionIdleLeaseMs = piTurnEventDeadlineLeaseMs(event)
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
              const segments = piAssistantTextSegments(message.content)
              if (segments.length > 0) {
                spokenThisStep = true
                for (const segment of segments) {
                  recordTurnEntry(sessionId, {
                    kind: 'assistant-text',
                    source: 'model',
                    content: segment.content,
                    ...(segment.phase ? { phase: segment.phase } : {}),
                  })
                }
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
            recordFileWriteStateProposal({ sessionId, recorder, workingState: recorder.proposalState, tool: toolName, callId, args: event.args })
            // Issue 16: an in-turn call gets the same observable lifecycle as
            // a direct-protocol one — start, decision, exactly one terminal.
            // Previously only the DENY path published anything terminal, so an
            // allowed call left the UI holding a decision that never resolved.
            publishInTurnToolEvent(state, sessionId, emit, {
              event: 'host/tool-start',
              payload: { runId, tool: toolName, callId, idleLeaseMs: executionIdleLeaseMs, ...(identity || {}) },
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
            const { notExecutedReason, denialReason } = consumeModelToolInterception(sessionId, toolCallId)
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
              notExecutedReason,
              toolFailed,
              identity,
              proposal,
              workingState,
              trustedResult: event.result,
              eventIsError: event.isError === true,
            })
            const canonicalPath = consumePiWorkingWriteCanonicalPath(runId, toolCallId)
            if (proposal) pendingStateSettlements.push({ proposal, callId: toolCallId, settlement: terminalSettlement, ...(canonicalPath ? { canonicalPath } : {}) })
            recorder.toolIdentities.delete(toolCallId)
            recorder.stateProposals.delete(toolCallId)
          }
          /* Events are collected below so the response remains ordered after them. */
          // Real progress resets the budget: a turn still emitting work is
          // working, not stuck, and long tasks are the point of this feature.
          deadline?.extendFor(executionIdleLeaseMs)
          const turnEvent: PiHostEvent = { event: 'host/turn-item', payload: { runId, sessionId, item: event, iteration } }
          if (emit) emit(turnEvent)
          else turnEvents.push(turnEvent)
        }, runId, session.piSessionFile, {
          ...turnSettings,
          temporaryChat: contextPolicy.temporary === true,
          // A restricted allowlist unions the unlocked capability tools; an
          // empty list already means everything is on.
          activeTools: turnActiveToolsRestricted
            ? [...new Set([...iterationVisibleActiveTools, ...iterationUnlockedTools])]
            : turnSettings.activeTools,
          activeToolsRestricted: turnActiveToolsRestricted,
          unlockedTools: iterationUnlockedTools,
          mcpGenerationKey: mcpTurnGenerationKey,
          mcpCapabilityActive: mcpCapabilityLoaded,
        }, providerMemoryContext, contextPolicy.referenceChatHistory, (registryContextWindow, runtimeSession) => {
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
        settleDelegatedGoalAdoption(state, sessionId, recorder)
        workingState = adoptDelegatedWorkingState(workingState, recorder)
        // Arbitrate only after every sibling effect in this model step has
        // settled. A later write may invalidate an earlier read-back receipt;
        // that stale evidence is rejected rather than leaving a false `done`.
        const arbitratedStateSettlements = pendingStateSettlements
          .map((pending, index) => ({
            ...pending,
            index,
            evidenceStillApplicable: proposalEvidenceStillApplies(pending.canonicalPath, pending.proposal),
          }))
          .sort((left, right) => {
            const leftPriority = left.settlement === 'success' && left.evidenceStillApplicable ? 0 : 1
            const rightPriority = right.settlement === 'success' && right.evidenceStillApplicable ? 0 : 1
            return leftPriority - rightPriority || left.index - right.index
          })
        for (const pending of arbitratedStateSettlements) {
          const { canonicalPath: _canonicalPath, index: _index, ...checked } = pending
          workingState = commitCheckedWorkingState({
            sessionId,
            recorder,
            workingState,
            ...checked,
            executionRunId: runId,
          })
        }
        workingState = revalidateCompletedGoals(sessionId, recorder, workingState)
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
            recordTurnEntry(sessionId, { kind: 'assistant-text', source: 'model', content: answer, phase: 'final_answer' })
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
          const control = settleIterationControl({
            pattern,
            done,
            state: { effectiveAgentMode, priorContinuationSignature, repeatedContinuationCount },
            plan: {
              sessionId, runId, settlement: turn.settlement, answer,
              action: planCompletionAction, orchestrationPrompt, goalAwarePrompt,
              approvalMode: turnSettings.approvalMode, iteration, publish: publishOrchestration,
            },
            continuation: {
              sessionId, runId, settlement: turn.settlement, answer,
              goalAwarePrompt, iteration, publish: publishOrchestration,
            },
          })
          effectiveAgentMode = control.effectiveAgentMode
          priorContinuationSignature = control.priorContinuationSignature
          repeatedContinuationCount = control.repeatedContinuationCount
          if (control.outcome) return control.outcome
          publishDefinitionOfDone({ definitionOfDone, done, iteration, iterationLimit, publish: publishOrchestration })
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
      }).then(async (orchestration) => {
      recorder.memoryControlAuditsClosed = true
      await Promise.all([...recorder.pendingMemoryControlAudits])
      publishOrchestration(
        orchestration.settlement === 'cancelled' || orchestration.settlement === 'interrupted' ? 'cancelled' : 'settlement',
        orchestration.iterations,
        orchestration.settlement === 'interrupted'
          ? `interrupted:${orchestration.interruptReason || 'user'}`
          : orchestration.settlement,
      )
      recorder.step = orchestration.iterations || recorder.step
      recordTerminalAgentLifecycle(state, sessionId, runId, orchestration.settlement, recorder.entries)
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
        turnRecordSlice.entries.at(-1)?.seq,
      )
      flushDeferredAgentLifecycle(state, sessionId, recorder, emit)
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
      }).catch(async (error) => {
        recorder.memoryControlAuditsClosed = true
        await Promise.all([...recorder.pendingMemoryControlAudits])
        // Async storage failures must close the same record/attachment as a
        // normal settlement, not just release the in-memory run lock.
        const reason = error instanceof Error ? error.message : 'Pi Host turn failed'
        flushReasoning(sessionId)
        recordTurnEntry(sessionId, { kind: 'notice', source: 'host', topic: 'host-error', text: reason })
        const failedLifecycle = agentLifecycleEventForSession(state.snapshot.sessions, sessionId, 'failed', runId, reason, recorder.entries)
        if (failedLifecycle) recordTurnEntry(sessionId, { kind: 'agent-lifecycle', source: 'host', event: failedLifecycle })
        recordTurnEntry(sessionId, { kind: 'turn-end', source: 'host', settlement: 'failed' })
        session.record = appendTurnRecord(session.record, recorder.entries)
        const terminalSeq = session.record.entries.at(-1)?.seq
        flushDeferredAgentLifecycle(state, sessionId, recorder, emit)
        state.snapshot.cursor += 1
        state.attachmentJournal.settle(runId, 'failed', reason, terminalSeq)
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
      clearPiPlanGateCandidate(sessionId, runId)
      clearPiContinuationItems(sessionId, runId)
      setPiPackSessionContractRefresh(sessionId)
      if (activeTurnRecorders.get(sessionId) === recorder) activeTurnRecorders.delete(sessionId)
      if (activeSessionRuns.get(sessionId)?.runId === runId) activeSessionRuns.delete(sessionId)
    })
  }
  const instructionOrReview = handleInstructionOrReviewRequest(state, input, id, emit)
  if (instructionOrReview) return instructionOrReview
  if (input.method === 'settings/get') return [{ id, result: { settings: { ...state.snapshot.settings }, config: state.snapshot.config, settingsRevision: state.snapshot.cursor } }]
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
      return [{ id, result: { settings: { ...state.snapshot.settings }, config: state.snapshot.config, settingsRevision: state.snapshot.cursor } }]
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

export type PiHostDispatchOutcome = {
  messages: PiHostMessage[]
  /** Explicit canonical snapshot commit decision for the server adapter. */
  commit: 'none' | 'snapshot'
  cursorBefore: number
  cursorAfter: number
}

/**
 * Central commit seam for protocol domains. A domain mutation is observable
 * through the canonical cursor it owns; read-only requests cannot be persisted
 * merely because their method happens to share a prefix with a writer.
 */
async function dispatchPiHostRequest(
  state: HostState,
  request: unknown,
  emit?: (message: PiHostMessage) => void,
  checkpointWriter?: CompactionCheckpointWriter,
): Promise<PiHostDispatchOutcome> {
  const cursorBefore = state.snapshot.cursor
  const messages = await handlePiHostRequestWithFollowUpDedupe(state, request, emit, checkpointWriter)
  const cursorAfter = state.snapshot.cursor
  return {
    messages,
    commit: cursorAfter === cursorBefore ? 'none' : 'snapshot',
    cursorBefore,
    cursorAfter,
  }
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
    return Promise.all([state.memoryStore.close(), state.instructionRepository.close()])
      .then(async () => [{ id, result: { memoryHealth: await state.memoryStore.health() } }])
  }
  return [errorResponse(id, 'closed', 'Pi Host is shutting down; new requests are refused')]
}

function isPiHostLifecycleRequest(state: HostState, method: PiHostRequest['method']): boolean {
  return method === 'health/get' || method === 'lifecycle/shutdown' || state.shuttingDown
}

function admitMemoryControlEvaluationPackage(
  state: HostState,
  params: Record<string, unknown> | undefined,
): MemoryControlPackage {
  const active = state.memoryControlPackages.admitActive()
  const revision = params?.evaluationPackageRevision
  if (revision === undefined) return active
  if (!validMaintenanceToken(state.memoryControlMaintenanceToken, params?.evaluationToken)
    || !Number.isSafeInteger(revision) || Number(revision) < 1) {
    throw new Error('Memory-Control evaluation package authority is unavailable')
  }
  const requested = state.memoryControlPackages.read({ schemaVersion: 1, revision: Number(revision) })
  if (requested.revision !== active.revision
    && (requested.status !== 'candidate' || requested.parentRevision !== active.revision)) {
    throw new Error('Memory-Control evaluation package is not the active revision or its candidate')
  }
  return requested
}

function admitTurnMemoryControlPackage(
  state: HostState,
  params: Record<string, unknown> | undefined,
  resumed?: MemoryControlPackage,
): MemoryControlPackage {
  return resumed || admitMemoryControlEvaluationPackage(state, params)
}

function readMemoryControlPackageView(
  state: HostState,
  view: unknown,
  revision: unknown,
  id: string | number,
): PiHostResponse[] {
  if (revision !== undefined) return [errorResponse(id, 'invalid_request', 'Memory-Control view does not accept revision')]
  if (view === 'lineage') return [{ id, result: { memoryControlLineage: state.memoryControlPackages.lineage() } }]
  if (view === 'evaluations') return [{ id, result: { memoryControlEvaluations: state.memoryControlPackages.evaluationReports() } }]
  return [errorResponse(id, 'invalid_request', 'Memory-Control Package view is invalid')]
}

function handleMemoryControlPackageRead(
  state: HostState,
  input: Partial<PiHostRequest>,
  id: string | number,
): PiHostResponse[] | undefined {
  if (input.method !== 'memory-control/v1/package/get') return undefined
  if (state.negotiatedProtocolVersion !== PI_HOST_PROTOCOL_VERSION || !state.memoryControlNegotiated) {
    return [errorResponse(id, 'protocol_mismatch', 'memory-control-v1 capability was not negotiated')]
  }
  try {
    const schemaVersion = input.params?.schemaVersion
    const revision = input.params?.revision
    const view = input.params?.view
    if (schemaVersion !== 1 || (revision !== undefined && (!Number.isSafeInteger(revision) || Number(revision) < 1))) {
      return [errorResponse(id, 'invalid_request', 'Memory-Control Package read requires schemaVersion 1 and an optional positive revision')]
    }
    if (view !== undefined) return readMemoryControlPackageView(state, view, revision, id)
    return [{ id, result: { memoryControlPackage: state.memoryControlPackages.read({
      schemaVersion: 1,
      ...(revision === undefined ? {} : { revision: Number(revision) }),
    }) } }]
  } catch (error) {
    return [errorResponse(id, 'invalid_request', error instanceof Error ? error.message : 'Memory-Control Package read failed')]
  }
}

function isMemoryControlPackageAuthority(value: MemoryControlPackageReader): value is MemoryControlPackageAuthority {
  const authority = value as Partial<MemoryControlPackageAuthority>
  return typeof authority.createCandidate === 'function'
    && typeof authority.rejectCandidate === 'function' && typeof authority.rollback === 'function'
    && typeof authority.settleEvaluation === 'function'
}

function validMaintenanceToken(expected: string | undefined, supplied: unknown): boolean {
  if (!expected || typeof supplied !== 'string' || supplied.length > 512) return false
  const expectedBytes = Buffer.from(expected)
  const suppliedBytes = Buffer.from(supplied)
  return expectedBytes.length === suppliedBytes.length && timingSafeEqual(expectedBytes, suppliedBytes)
}

function handleMemoryControlMaintenance(
  state: HostState,
  input: Partial<InternalPiHostRequest>,
  id: string | number,
): Promise<PiHostMessage[]> | undefined {
  if (input.method !== 'memory-control/v1/maintain') return undefined
  if (state.negotiatedProtocolVersion !== PI_HOST_PROTOCOL_VERSION || !state.memoryControlNegotiated) {
    return Promise.resolve([errorResponse(id, 'protocol_mismatch', 'memory-control-v1 capability was not negotiated')])
  }
  const params = input.params || {}
  const sessionId = typeof params.sessionId === 'string' ? params.sessionId : ''
  if (!validMaintenanceToken(state.memoryControlMaintenanceToken, params.maintenanceToken)
    || !isMemoryControlPackageAuthority(state.memoryControlPackages)) {
    return Promise.resolve([errorResponse(id, 'invalid_request', 'Memory-Control maintenance authority is unavailable')])
  }
  const recorder = activeTurnRecorders.get(sessionId)
  if (!sessionId || !recorder) {
    return Promise.resolve([errorResponse(id, 'invalid_request', 'Memory-Control maintenance requires an active audit Task run')])
  }
  if (recorder.memoryControlAuditsClosed) {
    return Promise.resolve([errorResponse(id, 'invalid_request', 'Memory-Control audit Task run is settling; maintenance admission is closed')])
  }
  let releaseAuditBarrier = () => {}
  const auditBarrier = new Promise<void>((resolve) => { releaseAuditBarrier = resolve })
  recorder.pendingMemoryControlAudits.add(auditBarrier)
  const operation = params.operation === 'create-meta-candidate'
    ? executeMemoryControlMetaMaintenance(state, state.memoryControlPackages, params)
    : executeMemoryControlMaintenance(state, state.memoryControlPackages, params).then((memoryControlPackage) => ({
        memoryControlPackage,
        memoryControlDiagnosis: undefined as MemoryControlDiagnosis | undefined,
      }))
  return operation
    .then(({ memoryControlPackage, memoryControlDiagnosis }) => {
      const memoryControlLineage = state.memoryControlPackages.lineage()
      const event = memoryControlLineage.events.at(-1)
      if (!event) throw new Error('Memory-Control maintenance did not append lifecycle audit')
      recordTurnEntry(sessionId, { kind: 'memory-control-lifecycle', source: 'host', event })
      return [{ id, result: { memoryControlPackage, memoryControlLineage, ...(memoryControlDiagnosis ? { memoryControlDiagnosis } : {}) } }]
    })
    .catch((error) => [errorResponse(id, 'invalid_request', error instanceof Error ? error.message : 'Memory-Control maintenance failed')])
    .finally(() => {
      releaseAuditBarrier()
      recorder.pendingMemoryControlAudits.delete(auditBarrier)
    })
}

async function executeMemoryControlMetaMaintenance(
  state: HostState,
  authority: MemoryControlPackageAuthority,
  params: Record<string, unknown>,
): Promise<{ memoryControlPackage: MemoryControlPackage; memoryControlDiagnosis: MemoryControlDiagnosis }> {
  const sourceSessionId = typeof params.sourceSessionId === 'string' && params.sourceSessionId.length <= 512
    ? params.sourceSessionId
    : ''
  const source = state.snapshot.sessions.find((session) => session.id === sourceSessionId)
  if (!source?.record) throw new Error('Meta-Agent diagnosis requires a persisted source Turn Record')
  const candidateOnlyAuthority = {
    admitActive: () => authority.admitActive(),
    read: (input: { schemaVersion: 1; revision?: number }) => authority.read(input),
    lineage: () => authority.lineage(),
    evaluationReports: () => authority.evaluationReports(),
    createCandidate: (input: Parameters<MemoryControlPackageAuthority['createCandidate']>[0]) => authority.createCandidate(input),
  }
  const result = await createMemoryControlMetaCandidate({ packages: candidateOnlyAuthority, record: source.record, output: params.patch })
  return { memoryControlPackage: result.candidate, memoryControlDiagnosis: result.diagnosis }
}

async function executeMemoryControlMaintenance(
  state: HostState,
  authority: MemoryControlPackageAuthority,
  params: Record<string, unknown>,
): Promise<MemoryControlPackage> {
  const operation = params.operation
  const revision = Number(params.revision)
  const expectedActiveRevision = Number(params.expectedActiveRevision)
  const reason = typeof params.reason === 'string' ? params.reason : ''
  if (operation === 'settle-evaluation') {
    if (!params.report || typeof params.report !== 'object') return Promise.reject(new Error('Memory-Control evaluation report is required'))
    if (!state.memoryControlEvaluationAuthority) throw new Error('Memory-Control Host evaluation authority is unavailable')
    const report = state.memoryControlEvaluationAuthority.verify(
      params.report as import('../src/agent/memoryControlEvaluationContract.ts').MemoryControlEvaluationReport,
      state.snapshot.sessions,
    )
    return authority.settleEvaluation({ report })
  }
  if (operation === 'create-candidate') {
    if (!MEMORY_CONTROL_COMPONENT_KEYS.includes(params.diagnosisComponent as MemoryControlComponentKey) || !Array.isArray(params.patch)) {
      return Promise.reject(new Error('Memory-Control candidate diagnosis and patch are required'))
    }
    return authority.createCandidate({
      expectedActiveRevision,
      diagnosisComponent: params.diagnosisComponent as MemoryControlComponentKey,
      patch: params.patch as MemoryControlJsonPatchOperation[],
      reason,
    })
  }
  if (!Number.isSafeInteger(revision) || revision < 1) return Promise.reject(new Error('Memory-Control revision is invalid'))
  if (operation === 'reject-candidate') return authority.rejectCandidate({ revision, reason })
  if (!Number.isSafeInteger(expectedActiveRevision) || expectedActiveRevision < 1) {
    return Promise.reject(new Error('Memory-Control expected active revision is invalid'))
  }
  if (operation === 'rollback') return authority.rollback({ revision, expectedActiveRevision, reason })
  return Promise.reject(new Error('Memory-Control maintenance operation is invalid'))
}

function recordGoverningMemoryControlPackage(
  state: HostState,
  sessionId: string,
  packageIdentity: MemoryControlPackageIdentity,
): void {
  const lifecycleEvent = [...state.memoryControlPackages.lineage().events].reverse()
    .find((event) => event.revision === packageIdentity.revision
      && (event.kind === 'candidate-activated' || event.kind === 'rollback'))
  recordTurnEntry(sessionId, {
    kind: 'memory-control-package', source: 'host', packageIdentity,
    ...(lifecycleEvent ? { lifecycleEvent } : {}),
  })
}

function handleBoundedHostRead(
  state: HostState,
  input: Partial<InternalPiHostRequest>,
  id: string | number,
): PiHostMessage[] | Promise<PiHostMessage[]> | undefined {
  return handleMemoryControlMaintenance(state, input, id)
    || handleMemoryControlPackageRead(state, input as Partial<PiHostRequest>, id)
}

function resolveDelegatedSpawnGoal(input: {
  parentSessionId: string
  parentRunId: string
  objective: string
  context: PiContextPacket
  goalId?: string
}): { objective: string; context: PiContextPacket; parentState?: WorkingState } {
  if (!input.goalId) return { objective: input.objective, context: input.context }
  const recorder = activeTurnRecorders.get(input.parentSessionId)
  if (!recorder || recorder.proposalState.runId !== input.parentRunId) {
    throw new Error('parent delegated goal is not active')
  }
  const parentState = recorder.delegatedWorkingState || recorder.proposalState
  const goal = parentState.goals.find((candidate) => candidate.id === input.goalId)
  if (!goal || goal.status !== 'pending' || !goal.completionPredicate) {
    throw new Error('assigned parent goal is not pending and verifiable')
  }
  return {
    objective: goal.description,
    context: {
      objective: boundedAgentText(goal.description, 800),
      facts: [],
      constraints: parentState.constraints.map((constraint) => boundedAgentText(constraint, 400)),
    },
    parentState,
  }
}

function finalizeDelegatedSpawn(input: {
  state: HostState
  parentSessionId: string
  childSessionId: string
  runId: string
  objective: string
  context: PiContextPacket
  goalId?: string
  parentState?: WorkingState
}): { sessionId: string; runId: string; objective: string; delegationId?: string } {
  const child = input.state.snapshot.sessions.find((session) => session.id === input.childSessionId)
  if (!child) throw new Error('child session was not persisted')
  if (!input.goalId || !input.parentState) {
    return { sessionId: input.childSessionId, runId: input.runId, objective: input.objective }
  }
  const rawAssignment = createDelegatedGoalAssignment({
    state: input.parentState,
    goalId: input.goalId,
    parentSessionId: input.parentSessionId,
    childSessionId: input.childSessionId,
  })
  const assignment = {
    ...rawAssignment,
    constraints: rawAssignment.constraints.map((constraint) => boundedAgentText(constraint, 400)),
    goal: { ...rawAssignment.goal, description: boundedAgentText(rawAssignment.goal.description, 800) },
  }
  child.context = { ...input.context, delegatedGoal: assignment }
  recordTurnEntry(input.parentSessionId, { kind: 'delegation-assignment', source: 'host', assignment })
  return {
    sessionId: input.childSessionId,
    runId: input.runId,
    delegationId: assignment.delegationId,
    objective: assignment.goal.description,
  }
}

export function createPiHostServer(
  send: (message: PiHostMessage) => void,
  initialSnapshot: { cursor: number; sessions: SessionRecord[]; settings: PiSettings; settingsOrigin?: 'native' | 'managed'; config?: PiHostConfigStatus; queue: PiQueuedRun[]; resources: PiResource[]; extensions?: PiExtension[]; attachments?: PiHostAttachment[] } = {
    cursor: 0,
    sessions: [],
    settings: { ...DEFAULT_PI_SETTINGS },
    queue: [],
    resources: [],
    extensions: [],
    attachments: [],
  },
  onStateChange?: (snapshot: { cursor: number; sessions: SessionRecord[]; settings: PiSettings; settingsOrigin?: 'native' | 'managed'; config?: PiHostConfigStatus; queue: PiQueuedRun[]; resources: PiResource[]; extensions: PiExtension[]; attachments: PiHostAttachment[] }) => void,
  refreshConfig?: () => Promise<PiHostConfigStatus>,
  checkpointWriter?: CompactionCheckpointWriter,
  suppliedMemoryStore?: DurableMemoryStore,
  suppliedMemoryControlPackages?: MemoryControlPackageReader,
  suppliedMemoryControlMaintenanceToken?: string,
  suppliedMemoryControlEvaluationAuthority?: MemoryControlEvaluationAuthority,
  suppliedInstructionRepository?: InstructionRepository,
  suppliedReviewArtifactStore?: ReviewArtifactStore,
  suppliedReviewStateStore?: ReviewStateStore,
  suppliedReviewVerificationStore?: ReviewVerificationStore,
  reviewMutationRecoveryDir = resolve(process.cwd(), '.agentstudio-review-recovery'),
) {
  const memoryStore = suppliedMemoryStore || new InMemoryDurableMemoryStore()
  const instructionRepository = suppliedInstructionRepository || new InMemoryInstructionRepository()
  const reviewArtifactStore = suppliedReviewArtifactStore || new InMemoryReviewArtifactStore()
  const reviewWorkspaces = new Map<string, ReviewWorkspaceBinding>()
  const reviewProjection = new WorkspaceReviewProjection({
    store: reviewArtifactStore,
    resolveWorkspace: (workspaceId) => reviewWorkspaces.get(workspaceId),
  })
  const reviewStateStore = suppliedReviewStateStore || new InMemoryReviewStateStore()
  const reviewVerificationStore = suppliedReviewVerificationStore || new InMemoryReviewVerificationStore()
  const reviewMutationCoordinator = new ReviewMutationCoordinator({
    resolveWorkspace: (workspaceId) => reviewWorkspaces.get(workspaceId),
    recoveryDir: reviewMutationRecoveryDir,
  })
  const reviewDeliveryCoordinator = new ReviewDeliveryCoordinator({ resolveWorkspace: (workspaceId) => reviewWorkspaces.get(workspaceId) })
  const memoryControlPackages = suppliedMemoryControlPackages || baselineMemoryControlPackageReader()
  const memoryReady = Promise.resolve()
  const snapshot = { ...initialSnapshot, extensions: initialSnapshot.extensions || [], attachments: initialSnapshot.attachments || [] }
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
    memoryControlNegotiated: false,
    instructionRepositoryNegotiated: false,
    reviewNegotiated: false,
    agentTreeNegotiated: false,
    agentCollaborationNegotiated: false,
    agentCommunication: new PiAgentCommunicationDomain(),
    reviewArtifactStore,
    reviewWorkspaces,
    reviewProjection,
    reviewStateStore,
    reviewVerificationStore,
    reviewMutationCoordinator,
    reviewDeliveryCoordinator,
    reviewImportPreviews: new Set(),
    memoryStore,
    instructionRepository,
    instructionProjections: new Map(),
    memoryControlPackages,
    memoryControlEvaluationAuthority: suppliedMemoryControlEvaluationAuthority,
    memoryControlMaintenanceToken: suppliedMemoryControlMaintenanceToken,
    publishedMemoryRevisions: new Set(),
    catalogProjection: new Map(),
    attachmentJournal,
    shuttingDown: false,
  }
  // A persisted active record has no live witness in a new Host child. Keep
  // the Host honest across process restart; renderer reloads do not recreate
  // this server and therefore preserve their active records.
  attachmentJournal.recoverOrphanedActive()
  state.agentCommunication.recover(agentCommunicationState(state))
  for (const session of snapshot.sessions) {
    state.toolContracts.reserveNextRevision(session.id, session.toolContractRevisionFloor || 1)
  }
  ensurePiPacksRegistered()
  // The gateway credential is operator configuration, never a model argument.
  configurePiMessagingGateway({ botToken: process.env.SUBAGENTS_TELEGRAM_BOT_TOKEN })
  // Packs reach durable Host state ONLY through these accessors: one memory
  // store, the real child-session/run-queue path, and the live extension
  // registry. No pack holds a copy of any of them.
  setPiMemoryBridge(createPiDurableMemoryBridge(memoryStore,
    (change) => publishPiMemoryChange(state, change, send),
    (sessionId, entry) => recordTurnEntry(sessionId, entry),
  ))
  setPiDelegationBridge({
    spawnChild: async ({ spawnId, runId, parentSessionId, parentRunId, objective, role, profile, context, depth, workspace, goalId }) => {
      const assigned = resolveDelegatedSpawnGoal({ parentSessionId, parentRunId, objective, context, goalId })
      const responses = await Promise.resolve(state.agentCommunication.handle({
        id: `pack-child-${spawnId}`,
        method: 'agents/spawn',
        params: {
          spawnId, runId, parentAgentId: parentSessionId, originRunId: parentRunId,
          objective: assigned.objective, role, profile, context: assigned.context, depth,
          workspace: workspace || { mode: 'shared-readonly' },
        },
        state: agentCommunicationState(state, send),
      }))
      const response = (Array.isArray(responses) ? responses : []).find((message) => !('event' in message)) as PiHostResponse | undefined
      if (!response || response.error) throw new Error(response?.error?.message || 'child session failed')
      const result = response.result as (Record<string, unknown> & { sessionId?: string; runId?: string }) | undefined
      const childSessionId = String(result?.sessionId || '')
      return finalizeDelegatedSpawn({
        state, parentSessionId, childSessionId, runId: String(result?.runId || runId),
        objective: assigned.objective, context: assigned.context, goalId, parentState: assigned.parentState,
      })
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
    requestGoalAdoption: (parentSessionId) => {
      const recorder = activeTurnRecorders.get(parentSessionId)
      if (!recorder) throw new Error('parent delegated goal is not active')
      recorder.delegatedAdoptionRequested = true
    },
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
      const recorder = activeTurnRecorders.get(request.sessionId)
      if (recorder) {
        recorder.pendingApprovalCount = (recorder.pendingApprovalCount || 0) + 1
        if (recorder.pendingApprovalCount === 1) {
          recordInTurnAgentLifecycle(state, request.sessionId, 'waiting-approval', request.runId)
        }
      }
      const pendingApproval = state.attachmentJournal.get(request.runId)?.pendingApproval
      // Direct protocol/code-mode calls may not have a run attachment; retain
      // their existing event behavior while attached turns use the bounded
      // journal projection above.
      send({ event: 'host/approval-requested', payload: { ...(pendingApproval || normalizePiHostPendingApproval(request) || request) } })
    },
    resolved: (request) => {
      state.attachmentJournal.clearPendingApproval(request.runId, request.callId)
      const recorder = activeTurnRecorders.get(request.sessionId)
      if (recorder) {
        recorder.pendingApprovalCount = Math.max(0, (recorder.pendingApprovalCount || 1) - 1)
        if (recorder.pendingApprovalCount === 0) {
          recordInTurnAgentLifecycle(state, request.sessionId, 'running', request.runId)
        }
      }
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
  setPiSkillPreflightBridge({
    snapshot: (sessionId) => {
      const recorder = activeTurnRecorders.get(sessionId)
      if (!recorder) throw new Error('Skill preflight requires an active Host turn recorder')
      const binding = piSessionRunBinding(sessionId)
      if (!binding) throw new Error('Skill preflight requires an active Host run binding')
      return {
        runId: binding.runId,
        step: recorder.step,
        workingStateRevision: recorder.proposalState.revision,
      }
    },
    preflight: async (input) => {
      const recorder = activeTurnRecorders.get(input.sessionId)
      if (!recorder) throw new Error('Skill preflight requires an active Host turn recorder')
      if (piSessionRunBinding(input.sessionId)?.runId !== input.runId || recorder.step !== input.step
        || recorder.proposalState.revision !== input.workingStateRevision) {
        throw new Error('Skill preflight coordinates changed before the decision was recorded')
      }
      const resourceView = piSessionRunBinding(input.sessionId)?.frozenPolicy?.resourceView
      const control = recorder.memoryControl
      const enabled = control.trigger !== 'contract-required' || input.trigger === 'contract-required-tool-call'
      const skills = enabled && resourceView
        ? await selectFrozenPiPreflightSkills({ resourceView, exactTool: input.tool,
          maxSkills: control.maxSkills, secondSkillReason: control.secondSkillReason,
          overrides: control.skillOverrides,
          ...(control.selection === 'tool-and-goal' ? { goalContext: [recorder.proposalState.objective,
            ...recorder.proposalState.goals.filter((goal) => goal.status !== 'done').map((goal) => goal.description),
            ...recorder.proposalState.constraints].join('\n') } : {}),
        })
        : []
      const identities = skills.map(({ body: _body, ...identity }) => identity)
      const invocation = createSkillPreflight({
        state: recorder.proposalState,
        runId: input.runId,
        step: recorder.step,
        tool: input.tool,
        callId: input.callId,
        identity: input.identity,
        args: input.args,
        trigger: input.trigger,
        selectedSkills: identities,
        batchId: input.batchId,
        packageIdentity: recorder.governingPackage,
      })
      recordTurnEntry(input.sessionId, { kind: 'skill-invocation', source: 'host', invocation })
      return skills.length ? { kind: 'redraft' as const, skills } : { kind: 'pass-through' as const }
    },
    contextInjected: (sessionId, injection) => {
      recordTurnEntry(sessionId, { kind: 'skill-context', source: 'host', injection })
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
        const outcome = await dispatchPiHostRequest(state, request, send, checkpointWriter)
        if (outcome.commit === 'snapshot') onStateChange?.(state.snapshot)
        for (const message of outcome.messages) send(message)
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

async function refreshHostConfigForRequest(
  state: HostState,
  input: Partial<PiHostRequest> | undefined,
  refreshConfig?: () => Promise<PiHostConfigStatus>,
): Promise<void> {
  if (!refreshConfig || !hostRequestNeedsFreshOAuth(input?.method)) return
  state.snapshot.config = await refreshConfig()
  state.snapshot.cursor += 1
}

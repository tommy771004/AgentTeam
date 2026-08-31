import { PI_HOST_PROTOCOL_VERSION, type PiHostEvent, type PiHostMessage, type PiHostRequest, type PiHostResponse } from './piHostProtocol.ts'
import { clampTurnTimeout } from './piTurnDeadline.ts'
import type { PiHostFinalizationClaimResult, PiHostFinalizationCompleteResult } from './piHostAttachment.ts'
import type { PiTurnSettlement } from '../src/agent/piHostRun.ts'
import type { ProjectInstructionWriteFailureCode } from './projectInstructionWriter.ts'
import type { RunLearningFinalOutcome } from '../src/agent/runLearningSettlement.ts'
import type { AgentTreeSnapshot } from '../src/agent/agentTree.ts'
import type { MemoryImportPreviewInput, MemoryImportApplyInput } from './durableMemoryImport.ts'
import type { MemoryStorageHealth } from './memoryStorageLifecycle.ts'
import type { ReviewAdmissionSnapshot, ReviewRunnerKind, ReviewSnapshotRef } from '../src/agent/reviewContract.ts'
import type {
  DurableMemoryProtocolResult,
  CanonicalProjectId,
  MemoryAccessContext,
  MemoryAppendInput,
  MemoryClearInput,
  MemoryDeleteInput,
  MemoryDreamConsolidateInput,
  MemoryGetInput,
  MemoryListInput,
  MemoryRecallInput,
  MemoryUpsertInput,
} from './durableMemoryStore.ts'

export type PiHostStatus =
  | { state: 'stopped' }
  | { state: 'starting' }
  | { state: 'ready'; protocolVersion: number; capabilities: string[]; memoryHealth?: MemoryStorageHealth }
  | { state: 'crashed'; exitCode: number | null; signal?: number }
  | { state: 'error'; message: string; memoryHealth?: Extract<MemoryStorageHealth, { status: 'degraded' }> }

type PiHostChild = {
  on(event: string, listener: (...args: any[]) => void): unknown
  postMessage(message: unknown): void
  kill(): void
}
type PiHostFork = () => PiHostChild | Promise<PiHostChild>
type PiHostSupervisorOptions = {
  requestTimeoutMs?: number
  turnIdleTimeoutMs?: number
  requestedCapabilities?: string[]
  serviceHandler?: (service: string, input: Record<string, unknown>) => Promise<unknown>
}
type PendingRequest = {
  resolve: (response: PiHostResponse) => void
  reject: (error: Error) => void
  method: PiHostRequest['method']
  runId?: string
  baseTimeoutMs: number
  timeoutMs: number
  timer?: ReturnType<typeof setTimeout>
}

export class PiHostSupervisor {
  private readonly fork: PiHostFork
  private readonly requestTimeoutMs: number
  private readonly turnIdleTimeoutMs: number
  private readonly requestedCapabilities: string[]
  private readonly serviceHandler?: PiHostSupervisorOptions['serviceHandler']
  private child: PiHostChild | null = null
  private nextRequestId = 1
  private statusValue: PiHostStatus = { state: 'stopped' }
  private stopping = false
  private restartAttempts = 0
  private restartTimer: ReturnType<typeof setTimeout> | undefined
  private readonly eventListeners = new Set<(event: PiHostEvent) => void>()
  private readonly pending = new Map<string | number, PendingRequest>()

  constructor(fork: PiHostFork, options: PiHostSupervisorOptions = {}) {
    this.fork = fork
    this.requestTimeoutMs = options.requestTimeoutMs ?? 30_000
    this.turnIdleTimeoutMs = options.turnIdleTimeoutMs ?? 5 * 60_000
    this.requestedCapabilities = options.requestedCapabilities
      ? [...options.requestedCapabilities]
      : ['attachments-v1', 'tool-contract-v1', 'instructions-v1', 'review-v1', 'agent-tree-v1', 'agent-collaboration-v1']
    this.serviceHandler = options.serviceHandler
  }

  status(): PiHostStatus {
    return this.statusValue
  }

  onEvent(listener: (event: PiHostEvent) => void): () => void {
    this.eventListeners.add(listener)
    return () => this.eventListeners.delete(listener)
  }

  async start(): Promise<PiHostStatus> {
    if (this.statusValue.state === 'ready') return this.statusValue
    this.stopping = false
    if (this.restartTimer) {
      clearTimeout(this.restartTimer)
      this.restartTimer = undefined
    }
    this.statusValue = { state: 'starting' }
    const child = await this.fork()
    this.child = child
    child.on('message', (message: PiHostMessage) => {
      const serviceMessage = message as unknown as { event?: string; payload?: { id?: string; service?: string; input?: Record<string, unknown> } }
      if (serviceMessage.event === 'host/service-request') {
        const id = String(serviceMessage.payload?.id || '')
        const service = String(serviceMessage.payload?.service || '')
        const input = serviceMessage.payload?.input || {}
        void Promise.resolve()
          .then(() => {
            if (!this.serviceHandler) throw new Error(`Host service is not configured: ${service}`)
            return this.serviceHandler(service, input)
          })
          .then(
            (result) => child.postMessage({ event: 'host/service-response', payload: { id, result } }),
            (error) => child.postMessage({ event: 'host/service-response', payload: { id, error: error instanceof Error ? error.message : String(error) } }),
          )
        return
      }
      if ('event' in message) {
        if (message.event === 'host/storage-health') {
          this.statusValue = { state: 'error', message: message.payload.message, memoryHealth: message.payload }
        }
        const runId = typeof message.payload === 'object' && message.payload && 'runId' in message.payload
          ? String((message.payload as { runId?: unknown }).runId || '')
          : ''
        if (runId) {
          const payload = message.payload as { idleLeaseMs?: unknown }
          this.refreshTurnDeadline(
            runId,
            message.event === 'host/tool-start' ? payload.idleLeaseMs : undefined,
            message.event === 'host/tool-result',
          )
        }
        this.eventListeners.forEach((listener) => listener(message as unknown as PiHostEvent))
        return
      }
      const waiter = this.pending.get(message.id)
      if (!waiter) return
      this.pending.delete(message.id)
      if (waiter.timer) clearTimeout(waiter.timer)
      waiter.resolve(message)
    })
    child.on('exit', (code: number | null, signal?: number) => {
      this.child = null
      if (this.stopping) {
        this.statusValue = { state: 'stopped' }
        return
      }
      if (this.statusValue.state !== 'error' || !this.statusValue.memoryHealth) {
        this.statusValue = { state: 'crashed', exitCode: code, signal }
      }
      for (const waiter of this.pending.values()) {
        if (waiter.timer) clearTimeout(waiter.timer)
        waiter.reject(new Error('Pi Core Host exited'))
      }
      this.pending.clear()
      this.scheduleRestart()
    })
    child.on('error', (error: Error) => {
      this.statusValue = { state: 'error', message: error.message }
    })

    const response = await this.request('initialize', { protocolVersion: PI_HOST_PROTOCOL_VERSION, client: 'subagents-electron', capabilities: this.requestedCapabilities })
    if (response.error || !response.result) {
      const message = response.error?.message || 'Pi Core Host did not initialize'
      this.statusValue = { state: 'error', message }
      throw new Error(message)
    }
    const health = await this.request('health/get', {})
    if (health.error || health.result?.memoryHealth?.status !== 'ready') {
      const message = health.error?.message || 'Pi Core Host memory storage is not ready'
      this.statusValue = { state: 'error', message }
      throw new Error(message)
    }
    this.statusValue = {
      state: 'ready',
      protocolVersion: response.result.protocolVersion ?? 1,
      capabilities: response.result.capabilities ? [...response.result.capabilities] : [],
      memoryHealth: health.result.memoryHealth,
    }
    this.restartAttempts = 0
    return this.statusValue
  }

  async health(): Promise<PiHostResponse['result']> {
    const response = await this.request('health/get', {})
    if (response.error || !response.result) throw new Error(response.error?.message || 'Pi Host health failed')
    return response.result
  }

  async getSettings(): Promise<NonNullable<PiHostResponse['result']>['settings']> {
    const result = await this.getSettingsSnapshot()
    return result.settings
  }

  async getSettingsSnapshot(): Promise<NonNullable<PiHostResponse['result']>> {
    const response = await this.request('settings/get', {})
    if (response.error || !response.result?.settings) throw new Error(response.error?.message || 'Pi Host settings failed')
    return response.result
  }

  async updateSettings(patch: Record<string, unknown>): Promise<NonNullable<PiHostResponse['result']>['settings']> {
    const result = await this.updateSettingsSnapshot(patch)
    return result.settings
  }

  async updateSettingsSnapshot(patch: Record<string, unknown>): Promise<NonNullable<PiHostResponse['result']>> {
    const response = await this.request('settings/update', patch)
    if (response.error || !response.result?.settings) throw new Error(response.error?.message || 'Pi Host settings update failed')
    return response.result
  }

  async profile(role?: Record<string, unknown>, taskOverride?: Record<string, unknown>): Promise<NonNullable<PiHostResponse['result']>['profile']> {
    const response = await this.request('settings/profile', { role: role || {}, taskOverride: taskOverride || {} })
    if (response.error || !response.result?.profile) throw new Error(response.error?.message || 'Pi Host profile failed')
    return response.result.profile
  }

  async getInstructions(): Promise<NonNullable<PiHostResponse['result']>['instructions']> {
    const response = await this.request('instructions/v1/get', {})
    if (response.error || !response.result?.instructions) throw new Error(response.error?.message || 'Instruction projection failed')
    return response.result.instructions
  }

  async saveInstructions(input: Record<string, unknown>): Promise<NonNullable<PiHostResponse['result']>['instructions']> {
    const response = await this.request('instructions/v1/save', input)
    if (response.error || !response.result?.instructions) throw new Error(response.error?.message || 'Instruction save failed')
    return response.result.instructions
  }

  async migrateLegacyInstructions(input: Record<string, unknown>): Promise<NonNullable<PiHostResponse['result']>> {
    const response = await this.request('instructions/v1/migrate-legacy', input)
    if (response.error || !response.result?.instructions || !response.result.instructionMigrationReport) throw new Error(response.error?.message || 'Legacy instruction migration failed')
    return response.result
  }

  async resolveInstructions(input: Record<string, unknown>): Promise<NonNullable<PiHostResponse['result']>['instructionSnapshot']> {
    const response = await this.request('instructions/v1/resolve', input)
    if (response.error || !response.result?.instructionSnapshot) throw new Error(response.error?.message || 'Instruction resolution failed')
    return response.result.instructionSnapshot
  }

  async authorizeInstructionInclude(target: string): Promise<readonly string[]> {
    const response = await this.request('instructions/v1/authorize-include', { target })
    if (response.error || !response.result?.authorizedIncludeTargets) throw new Error(response.error?.message || 'Instruction include authorization failed')
    return response.result.authorizedIncludeTargets
  }

  async writeProjectInstruction(input: Record<string, unknown>): Promise<NonNullable<PiHostResponse['result']>> {
    const response = await this.request('instructions/v1/project-write', input)
    if (response.error || !response.result?.projectInstructionWrite) {
      const error = new Error(response.error?.message || 'Project instruction write failed') as Error & {
        code?: ProjectInstructionWriteFailureCode
        details?: NonNullable<PiHostResponse['error']>
      }
      error.name = 'ProjectInstructionWriteError'
      if (response.error) {
        error.code = response.error.code as ProjectInstructionWriteFailureCode
        error.details = response.error
      }
      throw error
    }
    return response.result
  }

  async readProjectInstruction(input: Record<string, unknown>): Promise<NonNullable<PiHostResponse['result']>['projectInstructionRead']> {
    const response = await this.request('instructions/v1/project-read', input)
    if (response.error || !response.result?.projectInstructionRead) throw new Error(response.error?.message || 'Project instruction read failed')
    return response.result.projectInstructionRead
  }

  async exportInstructions(): Promise<NonNullable<PiHostResponse['result']>['instructionExport']> {
    const response = await this.request('instructions/v1/export', {})
    if (response.error || !response.result?.instructionExport) throw new Error(response.error?.message || 'Instruction export failed')
    return response.result.instructionExport
  }

  async previewInstructionImport(bundle: unknown): Promise<NonNullable<PiHostResponse['result']>['instructionImportPreview']> {
    const response = await this.request('instructions/v1/import-preview', { bundle })
    if (response.error || !response.result?.instructionImportPreview) throw new Error(response.error?.message || 'Instruction import preview failed')
    return response.result.instructionImportPreview
  }

  async applyInstructionImport(bundle: unknown, expectedRevision: number): Promise<NonNullable<PiHostResponse['result']>['instructions']> {
    const response = await this.request('instructions/v1/import-apply', { bundle, expectedRevision })
    if (response.error || !response.result?.instructions) throw new Error(response.error?.message || 'Instruction import failed')
    return response.result.instructions
  }

  async admitReviewWorkspace(input: {
    runId: string
    threadId: string
    projectRoot: string
    runnerKind: ReviewRunnerKind
  }): Promise<ReviewAdmissionSnapshot> {
    const response = await this.request('review/v1/admit', input)
    if (response.error || !response.result?.reviewAdmission) {
      throw new Error(response.error?.message || 'Run Review workspace admission failed')
    }
    return response.result.reviewAdmission
  }

  async finalizeReviewWorkspace(input: {
    snapshotId?: string
    runId?: string
    settlementKind: 'completed' | 'failed' | 'cancelled' | 'timeout' | 'crash'
    activeWorkspaceRuns?: number
  }): Promise<ReviewSnapshotRef> {
    const response = await this.request('review/v1/finalize', input)
    if (response.error || !response.result?.reviewSnapshotRef) {
      throw new Error(response.error?.message || 'Run Review snapshot finalization failed')
    }
    return response.result.reviewSnapshotRef
  }

  async readReviewArtifact(snapshotId: string): Promise<NonNullable<PiHostResponse['result']>['reviewArtifact']> {
    const response = await this.request('review/v1/read', { snapshotId })
    if (response.error || !response.result?.reviewArtifact) throw new Error(response.error?.message || 'Review artifact read failed')
    return response.result.reviewArtifact
  }

  async readReviewPayloadPage(input: { snapshotId: string; payloadId: string; offset?: number; maxBytes?: number }): Promise<NonNullable<PiHostResponse['result']>['reviewPayloadPage']> {
    const response = await this.request('review/v1/payload-page', input)
    if (response.error || !response.result?.reviewPayloadPage) throw new Error(response.error?.message || 'Review payload page failed')
    return response.result.reviewPayloadPage
  }

  async describeReviewTarget(target: import('../src/agent/reviewContract.ts').ReviewTarget): Promise<NonNullable<PiHostResponse['result']>['reviewTargetDescription']> {
    const response = await this.request('review/v1/describe', { target })
    if (response.error || !response.result?.reviewTargetDescription) throw new Error(response.error?.message || 'Review target description failed')
    return response.result.reviewTargetDescription
  }

  async listReviewFiles(input: { target: import('../src/agent/reviewContract.ts').ReviewTarget; cursor?: string; limit?: number; query?: string }): Promise<NonNullable<PiHostResponse['result']>['reviewFiles']> {
    const response = await this.request('review/v1/files', input)
    if (response.error || !response.result?.reviewFiles) throw new Error(response.error?.message || 'Review file listing failed')
    return response.result.reviewFiles
  }

  async readReviewFileDiff(input: { target: import('../src/agent/reviewContract.ts').ReviewTarget; path: string; cursor?: string; maxBytes?: number }): Promise<NonNullable<PiHostResponse['result']>['reviewDiff']> {
    const response = await this.request('review/v1/file-diff', input)
    if (response.error || !response.result?.reviewDiff) throw new Error(response.error?.message || 'Review diff read failed')
    return response.result.reviewDiff
  }

  async refreshReviewTarget(target: import('../src/agent/reviewContract.ts').ReviewTarget): Promise<NonNullable<PiHostResponse['result']>['reviewTargetDescription']> {
    const response = await this.request('review/v1/refresh', { target })
    if (response.error || !response.result?.reviewTargetDescription) throw new Error(response.error?.message || 'Review target refresh failed')
    return response.result.reviewTargetDescription
  }

  async listReviewComments(snapshotId: string) { const response = await this.request('review/v1/comments/list', { snapshotId }); if (response.error || !response.result?.reviewComments) throw new Error(response.error?.message || 'Review comments read failed'); return response.result.reviewComments }
  async saveReviewDraft(input: { id?: string; snapshotId: string; path: string; hunkId?: string; side?: 'old' | 'new'; line?: number; body: string }) { const response = await this.request('review/v1/draft/save', input); if (response.error || !response.result?.reviewComment) throw new Error(response.error?.message || 'Review draft save failed'); return response.result.reviewComment }
  async deleteReviewDraft(id: string) { const response = await this.request('review/v1/draft/delete', { id }); if (response.error) throw new Error(response.error.message) }
  async transitionReviewComment(id: string, status: import('../src/agent/reviewStateContract.ts').ReviewCommentStatus) { const response = await this.request('review/v1/comment/transition', { id, status }); if (response.error || !response.result?.reviewComment) throw new Error(response.error?.message || 'Review comment transition failed'); return response.result.reviewComment }
  async listReviewFileStates(snapshotId: string) { const response = await this.request('review/v1/file-state/list', { snapshotId }); if (response.error || !response.result?.reviewFileStates) throw new Error(response.error?.message || 'Review file states read failed'); return response.result.reviewFileStates }
  async markReviewFile(input: { snapshotId: string; path: string; contentHash: string }) { const response = await this.request('review/v1/file-state/mark', input); if (response.error || !response.result?.reviewFileState) throw new Error(response.error?.message || 'Review file state write failed'); return response.result.reviewFileState }
  async prepareReviewFeedback(snapshotId: string) { const response = await this.request('review/v1/feedback/prepare', { snapshotId }); if (response.error || !response.result?.reviewFeedbackBundle) throw new Error(response.error?.message || 'Review feedback prepare failed'); return response.result.reviewFeedbackBundle }
  async claimReviewFeedback(id: string, runId: string) { const response = await this.request('review/v1/feedback/claim', { id, runId }); if (response.error || !response.result?.reviewFeedbackBundle) throw new Error(response.error?.message || 'Review feedback claim failed'); return { bundle: response.result.reviewFeedbackBundle, claimed: response.result.reviewFeedbackClaimed === true } }
  async releaseReviewFeedback(id: string, runId: string) { const response = await this.request('review/v1/feedback/release', { id, runId }); if (response.error) throw new Error(response.error.message) }
  async inheritReviewState(fromSnapshotId: string, toSnapshotId: string) { const response = await this.request('review/v1/state/inherit', { fromSnapshotId, toSnapshotId }); if (response.error || !response.result?.reviewComments || !response.result.reviewFileStates) throw new Error(response.error?.message || 'Review state inheritance failed'); return { comments: response.result.reviewComments, fileStates: response.result.reviewFileStates } }
  async listReviewVerifications(snapshotId: string) { const response = await this.request('review/v1/verification/list', { snapshotId }); if (response.error || !response.result?.reviewVerifications) throw new Error(response.error?.message || 'Review verification listing failed'); return response.result.reviewVerifications }
  async runReviewVerification(snapshotId: string, kind: import('../src/agent/reviewVerificationContract.ts').ReviewVerificationKind) { const response = await this.request('review/v1/verification/run', { snapshotId, kind }); if (response.error || !response.result?.reviewVerification) throw new Error(response.error?.message || 'Review verification failed'); return response.result.reviewVerification }
  async readReviewVerificationOutput(input: { outputRef: string; offset?: number; maxBytes?: number }) { const response = await this.request('review/v1/verification/output', input); if (response.error || !response.result?.reviewVerificationOutput) throw new Error(response.error?.message || 'Review verification output failed'); return response.result.reviewVerificationOutput }
  async previewReviewMutation(intent: import('../src/agent/reviewMutationContract.ts').ReviewMutationIntent) { const response = await this.request('review/v1/mutation/preview', { intent }); if (response.error || !response.result?.reviewMutationPreview) throw new Error(response.error?.message || 'Review mutation preview failed'); return response.result.reviewMutationPreview }
  async applyReviewMutation(previewId: string) { const response = await this.request('review/v1/mutation/apply', { previewId }); if (response.error || !response.result?.reviewMutationReceipt) throw new Error(response.error?.message || 'Review mutation apply failed'); return response.result.reviewMutationReceipt }
  async previewReviewDelivery(intent: import('../src/agent/reviewDeliveryContract.ts').ReviewDeliveryIntent) { const response = await this.request('review/v1/delivery/preview', { intent }); if (response.error || !response.result?.reviewDeliveryPreview) throw new Error(response.error?.message || 'Review delivery preview failed'); return response.result.reviewDeliveryPreview }
  async applyReviewDelivery(previewId: string) { const response = await this.request('review/v1/delivery/apply', { previewId }); if (response.error || !response.result?.reviewDeliveryReceipt) throw new Error(response.error?.message || 'Review delivery apply failed'); return response.result.reviewDeliveryReceipt }
  async exportReviewArtifact(snapshotId: string) { const response = await this.request('review/v1/artifact/export', { snapshotId }); if (response.error || !response.result?.reviewArtifactExport) throw new Error(response.error?.message || 'Review artifact export failed'); return response.result.reviewArtifactExport }
  async previewReviewArtifactImport(bundle: unknown) { const response = await this.request('review/v1/artifact/import-preview', { bundle }); if (response.error || !response.result?.reviewArtifactImportPreview) throw new Error(response.error?.message || 'Review artifact import preview failed'); return response.result.reviewArtifactImportPreview }
  async applyReviewArtifactImport(bundle: unknown, expectedBundleHash: string) { const response = await this.request('review/v1/artifact/import-apply', { bundle, expectedBundleHash }); if (response.error || !response.result?.reviewArtifact) throw new Error(response.error?.message || 'Review artifact import failed'); return response.result.reviewArtifact }
  async rebindReviewArtifact(snapshotId: string, projectRoot: string) { const response = await this.request('review/v1/artifact/rebind', { snapshotId, projectRoot }); if (response.error || !response.result?.reviewArtifact) throw new Error(response.error?.message || 'Review artifact rebind failed'); return response.result.reviewArtifact }
  async applyReviewArtifactRetention(input: { retainedSnapshotIds: string[]; reason: string; olderThan?: string }) { const response = await this.request('review/v1/artifact/retention', input); if (response.error || !response.result?.reviewArtifactRetention) throw new Error(response.error?.message || 'Review artifact retention failed'); return response.result.reviewArtifactRetention }
  async hardDeleteReviewArtifact(snapshotId: string) { const response = await this.request('review/v1/artifact/hard-delete', { snapshotId }); if (response.error || response.result?.reviewArtifactHardDeleted !== true) throw new Error(response.error?.message || 'Review artifact hard delete failed') }

  async createSession(title?: string, threadId?: string): Promise<NonNullable<PiHostResponse['result']>> {
    const response = await this.request('sessions/create', {
      ...(title ? { title } : {}),
      ...(threadId ? { threadId } : {}),
    })
    if (response.error || !response.result?.sessionId) throw new Error(response.error?.message || 'Pi session creation failed')
    return response.result
  }

  /** One bounded page of a session's Turn Record, addressed by `seq`. */
  async readSessionRecord(sessionId: string, before?: number, limit?: number): Promise<NonNullable<PiHostResponse['result']>['page']> {
    const response = await this.request('sessions/record', {
      sessionId,
      ...(before === undefined ? {} : { before }),
      ...(limit === undefined ? {} : { limit }),
    })
    if (response.error || !response.result?.page) throw new Error(response.error?.message || 'Pi record page failed')
    return response.result.page
  }

  async listSessions(): Promise<NonNullable<PiHostResponse['result']>['sessions']> {
    const response = await this.request('sessions/list', {})
    if (response.error || !response.result?.sessions) throw new Error(response.error?.message || 'Pi session listing failed')
    return response.result.sessions
  }

  async listAgentTree(scope: { rootAgentId?: string; agentId?: string }): Promise<AgentTreeSnapshot> {
    const response = await this.request('agents/list', scope)
    if (response.error || !response.result?.rootAgentId || !response.result.agents) {
      throw new Error(response.error?.message || 'Pi agent tree listing failed')
    }
    return {
      rootAgentId: response.result.rootAgentId,
      ...(response.result.selectedAgentId ? { selectedAgentId: response.result.selectedAgentId } : {}),
      agents: response.result.agents,
    }
  }

  async communicateWithAgent(
    method: Extract<PiHostRequest['method'], `agents/${string}`>,
    input: Record<string, unknown>,
  ): Promise<NonNullable<PiHostResponse['result']>> {
    const response = await this.request(method, input)
    if (response.error || !response.result) throw new Error(response.error?.message || `Pi ${method} failed`)
    return response.result
  }

  async listQueuedRuns(): Promise<NonNullable<PiHostResponse['result']>['queue']> {
    const response = await this.request('runs/list', {})
    if (response.error || !response.result?.queue) throw new Error(response.error?.message || 'Pi queue listing failed')
    return response.result.queue
  }

  async listActiveRuns(): Promise<NonNullable<PiHostResponse['result']>['activeRuns']> {
    const result = await this.listAttachmentRuns()
    return result.activeRuns
  }

  async listAttachmentRuns(): Promise<{
    activeRuns: NonNullable<PiHostResponse['result']>['activeRuns']
    terminalRuns: NonNullable<PiHostResponse['result']>['terminalRuns']
  }> {
    const response = await this.request('runs/active', {})
    if (response.error || !response.result?.activeRuns) throw new Error(response.error?.message || 'Pi attachment query failed')
    return { activeRuns: response.result.activeRuns, terminalRuns: response.result.terminalRuns || [] }
  }

  async attachRun(runId: string, before?: number, limit?: number): Promise<NonNullable<PiHostResponse['result']>['page']> {
    const response = await this.request('runs/attach', { runId, ...(before === undefined ? {} : { before }), ...(limit === undefined ? {} : { limit }) })
    if (response.error) throw new Error(response.error.message)
    return response.result?.page
  }

  /** Atomically reserve Host terminal app-finalization for one renderer instance. */
  async claimRunFinalization(runId: string, claimantId: string, leaseMs?: number): Promise<PiHostFinalizationClaimResult> {
    const response = await this.request('runs/finalize-claim', {
      runId,
      claimantId,
      ...(leaseMs === undefined ? {} : { leaseMs }),
    })
    if (response.error || !response.result?.finalizationClaim) throw new Error(response.error?.message || 'Pi Host finalization claim failed')
    return response.result.finalizationClaim
  }

  /** Commit the durable claim after the coordinator-owned effects complete. */
  async completeRunFinalization(
    runId: string,
    claimantId: string,
    claimEpoch: number,
    finalOutcome: RunLearningFinalOutcome,
  ): Promise<PiHostFinalizationCompleteResult> {
    const response = await this.request('runs/finalize-complete', { runId, claimantId, claimEpoch, finalOutcome })
    if (response.error || !response.result?.finalizationComplete) throw new Error(response.error?.message || 'Pi Host finalization completion failed')
    return response.result.finalizationComplete
  }

  async acknowledgeRun(runId: string): Promise<boolean> {
    const response = await this.request('runs/ack', { runId })
    if (response.error) throw new Error(response.error.message)
    return response.result?.resolved === true
  }

  async enqueueRun(input: Record<string, unknown>): Promise<NonNullable<PiHostResponse['result']>['queue']> {
    const response = await this.request('runs/enqueue', input)
    if (response.error || !response.result?.queue) throw new Error(response.error?.message || 'Pi queue admission failed')
    return response.result.queue
  }

  async cancelQueuedRun(runId: string, expectedRevision?: number): Promise<NonNullable<PiHostResponse['result']>> {
    const response = await this.request('runs/cancel', { runId, ...(expectedRevision === undefined ? {} : { expectedRevision }) })
    if (response.error || !response.result?.queue) throw new Error(response.error?.message || 'Pi queued run cancellation failed')
    return response.result
  }

  async updateQueuedRun(input: { runId: string; prompt: string; expectedRevision: number }): Promise<NonNullable<PiHostResponse['result']>> {
    const response = await this.request('runs/update', input)
    if (response.error || !response.result?.queue) throw new Error(response.error?.message || 'Pi queued run update failed')
    return response.result
  }

  async reorderQueuedRuns(input: { sessionId: string; runIds: string[]; expectedRevision: number }): Promise<NonNullable<PiHostResponse['result']>> {
    const response = await this.request('runs/reorder', input)
    if (response.error || !response.result?.queue) throw new Error(response.error?.message || 'Pi queued run reorder failed')
    return response.result
  }

  async claimQueuedRun(runId?: string): Promise<NonNullable<PiHostResponse['result']>> {
    const response = await this.request('runs/claim', runId ? { runId } : {})
    if (response.error || !response.result?.runId && !response.result?.queue) throw new Error(response.error?.message || 'Pi queue claim failed')
    return response.result
  }

  async settleQueuedRun(runId: string, settlement: PiTurnSettlement): Promise<NonNullable<PiHostResponse['result']>> {
    const response = await this.request('runs/settle', { runId, settlement })
    if (response.error || !response.result?.queue) throw new Error(response.error?.message || 'Pi queue settlement failed')
    return response.result
  }

  async listResources(): Promise<NonNullable<PiHostResponse['result']>['resources']> {
    const response = await this.request('resources/list', {})
    if (response.error || !response.result?.resources) throw new Error(response.error?.message || 'Pi resource listing failed')
    return response.result.resources
  }

  async listPackages(): Promise<{
    packages: NonNullable<NonNullable<PiHostResponse['result']>['packages']>
    diagnostics: NonNullable<NonNullable<PiHostResponse['result']>['packageDiagnostics']>
  }> {
    const response = await this.request('packages/list', {})
    if (response.error || !response.result?.packages) throw new Error(response.error?.message || 'Pi package listing failed')
    return {
      packages: response.result.packages,
      diagnostics: response.result.packageDiagnostics || [],
    }
  }

  async reloadResources(resources: unknown[]): Promise<NonNullable<PiHostResponse['result']>['resources']> {
    const response = await this.request('resources/reload', { resources })
    if (response.error || !response.result?.resources) throw new Error(response.error?.message || 'Pi resource reload failed')
    return response.result.resources
  }

  private async durableMemoryRequest(
    method: 'memory/v1/upsert' | 'memory/v1/append' | 'memory/v1/get' | 'memory/v1/list' | 'memory/v1/recall' | 'memory/v1/delete' | 'memory/v1/clear' | 'memory/v1/delete-entry' | 'memory/v1/clear-project' | 'memory/v1/clear-global' | 'memory/v1/clear-all' | 'memory/v1/deletion-capability' | 'memory/v1/consolidate-dream' | 'memory/v1/export' | 'memory/v1/import-preview' | 'memory/v1/import-apply',
    params: Record<string, unknown>,
    operation: DurableMemoryProtocolResult['operation'],
  ): Promise<DurableMemoryProtocolResult> {
    const response = await this.request(method, params)
    const result = response.result?.memoryStore
    if (response.error || !result || result.version !== 1 || result.operation !== operation) {
      throw new Error(response.error?.message || `Pi durable memory ${operation} failed`)
    }
    return result
  }

  async upsertDurableMemory(input: MemoryUpsertInput): Promise<DurableMemoryProtocolResult> {
    const { access, ...entry } = input
    return this.durableMemoryRequest('memory/v1/upsert', { access, entry }, 'upsert')
  }

  async appendDurableMemory(input: MemoryAppendInput): Promise<DurableMemoryProtocolResult> {
    const { access, ...entry } = input
    return this.durableMemoryRequest('memory/v1/append', { access, entry }, 'append')
  }

  async getDurableMemory(input: MemoryGetInput): Promise<DurableMemoryProtocolResult> {
    return this.durableMemoryRequest('memory/v1/get', input, 'get')
  }

  async listDurableMemory(input: MemoryListInput): Promise<DurableMemoryProtocolResult> {
    return this.durableMemoryRequest('memory/v1/list', input, 'list')
  }

  async recallDurableMemory(input: MemoryRecallInput): Promise<DurableMemoryProtocolResult> {
    return this.durableMemoryRequest('memory/v1/recall', input, 'recall')
  }

  async deleteDurableMemory(input: MemoryDeleteInput): Promise<DurableMemoryProtocolResult> {
    return this.durableMemoryRequest('memory/v1/delete', input, 'delete')
  }

  async clearDurableMemory(input: MemoryClearInput): Promise<DurableMemoryProtocolResult> {
    return this.durableMemoryRequest('memory/v1/clear', input, 'clear')
  }

  async deleteDurableMemoryEntry(input: MemoryDeleteInput): Promise<DurableMemoryProtocolResult> {
    return this.durableMemoryRequest('memory/v1/delete-entry', input, 'delete-entry')
  }

  async clearProjectDurableMemory(input: { access: MemoryAccessContext; project: CanonicalProjectId }): Promise<DurableMemoryProtocolResult> {
    return this.durableMemoryRequest('memory/v1/clear-project', input, 'clear-project')
  }

  async clearGlobalDurableMemory(access: MemoryAccessContext): Promise<DurableMemoryProtocolResult> {
    return this.durableMemoryRequest('memory/v1/clear-global', { access }, 'clear-global')
  }

  async clearAllDurableMemory(access: MemoryAccessContext): Promise<DurableMemoryProtocolResult> {
    return this.durableMemoryRequest('memory/v1/clear-all', { access }, 'clear-all')
  }

  async durableMemoryDeletionCapability(access: MemoryAccessContext): Promise<DurableMemoryProtocolResult> {
    return this.durableMemoryRequest('memory/v1/deletion-capability', { access }, 'deletion-capability')
  }

  async consolidateDreamDurableMemory(input: MemoryDreamConsolidateInput): Promise<DurableMemoryProtocolResult> {
    return this.durableMemoryRequest('memory/v1/consolidate-dream', input, 'consolidate-dream')
  }

  async exportDurableMemory(access: MemoryAccessContext): Promise<DurableMemoryProtocolResult> {
    return this.durableMemoryRequest('memory/v1/export', { access }, 'export')
  }

  async previewMemoryImport(input: MemoryImportPreviewInput): Promise<DurableMemoryProtocolResult> {
    return this.durableMemoryRequest('memory/v1/import-preview', input, 'import-preview')
  }

  async applyMemoryImport(input: MemoryImportApplyInput): Promise<DurableMemoryProtocolResult> {
    return this.durableMemoryRequest('memory/v1/import-apply', input, 'import-apply')
  }

  async listCapabilities(): Promise<NonNullable<PiHostResponse['result']>['items']> {
    const response = await this.request('capabilities/list', {})
    if (response.error || !response.result?.items) throw new Error(response.error?.message || 'Pi capability listing failed')
    return response.result.items
  }

  async loadCapability(id: string): Promise<NonNullable<PiHostResponse['result']>> {
    const response = await this.request('capabilities/load', { id })
    if (response.error || !response.result?.loaded) throw new Error(response.error?.message || 'Pi capability load failed')
    return response.result
  }

  async searchCapabilities(query: string): Promise<NonNullable<PiHostResponse['result']>['items']> {
    const response = await this.request('capabilities/search', { query })
    if (response.error || !response.result?.items) throw new Error(response.error?.message || 'Pi capability search failed')
    return response.result.items
  }

  async listExtensions(): Promise<NonNullable<PiHostResponse['result']>['extensions']> {
    const response = await this.request('extensions/list', {})
    if (response.error || !response.result?.extensions) throw new Error(response.error?.message || 'Pi extension listing failed')
    return response.result.extensions
  }

  async mutateExtension(method: 'extensions/install' | 'extensions/update' | 'extensions/reload' | 'extensions/set-enabled' | 'extensions/uninstall', params: Record<string, unknown>): Promise<NonNullable<PiHostResponse['result']>> {
    const response = await this.request(method, params)
    if (response.error || (!response.result?.extension && method !== 'extensions/uninstall')) throw new Error(response.error?.message || 'Pi extension operation failed')
    return response.result || {}
  }

  async forkSession(sessionId: string): Promise<NonNullable<PiHostResponse['result']>> {
    const response = await this.request('sessions/fork', { sessionId })
    if (response.error || !response.result?.sessionId) throw new Error(response.error?.message || 'Pi session fork failed')
    return response.result
  }

  async resetSession(sessionId: string): Promise<NonNullable<PiHostResponse['result']>> {
    const response = await this.request('sessions/reset', { sessionId })
    if (response.error || !response.result?.sessionId) throw new Error(response.error?.message || 'Pi session reset failed')
    return response.result
  }

  async archiveSession(sessionId: string): Promise<NonNullable<PiHostResponse['result']>> {
    const response = await this.request('sessions/archive', { sessionId })
    if (response.error || !response.result?.sessionId) throw new Error(response.error?.message || 'Pi session archive failed')
    return response.result
  }

  async compactSession(sessionId: string): Promise<NonNullable<PiHostResponse['result']>> {
    const response = await this.request('sessions/compact', { sessionId })
    if (response.error || !response.result?.sessionId) throw new Error(response.error?.message || 'Pi session compaction failed')
    return response.result
  }

  async executeTool(tool: 'read' | 'grep' | 'find' | 'ls' | 'write' | 'edit' | 'bash' | 'code' | 'mcp', params: Record<string, unknown>): Promise<NonNullable<PiHostResponse['result']>> {
    const response = await this.request(`tools/${tool}`, params)
    if (response.error || !response.result?.tool) throw new Error(response.error?.message || `Pi ${tool} failed`)
    return response.result
  }

  async listTools(): Promise<string[]> {
    const response = await this.request('tools/list', {})
    if (response.error || !response.result?.builtinTools) throw new Error(response.error?.message || 'Pi tool listing failed')
    return response.result.builtinTools
  }

  /** The full catalog projection: every entry carries its own availability fact. */
  async listCatalog(): Promise<NonNullable<PiHostResponse['result']>['catalog']> {
    const response = await this.request('tools/list', { requireContract: true })
    if (response.error || !response.result?.catalog) throw new Error(response.error?.message || 'Pi tool catalog is unavailable')
    return response.result.catalog
  }

  /** One pack tool execution through the shared approval gate. */
  async callPackTool(name: string, args: Record<string, unknown>, options: { cwd?: string; sessionId?: string; runId?: string; callId?: string; approval?: 'allow' | 'deny' } = {}): Promise<NonNullable<PiHostResponse['result']>> {
    const response = await this.request('tools/pack', { name, arguments: args, ...(options.cwd ? { cwd: options.cwd } : {}), ...(options.sessionId ? { sessionId: options.sessionId } : {}), ...(options.runId ? { runId: options.runId } : {}), ...(options.callId ? { callId: options.callId } : {}), ...(options.approval ? { approval: options.approval } : {}) })
    if (response.error) throw new Error(response.error.message)
    return response.result ?? {}
  }

  /** Sync renderer skills into the Host-owned skills directory; per-skill results come back. */
  /** Read the Host skills directory back out for renderer hydration. */
  async readSkillFiles(projectRoot?: string): Promise<{ files: import('./piSkills.ts').PiSkillCatalogFile[]; diagnostics: Array<{ path: string; message: string }> }> {
    const response = await this.request('resources/read-skill-files', projectRoot ? { projectRoot } : {})
    const result = response.result as { files?: import('./piSkills.ts').PiSkillCatalogFile[]; skillDiagnostics?: Array<{ path: string; message: string }> } | undefined
    return {
      files: Array.isArray(result?.files) ? result.files : [],
      diagnostics: Array.isArray(result?.skillDiagnostics) ? result.skillDiagnostics : [],
    }
  }

  async syncSkills(skills: Array<{ name?: string; description?: string; body?: string; status?: string }>): Promise<{ skillsDir: string; results: Array<{ name: string; ok: boolean; status?: string; filePath?: string; slug?: string; error?: string }> }> {
    const response = await this.request('resources/sync-skills', { skills })
    if (response.error || !response.result?.report) throw new Error(response.error?.message || 'Pi skill sync failed')
    return response.result.report as { skillsDir: string; results: Array<{ name: string; ok: boolean; status?: string; filePath?: string; slug?: string; error?: string }> }
  }

  /** Answer a pending in-turn HITL ask raised by an extension tool. */
  async resolveApproval(input: { runId: string; callId: string; decision: 'allow' | 'deny'; answer?: string }): Promise<boolean> {
    const response = await this.request('approvals/resolve', input)
    if (response.error) throw new Error(response.error.message)
    return true
  }

  async submitTurn(sessionId: string, prompt: string, runId?: string, cwd?: string, profile?: Record<string, unknown>, orchestration?: { contextPolicy?: Record<string, unknown>; pattern?: string; maxIterations?: number; definitionOfDone?: string; timeoutMs?: number; mode?: 'steer' | 'queue'; queue?: boolean; clientMessageId?: string; expectedActiveRunId?: string; pluginExecution?: unknown }): Promise<NonNullable<PiHostResponse['result']>> {
    const response = await this.request('turn/submit', { sessionId, prompt, ...(runId ? { runId } : {}), ...(cwd ? { cwd } : {}), ...(profile ? { profile } : {}), ...(orchestration || {}) })
    if (response.error || !response.result?.settlement) throw new Error(response.error?.message || 'Pi turn failed')
    return response.result
  }

  async cancelTurn(runId: string): Promise<NonNullable<PiHostResponse['result']>> {
    const response = await this.request('turn/cancel', { runId })
    if (response.error || response.result?.settlement !== 'cancelled') throw new Error(response.error?.message || 'Pi turn cancellation failed')
    return response.result
  }

  /**
   * Ask a turn to park at its next tool boundary.
   *
   * Unlike `cancelTurn` this never severs a tool that is already running, so a
   * write or a shell command completes and reports its own evidence.
   */
  async interruptTurn(runId: string, reason: 'user' | 'timeout' = 'user'): Promise<NonNullable<PiHostResponse['result']>> {
    const response = await this.request('turn/interrupt', { runId, reason })
    if (response.error || response.result?.settlement !== 'interrupted') throw new Error(response.error?.message || 'Pi turn interrupt failed')
    return response.result
  }

  async stop(timeoutMs = 6_000): Promise<{ clean: boolean; message?: string }> {
    this.stopping = true
    if (this.restartTimer) {
      clearTimeout(this.restartTimer)
      this.restartTimer = undefined
    }
    const child = this.child
    let clean = !child
    let message: string | undefined
    if (child) {
      let timer: ReturnType<typeof setTimeout> | undefined
      try {
        const response = await Promise.race([
          this.request('lifecycle/shutdown', {}),
          new Promise<never>((_, reject) => {
            timer = setTimeout(() => reject(new Error(`Pi Core Host shutdown timed out after ${timeoutMs}ms`)), Math.max(1, timeoutMs))
          }),
        ])
        if (response.error || response.result?.memoryHealth?.status !== 'closed') {
          throw new Error(response.error?.message || 'Pi Core Host memory storage did not confirm close')
        }
        clean = true
      } catch (error) {
        message = error instanceof Error ? error.message : String(error)
      } finally {
        if (timer) clearTimeout(timer)
      }
    }
    for (const waiter of this.pending.values()) {
      if (waiter.timer) clearTimeout(waiter.timer)
      waiter.reject(new Error(message || 'Pi Core Host stopped'))
    }
    this.pending.clear()
    child?.kill()
    this.child = null
    this.statusValue = { state: 'stopped' }
    return { clean, ...(message ? { message } : {}) }
  }

  private scheduleRestart(): void {
    if (this.stopping || this.restartTimer || this.restartAttempts >= 3) return
    const attempt = this.restartAttempts
    this.restartAttempts += 1
    const delayMs = Math.min(100 * (2 ** attempt), 2_000)
    this.restartTimer = setTimeout(() => {
      this.restartTimer = undefined
      if (this.stopping || this.statusValue.state !== 'crashed') return
      void this.start().catch(() => this.scheduleRestart())
    }, delayMs)
  }

  private request(method: PiHostRequest['method'], params: Record<string, unknown>): Promise<PiHostResponse> {
    const child = this.child
    if (!child) {
      return Promise.reject(new Error(this.statusValue.state === 'error' ? this.statusValue.message : 'Pi Core Host is not running'))
    }
    const id = this.nextRequestId++
    return new Promise((resolve, reject) => {
      const timeoutMs = method === 'turn/submit' || method === 'review/v1/verification/run' ? this.turnIdleTimeoutMs : this.requestTimeoutMs
      const waiter: PendingRequest = {
        resolve,
        reject,
        method,
        runId: typeof params.runId === 'string' ? params.runId : undefined,
        baseTimeoutMs: timeoutMs,
        timeoutMs,
      }
      this.pending.set(id, waiter)
      this.armDeadline(id, waiter)
      child.postMessage({ id, method, params })
    })
  }

  private armDeadline(id: string | number, waiter: PendingRequest): void {
    if (waiter.timer) clearTimeout(waiter.timer)
    waiter.timer = setTimeout(() => {
      if (this.pending.get(id) !== waiter) return
      this.pending.delete(id)
      waiter.reject(new Error(`Pi Core Host ${waiter.method} timed out after ${waiter.timeoutMs}ms`))
      if (waiter.method === 'turn/submit' && waiter.runId && this.child) {
        this.child.postMessage({
          id: this.nextRequestId++,
          method: 'turn/cancel',
          params: { runId: waiter.runId },
        })
      }
    }, waiter.timeoutMs)
  }

  private refreshTurnDeadline(runId: string, idleLeaseMs?: unknown, restoreBase = false): void {
    for (const [id, waiter] of this.pending) {
      if (waiter.method !== 'turn/submit' || waiter.runId !== runId) continue
      if (restoreBase) waiter.timeoutMs = waiter.baseTimeoutMs
      else {
        const lease = clampTurnTimeout(idleLeaseMs)
        if (lease) waiter.timeoutMs = Math.max(waiter.baseTimeoutMs, lease)
      }
      this.armDeadline(id, waiter)
    }
  }
}

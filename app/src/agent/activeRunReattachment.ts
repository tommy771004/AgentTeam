import { getJournalEntry, recordRecoveryNotice } from './runJournal.ts'
import { emptyAgentLike } from './localCliRun.ts'
import { isPiTurnSettlement, piTurnOutcome } from './piHostRun.ts'
import { reconcileReattach } from './reattachReconcile.ts'
import { recordAppendFromEvent } from './liveTimeline.ts'
import { markRunRegistryReconciled, useAgentStore } from '../store/agentStore.ts'
import { useRunActivityStore } from '../store/runActivityStore.ts'
import { useThreadStore } from '../store/threadStore.ts'
import type { AgentState } from './types.ts'
import type { TurnRecordEntry } from './turnRecord.ts'

export type PiHostAttachmentProjection = {
  runId: string
  sessionId: string
  threadId?: string
  status: 'active' | 'terminal'
  latestSeq: number
  total: number
  settlement?: string
  interruptReason?: 'user' | 'timeout'
  summary?: string
  pendingApproval?: {
    runId: string
    sessionId?: string
    tool: string
    callId: string
    args?: Record<string, unknown>
    reason?: string
    timeoutMs: number
  }
}

type HostTruth = { activeRunIds: Set<string>; terminalRunIds: Set<string> }
type RunsBridge = NonNullable<NonNullable<typeof window.subagents>['piHost']>['runs']
type PendingFinalization = { runId: string; threadId: string; objective: string; agent: AgentState }
type AttachmentPage = Awaited<ReturnType<RunsBridge['attach']>>['page']

const reattachedApprovalKeys = new Set<string>()

export function presentReattachedApproval(
  pending: PiHostAttachmentProjection['pendingApproval'],
  threadId?: string,
): void {
  if (!pending?.runId || !pending.callId) return
  const key = `${pending.runId}:${pending.callId}`
  if (reattachedApprovalKeys.has(key)) return
  reattachedApprovalKeys.add(key)
  void resolveReattachedApproval(pending, threadId)
}

async function resolveReattachedApproval(
  pending: NonNullable<PiHostAttachmentProjection['pendingApproval']>,
  threadId?: string,
): Promise<void> {
  try {
    const { usePermissionAskStore } = await import('../store/permissionAskStore.ts')
    const outcome = await usePermissionAskStore.getState().requestAsk({
      threadId,
      runId: pending.runId,
      tool: pending.tool,
      args: pending.args || {},
      reason: pending.reason,
      timeoutMs: pending.timeoutMs,
    })
    await window.subagents?.piHost?.approvals?.resolve?.({
      runId: pending.runId,
      callId: pending.callId,
      decision: outcome.decision,
      ...(outcome.answer ? { answer: outcome.answer } : {}),
    })
  } catch {
    // A transport failure leaves the Host's own approval timeout in charge.
  }
}

function attachmentOutcome(attachment: PiHostAttachmentProjection) {
  if (!isPiTurnSettlement(attachment.settlement)) return undefined
  return piTurnOutcome(attachment.settlement, {
    answer: attachment.summary || '',
    interruptReason: attachment.interruptReason,
  })
}

function piHostAttachmentAgent(
  attachment: PiHostAttachmentProjection,
  entries: readonly TurnRecordEntry[],
  objective: string,
): AgentState {
  const outcome = attachmentOutcome(attachment)
  const active = attachment.status === 'active'
  const status = active ? 'running' : outcome?.status || 'failed'
  return emptyAgentLike({
    id: attachment.runId,
    objective,
    status,
    progress: active ? 15 : 100,
    result: outcome?.text,
    haltReason: outcome?.status === 'failed' ? outcome.text : undefined,
    interruptReason: outcome?.interruptReason,
    turnRecord: entries.length ? { version: 1, entries: [...entries] } : undefined,
    loopConfig: {
      loopType: 'Goal-based',
      trigger: 'pi-host',
      executionSequence: ['pi-host-turn'],
      definitionOfDone: '',
      maxIterations: 1,
      fallbackProtocol: '',
      nextState: 'Halt',
    },
    steps: [{
      step: 1,
      action: 'pi-host-turn',
      description: 'Pi Core Host turn',
      status: active ? 'IN_PROGRESS' : outcome?.stepStatus || 'FAILED',
      result: outcome?.text,
      modelSource: 'primary',
    }],
    logs: [{
      id: `pi-reattach-${attachment.runId}`,
      timestamp: new Date().toISOString(),
      level: active ? 'PROCESS' : outcome?.logLevel || 'ERROR',
      message: active ? 'Pi Core Host 執行中（renderer reattached）' : `Pi Core Host settlement=${attachment.settlement || 'failed'}`,
    }],
    executionKind: 'loop',
  })
}

function uniqueAttachments(activeRuns: PiHostAttachmentProjection[], terminalRuns: PiHostAttachmentProjection[]): PiHostAttachmentProjection[] {
  return [...new Map([...activeRuns, ...terminalRuns].map((record) => [record.runId, record])).values()]
}

async function readAttachmentPage(runs: RunsBridge, attachment: PiHostAttachmentProjection) {
  try {
    const result = await runs.attach(attachment.runId, undefined, 200)
    return {
      page: result?.page,
      attachment: result?.attachment ? { ...attachment, ...result.attachment } : attachment,
    }
  } catch {
    return { page: undefined, attachment }
  }
}

function reconcileAttachmentEntries(
  attachment: PiHostAttachmentProjection,
  page: AttachmentPage | undefined,
  buffered: readonly TurnRecordEntry[],
  observed: { recordEntries: TurnRecordEntry[]; recordTotal: number } | undefined,
) {
  return reconcileReattach({
    snapshot: {
      entries: page?.entries || [],
      latestSeq: Math.max(attachment.latestSeq || 0, page?.latestSeq || 0),
      total: Math.max(attachment.total || 0, page?.total || 0),
      ...(page?.gap ? { unloadedBefore: page.gap.missingBefore } : {}),
    },
    buffered,
    generation: 1,
    currentGeneration: 1,
    observed: {
      latestSeq: observed?.recordEntries.at(-1)?.seq || 0,
      total: observed?.recordTotal || 0,
    },
  })
}

function projectRestoredActivity(
  runId: string,
  page: AttachmentPage | undefined,
  snapshot: PiHostAttachmentProjection,
  reconciled: ReturnType<typeof reconcileReattach>,
): void {
  const activity = useRunActivityStore.getState()
  if (page) {
    activity.reattachRecord({
      entries: reconciled.entries,
      total: reconciled.total,
      latestSeq: reconciled.latestSeq,
      gap: reconciled.gap,
    }, runId)
    return
  }
  activity.setReattaching(false, runId, snapshot.status === 'active' ? 'Pi Core Host 執行中…' : undefined)
}

async function restoreAttachment(
  runs: RunsBridge,
  attachment: PiHostAttachmentProjection,
  buffered: Map<string, TurnRecordEntry[]>,
): Promise<PendingFinalization | undefined> {
  if (!attachment?.runId || !attachment.threadId) return undefined
  const objective = getJournalEntry('run', attachment.runId)?.objective || 'Pi Core Host 執行中的任務'
  const activity = useRunActivityStore.getState()
  activity.begin(attachment.runId, attachment.threadId)
  activity.setReattaching(true, attachment.runId)
  const { page, attachment: snapshot } = await readAttachmentPage(runs, attachment)
  const observed = activity.getPresentation(attachment.runId)
  const reconciled = reconcileAttachmentEntries(
    snapshot,
    page,
    buffered.get(attachment.runId) || [],
    observed ?? undefined,
  )
  const state = piHostAttachmentAgent(snapshot, reconciled.entries, objective)
  const restored = useAgentStore.getState().restoreRun({ runId: attachment.runId, threadId: attachment.threadId, state })
  if (!restored) throw new Error(`renderer run registry restore failed: ${attachment.runId}`)
  const thread = useThreadStore.getState()
  thread.setThreadRunning(attachment.threadId, true, attachment.runId)
  thread.setAwaitingReply(attachment.threadId, false)
  thread.setThreadStatus(attachment.threadId, 'running')
  projectRestoredActivity(attachment.runId, page, snapshot, reconciled)
  buffered.delete(attachment.runId)
  presentReattachedApproval(snapshot.pendingApproval, snapshot.threadId)
  return snapshot.status === 'terminal'
    ? { runId: attachment.runId, threadId: attachment.threadId, objective, agent: state }
    : undefined
}

function finalizeTerminalAttachments(runs: RunsBridge, pending: PendingFinalization[]): void {
  if (pending.length === 0) return
  void import('./taskRunCoordinator.ts')
    .then(({ finalizeRecoveredPiHostRun, isPiFinalizationAckable }) => Promise.all(
      pending.map(async (item) => {
        try {
          await finalizeRecoveredPiHostRun(item)
        } catch {
          // Claim/finalization transport errors leave the Host attachment pending.
        }
        if (isPiFinalizationAckable(item.runId)) await runs.ack(item.runId).catch(() => undefined)
      }),
    ))
    .catch(() => undefined)
}

function subscribeDuringAttach(
  buffered: Map<string, TurnRecordEntry[]>,
  attached: Set<string>,
): (() => void) | undefined {
  return window.subagents?.piHost?.onEvent?.((event) => {
    const appended = recordAppendFromEvent(event as { event?: unknown; payload?: unknown })
    if (!appended) return
    if (attached.has(appended.runId)) {
      useRunActivityStore.getState().appendRecordEntries(appended.entries, appended.runId)
      return
    }
    buffered.set(appended.runId, [...(buffered.get(appended.runId) || []), ...appended.entries])
  })
}

export async function reattachPiHostRuns(
  setUnsubscribe: (unsubscribe: (() => void) | undefined) => void,
): Promise<HostTruth | null | undefined> {
  const runs = window.subagents?.piHost?.runs
  if (!runs?.active) {
    markRunRegistryReconciled()
    return undefined
  }
  const buffered = new Map<string, TurnRecordEntry[]>()
  const attached = new Set<string>()
  setUnsubscribe(subscribeDuringAttach(buffered, attached))
  try {
    const result = await runs.active()
    const activeRuns = Array.isArray(result?.activeRuns) ? result.activeRuns as PiHostAttachmentProjection[] : []
    const terminalRuns = Array.isArray(result?.terminalRuns) ? result.terminalRuns as PiHostAttachmentProjection[] : []
    const pending: PendingFinalization[] = []
    for (const attachment of uniqueAttachments(activeRuns, terminalRuns)) {
      const finalization = await restoreAttachment(runs, attachment, buffered)
      attached.add(attachment.runId)
      if (finalization) pending.push(finalization)
    }
    markRunRegistryReconciled()
    finalizeTerminalAttachments(runs, pending)
    return {
      activeRunIds: new Set(activeRuns.map((record) => record.runId).filter(Boolean)),
      terminalRunIds: new Set(terminalRuns.map((record) => record.runId).filter(Boolean)),
    }
  } catch (error) {
    recordRecoveryNotice({
      kind: 'run',
      id: 'pi-host-reattach',
      action: 'quarantined',
      detail: `Pi Host reattach query failed，admission remains locked：${error instanceof Error ? error.message : String(error)}`.slice(0, 300),
    })
    return null
  }
}

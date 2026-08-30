import { randomUUID } from 'node:crypto'
import {
  AGENT_MAILBOX_MAX_MESSAGES,
  AGENT_MESSAGE_MAX_BYTES,
  AGENT_RESULT_MAX_BYTES,
  boundedAgentText,
  isAgentMessageEnvelope,
  isRestrictiveAgentPolicy,
  normalizeAgentPolicy,
  type AgentAdmissionSnapshot,
  type AgentCollaborationEvent,
  type AgentConflictEvent,
  type AgentEffectivePolicy,
  type AgentMessageEnvelope,
  type AgentTerminalResult,
  type AgentWorkspaceMode,
} from '../src/agent/agentCollaboration.ts'
import { isTerminalAgentLifecycle, type AgentLifecycleState } from '../src/agent/agentLifecycle.ts'
import { projectAgentTree } from '../src/agent/agentTree.ts'
import { turnRecordEntries, type TurnRecordEntry } from '../src/agent/turnRecord.ts'
import { createPiChildSession, type PiContextPacket } from './piDelegationExtension.ts'
import { recordAgentCollaborationEvent, recordAgentLifecycle } from './piAgentLifecycleRecord.ts'
import { enqueuePiHostRun } from './piHostRunDomain.ts'
import type { PiHostMessage, SessionRecord } from './piHostProtocol.ts'
import type { PiQueuedRun } from './piRunQueue.ts'
import { PiAgentWorkspaceAuthority } from './piAgentWorkspaceAuthority.ts'

const MAX_TREE_DEPTH = 4
const MAX_TREE_ACTIVE = 8
const MAX_TREE_RETAINED = 64
const MAX_TREE_ROLLOUTS = 24
const WAIT_MIN_MS = 50
const WAIT_DEFAULT_MS = 30_000
const WAIT_MAX_MS = 60_000
const TERMINAL_RETENTION_MS = 7 * 24 * 60 * 60_000

export type PiAgentCommunicationState = {
  sessions: SessionRecord[]
  queue: PiQueuedRun[]
  activeSessionIds: ReadonlySet<string>
  defaultPolicy: AgentEffectivePolicy
  commit: (sessions: SessionRecord[], queue: PiQueuedRun[]) => void
  publish: (sessionId: string, entry: TurnRecordEntry) => void
  recordCollaboration?: (sessionId: string, event: AgentCollaborationEvent) => boolean
  recordLifecycle?: (sessionId: string, lifecycle: AgentLifecycleState, runId?: string, reason?: string) => boolean
  activeRunId?: (sessionId: string) => string | undefined
  steer?: (sessionId: string, content: string) => boolean
  interrupt: (sessionId: string, runId: string, reason: string) => boolean | Promise<boolean>
}

type WaitOutcome = { outcome: 'message' | 'terminal' | 'steer' | 'timeout' | 'cancelled'; message?: AgentMessageEnvelope }
type Waiter = { resolve: (outcome: WaitOutcome) => void; timer: ReturnType<typeof setTimeout> }
type PreparedSpawnSpec = {
  objective: string
  role: string
  profile: Record<string, unknown>
  context: PiContextPacket
  depth: number
  childPolicy: AgentEffectivePolicy
  childProfile: Record<string, unknown>
  workspace: AgentAdmissionSnapshot['workspace']
  rootAgentId: string
  runId: string
}

const error = (
  id: string | number,
  message: string,
  code: NonNullable<Extract<PiHostMessage, { id: string | number }>['error']>['code'] = 'invalid_request',
): PiHostMessage[] => [{ id, error: { code, message } }]
const response = (id: string | number, result: Record<string, unknown>): PiHostMessage[] => [{ id, result }]
const isRecord = (value: unknown): value is Record<string, unknown> => Boolean(value && typeof value === 'object' && !Array.isArray(value))
const stringValue = (value: unknown) => typeof value === 'string' ? value.trim() : ''

function lifecycleOf(session: SessionRecord): AgentLifecycleState {
  const event = [...turnRecordEntries(session.record)].reverse().find((entry) => entry.kind === 'agent-lifecycle')
  return event?.kind === 'agent-lifecycle' ? event.event.state : session.archived ? 'unknown' : 'admitted'
}

function collaborationEvents(session: SessionRecord): AgentCollaborationEvent[] {
  return turnRecordEntries(session.record)
    .filter((entry) => entry.kind === 'agent-collaboration')
    .map((entry) => entry.event)
}

function projectedMailbox(session: SessionRecord): AgentMessageEnvelope[] {
  const events = collaborationEvents(session)
  const state = new Map<string, AgentMessageEnvelope>()
  for (const event of events) {
    if (event.type === 'mail' && event.message.receiverAgentId === session.id) state.set(event.message.messageId, event.message)
    if (event.type === 'mail-consumed' && event.agentId === session.id) {
      const current = state.get(event.messageId)
      if (current) state.set(event.messageId, { ...current, deliveryState: 'consumed' })
    }
    if (event.type === 'mail-acked' && event.agentId === session.id) {
      const current = state.get(event.messageId)
      if (current) state.set(event.messageId, { ...current, deliveryState: 'acknowledged' })
    }
  }
  return [...state.values()].sort((left, right) => left.createdAt - right.createdAt || left.messageId.localeCompare(right.messageId))
}

function rootIdentity(sessions: readonly SessionRecord[], sessionId: string) {
  return projectAgentTree({ sessions, agentId: sessionId })
}

function profilePolicy(profile: Record<string, unknown> | undefined, fallback: AgentEffectivePolicy): AgentEffectivePolicy {
  if (!profile) return fallback
  return normalizeAgentPolicy({
    provider: profile.provider ?? fallback.provider,
    model: profile.model ?? fallback.model,
    approvalMode: profile.approvalMode ?? fallback.approvalMode,
    unattended: profile.unattended ?? fallback.unattended,
    sandbox: profile.sandbox ?? fallback.sandbox,
    outbound: profile.outbound ?? fallback.outbound,
    capabilities: profile.capabilities ?? profile.activeTools ?? fallback.capabilities,
    mcpServers: profile.mcpServers ?? fallback.mcpServers,
  }) || fallback
}

function policyProfile(policy: AgentEffectivePolicy): Record<string, unknown> {
  return {
    ...(policy.provider ? { provider: policy.provider } : {}),
    ...(policy.model ? { model: policy.model } : {}),
    ...(policy.approvalMode ? { approvalMode: policy.approvalMode } : {}),
    ...(typeof policy.unattended === 'boolean' ? { unattended: policy.unattended } : {}),
    activeTools: [...policy.capabilities],
    capabilities: [...policy.capabilities],
    mcpServers: [...policy.mcpServers],
    ...(policy.sandbox ? { sandbox: policy.sandbox } : {}),
    ...(policy.outbound ? { outbound: policy.outbound } : {}),
  }
}

function admittedChildProfile(profile: Record<string, unknown>, policy: AgentEffectivePolicy): Record<string, unknown> {
  const safe: Record<string, unknown> = policyProfile(policy)
  const stringFields = ['runner', 'thinkingLevel', 'compaction', 'agentMode', 'planCompletionAction', 'speed', 'providerServiceTier'] as const
  for (const field of stringFields) {
    const value = stringValue(profile[field])
    if (value && value.length <= 512) safe[field] = value
  }
  if (typeof profile.bashRequireAsk === 'boolean') safe.bashRequireAsk = profile.bashRequireAsk
  return safe
}

function admittedContextPacket(value: unknown, objective: string): PiContextPacket | undefined {
  if (!isRecord(value) || stringValue(value.objective) !== objective) return undefined
  if (Object.keys(value).some((key) => !['objective', 'facts', 'constraints'].includes(key))) return undefined
  if (!Array.isArray(value.facts) || !Array.isArray(value.constraints)) return undefined
  if (value.facts.length > 64 || value.constraints.length > 64) return undefined
  if (![...value.facts, ...value.constraints].every((item) => typeof item === 'string')) return undefined
  return {
    objective: boundedAgentText(objective, AGENT_MESSAGE_MAX_BYTES),
    facts: value.facts.map((item) => boundedAgentText(item, 2_048)),
    constraints: value.constraints.map((item) => boundedAgentText(item, 2_048)),
  }
}

function workspaceFrom(value: unknown): AgentAdmissionSnapshot['workspace'] | undefined {
  const raw = isRecord(value) ? value : { mode: 'shared-readonly' }
  const mode = raw.mode as AgentWorkspaceMode
  if (!['shared-readonly', 'shared-leased-write', 'isolated-worktree'].includes(String(mode))) return undefined
  const scopes = Array.isArray(raw.scopes) ? raw.scopes.map(String).filter(Boolean) : []
  if (scopes.length > 64 || scopes.some((scope) => scope.startsWith('/') || scope.includes('..') || scope.length > 2_048)) return undefined
  if (mode === 'shared-leased-write' && scopes.length === 0) return undefined
  return {
    mode,
    ...(stringValue(raw.projectRoot) ? { projectRoot: stringValue(raw.projectRoot) } : {}),
    scopes,
    revision: Number.isSafeInteger(raw.revision) && Number(raw.revision) >= 0 ? Number(raw.revision) : 0,
    ...(stringValue(raw.worktreePath) ? { worktreePath: stringValue(raw.worktreePath) } : {}),
    ...(stringValue(raw.branch) ? { branch: stringValue(raw.branch) } : {}),
    ...(stringValue(raw.baseline) ? { baseline: stringValue(raw.baseline) } : {}),
    ...(typeof raw.verified === 'boolean' ? { verified: raw.verified } : {}),
  }
}

function originTurn(session: SessionRecord): number {
  return turnRecordEntries(session.record).reduce((highest, entry) => Math.max(highest, entry.turn), 0) || 1
}

function treeBudgetError(state: PiAgentCommunicationState, parent: SessionRecord, depth: number): string | undefined {
  const tree = rootIdentity(state.sessions, parent.id)
  if (!tree) return 'Parent agent tree is unavailable'
  if (depth > MAX_TREE_DEPTH) return `Agent tree depth exceeds ${MAX_TREE_DEPTH}`
  const retained = tree.agents.filter((agent) => !agent.archived)
  if (retained.length >= MAX_TREE_RETAINED) return `Agent retained budget ${MAX_TREE_RETAINED} reached`
  if (retained.filter((agent) => !isTerminalAgentLifecycle(agent.lifecycle)).length >= MAX_TREE_ACTIVE) return `Agent concurrency budget ${MAX_TREE_ACTIVE} reached`
  if (retained.filter((agent) => agent.depth > 0).length >= MAX_TREE_ROLLOUTS) return `Agent rollout budget ${MAX_TREE_ROLLOUTS} reached`
  return undefined
}

function appendEvent(state: PiAgentCommunicationState, sessionId: string, event: AgentCollaborationEvent): boolean {
  if (state.recordCollaboration?.(sessionId, event)) return true
  return recordAgentCollaborationEvent(state.sessions, sessionId, event, (entry) => state.publish(sessionId, entry))
}

function appendLifecycle(state: PiAgentCommunicationState, sessionId: string, lifecycle: AgentLifecycleState, runId?: string, reason?: string): boolean {
  if (state.recordLifecycle?.(sessionId, lifecycle, runId, reason)) return true
  return recordAgentLifecycle(state.sessions, sessionId, lifecycle, runId, reason, (entry) => state.publish(sessionId, entry))
}

export class PiAgentCommunicationDomain {
  private readonly waiters = new Map<string, Set<Waiter>>()
  private readonly workspaceAuthority = new PiAgentWorkspaceAuthority()

  handle(input: { id: string | number; method: string; params?: Record<string, unknown>; state: PiAgentCommunicationState }): PiHostMessage[] | Promise<PiHostMessage[]> | undefined {
    if (!input.method.startsWith('agents/') || input.method === 'agents/list') return undefined
    if (input.method === 'agents/spawn') return this.spawn(input)
    if (input.method === 'agents/send') return this.send(input)
    if (input.method === 'agents/mailbox') return this.mailbox(input)
    if (input.method === 'agents/ack') return this.ack(input)
    if (input.method === 'agents/follow-up') return this.followUp(input)
    if (input.method === 'agents/wait') return this.wait(input)
    if (input.method === 'agents/lease/resolve') return this.resolveLeaseConflict(input)
    if (input.method === 'agents/interrupt' || input.method === 'agents/cancel') return this.interrupt(input)
    if (input.method === 'agents/close') return this.close(input)
    return error(input.id, `Unknown agent communication method: ${input.method}`)
  }

  notify(agentId: string, outcome: WaitOutcome): void {
    const waiters = [...(this.waiters.get(agentId) || [])]
    this.waiters.delete(agentId)
    for (const waiter of waiters) {
      clearTimeout(waiter.timer)
      waiter.resolve(outcome)
    }
  }

  recover(state: PiAgentCommunicationState): number {
    let recovered = 0
    for (const session of state.sessions) {
      if (!session.parentSessionId) continue
      const lifecycle = lifecycleOf(session)
      if (!['running', 'waiting-approval', 'blocked'].includes(lifecycle)) continue
      const run = [...state.queue].reverse().find((candidate) => candidate.sessionId === session.id && candidate.status === 'running')
      if (run) run.status = 'interrupted'
      if (!appendLifecycle(state, session.id, 'interrupted', run?.runId, 'host-restart-no-live-witness')) continue
      if (run) this.recordCompletion(state, { sessionId: session.id, runId: run.runId, settlement: 'interrupted', summary: 'Host restarted without a live execution witness.' })
      recovered += 1
    }
    if (recovered) state.commit(state.sessions, state.queue)
    this.compactRetention(state)
    return recovered
  }

  compactRetention(state: PiAgentCommunicationState, now = Date.now()): number {
    const terminal = state.sessions
      .filter((session) => session.parentSessionId && !session.archived && isTerminalAgentLifecycle(lifecycleOf(session)))
      .sort((left, right) => (left.agentAdmission?.createdAt || 0) - (right.agentAdmission?.createdAt || 0))
    let remaining = terminal.length
    let closed = 0
    for (const session of terminal) {
      const expired = now - (session.agentAdmission?.createdAt || now) >= TERMINAL_RETENTION_MS
      const overCap = remaining >= MAX_TREE_RETAINED
      if ((!expired && !overCap) || !this.completionAcknowledged(state.sessions, session)) continue
      session.archived = true
      appendEvent(state, session.id, { type: 'closed', agentId: session.id, requestedBy: session.parentSessionId!, reason: expired ? 'retention-ttl' : 'retention-cap' })
      remaining -= 1
      closed += 1
    }
    if (closed) state.commit(state.sessions, state.queue)
    return closed
  }

  recordCompletion(state: PiAgentCommunicationState, input: { sessionId: string; runId: string; settlement: AgentTerminalResult['settlement']; summary: string }): boolean {
    const child = state.sessions.find((session) => session.id === input.sessionId)
    if (!child?.parentSessionId) return false
    const parent = state.sessions.find((session) => session.id === child.parentSessionId)
    const tree = rootIdentity(state.sessions, child.id)
    if (!parent || !tree) return false
    this.releaseWorkspaceLease(state, child)
    this.resumeSerializedConflicts(state, child.id)
    const resultId = `${input.runId}:result`
    if (collaborationEvents(parent).some((event) => event.type === 'completion' && event.result.resultId === resultId)) return true
    const result: AgentTerminalResult = {
      version: 1, resultId, agentId: child.id, parentAgentId: parent.id, rootAgentId: tree.rootAgentId,
      runId: input.runId, originTurn: child.agentAdmission?.originTurn || originTurn(parent),
      settlement: input.settlement, summary: boundedAgentText(input.summary || input.settlement, AGENT_RESULT_MAX_BYTES),
      observationOnly: true, createdAt: Date.now(),
    }
    const messageId = `${resultId}:mail`
    const message: AgentMessageEnvelope = {
      version: 1, messageId, rootAgentId: tree.rootAgentId, senderAgentId: child.id, receiverAgentId: parent.id,
      originTurn: result.originTurn, originRunId: input.runId, kind: 'completion', content: result.summary,
      createdAt: result.createdAt, deliveryState: 'queued', resultRef: resultId,
    }
    const recorded = appendEvent(state, parent.id, { type: 'completion', result, messageId })
      && appendEvent(state, parent.id, { type: 'mail', message })
    if (recorded) {
      state.commit(state.sessions, state.queue)
      this.notify(parent.id, { outcome: 'terminal', message })
    }
    return recorded
  }

  assertWrite(session: SessionRecord, target: string) {
    return this.workspaceAuthority.assertWrite(session, target)
  }

  /** Starts at most one not-yet-started follow-up after the previous run settles. */
  drainNextFollowUp(state: PiAgentCommunicationState, agentId: string): boolean {
    if (state.activeSessionIds.has(agentId)) return false
    if (state.queue.some((run) => run.sessionId === agentId && (run.status === 'queued' || run.status === 'running'))) return false
    const session = state.sessions.find((candidate) => candidate.id === agentId)
    if (!session) return false
    const events = collaborationEvents(session)
    const started = new Set(events.filter((event) => event.type === 'follow-up-started').map((event) => event.messageId))
    const message = projectedMailbox(session).find((candidate) => candidate.kind === 'follow-up'
      && candidate.deliveryState !== 'acknowledged'
      && !started.has(candidate.messageId))
    if (!message) return false
    const runId = `${message.messageId}:run`
    const policy = session.agentAdmission?.policy || profilePolicy(session.profile, state.defaultPolicy)
    const outcome = enqueuePiHostRun({
      queue: state.queue,
      run: { runId, sessionId: agentId, prompt: message.content, trigger: 'interactive', profile: { ...session.profile, ...policyProfile(policy) }, status: 'queued' },
      recordLifecycle: (targetId, lifecycle, admittedRunId) => appendLifecycle(state, targetId, lifecycle, admittedRunId),
    })
    if (!outcome.ok) return false
    appendEvent(state, agentId, { type: 'follow-up-started', messageId: message.messageId, agentId, runId })
    appendEvent(state, agentId, { type: 'mail-consumed', messageId: message.messageId, agentId })
    state.commit(state.sessions, outcome.queue)
    return true
  }

  private spawn(input: { id: string | number; params?: Record<string, unknown>; state: PiAgentCommunicationState }): PiHostMessage[] {
    const params = input.params || {}
    const parentAgentId = stringValue(params.parentAgentId)
    const parent = input.state.sessions.find((session) => session.id === parentAgentId)
    const spawnId = stringValue(params.spawnId) || randomUUID()
    if (!parent) return error(input.id, 'parentAgentId is unknown')
    this.compactRetention(input.state)
    const duplicate = input.state.sessions.find((session) => session.agentAdmission?.spawnId === spawnId)
    if (duplicate) return this.spawnResponse(input.id, input.state, duplicate)
    const prepared = this.prepareSpawnSpec(input.state, params, parent, spawnId)
    if (!prepared.ok) return this.rejectSpawn(input, parent, spawnId, prepared.reason)
    const { objective, role, profile, context, depth, childPolicy, childProfile, workspace, rootAgentId, runId } = prepared.value
    let child
    try {
      child = createPiChildSession({ role, profile: childProfile, context, depth, maxDepth: MAX_TREE_DEPTH })
    } catch (cause) {
      return this.rejectSpawn(input, parent, spawnId, cause instanceof Error ? cause.message : 'Invalid child admission')
    }
    const admission: AgentAdmissionSnapshot = {
      version: 1, spawnId, parentAgentId, rootAgentId,
      originTurn: Number.isInteger(params.originTurn) ? Number(params.originTurn) : originTurn(parent),
      ...(stringValue(params.originRunId) ? { originRunId: stringValue(params.originRunId) } : {}),
      objective: boundedAgentText(objective, AGENT_MESSAGE_MAX_BYTES), role, depth,
      detached: params.detached === true,
      executionKind: stringValue(childProfile.runner) && stringValue(childProfile.runner) !== 'builtin' ? 'external-cli-process' : 'builtin-agent',
      policy: childPolicy, workspace, createdAt: Date.now(),
    }
    const session: SessionRecord = {
      id: child.id, title: stringValue(params.title) || objective, parentSessionId: parent.id,
      role: child.role, profile: child.profile, context: child.context, depth: child.depth,
      messages: [], agentAdmission: admission,
    }
    return this.finishSpawnAdmission(input, parent, spawnId, runId, session, admission, childProfile, objective)
  }

  private prepareSpawnSpec(state: PiAgentCommunicationState, params: Record<string, unknown>, parent: SessionRecord, spawnId: string): { ok: true; value: PreparedSpawnSpec } | { ok: false; reason: string } {
    const rawObjective = stringValue(params.objective)
    const objective = boundedAgentText(rawObjective, AGENT_MESSAGE_MAX_BYTES)
    const role = boundedAgentText(stringValue(params.role), 512)
    const profile = isRecord(params.profile) ? params.profile : undefined
    const context = admittedContextPacket(params.context, rawObjective)
    const depth = Number(params.depth)
    if (!profile) return { ok: false, reason: 'objective, role, profile, context, and depth are required' }
    if (![objective, role, context].every(Boolean) || !Number.isInteger(depth)) return { ok: false, reason: 'objective, role, profile, context, and depth are required' }
    if (context!.objective !== objective) return { ok: false, reason: 'Context Packet must exactly identify the child objective, facts, and constraints' }
    if (depth !== (parent.depth || 0) + 1) return { ok: false, reason: 'Child depth must be exactly parent depth + 1' }
    const budgetError = treeBudgetError(state, parent, depth)
    if (budgetError) return { ok: false, reason: budgetError }
    const parentPolicy = parent.agentAdmission?.policy || profilePolicy(parent.profile, state.defaultPolicy)
    const childPolicy = profilePolicy(profile, parentPolicy)
    if (!isRestrictiveAgentPolicy(parentPolicy, childPolicy)) return { ok: false, reason: 'Child effective policy would widen parent authority' }
    const requestedWorkspace = workspaceFrom(params.workspace)
    if (!requestedWorkspace) return { ok: false, reason: 'Child workspace mode or write scope is invalid' }
    const preparedWorkspace = this.workspaceAuthority.prepare(requestedWorkspace, spawnId)
    if (!preparedWorkspace.ok) return { ok: false, reason: preparedWorkspace.reason }
    if (params.detached === true && parent.agentAdmission?.detached !== true) return { ok: false, reason: 'Detached work was not granted by parent admission' }
    const tree = rootIdentity(state.sessions, parent.id)
    if (!tree) return { ok: false, reason: 'Parent tree is unavailable' }
    return { ok: true, value: {
      objective, role, profile, context: context!, depth, childPolicy,
      childProfile: admittedChildProfile(profile, childPolicy), workspace: preparedWorkspace.workspace,
      rootAgentId: tree.rootAgentId, runId: stringValue(params.runId) || `${spawnId}:run:1`,
    } }
  }

  private finishSpawnAdmission(input: { id: string | number; state: PiAgentCommunicationState }, parent: SessionRecord, spawnId: string, runId: string, session: SessionRecord, admission: AgentAdmissionSnapshot, childProfile: Record<string, unknown>, objective: string): PiHostMessage[] {
    const workspace = admission.workspace
    const sessions = [...input.state.sessions, session]
    input.state.sessions = sessions
    if (!appendLifecycle(input.state, session.id, 'admitted')) {
      return this.rejectSpawn(input, parent, spawnId, 'Unable to record child admission')
    }
    const lease = this.workspaceAuthority.acquire(sessions, session.id, workspace)
    if (!lease.ok) {
      const conflict = { ...lease.conflict, parentAgentId: this.closestCommonParent(sessions, session.id, lease.conflict.ownerAgentId) }
      this.recordConflict(input.state, conflict)
      appendLifecycle(input.state, session.id, 'blocked', undefined, 'write-scope-conflict')
      input.state.commit(sessions, input.state.queue)
      return error(input.id, `Write scope conflicts with agent ${conflict.ownerAgentId}`)
    }
    if (workspace.mode !== 'shared-readonly') {
      appendEvent(input.state, session.id, {
        type: 'lease-acquired', agentId: session.id,
        resource: workspace.mode === 'isolated-worktree' ? workspace.worktreePath! : workspace.scopes.join(','),
        revision: lease.revision,
      })
    }
    const queueOutcome = enqueuePiHostRun({
      queue: input.state.queue,
      run: {
        runId, sessionId: session.id, prompt: objective, trigger: 'interactive',
        profile: { ...childProfile, projectRoot: workspace.mode === 'isolated-worktree' ? workspace.worktreePath : workspace.projectRoot },
        status: 'queued',
      },
      recordLifecycle: (sessionId, lifecycle, admittedRunId) => appendLifecycle(input.state, sessionId, lifecycle, admittedRunId),
    })
    if (!queueOutcome.ok) return this.rejectSpawn(input, parent, spawnId, queueOutcome.message)
    const spawned: AgentCollaborationEvent = { type: 'spawned', agentId: session.id, runId, admission }
    if (!appendEvent(input.state, parent.id, spawned)) return this.rejectSpawn(input, parent, spawnId, 'Unable to record child spawn')
    input.state.commit(input.state.sessions, queueOutcome.queue)
    return this.spawnResponse(input.id, { ...input.state, queue: queueOutcome.queue }, session, runId)
  }

  private rejectSpawn(input: { id: string | number; state: PiAgentCommunicationState }, parent: SessionRecord, spawnId: string, reason: string): PiHostMessage[] {
    appendEvent(input.state, parent.id, { type: 'spawn-rejected', parentAgentId: parent.id, spawnId, reason: boundedAgentText(reason, 2_048) })
    input.state.commit(input.state.sessions, input.state.queue)
    return error(input.id, reason)
  }

  private spawnResponse(id: string | number, state: PiAgentCommunicationState, child: SessionRecord, runId?: string): PiHostMessage[] {
    const tree = rootIdentity(state.sessions, child.id)
    const agent = tree?.agents.find((node) => node.agentId === child.id)
    return response(id, { agent, sessionId: child.id, runId: runId || state.queue.find((run) => run.sessionId === child.id)?.runId, duplicate: Boolean(runId === undefined) })
  }

  private send(input: { id: string | number; params?: Record<string, unknown>; state: PiAgentCommunicationState }): PiHostMessage[] {
    const params = input.params || {}
    const sender = input.state.sessions.find((session) => session.id === stringValue(params.senderAgentId))
    const receiver = input.state.sessions.find((session) => session.id === stringValue(params.receiverAgentId))
    if (!sender || !receiver) return error(input.id, 'senderAgentId and receiverAgentId are required')
    const senderTree = rootIdentity(input.state.sessions, sender.id)
    const receiverTree = rootIdentity(input.state.sessions, receiver.id)
    if (!senderTree || !receiverTree || senderTree.rootAgentId !== receiverTree.rootAgentId) return error(input.id, 'Cross-tree agent delivery is forbidden')
    const content = boundedAgentText(stringValue(params.content), AGENT_MESSAGE_MAX_BYTES)
    if (!content) return error(input.id, 'Agent message content is required')
    const messageId = stringValue(params.messageId) || randomUUID()
    const existing = projectedMailbox(receiver).find((message) => message.messageId === messageId)
    if (existing) return response(input.id, { message: existing, duplicate: true })
    if (projectedMailbox(receiver).filter((message) => message.deliveryState !== 'acknowledged').length >= AGENT_MAILBOX_MAX_MESSAGES) return error(input.id, 'Agent mailbox queue_full')
    const message: AgentMessageEnvelope = {
      version: 1, messageId, rootAgentId: senderTree.rootAgentId, senderAgentId: sender.id, receiverAgentId: receiver.id,
      originTurn: Number.isInteger(params.originTurn) ? Number(params.originTurn) : originTurn(sender),
      ...(stringValue(params.originRunId) ? { originRunId: stringValue(params.originRunId) } : {}),
      kind: params.kind === 'relay' ? 'relay' : 'information', content, createdAt: Date.now(), deliveryState: 'queued',
    }
    if (!isAgentMessageEnvelope(message) || !appendEvent(input.state, receiver.id, { type: 'mail', message })) return error(input.id, 'Agent message is malformed')
    input.state.commit(input.state.sessions, input.state.queue)
    this.notify(receiver.id, { outcome: 'message', message })
    return response(input.id, { message, duplicate: false })
  }

  private mailbox(input: { id: string | number; params?: Record<string, unknown>; state: PiAgentCommunicationState }): PiHostMessage[] {
    const agent = input.state.sessions.find((session) => session.id === stringValue(input.params?.agentId))
    if (!agent) return error(input.id, 'agentId is required')
    let messages = projectedMailbox(agent)
    if (input.params?.consume === true) {
      for (const message of messages.filter((item) => item.deliveryState === 'queued' || item.deliveryState === 'delivered')) {
        appendEvent(input.state, agent.id, { type: 'mail-consumed', messageId: message.messageId, agentId: agent.id })
      }
      input.state.commit(input.state.sessions, input.state.queue)
      messages = projectedMailbox(agent)
    }
    return response(input.id, { agentId: agent.id, messages })
  }

  private ack(input: { id: string | number; params?: Record<string, unknown>; state: PiAgentCommunicationState }): PiHostMessage[] {
    const agent = input.state.sessions.find((session) => session.id === stringValue(input.params?.agentId))
    const messageId = stringValue(input.params?.messageId)
    if (!agent || !messageId) return error(input.id, 'agentId and messageId are required')
    const message = projectedMailbox(agent).find((item) => item.messageId === messageId)
    if (!message) return error(input.id, 'Unknown agent message')
    if (message.deliveryState !== 'acknowledged') appendEvent(input.state, agent.id, { type: 'mail-acked', messageId, agentId: agent.id })
    input.state.commit(input.state.sessions, input.state.queue)
    return response(input.id, { message: projectedMailbox(agent).find((item) => item.messageId === messageId), duplicate: message.deliveryState === 'acknowledged' })
  }

  private followUp(input: { id: string | number; params?: Record<string, unknown>; state: PiAgentCommunicationState }): PiHostMessage[] {
    const params = input.params || {}
    const sender = input.state.sessions.find((session) => session.id === stringValue(params.senderAgentId))
    const receiver = input.state.sessions.find((session) => session.id === stringValue(params.receiverAgentId))
    if (!sender || !receiver) return error(input.id, 'senderAgentId and receiverAgentId are required')
    const authorizationError = this.followUpAuthorizationError(input.state, sender, receiver)
    if (authorizationError) return error(input.id, authorizationError)
    const tree = rootIdentity(input.state.sessions, receiver.id)!
    const content = boundedAgentText(stringValue(params.content), AGENT_MESSAGE_MAX_BYTES)
    if (!content) return error(input.id, 'Follow-up content is required')
    const update = this.followUpPolicy(params, receiver)
    const current = receiver.agentAdmission?.policy || profilePolicy(receiver.profile, input.state.defaultPolicy)
    if (!update || !isRestrictiveAgentPolicy(current, update)) return error(input.id, 'Follow-up policy update would widen child authority')
    const messageId = stringValue(params.messageId) || randomUUID()
    const existing = projectedMailbox(receiver).find((message) => message.messageId === messageId)
    if (existing) return response(input.id, { message: existing, duplicate: true, started: false })
    if (this.mailboxIsFull(receiver)) return error(input.id, 'Agent mailbox queue_full')
    const message: AgentMessageEnvelope = {
      version: 1, messageId, rootAgentId: tree!.rootAgentId, senderAgentId: sender.id, receiverAgentId: receiver.id,
      originTurn: Number.isInteger(params.originTurn) ? Number(params.originTurn) : originTurn(sender),
      ...(stringValue(params.originRunId) ? { originRunId: stringValue(params.originRunId) } : {}),
      kind: 'follow-up', content, createdAt: Date.now(), deliveryState: 'queued',
    }
    if (!appendEvent(input.state, receiver.id, { type: 'mail', message })) return error(input.id, 'Unable to record follow-up')
    if (receiver.agentAdmission) receiver.agentAdmission = { ...receiver.agentAdmission, policy: update }
    const steered = this.tryActiveFollowUp(input, receiver, content, message, messageId)
    if (steered) return steered
    const busy = this.agentHasActiveOrQueuedRun(input.state, receiver.id)
    if (busy) {
      input.state.commit(input.state.sessions, input.state.queue)
      return response(input.id, { message, duplicate: false, started: false, queued: true })
    }
    return this.enqueueFollowUp(input, receiver, update, content, message, messageId)
  }

  private followUpAuthorizationError(state: PiAgentCommunicationState, sender: SessionRecord, receiver: SessionRecord): string | undefined {
    if (receiver.archived) return 'Closed agents cannot receive follow-up work'
    const tree = rootIdentity(state.sessions, receiver.id)
    const authorized = sender.id === receiver.parentSessionId || sender.id === tree?.rootAgentId
    return authorized && sender.id !== receiver.id ? undefined : 'Only direct parent or root may assign follow-up work'
  }

  private followUpPolicy(params: Record<string, unknown>, receiver: SessionRecord): AgentEffectivePolicy | undefined {
    return params.policy === undefined ? receiver.agentAdmission?.policy : normalizeAgentPolicy(params.policy)
  }

  private mailboxIsFull(receiver: SessionRecord): boolean {
    return projectedMailbox(receiver).filter((message) => message.deliveryState !== 'acknowledged').length >= AGENT_MAILBOX_MAX_MESSAGES
  }

  private agentHasActiveOrQueuedRun(state: PiAgentCommunicationState, agentId: string): boolean {
    return state.activeSessionIds.has(agentId)
      || state.queue.some((run) => run.sessionId === agentId && (run.status === 'queued' || run.status === 'running'))
  }

  private tryActiveFollowUp(input: { id: string | number; state: PiAgentCommunicationState }, receiver: SessionRecord, content: string, message: AgentMessageEnvelope, messageId: string): PiHostMessage[] | undefined {
    if (!input.state.activeSessionIds.has(receiver.id) || !input.state.steer) return undefined
    const activeRunId = input.state.activeRunId?.(receiver.id)
    try {
      if (!activeRunId || !input.state.steer(receiver.id, content)) return undefined
      appendEvent(input.state, receiver.id, { type: 'follow-up-started', messageId, agentId: receiver.id, runId: activeRunId })
      appendEvent(input.state, receiver.id, { type: 'mail-consumed', messageId, agentId: receiver.id })
      input.state.commit(input.state.sessions, input.state.queue)
      return response(input.id, { message: { ...message, deliveryState: 'consumed' }, duplicate: false, started: true, runId: activeRunId, delivery: 'safe-boundary' })
    } catch {
      return undefined // durable mail remains queued for settlement drain
    }
  }

  private enqueueFollowUp(input: { id: string | number; params?: Record<string, unknown>; state: PiAgentCommunicationState }, receiver: SessionRecord, update: AgentEffectivePolicy, content: string, message: AgentMessageEnvelope, messageId: string): PiHostMessage[] {
    const params = input.params || {}
    const runId = stringValue(params.runId) || `${messageId}:run`
    const outcome = enqueuePiHostRun({
      queue: input.state.queue,
      run: { runId, sessionId: receiver.id, prompt: content, trigger: 'interactive', profile: { ...receiver.profile, ...policyProfile(update) }, status: 'queued' },
      recordLifecycle: (sessionId, lifecycle, admittedRunId) => appendLifecycle(input.state, sessionId, lifecycle, admittedRunId),
    })
    if (!outcome.ok) return error(input.id, outcome.message)
    appendEvent(input.state, receiver.id, { type: 'follow-up-started', messageId, agentId: receiver.id, runId })
    appendEvent(input.state, receiver.id, { type: 'mail-consumed', messageId, agentId: receiver.id })
    input.state.commit(input.state.sessions, outcome.queue)
    return response(input.id, { message, duplicate: false, started: true, runId })
  }

  private wait(input: { id: string | number; params?: Record<string, unknown>; state: PiAgentCommunicationState }): Promise<PiHostMessage[]> | PiHostMessage[] {
    const agent = input.state.sessions.find((session) => session.id === stringValue(input.params?.agentId))
    if (!agent) return error(input.id, 'agentId is required')
    const pending = projectedMailbox(agent).find((message) => message.deliveryState !== 'consumed' && message.deliveryState !== 'acknowledged')
    if (pending) return response(input.id, { outcome: pending.kind === 'completion' ? 'terminal' : 'message', message: pending })
    const requested = Number(input.params?.timeoutMs)
    const timeoutMs = Number.isFinite(requested) ? Math.min(WAIT_MAX_MS, Math.max(WAIT_MIN_MS, requested)) : WAIT_DEFAULT_MS
    return new Promise<PiHostMessage[]>((resolve) => {
      const waiter: Waiter = {
        resolve: (outcome) => {
          appendEvent(input.state, agent.id, { type: 'wait', agentId: agent.id, outcome: outcome.outcome, ...(outcome.message ? { messageId: outcome.message.messageId } : {}) })
          input.state.commit(input.state.sessions, input.state.queue)
          resolve(response(input.id, outcome as unknown as Record<string, unknown>))
        },
        timer: setTimeout(() => {
          this.waiters.get(agent.id)?.delete(waiter)
          waiter.resolve({ outcome: 'timeout' })
        }, timeoutMs),
      }
      const set = this.waiters.get(agent.id) || new Set<Waiter>()
      set.add(waiter)
      this.waiters.set(agent.id, set)
    })
  }

  private interrupt(input: { id: string | number; method: string; params?: Record<string, unknown>; state: PiAgentCommunicationState }): Promise<PiHostMessage[]> | PiHostMessage[] {
    const requester = input.state.sessions.find((session) => session.id === stringValue(input.params?.requestedBy))
    const target = input.state.sessions.find((session) => session.id === stringValue(input.params?.agentId))
    if (!requester || !target || requester.id === target.id) return error(input.id, 'requestedBy and a different target agentId are required')
    const tree = rootIdentity(input.state.sessions, target.id)
    const authorized = requester.id === target.parentSessionId || requester.id === tree?.rootAgentId
    if (!authorized) return error(input.id, 'Requester cannot interrupt this agent')
    const targets = input.method === 'agents/cancel'
      ? tree!.agents.filter((agent) => agent.agentId === target.id || this.isDescendant(input.state.sessions, agent.agentId, target.id))
      : tree!.agents.filter((agent) => agent.agentId === target.id)
    const reason = boundedAgentText(stringValue(input.params?.reason) || 'parent-request', 2_048)
    return Promise.all(targets.map(async (agent) => {
      const session = input.state.sessions.find((item) => item.id === agent.agentId)
      if (!session || (session.agentAdmission?.detached && agent.agentId !== target.id)) return { agentId: agent.agentId, interrupted: false, detached: true }
      if (isTerminalAgentLifecycle(agent.lifecycle)) return { agentId: agent.agentId, interrupted: false, terminal: true }
      const run = [...input.state.queue].reverse().find((item) => item.sessionId === agent.agentId && item.status !== 'settled')
      const interrupted = run ? await input.state.interrupt(agent.agentId, run.runId, reason) : true
      appendEvent(input.state, agent.agentId, { type: 'interrupt-requested', agentId: agent.agentId, requestedBy: requester.id, reason })
      if (interrupted) {
        appendLifecycle(input.state, agent.agentId, 'interrupted', run?.runId, reason)
        if (run) this.recordCompletion(input.state, { sessionId: agent.agentId, runId: run.runId, settlement: 'interrupted', summary: reason })
      }
      return { agentId: agent.agentId, interrupted }
    })).then((results) => {
      input.state.commit(input.state.sessions, input.state.queue)
      return response(input.id, { results })
    })
  }

  private close(input: { id: string | number; params?: Record<string, unknown>; state: PiAgentCommunicationState }): PiHostMessage[] {
    const requester = input.state.sessions.find((session) => session.id === stringValue(input.params?.requestedBy))
    const target = input.state.sessions.find((session) => session.id === stringValue(input.params?.agentId))
    if (!requester || !target) return error(input.id, 'requestedBy and agentId are required')
    const tree = rootIdentity(input.state.sessions, target.id)
    if (requester.id !== target.parentSessionId && requester.id !== tree?.rootAgentId) return error(input.id, 'Requester cannot close this agent')
    if (!isTerminalAgentLifecycle(lifecycleOf(target))) return error(input.id, 'Only terminal agents can be closed')
    const duplicate = target.archived === true
    if (!duplicate) {
      target.archived = true
      appendEvent(input.state, target.id, { type: 'closed', agentId: target.id, requestedBy: requester.id })
      input.state.commit(input.state.sessions, input.state.queue)
    }
    return response(input.id, { agentId: target.id, closed: true, duplicate })
  }

  private resolveLeaseConflict(input: { id: string | number; params?: Record<string, unknown>; state: PiAgentCommunicationState }): PiHostMessage[] {
    const conflictId = stringValue(input.params?.conflictId)
    const requestedBy = stringValue(input.params?.requestedBy)
    const action = stringValue(input.params?.action) as AgentConflictEvent['choices'][number]
    if (!conflictId || !requestedBy || !['serialize', 'narrow-scope', 'transfer-lease', 'release-lease', 'isolate-worktree', 'cancel'].includes(action)) {
      return error(input.id, 'conflictId, requestedBy, and a supported action are required')
    }
    const conflict = this.findConflict(input.state.sessions, conflictId)
    if (!conflict || !conflict.choices.includes(action)) return error(input.id, 'Unknown conflict or unsupported resolution')
    const target = input.state.sessions.find((session) => session.id === conflict.requesterAgentId)
    const owner = input.state.sessions.find((session) => session.id === conflict.ownerAgentId)
    const tree = target ? rootIdentity(input.state.sessions, target.id) : undefined
    if (!target || !owner || !tree) return error(input.id, 'Conflict agents are unavailable')
    const authorized = new Set([target.parentSessionId, conflict.parentAgentId, tree.rootAgentId].filter(Boolean))
    if (!authorized.has(requestedBy)) return error(input.id, 'Only the authorized parent or root may resolve this lease conflict', 'forbidden')
    const prior = this.findConflictResolution(input.state.sessions, conflictId)
    if (prior) return response(input.id, { conflictId, action: prior.action, agentId: prior.agentId, duplicate: true })
    const immediate = this.resolveImmediateConflict(input, conflict, requestedBy, action, target, owner)
    if (immediate) return immediate
    const workspaceError = this.prepareConflictWorkspace(input, conflict, action, target)
    if (workspaceError) return workspaceError
    if (action === 'transfer-lease' || action === 'release-lease') this.releaseWorkspaceLease(input.state, owner)
    const queued = this.queueBlockedChild(input.state, target)
    if (!queued.ok) return error(input.id, queued.reason)
    this.recordConflictResolution(input.state, conflict, requestedBy, action, queued.revision)
    input.state.commit(input.state.sessions, queued.queue)
    return response(input.id, { conflictId, action, agentId: target.id, runId: queued.runId, queued: true, duplicate: false })
  }

  private findConflict(sessions: readonly SessionRecord[], conflictId: string): AgentConflictEvent | undefined {
    return sessions.flatMap((session) => collaborationEvents(session))
      .find((event): event is Extract<AgentCollaborationEvent, { type: 'conflict' }> => event.type === 'conflict' && event.conflict.conflictId === conflictId)?.conflict
  }

  private findConflictResolution(sessions: readonly SessionRecord[], conflictId: string) {
    return sessions.flatMap((session) => collaborationEvents(session))
      .find((event): event is Extract<AgentCollaborationEvent, { type: 'conflict-resolved' }> => event.type === 'conflict-resolved' && event.conflictId === conflictId)
  }

  private resolveImmediateConflict(input: { id: string | number; state: PiAgentCommunicationState }, conflict: AgentConflictEvent, requestedBy: string, action: AgentConflictEvent['choices'][number], target: SessionRecord, owner: SessionRecord): PiHostMessage[] | undefined {
    if (action === 'serialize') {
      this.recordConflictResolution(input.state, conflict, requestedBy, action, conflict.revision)
      input.state.commit(input.state.sessions, input.state.queue)
      return response(input.id, { conflictId: conflict.conflictId, action, agentId: target.id, queued: false, waitingForAgentId: owner.id, duplicate: false })
    }
    if (action !== 'cancel') return undefined
    this.recordConflictResolution(input.state, conflict, requestedBy, action, conflict.revision)
    const runId = `${target.agentAdmission?.spawnId || target.id}:run:1`
    appendLifecycle(input.state, target.id, 'cancelled', runId, 'write-scope-conflict-cancelled')
    this.recordCompletion(input.state, { sessionId: target.id, runId, settlement: 'cancelled', summary: 'Cancelled while resolving a write-scope conflict.' })
    input.state.commit(input.state.sessions, input.state.queue)
    return response(input.id, { conflictId: conflict.conflictId, action, agentId: target.id, queued: false, duplicate: false })
  }

  private prepareConflictWorkspace(input: { id: string | number; params?: Record<string, unknown> }, conflict: AgentConflictEvent, action: AgentConflictEvent['choices'][number], target: SessionRecord): PiHostMessage[] | undefined {
    if (action !== 'narrow-scope' && action !== 'isolate-worktree') return undefined
    const admission = target.agentAdmission
    const current = admission?.workspace
    if (!admission || !current?.projectRoot) return error(input.id, 'Conflicted child has no project workspace')
    const requested = action === 'narrow-scope'
      ? { ...current, mode: 'shared-leased-write' as const, scopes: Array.isArray(input.params?.scopes) ? input.params.scopes.map(String) : [], revision: conflict.revision }
      : { mode: 'isolated-worktree' as const, projectRoot: current.projectRoot, scopes: [], revision: conflict.revision }
    const spawnId = action === 'isolate-worktree' ? `${admission.spawnId}-isolated` : admission.spawnId
    const prepared = this.workspaceAuthority.prepare(requested, spawnId)
    if (!prepared.ok) return error(input.id, prepared.reason)
    target.agentAdmission = { ...admission, workspace: prepared.workspace }
    return undefined
  }

  private queueBlockedChild(state: PiAgentCommunicationState, child: SessionRecord): { ok: true; queue: PiQueuedRun[]; runId: string; revision: number } | { ok: false; reason: string } {
    const admission = child.agentAdmission
    if (!admission) return { ok: false, reason: 'Child admission is unavailable' }
    const lease = this.workspaceAuthority.acquire(state.sessions, child.id, admission.workspace)
    if (!lease.ok) return { ok: false, reason: `Write scope still conflicts with agent ${lease.conflict.ownerAgentId}` }
    if (admission.workspace.mode !== 'shared-readonly') {
      appendEvent(state, child.id, {
        type: 'lease-acquired', agentId: child.id,
        resource: admission.workspace.mode === 'isolated-worktree' ? admission.workspace.worktreePath! : admission.workspace.scopes.join(','),
        revision: lease.revision,
      })
    }
    const runId = `${admission.spawnId}:run:1`
    const outcome = enqueuePiHostRun({
      queue: state.queue,
      run: {
        runId, sessionId: child.id, prompt: admission.objective, trigger: 'interactive',
        profile: {
          ...child.profile,
          ...policyProfile(admission.policy),
          projectRoot: admission.workspace.mode === 'isolated-worktree' ? admission.workspace.worktreePath : admission.workspace.projectRoot,
        },
        status: 'queued',
      },
      recordLifecycle: (sessionId, lifecycle, admittedRunId) => appendLifecycle(state, sessionId, lifecycle, admittedRunId),
    })
    if (!outcome.ok) return { ok: false, reason: outcome.message }
    const parent = state.sessions.find((session) => session.id === child.parentSessionId)
    if (parent && !collaborationEvents(parent).some((event) => event.type === 'spawned' && event.agentId === child.id)) {
      appendEvent(state, parent.id, { type: 'spawned', agentId: child.id, runId, admission })
    }
    return { ok: true, queue: outcome.queue, runId, revision: lease.revision }
  }

  private resumeSerializedConflicts(state: PiAgentCommunicationState, releasedOwnerId: string): void {
    for (const child of state.sessions) {
      if (isTerminalAgentLifecycle(lifecycleOf(child)) || lifecycleOf(child) !== 'blocked') continue
      const conflict = collaborationEvents(child).find((event): event is Extract<AgentCollaborationEvent, { type: 'conflict' }> => event.type === 'conflict' && event.conflict.ownerAgentId === releasedOwnerId)?.conflict
      if (!conflict) continue
      const resolution = collaborationEvents(child).find((event): event is Extract<AgentCollaborationEvent, { type: 'conflict-resolved' }> => event.type === 'conflict-resolved' && event.conflictId === conflict.conflictId && event.action === 'serialize')
      if (!resolution) continue
      const queued = this.queueBlockedChild(state, child)
      if (queued.ok) state.queue = queued.queue
    }
  }

  private recordConflictResolution(state: PiAgentCommunicationState, conflict: AgentConflictEvent, requestedBy: string, action: AgentConflictEvent['choices'][number], revision: number): void {
    const recipients = new Set([conflict.requesterAgentId, conflict.ownerAgentId, conflict.parentAgentId].filter(Boolean) as string[])
    for (const agentId of recipients) {
      const session = state.sessions.find((candidate) => candidate.id === agentId)
      if (!session || collaborationEvents(session).some((event) => event.type === 'conflict-resolved' && event.conflictId === conflict.conflictId)) continue
      appendEvent(state, agentId, { type: 'conflict-resolved', conflictId: conflict.conflictId, action, requestedBy, agentId: conflict.requesterAgentId, revision })
    }
  }

  private isDescendant(sessions: readonly SessionRecord[], candidateId: string, ancestorId: string): boolean {
    let current = sessions.find((session) => session.id === candidateId)
    const seen = new Set<string>()
    while (current?.parentSessionId && !seen.has(current.id)) {
      if (current.parentSessionId === ancestorId) return true
      seen.add(current.id)
      current = sessions.find((session) => session.id === current?.parentSessionId)
    }
    return false
  }

  private completionAcknowledged(sessions: readonly SessionRecord[], child: SessionRecord): boolean {
    if (!child.parentSessionId) return true
    const parent = sessions.find((session) => session.id === child.parentSessionId)
    if (!parent) return false
    const completion = projectedMailbox(parent).filter((message) => message.kind === 'completion' && message.senderAgentId === child.id).at(-1)
    return completion?.deliveryState === 'acknowledged'
  }

  private releaseWorkspaceLease(state: PiAgentCommunicationState, session: SessionRecord): void {
    const acquired = [...collaborationEvents(session)].reverse().find((event) => event.type === 'lease-acquired')
    if (!acquired || acquired.type !== 'lease-acquired') return
    const released = collaborationEvents(session).some((event) => event.type === 'lease-released' && event.revision >= acquired.revision)
    if (!released) appendEvent(state, session.id, { type: 'lease-released', agentId: session.id, resource: acquired.resource, revision: acquired.revision })
  }

  private recordConflict(state: PiAgentCommunicationState, conflict: import('../src/agent/agentCollaboration.ts').AgentConflictEvent): void {
    const recipients = new Set([conflict.requesterAgentId, conflict.ownerAgentId, conflict.parentAgentId].filter(Boolean) as string[])
    for (const agentId of recipients) {
      const session = state.sessions.find((candidate) => candidate.id === agentId)
      if (!session || collaborationEvents(session).some((event) => event.type === 'conflict' && event.conflict.conflictId === conflict.conflictId)) continue
      appendEvent(state, agentId, { type: 'conflict', conflict })
    }
  }

  private closestCommonParent(sessions: readonly SessionRecord[], leftId: string, rightId: string): string | undefined {
    const lineage = (agentId: string) => {
      const result: string[] = []
      let current = sessions.find((session) => session.id === agentId)
      while (current) {
        result.push(current.id)
        current = current.parentSessionId ? sessions.find((session) => session.id === current?.parentSessionId) : undefined
      }
      return result
    }
    const right = new Set(lineage(rightId))
    return lineage(leftId).find((agentId) => right.has(agentId))
  }
}

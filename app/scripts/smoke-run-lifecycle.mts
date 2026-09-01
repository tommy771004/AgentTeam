import {
  deriveRunLifecycle,
  isIterationExhausted,
  iterationExhaustedLabel,
  orchestrationFromAgent,
} from '../src/agent/runLifecycle.ts'
import { deriveSubDesignWorkspace } from '../src/agent/subdesign/workspaceProjection.ts'
import { useRunActivityStore } from '../src/store/runActivityStore.ts'
import { continuationAnchorBubbleId } from '../src/agent/conversationRunLifecycle.ts'
import {
  deriveRunOutcome,
  executionSettlementFromTurnSettlement,
  type GoalVerdict,
} from '../src/agent/goalOutcome.ts'
import {
  agentLifecycleFromExecutionSettlement,
  agentLifecycleFromTurnSettlement,
} from '../src/agent/agentLifecycle.ts'
import { useAgentStore } from '../src/store/agentStore.ts'

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

const store = useRunActivityStore.getState()
store.clear()
store.begin('lifecycle_smoke')

let presentation = useRunActivityStore.getState().getPresentation('lifecycle_smoke')
assert(presentation?.active, 'run should be active after begin')
assert(presentation?.phase === 'starting', 'run should start in starting phase')

let view = deriveRunLifecycle({ phase: 'starting', status: 'running', active: true })
assert(view.live && view.tone === 'active', 'starting should use the live loading grammar')
view = deriveRunLifecycle({ phase: 'awaiting_user', status: 'awaiting_user', active: true })
assert(view.needsAttention && view.tone === 'attention' && view.label === '等待你的回覆', 'awaiting_user should be an explicit attention state')
view = deriveRunLifecycle({ phase: 'executing', status: 'running', active: true, approvalPending: true })
assert(view.needsAttention && view.live && view.label === '等待核准', 'permission asks should interrupt the loading grammar')
view = deriveRunLifecycle({ phase: 'manual_intervention', status: 'manual_intervention', active: true })
assert(view.needsAttention && view.label === '等待核准', 'manual intervention should use the approval grammar')

store.setTasks([{ text: '檢查專案', status: 'active' }, { text: '回報結果', status: 'pending' }], 'lifecycle_smoke')
assert(useRunActivityStore.getState().getPresentation('lifecycle_smoke')?.phase === 'planning', 'plan should enter planning phase')

store.appendThought('先檢查目前狀態', 'lifecycle_smoke')
assert(useRunActivityStore.getState().getPresentation('lifecycle_smoke')?.phase === 'thinking', 'thought should enter thinking phase')

store.push({ kind: 'tool', runId: 'lifecycle_smoke', title: '已執行 read_file', tool: 'read_file', callId: 'call_1' })
assert(useRunActivityStore.getState().getPresentation('lifecycle_smoke')?.phase === 'executing', 'tool should enter executing phase')

store.appendText('檢查完成。', 'lifecycle_smoke')
assert(useRunActivityStore.getState().getPresentation('lifecycle_smoke')?.phase === 'responding', 'text should enter responding phase')

store.setStatus('正在整理執行摘要…', 'lifecycle_smoke')
assert(useRunActivityStore.getState().getPresentation('lifecycle_smoke')?.phase === 'finalizing', 'summary should enter finalizing phase')
view = deriveRunLifecycle({ phase: 'finalizing', status: 'success', active: true })
assert(view.live && !view.canStop, 'finalizing should remain visible but not be stoppable')

store.end('lifecycle_smoke', '完成')
presentation = useRunActivityStore.getState().getPresentation('lifecycle_smoke')
assert(!presentation?.active, 'run should be inactive after end')
assert(presentation?.phase === 'completed', 'successful run should be completed')
assert(presentation?.terminal?.phase === 'completed', 'terminal digest should preserve completed phase')
view = deriveRunLifecycle({
  phase: 'completed',
  status: 'success',
  active: true,
  terminal: true,
  outcome: { executionSettlement: 'completed', goalVerdict: 'passed' },
})
assert(!view.live && view.terminal && view.tone === 'success', 'terminal state must stop live motion')

// ── Orthogonal execution / Goal / finalization outcomes (ticket 02) ──
assert(executionSettlementFromTurnSettlement('answered') === 'completed', 'answered is an execution observation')
assert(executionSettlementFromTurnSettlement('empty') === 'completed', 'an empty provider turn still completed execution')
assert(agentLifecycleFromTurnSettlement('empty') === 'completed', 'actor lifecycle follows execution, not answer content')
assert(agentLifecycleFromExecutionSettlement('completed') === 'completed', 'child actor completion is execution-only')

for (const goalVerdict of ['failed', 'unverifiable', 'exhausted'] as const satisfies readonly GoalVerdict[]) {
  const outcome = deriveRunOutcome({ turnSettlement: 'answered', goalVerdict, appFinalization: 'pending' })
  assert(outcome.turnSettlement === 'answered', `${goalVerdict}: answer observation must survive`)
  assert(outcome.executionSettlement === 'completed', `${goalVerdict}: execution must remain completed`)
  assert(outcome.goalVerdict === goalVerdict, `${goalVerdict}: Goal truth must remain independent`)
  const finalized = deriveRunOutcome({ ...outcome, appFinalization: 'completed' })
  assert(finalized.executionSettlement === outcome.executionSettlement, `${goalVerdict}: finalization cannot rewrite execution`)
  assert(finalized.goalVerdict === outcome.goalVerdict, `${goalVerdict}: finalization cannot rewrite Goal truth`)
}

const childOnly = deriveRunOutcome({ executionSettlement: 'completed' })
assert(childOnly.goalVerdict === undefined && childOnly.goalProjection === undefined, 'child completed cannot pass its parent Goal')
const legacyUnknown = deriveRunOutcome({ executionKind: 'loop', legacyStatus: 'success' })
assert(legacyUnknown.goalVerdict === undefined, 'legacy-unverified must never enter canonical GoalVerdict')
assert(legacyUnknown.goalProjection === 'legacy-unverified', 'legacy records without proof project conservatively')

view = deriveRunLifecycle({
  status: 'success',
  terminal: true,
  outcome: { turnSettlement: 'answered', goalVerdict: 'unverifiable' },
})
assert(view.outcome.executionSettlement === 'completed', 'UI projection keeps execution completion')
assert(view.outcome.goalVerdict === 'unverifiable', 'UI projection keeps the independent Goal verdict')
assert(view.tone === 'attention' && view.label.includes('無法驗證'), 'UI must not render unverifiable as success')

const eventCount = presentation?.events.length || 0
store.push({ kind: 'tool', runId: 'lifecycle_smoke', title: 'late event', callId: 'late' })
assert(useRunActivityStore.getState().getPresentation('lifecycle_smoke')?.events.length === eventCount, 'late events must not reopen a terminal run')

// A settled run's controls belong to its own recorded summary. When the next
// user turn is admitted or queued, those controls must stay above that new
// message instead of being appended to the conversation tail.
const previousRunBubbles = [
  { id: 'answer-a', role: 'assistant' as const },
  { id: 'summary-a', role: 'run' as const, runSummary: { runId: 'run-a' } },
  { id: 'user-b', role: 'user' as const },
]
assert(
  continuationAnchorBubbleId(previousRunBubbles, 'run-a') === 'summary-a',
  'terminal continuation controls must remain anchored to the owning summary before the next turn',
)
assert(
  continuationAnchorBubbleId(previousRunBubbles, 'run-b') === null,
  'a new run must never borrow the previous run summary as its continuation anchor',
)

// ── Iteration-exhausted terminal vocabulary (issue 01) ──
const exhausted = { iterations: 5, maxIterations: 5, dodMet: false, executionKind: 'loop' as const }
view = deriveRunLifecycle({ status: 'success', terminal: true, orchestration: exhausted })
assert(view.iterationExhausted, 'a spent iteration budget with an unmet DoD must be flagged')
assert(view.label === '已完成（未達 DoD · 用盡 5 輪）', `exhausted label must be honest, got ${view.label}`)
assert(view.tone === 'attention', 'exhausted runs must not use the success tone')
assert(view.icon !== 'check_circle', 'exhausted runs must not reuse the success check mark')
assert(view.label === iterationExhaustedLabel(5), 'label must come from the shared wording helper')

view = deriveRunLifecycle({ status: 'success', terminal: true, orchestration: { ...exhausted, dodMet: true } })
assert(!view.iterationExhausted && view.tone === 'success' && view.icon === 'check_circle', 'a met DoD stays a plain success')

view = deriveRunLifecycle({ status: 'success', terminal: true, orchestration: { iterations: 2, maxIterations: 5, dodMet: false } })
assert(!view.iterationExhausted, 'an unmet DoD with budget left is not exhaustion')

view = deriveRunLifecycle({ status: 'success', terminal: true })
assert(!view.iterationExhausted && view.tone === 'attention', 'legacy success without Goal proof must not become passed')
assert(view.outcome.goalProjection === 'legacy-unverified', 'legacy success is explicitly unverified')

// External CLI never claims a DoD, so it can never read as failing one.
assert(!isIterationExhausted({ ...exhausted, executionKind: 'external' }), 'external CLI runs must never claim or fail a DoD')
view = deriveRunLifecycle({ status: 'success', terminal: true, orchestration: { ...exhausted, executionKind: 'external' } })
assert(!view.iterationExhausted && view.label === '已完成', 'external CLI terminal wording is unaffected')

// HITL precedence and the live activity phase must be untouched by the new field.
view = deriveRunLifecycle({ phase: 'executing', status: 'success', active: true, approvalPending: true, orchestration: exhausted })
assert(view.label === '等待核准' && view.tone === 'attention' && !view.iterationExhausted, 'HITL must still outrank a terminal snapshot')
view = deriveRunLifecycle({ phase: 'awaiting_user', status: 'success', active: true, orchestration: exhausted })
assert(view.label === '等待你的回覆' && !view.iterationExhausted, 'awaiting_user must still outrank a terminal snapshot')
view = deriveRunLifecycle({ phase: 'finalizing', status: 'success', active: true, orchestration: exhausted })
assert(view.live && !view.iterationExhausted, 'an active finalizing phase still wins over the terminal snapshot')

// The three consuming surfaces read one projection, not three judgements.
const fromAgent = orchestrationFromAgent({
  executionKind: 'loop',
  currentIteration: 5,
  loopConfig: { maxIterations: 5 },
  orchestration: { iterations: 5, maxIterations: 5, dodMet: false },
})
assert(
  deriveRunLifecycle({ status: 'success', terminal: true, orchestration: fromAgent }).label === view.label ||
    deriveRunLifecycle({ status: 'success', terminal: true, orchestration: fromAgent }).label === iterationExhaustedLabel(5),
  'an agent snapshot must project the same exhausted wording',
)
assert(orchestrationFromAgent({ executionKind: 'loop' }) === undefined, 'an agent with no settlement evidence projects nothing')

// A downstream app effect belongs to the post-state/finalization axis. Once
// the Host has settled an answered, completed execution, a failed webhook must
// remain visible without rewriting that immutable execution fact or hiding the
// answer the user already received.
const postStateRunId = 'lifecycle_post_state_failure'
const agentStore = useAgentStore.getState()
agentStore.reserveRun(postStateRunId, 'thread_post_state_failure')
const initialPostStateRun = agentStore.getRunState(postStateRunId)
assert(initialPostStateRun, 'post-state regression run should be reserved')
agentStore.restoreRun({
  runId: postStateRunId,
  threadId: 'thread_post_state_failure',
  state: {
    ...initialPostStateRun,
    status: 'success',
    result: '完整 final 回覆',
    turnSettlement: 'answered',
    executionSettlement: 'completed',
  },
})
useAgentStore.getState().applyPostState(postStateRunId, {
  nextState: 'Dispatch Webhook',
  status: 'failed',
  attemptedAt: '2026-09-01T00:00:00.000Z',
  error: 'upstream unavailable',
})
const postStateFailedRun = useAgentStore.getState().getRunState(postStateRunId)
assert(postStateFailedRun?.result === '完整 final 回覆', 'post-state failure must preserve the final answer')
assert(postStateFailedRun?.status === 'success', 'post-state failure must not rewrite completed execution status')
assert(postStateFailedRun.executionSettlement === 'completed', 'post-state failure must preserve execution settlement')
assert(postStateFailedRun.postState?.status === 'failed', 'post-state failure must remain independently inspectable')
view = deriveRunLifecycle({
  status: postStateFailedRun.status,
  terminal: true,
  outcome: {
    turnSettlement: postStateFailedRun.turnSettlement,
    executionSettlement: postStateFailedRun.executionSettlement,
  },
})
assert(view.label !== '執行失敗' && view.tone !== 'danger', 'post-state failure must not project as execution failure')
useAgentStore.getState().releaseRun(postStateRunId)

const brief = {
  id: 'brief_exhausted',
  threadId: 'thread_exhausted',
  objective: '設計一個登入頁',
  stage: 'build' as const,
  directions: [],
  selectedDirectionId: undefined,
}
const workspace = deriveSubDesignWorkspace({
  brief: brief as never,
  runStatus: 'success',
  orchestration: { iterations: 5, maxIterations: 5, dodMet: false, executionKind: 'loop' },
})
assert(workspace.runStatus === 'exhausted', 'SubDesign must surface the exhausted terminal state')
assert(
  workspace.runStatusLabel === iterationExhaustedLabel(5),
  `SubDesign must render the shared wording, got ${workspace.runStatusLabel}`,
)
const metWorkspace = deriveSubDesignWorkspace({
  brief: brief as never,
  runStatus: 'success',
  orchestration: { iterations: 5, maxIterations: 5, dodMet: true, executionKind: 'loop' },
})
assert(metWorkspace.runStatus === 'success', 'a met DoD keeps the plain SubDesign success state')

// ── cancel_requested: a requested stop is formal live vocabulary (item 5) ──
view = deriveRunLifecycle({ phase: 'executing', status: 'running', active: true, stopping: true })
assert(view.phase === 'cancel_requested', 'an acknowledged stop becomes the cancel_requested phase')
assert(view.label === '正在安全停車…' && !view.canStop && view.live, 'the park answers immediately but stays live')
view = deriveRunLifecycle({ phase: 'cancel_requested', status: 'running', active: true })
assert(view.stopping && !view.canStop, 'the phase alone implies stopping — callers need not repeat the flag')

store.clear()
console.log('run activity lifecycle phases, terminal digest and iteration-exhausted wording are coherent')

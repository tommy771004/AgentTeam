import {
  deriveRunLifecycle,
  isIterationExhausted,
  iterationExhaustedLabel,
  orchestrationFromAgent,
} from '../src/agent/runLifecycle.ts'
import { deriveSubDesignWorkspace } from '../src/agent/subdesign/workspaceProjection.ts'
import { useRunActivityStore } from '../src/store/runActivityStore.ts'

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
view = deriveRunLifecycle({ phase: 'completed', status: 'success', active: true, terminal: true })
assert(!view.live && view.terminal && view.tone === 'success', 'terminal state must stop live motion')

const eventCount = presentation?.events.length || 0
store.push({ kind: 'tool', runId: 'lifecycle_smoke', title: 'late event', callId: 'late' })
assert(useRunActivityStore.getState().getPresentation('lifecycle_smoke')?.events.length === eventCount, 'late events must not reopen a terminal run')

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
assert(!view.iterationExhausted && view.tone === 'success', 'runs without settlement evidence stay unchanged')

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

import { deriveRunLifecycle } from '../src/agent/runLifecycle.ts'
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

store.clear()
console.log('run activity lifecycle phases and terminal digest are coherent')

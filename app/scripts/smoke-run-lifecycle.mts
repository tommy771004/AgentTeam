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

store.end('lifecycle_smoke', '完成')
presentation = useRunActivityStore.getState().getPresentation('lifecycle_smoke')
assert(!presentation?.active, 'run should be inactive after end')
assert(presentation?.phase === 'completed', 'successful run should be completed')
assert(presentation?.terminal?.phase === 'completed', 'terminal digest should preserve completed phase')

const eventCount = presentation?.events.length || 0
store.push({ kind: 'tool', runId: 'lifecycle_smoke', title: 'late event', callId: 'late' })
assert(useRunActivityStore.getState().getPresentation('lifecycle_smoke')?.events.length === eventCount, 'late events must not reopen a terminal run')

store.clear()
console.log('run activity lifecycle phases and terminal digest are coherent')

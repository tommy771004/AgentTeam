import assert from 'node:assert/strict'
import { applyPiHostActivityUpdate, mapPiHostEventToActivity } from '../src/agent/piHostActivity.ts'
import { useRunActivityStore } from '../src/store/runActivityStore.ts'

const text = mapPiHostEventToActivity({
  event: 'host/turn-item',
  payload: {
    runId: 'run-1',
    item: {
      type: 'message_update',
      assistantMessageEvent: { type: 'text_delta', delta: '正在回覆' },
    },
  },
})
assert.deepEqual(text, {
  kind: 'text',
  runId: 'run-1',
  delta: '正在回覆',
})

const tool = mapPiHostEventToActivity({
  event: 'host/tool-start',
  payload: {
    runId: 'run-1',
    tool: 'read',
    callId: 'call-1',
    item: { path: '/tmp/example.txt' },
  },
})

const context = mapPiHostEventToActivity({
  event: 'host/context',
  payload: { runId: 'run-context', phase: 'model-switched', provider: 'loopback', model: 'small-model', contextWindowTokens: 10 },
})
assert.deepEqual(context, {
  kind: 'status',
  runId: 'run-context',
  title: '模型已切換為 loopback/small-model',
  detail: '10 tokens',
  eventId: 'pi-context-model-loopback-small-model',
})
assert.deepEqual(tool, {
  kind: 'tool',
  runId: 'run-1',
  title: '執行 read…',
  detail: '/tmp/example.txt',
  tool: 'read',
  phase: 'executing',
  eventId: 'pi-call-1-start',
  callId: 'call-1',
})

// ── Structured phase: the Host's stage vocabulary wins over copy regexes ──
const orchestrationParse = mapPiHostEventToActivity({
  event: 'host/orchestration',
  payload: { runId: 'run-1', phase: 'parse' },
})
assert.equal(orchestrationParse?.phase, 'planning')

const orchestrationIterate = mapPiHostEventToActivity({
  event: 'host/orchestration',
  payload: { runId: 'run-1', phase: 'iterate', iteration: 2 },
})
assert.equal(orchestrationIterate?.phase, 'executing')

const orchestrationSettlement = mapPiHostEventToActivity({
  event: 'host/orchestration',
  payload: { runId: 'run-1', phase: 'settlement', detail: '完成' },
})
assert.equal(orchestrationSettlement?.phase, 'finalizing')

const orchestrationCancelled = mapPiHostEventToActivity({
  event: 'host/orchestration',
  payload: { runId: 'run-1', phase: 'cancelled' },
})
assert.equal(orchestrationCancelled?.phase, 'cancelled')
assert.equal(orchestrationCancelled?.kind, 'error')

// A pending permission decision is the HITL phase, not just a status line.
const decisionPending = mapPiHostEventToActivity({
  event: 'host/tool-decision',
  payload: { runId: 'run-1', tool: 'bash', callId: 'c9', decision: 'pending' },
})
assert.equal(decisionPending?.phase, 'manual_intervention')

const turnEnd = mapPiHostEventToActivity({
  event: 'host/turn-item',
  payload: { runId: 'run-1', item: { type: 'turn_end' } },
})
assert.equal(turnEnd?.phase, 'finalizing')

const plan = mapPiHostEventToActivity({
  event: 'host/plan-updated',
  payload: {
    runId: 'run-1',
    sessionId: 'session-1',
    steps: [
      { id: 'inspect', title: '讀取既有投影', status: 'done' },
      {
        id: 'fix',
        title: '修正任務進度',
        status: 'in_progress',
        meta: '2 files',
        details: [{ label: '接上 Task Row', meta: 'done' }],
      },
    ],
  },
})
assert.deepEqual(plan, {
  kind: 'plan',
  runId: 'run-1',
  tasks: [
    { id: 'inspect', text: '讀取既有投影', status: 'done' },
    { id: 'fix', text: '修正任務進度', status: 'active', meta: '2 files', details: [{ label: '接上 Task Row', meta: 'done' }] },
  ],
})
useRunActivityStore.getState().clear()
useRunActivityStore.getState().begin('run-1', 'thread-1')
applyPiHostActivityUpdate(useRunActivityStore.getState(), plan!)
assert.deepEqual(
  useRunActivityStore.getState().getPresentation('run-1')?.tasks.map(({ id, text, status, meta, details }) => ({ id, text, status, ...(meta ? { meta } : {}), ...(details ? { details } : {}) })),
  plan?.kind === 'plan' ? plan.tasks : [],
  'Host plan update reaches the run-scoped task presentation',
)
useRunActivityStore.getState().clear()

console.log('pi host activity events map to renderer progress updates')

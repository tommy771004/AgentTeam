import assert from 'node:assert/strict'
import { mapPiHostEventToActivity } from '../src/agent/piHostActivity.ts'

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

console.log('pi host activity events map to renderer progress updates')

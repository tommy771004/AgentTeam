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
assert.deepEqual(tool, {
  kind: 'tool',
  runId: 'run-1',
  title: '執行 read…',
  detail: '/tmp/example.txt',
  tool: 'read',
  eventId: 'pi-call-1-start',
  callId: 'call-1',
})

console.log('pi host activity events map to renderer progress updates')

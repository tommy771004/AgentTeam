import assert from 'node:assert/strict'
import { submitPiHostRun } from '../src/agent/piHostRun.ts'

const calls: string[] = []
const api = {
  sessions: {
    list: async () => ({ sessions: [{ id: 'parent', title: 'Parent', threadId: 'thread-1', messages: [] }] }),
    create: async () => ({ sessionId: 'unused', sessions: [] }),
    createChild: async (input: Record<string, unknown>) => {
      calls.push(`child:${input.parentSessionId}:${input.role}:${String((input.profile as Record<string, unknown>).model)}`)
      return { sessionId: 'child-1', sessions: [] }
    },
  },
  turn: {
    submit: async (input: { sessionId: string; prompt: string }) => {
      calls.push(`turn:${input.sessionId}`)
      return { sessionId: input.sessionId, runId: 'run-child', settlement: 'answered', items: [{ type: 'assistant_message', content: 'child result' }] }
    },
  },
}

const result = await submitPiHostRun(api, {
  threadId: 'thread-1', title: 'Parent', prompt: 'inspect', runId: 'run-child',
  child: { role: 'explore', profile: { model: 'explore-model' }, context: { objective: 'inspect', facts: ['fact'], constraints: ['read-only'] }, depth: 1 },
})
assert.equal(result.sessionId, 'child-1')
assert.equal(result.result, 'child result')
assert.deepEqual(calls, ['child:parent:explore:explore-model', 'turn:child-1'])
console.log('Pi Host runner delegates through bounded Child Pi Sessions')

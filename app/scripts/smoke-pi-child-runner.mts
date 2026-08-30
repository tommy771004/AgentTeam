import assert from 'node:assert/strict'
import { submitPiHostRun } from '../src/agent/piHostRun.ts'

const calls: string[] = []
const api = {
  sessions: {
    list: async () => ({ sessions: [{ id: 'parent', title: 'Parent', threadId: 'thread-1', messages: [] }] }),
    create: async () => ({ sessionId: 'unused', sessions: [] }),
  },
  turn: {
    submit: async (input: { sessionId: string; prompt: string; profile?: Record<string, unknown> }) => {
      calls.push(`turn:${input.sessionId}:${String(input.profile?.model)}:${input.prompt.includes('本輪角色疊層')}`)
      return { sessionId: input.sessionId, runId: 'run-child', settlement: 'answered', items: [{ type: 'assistant_message', content: 'child result' }] }
    },
  },
}

const result = await submitPiHostRun(api, {
  threadId: 'thread-1', title: 'Parent', prompt: 'inspect', runId: 'run-child',
  child: { role: 'explore', profile: { model: 'explore-model' }, context: { objective: 'inspect', facts: ['fact'], constraints: ['read-only'] }, depth: 1 },
})
assert.equal(result.sessionId, 'parent')
assert.equal(result.result, 'child result')
assert.deepEqual(calls, ['turn:parent:explore-model:true'])
console.log('renderer persona selection stays a restrictive turn overlay; child admission is Host-only')

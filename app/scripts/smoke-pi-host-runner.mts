import assert from 'node:assert/strict'
import { submitPiHostRun } from '../src/agent/piHostRun.ts'

const calls: string[] = []
const sessions = [{ id: 'pi-session-existing', threadId: 'thread-existing', title: 'Existing', messages: [] }]
const api = {
  sessions: {
    list: async () => ({ sessions }),
    create: async (title?: string, threadId?: string) => {
      calls.push(`create:${title}:${threadId}`)
      const session = { id: 'pi-session-new', threadId, title: title || 'New', messages: [] }
      sessions.push(session)
      return { sessionId: session.id, sessions: [session] }
    },
  },
  turn: {
    submit: async (input: { sessionId: string; prompt: string; runId?: string; cwd?: string; profile?: Record<string, unknown> }) => {
      calls.push(`turn:${input.sessionId}:${input.runId}:${input.cwd}:${String(input.profile?.model || '')}`)
      return {
        sessionId: input.sessionId,
        runId: input.runId || 'generated',
        settlement: 'success',
        items: [{ type: 'assistant_message', content: `answer for ${input.prompt}` }],
      }
    },
  },
}

const existing = await submitPiHostRun(api, {
  threadId: 'thread-existing',
  title: 'Ignored title',
  prompt: 'existing turn',
  runId: 'run-existing',
  cwd: '/tmp/project',
  profile: { model: 'writer-model' },
})
assert.equal(existing.sessionId, 'pi-session-existing')
assert.equal(existing.result, 'answer for existing turn')
assert.deepEqual(calls, ['turn:pi-session-existing:run-existing:/tmp/project:writer-model'])

const created = await submitPiHostRun(api, {
  threadId: 'thread-new',
  title: 'New thread',
  prompt: 'new turn',
  runId: 'run-new',
  cwd: '/tmp/project',
})
assert.equal(created.sessionId, 'pi-session-new')
assert.equal(created.result, 'answer for new turn')
assert.deepEqual(calls, [
  'turn:pi-session-existing:run-existing:/tmp/project:writer-model',
  'create:New thread:thread-new',
  'turn:pi-session-new:run-new:/tmp/project:',
])

console.log('Pi Host runner binds one Pi session to each renderer thread')

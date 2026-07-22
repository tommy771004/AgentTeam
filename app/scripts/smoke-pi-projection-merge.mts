import assert from 'node:assert/strict'
import { projectPiSession } from '../src/agent/piHostProjection.ts'

const projected = projectPiSession({
  id: 'pi-session-1',
  threadId: 'thread-1',
  title: 'Canonical Pi history',
  messages: [
    { role: 'user', content: 'hello' },
    { role: 'assistant', content: 'from Pi' },
  ],
})

assert.deepEqual(projected, {
  threadId: 'thread-1',
  title: 'Canonical Pi history',
  bubbles: [
    { id: 'pi-session-1:0', role: 'user', content: 'hello', at: 'pi-session-1:0' },
    { id: 'pi-session-1:1', role: 'assistant', content: 'from Pi', at: 'pi-session-1:1' },
  ],
})

console.log('Pi Host session history projects deterministically into the disposable UI view')

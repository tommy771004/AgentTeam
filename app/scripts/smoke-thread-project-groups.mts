import assert from 'node:assert/strict'
import { buildProjectGroups, COLLAPSED_PER_PROJECT } from '../src/lib/threadProjectGroups.ts'
import type { Thread } from '../src/store/threadStore.ts'

function thread(partial: Partial<Thread> & { id: string }): Thread {
  return {
    title: partial.id,
    model: '',
    thinkingDepth: 'deep',
    speed: 'standard',
    agentMode: 'build',
    runner: 'builtin',
    loopType: null,
    bubbles: [],
    createdAt: '2026-08-20T00:00:00.000Z',
    updatedAt: '2026-08-20T00:00:00.000Z',
    lastStatus: 'idle',
    ...partial,
  } as Thread
}

// The active project always gets a row, even before its first conversation.
// That empty group is what renders 「沒有對話」.
const emptyActive = buildProjectGroups([], '/Users/me/productivity-hub', '')
assert.equal(emptyActive.length, 1)
assert.equal(emptyActive[0].label, 'productivity-hub')
assert.deepEqual(emptyActive[0].threads, [])

const groups = buildProjectGroups(
  [
    thread({ id: 'a1', projectRoot: '/Users/me/AgentTeam', updatedAt: '2026-08-19T00:00:00.000Z' }),
    thread({ id: 't1', projectRoot: '/Users/me/Taiwanrail', updatedAt: '2026-08-18T00:00:00.000Z' }),
    thread({ id: 'a2', projectRoot: '/Users/me/AgentTeam', updatedAt: '2026-08-17T00:00:00.000Z' }),
    thread({ id: 'p1', projectRoot: '/Users/me/Productivity', updatedAt: '2026-08-20T00:00:00.000Z' }),
    thread({ id: 'u1', updatedAt: '2026-08-21T00:00:00.000Z' }),
    thread({ id: 'hidden', projectRoot: '/Users/me/AgentTeam', hidden: true }),
  ],
  '/Users/me/Taiwanrail',
  'Taiwanrail',
)

// Active project leads; the rest by most recent activity; unbound always last.
assert.deepEqual(
  groups.map((group) => group.label),
  ['Taiwanrail', 'Productivity', 'AgentTeam', '未綁定專案'],
)

// Hidden background worker threads never reach the sidebar.
const agentTeam = groups.find((group) => group.label === 'AgentTeam')!
assert.deepEqual(agentTeam.threads.map((t) => t.id), ['a1', 'a2'])

// Windows-style roots resolve to the same trailing folder name.
assert.equal(buildProjectGroups([thread({ id: 'w', projectRoot: 'C:\\src\\Taiwanrail' })], '')[0].label, 'Taiwanrail')

assert.ok(COLLAPSED_PER_PROJECT > 0, '顯示更多 threshold must be positive')

console.log('thread project groups smoke: active-first ordering, empty project row, hidden threads excluded')

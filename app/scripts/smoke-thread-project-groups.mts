import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import {
  buildProjectGroups,
  COLLAPSED_PER_PROJECT,
  mergeProjectOrder,
  mergeThreadOrder,
  moveProjectByOffset,
  nextThreadAfterDelete,
  parseProjectOrder,
  reconcileProjectOrder,
  reorderProject,
  projectThreadSidebar,
} from '../src/lib/threadProjectGroups.ts'
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

// Once the user has a sidebar order, selection and activity timestamps must
// never promote a project. The same persisted order is applied after remount.
const fixedOrder = ['/Users/me/AgentTeam', '/Users/me/Taiwanrail', '/Users/me/Productivity']
assert.deepEqual(parseProjectOrder(JSON.stringify(fixedOrder)), fixedOrder)
assert.deepEqual(parseProjectOrder('{broken'), [])
const selectedElsewhere = buildProjectGroups(
  [
    thread({ id: 'a', projectRoot: '/Users/me/AgentTeam', updatedAt: '2026-08-01T00:00:00.000Z' }),
    thread({ id: 't', projectRoot: '/Users/me/Taiwanrail', updatedAt: '2026-09-01T00:00:00.000Z' }),
    thread({ id: 'p', projectRoot: '/Users/me/Productivity', updatedAt: '2026-10-01T00:00:00.000Z' }),
  ],
  '/Users/me/Productivity',
  'Productivity',
  fixedOrder,
)
assert.deepEqual(selectedElsewhere.map((group) => group.key), fixedOrder)

const fixedThreadOrder = ['a2', 'a1', 'p1']
const hostReordered = buildProjectGroups(
  [
    thread({ id: 'p1', projectRoot: '/Users/me/Productivity' }),
    thread({ id: 'a1', projectRoot: '/Users/me/AgentTeam' }),
    thread({ id: 'a2', projectRoot: '/Users/me/AgentTeam' }),
  ],
  '/Users/me/AgentTeam',
  'AgentTeam',
  fixedOrder,
  fixedThreadOrder,
)
assert.deepEqual(
  hostReordered.flatMap((group) => group.threads.map((item) => item.id)),
  fixedThreadOrder,
  'Pi Host enumeration must not replace the durable conversation order',
)
assert.deepEqual(
  mergeThreadOrder(['a1', 'a2', 'dormant'], ['new', 'a2', 'a1']),
  ['new', 'a1', 'a2', 'dormant'],
  'new conversations lead while temporarily absent conversations remain durable',
)
assert.equal(nextThreadAfterDelete(['a1', 'a2', 'p1'], 'a2'), 'p1')
assert.equal(nextThreadAfterDelete(['a1', 'a2', 'p1'], 'p1'), 'a2')

// Dragging is deterministic, and lifecycle reconciliation removes vanished
// folders while appending newly discovered folders without disturbing survivors.
assert.deepEqual(
  reorderProject(fixedOrder, '/Users/me/Productivity', '/Users/me/AgentTeam'),
  ['/Users/me/Productivity', '/Users/me/AgentTeam', '/Users/me/Taiwanrail'],
)
assert.deepEqual(
  reorderProject(fixedOrder, '/Users/me/AgentTeam', '/Users/me/Productivity', 'after'),
  ['/Users/me/Taiwanrail', '/Users/me/Productivity', '/Users/me/AgentTeam'],
)
assert.deepEqual(
  moveProjectByOffset(fixedOrder, '/Users/me/Taiwanrail', -1),
  ['/Users/me/Taiwanrail', '/Users/me/AgentTeam', '/Users/me/Productivity'],
)
assert.deepEqual(
  reconcileProjectOrder(
    ['/removed', '/Users/me/Productivity', '/Users/me/AgentTeam'],
    ['/Users/me/AgentTeam', '/Users/me/NewProject', '/Users/me/Productivity'],
  ),
  ['/Users/me/Productivity', '/Users/me/AgentTeam', '/Users/me/NewProject'],
)
// A transient pre-hydration frame must not erase dormant persisted folders.
assert.deepEqual(
  mergeProjectOrder(['/Users/me/AgentTeam', '/Users/me/Productivity'], ['/Users/me/AgentTeam']),
  ['/Users/me/AgentTeam', '/Users/me/Productivity'],
)
const boundedDormantOrder = mergeProjectOrder(
  Array.from({ length: 520 }, (_, index) => `/dormant/${index}`),
  ['/live'],
)
assert.ok(boundedDormantOrder.length <= 512, 'dormant ordering preferences stay bounded')
assert.ok(boundedDormantOrder.includes('/live'), 'bounding never discards a live project')

// Hidden background worker threads never reach the sidebar.
const agentTeam = groups.find((group) => group.label === 'AgentTeam')!
assert.deepEqual(agentTeam.threads.map((t) => t.id), ['a1', 'a2'])

// Windows-style roots resolve to the same trailing folder name.
assert.equal(buildProjectGroups([thread({ id: 'w', projectRoot: 'C:\\src\\Taiwanrail' })], '')[0].label, 'Taiwanrail')

assert.ok(COLLAPSED_PER_PROJECT > 0, '顯示更多 threshold must be positive')

const sidebarThreads = [
  thread({ id: 'a1', title: 'Release checklist', projectRoot: '/Users/me/AgentTeam', updatedAt: '2026-08-22T00:00:00.000Z' }),
  thread({ id: 'a2', title: 'Sidebar navigation', projectRoot: '/Users/me/AgentTeam', updatedAt: '2026-08-21T00:00:00.000Z' }),
  thread({ id: 'a3', title: 'Sidebar keyboard review', projectRoot: '/Users/me/AgentTeam', updatedAt: '2026-08-20T00:00:00.000Z' }),
  thread({ id: 'a4', title: 'Sidebar mobile drawer', projectRoot: '/Users/me/AgentTeam', updatedAt: '2026-08-19T00:00:00.000Z' }),
  thread({ id: 'a5', title: 'Sidebar older result', projectRoot: '/Users/me/AgentTeam', updatedAt: '2026-08-18T00:00:00.000Z' }),
  thread({ id: 'p1', title: 'Sidebar from another project', projectRoot: '/Users/me/Productivity', updatedAt: '2026-08-23T00:00:00.000Z' }),
  thread({ id: 'hidden-match', title: 'Sidebar hidden worker', projectRoot: '/Users/me/AgentTeam', hidden: true }),
]

const collapsedSidebar = projectThreadSidebar({
  threads: sidebarThreads,
  activeRoot: '/Users/me/AgentTeam',
  activeName: 'AgentTeam',
  query: '',
  expanded: false,
})
assert.equal(collapsedSidebar.searching, false)
assert.equal(collapsedSidebar.truncated, true)
assert.equal(collapsedSidebar.noResults, false)
assert.deepEqual(collapsedSidebar.groups[0].threads.map((item) => item.id), ['a1', 'a2', 'a3', 'a4'])

const searchedSidebar = projectThreadSidebar({
  threads: sidebarThreads,
  activeRoot: '/Users/me/AgentTeam',
  activeName: 'AgentTeam',
  query: '  SIDEBAR  ',
  expanded: false,
})
assert.equal(searchedSidebar.searching, true)
assert.equal(searchedSidebar.truncated, false)
assert.equal(searchedSidebar.noResults, false)
assert.deepEqual(
  searchedSidebar.groups.map((group) => [group.label, group.threads.map((item) => item.id)]),
  [
    ['AgentTeam', ['a2', 'a3', 'a4', 'a5']],
    ['Productivity', ['p1']],
  ],
)

const emptySearch = projectThreadSidebar({
  threads: sidebarThreads,
  activeRoot: '/Users/me/AgentTeam',
  query: 'not present',
  expanded: false,
})
assert.deepEqual(
  emptySearch.groups.map((group) => [group.label, group.threads.length]),
  [['AgentTeam', 0]],
)
assert.equal(emptySearch.noResults, true)

const otherProjectSearch = projectThreadSidebar({
  threads: sidebarThreads,
  activeRoot: '/Users/me/AgentTeam',
  activeName: 'AgentTeam',
  query: 'another project',
  expanded: false,
})
assert.deepEqual(
  otherProjectSearch.groups.map((group) => [group.label, group.threads.map((item) => item.id)]),
  [
    ['AgentTeam', []],
    ['Productivity', ['p1']],
  ],
)

const expandedSidebar = projectThreadSidebar({
  threads: sidebarThreads,
  activeRoot: '/Users/me/AgentTeam',
  query: '',
  expanded: true,
})
assert.deepEqual(expandedSidebar.groups[0].threads.map((item) => item.id), ['a1', 'a2', 'a3', 'a4', 'a5'])
assert.equal(expandedSidebar.truncated, true)

const threadSidebarSource = await readFile(new URL('../src/components/ThreadSidebar.tsx', import.meta.url), 'utf8')
assert.match(threadSidebarSource, /runningThreadIds\.includes\(t\.id\)/,
  'conversation rows derive their live indicator from the run registry')
assert.match(threadSidebarSource, /role="status"[\s\S]*aria-label="執行中"[\s\S]*name="progress_activity"[\s\S]*animate-spin/,
  'the running conversation renders an accessible animated spinner')
assert.doesNotMatch(threadSidebarSource, /t\.lastStatus === 'running'/,
  'a persisted terminal status must not leave a stale running indicator')
assert.match(threadSidebarSource, /draggable=\{!sidebar\.searching\}/,
  'project folders expose native drag reordering outside filtered search')
assert.match(threadSidebarSource, /THREAD_PROJECT_ORDER_STORAGE_KEY[\s\S]*localStorage\.setItem/,
  'project folder order survives sidebar unmount and app reload')
assert.match(threadSidebarSource, /THREAD_ORDER_STORAGE_KEY[\s\S]*threadOrder: stableThreadOrder/,
  'conversation order survives Host hydration and is applied to the projection')
assert.match(threadSidebarSource, /aria-live="polite"/,
  'keyboard and pointer reordering announce their result')
assert.match(threadSidebarSource, /drag_indicator/,
  'project folders expose a visible drag handle')
assert.match(threadSidebarSource, /Alt\+ArrowUp|event\.altKey/,
  'project folders support keyboard reordering')

const threadStoreSource = await readFile(new URL('../src/store/threadStore.ts', import.meta.url), 'utf8')
assert.match(threadStoreSource, /deleteThread:\s*\(id,\s*nextActiveId\)/,
  'delete accepts the next visible conversation selected by the sidebar')
assert.match(threadStoreSource, /followThreadProject\(nextActive\.projectRoot\)/,
  'deleting the active conversation follows the replacement project context')

const layoutSource = await readFile(new URL('../src/components/Layout.tsx', import.meta.url), 'utf8')
assert.doesNotMatch(layoutSource, /開啟新任務右側 Run 面板|>執行中…</,
  'the global sidebar no longer duplicates the per-conversation running state')

console.log('thread project groups smoke: grouping, hidden exclusion, search, truncation, empty results')

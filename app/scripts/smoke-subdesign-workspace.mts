import assert from 'node:assert/strict'
import { createSubDesignWorkspace, type SubDesignWorkspaceDependencies } from '../src/agent/subdesign/workspace.ts'
import type { SubDesignRunPreparation } from '../src/agent/subdesign/pluginExecutionPreparation.ts'
import type { SubDesignBrief } from '../src/agent/subdesign/types.ts'

function makeBrief(overrides: Partial<SubDesignBrief> = {}): SubDesignBrief {
  return {
    id: 'brief_01',
    threadId: 'thread_01',
    surface: 'prototype',
    objective: '設計商品詳情頁',
    platform: 'responsive',
    fidelity: 'high-fidelity',
    constraints: [],
    acceptanceCriteria: [],
    directions: [],
    stage: 'brief',
    createdAt: '2026-08-22T00:00:00.000Z',
    updatedAt: '2026-08-22T00:00:00.000Z',
    ...overrides,
  }
}

type FakeRun = { objective: string; reuseThreadId?: string; overrides?: unknown; runner?: string; projectRoot?: string }

function dependencies(overrides: Partial<SubDesignWorkspaceDependencies> = {}) {
  const briefs: SubDesignBrief[] = []
  const runs: FakeRun[] = []
  const navigations: string[] = []
  const bindings: Array<{ threadId: string; briefId: string }> = []
  let threadCount = 0
  let briefCount = 0
  let releaseRun: (() => void) | undefined
  const deps: SubDesignWorkspaceDependencies = {
    findBrief: (id) => briefs.find((brief) => brief.id === id) || null,
    getThread: (id) => id === 'thread_01' ? { runner: 'builtin', loopType: null } : null,
    createThread: () => `thread_${++threadCount}`,
    bindBriefToThread: (threadId, briefId) => { bindings.push({ threadId, briefId }) },
    createBrief: (input) => {
      const brief = makeBrief({
        ...input,
        id: `brief_${++briefCount}`,
        threadId: input.threadId,
      })
      briefs.unshift(brief)
      return brief
    },
    selectBrief: () => undefined,
    getDesignSystem: () => null,
    prepareRun: async () => ({ overrides: { marker: 'prepared' } } as unknown as SubDesignRunPreparation),
    runTask: async (input) => {
      runs.push(input)
      if (releaseRun) await new Promise<void>((resolve) => { releaseRun = resolve })
      return { status: 'success', path: 'builtin', threadId: input.reuseThreadId || null, runId: input.runId } as never
    },
    buildPrompt: (brief) => `PROMPT:${brief.objective}`,
    navigate: (path) => navigations.push(path),
    createRunId: (() => {
      let count = 0
      return () => `run_${++count}`
    })(),
    getProjectRoot: () => '/project',
    getCapabilities: () => ({ electron: false, hostEvents: false }),
    ...overrides,
  }
  return { deps, briefs, runs, navigations, bindings, setBlocked: (resolve: () => void) => { releaseRun = resolve } }
}

const first = dependencies()
const workspace = createSubDesignWorkspace(first.deps)
workspace.setModel('model-selected')
const created = await workspace.create({
  objective: '設計商品詳情頁',
  surface: 'prototype',
  platform: 'responsive',
  runner: 'builtin',
  designSystemId: 'ds_01',
  templateId: 'template_01',
})
assert.equal(created.ok, true)
assert.equal(first.briefs.length, 1)
assert.equal(first.runs.length, 1)
assert.deepEqual(first.bindings, [{ threadId: 'thread_1', briefId: 'brief_1' }])
assert.equal(first.runs[0]?.reuseThreadId, first.briefs[0]?.threadId)
assert.equal(first.runs[0]?.objective, 'PROMPT:設計商品詳情頁')
assert.deepEqual(first.runs[0]?.overrides, { marker: 'prepared', model: 'model-selected' })
assert.deepEqual(first.navigations, ['/subdesign/brief_1'])

const missingWorkspace = createSubDesignWorkspace(dependencies().deps)
const missing = missingWorkspace.resume('brief_missing')
assert.equal(missing.ok, false)
assert.equal(missing.kind, 'missing-brief')
assert.equal(missingWorkspace.getProjection().activeBrief, null)

const blocked = dependencies({
  prepareRun: async () => ({
    overrides: undefined,
    blockedReason: '缺少必填輸入：viewport。',
    declaredInputs: [{ name: 'viewport', type: 'string', required: true, label: 'Viewport' }],
  }),
})
blocked.briefs.push(makeBrief({ id: 'brief_blocked', threadId: 'thread_blocked' }))
const blockedWorkspace = createSubDesignWorkspace(blocked.deps)
blockedWorkspace.sync({ routeBriefId: 'brief_blocked', projectRoot: '/project' })
const blockedResult = await blockedWorkspace.start()
assert.equal(blockedResult.ok, false)
assert.equal(blocked.runs.length, 0)
assert.equal(blockedWorkspace.getProjection().run.phase, 'blocked')
assert.equal(blockedWorkspace.getProjection().pluginDeclaredInputs[0]?.name, 'viewport')

const providerUnavailable = dependencies({
  prepareRun: async () => ({ overrides: undefined, blockedReason: '尚未綁定專案，略過 plugin pipeline。' }),
})
providerUnavailable.briefs.push(makeBrief({ id: 'brief_fallback', threadId: 'thread_01' }))
const fallbackWorkspace = createSubDesignWorkspace(providerUnavailable.deps)
fallbackWorkspace.sync({ routeBriefId: 'brief_fallback', projectRoot: '' })
const fallbackResult = await fallbackWorkspace.start()
assert.equal(fallbackResult.ok, true)
assert.equal(providerUnavailable.runs.length, 1)

const followUp = dependencies()
followUp.briefs.push(makeBrief({ id: 'brief_existing', threadId: 'thread_01', objective: '既有 brief' }))
const followUpWorkspace = createSubDesignWorkspace(followUp.deps)
followUpWorkspace.sync({ routeBriefId: 'brief_existing', projectRoot: '/project' })
const resumed = followUpWorkspace.resume('brief_existing')
assert.equal(resumed.ok, true)
followUpWorkspace.setPluginInputs({ viewport: 'desktop' })
followUpWorkspace.setModel('model-follow-up')
followUpWorkspace.sync({ routeBriefId: 'brief_next', projectRoot: '/other-project' })
assert.deepEqual(followUpWorkspace.getProjection().pluginInputs, {})
followUpWorkspace.sync({ routeBriefId: 'brief_existing', projectRoot: '/project' })
followUpWorkspace.setPluginInputs({ viewport: 'desktop' })
followUpWorkspace.setModel('model-follow-up')
const followUpResult = await followUpWorkspace.followUp('請把 CTA 改成更清楚的版本')
assert.equal(followUpResult.ok, true)
assert.equal(followUp.runs[0]?.objective, '請把 CTA 改成更清楚的版本')
assert.equal(followUp.runs[0]?.reuseThreadId, 'thread_01')
assert.deepEqual(followUp.runs[0]?.overrides, { marker: 'prepared', model: 'model-follow-up' })

const pending = dependencies()
pending.briefs.push(makeBrief({ id: 'brief_pending', threadId: 'thread_01' }))
let resolveRun!: () => void
const pendingWorkspace = createSubDesignWorkspace({
  ...pending.deps,
  runTask: async (input) => {
    pending.runs.push(input)
    await new Promise<void>((resolve) => { resolveRun = resolve })
    return { status: 'success', path: 'builtin', threadId: input.reuseThreadId || null } as never
  },
})
pendingWorkspace.sync({ routeBriefId: 'brief_pending', projectRoot: '/project' })
const runOne = pendingWorkspace.start()
const runTwo = await pendingWorkspace.start()
assert.equal(runTwo.ok, false)
assert.equal(runTwo.kind, 'busy')
assert.equal(pending.runs.length, 1)
resolveRun()
await runOne

let hydratedRoot = ''
const hydration = dependencies({
  hydrateProject: async (root) => { hydratedRoot = root },
})
const hydrationWorkspace = createSubDesignWorkspace(hydration.deps)
await hydrationWorkspace.hydrate('/new/project')
assert.equal(hydratedRoot, '/new/project')
assert.equal(hydrationWorkspace.getProjection().hydration.status, 'ready')
assert.deepEqual(hydrationWorkspace.getProjection().capabilities, { electron: false, hostEvents: false })

console.log('SubDesign workspace interface behavior is green')

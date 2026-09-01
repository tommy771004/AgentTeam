import assert from 'node:assert/strict'
import {
  createSubDesignWorkspace,
  type SubDesignWorkspaceHostEvent,
  type SubDesignWorkspaceDependencies,
  type SubDesignWorkspacePresentation,
} from '../src/agent/subdesign/workspace.ts'
import { hydrateProviderFlags, resetProviderFlags } from '../src/agent/subdesign/providers/providerFlags.ts'
import type { SubDesignRunPreparation } from '../src/agent/subdesign/pluginExecutionPreparation.ts'
import type { SubDesignBrief } from '../src/agent/subdesign/types.ts'
import type { StreamingUpdate } from '../src/agent/subdesign/streamingEnvelope.ts'
import {
  DEFAULT_EXPERIMENTAL_SURFACE_SETTINGS,
  DEFAULT_STORYBOOK_PROVIDER_SETTINGS,
} from '../src/agent/subdesign/providers/providerSettings.ts'

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
    getThread: () => ({ runner: 'builtin', loopType: null }),
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

const presentationBrief = makeBrief({ id: 'brief_presentation', threadId: 'thread_presentation', stage: 'direction' })
const presentationWorkspace = createSubDesignWorkspace({
  ...dependencies({
    findBrief: (id) => id === presentationBrief.id ? presentationBrief : null,
    readPresentation: () => ({
      projectRoot: '/project',
      activeBrief: presentationBrief,
      briefs: [presentationBrief],
      systems: [],
      systemsLoading: false,
      systemsError: null,
      threads: [],
      runningThreadIds: [],
      linkedThread: null,
      linkedThreadRunId: null,
      linkedAgent: null,
      activityActive: false,
      runIsLive: false,
      artifacts: [],
      critiques: [],
      critiqueSession: null,
      memoryEntries: [],
      cliProviders: [],
      installedOpenDesignPacks: [],
      openDesignPackBusyId: null,
      openDesignPackError: null,
      latestPassedPreference: null,
      storybookSettings: DEFAULT_STORYBOOK_PROVIDER_SETTINGS,
      storybookRuns: [],
      providerRuns: [],
      experimentalSettings: DEFAULT_EXPERIMENTAL_SURFACE_SETTINGS,
    } satisfies SubDesignWorkspacePresentation),
  }).deps,
})
presentationWorkspace.sync({ routeBriefId: presentationBrief.id, projectRoot: '/project' })
assert.equal(presentationWorkspace.getProjection().presentation.activeBrief?.id, 'brief_presentation')
assert.equal(presentationWorkspace.getProjection().workspace?.briefId, 'brief_presentation')

const providerSettingsWorkspace = createSubDesignWorkspace(dependencies({
  refreshProviderState: async () => ({
    storybookSettings: {
      ...DEFAULT_STORYBOOK_PROVIDER_SETTINGS,
      enabled: true,
      endpoint: 'http://127.0.0.1:6010',
    },
    storybookRuns: [],
    providerRuns: [],
    experimentalSettings: { ...DEFAULT_EXPERIMENTAL_SURFACE_SETTINGS, streaming: true },
  }),
  saveStorybookProviderSettings: async (value) => ({
    ok: true as const,
    settings: { ...DEFAULT_STORYBOOK_PROVIDER_SETTINGS, ...value },
  }),
  saveExperimentalSurfaceSettings: async (value) => ({
    ok: true as const,
    settings: { ...DEFAULT_EXPERIMENTAL_SURFACE_SETTINGS, ...value },
  }),
}).deps)
await providerSettingsWorkspace.hydrate('/project')
assert.equal(providerSettingsWorkspace.getProjection().presentation.storybookSettings.endpoint, 'http://127.0.0.1:6010')
assert.equal(providerSettingsWorkspace.getProjection().presentation.experimentalSettings.streaming, true)
await providerSettingsWorkspace.saveStorybookProviderSettings({ enabled: false, endpoint: 'http://127.0.0.1:6011' })
await providerSettingsWorkspace.saveExperimentalSurfaceSettings({ mcpApps: true, streaming: false })
assert.equal(providerSettingsWorkspace.getProjection().presentation.storybookSettings.endpoint, 'http://127.0.0.1:6011')
assert.equal(providerSettingsWorkspace.getProjection().presentation.storybookSettings.enabled, false)
assert.deepEqual(providerSettingsWorkspace.getProjection().presentation.experimentalSettings, {
  ...DEFAULT_EXPERIMENTAL_SURFACE_SETTINGS,
  mcpApps: true,
  streaming: false,
})

const providerHydrationFailureWorkspace = createSubDesignWorkspace(dependencies({
  refreshProviderState: async () => { throw new Error('provider metadata unavailable') },
}).deps)
await providerHydrationFailureWorkspace.hydrate('/broken-provider-project')
assert.equal(providerHydrationFailureWorkspace.getProjection().hydration.status, 'failed')
assert.deepEqual(providerHydrationFailureWorkspace.getProjection().presentation.storybookSettings, DEFAULT_STORYBOOK_PROVIDER_SETTINGS)
assert.deepEqual(providerHydrationFailureWorkspace.getProjection().presentation.providerRuns, [])

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

const customBrief = makeBrief({ id: 'brief_custom_direction', threadId: 'thread_custom', directions: [] })
const customDirectionWorkspace = createSubDesignWorkspace(dependencies({
  findBrief: (id) => id === customBrief.id ? customBrief : null,
  updateBrief: (_id, patch) => {
    Object.assign(customBrief, patch)
    return customBrief
  },
  selectDirection: (_id, directionId) => {
    customBrief.selectedDirectionId = directionId
    return { ok: true, brief: customBrief }
  },
}).deps)
const customDirection = customDirectionWorkspace.createDirection(customBrief.id, 'Quiet editorial')
assert.equal(customDirection.ok, true)
assert.equal(customBrief.directions.length, 1)
assert.equal(customBrief.directions[0]?.title, 'Quiet editorial')
assert.equal(customBrief.selectedDirectionId, customBrief.directions[0]?.id)

const blockedA = dependencies({
  prepareRun: async ({ brief }) => brief.id === 'brief_a'
    ? {
        overrides: undefined,
        blockedReason: 'A 缺少必填輸入。',
        declaredInputs: [{ name: 'viewport', type: 'string', required: true, label: 'Viewport' }],
      }
    : { overrides: { marker: 'brief-b' } },
})
blockedA.briefs.push(makeBrief({ id: 'brief_a', threadId: 'thread_a' }))
blockedA.briefs.push(makeBrief({ id: 'brief_b', threadId: 'thread_b' }))
const blockedAWorkspace = createSubDesignWorkspace(blockedA.deps)
blockedAWorkspace.sync({ routeBriefId: 'brief_a', projectRoot: '/project' })
const blockedAResult = await blockedAWorkspace.start()
assert.equal(blockedAResult.ok, false)
assert.equal(blockedAWorkspace.getProjection().runsByBriefId.brief_a?.phase, 'blocked')
blockedAWorkspace.sync({ routeBriefId: 'brief_b', projectRoot: '/project' })
const briefBResult = await blockedAWorkspace.start()
assert.equal(briefBResult.ok, true)
assert.equal(blockedAWorkspace.getProjection().runsByBriefId.brief_a?.phase, 'blocked')
assert.equal(blockedAWorkspace.getProjection().runsByBriefId.brief_b?.phase, 'idle')
assert.equal(blockedAWorkspace.getProjection().run.phase, 'idle')
blockedAWorkspace.sync({ routeBriefId: 'brief_a', projectRoot: '/project' })
assert.equal(blockedAWorkspace.getProjection().pluginDeclaredInputs[0]?.name, 'viewport')

const runningAB = dependencies()
runningAB.briefs.push(makeBrief({ id: 'brief_a_running', threadId: 'thread_a_running' }))
runningAB.briefs.push(makeBrief({ id: 'brief_b_running', threadId: 'thread_b_running' }))
let releaseA!: () => void
const aGate = new Promise<void>((resolve) => { releaseA = resolve })
const runningABWorkspace = createSubDesignWorkspace({
  ...runningAB.deps,
  runTask: async (input) => {
    runningAB.runs.push(input)
    if (input.reuseThreadId === 'thread_a_running') await aGate
    return { status: 'success', path: 'builtin', threadId: input.reuseThreadId || null, runId: input.runId } as never
  },
})
runningABWorkspace.sync({ routeBriefId: 'brief_a_running', projectRoot: '/project' })
const runA = runningABWorkspace.start()
await Promise.resolve()
await Promise.resolve()
assert.equal(runningABWorkspace.getProjection().run.phase, 'starting')
runningABWorkspace.sync({ routeBriefId: 'brief_b_running', projectRoot: '/project' })
const runB = await runningABWorkspace.start()
assert.equal(runB.ok, true)
assert.equal(runningABWorkspace.getProjection().runsByBriefId.brief_a_running?.phase, 'starting')
assert.equal(runningABWorkspace.getProjection().runsByBriefId.brief_b_running?.phase, 'idle')
runningABWorkspace.sync({ routeBriefId: 'brief_a_running', projectRoot: '/project' })
const duplicateA = await runningABWorkspace.start()
assert.equal(duplicateA.ok, false)
assert.equal(duplicateA.kind, 'busy')
assert.equal(runningAB.runs.length, 2)
releaseA()
await runA
assert.equal(runningABWorkspace.getProjection().runsByBriefId.brief_a_running?.phase, 'idle')

let emitHostEvent: ((event: SubDesignWorkspaceHostEvent) => void) | undefined
const streamWorkspace = createSubDesignWorkspace({
  ...dependencies().deps,
  subscribeHostEvents: (listener) => {
    emitHostEvent = listener
    return () => { emitHostEvent = undefined }
  },
  loadCatalog: async () => ({ records: [{ id: 'template_1', kind: 'template' }] as never, warnings: ['catalog warning'] }),
  discoverModels: async () => ({
    models: [{ id: 'model_1', label: 'Model 1', providerId: 'provider_1', providerName: 'Provider', source: 'cli' as const }],
    current: { provider: 'provider_1', model: 'model_1', thinkingLevel: 'medium' },
    sourceCounts: { cli: 1, discovered: 0, host: 0 },
  }),
})
const removeStreamSubscription = streamWorkspace.subscribe(() => undefined)
hydrateProviderFlags({ mcpApps: false, streaming: true })
await streamWorkspace.refreshCatalog()
await streamWorkspace.refreshModels()
assert.equal(streamWorkspace.getProjection().catalog.status, 'ready')
assert.equal(streamWorkspace.getProjection().catalog.warning, 'catalog warning')
assert.equal(streamWorkspace.getProjection().modelDiscovery?.models[0]?.id, 'model_1')
const streamUpdate: StreamingUpdate = { seq: 1, kind: 'text-delta', text: 'hello' }
emitHostEvent?.({
  event: 'host/pipeline-stream',
  payload: { runId: 'run_stream', sessionId: 'session_stream', stageId: 'storybook', providerId: 'storybook', update: streamUpdate },
})
assert.equal(streamWorkspace.getProjection().streams.plugin_run_stream_storybook?.updates[0]?.text, 'hello')
removeStreamSubscription()
hydrateProviderFlags({ mcpApps: false, streaming: false })

const failedModelWorkspace = createSubDesignWorkspace({
  ...dependencies().deps,
  discoverModels: async () => { throw new Error('Pi Host model settings unavailable') },
})
await failedModelWorkspace.refreshModels()
assert.equal(failedModelWorkspace.getProjection().modelDiscoveryStatus, 'failed')
assert.equal(failedModelWorkspace.getProjection().modelDiscoveryWarning, 'Pi Host model settings unavailable')

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
  hydrateProject: async ({ projectRoot: root }) => { hydratedRoot = root },
})
const hydrationWorkspace = createSubDesignWorkspace(hydration.deps)
await hydrationWorkspace.hydrate('/new/project')
assert.equal(hydratedRoot, '/new/project')
assert.equal(hydrationWorkspace.getProjection().hydration.status, 'ready')
assert.deepEqual(hydrationWorkspace.getProjection().capabilities, { electron: false, hostEvents: false })

async function assertHydrationLatestRequestWins(oldRequestOutcome: 'failed' | 'success') {
  let releaseA!: () => void
  let releaseB!: () => void
  const gateA = new Promise<void>((resolve) => { releaseA = resolve })
  const gateB = new Promise<void>((resolve) => { releaseB = resolve })
  const appliedRoots: string[] = []
  const raceWorkspace = createSubDesignWorkspace(dependencies({
    hydrateProject: async ({ projectRoot: root, isCurrent }) => {
      if (root === '/project-a') {
        await gateA
        if (oldRequestOutcome === 'failed') throw new Error('stale project A failed')
      } else {
        await gateB
      }
      if (isCurrent()) appliedRoots.push(root)
    },
  }).deps)
  const hydrateA = raceWorkspace.hydrate('/project-a')
  await Promise.resolve()
  const hydrateB = raceWorkspace.hydrate('/project-b')
  await Promise.resolve()
  releaseB()
  await hydrateB
  assert.deepEqual(appliedRoots, ['/project-b'])
  assert.equal(raceWorkspace.getProjection().projectRoot, '/project-b')
  assert.equal(raceWorkspace.getProjection().hydration.status, 'ready')
  releaseA()
  await hydrateA
  assert.equal(raceWorkspace.getProjection().projectRoot, '/project-b')
  assert.equal(raceWorkspace.getProjection().hydration.status, 'ready')
}

await assertHydrationLatestRequestWins('failed')
await assertHydrationLatestRequestWins('success')

const hydrationFailure = dependencies({
  hydrateProject: async () => { throw new Error('project unavailable') },
})
const hydrationFailureWorkspace = createSubDesignWorkspace(hydrationFailure.deps)
await hydrationFailureWorkspace.hydrate('/broken/project')
assert.equal(hydrationFailureWorkspace.getProjection().hydration.status, 'failed')
assert.equal(hydrationFailureWorkspace.getProjection().hydration.reason, 'project unavailable')

async function assertIntegrationHydrationLatestRequestWins() {
  type Gate = { promise: Promise<void>; release: () => void }
  const deferred = (): Gate => {
    let release!: () => void
    const promise = new Promise<void>((resolve) => { release = resolve })
    return { promise, release }
  }
  const metadataA = deferred()
  const metadataB = deferred()
  const systemsA = deferred()
  const systemsB = deferred()
  const briefA = makeBrief({ id: 'brief_project_a', threadId: 'thread_project_a', objective: 'Project A brief' })
  const briefB = makeBrief({ id: 'brief_project_b', threadId: 'thread_project_b', objective: 'Project B brief' })
  const artifactA = {
    id: 'artifact_project_a', briefId: briefA.id, kind: 'html', title: 'A artifact', entry: 'index.html', renderer: 'html',
    exports: ['html'], supportingFiles: [], status: 'complete', revision: 1,
    createdAt: '2026-08-22T00:00:00.000Z', updatedAt: '2026-08-22T00:00:00.000Z',
  }
  const artifactB = { ...artifactA, id: 'artifact_project_b', briefId: briefB.id, title: 'B artifact' }
  const providerRunA = {
    schemaVersion: 1, providerId: 'storybook', briefId: briefA.id, runId: 'provider_run_a',
    finishedAt: '2026-08-22T00:01:00.000Z', status: 'success', stream: null,
  }
  const providerRunB = { ...providerRunA, briefId: briefB.id, runId: 'provider_run_b', finishedAt: '2026-08-22T00:02:00.000Z' }
  const storybookA = {
    ...DEFAULT_STORYBOOK_PROVIDER_SETTINGS, enabled: true, endpoint: 'http://127.0.0.1:6007',
    updatedAt: '2026-08-22T00:01:00.000Z',
  }
  const storybookB = {
    ...DEFAULT_STORYBOOK_PROVIDER_SETTINGS, enabled: true, endpoint: 'http://127.0.0.1:6008',
    updatedAt: '2026-08-22T00:02:00.000Z',
  }
  const metadata = {
    '/project-a': {
      briefs: [briefA], artifacts: [artifactA], critiques: [], exports: [], openDesignPacks: [], openDesignSnapshots: [],
      openDesignProviderSettings: [storybookA], openDesignProviderRuns: [providerRunA],
    },
    '/project-b': {
      briefs: [briefB], artifacts: [artifactB], critiques: [], exports: [], openDesignPacks: [], openDesignSnapshots: [],
      openDesignProviderSettings: [storybookB], openDesignProviderRuns: [providerRunB],
    },
  } as const
  const host = globalThis as unknown as { window?: unknown }
  const priorWindow = host.window
  const [
    { createSubDesignWorkspaceDependencies },
    { useProjectStore },
    { useSubDesignStore },
    { useSubDesignArtifactStore },
    { useSubDesignCritiqueStore },
    { useSubDesignExportStore },
    { useOpenDesignPackStore },
    { useThreadStore },
  ] = await Promise.all([
    import('../src/agent/subdesign/workspaceIntegration.ts'),
    import('../src/store/projectStore.ts'),
    import('../src/store/subDesignStore.ts'),
    import('../src/store/subDesignArtifactStore.ts'),
    import('../src/store/subDesignCritiqueStore.ts'),
    import('../src/store/subDesignExportStore.ts'),
    import('../src/store/openDesignPackStore.ts'),
    import('../src/store/threadStore.ts'),
  ])
  const snapshots = {
    project: useProjectStore.getState(),
    briefs: useSubDesignStore.getState(),
    artifacts: useSubDesignArtifactStore.getState(),
    critiques: useSubDesignCritiqueStore.getState(),
    exports: useSubDesignExportStore.getState(),
    packs: useOpenDesignPackStore.getState(),
    threads: useThreadStore.getState(),
  }
  const rootFor = (value: unknown): keyof typeof metadata => value === '/project-a' ? '/project-a' : '/project-b'
  host.window = {
    subagents: {
      subdesign: {
        readMetadata: async (projectRoot?: string) => {
          const root = rootFor(projectRoot)
          await (root === '/project-a' ? metadataA.promise : metadataB.promise)
          return { ok: true, ...metadata[root] }
        },
      },
      tools: {
        workspaceList: async (relative: string, projectRoot?: string) => {
          const root = rootFor(projectRoot)
          await (root === '/project-a' ? systemsA.promise : systemsB.promise)
          if (relative === '.') return { ok: true, entries: [] }
          return { ok: true, entries: [{ name: 'DESIGN.md', dir: false }] }
        },
        workspaceRead: async (_relative: string, projectRoot?: string) => {
          const root = rootFor(projectRoot)
          await (root === '/project-a' ? systemsA.promise : systemsB.promise)
          return { ok: true, content: `---\ntitle: System ${root.slice(-1)}\n---\n\n# System ${root.slice(-1)}` }
        },
      },
    },
  }
  try {
    useProjectStore.setState({ root: '/project-a' })
    const deps = createSubDesignWorkspaceDependencies({ navigate: () => undefined })
    const integrationWorkspace = createSubDesignWorkspace(deps)
    const hydrateA = integrationWorkspace.hydrate('/project-a')
    await Promise.resolve()
    useProjectStore.setState({ root: '/project-b' })
    const hydrateB = integrationWorkspace.hydrate('/project-b')
    metadataB.release()
    systemsB.release()
    await hydrateB
    assert.equal(useProjectStore.getState().root, '/project-b')
    assert.equal(useSubDesignStore.getState().projectRoot, '/project-b')
    assert.deepEqual(useSubDesignStore.getState().briefs.map((brief) => brief.id), [briefB.id])
    assert.equal(useSubDesignArtifactStore.getState().projectRoot, '/project-b')
    assert.deepEqual(useSubDesignArtifactStore.getState().artifacts.map((artifact) => artifact.id), [artifactB.id])
    assert.equal(useSubDesignExportStore.getState().projectRoot, '/project-b')
    assert.equal(useOpenDesignPackStore.getState().projectRoot, '/project-b')
    assert.deepEqual(integrationWorkspace.getProjection().presentation.storybookSettings.endpoint, storybookB.endpoint)
    assert.deepEqual(integrationWorkspace.getProjection().presentation.providerRuns.map((run) => run.runId), [providerRunB.runId])

    metadataA.release()
    systemsA.release()
    await hydrateA
    assert.equal(useProjectStore.getState().root, '/project-b')
    assert.deepEqual(useSubDesignStore.getState().briefs.map((brief) => brief.id), [briefB.id])
    assert.deepEqual(useSubDesignArtifactStore.getState().artifacts.map((artifact) => artifact.id), [artifactB.id])
    assert.deepEqual(integrationWorkspace.getProjection().presentation.providerRuns.map((run) => run.runId), [providerRunB.runId])
  } finally {
    useProjectStore.setState(snapshots.project)
    useSubDesignStore.setState(snapshots.briefs)
    useSubDesignArtifactStore.setState(snapshots.artifacts)
    useSubDesignCritiqueStore.setState(snapshots.critiques)
    useSubDesignExportStore.setState(snapshots.exports)
    useOpenDesignPackStore.setState(snapshots.packs)
    useThreadStore.setState(snapshots.threads)
    resetProviderFlags()
    host.window = priorWindow
  }
}

await assertIntegrationHydrationLatestRequestWins()

console.log('SubDesign workspace interface behavior is green')

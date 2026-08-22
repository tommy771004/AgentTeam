/**
 * Artifact revision snapshots：register 快照、restore 成新 revision、live guard。
 * Seams：agent/subdesign artifactSnapshots 純函式、useSubDesignArtifactStore、
 * SubDesignWorkspaceController.restoreArtifactRevision（fake deps 注入，
 * 與 smoke-subdesign-workspace 同一慣例）。
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  computeSnapshotFile,
  findSnapshot,
  type SubDesignArtifactSnapshotIndex,
} from '../src/agent/subdesign/artifactSnapshots.ts'
import { useSubDesignArtifactStore } from '../src/store/subDesignArtifactStore.ts'

const KNOWN_SHA256_ABC = 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad'

function resetStore() {
  const prior = {
    artifacts: useSubDesignArtifactStore.getState().artifacts,
    projectRoot: useSubDesignArtifactStore.getState().projectRoot,
    snapshots: useSubDesignArtifactStore.getState().snapshots,
  }
  useSubDesignArtifactStore.setState({ artifacts: [], projectRoot: '', snapshots: {} })
  return prior
}

const priorWindow = (globalThis as { window?: unknown }).window

await test('computeSnapshotFile hashes file content deterministically', async () => {
  const entry = await computeSnapshotFile('subdesign/deck.html', 'abc')
  assert.equal(entry.path, 'subdesign/deck.html')
  assert.equal(entry.sha256, KNOWN_SHA256_ABC)
})

await test('captureSnapshot reads workspace files and stores a per-revision snapshot', async () => {
  const restore = resetStore()
  try {
    ;(globalThis as { window?: unknown }).window = {
      subagents: {
        tools: {
          workspaceRead: async (relativePath: string) => ({
            ok: true,
            content: `content-of-${relativePath}`,
          }),
          workspaceWrite: async () => ({ ok: true, path: 'ok' }),
        },
      },
    }
    const registered = useSubDesignArtifactStore.getState().register({
      id: 'artifact_snap_qa',
      briefId: 'brief_snap_qa',
      kind: 'html',
      title: 'Snapshot QA',
      entry: 'subdesign/deck.html',
      renderer: 'html',
      exports: ['html'],
      supportingFiles: ['subdesign/tokens.css'],
      status: 'complete',
    })
    assert.equal(registered.ok, true)
    const result = await useSubDesignArtifactStore.getState().captureSnapshot('artifact_snap_qa')
    assert.equal(result.ok, true)
    const index = useSubDesignArtifactStore.getState().snapshots
    const snapshot = findSnapshot(index as SubDesignArtifactSnapshotIndex, 'artifact_snap_qa', 1)
    assert.ok(snapshot)
    assert.equal(snapshot?.files.length, 2)
    assert.deepEqual(snapshot?.files.map((file) => file.path).sort(), ['subdesign/deck.html', 'subdesign/tokens.css'])
  } finally {
    useSubDesignArtifactStore.setState(restore)
    ;(globalThis as { window?: unknown }).window = priorWindow
  }
})

await test('restoreRevision writes files back and appends a new revision without rewriting history', async () => {
  const restore = resetStore()
  const written: Array<{ path: string; content: string }> = []
  try {
    ;(globalThis as { window?: unknown }).window = {
      subagents: {
        tools: {
          workspaceRead: async (relativePath: string) => ({ ok: true, content: `content-of-${relativePath}` }),
          workspaceWrite: async (relativePath: string, content: string) => {
            written.push({ path: relativePath, content })
            return { ok: true, path: relativePath }
          },
        },
      },
    }
    useSubDesignArtifactStore.getState().register({
      id: 'artifact_restore_qa',
      briefId: 'brief_restore_qa',
      kind: 'html',
      title: 'Restore QA',
      entry: 'subdesign/page.html',
      renderer: 'html',
      exports: ['html'],
      supportingFiles: [],
      status: 'complete',
    })
    await useSubDesignArtifactStore.getState().captureSnapshot('artifact_restore_qa')
    // r2：內容變更後的修訂。自動快照是 fire-and-forget，先讓它落地。
    useSubDesignArtifactStore.getState().register({
      id: 'artifact_restore_qa',
      briefId: 'brief_restore_qa',
      kind: 'html',
      title: 'Restore QA',
      entry: 'subdesign/page.html',
      renderer: 'html',
      exports: ['html'],
      supportingFiles: [],
      status: 'complete',
    })
    await new Promise((resolve) => setTimeout(resolve, 10))
    const before = useSubDesignArtifactStore.getState().findById('artifact_restore_qa')
    assert.equal(before?.revision, 2)

    const result = await useSubDesignArtifactStore.getState().restoreRevision('artifact_restore_qa', 1)
    assert.equal(result.ok, true)
    if (!result.ok) return
    assert.equal(result.artifact.revision, 3)
    await new Promise((resolve) => setTimeout(resolve, 10))
    const after = useSubDesignArtifactStore.getState().findById('artifact_restore_qa')
    assert.equal(after?.revision, 3)
    assert.equal(after?.title, 'Restore QA')
    assert.ok(written.some((write) => write.path === 'subdesign/page.html'))
    // 歷史不可改寫：r1/r2 的快照仍在
    const index = useSubDesignArtifactStore.getState().snapshots
    assert.ok(findSnapshot(index as SubDesignArtifactSnapshotIndex, 'artifact_restore_qa', 1))
    assert.ok(findSnapshot(index as SubDesignArtifactSnapshotIndex, 'artifact_restore_qa', 2))
  } finally {
    useSubDesignArtifactStore.setState(restore)
    ;(globalThis as { window?: unknown }).window = priorWindow
  }
})

await test('restoreRevision fails gracefully when the revision has no snapshot', async () => {
  const restore = resetStore()
  try {
    ;(globalThis as { window?: unknown }).window = { subagents: { tools: {} } }
    useSubDesignArtifactStore.getState().register({
      id: 'artifact_nosnap_qa',
      briefId: 'brief_nosnap_qa',
      kind: 'html',
      title: 'NoSnapshot QA',
      entry: 'subdesign/solo.html',
      renderer: 'html',
      exports: ['html'],
      supportingFiles: [],
      status: 'complete',
    })
    const result = await useSubDesignArtifactStore.getState().restoreRevision('artifact_nosnap_qa', 1)
    assert.equal(result.ok, false)
    if (result.ok) return
    assert.match(result.errors.join('；'), /快照/)
  } finally {
    useSubDesignArtifactStore.setState(restore)
    ;(globalThis as { window?: unknown }).window = priorWindow
  }
})


function fakePresentation(runIsLive: boolean) {
  return {
    projectRoot: '/project',
    activeBrief: null,
    briefs: [],
    threads: [],
    runningThreadIds: [],
    linkedThread: null,
    linkedThreadRunId: null,
    linkedAgent: null,
    activityActive: false,
    runIsLive,
    artifacts: [],
    critiques: [],
    critiqueSession: null,
    memoryEntries: [],
    cliProviders: [],
    installedOpenDesignPacks: [],
    openDesignPackBusyId: null,
    openDesignPackError: null,
    latestPassedPreference: null,
    storybookSettings: { enabled: false, endpoint: '' },
    storybookRuns: [],
    providerRuns: [],
    experimentalSettings: { mcpApps: false, streaming: false },
  }
}

await test('controller restoreArtifactRevision refuses while the run is live', async () => {
  const { createSubDesignWorkspace } = await import('../src/agent/subdesign/workspace.ts')
  let restoreCalls = 0
  const deps = {
    findBrief: () => null,
    getThread: () => ({ runner: 'builtin', loopType: null }),
    createThread: () => 'thread_snap',
    bindBriefToThread: () => undefined,
    createBrief: () => { throw new Error('not used') },
    selectBrief: () => undefined,
    prepareRun: async () => ({ overrides: {} }),
    runTask: async () => ({ status: 'success', path: 'builtin', threadId: null, runId: 'run_x' }) as never,
    buildPrompt: (brief: unknown) => String(brief),
    navigate: () => undefined,
    createRunId: (() => { let n = 0; return () => `run_${++n}` })(),
    getProjectRoot: () => '/project',
    getCapabilities: () => ({ electron: false, hostEvents: false }),
    readPresentation: () => fakePresentation(true) as never,
    restoreArtifact: async () => { restoreCalls += 1; return { ok: true, artifact: {} } },
  } as never
  const workspace = createSubDesignWorkspace(deps)
  // 直接以 routeBriefId 指向一個「live」的 presentation。
  ;(workspace as unknown as { sync: (input: { routeBriefId: string | null }) => void }).sync({ routeBriefId: 'brief_live' })
  const result = await workspace.restoreArtifactRevision({ artifactId: 'artifact_any', revision: 1 })
  assert.equal(result.ok, false)
  if (result.ok) return
  assert.equal(result.kind, 'busy')
  assert.equal(restoreCalls, 0)
})

await test('controller restoreArtifactRevision delegates when not live', async () => {
  const { createSubDesignWorkspace } = await import('../src/agent/subdesign/workspace.ts')
  let restoreCalls = 0
  const deps = {
    findBrief: (id: string) => ({ id, threadId: 'thread_snap', objective: 'x', stage: 'deliver', constraints: [], acceptanceCriteria: [], directions: [], createdAt: '', updatedAt: '' }),
    getThread: () => ({ runner: 'builtin', loopType: null }),
    createThread: () => 'thread_snap',
    bindBriefToThread: () => undefined,
    createBrief: () => { throw new Error('not used') },
    selectBrief: () => undefined,
    prepareRun: async () => ({ overrides: {} }),
    runTask: async () => ({ status: 'success', path: 'builtin', threadId: null, runId: 'run_x' }) as never,
    buildPrompt: (brief: unknown) => String(brief),
    navigate: () => undefined,
    createRunId: (() => { let n = 0; return () => `run_${++n}` })(),
    getProjectRoot: () => '/project',
    getCapabilities: () => ({ electron: false, hostEvents: false }),
    readPresentation: () => fakePresentation(false) as never,
    restoreArtifact: async () => { restoreCalls += 1; return { ok: true, artifact: { id: 'artifact_any', revision: 3 } } },
  } as never
  const workspace = createSubDesignWorkspace(deps)
  ;(workspace as unknown as { sync: (input: { routeBriefId: string | null }) => void }).sync({ routeBriefId: 'brief_ok' })
  const result = await workspace.restoreArtifactRevision({ artifactId: 'artifact_any', revision: 1 })
  assert.equal(result.ok, true)
  assert.equal(restoreCalls, 1)
})

await test('diffRevisions reports added / removed / changed per file from snapshot hashes', async () => {
  const { computeRevisionDiff } = await import('../src/agent/subdesign/artifactSnapshots.ts')
  const index = {
    artifact_diff_qa: [
      { revision: 1, createdAt: 't1', files: [
        { path: 'a.html', sha256: 'aa' },
        { path: 'b.css', sha256: 'bb' },
        { path: 'old.js', sha256: 'cc' },
      ] },
      { revision: 2, createdAt: 't2', files: [
        { path: 'a.html', sha256: 'aa' },
        { path: 'b.css', sha256: 'zz' },
        { path: 'new.js', sha256: 'dd' },
      ] },
    ],
  }
  const diff = computeRevisionDiff(index as never, 'artifact_diff_qa', 1, 2)
  assert.deepEqual(diff.files.map((file) => [file.path, file.status]).sort(), [
    ['a.html', 'unchanged'],
    ['b.css', 'changed'],
    ['new.js', 'added'],
    ['old.js', 'removed'],
  ])
  const storeDiff = await useSubDesignArtifactStore.getState().diffRevisions('artifact_diff_qa', 1, 2)
  assert.equal(storeDiff.ok, false)
  if (storeDiff.ok) return
  assert.match(storeDiff.reason, /快照/)
})

await test('pinned comment payload validation is fail-closed', async () => {
  const { parsePinnedCommentPayload, buildPinnedCommentContext } = await import('../src/agent/subdesign/pinnedComments.ts')
  const bad = parsePinnedCommentPayload({ pins: [{ selector: 'bad selector!!', text: '' }] })
  assert.equal(bad.ok, false)
  const empty = parsePinnedCommentPayload({ pins: [] })
  assert.equal(empty.ok, false)
  const good = parsePinnedCommentPayload({ pins: [
    { selector: 'button.cta', text: '這顆按鈕間距太大', region: { x: 120, y: 40 } },
    { selector: 'h1#title', text: '標題改成產品名' },
  ] })
  assert.equal(good.ok, true)
  if (!good.ok) return
  assert.equal(good.pins.length, 2)
  const context = buildPinnedCommentContext({ id: 'artifact_pin_qa', revision: 2, title: 'Pin QA' }, good.pins)
  assert.match(context, /scoped 修正/)
  assert.match(context, /button\.cta/)
  assert.match(context, /間距太大/)
})

await test('controller submitPinnedComments compiles pins into a single runTask', async () => {
  const { createSubDesignWorkspace } = await import('../src/agent/subdesign/workspace.ts')
  const brief = { id: 'brief_pin', threadId: 'thread_pin', objective: 'x', stage: 'deliver', constraints: [], acceptanceCriteria: [], directions: [], createdAt: '', updatedAt: '' }
  const runs: unknown[] = []
  const deps = {
    findBrief: (id: string) => id === 'brief_pin' ? brief : null,
    getThread: () => ({ runner: 'builtin', loopType: null }),
    createThread: () => 'thread_pin',
    bindBriefToThread: () => undefined,
    createBrief: () => { throw new Error('not used') },
    selectBrief: () => undefined,
    prepareRun: async () => ({ overrides: {} }),
    runTask: async (input: { objective?: string }) => {
      runs.push(input)
      return { status: 'success', path: 'builtin', threadId: null, runId: 'run_pin' } as never
    },
    buildPrompt: (briefLike: { objective: string }) => briefLike.objective,
    navigate: () => undefined,
    createRunId: (() => { let n = 0; return () => `run_${++n}` })(),
    getProjectRoot: () => '/project',
    getCapabilities: () => ({ electron: false, hostEvents: false }),
    readPresentation: () => fakePresentation(false) as never,
  } as never
  const workspace = createSubDesignWorkspace(deps)
  ;(workspace as unknown as { sync: (input: { routeBriefId: string | null }) => void }).sync({ routeBriefId: 'brief_pin' })

  const invalid = await workspace.submitPinnedComments({ artifact: { id: 'a', revision: 1 }, pins: [{ selector: '!!', text: '' }] })
  assert.equal(invalid.ok, false)
  assert.equal(runs.length, 0)

  const submitted = await workspace.submitPinnedComments({ artifact: { id: 'a', revision: 1 }, pins: [{ selector: 'h1', text: '改標題' }] })
  assert.equal(submitted.ok, true)
  assert.equal(runs.length, 1)
  const runInput = runs[0] as { objective?: string }
  assert.match(String(runInput.objective), /scoped 修正/)
  assert.match(String(runInput.objective), /h1/)
})

/**
 * Artifact revision snapshots：register 快照、restore 成新 revision、live guard。
 * Seams：agent/subdesign artifactSnapshots 純函式、useSubDesignArtifactStore、
 * SubDesignWorkspaceController.restoreArtifactRevision（fake deps 注入，
 * 與 smoke-subdesign-workspace 同一慣例）。
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import {
  computeSnapshotFile,
  findSnapshot,
  type SubDesignArtifactSnapshotIndex,
} from '../src/agent/subdesign/artifactSnapshots.ts'
import { useSubDesignArtifactStore } from '../src/store/subDesignArtifactStore.ts'

const KNOWN_SHA256_ABC = 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad'
const read = (relative: string) => readFileSync(new URL(`../${relative}`, import.meta.url), 'utf8')

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

await test('diffRevisions reads any two snapshots and returns UI-ready line changes', async () => {
  const { computeRevisionDiff } = await import('../src/agent/subdesign/artifactSnapshots.ts')
  const restore = resetStore()
  const index = {
    artifact_diff_qa: [
      { revision: 1, createdAt: 't1', files: [
        { path: 'a.html', sha256: 'aa' },
        { path: 'b.css', sha256: 'bb' },
        { path: 'old.js', sha256: 'cc' },
      ] },
      { revision: 4, createdAt: 't4', files: [
        { path: 'a.html', sha256: 'aa' },
        { path: 'b.css', sha256: 'zz' },
        { path: 'new.js', sha256: 'dd' },
      ] },
    ],
  }
  const diff = computeRevisionDiff(index as never, 'artifact_diff_qa', 1, 4)
  assert.deepEqual(diff.files.map((file) => [file.path, file.status]).sort(), [
    ['a.html', 'unchanged'],
    ['b.css', 'changed'],
    ['new.js', 'added'],
    ['old.js', 'removed'],
  ])
  try {
    const readPaths: string[] = []
    const historical = new Map([
      ['.subagents/subdesign/snapshots/artifact_diff_qa/r1/a.html', '<h1>Same</h1>'],
      ['.subagents/subdesign/snapshots/artifact_diff_qa/r4/a.html', '<h1>Same</h1>'],
      ['.subagents/subdesign/snapshots/artifact_diff_qa/r1/b.css', 'body {\n  color: red;\n  padding: 8px;\n}'],
      ['.subagents/subdesign/snapshots/artifact_diff_qa/r4/b.css', 'body {\n  color: green;\n  gap: 12px;\n  padding: 8px;\n}'],
      ['.subagents/subdesign/snapshots/artifact_diff_qa/r1/old.js', 'legacy()'],
      ['.subagents/subdesign/snapshots/artifact_diff_qa/r4/new.js', 'modern()'],
    ])
    ;(globalThis as { window?: unknown }).window = {
      subagents: {
        tools: {
          workspaceRead: async (relativePath: string) => {
            readPaths.push(relativePath)
            return historical.has(relativePath)
              ? { ok: true, content: historical.get(relativePath) }
              : { ok: false, error: 'missing fixture' }
          },
        },
      },
    }
    useSubDesignArtifactStore.setState({ snapshots: index as never })
    const storeDiff = await useSubDesignArtifactStore.getState().diffRevisions('artifact_diff_qa', 1, 4)
    assert.equal(storeDiff.ok, true)
    if (!storeDiff.ok) return
    assert.equal(storeDiff.diff.revisionA, 1)
    assert.equal(storeDiff.diff.revisionB, 4)
    assert.equal(readPaths.some((path) => path.endsWith('/a.html')), false)
    const css = storeDiff.diff.files.find((file) => file.path === 'b.css')
    assert.deepEqual(css?.rows.map((row) => [row.kind, row.left?.content, row.right?.content]), [
      ['context', 'body {', 'body {'],
      ['changed', '  color: red;', '  color: green;'],
      ['added', undefined, '  gap: 12px;'],
      ['context', '  padding: 8px;', '  padding: 8px;'],
      ['context', '}', '}'],
    ])
    assert.deepEqual(
      storeDiff.diff.files.find((file) => file.path === 'new.js')?.rows.map((row) => row.kind),
      ['added'],
    )
    assert.deepEqual(
      storeDiff.diff.files.find((file) => file.path === 'old.js')?.rows.map((row) => row.kind),
      ['removed'],
    )
    const unavailable = await useSubDesignArtifactStore.getState().diffRevisions('artifact_diff_qa', 1, 3)
    assert.equal(unavailable.ok, false)
    if (!unavailable.ok) assert.match(unavailable.reason, /沒有快照|無法比較/)
  } finally {
    useSubDesignArtifactStore.setState(restore)
    ;(globalThis as { window?: unknown }).window = priorWindow
  }
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
  const context = buildPinnedCommentContext({ id: 'artifact_pin_qa', revision: 2, title: 'Pin QA' }, good.pins, 'pin_scope_qa')
  assert.match(context, /scoped 修正/)
  assert.match(context, /button\.cta/)
  assert.match(context, /間距太大/)
  assert.match(context, /design_artifact_patch/)
  assert.match(context, /pin_scope_qa/)
  assert.doesNotMatch(context, /design_artifact_register/)
})

await test('pinned patch scope rejects exact replacements outside the selected element', async () => {
  const { resolvePinnedHtmlRanges, validatePinnedPatchOperation } = await import('../src/agent/subdesign/pinnedPatchScope.ts')
  const html = '<main><button class="cta primary">Save</button><button class="secondary">Cancel</button></main>'
  const resolved = resolvePinnedHtmlRanges(html, ['button.cta.primary'])
  assert.equal(resolved.ok, true)
  assert.deepEqual(validatePinnedPatchOperation({
    content: html,
    selectors: ['button.cta.primary'],
    find: 'Save',
    expectedMatches: 1,
  }), { ok: true })
  const outside = validatePinnedPatchOperation({
    content: html,
    selectors: ['button.cta.primary'],
    find: 'Cancel',
    expectedMatches: 1,
  })
  assert.equal(outside.ok, false)
  if (!outside.ok) assert.match(outside.reason, /超出.*pin/)
})

await test('controller submitPinnedComments compiles pins into a single runTask', async () => {
  const { createSubDesignWorkspace } = await import('../src/agent/subdesign/workspace.ts')
  const brief = { id: 'brief_pin', threadId: 'thread_pin', objective: 'x', stage: 'deliver', constraints: [], acceptanceCriteria: [], directions: [], createdAt: '', updatedAt: '' }
  const runs: unknown[] = []
  const preparedScopes: unknown[] = []
  const clearedScopes: unknown[] = []
  let live = false
  const deps = {
    findBrief: (id: string) => id === 'brief_pin' ? brief : null,
    getThread: () => ({ runner: 'builtin', loopType: null }),
    createThread: () => 'thread_pin',
    bindBriefToThread: () => undefined,
    createBrief: () => { throw new Error('not used') },
    selectBrief: () => undefined,
    prepareRun: async () => ({ overrides: {} }),
    preparePinnedPatchScope: async (input: unknown) => {
      preparedScopes.push(input)
      return { ok: true, scopeId: 'pin_scope_qa' }
    },
    clearPinnedPatchScope: async (input: unknown) => { clearedScopes.push(input) },
    runTask: async (input: { objective?: string }) => {
      runs.push(input)
      return { status: 'success', path: 'builtin', threadId: null, runId: 'run_pin' } as never
    },
    buildPrompt: (briefLike: { objective: string }) => briefLike.objective,
    navigate: () => undefined,
    createRunId: (() => { let n = 0; return () => `run_${++n}` })(),
    getProjectRoot: () => '/project',
    getCapabilities: () => ({ electron: false, hostEvents: false }),
    readPresentation: () => fakePresentation(live) as never,
  } as never
  const workspace = createSubDesignWorkspace(deps)
  ;(workspace as unknown as { sync: (input: { routeBriefId: string | null }) => void }).sync({ routeBriefId: 'brief_pin' })

  const invalid = await workspace.submitPinnedComments({ artifact: { id: 'a', revision: 1 }, pins: [{ selector: '!!', text: '' }] })
  assert.equal(invalid.ok, false)
  assert.equal(runs.length, 0)

  const submitted = await workspace.submitPinnedComments({ artifact: { id: 'a', revision: 1 }, pins: [{ selector: 'h1', text: '改標題' }] })
  assert.equal(submitted.ok, true)
  assert.equal(preparedScopes.length, 1)
  assert.equal(clearedScopes.length, 1)
  assert.equal(runs.length, 1)
  const runInput = runs[0] as { objective?: string; runId?: string }
  assert.equal(runInput.runId, 'run_1')
  assert.equal((preparedScopes[0] as { runId?: string }).runId, runInput.runId, 'scope is bound to the exact Task run')
  assert.equal((clearedScopes[0] as { runId?: string }).runId, runInput.runId, 'settlement clears only its own scope')
  assert.match(String(runInput.objective), /scoped 修正/)
  assert.match(String(runInput.objective), /h1/)
  assert.match(String(runInput.objective), /pin_scope_qa/)

  live = true
  const rejectedLive = await workspace.submitPinnedComments({ artifact: { id: 'a', revision: 1 }, pins: [{ selector: 'h1', text: '再改一次' }] })
  assert.equal(rejectedLive.ok, false)
  assert.equal(preparedScopes.length, 1)
  assert.equal(runs.length, 1)
})

await test('production Host patch tool enforces the prepared pin scope', () => {
  const hostPack = read('electron/piExtensionPacks/subdesignPack.ts')
  const main = read('electron/main.ts')
  assert.match(main, /subdesign:preparePinnedPatchScope/)
  assert.match(main, /resolvePinnedHtmlRanges\(content, selectors\)/)
  assert.match(hostPack, /validatePinnedPatchOperation/)
  assert.match(hostPack, /scopeId 缺少或不一致/)
  assert.match(hostPack, /rawScope\.runId !== ctx\.runId/)
  assert.match(main, /subdesign:clearPinnedPatchScope/)
  assert.match(hostPack, /unlink\(scopePath\)/)
})

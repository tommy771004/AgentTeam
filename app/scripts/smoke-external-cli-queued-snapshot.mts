import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import { buildExternalCliRecord } from '../src/agent/externalCliRecord.ts'
import { projectContextUsage } from '../src/agent/contextUsageProjection.ts'
import { runLocalCliAgent } from '../electron/localCliRunner.ts'
import { admitExternalInstructions } from '../src/agent/taskRunCoordinator.ts'

class MemoryStorage implements Storage {
  private readonly values = new Map<string, string>()
  get length() { return this.values.size }
  clear() { this.values.clear() }
  getItem(key: string) { return this.values.get(key) ?? null }
  key(index: number) { return [...this.values.keys()][index] ?? null }
  removeItem(key: string) { this.values.delete(key) }
  setItem(key: string, value: string) { this.values.set(key, String(value)) }
}

const root = await mkdtemp(join(tmpdir(), 'agentteam-cli-queued-snapshot-'))
const storage = new MemoryStorage()
Object.defineProperty(globalThis, 'localStorage', { value: storage, configurable: true })
const queue = await import('../src/agent/runQueue.ts')
queue.resetRunQueueForTests()
const oldSnapshot = {
  id: 'ins_queued_old', revision: 21, effectiveHash: createHash('sha256').update('OLD_GLOBAL\nOLD_PROJECT').digest('hex'),
  effectiveText: 'OLD_GLOBAL\nOLD_PROJECT', globalEffectiveText: 'OLD_GLOBAL',
  sources: [{ id: 'global', kind: 'global-custom', scope: 'global' as const, revision: 21, bytes: 10, includedBytes: 10, droppedBytes: 0, hash: 'a'.repeat(64), applied: true, deduplicated: false, truncated: false, shadowed: false, content: 'OLD_GLOBAL' }],
  diagnostics: [], usage: { personalizationBytes: 10, projectInstructionBytes: 10, totalBytes: 20, budgetBytes: 1024 },
  deliveryMode: 'native' as const, exactSnapshot: false,
}
try {
  const originalWindow = (globalThis as { window?: Window }).window
  ;(globalThis as { window: Window }).window = {
    ...(originalWindow || {}),
    subagents: { piHost: { instructions: { resolve: async () => ({ instructionSnapshot: oldSnapshot }) } } },
  } as Window
  const admittedOverrides: { instructionSnapshot?: typeof oldSnapshot } = {}
  await admitExternalInstructions({ runner: 'codex', projectRoot: root, overrides: admittedOverrides, notice: () => {} })
  assert.equal(admittedOverrides.instructionSnapshot?.effectiveHash, oldSnapshot.effectiveHash, 'production admission freezes the snapshot')
  const item = queue.enqueueExternalRun({
    runId: 'queued-frozen-external', objective: 'queued frozen adapter', sourceKind: 'composer', runner: 'codex', projectRoot: root,
    overrides: admittedOverrides,
  })
  assert.ok(item)
  const persisted = storage.getItem('subagents.runQueue.v1') || ''
  assert.match(persisted, /ins_queued_old/, 'queued record persists the frozen snapshot')

  // Simulate app restart, then make current settings disagree. The drained
  // production queue must carry its persisted snapshot, not invoke resolution.
  queue.resetRunQueueForTests()
  queue.hydrateRunQueue()
  const recovered = queue.listQueuedRuns()[0]
  assert.equal(recovered?.overrides?.instructionSnapshot?.effectiveHash, oldSnapshot.effectiveHash)
  const currentSnapshot = { ...oldSnapshot, id: 'ins_current_new', effectiveText: 'NEW_GLOBAL\nNEW_PROJECT', globalEffectiveText: 'NEW_GLOBAL', effectiveHash: 'f'.repeat(64) }
  let resolveCalls = 0
  ;(globalThis as { window: Window }).window = {
    ...(originalWindow || {}),
    subagents: { piHost: { instructions: { resolve: async () => { resolveCalls += 1; return { instructionSnapshot: currentSnapshot } } } } },
  } as Window
  let dispatchedRecord: ReturnType<typeof buildExternalCliRecord> | undefined
  await queue.drainExternalRunQueue(async (queued) => {
    const frozen = queued.overrides?.instructionSnapshot
    assert.equal(frozen?.effectiveHash, oldSnapshot.effectiveHash)
    const result = await runLocalCliAgent({
      kind: 'codex', binary: process.execPath, cwd: root,
      prompt: `${queued.objective}\n\n${frozen?.effectiveText || ''}`,
      runId: queued.runId, externalCliPolicy: { idleMs: 1_000, absoluteMs: 5_000, operationMs: 1_000 },
    }, { runArgv: async (input) => {
      assert.equal(input.cwd, root)
      assert.equal(input.args.at(-1), `${queued.objective}\n\n${oldSnapshot.effectiveText}`)
      return { ok: true, code: 0, stdout: '', stderr: '' }
    } })
    assert.equal(result.ok, true)
    dispatchedRecord = buildExternalCliRecord({ runner: queued.runner || 'codex', prompt: `${queued.objective}\n\n${oldSnapshot.effectiveText}`, events: [], answer: 'old', settlement: 'answered', instructionSnapshot: frozen })
    return { path: 'cli', executionKind: 'external', status: 'success', threadId: null, runId: queued.runId }
  })
  assert.equal(resolveCalls, 0, 'restart drain does not reread current instructions')
  assert.equal(projectContextUsage(dispatchedRecord).instructions?.effectiveHash, oldSnapshot.effectiveHash)
  if (originalWindow) (globalThis as { window?: Window }).window = originalWindow
  else delete (globalThis as { window?: Window }).window
  console.log('external CLI queued snapshot smoke passed: persisted frozen evidence survives restart and adapter dispatch')
} finally {
  await rm(root, { recursive: true, force: true })
}

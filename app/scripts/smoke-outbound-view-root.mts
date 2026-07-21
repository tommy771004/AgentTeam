/**
 * Ticket 18 — single Restricted Project View root truth.
 * Seam: resolveProtectedProjectRoot + resolveEffectiveProjectRoot.
 * Run: node --experimental-strip-types scripts/smoke-outbound-view-root.mts
 */
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  pinRestrictedViewRootForRun,
  unpinRestrictedViewRootForRun,
  getRestrictedViewRootForRun,
  bindSanitizedViewForRun,
  unbindSanitizedViewForRun,
} from '../src/agent/outbound/sanitizedWorkspace.ts'
import {
  resolveProtectedProjectRoot,
  resolveEffectiveProjectRoot,
} from '../src/agent/tools/runContext.ts'

const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
let passed = 0
async function test(name: string, fn: () => void | Promise<void>) {
  try {
    await fn()
    passed++
    console.log(`  ✓ ${name}`)
  } catch (e) {
    console.error(`  ✗ ${name}`)
    throw e
  }
}

console.log('smoke-outbound-view-root')

await test('pure: bound view root wins over explicit original and UI store', () => {
  const r = resolveProtectedProjectRoot({
    boundViewRoot: '/tmp/view-A',
    explicitRoot: '/tmp/original-proj',
    uiStoreRoot: '/tmp/ui-other',
  })
  assert.equal(r, '/tmp/view-A')
})

await test('pure: no bound view → explicit root', () => {
  assert.equal(
    resolveProtectedProjectRoot({
      explicitRoot: '  /tmp/proj  ',
      uiStoreRoot: '/tmp/ui',
    }),
    '/tmp/proj',
  )
})

await test('pure: no bound, no explicit → UI store (legacy)', () => {
  assert.equal(
    resolveProtectedProjectRoot({
      uiStoreRoot: '/tmp/ui-only',
    }),
    '/tmp/ui-only',
  )
})

await test('pure: empty strings ignored', () => {
  assert.equal(
    resolveProtectedProjectRoot({
      boundViewRoot: '  ',
      explicitRoot: '',
      uiStoreRoot: undefined,
    }),
    undefined,
  )
})

await test('pin map: pin/get/unpin by runId (lightweight, no full workspace)', () => {
  pinRestrictedViewRootForRun('run_a', '/view/a')
  pinRestrictedViewRootForRun('run_b', '/view/b')
  assert.equal(getRestrictedViewRootForRun('run_a'), '/view/a')
  assert.equal(getRestrictedViewRootForRun('run_b'), '/view/b')
  unpinRestrictedViewRootForRun('run_a')
  assert.equal(getRestrictedViewRootForRun('run_a'), undefined)
  assert.equal(getRestrictedViewRootForRun('run_b'), '/view/b')
  unpinRestrictedViewRootForRun('run_b')
})

await test('bindSanitizedView also pins view root for tools', () => {
  const runId = 'run_bind_1'
  bindSanitizedViewForRun(runId, {
    connectionId: 'llm:x',
    originalRoot: '/orig',
    viewRoot: '/view/bound',
    exclusions: [],
    fileMappings: [],
    skipped: [],
  })
  assert.equal(getRestrictedViewRootForRun(runId), '/view/bound')
  unbindSanitizedViewForRun(runId)
  assert.equal(getRestrictedViewRootForRun(runId), undefined)
})

await test('resolveEffectiveProjectRoot: pin wins over explicit original', async () => {
  const runId = 'run_eff_1'
  const original = '/tmp/original-eff'
  const view = '/tmp/view-eff'
  pinRestrictedViewRootForRun(runId, view)
  try {
    const root = await resolveEffectiveProjectRoot(original, runId)
    assert.equal(root, view)
    assert.notEqual(root, original)
  } finally {
    unpinRestrictedViewRootForRun(runId)
  }
  // after unpin, explicit wins again
  const after = await resolveEffectiveProjectRoot(original, runId)
  assert.equal(after, original)
})

await test('resolveEffectiveProjectRoot: concurrent runIds isolated', async () => {
  pinRestrictedViewRootForRun('r1', '/v1')
  pinRestrictedViewRootForRun('r2', '/v2')
  try {
    assert.equal(await resolveEffectiveProjectRoot('/orig', 'r1'), '/v1')
    assert.equal(await resolveEffectiveProjectRoot('/orig', 'r2'), '/v2')
  } finally {
    unpinRestrictedViewRootForRun('r1')
    unpinRestrictedViewRootForRun('r2')
  }
})

await test('wiring: runContext consults main viewRoot then local pin', () => {
  const t = fs.readFileSync(path.join(appRoot, 'src/agent/tools/runContext.ts'), 'utf8')
  assert.match(t, /resolveProtectedProjectRoot/)
  assert.match(t, /viewRoot|outbound/)
  assert.match(t, /getRestrictedViewRootForRun|pinRestrictedViewRootForRun/)
})

await test('wiring: coordinator pins view root after prepare success', () => {
  const t = fs.readFileSync(path.join(appRoot, 'src/agent/taskRunCoordinator.ts'), 'utf8')
  assert.match(t, /pinRestrictedViewRootForRun/)
  assert.match(t, /unpinRestrictedViewRootForRun/)
})

console.log(`\n${passed} tests passed`)

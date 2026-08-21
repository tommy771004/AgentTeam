/** Smoke: Plugin resolved snapshot, scoped grants, and persistence (02). */
import assert from 'node:assert/strict'
import {
  DENY_BY_DEFAULT, SNAPSHOT_DIR, createResolvedSnapshot, fingerprintCapabilities,
  grantCapabilities, isCapabilityGranted, isSnapshotPathValid, needsReapproval,
  revokeGrants, sha256Hex, snapshotContainsNoRawToken, validateProjectRelativePath,
} from '../src/agent/subdesign/pluginSnapshot.ts'
import { loadPluginSnapshots, persistPluginSnapshot } from '../src/agent/subdesign/pluginSnapshotStore.ts'

let passed = 0
let total = 0
async function test(name: string, fn: () => void | Promise<void>) {
  total++
  try { await fn(); passed++; console.log(`  ✓ ${name}`) }
  catch (error) { console.error(`  ✗ ${name}`); console.error(error); process.exitCode = 1 }
}

const manifest = (capabilities: string[] = ['fs:write']) => ({ specVersion: '1.0.0', od: { kind: 'scenario', capabilities } })
async function snapshot(pluginId: string, capabilities?: string[]) {
  const result = await createResolvedSnapshot({
    pluginId, source: { sourcePath: 'plugins/example/SKILL.md' },
    rawManifest: manifest(capabilities), projectRoot: '/tmp/proj',
  })
  assert.ok(!('error' in result), 'snapshot should resolve')
  return result
}

console.log('smoke-open-design-snapshot')

await test('SHA-256 content hash is deterministic and collision-resistant length', async () => {
  assert.equal(await sha256Hex('hello world'), await sha256Hex('hello world'))
  assert.equal((await sha256Hex('hello world')).length, 64)
  assert.notEqual(await sha256Hex('hello world'), await sha256Hex('hello world!'))
})

await test('content or capability change triggers re-approval', async () => {
  const current = await snapshot('test:reapproval')
  assert.equal(needsReapproval(current, { contentHash: current.contentHash, fingerprint: current.capabilityFingerprint }), false)
  assert.equal(needsReapproval(current, { contentHash: current.contentHash, fingerprint: await fingerprintCapabilities(['fs:write', 'network']) }), true)
  assert.equal(needsReapproval(current, { contentHash: await sha256Hex('different'), fingerprint: current.capabilityFingerprint }), true)
})

await test('deny-by-default grants are explicit and scoped to run/thread', async () => {
  const current = await snapshot('test:scope', ['fs:write', 'network'])
  assert.ok(DENY_BY_DEFAULT.has('fs:write'))
  assert.deepEqual(current.grantedCapabilities, [])
  const scope = { runId: 'run_1', threadId: 'thread_1' }
  const granted = grantCapabilities(current, ['fs:write', 'bash'], scope)
  assert.deepEqual(granted.grantedCapabilities, ['fs:write'])
  assert.equal(isCapabilityGranted(granted, 'fs:write', scope), true)
  assert.equal(isCapabilityGranted(granted, 'fs:write', { runId: 'run_2', threadId: 'thread_1' }), false)
  assert.equal(isCapabilityGranted(granted, 'fs:write', { runId: 'run_1', threadId: 'thread_2' }), false)
  assert.equal(granted.grantDecisions[0]?.runId, 'run_1')
  const nextScope = grantCapabilities(granted, ['network'], { runId: 'run_2', threadId: 'thread_1' })
  assert.deepEqual(nextScope.grantedCapabilities, ['network'])
  assert.equal(isCapabilityGranted(nextScope, 'fs:write', { runId: 'run_2', threadId: 'thread_1' }), false)
})

await test('revocation clears grants and scope', async () => {
  const current = await snapshot('test:revoke')
  const revoked = revokeGrants(grantCapabilities(current, ['fs:write'], { runId: 'run_revoke' }))
  assert.deepEqual(revoked.grantedCapabilities, [])
  assert.equal(revoked.grantScope, undefined)
  assert.ok(revoked.revokedAt)
})

await test('absolute, traversal, and outside snapshot paths are rejected', () => {
  assert.equal(validateProjectRelativePath('/tmp/proj', '/etc/passwd').ok, false)
  assert.equal(validateProjectRelativePath('/tmp/proj', '../outside.json').ok, false)
  assert.equal(validateProjectRelativePath('/tmp/proj', '.subagents/../evil').ok, false)
  assert.equal(isSnapshotPathValid('/tmp/proj', `${SNAPSHOT_DIR}/x.json`), true)
  assert.equal(isSnapshotPathValid('/tmp/proj', 'evil/x.json'), false)
})

await test('snapshot persists through project metadata and reloads after restart', async () => {
  const current = await snapshot('test:persist')
  let written: unknown = null
  const host = globalThis as unknown as { window?: unknown }
  const priorWindow = host.window
  host.window = { subagents: { subdesign: {
    writeMetadata: async (input: unknown) => { written = input; return { ok: true } },
    readMetadata: async () => ({ ok: true, briefs: [], artifacts: [], critiques: [], exports: [], openDesignPacks: [], openDesignSnapshots: [current] }),
  } } }
  try {
    assert.equal(await persistPluginSnapshot(current, '/tmp/proj'), true)
    assert.deepEqual(written, { kind: 'open-design-snapshot', payload: current, projectRoot: '/tmp/proj' })
    assert.equal((await loadPluginSnapshots('/tmp/proj'))[0]?.snapshotId, current.snapshotId)
  } finally { host.window = priorWindow }
})

await test('serialized snapshot contains no raw token', async () => {
  const current = await snapshot('test:redaction')
  assert.equal(snapshotContainsNoRawToken(current), true)
  assert.equal(snapshotContainsNoRawToken({ ...current, rawToken: 'sk-12345678901234567890' } as typeof current), false)
})

console.log(`\n${passed}/${total} tests passed`)
if (process.exitCode) console.error('Smoke failed'); else console.log('OK')

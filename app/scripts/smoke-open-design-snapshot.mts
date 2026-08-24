/** Smoke: Plugin resolved snapshot, scoped grants, and persistence (02). */
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
import {
  DENY_BY_DEFAULT, SNAPSHOT_DIR, createResolvedSnapshot, fingerprintCapabilities,
  grantCapabilities, isCapabilityGranted, isSnapshotPathValid, needsReapproval,
  revokeGrants, sha256Hex, snapshotContainsNoRawToken, validateProjectRelativePath,
} from '../src/agent/subdesign/pluginSnapshot.ts'
import { loadPluginSnapshots, persistPluginSnapshot } from '../src/agent/subdesign/pluginSnapshotStore.ts'
import {
  adoptPluginSnapshot, deniedCapabilities, describeDrift, refreshPluginSnapshot,
  requestCapabilityGrants, resolvePluginTrust, revokePluginGrants,
} from '../src/agent/subdesign/pluginTrust.ts'
import { usePermissionAskStore } from '../src/store/permissionAskStore.ts'

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
  const fakeRawToken = ['sk', '12345678901234567890'].join('-')
  assert.equal(snapshotContainsNoRawToken({ ...current, rawToken: fakeRawToken } as typeof current), false)
})

/**
 * Fake the renderer metadata bridge so the trust actions exercise the real
 * shipped persistence path rather than an inline mirror.
 */
async function withMetadataBridge<T>(
  seed: unknown[],
  fn: (written: () => unknown[]) => Promise<T>,
): Promise<T> {
  const host = globalThis as unknown as { window?: unknown }
  const priorWindow = host.window
  const store = [...seed]
  const writes: unknown[] = []
  host.window = { subagents: { subdesign: {
    writeMetadata: async (input: unknown) => {
      writes.push(input)
      const payload = (input as { payload: { pluginId: string } }).payload
      const at = store.findIndex((item) => (item as { pluginId: string }).pluginId === payload.pluginId)
      if (at >= 0) store[at] = payload
      else store.push(payload)
      return { ok: true }
    },
    readMetadata: async () => ({
      ok: true, briefs: [], artifacts: [], critiques: [], exports: [],
      openDesignPacks: [], openDesignSnapshots: [...store],
    }),
  } } }
  try { return await fn(() => writes) } finally { host.window = priorWindow }
}

await test('a vendor update never silently replaces an adopted snapshot', async () => {
  const adopted = await snapshot('test:drift', ['fs:write'])
  const scope = { runId: 'run_1', threadId: 'thread_1' }
  const granted = grantCapabilities(adopted, ['fs:write'], scope)

  // Same content => trusted, no write.
  assert.equal(resolvePluginTrust(granted, adopted, scope).state, 'trusted')

  // Vendor content moved on: the stored snapshot stays authoritative.
  const updated = await snapshot('test:drift', ['fs:write', 'network'])
  const trust = resolvePluginTrust(granted, updated, scope)
  assert.equal(trust.state, 'refresh-required')
  assert.ok(trust.state === 'refresh-required' && trust.stored.snapshotId === granted.snapshotId)
  assert.equal(describeDrift(granted, updated), 'both')

  await withMetadataBridge([granted], async (writes) => {
    // Resolving trust writes nothing — only an explicit refresh does.
    assert.equal(writes().length, 0)
    const refreshed = await refreshPluginSnapshot(updated, '/tmp/proj')
    assert.equal(writes().length, 1)
    // The refresh drops grants: the fingerprint the user approved is gone.
    assert.deepEqual(refreshed.grantedCapabilities, [])
    assert.ok(refreshed.revokedAt)
    assert.equal(resolvePluginTrust(refreshed, updated, scope).state, 'grant-required')
  })
})

await test('adopting writes an ungranted snapshot; grants come from the HITL ask', async () => {
  const candidate = await snapshot('test:grant-path', ['fs:write', 'network'])
  const scope = { runId: 'run_2', threadId: 'thread_2' }
  assert.equal(resolvePluginTrust(null, candidate, scope).state, 'adopt-required')

  await withMetadataBridge([], async () => {
    const adopted = await adoptPluginSnapshot(candidate, '/tmp/proj')
    assert.deepEqual(adopted.grantedCapabilities, [])
    const blocked = resolvePluginTrust(adopted, candidate, scope)
    assert.equal(blocked.state, 'grant-required')
    assert.deepEqual(deniedCapabilities(adopted, scope).sort(), ['fs:write', 'network'])

    // Answer the queued asks: allow the first, deny the second.
    const decisions = ['allow', 'deny'] as const
    let index = 0
    const drain = setInterval(() => {
      const current = usePermissionAskStore.getState().current
      if (current) usePermissionAskStore.getState().resolve(current.id, decisions[index++] ?? 'deny')
    }, 5)
    let outcome
    try {
      outcome = await requestCapabilityGrants({ snapshot: adopted, scope, projectRoot: '/tmp/proj' })
    } finally { clearInterval(drain) }

    assert.deepEqual(outcome.granted, ['fs:write'])
    assert.deepEqual(outcome.denied, ['network'])
    // Still blocked: a partially granted plugin fails closed on the rest.
    assert.equal(resolvePluginTrust(outcome.snapshot, candidate, scope).state, 'grant-required')
    assert.equal(isCapabilityGranted(outcome.snapshot, 'fs:write', scope), true)
    assert.equal(isCapabilityGranted(outcome.snapshot, 'network', scope), false)
  })
})

await test('an unattended capability ask times out and fails closed', async () => {
  const candidate = await snapshot('test:unattended', ['bash'])
  const scope = { runId: 'run_3', threadId: 'thread_3' }
  await withMetadataBridge([], async () => {
    const adopted = await adoptPluginSnapshot(candidate, '/tmp/proj')
    // Nobody answers; the store's own timeout auto-denies.
    const outcome = await requestCapabilityGrants({
      snapshot: adopted, scope, projectRoot: '/tmp/proj', unattended: true, hitlTimeoutMs: 5_000,
    })
    assert.deepEqual(outcome.granted, [])
    assert.deepEqual(outcome.denied, ['bash'])
    assert.equal(resolvePluginTrust(outcome.snapshot, candidate, scope).state, 'grant-required')
  })
})

await test('revoking makes the next run ask again', async () => {
  const candidate = await snapshot('test:revoke-path', ['fs:write'])
  const scope = { runId: 'run_4', threadId: 'thread_4' }
  await withMetadataBridge([], async () => {
    const granted = grantCapabilities(await adoptPluginSnapshot(candidate, '/tmp/proj'), ['fs:write'], scope)
    assert.equal(resolvePluginTrust(granted, candidate, scope).state, 'trusted')
    const revoked = await revokePluginGrants(granted, '/tmp/proj')
    assert.equal(resolvePluginTrust(revoked, candidate, scope).state, 'grant-required')
    assert.deepEqual(deniedCapabilities(revoked, scope), ['fs:write'])
  })
})

await test('preparing a run resolves trust read-only, and the UI can act on it', () => {
  const prep = fs.readFileSync(
    path.join(appRoot, 'src/agent/subdesign/pluginExecutionPreparation.ts'), 'utf8',
  )
  // The silent overwrite must not come back.
  assert.doesNotMatch(prep, /persistPluginSnapshot/)
  assert.match(prep, /resolvePluginTrust/)
  // Grants have a user path.
  const panel = fs.readFileSync(
    path.join(appRoot, 'src/components/subdesign/PluginTrustPanel.tsx'), 'utf8',
  )
  for (const action of ['adoptPluginSnapshot', 'refreshPluginSnapshot', 'requestCapabilityGrants', 'revokePluginGrants']) {
    assert.match(panel, new RegExp(action), `PluginTrustPanel 缺少 ${action}`)
  }
  const studio = fs.readFileSync(
    path.join(appRoot, 'src/components/subdesign/SubDesignProjectStudio.tsx'), 'utf8',
  )
  assert.match(studio, /PluginTrustPanel/)
})

console.log(`\n${passed}/${total} tests passed`)
if (process.exitCode) console.error('Smoke failed'); else console.log('OK')

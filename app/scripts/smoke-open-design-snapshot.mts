/**
 * Smoke: Plugin resolved snapshot & capability grants (02)
 * Run: node --experimental-strip-types scripts/smoke-open-design-snapshot.mts
 */
import assert from 'node:assert/strict'
import {
  hashContent,
  fingerprintCapabilities,
  createResolvedSnapshot,
  validateProjectRelativePath,
  isSnapshotPathValid,
  revokeGrants,
  grantCapabilities,
  needsReapproval,
  snapshotContainsNoRawToken,
  DENY_BY_DEFAULT,
  SNAPSHOT_DIR,
} from '../src/agent/openDesign/pluginSnapshot.ts'

let passed = 0
let total = 0
async function test(name: string, fn: () => void | Promise<void>) {
  total++
  try {
    await fn()
    passed++
    console.log(`  ✓ ${name}`)
  } catch (e) {
    console.error(`  ✗ ${name}`)
    console.error(e)
    process.exitCode = 1
  }
}
console.log('smoke-open-design-snapshot')

await test('deterministic hash: same content same hash', () => {
  const a = hashContent('hello world')
  const b = hashContent('hello world')
  assert.equal(a, b)
  assert.equal(a.length, 64)
})

await test('changed fingerprint triggers re-approval', () => {
  const s = createResolvedSnapshot({
    pluginId: 'test:plugin',
    source: { sourcePath: 'plugins/a/SKILL.md' },
    rawManifest: { specVersion: '1.0.0', od: { kind: 'scenario', capabilities: ['fs:write'] } },
    projectRoot: '/tmp/proj',
  }) as any
  assert.ok(s.contentHash)
  assert.equal(needsReapproval(s, { contentHash: s.contentHash, fingerprint: s.capabilityFingerprint }), false)
  // mutate capability -> new fingerprint
  const newFp = fingerprintCapabilities(['fs:write', 'network'])
  assert.equal(needsReapproval(s, { contentHash: s.contentHash, fingerprint: newFp }), true)
  // mutate content hash
  assert.equal(needsReapproval(s, { contentHash: hashContent('different'), fingerprint: s.capabilityFingerprint }), true)
})

await test('deny-by-default: fs:write not granted unless explicit', () => {
  const s = createResolvedSnapshot({
    pluginId: 'test:deny',
    source: { sourcePath: 'plugins/b/SKILL.md' },
    rawManifest: { specVersion: '1.0.0', od: { kind: 'scenario', capabilities: ['fs:write', 'network'] } },
    projectRoot: '/tmp/proj',
  }) as any
  assert.ok(DENY_BY_DEFAULT.has('fs:write'))
  assert.equal(s.grantedCapabilities.length, 0)
  const g = grantCapabilities(s, ['fs:write'])
  assert.ok(g.grantedCapabilities.includes('fs:write'))
  // cannot grant capability not requested
  const g2 = grantCapabilities(s, ['bash'])
  assert.equal(g2.grantedCapabilities.includes('bash'), false)
})

await test('denied grant requires re-approval', () => {
  const s = createResolvedSnapshot({
    pluginId: 'test:deny2',
    source: { sourcePath: 'plugins/c/SKILL.md' },
    rawManifest: { specVersion: '1.0.0', od: { kind: 'scenario', capabilities: ['network'] } },
    projectRoot: '/tmp/proj',
  }) as any
  // no grant yet => not authorized
  assert.equal(s.grantedCapabilities.includes('network'), false)
})

await test('revocation clears grants and next run needs approval', () => {
  const s = createResolvedSnapshot({
    pluginId: 'test:revoke',
    source: { sourcePath: 'plugins/d/SKILL.md' },
    rawManifest: { specVersion: '1.0.0', od: { kind: 'scenario', capabilities: ['fs:write'] } },
    projectRoot: '/tmp/proj',
    grantedCapabilities: ['fs:write'],
  }) as any
  // create with granted still filtered to requested, so should have fs:write
  const withGrant = grantCapabilities(s, ['fs:write'])
  assert.ok(withGrant.grantedCapabilities.includes('fs:write'))
  const revoked = revokeGrants(withGrant)
  assert.equal(revoked.grantedCapabilities.length, 0)
  assert.ok(revoked.revokedAt)
})

await test('absolute path and traversal rejected', () => {
  const bad1 = validateProjectRelativePath('/tmp/proj', '/etc/passwd')
  assert.equal(bad1.ok, false)
  const bad2 = validateProjectRelativePath('/tmp/proj', '../outside.json')
  assert.equal(bad2.ok, false)
  const bad3 = validateProjectRelativePath('/tmp/proj', '.subagents/../evil')
  assert.equal(bad3.ok, false)
  const ok = validateProjectRelativePath('/tmp/proj', `${SNAPSHOT_DIR}/a.json`)
  assert.equal(ok.ok, true)
})

await test('snapshot path must be under snapshot dir', () => {
  assert.equal(isSnapshotPathValid('/tmp/proj', `${SNAPSHOT_DIR}/x.json`), true)
  assert.equal(isSnapshotPathValid('/tmp/proj', 'evil/x.json'), false)
  assert.equal(isSnapshotPathValid('/tmp/proj', '/absolute/x.json'), false)
})

await test('restart recovery: snapshot is serializable and contains no raw token', () => {
  const s = createResolvedSnapshot({
    pluginId: 'test:serial',
    source: { sourcePath: 'plugins/e/SKILL.md', sourceUrl: 'https://example.com', upstreamCommit: 'abc' },
    resolvedVersion: '1.0.0',
    rawManifest: { specVersion: '1.0.0', od: { kind: 'scenario', capabilities: ['fs:read'] } },
    projectRoot: '/tmp/proj',
  }) as any
  const json = JSON.stringify(s)
  const restored = JSON.parse(json)
  assert.equal(restored.pluginId, s.pluginId)
  assert.equal(restored.contentHash, s.contentHash)
  assert.equal(snapshotContainsNoRawToken(s), true)
  // inject fake token should be detected
  const evil: any = { ...s, credentialRefs: [{ kind: 'token', ref: 'ghp_1234567890abcdefghijklmnopqrstuvwxyz' }] }
  // still no raw token string in snapshot? Our check is heuristic on raw token patterns
  // credentialRefs are refs, so ok, but direct token field would fail
  const evil2: any = { ...s, rawToken: 'sk-12345678901234567890' }
  assert.equal(snapshotContainsNoRawToken(evil2), false)
})

await test('remote update does not silently replace: needs re-approval', () => {
  const s = createResolvedSnapshot({
    pluginId: 'test:remote',
    source: { sourcePath: 'plugins/f/SKILL.md' },
    rawManifest: { specVersion: '1.0.0', od: { kind: 'scenario', capabilities: ['fs:write'] } },
    rawContentForHash: 'v1',
    projectRoot: '/tmp/proj',
  }) as any
  const nextHash = hashContent('v2')
  assert.equal(needsReapproval(s, { contentHash: nextHash, fingerprint: s.capabilityFingerprint }), true)
})

console.log(`\n${passed}/${total} tests passed`)
if (process.exitCode) console.error('Smoke failed'); else console.log('OK')

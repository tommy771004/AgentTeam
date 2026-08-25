import assert from 'node:assert/strict'
import { access, mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  registerTrustedBuiltinShellSandboxAdapter,
  revokeBuiltinShellSandboxEvidence,
  validateBuiltinShellSandboxEvidence,
  verifyBuiltinShellSandbox,
  type TrustedBuiltinShellSandboxAdapter,
} from '../electron/piBuiltinShellSandbox.ts'

const viewRoot = await mkdtemp(join(tmpdir(), 'pi-builtin-shell-view-'))
const digest = 'a'.repeat(64)
let lastCanaries: { inside: string; outside: string } | undefined
const adapter = (overrides: Partial<TrustedBuiltinShellSandboxAdapter> = {}): TrustedBuiltinShellSandboxAdapter => ({
  backend: 'qualification-backend',
  probe: async () => ({ status: 'supported', profileDigest: digest }),
  runCanary: async ({ insideCanaryPath, outsideCanaryPath }) => {
    lastCanaries = { inside: insideCanaryPath, outside: outsideCanaryPath }
    assert.ok(insideCanaryPath.startsWith(viewRoot))
    assert.equal(outsideCanaryPath.startsWith(viewRoot), false)
    await access(insideCanaryPath)
    await access(outsideCanaryPath)
    return { insideAllowed: true, outsideDenied: true }
  },
  ...overrides,
})

try {
  const unsupported = await verifyBuiltinShellSandbox({ runId: 'run-no-backend', viewRoot, now: 1_000 })
  assert.equal(unsupported.status, 'unsupported')
  assert.match(unsupported.reason, /adapter|backend|unsupported/i)

  const unregister = registerTrustedBuiltinShellSandboxAdapter(adapter())
  const verified = await verifyBuiltinShellSandbox({ runId: 'run-verified', viewRoot, now: 10_000, ttlMs: 30_000 })
  assert.equal(verified.status, 'supported+verified')
  if (verified.status !== 'supported+verified') throw new Error('verification failed')
  assert.equal(verified.evidence.runId, 'run-verified')
  assert.equal(verified.evidence.backend, 'qualification-backend')
  assert.equal(verified.evidence.profileDigest, digest)
  assert.equal(verified.evidence.viewRoot, viewRoot)
  assert.equal(verified.evidence.issuedAt, 10_000)
  assert.equal(verified.evidence.expiresAt, 40_000)
  assert.equal(verified.evidence.replayScope, 'same-run')
  assert.match(verified.evidence.replayNonce, /^[a-f0-9-]{16,}$/)
  assert.deepEqual(Object.keys(verified.evidence).sort(), [
    'backend', 'expiresAt', 'issuedAt', 'profileDigest', 'replayNonce', 'replayScope', 'runId', 'viewRoot',
  ])
  assert.ok(lastCanaries)
  await assert.rejects(access(lastCanaries.inside), 'inside canary is removed after verification')
  await assert.rejects(access(lastCanaries.outside), 'outside canary is removed after verification')

  const accepted = validateBuiltinShellSandboxEvidence({
    evidence: verified.evidence,
    runId: 'run-verified',
    viewRoot,
    now: 20_000,
  })
  assert.equal(accepted.verified, true)
  for (const invalid of [
    validateBuiltinShellSandboxEvidence({ evidence: undefined, runId: 'run-verified', viewRoot, now: 20_000 }),
    validateBuiltinShellSandboxEvidence({ evidence: { ...verified.evidence }, runId: 'run-verified', viewRoot, now: 20_000 }),
    validateBuiltinShellSandboxEvidence({ evidence: verified.evidence, runId: 'wrong-run', viewRoot, now: 20_000 }),
    validateBuiltinShellSandboxEvidence({ evidence: verified.evidence, runId: 'run-verified', viewRoot: join(viewRoot, 'wrong'), now: 20_000 }),
    validateBuiltinShellSandboxEvidence({ evidence: verified.evidence, runId: 'run-verified', viewRoot, now: 40_001 }),
  ]) {
    assert.equal(invalid.verified, false)
    assert.ok(invalid.reason)
  }
  revokeBuiltinShellSandboxEvidence(verified.evidence)
  assert.equal(validateBuiltinShellSandboxEvidence({ evidence: verified.evidence, runId: 'run-verified', viewRoot, now: 20_000 }).verified, false)
  unregister()

  const unregisterUnsupported = registerTrustedBuiltinShellSandboxAdapter(adapter({
    probe: async () => ({ status: 'unsupported', reason: 'backend unavailable on this platform' }),
  }))
  assert.equal((await verifyBuiltinShellSandbox({ runId: 'run-unsupported', viewRoot })).status, 'unsupported')
  unregisterUnsupported()

  const unregisterProbeFailed = registerTrustedBuiltinShellSandboxAdapter(adapter({
    probe: async () => { throw new Error('probe crashed') },
  }))
  assert.equal((await verifyBuiltinShellSandbox({ runId: 'run-probe-failed', viewRoot })).status, 'probe-failed')
  unregisterProbeFailed()

  for (const result of [
    { insideAllowed: false, outsideDenied: true },
    { insideAllowed: true, outsideDenied: false },
  ]) {
    const unregisterCanaryFailed = registerTrustedBuiltinShellSandboxAdapter(adapter({
      runCanary: async () => result,
    }))
    assert.equal((await verifyBuiltinShellSandbox({ runId: `run-canary-${String(result.insideAllowed)}`, viewRoot })).status, 'canary-failed')
    unregisterCanaryFailed()
  }

  const preloadSource = await readFile(new URL('../electron/preload.ts', import.meta.url), 'utf8')
  const contextSource = await readFile(new URL('../electron/piSessionContext.ts', import.meta.url), 'utf8')
  // These two stay as source text on purpose: they are NEGATIVE, no-bypass
  // constraints. No external observation can prove the absence of a path, so
  // an executable test cannot replace them (issue 15).
  assert.doesNotMatch(preloadSource, /shellIsolationVerified|sandboxEvidence/, 'renderer surface cannot carry sandbox evidence')
  assert.doesNotMatch(contextSource, /shellIsolationVerified|sandboxEvidence/, 'Host parser cannot deserialize sandbox evidence')
  // The positive wiring assertion that used to sit here — matching the exact
  // `verifyBuiltinShellSandbox({ runId, viewRoot:` call expression in
  // piHostProtocol — is gone. It pinned a spelling, not a behaviour, and the
  // behaviour is now observed externally: qualify-pi-agent-runtime-contract
  // and smoke-pi-adr0047-real-turn-denial drive real turns and assert both
  // the verified-and-confined and the fail-closed outcomes.

  console.log('Builtin shell sandbox verification is Host-issued, metadata-only, run/view-bound, expiring, replay-aware, and dual-canary gated')
} finally {
  await rm(viewRoot, { recursive: true, force: true })
}

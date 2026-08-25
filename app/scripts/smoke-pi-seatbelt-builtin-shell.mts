import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  admitBuiltinShellSandbox,
  registerTrustedBuiltinShellSandboxAdapter,
  verifyBuiltinShellSandbox,
} from '../electron/piBuiltinShellSandbox.ts'
import {
  buildBuiltinShellSeatbeltProfile,
  createSeatbeltBuiltinShellAdapter,
  ensureSeatbeltProfileForRun,
  releaseSeatbeltProfileForRun,
  realViewRoot,
  SEATBELT_BACKEND,
  SEATBELT_PROFILE_DIGEST,
  wrapCommandInSeatbelt,
} from '../electron/piSeatbeltShellSandbox.ts'

/**
 * Issue 13 — macOS Seatbelt builtin-shell tracer (ADR-0051).
 *
 * The point of this smoke is that the denials are made by the OPERATING SYSTEM,
 * not by a string check in our own code. So on macOS it runs sandbox-exec for
 * real and asserts what the kernel did. On every other platform the adapter
 * must report `unsupported` — asserted here too, because "we could not test it"
 * and "it refused honestly" are different outcomes and only one is acceptable.
 */

const isDarwin = process.platform === 'darwin'
let passed = 0
async function test(name: string, fn: () => Promise<void> | void) {
  try {
    await fn()
    passed++
    console.log(`  ✓ ${name}`)
  } catch (error) {
    console.error(`  ✗ ${name}`)
    throw error
  }
}

console.log(`smoke-pi-seatbelt-builtin-shell (platform=${process.platform})`)

const workspace = await mkdtemp(join(tmpdir(), 'seatbelt-view-'))
const outside = await mkdtemp(join(tmpdir(), 'seatbelt-outside-'))
await writeFile(join(workspace, 'inside.txt'), 'inside the view\n')
await writeFile(join(outside, 'secret.txt'), 'outside the view\n')
const viewRoot = await realViewRoot(workspace)
const outsideRoot = await realViewRoot(outside)

/** Run a command the way the Host will: already wrapped, through a plain shell. */
async function runWrapped(command: string, profilePath: string, timeoutMs = 15_000): Promise<{ code: number | null; stdout: string; stderr: string }> {
  const wrapped = wrapCommandInSeatbelt({ command, profilePath })
  return new Promise((resolveRun) => {
    const child = spawn('/bin/sh', ['-c', wrapped], { cwd: viewRoot, stdio: ['ignore', 'pipe', 'pipe'] })
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', (chunk) => { stdout += String(chunk) })
    child.stderr.on('data', (chunk) => { stderr += String(chunk) })
    const timer = setTimeout(() => child.kill('SIGKILL'), timeoutMs)
    child.once('close', (code) => {
      clearTimeout(timer)
      resolveRun({ code, stdout, stderr })
    })
  })
}

try {
  // ── The profile is built from the view, and from nothing the model controls ──
  await test('profile is derived from the Restricted Project View only', () => {
    const profile = buildBuiltinShellSeatbeltProfile(viewRoot)
    assert.match(profile, /^\(version 1\)\n\(deny default\)/, 'the policy denies by default')
    assert.ok(profile.includes(`(subpath "${viewRoot}")`), 'the view root is the writable subpath')
    assert.equal(profile.includes('__SUBAGENTS_VIEW_ROOT__'), false, 'the placeholder is substituted')
    assert.equal(/\(allow network/.test(profile), false, 'no network allow rule exists to be granted')
  })

  await test('a view root carrying SBPL metacharacters cannot inject policy', () => {
    const hostile = buildBuiltinShellSeatbeltProfile('/tmp/eviI") (allow default) (deny (literal "x')
    const allowRules = hostile.split('\n').filter((line) => line.trim().startsWith('(allow default'))
    assert.deepEqual(allowRules, [], 'an injected (allow default) never becomes its own rule')
    assert.ok(hostile.includes('\\"'), 'the quote is escaped rather than closing the string')
  })

  await test('the profile digest identifies the policy, not the view', async () => {
    assert.match(SEATBELT_PROFILE_DIGEST, /^[a-f0-9]{64}$/)
    const other = await mkdtemp(join(tmpdir(), 'seatbelt-other-'))
    try {
      // Two views, one policy: the digest must not move, because the evidence
      // binds the view root separately. A per-view digest would make every
      // run's policy unrecognisable.
      assert.notEqual(buildBuiltinShellSeatbeltProfile(viewRoot), buildBuiltinShellSeatbeltProfile(other))
      const adapter = createSeatbeltBuiltinShellAdapter({ platform: 'darwin' })
      assert.equal(adapter.backend, SEATBELT_BACKEND)
    } finally {
      await rm(other, { recursive: true, force: true })
    }
  })

  // ── Unsupported platforms refuse honestly ──
  await test('a non-macOS platform is unsupported, never downgraded', async () => {
    for (const platform of ['linux', 'win32'] as const) {
      const probe = await createSeatbeltBuiltinShellAdapter({ platform }).probe()
      assert.equal(probe.status, 'unsupported')
      assert.match((probe as { reason: string }).reason, /macOS/)
    }
  })

  await test('a canary run with a mismatched profile digest fails closed', async () => {
    const result = await createSeatbeltBuiltinShellAdapter({ platform: 'darwin' }).runCanary({
      viewRoot,
      profileDigest: 'a'.repeat(64),
      insideCanaryPath: join(viewRoot, 'inside.txt'),
      outsideCanaryPath: join(outsideRoot, 'secret.txt'),
    })
    assert.deepEqual(result, { insideAllowed: false, outsideDenied: false }, 'an unverified policy proves nothing in either direction')
  })

  // ── Seam-level outcomes, driven through the shipped verifier ──
  await test('probe failure and canary failure are distinct refusals', async () => {
    const probeFailed = registerTrustedBuiltinShellSandboxAdapter({
      backend: SEATBELT_BACKEND,
      probe: async () => { throw new Error('probe exploded') },
      runCanary: async () => ({ insideAllowed: true, outsideDenied: true }),
    })
    const probeOutcome = await verifyBuiltinShellSandbox({ runId: 'run-probe', viewRoot })
    probeFailed()
    assert.equal(probeOutcome.status, 'probe-failed')

    const canaryFailed = registerTrustedBuiltinShellSandboxAdapter({
      backend: SEATBELT_BACKEND,
      probe: async () => ({ status: 'supported', profileDigest: SEATBELT_PROFILE_DIGEST }),
      // Denying the outside is not enough on its own: a sandbox that denies
      // everything, including the view, is broken rather than secure.
      runCanary: async () => ({ insideAllowed: false, outsideDenied: true }),
    })
    const canaryOutcome = await verifyBuiltinShellSandbox({ runId: 'run-canary', viewRoot })
    canaryFailed()
    assert.equal(canaryOutcome.status, 'canary-failed')

    for (const outcome of [probeOutcome, canaryOutcome]) {
      const admission = admitBuiltinShellSandbox({ verification: outcome, runId: 'run-probe', viewRoot })
      assert.equal(admission.verified, false, 'neither refusal may admit a required builtin shell')
    }
  })

  if (!isDarwin) {
    await test('this host installs no adapter, so required stays denied', async () => {
      const outcome = await verifyBuiltinShellSandbox({ runId: 'run-unsupported', viewRoot })
      assert.equal(outcome.status, 'unsupported')
      assert.equal(admitBuiltinShellSandbox({ verification: outcome, runId: 'run-unsupported', viewRoot }).verified, false)
    })
    console.log(`\n${passed} tests passed (Seatbelt execution assertions require macOS)`)
  } else {
    // ── The real backend, on a real kernel ──
    const adapter = createSeatbeltBuiltinShellAdapter()
    const restore = registerTrustedBuiltinShellSandboxAdapter(adapter)
    try {
      await test('the real Seatbelt backend probes and passes both canaries', async () => {
        const probe = await adapter.probe()
        assert.equal(probe.status, 'supported', `probe reported ${JSON.stringify(probe)}`)
        assert.equal((probe as { profileDigest: string }).profileDigest, SEATBELT_PROFILE_DIGEST)
        const canary = await adapter.runCanary({
          viewRoot,
          profileDigest: SEATBELT_PROFILE_DIGEST,
          insideCanaryPath: join(viewRoot, 'inside.txt'),
          outsideCanaryPath: join(outsideRoot, 'secret.txt'),
        })
        assert.deepEqual(canary, { insideAllowed: true, outsideDenied: true })
      })

      await test('verification issues evidence bound to this run and view', async () => {
        const outcome = await verifyBuiltinShellSandbox({ runId: 'run-verified', viewRoot })
        assert.equal(outcome.status, 'supported+verified', JSON.stringify(outcome))
        const evidence = (outcome as { evidence: { backend: string; viewRoot: string; profileDigest: string } }).evidence
        assert.equal(evidence.backend, SEATBELT_BACKEND)
        assert.equal(evidence.viewRoot, viewRoot)
        assert.equal(evidence.profileDigest, SEATBELT_PROFILE_DIGEST)

        const admitted = admitBuiltinShellSandbox({ verification: outcome, runId: 'run-verified', viewRoot })
        assert.equal(admitted.verified, true)
        assert.match((admitted as { reason: string }).reason, /backend=seatbelt/)

        // Evidence is bound: another run, or another view, is not admitted.
        assert.equal(admitBuiltinShellSandbox({ verification: outcome, runId: 'other-run', viewRoot }).verified, false)
        assert.equal(admitBuiltinShellSandbox({ verification: outcome, runId: 'run-verified', viewRoot: outsideRoot }).verified, false)
        // Replay after expiry is refused even for the right run and view.
        assert.equal(
          admitBuiltinShellSandbox({ verification: outcome, runId: 'run-verified', viewRoot, now: Date.now() + 10 * 60_000 }).verified,
          false,
          'expired evidence cannot start a shell',
        )
        // A structurally identical object that the verifier never issued —
        // the shape a model or the renderer could produce — is not evidence.
        const forged = { status: 'supported+verified', evidence: { ...evidence, runId: 'run-verified' } } as never
        assert.equal(admitBuiltinShellSandbox({ verification: forged, runId: 'run-verified', viewRoot }).verified, false)
      })

      const { profilePath } = await ensureSeatbeltProfileForRun({ runId: 'run-exec', viewRoot })

      await test('a verified shell can do allowed work inside the view', async () => {
        const read = await runWrapped(`cat ${JSON.stringify(join(viewRoot, 'inside.txt'))}`, profilePath)
        assert.equal(read.code, 0, read.stderr)
        assert.match(read.stdout, /inside the view/)
        const write = await runWrapped(`echo produced > ${JSON.stringify(join(viewRoot, 'produced.txt'))}`, profilePath)
        assert.equal(write.code, 0, write.stderr)
        assert.match(await readFile(join(viewRoot, 'produced.txt'), 'utf8'), /produced/)
      })

      await test('the kernel denies reads and writes outside the view', async () => {
        const read = await runWrapped(`cat ${JSON.stringify(join(outsideRoot, 'secret.txt'))}`, profilePath)
        assert.notEqual(read.code, 0, 'reading outside the view must fail')
        assert.equal(read.stdout.includes('outside the view'), false, 'no content escapes')
        assert.match(read.stderr, /not permitted|Operation not permitted/i, 'the refusal comes from the OS, not from us')

        const write = await runWrapped(`echo escaped > ${JSON.stringify(join(outsideRoot, 'escaped.txt'))}`, profilePath)
        assert.notEqual(write.code, 0, 'writing outside the view must fail')
        await assert.rejects(readFile(join(outsideRoot, 'escaped.txt'), 'utf8'), 'the file was never created')

        // The profile itself sits outside the view, so a confined command can
        // neither read the policy nor rewrite it.
        const readPolicy = await runWrapped(`cat ${JSON.stringify(profilePath)}`, profilePath)
        assert.notEqual(readPolicy.code, 0, 'the policy constraining the shell is not readable from inside it')
      })

      await test('the kernel denies network the ADR does not allow', async () => {
        const curl = await runWrapped('curl -s -m 5 https://example.com', profilePath)
        assert.notEqual(curl.code, 0, 'outbound network must fail inside the sandbox')
        assert.equal(curl.stdout.trim(), '', 'no response body is returned')
      })

      await test('cancellation kills the confined command', async () => {
        const wrapped = wrapCommandInSeatbelt({ command: 'sleep 30; echo never', profilePath })
        const child = spawn('/bin/sh', ['-c', wrapped], { cwd: viewRoot, stdio: ['ignore', 'pipe', 'pipe'] })
        let stdout = ''
        child.stdout.on('data', (chunk) => { stdout += String(chunk) })
        const settled = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolveRun) => {
          child.once('close', (code, signal) => resolveRun({ code, signal }))
        })
        await new Promise((r) => setTimeout(r, 300))
        child.kill('SIGKILL')
        const outcome = await settled
        assert.notEqual(outcome.code, 0, 'a cancelled command never settles success')
        assert.equal(stdout.includes('never'), false, 'the command did not run to completion')
      })

      await test('the run profile is released, and a released run cannot reuse it', async () => {
        releaseSeatbeltProfileForRun('run-exec')
        await new Promise((r) => setTimeout(r, 50))
        await assert.rejects(readFile(profilePath, 'utf8'), 'the profile file is removed with the run')
        // A fresh run gets a fresh profile rather than the released path.
        const next = await ensureSeatbeltProfileForRun({ runId: 'run-next', viewRoot })
        assert.notEqual(next.profilePath, profilePath)
        releaseSeatbeltProfileForRun('run-next')
      })
    } finally {
      restore()
    }
    console.log(`\n${passed} tests passed`)
  }
} finally {
  await rm(workspace, { recursive: true, force: true })
  await rm(outside, { recursive: true, force: true })
}

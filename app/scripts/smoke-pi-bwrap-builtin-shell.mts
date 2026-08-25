import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  admitBuiltinShellSandbox,
  registerTrustedBuiltinShellSandboxAdapter,
  releaseBuiltinShellExecution,
  verifyBuiltinShellSandbox,
  wrapVerifiedBuiltinShellCommand,
} from '../electron/piBuiltinShellSandbox.ts'
import {
  buildBuiltinShellBwrapArgs,
  BWRAP_BACKEND,
  BWRAP_PROFILE_DIGEST,
  createBubblewrapBuiltinShellAdapter,
  realViewRoot,
  wrapCommandInBwrap,
} from '../electron/piBubblewrapShellSandbox.ts'

/**
 * Issue 14 — Linux bubblewrap builtin-shell tracer (ADR-0051).
 *
 * The argument construction, the fail-closed refusals and the seam wiring are
 * platform-independent and are asserted everywhere. The claims that only the
 * KERNEL can settle — that a view escape and outbound network actually fail —
 * are asserted only where a kernel can answer them, and this smoke says so out
 * loud rather than printing a pass it did not earn.
 */

const isLinux = process.platform === 'linux'
let passed = 0
let kernelAsserted = 0
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
async function kernelTest(name: string, fn: () => Promise<void>) {
  if (!isLinux) {
    console.log(`  – ${name} (needs a Linux kernel; not run on ${process.platform})`)
    return
  }
  await test(name, fn)
  kernelAsserted++
}

console.log(`smoke-pi-bwrap-builtin-shell (platform=${process.platform})`)

const workspace = await mkdtemp(join(tmpdir(), 'bwrap-view-'))
const outside = await mkdtemp(join(tmpdir(), 'bwrap-outside-'))
await writeFile(join(workspace, 'inside.txt'), 'inside the view\n')
await writeFile(join(outside, 'secret.txt'), 'outside the view\n')
const viewRoot = await realViewRoot(workspace)
const outsideRoot = await realViewRoot(outside)

async function runWrapped(command: string, timeoutMs = 15_000): Promise<{ code: number | null; stdout: string; stderr: string }> {
  const wrapped = wrapCommandInBwrap({ command, viewRoot })
  return new Promise((resolveRun) => {
    const child = spawn('/bin/sh', ['-c', wrapped], { stdio: ['ignore', 'pipe', 'pipe'] })
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
  // ── The confinement is built here, from the view, and from nothing else ──
  await test('the argv unshares the network and binds only the view', () => {
    const args = buildBuiltinShellBwrapArgs({ viewRoot, command: 'true' })
    assert.ok(args.includes('--unshare-net'), 'ADR-0051 requires the network to be denied, which bwrap only does when it is unshared')
    assert.ok(args.includes('--die-with-parent'), 'a confined command may not outlive its run')
    assert.ok(args.includes('--new-session'), 'a confined command may not push input back into the parent TTY')
    const bindIndex = args.indexOf('--bind')
    assert.notEqual(bindIndex, -1)
    assert.deepEqual(args.slice(bindIndex, bindIndex + 3), ['--bind', viewRoot, viewRoot], 'the view is the only writable bind')
    assert.deepEqual(args.slice(-3), ['/bin/sh', '-c', 'true'], 'the command is the final argument, unparsed')
    // Everything else the sandbox can see is read-only.
    assert.equal(args.filter((argument) => argument === '--bind').length, 1, 'exactly one writable bind exists')
  })

  await test('a view root cannot smuggle in an extra bwrap argument', () => {
    const hostile = '/tmp/evil --bind /etc /etc'
    const args = buildBuiltinShellBwrapArgs({ viewRoot: hostile, command: 'true' })
    // The whole string stays ONE argv element, so it is a (nonexistent) path
    // rather than a flag bwrap would honour.
    assert.ok(args.includes(hostile), 'the hostile value survives whole, as a single element')
    assert.equal(args.filter((argument) => argument === '--bind').length, 1, 'no second bind was created')
    assert.equal(args.includes('/etc'), false, 'the injected path never becomes its own argument')
  })

  await test('the command is passed through whole, never parsed', () => {
    const command = `echo 'a b' && cat "$HOME/x"; rm -rf /`
    const args = buildBuiltinShellBwrapArgs({ viewRoot, command })
    assert.equal(args[args.length - 1], command, 'the model command reaches the shell byte for byte')
    const wrapped = wrapCommandInBwrap({ command, viewRoot })
    assert.ok(wrapped.startsWith('bwrap '), 'the wrapper invokes bwrap')
    assert.ok(wrapped.includes(`'echo '\\''a b'\\'' && cat "$HOME/x"; rm -rf /'`), 'the command is quoted as one argument')
  })

  await test('the profile digest identifies the confinement, not the view', async () => {
    assert.match(BWRAP_PROFILE_DIGEST, /^[a-f0-9]{64}$/)
    const other = await mkdtemp(join(tmpdir(), 'bwrap-other-'))
    try {
      const probe = await createBubblewrapBuiltinShellAdapter({ platform: 'linux' })
      assert.equal(probe.backend, BWRAP_BACKEND)
      assert.notDeepEqual(
        buildBuiltinShellBwrapArgs({ viewRoot, command: 'true' }),
        buildBuiltinShellBwrapArgs({ viewRoot: other, command: 'true' }),
        'two views produce different argv',
      )
    } finally {
      await rm(other, { recursive: true, force: true })
    }
  })

  // ── Refusals that hold on every platform ──
  await test('a non-Linux platform is unsupported, never downgraded', async () => {
    for (const platform of ['darwin', 'win32'] as const) {
      const probe = await createBubblewrapBuiltinShellAdapter({ platform }).probe()
      assert.equal(probe.status, 'unsupported')
      assert.match((probe as { reason: string }).reason, /Linux/)
    }
  })

  await test('a canary run with a mismatched profile digest fails closed', async () => {
    const result = await createBubblewrapBuiltinShellAdapter({ platform: 'linux' }).runCanary({
      viewRoot,
      profileDigest: 'b'.repeat(64),
      insideCanaryPath: join(viewRoot, 'inside.txt'),
      outsideCanaryPath: join(outsideRoot, 'secret.txt'),
    })
    assert.deepEqual(result, { insideAllowed: false, outsideDenied: false }, 'an unverified confinement proves nothing in either direction')
  })

  await test('a present binary alone never verifies', async () => {
    // The probe requires the kernel to grant the namespaces. This adapter has
    // a working `bwrap` in its imagination and nothing else, so it must fail.
    const binaryOnly = registerTrustedBuiltinShellSandboxAdapter({
      backend: BWRAP_BACKEND,
      probe: async () => ({ status: 'unsupported', reason: 'The kernel refused the namespaces this sandbox requires' }),
      runCanary: async () => ({ insideAllowed: true, outsideDenied: true }),
    })
    const outcome = await verifyBuiltinShellSandbox({ runId: 'run-no-ns', viewRoot })
    binaryOnly()
    assert.equal(outcome.status, 'unsupported')
    assert.equal(admitBuiltinShellSandbox({ verification: outcome, runId: 'run-no-ns', viewRoot }).verified, false)
  })

  await test('an adapter that cannot confine execution is denied, not run unwrapped', async () => {
    // probe and canary pass, but the adapter offers no wrapper. Verification
    // must not become permission to run on the open host.
    const noWrapper = registerTrustedBuiltinShellSandboxAdapter({
      backend: BWRAP_BACKEND,
      probe: async () => ({ status: 'supported', profileDigest: BWRAP_PROFILE_DIGEST }),
      runCanary: async () => ({ insideAllowed: true, outsideDenied: true }),
    })
    const outcome = await verifyBuiltinShellSandbox({ runId: 'run-nowrap', viewRoot })
    assert.equal(outcome.status, 'supported+verified')
    const wrapped = await wrapVerifiedBuiltinShellCommand({ backend: BWRAP_BACKEND, runId: 'run-nowrap', viewRoot, command: 'ls' })
    noWrapper()
    assert.equal(wrapped.ok, false)
    assert.match((wrapped as { reason: string }).reason, /cannot confine execution/)
  })

  await test('evidence from another backend cannot borrow this one', async () => {
    const installed = registerTrustedBuiltinShellSandboxAdapter(createBubblewrapBuiltinShellAdapter({ platform: 'linux' }))
    const wrapped = await wrapVerifiedBuiltinShellCommand({ backend: 'seatbelt', runId: 'run-x', viewRoot, command: 'ls' })
    installed()
    assert.equal(wrapped.ok, false)
    assert.match((wrapped as { reason: string }).reason, /no installed adapter for backend seatbelt/)
  })

  await test('the seam wraps through the adapter that verified the sandbox', async () => {
    const installed = registerTrustedBuiltinShellSandboxAdapter(createBubblewrapBuiltinShellAdapter({ platform: 'linux' }))
    try {
      const wrapped = await wrapVerifiedBuiltinShellCommand({ backend: BWRAP_BACKEND, runId: 'run-wrap', viewRoot, command: 'cat inside.txt' })
      assert.equal(wrapped.ok, true)
      const command = (wrapped as { command: string }).command
      assert.ok(command.startsWith('bwrap '))
      assert.ok(command.includes("'--unshare-net'"), 'the wrapped command carries the network denial')
      assert.ok(command.includes(`'${viewRoot}'`), 'the wrapped command is bound to this run view')
      releaseBuiltinShellExecution('run-wrap')
    } finally {
      installed()
    }
  })

  // ── Kernel-settled claims ──
  if (isLinux) {
    const adapter = createBubblewrapBuiltinShellAdapter()
    const restore = registerTrustedBuiltinShellSandboxAdapter(adapter)
    try {
      await kernelTest('the real bubblewrap backend probes and passes both canaries', async () => {
        const probe = await adapter.probe()
        assert.equal(probe.status, 'supported', `probe reported ${JSON.stringify(probe)}`)
        assert.equal((probe as { profileDigest: string }).profileDigest, BWRAP_PROFILE_DIGEST)
        const canary = await adapter.runCanary({
          viewRoot,
          profileDigest: BWRAP_PROFILE_DIGEST,
          insideCanaryPath: join(viewRoot, 'inside.txt'),
          outsideCanaryPath: join(outsideRoot, 'secret.txt'),
        })
        assert.deepEqual(canary, { insideAllowed: true, outsideDenied: true })
      })

      await kernelTest('verification issues evidence bound to this run and view', async () => {
        const outcome = await verifyBuiltinShellSandbox({ runId: 'run-verified', viewRoot })
        assert.equal(outcome.status, 'supported+verified', JSON.stringify(outcome))
        const evidence = (outcome as { evidence: { backend: string; viewRoot: string; profileDigest: string } }).evidence
        assert.equal(evidence.backend, BWRAP_BACKEND)
        assert.equal(evidence.viewRoot, viewRoot)
        assert.equal(evidence.profileDigest, BWRAP_PROFILE_DIGEST)
        assert.equal(admitBuiltinShellSandbox({ verification: outcome, runId: 'run-verified', viewRoot }).verified, true)
        // Replay refusal: another run, another view, and a lapsed window.
        assert.equal(admitBuiltinShellSandbox({ verification: outcome, runId: 'other-run', viewRoot }).verified, false)
        assert.equal(admitBuiltinShellSandbox({ verification: outcome, runId: 'run-verified', viewRoot: outsideRoot }).verified, false)
        assert.equal(
          admitBuiltinShellSandbox({ verification: outcome, runId: 'run-verified', viewRoot, now: Date.now() + 10 * 60_000 }).verified,
          false,
        )
        const forged = { status: 'supported+verified', evidence: { ...evidence } } as never
        assert.equal(admitBuiltinShellSandbox({ verification: forged, runId: 'run-verified', viewRoot }).verified, false)
      })

      await kernelTest('a verified shell can do allowed work inside the view', async () => {
        const read = await runWrapped('cat inside.txt')
        assert.equal(read.code, 0, read.stderr)
        assert.match(read.stdout, /inside the view/)
        const write = await runWrapped('echo produced > produced.txt')
        assert.equal(write.code, 0, write.stderr)
        assert.match(await readFile(join(viewRoot, 'produced.txt'), 'utf8'), /produced/)
      })

      await kernelTest('the kernel denies reads and writes outside the view', async () => {
        const read = await runWrapped(`cat ${JSON.stringify(join(outsideRoot, 'secret.txt'))}`)
        assert.notEqual(read.code, 0, 'reading outside the view must fail')
        assert.equal(read.stdout.includes('outside the view'), false, 'no content escapes')
        const write = await runWrapped(`echo escaped > ${JSON.stringify(join(outsideRoot, 'escaped.txt'))}`)
        assert.notEqual(write.code, 0, 'writing outside the view must fail')
        await assert.rejects(readFile(join(outsideRoot, 'escaped.txt'), 'utf8'), 'the file was never created')
      })

      await kernelTest('the kernel denies network the ADR does not allow', async () => {
        const probe = await runWrapped('cat /proc/net/route')
        // With the network namespace unshared the sandbox has only loopback,
        // so no external route exists to reach anything through.
        assert.equal(/\s0{8}\s/.test(probe.stdout), false, 'no default route exists inside the sandbox')
      })

      await kernelTest('cancellation kills the confined command', async () => {
        const wrapped = wrapCommandInBwrap({ command: 'sleep 30; echo never', viewRoot })
        const child = spawn('/bin/sh', ['-c', wrapped], { stdio: ['ignore', 'pipe', 'pipe'] })
        let stdout = ''
        child.stdout.on('data', (chunk) => { stdout += String(chunk) })
        const settled = new Promise<{ code: number | null }>((resolveRun) => {
          child.once('close', (code) => resolveRun({ code }))
        })
        await new Promise((r) => setTimeout(r, 300))
        child.kill('SIGKILL')
        assert.notEqual((await settled).code, 0, 'a cancelled command never settles success')
        assert.equal(stdout.includes('never'), false, 'the command did not run to completion')
      })
    } finally {
      restore()
    }
  } else {
    await test('this host installs no Linux adapter, so required stays denied', async () => {
      const outcome = await verifyBuiltinShellSandbox({ runId: 'run-unsupported', viewRoot })
      assert.notEqual(outcome.status, 'supported+verified', 'no bwrap adapter is installed off Linux')
      assert.equal(admitBuiltinShellSandbox({ verification: outcome, runId: 'run-unsupported', viewRoot }).verified, false)
    })
    for (const name of [
      'the real bubblewrap backend probes and passes both canaries',
      'verification issues evidence bound to this run and view',
      'a verified shell can do allowed work inside the view',
      'the kernel denies reads and writes outside the view',
      'the kernel denies network the ADR does not allow',
      'cancellation kills the confined command',
    ]) {
      console.log(`  – ${name} (needs a Linux kernel; not run on ${process.platform})`)
    }
  }

  const summary = isLinux
    ? `${passed} tests passed (${kernelAsserted} settled by the kernel)`
    : `${passed} tests passed; kernel-settled assertions NOT run on ${process.platform} — bubblewrap confinement is unproven on this host`
  console.log(`\n${summary}`)
} finally {
  await rm(workspace, { recursive: true, force: true })
  await rm(outside, { recursive: true, force: true })
}

import { randomUUID } from 'node:crypto'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

/**
 * Host-owned builtin-shell sandbox verification seam (ADR-0051).
 *
 * Platform adapters are intentionally absent here. Tickets 13/14 may register
 * one from trusted Electron code; renderer IPC, model text and tool arguments
 * have no constructor or deserialisation path into the issuance registry.
 */

export type BuiltinShellSandboxEvidence = Readonly<{
  runId: string
  backend: string
  profileDigest: string
  viewRoot: string
  issuedAt: number
  expiresAt: number
  replayScope: 'same-run'
  replayNonce: string
}>

export type BuiltinShellSandboxVerification =
  | { status: 'supported+verified'; evidence: BuiltinShellSandboxEvidence }
  | { status: 'unsupported' | 'probe-failed' | 'canary-failed'; reason: string; backend?: string }

export type TrustedBuiltinShellSandboxAdapter = {
  readonly backend: string
  probe: () => Promise<
    | { status: 'supported'; profileDigest: string }
    | { status: 'unsupported'; reason: string }
  >
  runCanary: (input: {
    viewRoot: string
    profileDigest: string
    insideCanaryPath: string
    outsideCanaryPath: string
  }) => Promise<{ insideAllowed: boolean; outsideDenied: boolean }>
  /**
   * Confine one run's commands, using the same backend and profile the canary
   * just proved. The adapter that verified the sandbox is the one that wraps
   * execution on purpose: a separate wrapper registry could drift from the
   * verifier and confine commands with a policy nothing ever tested.
   *
   * Optional only so a probe-and-canary adapter can be exercised on its own.
   * An adapter without it cannot run a `required` shell — see
   * `wrapVerifiedBuiltinShellCommand`, which denies rather than running the
   * command unconfined.
   */
  prepareExecution?: (input: { runId: string; viewRoot: string }) => Promise<{ wrapCommand: (command: string) => string }>
  releaseExecution?: (runId: string) => void
}

let trustedAdapter: TrustedBuiltinShellSandboxAdapter | undefined
const issuedEvidence = new WeakSet<object>()
const revokedEvidence = new WeakSet<object>()

/** Main-side registration only. A second owner is rejected instead of winning by order. */
export function registerTrustedBuiltinShellSandboxAdapter(adapter: TrustedBuiltinShellSandboxAdapter): () => void {
  if (trustedAdapter) throw new Error('Builtin shell sandbox adapter is already registered')
  if (!adapter || typeof adapter.backend !== 'string' || !adapter.backend.trim()
    || typeof adapter.probe !== 'function' || typeof adapter.runCanary !== 'function') {
    throw new Error('Malformed builtin shell sandbox adapter')
  }
  trustedAdapter = adapter
  return () => {
    if (trustedAdapter === adapter) trustedAdapter = undefined
  }
}

export async function verifyBuiltinShellSandbox(input: {
  runId: string
  viewRoot: string
  now?: number
  ttlMs?: number
}): Promise<BuiltinShellSandboxVerification> {
  const adapter = trustedAdapter
  if (!adapter) return { status: 'unsupported', reason: 'No trusted builtin shell sandbox adapter is installed' }
  const backend = adapter.backend.trim()
  const runId = input.runId.trim()
  const viewRoot = resolve(input.viewRoot)
  if (!runId || !input.viewRoot.trim()) return { status: 'probe-failed', backend, reason: 'Run id and Restricted Project View are required' }

  let probe: Awaited<ReturnType<TrustedBuiltinShellSandboxAdapter['probe']>>
  try {
    probe = await adapter.probe()
  } catch (error) {
    return { status: 'probe-failed', backend, reason: `Builtin shell sandbox probe failed: ${safeReason(error)}` }
  }
  if (probe.status === 'unsupported') {
    return { status: 'unsupported', backend, reason: probe.reason || 'Builtin shell sandbox backend is unsupported' }
  }
  if (!/^[a-f0-9]{64}$/.test(probe.profileDigest)) {
    return { status: 'probe-failed', backend, reason: 'Builtin shell sandbox profile digest is malformed' }
  }

  const nonce = randomUUID()
  const insideCanaryPath = join(viewRoot, `.subagents-builtin-shell-inside-${nonce}`)
  let outsideCanaryDir: string
  try {
    outsideCanaryDir = await mkdtemp(join(tmpdir(), 'subagents-builtin-shell-outside-'))
  } catch (error) {
    return { status: 'canary-failed', backend, reason: `Builtin shell sandbox canary could not be staged: ${safeReason(error)}` }
  }
  const outsideCanaryPath = join(outsideCanaryDir, 'canary')
  try {
    try {
      // A view that cannot hold the canary cannot be proven readable, so this
      // is a canary failure — a refusal — rather than a rejected promise the
      // admission path would never see.
      await writeFile(insideCanaryPath, 'inside\n', { mode: 0o600 })
      await writeFile(outsideCanaryPath, 'outside\n', { mode: 0o600 })
    } catch (error) {
      return { status: 'canary-failed', backend, reason: `Builtin shell sandbox canary could not be staged: ${safeReason(error)}` }
    }
    let canary: Awaited<ReturnType<TrustedBuiltinShellSandboxAdapter['runCanary']>>
    try {
      canary = await adapter.runCanary({
        viewRoot,
        profileDigest: probe.profileDigest,
        insideCanaryPath,
        outsideCanaryPath,
      })
    } catch (error) {
      return { status: 'canary-failed', backend, reason: `Builtin shell sandbox canary failed: ${safeReason(error)}` }
    }
    if (canary.insideAllowed !== true || canary.outsideDenied !== true) {
      return {
        status: 'canary-failed',
        backend,
        reason: `Builtin shell sandbox canary failed (inside=${String(canary.insideAllowed)}, outside-denied=${String(canary.outsideDenied)})`,
      }
    }
    const issuedAt = finiteInteger(input.now, Date.now())
    const ttlMs = Math.min(300_000, Math.max(1_000, finiteInteger(input.ttlMs, 60_000)))
    const evidence: BuiltinShellSandboxEvidence = Object.freeze({
      runId,
      backend,
      profileDigest: probe.profileDigest,
      viewRoot,
      issuedAt,
      expiresAt: issuedAt + ttlMs,
      replayScope: 'same-run',
      replayNonce: nonce,
    })
    issuedEvidence.add(evidence)
    return { status: 'supported+verified', evidence }
  } finally {
    await rm(insideCanaryPath, { force: true })
    await rm(outsideCanaryDir, { recursive: true, force: true })
  }
}

export function validateBuiltinShellSandboxEvidence(input: {
  evidence: unknown
  runId: string
  viewRoot: string
  now?: number
}): { verified: true; evidence: BuiltinShellSandboxEvidence } | { verified: false; reason: string } {
  if (!input.evidence || typeof input.evidence !== 'object') return { verified: false, reason: 'Builtin shell sandbox evidence is missing or malformed' }
  if (!issuedEvidence.has(input.evidence) || revokedEvidence.has(input.evidence)) {
    return { verified: false, reason: 'Builtin shell sandbox evidence was not issued by the trusted Host verifier' }
  }
  const evidence = input.evidence as BuiltinShellSandboxEvidence
  if (!evidence.runId || !evidence.backend || !/^[a-f0-9]{64}$/.test(evidence.profileDigest)
    || evidence.replayScope !== 'same-run' || !evidence.replayNonce
    || !Number.isFinite(evidence.issuedAt) || !Number.isFinite(evidence.expiresAt)) {
    return { verified: false, reason: 'Builtin shell sandbox evidence metadata is malformed' }
  }
  if (evidence.runId !== input.runId) return { verified: false, reason: 'Builtin shell sandbox evidence run mismatch' }
  if (evidence.viewRoot !== resolve(input.viewRoot)) return { verified: false, reason: 'Builtin shell sandbox evidence Restricted Project View mismatch' }
  const now = finiteInteger(input.now, Date.now())
  if (now < evidence.issuedAt || now > evidence.expiresAt) return { verified: false, reason: 'Builtin shell sandbox evidence is expired or not yet valid' }
  return { verified: true, evidence }
}

/** One required-mode admission from the frozen Host verification outcome. */
export function admitBuiltinShellSandbox(input: {
  verification: BuiltinShellSandboxVerification | undefined
  runId: string
  viewRoot: string
  now?: number
}): { verified: true; evidence: BuiltinShellSandboxEvidence; reason: string } | { verified: false; reason: string } {
  if (!input.verification) return { verified: false, reason: 'Required builtin shell denied: sandbox verification is missing' }
  if (input.verification.status !== 'supported+verified') {
    return { verified: false, reason: `Required builtin shell denied (${input.verification.status}): ${input.verification.reason}` }
  }
  const validation = validateBuiltinShellSandboxEvidence({
    evidence: input.verification.evidence,
    runId: input.runId,
    viewRoot: input.viewRoot,
    now: input.now,
  })
  if (!validation.verified) return validation
  return {
    verified: true,
    evidence: validation.evidence,
    reason: `Verified builtin shell sandbox backend=${validation.evidence.backend} profile=${validation.evidence.profileDigest.slice(0, 12)}`,
  }
}

/**
 * Rewrite a verified command so it actually executes inside the sandbox.
 *
 * Fails closed at every branch. Verification authorises nothing on its own:
 * if the registered adapter is not the backend that issued the evidence, or
 * offers no wrapper, or its wrapper throws, the call is DENIED. A verified but
 * unwrapped shell would run unconfined with an audit trail claiming it was
 * sandboxed, which is worse than refusing.
 */
export async function wrapVerifiedBuiltinShellCommand(input: {
  backend: string
  runId: string
  viewRoot: string
  command: string
}): Promise<{ ok: true; command: string } | { ok: false; reason: string }> {
  const adapter = trustedAdapter
  if (!adapter || adapter.backend !== input.backend) {
    return { ok: false, reason: `Required builtin shell denied: no installed adapter for backend ${input.backend}` }
  }
  if (typeof adapter.prepareExecution !== 'function') {
    return { ok: false, reason: `Required builtin shell denied: backend ${input.backend} cannot confine execution` }
  }
  if (!input.command) return { ok: false, reason: 'Required builtin shell denied: no command to confine' }
  try {
    const execution = await adapter.prepareExecution({ runId: input.runId, viewRoot: input.viewRoot })
    const wrapped = execution.wrapCommand(input.command)
    if (typeof wrapped !== 'string' || !wrapped.trim()) {
      return { ok: false, reason: 'Required builtin shell denied: sandbox wrapper produced no command' }
    }
    return { ok: true, command: wrapped }
  } catch (error) {
    return { ok: false, reason: `Required builtin shell denied: sandbox could not be prepared (${safeReason(error)})` }
  }
}

/** Drop whatever the adapter staged for a finished run. Never throws. */
export function releaseBuiltinShellExecution(runId: string): void {
  try {
    trustedAdapter?.releaseExecution?.(runId)
  } catch {
    /* releasing is best-effort cleanup; a failure must not break settlement */
  }
}

export function revokeBuiltinShellSandboxEvidence(evidence: BuiltinShellSandboxEvidence | undefined): void {
  if (evidence && typeof evidence === 'object') revokedEvidence.add(evidence)
}

function finiteInteger(value: number | undefined, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? Math.floor(value) : fallback
}

function safeReason(error: unknown): string {
  return (error instanceof Error ? error.message : String(error)).replace(/[\r\n]+/g, ' ').slice(0, 160)
}

import { createHash } from 'node:crypto'
import { spawn } from 'node:child_process'
import { mkdtemp, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, posix, resolve } from 'node:path'
import type { TrustedBuiltinShellSandboxAdapter } from './piBuiltinShellSandbox.ts'

/**
 * macOS Seatbelt adapter for the builtin shell (ADR-0051, issue 13).
 *
 * The profile is built HERE from the frozen run policy's Restricted Project
 * View and nothing else: no fragment, path, or flag reaches it from model text,
 * tool arguments, or the renderer. The only variable is the view root, and it
 * arrives already resolved by the Host verifier.
 *
 * This is deliberately NOT the external-CLI seatbelt path (ADR-0022,
 * cliFilesystemSandbox.ts). That one wraps a spawned CLI and reports a
 * capability boolean; ADR-0051 requires a probe plus two canaries and issues
 * metadata-only evidence. Sharing the builder would let a change made for one
 * contract silently move the other.
 */

export const SEATBELT_BACKEND = 'seatbelt'

/**
 * The view root is substituted into this exact template, so the digest below
 * identifies the POLICY while the evidence separately binds the view root. A
 * profile whose text does not reproduce the template is not this backend.
 */
const VIEW_ROOT_PLACEHOLDER = '__SUBAGENTS_VIEW_ROOT__'

/**
 * `(literal "/")` is load-bearing on macOS 26: without a readable root the
 * loader aborts the child with SIGABRT before the command ever runs, which
 * would read as a denial and quietly pass a canary that proved nothing.
 * Every other allow is the minimum a POSIX shell needs to start.
 */
const PROFILE_TEMPLATE = `(version 1)
(deny default)
(allow process-exec)
(allow process-fork)
(allow signal)
(allow sysctl-read)
(allow mach-lookup)
(allow file-read-metadata)
(allow file-read*
  (literal "/")
  (subpath "/usr")
  (subpath "/bin")
  (subpath "/sbin")
  (subpath "/System")
  (subpath "/Library/Frameworks")
  (subpath "/private/var/db/dyld")
  (literal "/dev/null")
  (literal "/dev/zero")
  (literal "/dev/random")
  (literal "/dev/urandom")
  (literal "/dev/tty")
  (literal "/dev/dtracehelper")
)
(allow file-write-data
  (literal "/dev/null")
  (literal "/dev/tty")
)
(allow file-read* file-write*
  (subpath "${VIEW_ROOT_PLACEHOLDER}")
)
`

/** Digest of the policy itself. View binding travels separately in the evidence. */
export const SEATBELT_PROFILE_DIGEST = createHash('sha256').update(PROFILE_TEMPLATE, 'utf8').digest('hex')

/**
 * Instantiate the profile for one Restricted Project View.
 *
 * Seatbelt is macOS-only, so SBPL paths stay POSIX even when this pure builder
 * is exercised on another platform. A view root carrying a quote or backslash
 * is escaped rather than rejected, because rejecting it here would turn a
 * legal directory name into an unexplained denial later.
 */
export function buildBuiltinShellSeatbeltProfile(viewRoot: string): string {
  const root = posix.resolve(viewRoot.replace(/\\/g, '/'))
  const escaped = root.replace(/\\/g, '\\\\').replace(/"/g, '\\"')
  return PROFILE_TEMPLATE.replace(VIEW_ROOT_PLACEHOLDER, escaped)
}

/**
 * The argv that runs `command` under this run's profile.
 *
 * Exported so execution and canary share one construction: a wrap the canary
 * never exercised would be a wrap nothing verified.
 */
export function seatbeltShellArgv(input: { profilePath: string; command: string }): { file: string; args: string[] } {
  return { file: '/usr/bin/sandbox-exec', args: ['-f', input.profilePath, '/bin/sh', '-c', input.command] }
}

/**
 * `spawnFailed` separates "the binary never ran" from "the child was killed".
 *
 * Seatbelt enforces by aborting the child, so a signal death is the SUCCESSFUL
 * denial path. Collapsing both into a null exit code would report an enforcing
 * sandbox as a missing one, and refuse every run on a host where it works.
 */
type RunOutcome = { code: number | null; signal: NodeJS.Signals | null; timedOut: boolean; spawnFailed: boolean }

function runSandboxed(input: { profilePath: string; command: string; cwd?: string; timeoutMs: number }): Promise<RunOutcome> {
  const { file, args } = seatbeltShellArgv(input)
  return new Promise((resolveRun) => {
    const child = spawn(file, args, {
      ...(input.cwd ? { cwd: input.cwd } : {}),
      stdio: ['ignore', 'ignore', 'ignore'],
    })
    let timedOut = false
    let spawnFailed = false
    const timer = setTimeout(() => {
      timedOut = true
      child.kill('SIGKILL')
    }, input.timeoutMs)
    child.once('error', () => {
      spawnFailed = true
      clearTimeout(timer)
      resolveRun({ code: null, signal: null, timedOut, spawnFailed })
    })
    child.once('close', (code, signal) => {
      if (spawnFailed) return
      clearTimeout(timer)
      resolveRun({ code, signal, timedOut, spawnFailed })
    })
  })
}

/** Ran to completion and reported success. Anything else is a denial. */
function ranSuccessfully(outcome: RunOutcome): boolean {
  return outcome.code === 0 && !outcome.timedOut && !outcome.spawnFailed
}

/**
 * Write the profile for one view into a private temp file.
 *
 * Callers own the returned cleanup. The file is 0600 and lives outside the
 * view, so a command running inside the sandbox can neither read nor rewrite
 * the policy that constrains it.
 */
export async function withSeatbeltProfile<T>(
  viewRoot: string,
  runWithProfile: (input: { profilePath: string; sandboxViewRoot: string }) => Promise<T>,
): Promise<T> {
  const dir = await mkdtemp(join(tmpdir(), 'subagents-seatbelt-'))
  const profilePath = join(dir, 'builtin-shell.sb')
  try {
    const sandboxViewRoot = await realViewRoot(viewRoot)
    await writeFile(profilePath, buildBuiltinShellSeatbeltProfile(sandboxViewRoot), { mode: 0o600 })
    return await runWithProfile({ profilePath, sandboxViewRoot })
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}

/**
 * The path Seatbelt will actually see.
 *
 * SBPL `subpath` matches the kernel's resolved path, and macOS routes `/tmp`
 * and `/var` through symlinks into `/private`. A profile naming the unresolved
 * path matches nothing, so every read inside the view is denied and the canary
 * fails for a reason that has nothing to do with policy. Resolve first; fall
 * back to the lexical path only when the view has not been created yet, where
 * the canary will fail honestly anyway.
 */
export async function realViewRoot(viewRoot: string): Promise<string> {
  try {
    return await realpath(resolve(viewRoot))
  } catch {
    return resolve(viewRoot)
  }
}

/**
 * A shell command quoted as one argument to `/bin/sh -c`.
 *
 * The model's command is never parsed or rewritten — it is passed through
 * whole — so what the sandbox executes is what the approval gate inspected.
 */
export function quoteForShell(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`
}

/**
 * Per-run profile files.
 *
 * The profile must outlive the approval handler that authorises a command —
 * the command executes after the handler returns — so it is written once per
 * run and removed when the run unbinds. Keying by run id also means a command
 * can never execute under another run's view.
 */
const runProfiles = new Map<string, { profilePath: string; dir: string; sandboxViewRoot: string }>()

export async function ensureSeatbeltProfileForRun(input: { runId: string; viewRoot: string }): Promise<{ profilePath: string; sandboxViewRoot: string }> {
  const existing = runProfiles.get(input.runId)
  if (existing) return { profilePath: existing.profilePath, sandboxViewRoot: existing.sandboxViewRoot }
  const dir = await mkdtemp(join(tmpdir(), 'subagents-seatbelt-run-'))
  const profilePath = join(dir, 'builtin-shell.sb')
  const sandboxViewRoot = await realViewRoot(input.viewRoot)
  await writeFile(profilePath, buildBuiltinShellSeatbeltProfile(sandboxViewRoot), { mode: 0o600 })
  runProfiles.set(input.runId, { profilePath, dir, sandboxViewRoot })
  return { profilePath, sandboxViewRoot }
}

export function releaseSeatbeltProfileForRun(runId: string): void {
  const entry = runProfiles.get(runId)
  if (!entry) return
  runProfiles.delete(runId)
  void rm(entry.dir, { recursive: true, force: true }).catch(() => {})
}

/**
 * The command Pi should execute instead of the model's own.
 *
 * The original command is passed through as a single quoted argument, never
 * parsed or edited, so the string the approval gate inspected is the string
 * that runs — only now it runs confined.
 */
export function wrapCommandInSeatbelt(input: { command: string; profilePath: string }): string {
  const { file, args } = seatbeltShellArgv({ profilePath: input.profilePath, command: input.command })
  return [file, ...args.slice(0, -1).map(quoteForShell), quoteForShell(input.command)].join(' ')
}

export function createSeatbeltBuiltinShellAdapter(options: {
  platform?: NodeJS.Platform
  probeTimeoutMs?: number
  canaryTimeoutMs?: number
} = {}): TrustedBuiltinShellSandboxAdapter {
  const platform = options.platform || process.platform
  const probeTimeoutMs = options.probeTimeoutMs ?? 10_000
  const canaryTimeoutMs = options.canaryTimeoutMs ?? 10_000
  return {
    backend: SEATBELT_BACKEND,
    async prepareExecution(input) {
      const { profilePath } = await ensureSeatbeltProfileForRun(input)
      return { wrapCommand: (command: string) => wrapCommandInSeatbelt({ command, profilePath }) }
    },
    releaseExecution(runId: string) {
      releaseSeatbeltProfileForRun(runId)
    },
    async probe() {
      if (platform !== 'darwin') {
        return { status: 'unsupported', reason: `Seatbelt builtin shell sandbox requires macOS (platform=${platform})` }
      }
      // Finding the binary is not verification (ADR-0051): prove sandbox-exec
      // can actually confine a child on THIS host before claiming support.
      const dir = await mkdtemp(join(tmpdir(), 'subagents-seatbelt-probe-'))
      try {
        const denyAll = join(dir, 'probe.sb')
        await writeFile(denyAll, '(version 1)\n(deny default)\n(allow process-exec)\n(allow file-read-metadata)\n', { mode: 0o600 })
        const confined = await runSandboxed({ profilePath: denyAll, command: 'exit 0', timeoutMs: probeTimeoutMs })
        if (confined.spawnFailed) {
          return { status: 'unsupported', reason: 'sandbox-exec could not be executed on this host' }
        }
        if (ranSuccessfully(confined)) {
          return { status: 'unsupported', reason: 'Seatbelt did not confine a deny-default probe; the backend is not enforcing' }
        }
        return { status: 'supported', profileDigest: SEATBELT_PROFILE_DIGEST }
      } finally {
        await rm(dir, { recursive: true, force: true })
      }
    },
    async runCanary(input) {
      // The canary must run the profile this run will actually use, so a
      // digest that does not match the built profile fails closed here rather
      // than issuing evidence for a policy nobody verified.
      if (input.profileDigest !== SEATBELT_PROFILE_DIGEST) {
        return { insideAllowed: false, outsideDenied: false }
      }
      return withSeatbeltProfile(input.viewRoot, async ({ profilePath, sandboxViewRoot }) => {
        const inside = await runSandboxed({
          profilePath,
          cwd: sandboxViewRoot,
          command: `cat ${quoteForShell(input.insideCanaryPath)}`,
          timeoutMs: canaryTimeoutMs,
        })
        const outside = await runSandboxed({
          profilePath,
          cwd: sandboxViewRoot,
          command: `cat ${quoteForShell(input.outsideCanaryPath)}`,
          timeoutMs: canaryTimeoutMs,
        })
        // A timeout or a failed spawn proves nothing either way, so neither
        // observation may be read as a denial: both must be positive.
        return {
          insideAllowed: ranSuccessfully(inside),
          outsideDenied: !ranSuccessfully(outside) && !outside.timedOut && !outside.spawnFailed,
        }
      })
    },
  }
}

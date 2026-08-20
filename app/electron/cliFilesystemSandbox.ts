/**
 * Filesystem sandbox probe + profile builders for required external CLI isolation.
 * macOS: sandbox-exec (seatbelt); Linux: bwrap when available.
 * Verification runs real probe commands — not a boolean capability claim alone.
 */

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import type { FilesystemIsolationStatus } from '../src/agent/outbound/cliSandbox.ts'

export type SandboxProbeResult = {
  status: FilesystemIsolationStatus
  /** Non-sensitive diagnostic (no file contents). */
  detail: string
  engine?: 'seatbelt' | 'bwrap' | 'none'
}

function which(bin: string): string | null {
  const r = spawnSync(process.platform === 'win32' ? 'where' : 'which', [bin], {
    encoding: 'utf8',
  })
  if (r.status !== 0) return null
  const line = String(r.stdout || '')
    .split(/\r?\n/)
    .map((s) => s.trim())
    .find(Boolean)
  return line || null
}

/** Seatbelt profile: allow viewRoot R/W + essential system reads; deny default. */
export function buildSeatbeltProfile(viewRoot: string): string {
  // Seatbelt is a macOS-only engine, so its SBPL paths must keep POSIX
  // semantics even when this pure builder is exercised by a Windows CI host.
  const root = path.posix.resolve(viewRoot)
  // Escape for SBPL strings
  const esc = root.replace(/\\/g, '\\\\').replace(/"/g, '\\"')
  return `(version 1)
(deny default)
(allow process-exec)
(allow process-fork)
(allow signal)
(allow sysctl-read)
(allow mach-lookup)
(allow file-read-metadata)
(allow file-read*
  (subpath "/usr")
  (subpath "/bin")
  (subpath "/sbin")
  (subpath "/System")
  (subpath "/Library/Frameworks")
  (subpath "/private/var/db/dyld")
  (literal "/dev/null")
  (literal "/dev/urandom")
  (literal "/dev/random")
)
(allow file-read* file-write*
  (subpath "${esc}")
)
(allow file-write-data
  (literal "/dev/null")
)
`
}

export function buildBwrapArgs(viewRoot: string, command: string[]): string[] {
  const root = path.resolve(viewRoot)
  return [
    '--ro-bind',
    '/usr',
    '/usr',
    '--ro-bind',
    '/bin',
    '/bin',
    '--ro-bind',
    '/lib',
    '/lib',
    '--ro-bind-try',
    '/lib64',
    '/lib64',
    '--proc',
    '/proc',
    '--dev',
    '/dev',
    '--tmpfs',
    '/tmp',
    '--bind',
    root,
    root,
    '--chdir',
    root,
    '--die-with-parent',
    ...command,
  ]
}

function runProbe(
  cmd: string,
  args: string[],
  opts?: { timeoutMs?: number },
): { ok: boolean; code: number | null; stderr: string } {
  const r = spawnSync(cmd, args, {
    encoding: 'utf8',
    timeout: opts?.timeoutMs ?? 5_000,
  })
  return {
    ok: r.status === 0,
    code: r.status,
    stderr: String(r.stderr || r.error?.message || '').slice(0, 200),
  }
}

/**
 * Verify isolation: reading a canary outside viewRoot must fail; inside must succeed.
 */
export function verifyCliFilesystemSandbox(opts: {
  viewRoot: string
  /** Absolute path that must NOT be readable inside sandbox (e.g. original project canary). */
  forbiddenCanaryPath: string
  platform?: NodeJS.Platform
}): SandboxProbeResult {
  const platform = opts.platform || process.platform
  const viewRoot = path.resolve(opts.viewRoot)
  if (!fs.existsSync(viewRoot)) {
    return { status: 'unavailable', detail: 'viewRoot missing', engine: 'none' }
  }

  // Ensure canaries exist
  const allowedCanary = path.join(viewRoot, '.sandbox-canary-allowed')
  try {
    fs.writeFileSync(allowedCanary, 'allowed\n', 'utf8')
  } catch (e) {
    return {
      status: 'unavailable',
      detail: `cannot write view canary: ${e instanceof Error ? e.message : e}`,
      engine: 'none',
    }
  }

  const forbidden = path.resolve(opts.forbiddenCanaryPath)
  if (!fs.existsSync(forbidden)) {
    try {
      fs.mkdirSync(path.dirname(forbidden), { recursive: true })
      fs.writeFileSync(forbidden, 'forbidden-should-not-read\n', 'utf8')
    } catch {
      return {
        status: 'unavailable',
        detail: 'cannot create forbidden canary',
        engine: 'none',
      }
    }
  }

  if (platform === 'darwin') {
    const sandboxExec = which('sandbox-exec')
    if (!sandboxExec) {
      return { status: 'unavailable', detail: 'sandbox-exec not found', engine: 'none' }
    }
    const profilePath = path.join(os.tmpdir(), `subagents-sb-${process.pid}.sb`)
    try {
      fs.writeFileSync(profilePath, buildSeatbeltProfile(viewRoot), 'utf8')
      const allow = runProbe(sandboxExec, ['-f', profilePath, '/bin/cat', allowedCanary])
      const deny = runProbe(sandboxExec, ['-f', profilePath, '/bin/cat', forbidden])
      if (allow.ok && !deny.ok) {
        return {
          status: 'verified',
          detail: 'seatbelt: view readable, forbidden path denied',
          engine: 'seatbelt',
        }
      }
      if (!allow.ok) {
        return {
          status: 'unverified',
          detail: `seatbelt allow-probe failed (code=${allow.code})`,
          engine: 'seatbelt',
        }
      }
      return {
        status: 'unverified',
        detail: 'seatbelt did not deny forbidden path',
        engine: 'seatbelt',
      }
    } finally {
      try {
        fs.unlinkSync(profilePath)
      } catch {
        /* ignore */
      }
    }
  }

  if (platform === 'linux') {
    const bwrap = which('bwrap')
    if (!bwrap) {
      return { status: 'unavailable', detail: 'bwrap not found', engine: 'none' }
    }
    const allow = runProbe(bwrap, buildBwrapArgs(viewRoot, ['/bin/cat', allowedCanary]))
    const deny = runProbe(bwrap, buildBwrapArgs(viewRoot, ['/bin/cat', forbidden]))
    if (allow.ok && !deny.ok) {
      return {
        status: 'verified',
        detail: 'bwrap: view readable, forbidden path denied',
        engine: 'bwrap',
      }
    }
    if (!allow.ok) {
      return {
        status: 'unverified',
        detail: `bwrap allow-probe failed (code=${allow.code})`,
        engine: 'bwrap',
      }
    }
    return {
      status: 'unverified',
      detail: 'bwrap did not deny forbidden path',
      engine: 'bwrap',
    }
  }

  // Windows: no portable OS sandbox in v1
  return {
    status: 'unavailable',
    detail: `no filesystem sandbox engine for platform ${platform}`,
    engine: 'none',
  }
}

/**
 * Wrap a CLI argv so it runs under the verified sandbox engine.
 * Caller still uses evaluateCliSandboxGate for policy.
 */
export function wrapCommandInSandbox(opts: {
  engine: 'seatbelt' | 'bwrap'
  viewRoot: string
  command: string
  args: string[]
}): { command: string; args: string[]; profilePath?: string } {
  if (opts.engine === 'seatbelt') {
    const profilePath = path.join(os.tmpdir(), `subagents-run-sb-${process.pid}-${Date.now()}.sb`)
    fs.writeFileSync(profilePath, buildSeatbeltProfile(opts.viewRoot), 'utf8')
    return {
      command: 'sandbox-exec',
      args: ['-f', profilePath, opts.command, ...opts.args],
      profilePath,
    }
  }
  return {
    command: 'bwrap',
    args: buildBwrapArgs(opts.viewRoot, [opts.command, ...opts.args]),
  }
}

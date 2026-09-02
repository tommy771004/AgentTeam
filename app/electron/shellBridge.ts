/**
 * Real shell execution (bash) — Electron main
 * Tracks active children so CLI / tools can be cancelled.
 */

import { spawn, type ChildProcess } from 'node:child_process'
import path from 'node:path'
import os from 'node:os'
import { randomUUID } from 'node:crypto'
import {
  isWindows,
  shellCommandSpec,
  spawnCommandSpec,
  terminateProcessTree,
} from './platformProcess.ts'
import { buildUserEnvironment } from './userEnvironment.ts'

export type BashResult = {
  ok: boolean
  code: number | null
  stdout: string
  stderr: string
  timedOut?: boolean
  cancelled?: boolean
  runId?: string
  /** Output was clipped; credential-bearing callers must not expose partial tokens. */
  outputTruncated?: boolean
}

type ActiveRun = {
  child: ChildProcess
  tag?: string
}

const activeRuns = new Map<string, ActiveRun>()

function sanitizedChildEnvironment(overrides: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const environment = buildUserEnvironment(overrides)
  delete environment.SUBAGENTS_MEMORY_CONTROL_MAINTAINER_TOKEN
  return environment
}

/** Kill one run, all runs with a tag, or everything */
export function cancelBash(opts?: {
  runId?: string
  tag?: string
}): { ok: boolean; killed: number } {
  const targets = resolveActiveRunIds(opts)

  let killed = 0
  for (const id of targets) {
    const r = activeRuns.get(id)
    if (!r) continue
    try {
      void terminateProcessTree(r.child)
      setTimeout(() => {
        void terminateProcessTree(r.child, true)
      }, 1500)
      killed += 1
    } catch {
      /* ignore */
    }
  }
  return { ok: killed > 0, killed }
}

function resolveActiveRunIds(opts?: { runId?: string; tag?: string }): string[] {
  const targets: string[] = []
  if (opts?.runId) {
    if (activeRuns.has(opts.runId)) targets.push(opts.runId)
  } else if (opts?.tag) {
    for (const [id, r] of activeRuns) {
      if (r.tag === opts.tag) targets.push(id)
    }
  } else {
    targets.push(...activeRuns.keys())
  }
  return targets
}

function waitForRunsClosed(runIds: string[], timeoutMs: number): Promise<boolean> {
  const pending = () => runIds.some((runId) => activeRuns.has(runId))
  if (!pending()) return Promise.resolve(true)
  return new Promise((resolve) => {
    let settled = false
    const finish = (confirmed: boolean) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve(confirmed)
    }
    const timer = setTimeout(() => finish(!pending()), timeoutMs)
    for (const runId of runIds) {
      activeRuns.get(runId)?.child.once('close', () => finish(!pending()))
      activeRuns.get(runId)?.child.once('error', () => finish(!pending()))
    }
  })
}

export type BashCancellationResult = {
  ok: boolean
  killed: number
  confirmed: boolean
  detail?: string
}

/**
 * Terminate and wait for every owned child in the selected tree.  Returning
 * before `close` is observed would let the session claim cancellation while
 * descendants are still running, so the durable session uses this path.
 */
export async function cancelBashAndWait(opts?: {
  runId?: string
  tag?: string
  graceMs?: number
}): Promise<BashCancellationResult> {
  const targets = resolveActiveRunIds(opts)
  if (!targets.length) {
    return { ok: false, killed: 0, confirmed: false, detail: 'process already exited or was not registered' }
  }
  let killed = 0
  await Promise.all(targets.map(async (runId) => {
    const active = activeRuns.get(runId)
    if (!active) return
    try {
      await terminateProcessTree(active.child)
      killed += 1
    } catch {
      /* The close/force pass below is the source of truth. */
    }
  }))
  const graceMs = Math.max(100, Math.min(opts?.graceMs ?? 2_000, 10_000))
  let confirmed = await waitForRunsClosed(targets, graceMs)
  if (!confirmed) {
    await Promise.all(targets.map(async (runId) => {
      const active = activeRuns.get(runId)
      if (!active) return
      try { await terminateProcessTree(active.child, true) } catch { /* best effort */ }
    }))
    confirmed = await waitForRunsClosed(targets, graceMs)
  }
  return {
    ok: killed > 0,
    killed,
    confirmed,
    detail: confirmed ? undefined : 'process tree close was not observed before the bounded grace period',
  }
}

/** Deliver interactive input to the matching child stdin, fail-closed. */
export function writeRunStdin(runId: string, value: string): boolean {
  const stdin = activeRuns.get(runId)?.child.stdin
  if (!stdin || stdin.destroyed || !stdin.writable) return false
  try {
    stdin.write(value.endsWith('\n') ? value : `${value}\n`)
    return true
  } catch {
    return false
  }
}

type RunProcessCore = {
  cwd?: string
  timeoutMs?: number
  /** External CLI session owns startup/idle/absolute deadlines. */
  externalSession?: boolean
  /** Close immediately for one-shot CLIs that wait for piped prompt EOF. */
  stdinMode?: 'interactive' | 'closed'
  env?: Record<string, string>
  runId?: string
  tag?: string
  onStarted?: (processId: string) => void
  onStdout?: (chunk: string) => void
  onStderr?: (chunk: string) => void
}

function runSpawnedProcess(
  file: string,
  args: string[],
  opts: RunProcessCore & { windowsVerbatimArguments?: boolean },
): Promise<BashResult> {
  // External CLI sessions use their own startup/idle/absolute policy. Their
  // shell guard remains a generous absolute backstop; ordinary shell calls
  // retain the existing bounded five-minute cap.
  const maxTimeoutMs = opts.externalSession ? 14_400_000 : 600_000
  const timeoutMs = Math.min(Math.max(opts.timeoutMs || 60_000, 1000), maxTimeoutMs)
  const cwd = opts.cwd && path.isAbsolute(opts.cwd) ? opts.cwd : process.cwd()
  const runId = opts.runId || randomUUID()

  return new Promise((resolve) => {
    let stdout = ''
    let stderr = ''
    let outputTruncated = false
    let settled = false
    const child = spawn(file, args, {
      cwd,
      env: sanitizedChildEnvironment({
        ...(opts.env || {}),
        HOME: os.homedir(),
        // Force non-interactive: never block waiting for a TTY prompt
        CI: process.env.CI || '1',
        NO_COLOR: '1',
        TERM: process.env.TERM || 'dumb',
      }),
      stdio: ['pipe', 'pipe', 'pipe'],
      detached: !isWindows,
      windowsHide: true,
      windowsVerbatimArguments: opts.windowsVerbatimArguments,
    })

    activeRuns.set(runId, { child, tag: opts.tag })
    try {
      opts.onStarted?.(runId)
    } catch {
      /* lifecycle projections cannot abort process ownership */
    }
    if (opts.stdinMode === 'closed') child.stdin?.end()

    const finish = (result: BashResult) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      activeRuns.delete(runId)
      resolve({ ...result, runId, ...(outputTruncated ? { outputTruncated: true } : {}) })
    }

    const timer = setTimeout(() => {
      try {
        void terminateProcessTree(child)
        setTimeout(() => void terminateProcessTree(child, true), 1500)
      } catch {
        /* ignore */
      }
      finish({
        ok: false,
        code: null,
        stdout: stdout.slice(0, 80_000),
        stderr: (stderr + '\n[timeout]').slice(0, 20_000),
        timedOut: true,
      })
    }, timeoutMs)

    child.stdout?.on('data', (c: Buffer) => {
      const chunk = c.toString('utf-8')
      stdout += chunk
      if (stdout.length > 80_000) outputTruncated = true
      if (stdout.length > 100_000) stdout = stdout.slice(-80_000)
      try {
        opts.onStdout?.(chunk)
      } catch {
        /* ignore listener errors */
      }
    })
    child.stderr?.on('data', (c: Buffer) => {
      const chunk = c.toString('utf-8')
      stderr += chunk
      if (stderr.length > 20_000) outputTruncated = true
      if (stderr.length > 40_000) stderr = stderr.slice(-20_000)
      try {
        opts.onStderr?.(chunk)
      } catch {
        /* ignore */
      }
    })
    child.on('error', (err) => {
      finish({ ok: false, code: 1, stdout, stderr: err.message })
    })
    child.on('close', (code, signal) => {
      const cancelled = signal === 'SIGTERM' || signal === 'SIGKILL'
      finish({
        ok: code === 0,
        code,
        stdout: stdout.slice(0, 80_000),
        stderr: cancelled
          ? (stderr + '\n[cancelled]').slice(0, 20_000)
          : stderr.slice(0, 20_000),
        cancelled: cancelled && code !== 0,
      })
    })
  })
}

export async function runBash(input: {
  command: string
  cwd?: string
  timeoutMs?: number
  env?: Record<string, string>
  /** Optional id for cancelBash({ runId }) */
  runId?: string
  /** Group tag e.g. 'cli-agent' for bulk cancel */
  tag?: string
  /** Live stdout chunks (UTF-8) for CLI process feed */
  onStdout?: (chunk: string) => void
  /** Live stderr chunks */
  onStderr?: (chunk: string) => void
}): Promise<BashResult> {
  const command = (input.command || '').trim()
  if (!command) return { ok: false, code: 1, stdout: '', stderr: 'empty command' }

  const shell = shellCommandSpec(command)
  return runSpawnedProcess(shell.file, shell.args, {
    ...input,
    windowsVerbatimArguments: shell.windowsVerbatimArguments,
  })
}

/**
 * Spawn a binary with argv (no shell). Preferred for agent CLIs so Chinese /
 * multiline prompts and paths never break through cmd.exe quoting.
 */
export async function runArgv(input: {
  file: string
  args: string[]
  cwd?: string
  timeoutMs?: number
  externalSession?: boolean
  stdinMode?: 'interactive' | 'closed'
  env?: Record<string, string>
  runId?: string
  tag?: string
  onStarted?: (processId: string) => void
  onStdout?: (chunk: string) => void
  onStderr?: (chunk: string) => void
}): Promise<BashResult> {
  const file = (input.file || '').trim()
  if (!file) return { ok: false, code: 1, stdout: '', stderr: 'empty file' }
  const spec = spawnCommandSpec(file, input.args || [])
  return runSpawnedProcess(spec.file, spec.args, {
    ...input,
    windowsVerbatimArguments: spec.windowsVerbatimArguments,
  })
}

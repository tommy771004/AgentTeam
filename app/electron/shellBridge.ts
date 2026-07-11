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
  terminateProcessTree,
} from './platformProcess'

export type BashResult = {
  ok: boolean
  code: number | null
  stdout: string
  stderr: string
  timedOut?: boolean
  cancelled?: boolean
  runId?: string
}

type ActiveRun = {
  child: ChildProcess
  tag?: string
}

const activeRuns = new Map<string, ActiveRun>()

export function listActiveBashRuns(): Array<{ runId: string; tag?: string }> {
  return [...activeRuns.entries()].map(([runId, v]) => ({ runId, tag: v.tag }))
}

/** Kill one run, all runs with a tag, or everything */
export function cancelBash(opts?: {
  runId?: string
  tag?: string
}): { ok: boolean; killed: number } {
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

export async function runBash(input: {
  command: string
  cwd?: string
  timeoutMs?: number
  env?: Record<string, string>
  /** Optional id for cancelBash({ runId }) */
  runId?: string
  /** Group tag e.g. 'cli-agent' for bulk cancel */
  tag?: string
}): Promise<BashResult> {
  const command = (input.command || '').trim()
  if (!command) return { ok: false, code: 1, stdout: '', stderr: 'empty command' }

  const timeoutMs = Math.min(Math.max(input.timeoutMs || 60_000, 1000), 600_000)
  const cwd = input.cwd && path.isAbsolute(input.cwd) ? input.cwd : process.cwd()
  const shell = shellCommandSpec(command)
  const runId = input.runId || randomUUID()

  return new Promise((resolve) => {
    let stdout = ''
    let stderr = ''
    let settled = false
    const child = spawn(shell.file, shell.args, {
      cwd,
      env: { ...process.env, ...(input.env || {}), HOME: os.homedir() },
      stdio: ['ignore', 'pipe', 'pipe'],
      detached: !isWindows,
      windowsHide: true,
      windowsVerbatimArguments: shell.windowsVerbatimArguments,
    })

    activeRuns.set(runId, { child, tag: input.tag })

    const finish = (result: BashResult) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      activeRuns.delete(runId)
      resolve({ ...result, runId })
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
      stdout += c.toString('utf-8')
      if (stdout.length > 100_000) stdout = stdout.slice(-80_000)
    })
    child.stderr?.on('data', (c: Buffer) => {
      stderr += c.toString('utf-8')
      if (stderr.length > 40_000) stderr = stderr.slice(-20_000)
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

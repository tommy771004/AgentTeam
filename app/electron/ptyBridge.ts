/**
 * Multi-tab interactive shell sessions (line-oriented "soft PTY")
 * Full ANSI PTY needs node-pty; this provides persistent bash -i sessions with stdin/stdout.
 */

import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import os from 'node:os'
import path from 'node:path'
import type { WebContents } from 'electron'
import {
  type CommandSpec,
  isWindows,
  spawnCommandSpec,
  terminateProcessTree,
} from './platformProcess'

export type TermSessionInfo = {
  id: string
  title: string
  cwd: string
  alive: boolean
  createdAt: string
}

type Session = {
  id: string
  title: string
  cwd: string
  createdAt: string
  child: ChildProcessWithoutNullStreams
  alive: boolean
  webContents: WebContents | null
}

const sessions = new Map<string, Session>()

function shellCmd(): CommandSpec {
  if (isWindows) {
    return spawnCommandSpec(process.env.COMSPEC || 'cmd.exe', ['/d'])
  }
  const sh = process.env.SHELL || '/bin/bash'
  // interactive login-ish for prompt
  return spawnCommandSpec(
    sh,
    sh.endsWith('zsh') || sh.endsWith('bash') ? ['-i'] : [],
  )
}

export function listTermSessions(): TermSessionInfo[] {
  return [...sessions.values()].map((s) => ({
    id: s.id,
    title: s.title,
    cwd: s.cwd,
    alive: s.alive && !s.child.killed,
    createdAt: s.createdAt,
  }))
}

export function createTermSession(opts: {
  cwd?: string
  title?: string
  webContents?: WebContents
}): TermSessionInfo {
  const id = `term_${randomUUID().slice(0, 8)}`
  const cwd =
    opts.cwd && path.isAbsolute(opts.cwd) ? opts.cwd : process.cwd()
  const shell = shellCmd()
  const child = spawn(shell.file, shell.args, {
    cwd,
    env: {
      ...process.env,
      TERM: process.env.TERM || 'xterm-256color',
      HOME: os.homedir(),
    },
    stdio: ['pipe', 'pipe', 'pipe'],
    detached: !isWindows,
    windowsHide: true,
    windowsVerbatimArguments: shell.windowsVerbatimArguments,
  })

  const session: Session = {
    id,
    title: opts.title || `Shell ${sessions.size + 1}`,
    cwd,
    createdAt: new Date().toISOString(),
    child,
    alive: true,
    webContents: opts.webContents || null,
  }
  sessions.set(id, session)

  const emit = (data: string, stream: 'stdout' | 'stderr') => {
    const wc = session.webContents
    if (wc && !wc.isDestroyed()) {
      wc.send('term:data', { id, stream, data })
    }
  }

  child.stdout.on('data', (buf: Buffer) => emit(buf.toString('utf-8'), 'stdout'))
  child.stderr.on('data', (buf: Buffer) => emit(buf.toString('utf-8'), 'stderr'))
  child.on('close', (code) => {
    session.alive = false
    emit(`\r\n[exit ${code}]\r\n`, 'stdout')
    const wc = session.webContents
    if (wc && !wc.isDestroyed()) {
      wc.send('term:exit', { id, code })
    }
  })
  child.on('error', (err) => {
    session.alive = false
    emit(`\r\n[error ${err.message}]\r\n`, 'stderr')
  })

  // welcome
  setTimeout(() => {
    emit(`# SubAgents terminal · ${cwd}\r\n`, 'stdout')
  }, 50)

  return {
    id: session.id,
    title: session.title,
    cwd: session.cwd,
    alive: true,
    createdAt: session.createdAt,
  }
}

export function writeTerm(id: string, data: string): { ok: boolean; error?: string } {
  const s = sessions.get(id)
  if (!s || !s.alive) return { ok: false, error: 'session not alive' }
  try {
    s.child.stdin.write(data)
    return { ok: true }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
}

export function resizeTerm(_id: string, _cols: number, _rows: number): { ok: boolean } {
  // soft PTY: no true winsize without node-pty
  return { ok: true }
}

export function killTerm(id: string): { ok: boolean } {
  const s = sessions.get(id)
  if (!s) return { ok: false }
  try {
    void terminateProcessTree(s.child)
  } catch {
    /* ignore */
  }
  s.alive = false
  sessions.delete(id)
  return { ok: true }
}

export function killAllTerms() {
  for (const id of [...sessions.keys()]) killTerm(id)
}

export function bindTermWebContents(id: string, wc: WebContents) {
  const s = sessions.get(id)
  if (s) s.webContents = wc
}

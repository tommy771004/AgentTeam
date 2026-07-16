/**
 * Monitor bridge(G10,grok `monitor` 工具語意):跑一條長命令,
 * stdout/stderr 每行變成一個事件推回 renderer(餵 Proactive eventMatcher)。
 *
 * 音量控制(grok 同款,防事件洪水):
 * - 滑動視窗限速:10 秒內超過上限 → 自動停止,回報 reason='volume',
 *   提示收窄 filter(grep --line-buffered)
 * - 總行數上限:達標即停止
 * 同時最多 MAX_MONITORS 條;renderer 收 'monitor:event' / 'monitor:stopped'。
 */

import { spawn, type ChildProcess } from 'node:child_process'
import { shellCommandSpec } from './platformProcess'

export interface MonitorEventPayload {
  id: string
  description: string
  line: string
  at: string
}

export interface MonitorStoppedPayload {
  id: string
  description: string
  reason: 'exit' | 'volume' | 'stopped' | 'error'
  detail?: string
  code?: number | null
  at: string
}

export type MonitorEmit = (
  channel: 'monitor:event' | 'monitor:stopped',
  payload: MonitorEventPayload | MonitorStoppedPayload,
) => void

interface ActiveMonitor {
  id: string
  description: string
  command: string
  child: ChildProcess
  startedAt: string
  lineCount: number
  /** 滑動視窗:最近事件的時間戳(ms) */
  window: number[]
  stopped: boolean
}

const monitors = new Map<string, ActiveMonitor>()

const MAX_MONITORS = 6
const MAX_TOTAL_LINES = 240
const WINDOW_MS = 10_000
const MAX_LINES_PER_WINDOW = 30
const MAX_LINE_CHARS = 500

function finish(
  m: ActiveMonitor,
  emit: MonitorEmit,
  reason: MonitorStoppedPayload['reason'],
  detail?: string,
  code?: number | null,
) {
  if (m.stopped) return
  m.stopped = true
  monitors.delete(m.id)
  try {
    m.child.kill('SIGTERM')
    setTimeout(() => {
      try {
        m.child.kill('SIGKILL')
      } catch {
        /* already gone */
      }
    }, 3_000).unref?.()
  } catch {
    /* already gone */
  }
  emit('monitor:stopped', {
    id: m.id,
    description: m.description,
    reason,
    detail,
    code,
    at: new Date().toISOString(),
  })
}

export function startMonitor(
  input: { command: string; description: string; cwd?: string },
  emit: MonitorEmit,
): { ok: boolean; id?: string; error?: string } {
  const command = (input.command || '').trim()
  const description = (input.description || '').trim().slice(0, 120) || 'monitor'
  if (!command) return { ok: false, error: 'command 必填' }
  if (monitors.size >= MAX_MONITORS) {
    return { ok: false, error: `同時最多 ${MAX_MONITORS} 個 monitor,請先停掉不需要的` }
  }

  const id = `mon-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`
  const spec = shellCommandSpec(command)
  let child: ChildProcess
  try {
    child = spawn(spec.file, spec.args, {
      cwd: input.cwd || undefined,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
      windowsVerbatimArguments: spec.windowsVerbatimArguments,
    })
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }

  const m: ActiveMonitor = {
    id,
    description,
    command,
    child,
    startedAt: new Date().toISOString(),
    lineCount: 0,
    window: [],
    stopped: false,
  }
  monitors.set(id, m)

  const onLine = (line: string) => {
    if (m.stopped) return
    const trimmed = line.trim()
    if (!trimmed) return
    const now = Date.now()
    m.window = m.window.filter((t) => now - t < WINDOW_MS)
    m.window.push(now)
    if (m.window.length > MAX_LINES_PER_WINDOW) {
      finish(
        m,
        emit,
        'volume',
        `10 秒內超過 ${MAX_LINES_PER_WINDOW} 行 — 事件太多已自動停止。請收窄 filter(grep --line-buffered)後重啟。`,
      )
      return
    }
    m.lineCount += 1
    if (m.lineCount > MAX_TOTAL_LINES) {
      finish(m, emit, 'volume', `累計超過 ${MAX_TOTAL_LINES} 行,已自動停止。`)
      return
    }
    emit('monitor:event', {
      id,
      description,
      line: trimmed.slice(0, MAX_LINE_CHARS),
      at: new Date().toISOString(),
    })
  }

  const attachLineReader = (stream: NodeJS.ReadableStream | null) => {
    if (!stream) return
    let buffer = ''
    stream.on('data', (chunk: Buffer) => {
      buffer += chunk.toString('utf8')
      let idx = buffer.indexOf('\n')
      while (idx >= 0) {
        onLine(buffer.slice(0, idx))
        buffer = buffer.slice(idx + 1)
        idx = buffer.indexOf('\n')
      }
      // 防無換行輸出無限累積
      if (buffer.length > 8_000) {
        onLine(buffer)
        buffer = ''
      }
    })
  }
  attachLineReader(child.stdout)
  attachLineReader(child.stderr)

  child.once('error', (e) => finish(m, emit, 'error', e.message))
  child.once('close', (code) => finish(m, emit, 'exit', undefined, code))

  return { ok: true, id }
}

export function stopMonitor(id: string, emit: MonitorEmit): boolean {
  const m = monitors.get(id)
  if (!m) return false
  finish(m, emit, 'stopped')
  return true
}

export function listMonitors(): Array<{
  id: string
  description: string
  command: string
  startedAt: string
  lineCount: number
}> {
  return [...monitors.values()].map((m) => ({
    id: m.id,
    description: m.description,
    command: m.command.slice(0, 200),
    startedAt: m.startedAt,
    lineCount: m.lineCount,
  }))
}

export function stopAllMonitors(emit: MonitorEmit): void {
  for (const m of [...monitors.values()]) finish(m, emit, 'stopped')
}

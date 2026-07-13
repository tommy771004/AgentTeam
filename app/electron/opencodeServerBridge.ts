/**
 * Local-only OpenCode server adapter.
 *
 * The renderer never receives the server password. Main resolves the optional
 * password from the Electron vault and owns both HTTP auth and child process
 * lifecycle. Remote, mDNS and CORS endpoints are intentionally rejected.
 */

import { spawn, type ChildProcess } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { createServer } from 'node:net'
import { spawnCommandSpec, terminateProcessTree } from './platformProcess'
import { getVaultSecret } from './secretsVault'

export type OpenCodeServerMode = 'auto' | 'cli' | 'server'

export type OpenCodeServerEvent = {
  kind: 'status' | 'thought' | 'text' | 'tool' | 'file' | 'error' | 'done' | 'plan'
  title?: string
  detail?: string
  tool?: string
  ok?: boolean
  delta?: string
  path?: string
  paths?: string[]
  action?: 'edit' | 'create' | 'delete' | 'write' | 'read'
  todos?: Array<{ text: string; status: 'pending' | 'active' | 'done' }>
}

export type OpenCodeServerResult = {
  used: boolean
  ok: boolean
  output: string
  baseUrl?: string
  sessionId?: string
  version?: string
  completionReason?: string
  cancelled?: boolean
  timedOut?: boolean
  error?: string
}

type ServerHealth = { healthy?: boolean; version?: string }
type ActiveServer = { baseUrl: string; child: ChildProcess; port: number }
type ActiveSession = {
  runId: string
  baseUrl: string
  sessionId: string
  abort: AbortController
}

const servers = new Map<string, ActiveServer>()
const sessions = new Map<string, ActiveSession>()

function loopbackUrl(raw?: string): string | null {
  const value = (raw || 'http://127.0.0.1:4096').trim()
  try {
    const parsed = new URL(value)
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null
    if (!['127.0.0.1', 'localhost', '::1'].includes(parsed.hostname)) return null
    parsed.pathname = parsed.pathname.replace(/\/$/, '')
    parsed.search = ''
    parsed.hash = ''
    return parsed.toString().replace(/\/$/, '')
  } catch {
    return null
  }
}

function authHeaders(): Record<string, string> {
  const password = getVaultSecret('opencode-server-password')?.token
  if (!password) return {}
  const username = process.env.OPENCODE_SERVER_USERNAME || 'opencode'
  return { Authorization: `Basic ${Buffer.from(`${username}:${password}`).toString('base64')}` }
}

async function request(
  baseUrl: string,
  endpoint: string,
  init?: RequestInit,
  timeoutMs = 8000,
): Promise<{ ok: boolean; status: number; text: string; headers: Headers }> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const res = await fetch(`${baseUrl}${endpoint}`, {
      ...init,
      signal: controller.signal,
      headers: { ...authHeaders(), ...(init?.headers || {}) },
    })
    return { ok: res.ok, status: res.status, text: await res.text(), headers: res.headers }
  } catch (e) {
    return {
      ok: false,
      status: 0,
      text: e instanceof Error ? e.message : String(e),
      headers: new Headers(),
    }
  } finally {
    clearTimeout(timer)
  }
}

async function jsonRequest<T>(
  baseUrl: string,
  endpoint: string,
  init?: RequestInit,
  timeoutMs = 8000,
): Promise<{ ok: boolean; status: number; value?: T; error?: string }> {
  const res = await request(baseUrl, endpoint, init, timeoutMs)
  if (!res.ok) return { ok: false, status: res.status, error: res.text.slice(0, 500) }
  if (res.status === 204 || !res.text.trim()) return { ok: true, status: res.status }
  try {
    return { ok: true, status: res.status, value: JSON.parse(res.text) as T }
  } catch {
    return { ok: false, status: res.status, error: 'OpenCode response was not JSON' }
  }
}

export async function checkOpenCodeServer(rawUrl?: string) {
  const baseUrl = loopbackUrl(rawUrl)
  if (!baseUrl) return { ok: false, baseUrl: rawUrl || '', error: 'OpenCode server 只允許 localhost / 127.0.0.1 / ::1' }
  const health = await jsonRequest<ServerHealth>(baseUrl, '/global/health')
  if (!health.ok || health.value?.healthy === false) {
    return { ok: false, baseUrl, version: health.value?.version, error: health.error || `health HTTP ${health.status}` }
  }
  const doc = await request(baseUrl, '/doc')
  const compatible = doc.ok && /\/session|global\/health|openapi/i.test(doc.text)
  if (!compatible) return { ok: false, baseUrl, version: health.value?.version, error: 'OpenCode /doc 缺少必要 session/health API' }
  return { ok: true, baseUrl, version: health.value?.version }
}

export async function getOpenCodeServerInfo(rawUrl?: string) {
  return checkOpenCodeServer(rawUrl)
}

export async function startOpenCodeServer(opts?: { cwd?: string; port?: number }) {
  const port = Number.isInteger(opts?.port) && (opts?.port || 0) > 0 ? opts!.port! : await allocateLoopbackPort()
  const baseUrl = `http://127.0.0.1:${port}`
  const existing = await checkOpenCodeServer(baseUrl)
  if (existing.ok) return { ...existing, started: false }

  const spec = spawnCommandSpec('opencode', [
    'serve',
    '--hostname',
    '127.0.0.1',
    '--port',
    String(port),
  ])
  const child = spawn(spec.file, spec.args, {
    cwd: opts?.cwd,
    env: {
      ...process.env,
      ...(getVaultSecret('opencode-server-password')?.token
        ? { OPENCODE_SERVER_PASSWORD: getVaultSecret('opencode-server-password')!.token }
        : {}),
      OPENCODE_SERVER_USERNAME: process.env.OPENCODE_SERVER_USERNAME || 'opencode',
      OPENCODE_DISABLE_AUTOUPDATE: '1',
    },
    stdio: 'ignore',
    detached: process.platform !== 'win32',
    windowsHide: true,
    windowsVerbatimArguments: spec.windowsVerbatimArguments,
  })
  const runKey = `${baseUrl}:${child.pid || randomUUID()}`
  servers.set(runKey, { baseUrl, child, port })
  child.once('close', () => servers.delete(runKey))

  const deadline = Date.now() + 15_000
  let last: Awaited<ReturnType<typeof checkOpenCodeServer>> = {
    ok: false,
    baseUrl,
    error: '尚未啟動',
  }
  while (Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 250))
    last = await checkOpenCodeServer(baseUrl)
    if (last.ok) {
      const actualUrl = last.baseUrl
      const record = servers.get(runKey)
      if (record) record.baseUrl = actualUrl
      return { ...last, started: true, pid: child.pid }
    }
  }
  void terminateProcessTree(child, true)
  servers.delete(runKey)
  return { ...last, ok: false, started: false, error: last.error || 'OpenCode server 啟動逾時' }
}

async function allocateLoopbackPort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer()
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      const port = typeof address === 'object' && address ? address.port : 0
      server.close(() => (port > 0 ? resolve(port) : reject(new Error('無法取得可用 localhost port'))))
    })
  })
}

export async function stopOpenCodeServers() {
  let killed = 0
  for (const [key, server] of servers) {
    if (await terminateProcessTree(server.child)) killed += 1
    servers.delete(key)
  }
  return { ok: killed > 0, killed }
}

function extractSessionId(value: Record<string, unknown>): string {
  const props = value.properties && typeof value.properties === 'object' ? (value.properties as Record<string, unknown>) : {}
  return String(value.sessionID ?? value.sessionId ?? props.sessionID ?? props.sessionId ?? props.session_id ?? '')
}

function parseServerEvent(raw: Record<string, unknown>, sessionId: string): OpenCodeServerEvent | null {
  if (extractSessionId(raw) && extractSessionId(raw) !== sessionId) return null
  const type = String(raw.type || raw.event || '').toLowerCase()
  const props = raw.properties && typeof raw.properties === 'object' ? (raw.properties as Record<string, unknown>) : raw
  const part = props.part && typeof props.part === 'object' ? (props.part as Record<string, unknown>) : props
  const text = String(part.text ?? part.delta ?? props.content ?? '').trim()
  if (type.includes('permission')) {
    return { kind: 'error', title: 'OpenCode 權限要求', detail: String(props.reason ?? props.permission ?? props.message ?? text ?? 'permission request').slice(0, 400), ok: false }
  }
  if (type.includes('error') || props.error) {
    return { kind: 'error', title: 'OpenCode 錯誤', detail: String(props.message ?? props.error ?? text ?? 'server error').slice(0, 400), ok: false }
  }
  if (part.type === 'text' || type.includes('text') || type.includes('message.part.updated')) {
    return text ? { kind: 'text', delta: text } : null
  }
  if (part.type === 'reasoning' || type.includes('reason')) {
    return text ? { kind: 'thought', delta: text } : null
  }
  if (part.type === 'tool' || type.includes('tool')) {
    const name = String(part.tool ?? part.name ?? props.tool ?? 'tool')
    return { kind: 'tool', title: `執行 ${name}`, tool: name, detail: JSON.stringify(part.input ?? props.input ?? '').slice(0, 400), ok: props.error == null }
  }
  if (part.type === 'patch' || type.includes('file') || type.includes('patch')) {
    const file = String(part.path ?? props.path ?? '').trim()
    return file ? { kind: 'file', title: `已編輯 ${file.split(/[\\/]/).pop()}`, path: file, paths: [file], action: 'edit' } : null
  }
  if (type.includes('todo') || type.includes('plan')) {
    const rawTodos = part.todos ?? props.todos ?? props.items
    if (Array.isArray(rawTodos)) {
      return { kind: 'plan', title: '任務清單更新', todos: rawTodos.map((todo) => ({ text: String((todo as Record<string, unknown>).text ?? (todo as Record<string, unknown>).content ?? todo).slice(0, 200), status: String((todo as Record<string, unknown>).status || '').includes('done') ? 'done' : String((todo as Record<string, unknown>).status || '').includes('progress') ? 'active' : 'pending' })) }
    }
  }
  if (type.includes('idle') || type.includes('completed') || type.includes('finish') || type === 'session.status') {
    return { kind: 'done', title: 'OpenCode session 完成', detail: String(props.reason ?? props.status ?? '').slice(0, 220), ok: true }
  }
  return { kind: 'status', title: type || 'OpenCode event', detail: String(props.message ?? '').slice(0, 220) }
}

async function streamEvents(
  baseUrl: string,
  sessionId: string,
  signal: AbortSignal,
  onEvent: (event: OpenCodeServerEvent) => void,
  timeoutMs: number,
) {
  const timer = setTimeout(() => (signal as AbortSignal & { abort?: () => void }).abort?.(), timeoutMs)
  try {
    const res = await fetch(`${baseUrl}/global/event`, { headers: authHeaders(), signal })
    if (!res.ok || !res.body) throw new Error(`SSE HTTP ${res.status}`)
    const reader = res.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ''
    while (!signal.aborted) {
      const next = await reader.read()
      if (next.done) break
      buffer += decoder.decode(next.value, { stream: true })
      const frames = buffer.split(/\r?\n\r?\n/)
      buffer = frames.pop() || ''
      for (const frame of frames) {
        const data = frame.split(/\r?\n/).filter((line) => line.startsWith('data:')).map((line) => line.slice(5).trim()).join('\n')
        if (!data) continue
        try {
          const event = parseServerEvent(JSON.parse(data) as Record<string, unknown>, sessionId)
          if (event) onEvent(event)
          if (event?.kind === 'done' || event?.kind === 'error') return
        } catch {
          /* ignore malformed compatibility events */
        }
      }
    }
  } finally {
    clearTimeout(timer)
  }
}

function extractMessages(value: unknown): string {
  if (!Array.isArray(value)) return ''
  const chunks: string[] = []
  for (const message of value) {
    if (!message || typeof message !== 'object') continue
    const m = message as Record<string, unknown>
    const info = m.info && typeof m.info === 'object' ? (m.info as Record<string, unknown>) : m
    if (String(info.role || '').toLowerCase() !== 'assistant') continue
    const parts = Array.isArray(m.parts) ? m.parts : []
    for (const part of parts) {
      if (!part || typeof part !== 'object') continue
      const p = part as Record<string, unknown>
      if (p.type === 'text' && p.text) chunks.push(String(p.text))
    }
  }
  return chunks.join('\n\n').trim()
}

export async function runOpenCodeServerPrompt(opts: {
  mode?: OpenCodeServerMode
  baseUrl?: string
  prompt: string
  cwd?: string
  model?: string
  agent?: string
  runId: string
  timeoutMs?: number
  onEvent?: (event: OpenCodeServerEvent) => void
}): Promise<OpenCodeServerResult> {
  if (opts.mode === 'cli') return { used: false, ok: false, output: '' }
  const activeBaseUrl = opts.baseUrl || [...servers.values()].at(-1)?.baseUrl
  const info = await checkOpenCodeServer(activeBaseUrl)
  if (!info.ok) {
    if (opts.mode === 'server') return { used: true, ok: false, output: '', error: info.error || 'OpenCode server 不可用' }
    return { used: false, ok: false, output: '' }
  }
  const baseUrl = info.baseUrl
  const timeoutMs = Math.min(Math.max(opts.timeoutMs || 300_000, 10_000), 600_000)
  const controller = new AbortController()
  const session = await jsonRequest<{ id?: string }>(baseUrl, '/session', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ title: opts.prompt.slice(0, 80) }),
  })
  const sessionId = session.value?.id
  if (!session.ok || !sessionId) {
    return { used: true, ok: false, output: '', baseUrl, version: info.version, error: session.error || 'OpenCode session 建立失敗' }
  }
  sessions.set(opts.runId, { runId: opts.runId, baseUrl, sessionId, abort: controller })
  let lastError = ''
  const stream = streamEvents(baseUrl, sessionId, controller.signal, (event) => {
    if (event.kind === 'error') lastError = event.detail || 'OpenCode server error'
    opts.onEvent?.(event)
  }, timeoutMs)
  const prompt = await jsonRequest(baseUrl, `/session/${encodeURIComponent(sessionId)}/prompt_async`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      agent: opts.agent || 'build',
      model: opts.model || undefined,
      parts: [{ type: 'text', text: opts.prompt }],
    }),
  })
  if (!prompt.ok) {
    controller.abort()
    sessions.delete(opts.runId)
    return { used: true, ok: false, output: '', baseUrl, sessionId, version: info.version, error: prompt.error || 'OpenCode prompt 送出失敗' }
  }
  let timedOut = false
  const timeout = setTimeout(() => {
    timedOut = true
    controller.abort()
  }, timeoutMs)
  await stream.catch((e) => {
    if (!controller.signal.aborted) lastError = e instanceof Error ? e.message : String(e)
  })
  clearTimeout(timeout)
  const messages = await jsonRequest<unknown>(baseUrl, `/session/${encodeURIComponent(sessionId)}/message?limit=50`, undefined, 10_000)
  const output = extractMessages(messages.value)
  sessions.delete(opts.runId)
  const cancelled = controller.signal.aborted && !timedOut
  const ok = !timedOut && !cancelled && !lastError
  opts.onEvent?.({ kind: ok ? 'done' : 'error', title: ok ? 'OpenCode session 完成' : cancelled ? 'OpenCode 已取消' : timedOut ? 'OpenCode 逾時' : 'OpenCode 失敗', detail: ok ? undefined : lastError || (timedOut ? 'server SSE timeout' : 'server session failed'), ok })
  return {
    used: true,
    ok,
    output,
    baseUrl,
    sessionId,
    version: info.version,
    completionReason: ok ? 'session-complete' : cancelled ? 'abort' : timedOut ? 'timeout' : 'error',
    cancelled,
    timedOut,
    error: ok ? undefined : lastError || (cancelled ? '使用者取消' : timedOut ? 'OpenCode server SSE 逾時' : 'OpenCode server 執行失敗'),
  }
}

export async function abortOpenCodeRun(runId?: string) {
  const targets = runId ? [sessions.get(runId)].filter(Boolean) as ActiveSession[] : [...sessions.values()]
  let killed = 0
  for (const session of targets) {
    session.abort.abort()
    const r = await request(session.baseUrl, `/session/${encodeURIComponent(session.sessionId)}/abort`, { method: 'POST' })
    if (r.ok) killed += 1
    sessions.delete(session.runId)
  }
  return { ok: killed > 0, killed }
}

export async function openCodeServerRequest<T>(rawUrl: string, endpoint: string, init?: RequestInit) {
  const baseUrl = loopbackUrl(rawUrl)
  if (!baseUrl) return { ok: false, status: 400, error: '只允許 localhost OpenCode server' }
  return jsonRequest<T>(baseUrl, endpoint, init)
}

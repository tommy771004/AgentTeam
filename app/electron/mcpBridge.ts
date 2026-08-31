/**
 * MCP bridge for Electron main:
 * - HTTP JSON-RPC proxy (no CORS)
 * - Long-lived stdio JSON-RPC sessions (reuse process)
 * - Fallback short-lived spawn for one-shot ops
 */

import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { spawnCommandSpec, terminateProcessTree } from './platformProcess'
import { createToolCredentialScope } from './customToolCredentials'

type JsonRpc = {
  jsonrpc: '2.0'
  id?: string | number | null
  method?: string
  params?: unknown
  result?: unknown
  error?: { message?: string; code?: number; data?: unknown }
}

type Pending = {
  resolve: (v: unknown) => void
  reject: (e: Error) => void
  timer: ReturnType<typeof setTimeout>
}

export type McpSessionStatus = {
  id: string
  command: string
  args: string[]
  alive: boolean
  pid: number | null
  startedAt: string | null
  lastError: string | null
  requestCount: number
}

/** Long-lived stdio MCP session */
class McpStdioSession {
  readonly id: string
  readonly command: string
  readonly args: string[]
  readonly env: Record<string, string>
  private child: ChildProcessWithoutNullStreams | null = null
  private nextId = 1
  private pending = new Map<number, Pending>()
  private buf = Buffer.alloc(0)
  private mode: 'unknown' | 'content-length' | 'ndjson' = 'unknown'
  alive = false
  startedAt: string | null = null
  lastError: string | null = null
  requestCount = 0
  private initPromise: Promise<void> | null = null
  private readonly credentials = createToolCredentialScope()

  constructor(id: string, command: string, args: string[], env?: Record<string, string>) {
    this.id = id
    this.command = command
    this.args = [...(args || [])]
    this.env = { ...env }
  }

  get pid(): number | null {
    return this.child?.pid ?? null
  }

  status(): McpSessionStatus {
    return {
      id: this.id,
      command: this.command,
      args: this.args,
      alive: this.alive && !!this.child && !this.child.killed,
      pid: this.pid,
      startedAt: this.startedAt,
      lastError: this.lastError == null ? null : this.credentials.redact(this.lastError),
      requestCount: this.requestCount,
    }
  }

  async start(): Promise<void> {
    if (this.alive && this.child && !this.child.killed) return
    if (this.initPromise) return this.initPromise
    this.initPromise = this._start()
    try {
      await this.initPromise
    } finally {
      this.initPromise = null
    }
  }

  private _start(): Promise<void> {
    return new Promise((resolve, reject) => {
      if (!this.command) {
        reject(new Error('stdio MCP command is empty'))
        return
      }
      try {
        const spec = spawnCommandSpec(this.command, this.args.map(this.credentials.resolve))
        const env = Object.fromEntries(Object.entries(this.env).map(([key, value]) => [key, this.credentials.resolve(value)]))
        this.child = spawn(spec.file, spec.args, {
          stdio: ['pipe', 'pipe', 'pipe'],
          env: { ...process.env, ...env },
          windowsHide: true,
          windowsVerbatimArguments: spec.windowsVerbatimArguments,
        })
      } catch (e) {
        reject(new Error(this.credentials.redact(e instanceof Error ? e.message : String(e))))
        return
      }

      this.buf = Buffer.alloc(0)
      this.mode = 'unknown'
      this.alive = true
      this.startedAt = new Date().toISOString()
      this.lastError = null

      this.child.stdout.on('data', (chunk: Buffer) => this.onData(chunk))
      this.child.stderr.on('data', () => {
        /* drain — many MCP servers log to stderr */
      })
      this.child.on('error', (err) => {
        this.lastError = err.message
        this.failAll(err)
        this.alive = false
      })
      this.child.on('close', (code) => {
        this.alive = false
        this.failAll(new Error(`MCP stdio exited (code ${code})`))
      })

      // initialize handshake
      this.request('initialize', {
        protocolVersion: '2024-11-05',
        capabilities: {},
        clientInfo: { name: 'subagents-ai', version: '1.0.0' },
      })
        .then(() => {
          this.notify('notifications/initialized', {})
          resolve()
        })
        .catch((e) => {
          this.stop()
          reject(e instanceof Error ? e : new Error(String(e)))
        })
    })
  }

  private onData(chunk: Buffer) {
    this.buf = Buffer.concat([this.buf, chunk])
    // eslint-disable-next-line no-constant-condition
    while (true) {
      const msg = this.tryReadMessage()
      if (!msg) break
      this.handleMessage(msg)
    }
  }

  private tryReadMessage(): JsonRpc | null {
    if (this.buf.length === 0) return null

    // Detect Content-Length framing (official MCP)
    const asStr = this.buf.toString('utf-8')
    if (this.mode === 'unknown') {
      if (/^Content-Length:/i.test(asStr) || asStr.includes('\r\n\r\n') || asStr.includes('\n\n')) {
        if (/Content-Length:/i.test(asStr.slice(0, 64)) || /content-length:/i.test(asStr)) {
          this.mode = 'content-length'
        }
      }
      if (this.mode === 'unknown' && asStr.includes('\n') && asStr.trimStart().startsWith('{')) {
        this.mode = 'ndjson'
      }
    }

    if (this.mode === 'content-length' || (this.mode === 'unknown' && /Content-Length:/i.test(asStr))) {
      this.mode = 'content-length'
      const crlf = asStr.indexOf('\r\n\r\n')
      const lf = asStr.indexOf('\n\n')
      let hEnd = -1
      let sep = 2
      if (crlf >= 0 && (lf < 0 || crlf <= lf)) {
        hEnd = crlf
        sep = 4
      } else if (lf >= 0) {
        hEnd = lf
        sep = 2
      }
      if (hEnd < 0) return null
      const header = asStr.slice(0, hEnd)
      const m = header.match(/Content-Length:\s*(\d+)/i)
      if (!m) {
        const nl = asStr.indexOf('\n')
        if (nl >= 0) this.buf = this.buf.subarray(nl + 1)
        return null
      }
      const len = parseInt(m[1], 10)
      const bodyStart = hEnd + sep
      const bodyStartBytes = Buffer.byteLength(asStr.slice(0, bodyStart), 'utf-8')
      if (this.buf.length < bodyStartBytes + len) return null
      const bodyBuf = this.buf.subarray(bodyStartBytes, bodyStartBytes + len)
      this.buf = this.buf.subarray(bodyStartBytes + len)
      try {
        return JSON.parse(bodyBuf.toString('utf-8')) as JsonRpc
      } catch {
        return null
      }
    }

    // NDJSON fallback
    this.mode = 'ndjson'
    const nl = asStr.indexOf('\n')
    if (nl < 0) return null
    const line = asStr.slice(0, nl).trim()
    this.buf = this.buf.subarray(Buffer.byteLength(asStr.slice(0, nl + 1), 'utf-8'))
    if (!line) return this.tryReadMessage()
    try {
      return JSON.parse(line) as JsonRpc
    } catch {
      return null
    }
  }

  private handleMessage(msg: JsonRpc) {
    if (msg.id == null) {
      // notification / server request — ignore for now
      return
    }
    const id = typeof msg.id === 'number' ? msg.id : Number(msg.id)
    const p = this.pending.get(id)
    if (!p) return
    clearTimeout(p.timer)
    this.pending.delete(id)
    if (msg.error) {
      p.reject(new Error(this.credentials.redact(msg.error.message || `MCP error ${msg.error.code}`)))
    } else {
      p.resolve(msg.result === undefined ? undefined : JSON.parse(this.credentials.redact(JSON.stringify(msg.result))))
    }
  }

  private failAll(err: Error) {
    for (const [, p] of this.pending) {
      clearTimeout(p.timer)
      p.reject(err)
    }
    this.pending.clear()
  }

  private write(msg: JsonRpc) {
    if (!this.child || !this.alive) throw new Error('MCP session not alive')
    const json = JSON.stringify(msg)
    // MCP stdio transport requires one JSON-RPC message per line.
    this.child.stdin.write(`${json}\n`)
  }

  private notify(method: string, params?: Record<string, unknown>) {
    try {
      this.write({ jsonrpc: '2.0', method, params: params || {} })
    } catch {
      /* ignore */
    }
  }

  request(method: string, params?: Record<string, unknown>, timeoutMs = 60_000): Promise<unknown> {
    if (!this.child || !this.alive) {
      return Promise.reject(new Error('MCP session not alive'))
    }
    const id = this.nextId++
    this.requestCount += 1
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id)
        reject(new Error(`MCP request timeout: ${method}`))
      }, timeoutMs)
      this.pending.set(id, { resolve, reject, timer })
      try {
        this.write({
          jsonrpc: '2.0',
          id,
          method,
          params: params || {},
        })
      } catch (e) {
        clearTimeout(timer)
        this.pending.delete(id)
        reject(e instanceof Error ? e : new Error(String(e)))
      }
    })
  }

  stop() {
    this.alive = false
    this.failAll(new Error('MCP session stopped'))
    if (this.child && !this.child.killed) {
      try {
        this.child.stdin.end()
      } catch {
        /* ignore */
      }
      void terminateProcessTree(this.child)
    }
    this.child = null
  }
}

const sessions = new Map<string, McpStdioSession>()

function sessionKey(
  id: string,
  command: string,
  args: string[],
  env?: Record<string, string>,
) {
  const envKey = Object.entries(env || {})
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => `${key}=${value}`)
    .join('\0')
  return `${id}::${command}::${(args || []).join('\0')}::${envKey}`
}

export async function mcpHttpRpc(input: {
  url: string
  headers?: Record<string, string>
  body: unknown
}): Promise<unknown> {
  const res = await fetch(input.url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      ...(input.headers || {}),
    },
    body: JSON.stringify(input.body),
  })
  if (!res.ok) {
    const t = await res.text().catch(() => res.statusText)
    throw new Error(`MCP HTTP ${res.status}: ${t.slice(0, 300)}`)
  }
  const data = (await res.json()) as JsonRpc
  if (data.error) throw new Error(data.error.message || 'MCP error')
  return data.result
}

export async function mcpStdioEnsure(input: {
  id: string
  command: string
  args: string[]
  env?: Record<string, string>
}): Promise<McpSessionStatus> {
  const key = sessionKey(input.id, input.command, input.args || [], input.env)
  let s = sessions.get(key)
  if (!s || !s.alive) {
    // dispose stale by id
    for (const [k, sess] of sessions) {
      if (sess.id === input.id && k !== key) {
        sess.stop()
        sessions.delete(k)
      }
    }
    s = new McpStdioSession(input.id, input.command, input.args || [], input.env)
    sessions.set(key, s)
    await s.start()
  }
  return s.status()
}

export async function mcpStdioListTools(input: {
  id: string
  command: string
  args: string[]
  env?: Record<string, string>
}): Promise<Array<{ name: string; description?: string; inputSchema?: Record<string, unknown> }>> {
  const key = sessionKey(input.id, input.command, input.args || [], input.env)
  await mcpStdioEnsure(input)
  const s = sessions.get(key)
  if (!s) throw new Error('session missing after ensure')
  const result = (await s.request('tools/list', {})) as {
    tools?: Array<{ name: string; description?: string; inputSchema?: Record<string, unknown> }>
  }
  return result?.tools || []
}

export async function mcpStdioCallTool(input: {
  id: string
  command: string
  args: string[]
  env?: Record<string, string>
  toolName: string
  arguments: Record<string, unknown>
}): Promise<{ ok: boolean; content: string; error?: string }> {
  try {
    const key = sessionKey(input.id, input.command, input.args || [], input.env)
    await mcpStdioEnsure(input)
    const s = sessions.get(key)
    if (!s) throw new Error('session missing')
    const result = await s.request('tools/call', {
      name: input.toolName,
      arguments: input.arguments || {},
    })
    return { ok: true, content: formatContent(result) }
  } catch (e) {
    return {
      ok: false,
      content: '',
      error: e instanceof Error ? e.message : String(e),
    }
  }
}

export function mcpStdioStop(id: string): { ok: boolean } {
  let found = false
  for (const [k, s] of sessions) {
    if (s.id === id || k.startsWith(`${id}::`)) {
      s.stop()
      sessions.delete(k)
      found = true
    }
  }
  return { ok: found }
}

export function mcpStdioStopAll(): { ok: boolean; stopped: number } {
  let n = 0
  for (const [, s] of sessions) {
    s.stop()
    n += 1
  }
  sessions.clear()
  return { ok: true, stopped: n }
}

export function mcpStdioListSessions(): McpSessionStatus[] {
  return [...sessions.values()].map((s) => s.status())
}

function formatContent(result: unknown): string {
  if (result == null) return '(empty)'
  if (typeof result === 'string') return result
  const r = result as { content?: Array<{ type?: string; text?: string }> }
  if (Array.isArray(r.content)) {
    return r.content.map((c) => c.text || JSON.stringify(c)).join('\n')
  }
  return JSON.stringify(result, null, 2).slice(0, 8000)
}

export function newMcpId() {
  return randomUUID().slice(0, 8)
}

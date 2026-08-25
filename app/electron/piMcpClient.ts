import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'

type McpConfig = { command: string; args: string[]; env?: Record<string, string> }
type Rpc = { jsonrpc: '2.0'; id?: number; method?: string; params?: unknown; result?: any; error?: { message?: string } }
export type PiMcpCallResult = { content: unknown; isError: boolean }

export class PiMcpClient {
  private readonly config: McpConfig
  private child: ChildProcessWithoutNullStreams | undefined
  private nextId = 1
  private buffer = Buffer.alloc(0)
  private readonly pending = new Map<number, { resolve: (value: any) => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> }>()
  private starting: Promise<void> | undefined
  constructor(config: McpConfig) { this.config = config }

  private request(method: string, params: unknown): Promise<any> {
    return new Promise((resolve, reject) => {
      const id = this.nextId++
      const timer = setTimeout(() => { this.pending.delete(id); reject(new Error(`MCP request timed out: ${method}`)) }, 15_000)
      this.pending.set(id, { resolve, reject, timer })
      this.child?.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`)
    })
  }

  private fail(error: Error) {
    for (const [id, waiter] of this.pending) { clearTimeout(waiter.timer); waiter.reject(error); this.pending.delete(id) }
  }

  private async start() {
    if (this.child) return
    this.child = spawn(this.config.command, this.config.args, { stdio: ['pipe', 'pipe', 'pipe'], env: { ...process.env, ...(this.config.env || {}) } })
    this.child.stdout.on('data', (chunk: Buffer) => this.onData(chunk))
    this.child.on('error', (error) => this.fail(error instanceof Error ? error : new Error(String(error))))
    this.child.on('close', (code) => { this.child = undefined; this.fail(new Error(`MCP server exited (${code ?? 'unknown'})`)) })
    await this.request('initialize', { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'subagents-pi-host', version: '1.0.0' } })
    this.child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized', params: {} })}\n`)
  }

  private onData(chunk: Buffer) {
    this.buffer = Buffer.concat([this.buffer, chunk])
    for (;;) {
      let body: Buffer | undefined
      const asText = this.buffer.toString('utf8')
      const headerEnd = asText.indexOf('\r\n\r\n') >= 0 ? asText.indexOf('\r\n\r\n') : asText.indexOf('\n\n')
      if (/^Content-Length:/i.test(asText) && headerEnd >= 0) {
        const header = asText.slice(0, headerEnd)
        const length = Number(/Content-Length:\s*(\d+)/i.exec(header)?.[1] || 0)
        const separatorBytes = Buffer.byteLength(asText.slice(0, headerEnd + (asText.includes('\r\n\r\n') ? 4 : 2)))
        if (!length || this.buffer.length < separatorBytes + length) return
        body = this.buffer.subarray(separatorBytes, separatorBytes + length)
        this.buffer = this.buffer.subarray(separatorBytes + length)
      } else {
        const newline = this.buffer.indexOf(0x0a)
        if (newline < 0) return
        body = this.buffer.subarray(0, newline).toString('utf8').trim() ? this.buffer.subarray(0, newline) : undefined
        this.buffer = this.buffer.subarray(newline + 1)
      }
      if (!body) continue
      try {
        const message = JSON.parse(body.toString('utf8')) as Rpc
        if (typeof message.id !== 'number') continue
        const waiter = this.pending.get(message.id)
        if (!waiter) continue
        this.pending.delete(message.id); clearTimeout(waiter.timer)
        if (message.error) waiter.reject(new Error(message.error.message || 'MCP request failed'))
        else waiter.resolve(message.result)
      } catch { /* ignore server logs that are not JSON */ }
    }
  }

  async listTools() {
    if (!this.starting) this.starting = this.start().finally(() => { this.starting = undefined })
    await this.starting
    const result = await this.request('tools/list', {}) as { tools?: Array<{ name: string; description?: string; inputSchema?: Record<string, unknown> }> }
    return result.tools || []
  }

  async callResult(toolName: string, args: Record<string, unknown>): Promise<PiMcpCallResult> {
    await this.listTools()
    const result = await this.request('tools/call', { name: toolName, arguments: args }) as { content?: unknown; isError?: unknown }
    return { content: result?.content ?? result ?? null, isError: result?.isError === true }
  }

  async call(toolName: string, args: Record<string, unknown>) {
    const result = await this.callResult(toolName, args)
    return JSON.stringify(result.content)
  }

  stop() {
    this.child?.kill()
    this.child = undefined
    this.fail(new Error('MCP client stopped'))
  }
}

const clients = new Map<string, PiMcpClient>()
const generations = new Map<string, number>()

/** Current discovery generation. A turn captures this value before it builds tools. */
export function piMcpGeneration(extensionId: string): number {
  return generations.get(extensionId) || 0
}

/**
 * Advance only the future discovery/client generation.
 *
 * Existing native tool closures keep passing the generation they captured, so
 * an extension reload cannot swap the transport underneath an in-flight turn.
 */
export function reloadPiMcp(extensionId: string): number {
  const next = piMcpGeneration(extensionId) + 1
  generations.set(extensionId, next)
  return next
}

/** Stable admission key used to rebuild a Pi session on the next Host turn. */
export function piMcpGenerationKey(extensionIds: readonly string[]): string {
  return [...new Set(extensionIds)].sort().map((id) => `${id}:${piMcpGeneration(id)}`).join('|')
}

function clientKey(extensionId: string, generation: number): string {
  return `${extensionId}\u0000${generation}`
}

function clientFor(extensionId: string, config: McpConfig, generation = piMcpGeneration(extensionId)): PiMcpClient {
  const key = clientKey(extensionId, generation)
  let client = clients.get(key)
  if (!client) { client = new PiMcpClient(config); clients.set(key, client) }
  return client
}

export async function listPiMcpTools(extensionId: string, config: McpConfig, generation = piMcpGeneration(extensionId)) {
  const client = clientFor(extensionId, config, generation)
  return client.listTools()
}
export async function callPiMcpTool(extensionId: string, config: McpConfig, toolName: string, args: Record<string, unknown>, generation = piMcpGeneration(extensionId)) {
  const client = clientFor(extensionId, config, generation)
  return client.call(toolName, args)
}
export async function callPiMcpToolResult(extensionId: string, config: McpConfig, toolName: string, args: Record<string, unknown>, generation = piMcpGeneration(extensionId)) {
  const client = clientFor(extensionId, config, generation)
  return client.callResult(toolName, args)
}
export function stopPiMcp(extensionId: string) {
  for (const [key, client] of clients) {
    if (!key.startsWith(`${extensionId}\u0000`)) continue
    client.stop()
    clients.delete(key)
  }
  generations.delete(extensionId)
}

/** Release every generation on Host shutdown, including frozen pre-reload clients. */
export function stopAllPiMcp(): void {
  for (const client of clients.values()) client.stop()
  clients.clear()
  generations.clear()
}

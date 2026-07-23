import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'

type McpConfig = { command: string; args: string[]; env?: Record<string, string> }
type Rpc = { jsonrpc: '2.0'; id?: number; method?: string; params?: unknown; result?: any; error?: { message?: string } }

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

  async call(toolName: string, args: Record<string, unknown>) {
    await this.listTools()
    const result = await this.request('tools/call', { name: toolName, arguments: args }) as { content?: unknown }
    return JSON.stringify(result?.content ?? result ?? null)
  }

  stop() {
    this.child?.kill()
    this.child = undefined
    this.fail(new Error('MCP client stopped'))
  }
}

const clients = new Map<string, PiMcpClient>()
export async function listPiMcpTools(extensionId: string, config: McpConfig) {
  let client = clients.get(extensionId)
  if (!client) { client = new PiMcpClient(config); clients.set(extensionId, client) }
  return client.listTools()
}
export async function callPiMcpTool(extensionId: string, config: McpConfig, toolName: string, args: Record<string, unknown>) {
  let client = clients.get(extensionId)
  if (!client) { client = new PiMcpClient(config); clients.set(extensionId, client) }
  return client.call(toolName, args)
}
export function stopPiMcp(extensionId: string) {
  const client = clients.get(extensionId)
  client?.stop()
  clients.delete(extensionId)
}

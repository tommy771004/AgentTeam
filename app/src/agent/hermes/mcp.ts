/**
 * Minimal MCP client — Hermes-inspired edge capability
 * Supports HTTP JSON-RPC 2.0 (tools/list, tools/call).
 * Stdio servers go through Electron main process.
 */

import type { McpServerConfig, McpToolInfo } from '../types'

export interface McpCallResult {
  ok: boolean
  content: string
  raw?: unknown
  error?: string
}

let rpcId = 1

async function httpRpc(
  server: McpServerConfig,
  method: string,
  params?: Record<string, unknown>,
): Promise<unknown> {
  if (!server.url) throw new Error('MCP HTTP server missing url')
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Accept: 'application/json',
  }
  if (server.authToken) headers.Authorization = `Bearer ${server.authToken}`

  const body = {
    jsonrpc: '2.0',
    id: rpcId++,
    method,
    params: params || {},
  }

  // Prefer Electron proxy (no CORS)
  if (window.subagents?.mcp?.httpRpc) {
    return window.subagents.mcp.httpRpc({
      url: server.url,
      headers,
      body,
    })
  }

  const res = await fetch(server.url, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  })
  if (!res.ok) {
    const t = await res.text().catch(() => res.statusText)
    throw new Error(`MCP HTTP ${res.status}: ${t.slice(0, 200)}`)
  }
  const data = (await res.json()) as { result?: unknown; error?: { message?: string } }
  if (data.error) throw new Error(data.error.message || 'MCP error')
  return data.result
}

export async function mcpListTools(server: McpServerConfig): Promise<McpToolInfo[]> {
  if (!server.enabled) return []

  if (server.transport === 'stdio') {
    if (!window.subagents?.mcp?.stdioListTools) {
      throw new Error('stdio MCP 僅支援 Electron 環境')
    }
    const tools = await window.subagents.mcp.stdioListTools({
      id: server.id,
      command: server.command || '',
      args: server.args || [],
    })
    return tools.map((t) => ({
      serverId: server.id,
      serverName: server.name,
      name: t.name,
      description: t.description,
      inputSchema: t.inputSchema,
    }))
  }

  // Initialize handshake (best-effort for servers that require it)
  try {
    await httpRpc(server, 'initialize', {
      protocolVersion: '2024-11-05',
      capabilities: {},
      clientInfo: { name: 'subagents-ai', version: '1.0.0' },
    })
  } catch {
    /* some servers don't need initialize on same HTTP endpoint */
  }

  const result = (await httpRpc(server, 'tools/list', {})) as {
    tools?: Array<{ name: string; description?: string; inputSchema?: Record<string, unknown> }>
  }
  return (result.tools || []).map((t) => ({
    serverId: server.id,
    serverName: server.name,
    name: t.name,
    description: t.description,
    inputSchema: t.inputSchema,
  }))
}

export async function mcpCallTool(
  server: McpServerConfig,
  toolName: string,
  args: Record<string, unknown>,
): Promise<McpCallResult> {
  if (!server.enabled) return { ok: false, content: '', error: 'server disabled' }

  try {
    if (server.transport === 'stdio') {
      if (!window.subagents?.mcp?.stdioCallTool) {
        return { ok: false, content: '', error: 'stdio MCP 僅支援 Electron' }
      }
      const r = await window.subagents.mcp.stdioCallTool({
        id: server.id,
        command: server.command || '',
        args: server.args || [],
        toolName,
        arguments: args,
      })
      return r
    }

    const result = await httpRpc(server, 'tools/call', {
      name: toolName,
      arguments: args,
    })
    const content = formatMcpContent(result)
    return { ok: true, content, raw: result }
  } catch (e) {
    return {
      ok: false,
      content: '',
      error: e instanceof Error ? e.message : String(e),
    }
  }
}

function formatMcpContent(result: unknown): string {
  if (result == null) return '(empty)'
  if (typeof result === 'string') return result
  const r = result as { content?: Array<{ type?: string; text?: string }> }
  if (Array.isArray(r.content)) {
    return r.content
      .map((c) => (c.type === 'text' || c.text ? c.text || '' : JSON.stringify(c)))
      .join('\n')
  }
  return JSON.stringify(result, null, 2).slice(0, 8000)
}

export async function listAllMcpTools(servers: McpServerConfig[]): Promise<McpToolInfo[]> {
  const out: McpToolInfo[] = []
  for (const s of servers.filter((x) => x.enabled)) {
    try {
      const tools = await mcpListTools(s)
      out.push(...tools)
    } catch (e) {
      out.push({
        serverId: s.id,
        serverName: s.name,
        name: '__error__',
        description: e instanceof Error ? e.message : String(e),
      })
    }
  }
  return out
}

/** Ensure long-lived stdio session (Phase 5) */
export async function mcpEnsureSession(server: McpServerConfig) {
  if (server.transport !== 'stdio') {
    return { ok: false, error: '僅 stdio 支援長連線 session' }
  }
  if (!window.subagents?.mcp?.stdioEnsure) {
    return { ok: false, error: 'stdio session 僅 Electron' }
  }
  try {
    const st = await window.subagents.mcp.stdioEnsure({
      id: server.id,
      command: server.command || '',
      args: server.args || [],
    })
    return { ok: true, status: st }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
}

export async function mcpStopSession(serverId: string) {
  if (!window.subagents?.mcp?.stdioStop) return { ok: false }
  return window.subagents.mcp.stdioStop(serverId)
}

export async function mcpListSessions() {
  if (!window.subagents?.mcp?.stdioSessions) return []
  return window.subagents.mcp.stdioSessions()
}

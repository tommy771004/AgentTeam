import { registerPiExtensionPack, type PiPackTool } from '../piToolHost.ts'
import { storePiToolOutput, readPiStoredOutput } from '../piPackBridges.ts'
import {
  codegraphStatus,
  codegraphExplore,
  codegraphQuery,
  codegraphCallers,
  codegraphImpact,
} from '../codegraphBridge.ts'

/**
 * Utility and codegraph pack（工具與程式圖包）.
 *
 * The codegraph tools read the SAME index the app's Code Graph panel indexes:
 * the external codegraph CLI against `<root>/.codegraph/`, through the same
 * bridge main uses — not a second graph. An un-indexed project is a STATUS
 * answer, not an error, because "this project has no graph yet" is a fact the
 * agent can act on.
 */

function jsonOk(data: Record<string, unknown>) {
  return { content: [{ type: 'text' as const, text: JSON.stringify(data) }], details: { ok: true, ...data } }
}

function structuredFailure(error: string) {
  return { content: [{ type: 'text' as const, text: JSON.stringify({ ok: false, error }) }], details: { ok: false, error } }
}

const codegraphExploreTool: PiPackTool = {
  name: 'codegraph_explore',
  label: 'CodeGraph Explore',
  description: 'Explore the code graph around a symbol or file',
  promptSnippet: 'explore the indexed code graph around a symbol',
  parameters: {
    type: 'object',
    properties: {
      query: { type: 'string', description: 'Symbol / file to explore' },
      limit: { type: 'integer', description: 'Max nodes', default: 20 },
    },
    required: ['query'],
  },
  execute: async (args, ctx) => {
    const status = await codegraphStatus(ctx.cwd)
    if (!status.installed) return structuredFailure('codegraph CLI 未安裝：無法探索程式圖')
    if (!status.indexed) return jsonOk({ indexed: false, note: `此專案尚未建立索引（${status.projectRoot}）；請先執行索引`, projectRoot: status.projectRoot })
    const result = await codegraphExplore(ctx.cwd, String(args.query || ''))
    return jsonOk({ indexed: true, ...(result as Record<string, unknown>) })
  },
}

const codegraphStatusTool: PiPackTool = {
  name: 'codegraph_status',
  label: 'CodeGraph Status',
  description: 'Report whether this project has an indexed code graph',
  promptSnippet: 'report the state of the project code graph',
  parameters: { type: 'object', properties: {} },
  execute: async (_args, ctx) => {
    const status = await codegraphStatus(ctx.cwd)
    return jsonOk({ installed: status.installed, indexed: status.indexed, version: status.version, projectRoot: status.projectRoot })
  },
}

const codegraphImpactTool: PiPackTool = {
  name: 'codegraph_impact',
  label: 'CodeGraph Impact',
  description: 'Report what changes to a symbol would affect',
  promptSnippet: 'assess the blast radius of changing a symbol',
  parameters: {
    type: 'object',
    properties: { symbol: { type: 'string', description: 'Symbol path to assess' } },
    required: ['symbol'],
  },
  execute: async (args, ctx) => {
    const status = await codegraphStatus(ctx.cwd)
    if (!status.installed) return structuredFailure('codegraph CLI 未安裝')
    if (!status.indexed) return jsonOk({ indexed: false, note: '此專案尚未建立索引，無法評估影響面', projectRoot: status.projectRoot })
    const result = await codegraphImpact(ctx.cwd, String(args.symbol || ''))
    return jsonOk({ indexed: true, ...(result as Record<string, unknown>) })
  },
}

const codegraphCallersTool: PiPackTool = {
  name: 'codegraph_callers',
  label: 'CodeGraph Callers',
  description: 'List what calls a function in the indexed graph',
  promptSnippet: 'list callers of a function from the code graph',
  parameters: {
    type: 'object',
    properties: { symbol: { type: 'string', description: 'Function to inspect' } },
    required: ['symbol'],
  },
  execute: async (args, ctx) => {
    const status = await codegraphStatus(ctx.cwd)
    if (!status.installed) return structuredFailure('codegraph CLI 未安裝')
    if (!status.indexed) return jsonOk({ indexed: false, note: '此專案尚未建立索引，沒有呼叫者資料', projectRoot: status.projectRoot })
    const result = await codegraphCallers(ctx.cwd, String(args.symbol || ''))
    return jsonOk({ indexed: true, ...(result as Record<string, unknown>) })
  },
}

/** Shared helper for tools whose full output may exceed one model-visible page. */
export function pagedText(text: string, maxChars: number): { content: Array<{ type: 'text'; text: string }>; details: Record<string, unknown> } {
  const id = storePiToolOutput('tool_output_read', text)
  if (text.length <= maxChars) {
    return { content: [{ type: 'text', text }], details: { ok: true, outputId: id, truncated: false, totalChars: text.length } }
  }
  return {
    content: [{ type: 'text', text: `${text.slice(0, maxChars)}\n…（已截斷；用 tool_output_read 以 outputId 讀取全文）` }],
    details: { ok: true, outputId: id, truncated: true, totalChars: text.length },
  }
}

const tableParse: PiPackTool = {
  name: 'table_parse',
  label: 'Table Parse',
  description: 'Parse delimited text (CSV/TSV) into JSON rows',
  promptSnippet: 'parse CSV/TSV text into JSON rows',
  parameters: {
    type: 'object',
    properties: {
      text: { type: 'string', description: 'Delimited table text' },
      delimiter: { type: 'string', description: 'One-character delimiter; defaults to auto (tab, then comma)' },
    },
    required: ['text'],
  },
  execute: async (args) => {
    const text = String(args.text || '')
    const delimiter = typeof args.delimiter === 'string' && args.delimiter.length === 1 ? args.delimiter : text.includes('\t') ? '\t' : ','
    const lines = text.split(/\r?\n/).filter((line) => line.trim())
    if (!lines.length) return structuredFailure('沒有可解析的列')
    const headers = lines[0].split(delimiter).map((header) => header.trim())
    const rows = lines.slice(1).map((line) => {
      const cells = line.split(delimiter)
      return Object.fromEntries(headers.map((header, index) => [header, (cells[index] ?? '').trim()]))
    })
    return pagedJson(`解析 ${rows.length} 列 × ${headers.length} 欄`, rows)
  },
}

const jsonExtractLite: PiPackTool = {
  name: 'json_extract_lite',
  label: 'JSON Extract',
  description: 'Extract values from a JSON string by dotted path',
  promptSnippet: 'extract values from JSON by dotted path',
  parameters: {
    type: 'object',
    properties: {
      json: { type: 'string', description: 'JSON text' },
      path: { type: 'string', description: 'Dotted path, e.g. a.b.0.c; empty returns the whole document' },
    },
    required: ['json'],
  },
  execute: async (args) => {
    let document: unknown
    try {
      document = JSON.parse(String(args.json || ''))
    } catch (error) {
      return structuredFailure(error instanceof Error ? error.message : 'invalid JSON')
    }
    const path = String(args.path || '').trim()
    if (!path) return pagedJson('讀取整份 JSON', document)
    let current: unknown = document
    for (const segment of path.split('.')) {
      if (current == null || typeof current !== 'object') return structuredFailure(`路徑中斷於：${segment}`)
      const container = current as Record<string, unknown>
      const key = Array.isArray(current) && /^\d+$/.test(segment) ? Number(segment) : segment
      if (!(key in container)) return structuredFailure(`找不到鍵：${segment}`)
      current = container[key as keyof typeof container]
    }
    return pagedJson(`${path} =`, current)
  },
}

const toolOutputRead: PiPackTool = {
  name: 'tool_output_read',
  label: 'Tool Output Read',
  description: 'Read back a stored tool output by id (paged)',
  promptSnippet: 'page through a previously truncated tool output',
  parameters: {
    type: 'object',
    properties: {
      outputId: { type: 'string', description: 'Id returned by the truncated output' },
      offset: { type: 'integer', description: 'Character offset to start from', default: 0 },
      chars: { type: 'integer', description: 'Characters per page', default: 8000 },
    },
    required: ['outputId'],
  },
  execute: async (args) => {
    const stored = readPiStoredOutput(String(args.outputId || '').trim())
    if (!stored) return structuredFailure(`查無工具輸出：${String(args.outputId || '')}`)
    const offset = Math.max(0, Math.min(stored.text.length, Number(args.offset) || 0))
    const chars = Math.max(200, Math.min(50_000, Number(args.chars) || 8000))
    const slice = stored.text.slice(offset, offset + chars)
    return {
      content: [{ type: 'text', text: slice }],
      details: { ok: true, totalChars: stored.text.length, nextOffset: offset + chars < stored.text.length ? offset + chars : undefined },
    }
  },
}

const datetimeNow: PiPackTool = {
  name: 'datetime_now',
  label: 'Datetime Now',
  description: 'Current local date/time with timezone',
  promptSnippet: 'get the current date and time',
  parameters: { type: 'object', properties: {} },
  execute: async () => {
    const now = new Date()
    return jsonOk({
      iso: now.toISOString(),
      local: now.toString(),
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      epochMs: now.getTime(),
    })
  },
}

function pagedJson(prefix: string, data: unknown) {
  const text = `${prefix} ${JSON.stringify(data, null, 1)}`
  const { content, details } = pagedText(text, 12_000)
  return { content, details }
}

export function buildUtilityCodegraphPacks() {
  return [
    {
      id: 'utility-pack',
      name: 'Utility',
      description: 'Data shaping, time, and output paging',
      capability: 'core-utils',
      alwaysActive: true,
      tools: [datetimeNow, tableParse, jsonExtractLite, toolOutputRead],
    },
    {
      id: 'codegraph-pack',
      name: 'CodeGraph',
      description: 'Structural questions over the app-indexed graph',
      capability: 'codegraph',
      tools: [codegraphExploreTool, codegraphCallersTool, codegraphImpactTool, codegraphStatusTool],
    },
  ]
}

let registered = false
export function ensureUtilityCodegraphPacksRegistered(): void {
  if (registered) return
  registered = true
  for (const pack of buildUtilityCodegraphPacks()) registerPiExtensionPack(pack)
}

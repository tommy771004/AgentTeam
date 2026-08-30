import { registerPiExtensionPack, type PiPackTool, type PiToolContext } from '../piToolHost.ts'
import { readToolOutputSpill, writeToolOutputSpill } from '../attachmentStore.ts'
import { jsonOk, structuredFailure } from './packResults.ts'

/** Shared helper for tools whose full output may exceed one model-visible page. */
export function pagedText(text: string, maxChars: number, ctx: PiToolContext): { content: Array<{ type: 'text'; text: string }>; details: Record<string, unknown> } {
  if (text.length <= maxChars) {
    return { content: [{ type: 'text', text }], details: { ok: true, truncated: false, totalChars: text.length } }
  }
  if (!ctx.runId?.trim()) {
    return {
      content: [{ type: 'text', text: '工具輸出超過頁面上限，但缺少 run identity，已拒絕建立未隔離的輸出 locator。' }],
      details: { ok: false, truncated: true, totalChars: text.length, error: 'runId required for spilled output' },
    }
  }
  const spill = writeToolOutputSpill({
    runId: ctx.runId,
    threadId: ctx.sessionId,
    tool: 'tool_output_read',
    output: text,
    projectRoot: ctx.cwd,
  })
  return {
    content: [{ type: 'text', text: `${text.slice(0, maxChars)}\n…（已截斷；用 tool_output_read({ outputId: "${spill.locator}" }) 讀取全文）` }],
    details: { ok: true, outputId: spill.locator, truncated: true, totalChars: text.length, totalBytes: spill.bytes },
  }
}

const pagedJson = (prefix: string, data: unknown, ctx: PiToolContext) => {
  const text = `${prefix} ${JSON.stringify(data, null, 1)}`
  const { content, details } = pagedText(text, 12_000, ctx)
  return { content, details }
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
  execute: async (args, ctx) => {
    const text = String(args.text || '')
    const delimiter = typeof args.delimiter === 'string' && args.delimiter.length === 1
      ? args.delimiter
      : text.includes('\t') ? '\t' : ','
    const lines = text.split(/\r?\n/).filter((line) => line.trim())
    if (!lines.length) return structuredFailure('沒有可解析的列')
    const headers = lines[0].split(delimiter).map((header) => header.trim())
    const rows = lines.slice(1).map((line) => {
      const cells = line.split(delimiter)
      return Object.fromEntries(headers.map((header, index) => [header, (cells[index] ?? '').trim()]))
    })
    return pagedJson(`解析 ${rows.length} 列 × ${headers.length} 欄`, rows, ctx)
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
  execute: async (args, ctx) => {
    let document: unknown
    try {
      document = JSON.parse(String(args.json || ''))
    } catch (error) {
      return structuredFailure(error instanceof Error ? error.message : 'invalid JSON')
    }
    const path = String(args.path || '').trim()
    if (!path) return pagedJson('讀取整份 JSON', document, ctx)
    let current: unknown = document
    for (const segment of path.split('.')) {
      if (current == null || typeof current !== 'object') return structuredFailure(`路徑中斷於：${segment}`)
      const container = current as Record<string, unknown>
      const key = Array.isArray(current) && /^\d+$/.test(segment) ? Number(segment) : segment
      if (!(key in container)) return structuredFailure(`找不到鍵：${segment}`)
      current = container[key as keyof typeof container]
    }
    return pagedJson(`${path} =`, current, ctx)
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
      outputId: { type: 'string', description: 'Run-scoped locator returned by the truncated output' },
      offset: { type: 'integer', description: 'Byte offset to start from', default: 0 },
      chars: { type: 'integer', description: 'Maximum bytes per page', default: 8000 },
    },
    required: ['outputId'],
  },
  execute: async (args, ctx) => {
    const runId = ctx.runId?.trim()
    if (!runId) return structuredFailure('讀取工具輸出需要 admitted run identity')
    const page = readToolOutputSpill({
      locator: String(args.outputId || '').trim(),
      runId,
      projectRoot: ctx.cwd,
      offset: Number(args.offset) || 0,
      maxBytes: Number(args.chars) || 8000,
    })
    if (!page.ok) return structuredFailure(`查無工具輸出：${page.error || String(args.outputId || '')}`)
    return {
      content: [{ type: 'text', text: page.output || '' }],
      details: {
        ok: true,
        totalBytes: page.bytes,
        offset: page.offset,
        nextOffset: page.nextOffset,
      },
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

export function buildUtilityPack() {
  return {
    id: 'utility-pack',
    name: 'Utility',
    description: 'Data shaping, time, and output paging',
    capability: 'core-utils',
    alwaysActive: true,
    tools: [datetimeNow, tableParse, jsonExtractLite, toolOutputRead],
  }
}

let registered = false
export function ensureUtilityPackRegistered(): void {
  if (registered) return
  registered = true
  registerPiExtensionPack(buildUtilityPack())
}

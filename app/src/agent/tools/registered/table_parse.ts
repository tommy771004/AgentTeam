/**
 * Self-registering tool module: table_parse
 * Hermes-style import-time register(). I/O lives here (no central switch).
 */
import { register } from '../toolRegistry.ts'
import { resolveEffectiveProjectRoot } from '../runContext.ts'
import type { ToolExecutionContext } from '../toolIoHelpers.ts'

register({
  name: "table_parse",
  toolset: "workspace",
  description: "Parse CSV or TSV text into structured rows",
  keywords: ["csv","tsv","table","spreadsheet","parse rows"],
  schemaParams: {"type":"object","properties":{"text":{"type":"string"},"delimiter":{"type":"string","enum":["auto",",","\t",";"],"default":"auto"},"hasHeader":{"type":"boolean","default":true}},"required":["text"]} as Record<string, unknown>,
  owningCapability: "workspace",
  handler: async (args, ctx) => {
    const input = args
    const context = ctx as ToolExecutionContext | undefined
    const api = window.subagents?.tools
    const projectRoot = await resolveEffectiveProjectRoot(context?.projectRoot, context?.runId)
    const runId = context?.runId
    const threadId = context?.threadId
    try {
    const text = String(input.text || '').trim()
    if (!text) return { ok: false, output: 'text is required' }
    const requested = String(input.delimiter || 'auto')
    const delimiter = requested === 'auto' ? (text.includes('\t') ? '\t' : text.includes(';') && !text.includes(',') ? ';' : ',') : requested
    const rows = text.split(/\r?\n/).filter(Boolean).map((line) => line.split(delimiter).map((cell) => cell.trim()))
    const hasHeader = input.hasHeader !== false
    const headers = hasHeader ? (rows.shift() || []) : []
    const data = hasHeader ? rows.map((row) => Object.fromEntries(headers.map((h, i) => [h || `column_${i + 1}`, row[i] || '']))) : rows
    return { ok: true, output: JSON.stringify({ headers, rows: data, rowCount: data.length }, null, 2), data }
    } catch (e) {
      return { ok: false, output: e instanceof Error ? e.message : String(e) }
    }
  },
})

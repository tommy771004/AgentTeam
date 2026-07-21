/**
 * Self-registering tool module: json_extract_lite
 * Hermes-style import-time register(). I/O lives here (no central switch).
 */
import { register } from '../toolRegistry.ts'
import { resolveEffectiveProjectRoot } from '../runContext.ts'
import type { ToolExecutionContext } from '../toolIoHelpers.ts'

register({
  name: "json_extract_lite",
  toolset: "core-utils",
  description: "json_extract_lite: simple title/items/summary heuristic, not arbitrary schema extraction",
  keywords: ["extract","json","schema","structure","parse"],
  schemaParams: {"type":"object","properties":{"text":{"type":"string","description":"Source text"},"fields":{"type":"array","items":{"type":"string"},"description":"Desired field names"}},"required":["text"]} as Record<string, unknown>,
  owningCapability: "core-utils",
  handler: async (args, ctx) => {
    const input = args
    const context = ctx as ToolExecutionContext | undefined
    const api = window.subagents?.tools
    const projectRoot = await resolveEffectiveProjectRoot(context?.projectRoot, context?.runId)
    const runId = context?.runId
    const threadId = context?.threadId
    try {
    const text = String(input.text || '')
    const items = text
      .split(/\n/)
      .map((l) => l.replace(/^[-*•]\s*/, '').trim())
      .filter((l) => l.length > 8 && l.length < 120)
      .slice(0, 8)
    const payload = {
      title: text.split('\n').find((l) => l.startsWith('#'))?.replace(/^#+\s*/, '') || 'json_extract_lite',
      items,
      summary: text.slice(0, 280),
    }
    return { ok: true, output: JSON.stringify(payload, null, 2), data: payload }
    } catch (e) {
      return { ok: false, output: e instanceof Error ? e.message : String(e) }
    }
  },
})

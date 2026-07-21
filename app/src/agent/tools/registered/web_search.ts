/**
 * Self-registering tool module: web_search
 * Hermes-style import-time register(). I/O lives here (no central switch).
 */
import { register } from '../toolRegistry.ts'
import { resolveEffectiveProjectRoot } from '../runContext.ts'
import type { ToolExecutionContext } from '../toolIoHelpers.ts'
import { formatSearch, browserWebSearch } from '../toolIoHelpers.ts'

register({
  name: "web_search",
  toolset: "web-research",
  description: "Search the web / Wikipedia for facts and sources",
  keywords: ["search","find","research","compare","look up","web","market","competitor","software","tools","price"],
  schemaParams: {"type":"object","properties":{"query":{"type":"string","description":"Search query"},"limit":{"type":"integer","description":"Max results (1-8)","default":5}},"required":["query"]} as Record<string, unknown>,
  owningCapability: "web-research",
  handler: async (args, ctx) => {
    const input = args
    const context = ctx as ToolExecutionContext | undefined
    const api = window.subagents?.tools
    const projectRoot = await resolveEffectiveProjectRoot(context?.projectRoot, context?.runId)
    const runId = context?.runId
    const threadId = context?.threadId
    try {
    if (api?.webSearch) {
      const r = await api.webSearch(String(input.query || ''), Number(input.limit) || 5)
      return { ok: true, output: formatSearch(r), data: r }
    }
    return browserWebSearch(String(input.query || ''))
    } catch (e) {
      return { ok: false, output: e instanceof Error ? e.message : String(e) }
    }
  },
})

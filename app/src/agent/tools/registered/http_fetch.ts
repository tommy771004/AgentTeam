/**
 * Self-registering tool module: http_fetch
 * Hermes-style import-time register(). I/O lives here (no central switch).
 */
import { register } from '../toolRegistry.ts'
import { resolveEffectiveProjectRoot } from '../runContext.ts'
import type { ToolExecutionContext } from '../toolIoHelpers.ts'
import { browserHttpFetch } from '../toolIoHelpers.ts'

register({
  name: "http_fetch",
  toolset: "web-research",
  description: "Fetch a public HTTP(S) URL as text",
  keywords: ["fetch","http","url","download","endpoint","api"],
  schemaParams: {"type":"object","properties":{"url":{"type":"string","description":"HTTP(S) URL"},"maxChars":{"type":"integer","description":"Max response characters","default":4000}},"required":["url"]} as Record<string, unknown>,
  owningCapability: "web-research",
  handler: async (args, ctx) => {
    const input = args
    const context = ctx as ToolExecutionContext | undefined
    const api = window.subagents?.tools
    const projectRoot = await resolveEffectiveProjectRoot(context?.projectRoot, context?.runId)
    const runId = context?.runId
    const threadId = context?.threadId
    try {
    if (api?.httpFetch) {
      const r = await api.httpFetch(String(input.url || ''), Number(input.maxChars) || 4000)
      return { ok: r.ok, output: r.text, data: r }
    }
    return browserHttpFetch(String(input.url || ''), Number(input.maxChars) || 4000)
    } catch (e) {
      return { ok: false, output: e instanceof Error ? e.message : String(e) }
    }
  },
})

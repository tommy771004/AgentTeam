/**
 * Self-registering tool module: memory_search
 * Hermes-style import-time register(). I/O lives here (no central switch).
 */
import { register } from '../toolRegistry.ts'
import { resolveEffectiveProjectRoot } from '../runContext.ts'
import type { ToolExecutionContext } from '../toolIoHelpers.ts'

register({
  name: "memory_search",
  toolset: "memory",
  description: "Search persistent memory entries",
  keywords: ["recall","search memory","past","preference"],
  schemaParams: {"type":"object","properties":{"query":{"type":"string"},"limit":{"type":"integer","default":8}},"required":["query"]} as Record<string, unknown>,
  owningCapability: "memory",
  handler: async (args, ctx) => {
    const input = args
    const context = ctx as ToolExecutionContext | undefined
    const api = window.subagents?.tools
    const projectRoot = await resolveEffectiveProjectRoot(context?.projectRoot, context?.runId)
    const runId = context?.runId
    const threadId = context?.threadId
    try {
    const { memoryStore } = await import('../../hermes/memory.ts')
    const { useSettingsStore } = await import('../../../store/settingsStore.ts')
    if (useSettingsStore.getState().settings.memoryEnabled === false) {
      return { ok: false, output: '記憶已在設定中關閉' }
    }
    const query = String(input.query || '')
    const limit = Number(input.limit) || 8
    const hits = memoryStore.search(query, limit)
    if (!hits.length) return { ok: true, output: `無記憶命中：${query}` }
    return {
      ok: true,
      output: hits.map((h, i) => `${i + 1}. ${h.text}`).join('\n'),
      data: hits,
    }
    } catch (e) {
      return { ok: false, output: e instanceof Error ? e.message : String(e) }
    }
  },
})

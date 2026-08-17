/**
 * Self-registering tool module: codegraph_callers
 * Hermes-style import-time register(). I/O lives here (no central switch).
 */
import { register } from '../toolRegistry.ts'
import { resolveEffectiveProjectRoot } from '../runContext.ts'
import type { ToolExecutionContext } from '../toolIoHelpers.ts'

register({
  name: "codegraph_callers",
  toolset: "codegraph",
  description: "Find callers of a symbol via CodeGraph",
  keywords: ["callers","who calls","references","usages"],
  schemaParams: {"type":"object","properties":{"symbol":{"type":"string","description":"Symbol to find callers for"},"projectRoot":{"type":"string"}},"required":["symbol"]} as Record<string, unknown>,
  owningCapability: "codegraph",
  handler: async (args, ctx) => {
    const input = args
    const context = ctx as ToolExecutionContext | undefined
    const api = window.subagents?.tools
    const projectRoot = await resolveEffectiveProjectRoot(context?.projectRoot, context?.runId)
    const runId = context?.runId
    const threadId = context?.threadId
    try {
    const symbol = String(input.symbol || '').trim()
    if (!symbol) return { ok: false, output: 'symbol 必填' }
    let root = input.projectRoot ? String(input.projectRoot) : ''
    if (!root) {
      try {
        const { useProjectStore } = await import('../../../store/projectStore.ts')
        root = useProjectStore.getState().root || ''
      } catch {
        /* ignore */
      }
    }
    if (!root) return { ok: false, output: '請先選擇專案目錄' }
    const { runCodegraphCallers } = await import('../../codegraphClient.ts')
    const r = await runCodegraphCallers(root, symbol)
    return {
      ok: r.ok,
      output: r.ok ? r.output.slice(0, 12_000) : r.error || r.output || 'callers failed',
      data: r,
    }
    } catch (e) {
      return { ok: false, output: e instanceof Error ? e.message : String(e) }
    }
  },
})

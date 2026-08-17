/**
 * Self-registering tool module: codegraph_explore
 * Hermes-style import-time register(). I/O lives here (no central switch).
 */
import { register } from '../toolRegistry.ts'
import { resolveEffectiveProjectRoot } from '../runContext.ts'
import type { ToolExecutionContext } from '../toolIoHelpers.ts'

register({
  name: "codegraph_explore",
  toolset: "codegraph",
  description: "Query local CodeGraph index for symbols/call paths (surgical code context). Requires codegraph CLI + project init.",
  keywords: ["codegraph","call graph","callers","callees","impact","symbol","architecture","how does","code structure","blast radius","dependency"],
  schemaParams: {"type":"object","properties":{"query":{"type":"string","description":"Natural language or symbol name, e.g. \"how does X work\", \"UserService.login\""},"projectRoot":{"type":"string","description":"Optional absolute project path (default: selected project)"}},"required":["query"]} as Record<string, unknown>,
  owningCapability: "codegraph",
  handler: async (args, ctx) => {
    const input = args
    const context = ctx as ToolExecutionContext | undefined
    const api = window.subagents?.tools
    const projectRoot = await resolveEffectiveProjectRoot(context?.projectRoot, context?.runId)
    const runId = context?.runId
    const threadId = context?.threadId
    try {
    const query = String(input.query || '').trim()
    if (!query) return { ok: false, output: 'query 必填' }
    let root = input.projectRoot ? String(input.projectRoot) : ''
    if (!root) {
      try {
        const { useProjectStore } = await import('../../../store/projectStore.ts')
        root = useProjectStore.getState().root || ''
      } catch {
        /* ignore */
      }
    }
    if (!root) return { ok: false, output: '請先選擇專案目錄（專案 pill / ⌘O）' }
    const { runCodegraphExplore } = await import('../../codegraphClient.ts')
    const r = await runCodegraphExplore(root, query)
    return {
      ok: r.ok,
      output: r.ok
        ? r.output.slice(0, 12_000)
        : r.error || r.output || 'codegraph explore failed',
      data: r,
    }
    } catch (e) {
      return { ok: false, output: e instanceof Error ? e.message : String(e) }
    }
  },
})

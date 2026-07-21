/**
 * Self-registering tool module: workspace_list
 * Hermes-style import-time register(). I/O lives here (no central switch).
 */
import { register } from '../toolRegistry.ts'
import { resolveEffectiveProjectRoot } from '../runContext.ts'
import type { ToolExecutionContext } from '../toolIoHelpers.ts'

register({
  name: "workspace_list",
  toolset: "workspace",
  description: "List files in the sandboxed workspace",
  keywords: ["list files","workspace","directory","ls","ingest"],
  schemaParams: {"type":"object","properties":{"path":{"type":"string","description":"Relative path under workspace","default":"."}}} as Record<string, unknown>,
  owningCapability: "workspace",
  handler: async (args, ctx) => {
    const input = args
    const context = ctx as ToolExecutionContext | undefined
    const api = window.subagents?.tools
    const projectRoot = await resolveEffectiveProjectRoot(context?.projectRoot, context?.runId)
    const runId = context?.runId
    const threadId = context?.threadId
    try {
    if (api?.workspaceList) {
      const r = await api.workspaceList(String(input.path || '.'), projectRoot)
      return {
        ok: true,
        output: r.entries.map((e) => `${e.dir ? 'dir ' : 'file'} ${e.name}`).join('\n') || '(empty)',
        data: r,
      }
    }
    return { ok: true, output: '(browser mode) workspace unavailable — use Electron app' }
    } catch (e) {
      return { ok: false, output: e instanceof Error ? e.message : String(e) }
    }
  },
})

/**
 * Self-registering tool module: workspace_read
 * Hermes-style import-time register(). I/O lives here (no central switch).
 */
import { register } from '../toolRegistry.ts'
import { resolveEffectiveProjectRoot } from '../runContext.ts'
import type { ToolExecutionContext } from '../toolIoHelpers.ts'

register({
  name: "workspace_read",
  toolset: "workspace",
  description: "Read a file from the sandboxed workspace",
  keywords: ["read file","open file","load","ingest","parse"],
  schemaParams: {"type":"object","properties":{"path":{"type":"string","description":"Relative file path under workspace"}},"required":["path"]} as Record<string, unknown>,
  owningCapability: "workspace",
  handler: async (args, ctx) => {
    const input = args
    const context = ctx as ToolExecutionContext | undefined
    const api = window.subagents?.tools
    const projectRoot = await resolveEffectiveProjectRoot(context?.projectRoot, context?.runId)
    const runId = context?.runId
    const threadId = context?.threadId
    try {
    if (api?.workspaceRead) {
      const r = await api.workspaceRead(String(input.path || ''), projectRoot)
      return { ok: r.ok, output: r.content, data: r }
    }
    return { ok: false, output: 'workspace_read requires Electron' }
    } catch (e) {
      return { ok: false, output: e instanceof Error ? e.message : String(e) }
    }
  },
})

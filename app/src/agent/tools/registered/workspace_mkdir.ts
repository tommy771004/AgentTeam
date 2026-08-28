/**
 * Self-registering tool module: workspace_mkdir
 * Hermes-style import-time register(). I/O lives here (no central switch).
 */
import { register } from '../toolRegistry.ts'
import { resolveEffectiveProjectRoot } from '../runContext.ts'
import type { ToolExecutionContext } from '../toolIoHelpers.ts'

register({
  name: "workspace_mkdir",
  toolset: "workspace",
  description: "Create a directory in the sandboxed workspace",
  keywords: ["mkdir","create directory","folder"],
  schemaParams: {"type":"object","properties":{"path":{"type":"string","description":"Relative directory path"}},"required":["path"]} as Record<string, unknown>,
  owningCapability: "workspace",
  handler: async (args, ctx) => {
    const input = args
    const context = ctx as ToolExecutionContext | undefined
    const api = window.subagents?.tools
    const projectRoot = await resolveEffectiveProjectRoot(context?.projectRoot, context?.runId)
    try {
    if (!api?.workspaceMkdir) return { ok: false, output: 'workspace_mkdir requires Electron' }
    const r = await api.workspaceMkdir(String(input.path || ''), projectRoot)
    return { ok: r.ok, output: r.ok ? `Created directory → ${r.path}` : r.error || 'mkdir failed', data: r }
    } catch (e) {
      return { ok: false, output: e instanceof Error ? e.message : String(e) }
    }
  },
})

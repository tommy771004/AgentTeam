/**
 * Self-registering tool module: workspace_delete
 * Hermes-style import-time register(). I/O lives here (no central switch).
 */
import { register } from '../toolRegistry.ts'
import { resolveEffectiveProjectRoot } from '../runContext.ts'
import type { ToolExecutionContext } from '../toolIoHelpers.ts'
import { recordRewindSnapshot } from '../toolIoHelpers.ts'

register({
  name: "workspace_delete",
  toolset: "workspace",
  description: "Delete a workspace file or directory",
  keywords: ["delete file","remove file","delete directory"],
  schemaParams: {"type":"object","properties":{"path":{"type":"string"},"recursive":{"type":"boolean","default":false}},"required":["path"]} as Record<string, unknown>,
  owningCapability: "workspace",
  handler: async (args, ctx) => {
    const input = args
    const context = ctx as ToolExecutionContext | undefined
    const api = window.subagents?.tools
    const projectRoot = await resolveEffectiveProjectRoot(context?.projectRoot, context?.runId)
    const runId = context?.runId
    const threadId = context?.threadId
    try {
    if (!api?.workspaceDelete) return { ok: false, output: 'workspace_delete requires Electron' }
    await recordRewindSnapshot({
      threadId,
      runId,
      kind: 'delete',
      relPath: String(input.path || ''),
      projectRoot,
    })
    const r = await api.workspaceDelete(
      String(input.path || ''),
      input.recursive === true,
      projectRoot,
    )
    return { ok: r.ok, output: r.ok ? `Deleted ${r.path}` : r.error || 'delete failed', data: r }
    } catch (e) {
      return { ok: false, output: e instanceof Error ? e.message : String(e) }
    }
  },
})

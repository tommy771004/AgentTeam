/**
 * Self-registering tool module: workspace_move
 * Hermes-style import-time register(). I/O lives here (no central switch).
 */
import { register } from '../toolRegistry.ts'
import { resolveEffectiveProjectRoot } from '../runContext.ts'
import type { ToolExecutionContext } from '../toolIoHelpers.ts'
import { recordRewindSnapshot } from '../toolIoHelpers.ts'

register({
  name: "workspace_move",
  toolset: "workspace",
  description: "Move or rename a workspace file or directory",
  keywords: ["move file","rename file","rename directory"],
  schemaParams: {"type":"object","properties":{"from":{"type":"string"},"to":{"type":"string"}},"required":["from","to"]} as Record<string, unknown>,
  owningCapability: "workspace",
  handler: async (args, ctx) => {
    const input = args
    const context = ctx as ToolExecutionContext | undefined
    const api = window.subagents?.tools
    const projectRoot = await resolveEffectiveProjectRoot(context?.projectRoot, context?.runId)
    const runId = context?.runId
    const threadId = context?.threadId
    try {
    if (!api?.workspaceMove) return { ok: false, output: 'workspace_move requires Electron' }
    await recordRewindSnapshot({
      threadId,
      runId,
      kind: 'move',
      relPath: String(input.from || ''),
      toPath: String(input.to || ''),
      projectRoot,
    })
    const r = await api.workspaceMove(
      String(input.from || ''),
      String(input.to || ''),
      projectRoot,
    )
    return { ok: r.ok, output: r.ok ? `Moved ${r.from} → ${r.to}` : r.error || 'move failed', data: r }
    } catch (e) {
      return { ok: false, output: e instanceof Error ? e.message : String(e) }
    }
  },
})

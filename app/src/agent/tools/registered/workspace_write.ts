/**
 * Self-registering tool module: workspace_write
 * Hermes-style import-time register(). I/O lives here (no central switch).
 */
import { register } from '../toolRegistry.ts'
import { resolveEffectiveProjectRoot } from '../runContext.ts'
import type { ToolExecutionContext } from '../toolIoHelpers.ts'
import { recordRewindSnapshot } from '../toolIoHelpers.ts'

register({
  name: "workspace_write",
  toolset: "workspace",
  description: "Write a file into the sandboxed workspace",
  keywords: ["write file","save","export","report","deliver","output"],
  schemaParams: {"type":"object","properties":{"path":{"type":"string","description":"Relative file path under workspace"},"content":{"type":"string","description":"File content to write"}},"required":["path","content"]} as Record<string, unknown>,
  owningCapability: "workspace",
  handler: async (args, ctx) => {
    const input = args
    const context = ctx as ToolExecutionContext | undefined
    const api = window.subagents?.tools
    const projectRoot = await resolveEffectiveProjectRoot(context?.projectRoot, context?.runId)
    const runId = context?.runId
    const threadId = context?.threadId
    try {
    if (api?.workspaceWrite) {
      await recordRewindSnapshot({
        threadId,
        runId,
        kind: 'write',
        relPath: String(input.path || ''),
        after: String(input.content || ''),
        projectRoot,
      })
      const r = await api.workspaceWrite(
        String(input.path || ''),
        String(input.content || ''),
        projectRoot,
      )
      return {
        ok: r.ok,
        output: r.ok ? `Wrote ${r.bytes} bytes → ${r.path}` : r.error || 'write failed',
        data: r,
      }
    }
    return { ok: false, output: 'workspace_write requires Electron' }
    } catch (e) {
      return { ok: false, output: e instanceof Error ? e.message : String(e) }
    }
  },
})

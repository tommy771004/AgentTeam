/**
 * Self-registering tool module: workspace_download
 * Hermes-style import-time register(). I/O lives here (no central switch).
 */
import { register } from '../toolRegistry.ts'
import { resolveEffectiveProjectRoot } from '../runContext.ts'
import type { ToolExecutionContext } from '../toolIoHelpers.ts'

register({
  name: "workspace_download",
  toolset: "workspace",
  description: "Download an HTTP(S) URL to the sandboxed workspace",
  keywords: ["download file","save url","url to workspace"],
  schemaParams: {"type":"object","properties":{"url":{"type":"string","description":"HTTP(S) URL"},"path":{"type":"string","description":"Relative destination path"}},"required":["url","path"]} as Record<string, unknown>,
  owningCapability: "workspace",
  handler: async (args, ctx) => {
    const input = args
    const context = ctx as ToolExecutionContext | undefined
    const api = window.subagents?.tools
    const projectRoot = await resolveEffectiveProjectRoot(context?.projectRoot, context?.runId)
    try {
    if (!api?.workspaceDownload) return { ok: false, output: 'workspace_download requires Electron' }
    const r = await api.workspaceDownload(
      String(input.url || ''),
      String(input.path || ''),
      projectRoot,
    )
    return { ok: r.ok, output: r.ok ? `Downloaded ${r.bytes} bytes → ${r.path}` : r.error || 'download failed', data: r }
    } catch (e) {
      return { ok: false, output: e instanceof Error ? e.message : String(e) }
    }
  },
})

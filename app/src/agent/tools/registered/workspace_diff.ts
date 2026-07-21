/**
 * Self-registering tool module: workspace_diff
 * Hermes-style import-time register(). I/O lives here (no central switch).
 */
import { register } from '../toolRegistry.ts'
import { resolveEffectiveProjectRoot } from '../runContext.ts'
import type { ToolExecutionContext } from '../toolIoHelpers.ts'

register({
  name: "workspace_diff",
  toolset: "workspace",
  description: "Read the current Git working-tree diff for selected workspace files.",
  keywords: ["diff","review changes","patch","working tree","changed files"],
  schemaParams: {"type":"object","properties":{"paths":{"type":"array","items":{"type":"string"},"description":"Optional relative file paths to scope the diff"}}} as Record<string, unknown>,
  owningCapability: "workspace",
  handler: async (args, ctx) => {
    const input = args
    const context = ctx as ToolExecutionContext | undefined
    const api = window.subagents?.tools
    const projectRoot = await resolveEffectiveProjectRoot(context?.projectRoot, context?.runId)
    const runId = context?.runId
    const threadId = context?.threadId
    try {
    if (!api?.workspaceDiff) return { ok: false, output: 'workspace_diff requires Electron' }
    const paths = Array.isArray(input.paths)
      ? input.paths.map(String).filter(Boolean).slice(0, 80)
      : []
    const r = await api.workspaceDiff(paths, projectRoot)
    return {
      ok: r.ok,
      output: r.ok ? r.diff || '(working tree clean)' : r.error || 'diff failed',
      data: r,
    }
    } catch (e) {
      return { ok: false, output: e instanceof Error ? e.message : String(e) }
    }
  },
})

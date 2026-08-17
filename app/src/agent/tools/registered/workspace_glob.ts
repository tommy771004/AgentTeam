/** Self-registering scoped workspace glob. */
import { register } from '../toolRegistry.ts'
import { resolveEffectiveProjectRoot } from '../runContext.ts'
import type { ToolExecutionContext } from '../toolIoHelpers.ts'

register({
  name: 'workspace_glob',
  toolset: 'workspace',
  description: 'Find files by glob under the run-scoped workspace root',
  keywords: ['glob', 'find files', 'file pattern', 'workspace'],
  schemaParams: {
    type: 'object',
    properties: {
      pattern: { type: 'string', description: 'Relative glob, e.g. src/**/*.ts' },
      path: { type: 'string', description: 'Relative directory under workspace', default: '.' },
      maxResults: { type: 'integer', description: 'Maximum files (1-1000)', default: 200 },
    },
    required: ['pattern'],
  } as Record<string, unknown>,
  owningCapability: 'workspace',
  handler: async (args, ctx) => {
    const input = args
    const context = ctx as ToolExecutionContext | undefined
    const api = window.subagents?.tools
    const projectRoot = await resolveEffectiveProjectRoot(context?.projectRoot, context?.runId)
    if (!api?.workspaceGlob) return { ok: false, output: 'workspace_glob requires Electron' }
    try {
      const result = await api.workspaceGlob({
        pattern: String(input.pattern || ''),
        path: String(input.path || '.'),
        maxResults: Math.max(1, Math.min(1_000, Number(input.maxResults) || 200)),
      }, projectRoot)
      return {
        ok: result.ok,
        output: result.ok
          ? JSON.stringify({ files: result.files, truncated: result.truncated })
          : result.error || 'workspace_glob failed',
        data: result,
      }
    } catch (error) {
      return { ok: false, output: error instanceof Error ? error.message : String(error) }
    }
  },
})


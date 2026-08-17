/** Self-registering scoped workspace grep. */
import { register } from '../toolRegistry.ts'
import { resolveEffectiveProjectRoot } from '../runContext.ts'
import type { ToolExecutionContext } from '../toolIoHelpers.ts'

register({
  name: 'workspace_grep',
  toolset: 'workspace',
  description: 'Search text in files under the run-scoped workspace root',
  keywords: ['grep', 'search files', 'find text', 'code search', 'workspace'],
  schemaParams: {
    type: 'object',
    properties: {
      query: { type: 'string', description: 'Case-insensitive regular expression' },
      path: { type: 'string', description: 'Relative directory under workspace', default: '.' },
      glob: { type: 'string', description: 'Optional file glob, e.g. **/*.ts' },
      maxResults: { type: 'integer', description: 'Maximum matching lines (1-500)', default: 100 },
    },
    required: ['query'],
  } as Record<string, unknown>,
  owningCapability: 'workspace',
  handler: async (args, ctx) => {
    const input = args
    const context = ctx as ToolExecutionContext | undefined
    const api = window.subagents?.tools
    const projectRoot = await resolveEffectiveProjectRoot(context?.projectRoot, context?.runId)
    if (!api?.workspaceGrep) return { ok: false, output: 'workspace_grep requires Electron' }
    try {
      const result = await api.workspaceGrep({
        query: String(input.query || ''),
        path: String(input.path || '.'),
        glob: input.glob ? String(input.glob) : undefined,
        maxResults: Math.max(1, Math.min(500, Number(input.maxResults) || 100)),
      }, projectRoot)
      return {
        ok: result.ok,
        output: result.ok
          ? JSON.stringify({ matches: result.matches, files: result.files, truncated: result.truncated })
          : result.error || 'workspace_grep failed',
        data: result,
      }
    } catch (error) {
      return { ok: false, output: error instanceof Error ? error.message : String(error) }
    }
  },
})


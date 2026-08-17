/** Read a bounded region of a run-scoped spilled tool output. */
import { register } from '../toolRegistry.ts'
import type { ToolExecutionContext } from '../toolIoHelpers.ts'
import { resolveEffectiveProjectRoot } from '../runContext.ts'

register({
  name: 'tool_output_read',
  toolset: 'workspace',
  description: 'Read a bounded region of a spilled tool output for this run',
  keywords: ['tool output', 'locator', 'spill', 'offset', 'retrieve'],
  schemaParams: {
    type: 'object',
    properties: {
      locator: { type: 'string', description: 'toolspill locator returned by a previous tool' },
      offset: { type: 'integer', description: 'Byte offset', default: 0 },
      maxBytes: { type: 'integer', description: 'Maximum bytes to retrieve (1-65536)', default: 16_384 },
    },
    required: ['locator'],
  } as Record<string, unknown>,
  owningCapability: 'workspace',
  handler: async (args, ctx) => {
    const context = ctx as ToolExecutionContext | undefined
    const api = window.subagents?.tools
    const runId = context?.runId || ''
    if (!runId || !api?.toolOutputSpillRead) return { ok: false, output: 'tool_output_read requires an active Electron run' }
    try {
      const projectRoot = await resolveEffectiveProjectRoot(context?.projectRoot, runId)
      const result = await api.toolOutputSpillRead({
        locator: String(args.locator || ''),
        runId,
        projectRoot,
        offset: Math.max(0, Number(args.offset) || 0),
        maxBytes: Math.max(1, Math.min(64 * 1024, Number(args.maxBytes) || 16_384)),
      })
      return {
        ok: result.ok,
        output: result.ok
          ? `${result.output || ''}${result.nextOffset != null ? `\n\n[nextOffset=${result.nextOffset}]` : ''}`
          : result.error || 'spill read failed',
        data: result,
      }
    } catch (error) {
      return { ok: false, output: error instanceof Error ? error.message : String(error) }
    }
  },
})


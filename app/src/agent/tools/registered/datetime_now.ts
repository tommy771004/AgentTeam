/**
 * Self-registering tool module: datetime_now
 * Hermes-style import-time register(). I/O lives here (no central switch).
 */
import { register } from '../toolRegistry.ts'
import { resolveEffectiveProjectRoot } from '../runContext.ts'
import type { ToolExecutionContext } from '../toolIoHelpers.ts'

register({
  name: "datetime_now",
  toolset: "core-utils",
  description: "Get current local datetime",
  keywords: ["schedule","time","daily","cron","timestamp","clock"],
  schemaParams: {"type":"object","properties":{"timezone":{"type":"string","description":"IANA timezone (optional)"}}} as Record<string, unknown>,
  owningCapability: "core-utils",
  handler: async (args, ctx) => {
    const input = args
    const context = ctx as ToolExecutionContext | undefined
    const api = window.subagents?.tools
    const projectRoot = await resolveEffectiveProjectRoot(context?.projectRoot, context?.runId)
    const runId = context?.runId
    const threadId = context?.threadId
    try {
    const now = new Date()
    const tz = String(input.timezone || 'local')
    const output = [
      `ISO: ${now.toISOString()}`,
      `Local: ${now.toLocaleString()}`,
      `Timezone: ${tz}`,
      `Unix: ${Math.floor(now.getTime() / 1000)}`,
    ].join('\n')
    return { ok: true, output }
    } catch (e) {
      return { ok: false, output: e instanceof Error ? e.message : String(e) }
    }
  },
})

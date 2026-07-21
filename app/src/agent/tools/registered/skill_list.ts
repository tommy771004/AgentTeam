/**
 * Self-registering tool module: skill_list
 * Hermes-style import-time register(). I/O lives here (no central switch).
 */
import { register } from '../toolRegistry.ts'
import { resolveEffectiveProjectRoot } from '../runContext.ts'
import type { ToolExecutionContext } from '../toolIoHelpers.ts'

register({
  name: "skill_list",
  toolset: "skills",
  description: "List available skills (procedural memory)",
  keywords: ["skill","skills","procedure","playbook"],
  schemaParams: {"type":"object","properties":{}} as Record<string, unknown>,
  owningCapability: "skills",
  handler: async (args, ctx) => {
    const input = args
    const context = ctx as ToolExecutionContext | undefined
    const api = window.subagents?.tools
    const projectRoot = await resolveEffectiveProjectRoot(context?.projectRoot, context?.runId)
    const runId = context?.runId
    const threadId = context?.threadId
    try {
    const { skillsStore } = await import('../../hermes/skills.ts')
    const list = skillsStore.list()
    return {
      ok: true,
      output: list.map((s) => `- ${s.meta.name}: ${s.meta.description}`).join('\n') || '(empty)',
      data: list.map((s) => s.meta),
    }
    } catch (e) {
      return { ok: false, output: e instanceof Error ? e.message : String(e) }
    }
  },
})

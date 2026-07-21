/**
 * Self-registering tool module: skill_load
 * Hermes-style import-time register(). I/O lives here (no central switch).
 */
import { register } from '../toolRegistry.ts'
import { resolveEffectiveProjectRoot } from '../runContext.ts'
import type { ToolExecutionContext } from '../toolIoHelpers.ts'

register({
  name: "skill_load",
  toolset: "skills",
  description: "Load full SKILL.md content by name",
  keywords: ["skill","load skill","playbook","procedure"],
  schemaParams: {"type":"object","properties":{"name":{"type":"string","description":"Skill name"}},"required":["name"]} as Record<string, unknown>,
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
    const name = String(input.name || '')
    const skill = skillsStore.get(name)
    if (!skill) return { ok: false, output: `找不到技能：${name}` }
    return { ok: true, output: skill.raw, data: skill.meta }
    } catch (e) {
      return { ok: false, output: e instanceof Error ? e.message : String(e) }
    }
  },
})

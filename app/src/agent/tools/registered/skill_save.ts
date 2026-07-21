/**
 * Self-registering tool module: skill_save
 * Hermes-style import-time register(). I/O lives here (no central switch).
 */
import { register } from '../toolRegistry.ts'
import { resolveEffectiveProjectRoot } from '../runContext.ts'
import type { ToolExecutionContext } from '../toolIoHelpers.ts'

register({
  name: "skill_save",
  toolset: "skills",
  description: "Save or update a skill document",
  keywords: ["save skill","create skill","write skill"],
  schemaParams: {"type":"object","properties":{"name":{"type":"string"},"description":{"type":"string"},"body":{"type":"string","description":"Markdown skill body"}},"required":["name","body"]} as Record<string, unknown>,
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
    const name = String(input.name || '').trim()
    const body = String(input.body || '')
    const description = String(input.description || name).slice(0, 60)
    if (!name || !body) return { ok: false, output: 'name and body required' }
    const skill = skillsStore.save(
      {
        name,
        description,
        version: '0.1.0',
        author: 'SubAgents AI',
        createdBy: 'agent',
      },
      body,
    )
    return { ok: true, output: `已儲存技能 ${skill.meta.name}`, data: skill.meta }
    } catch (e) {
      return { ok: false, output: e instanceof Error ? e.message : String(e) }
    }
  },
})

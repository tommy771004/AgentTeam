/**
 * Self-registering tool module: design_system_read
 * Hermes-style import-time register(). I/O lives here (no central switch).
 */
import { register } from '../toolRegistry.ts'
import { resolveEffectiveProjectRoot } from '../runContext.ts'
import type { ToolExecutionContext } from '../toolIoHelpers.ts'

register({
  name: "design_system_read",
  toolset: "subdesign-workflow",
  description: "Read a selected DESIGN.md design system and return its parsed summary.",
  keywords: ["read design system","read design.md","design tokens","brand system"],
  schemaParams: {"type":"object","properties":{"id":{"type":"string","description":"project or a safe design-system id"}},"required":["id"]} as Record<string, unknown>,
  owningCapability: "subdesign-workflow",
  handler: async (args, ctx) => {
    const input = args
    const context = ctx as ToolExecutionContext | undefined
    const api = window.subagents?.tools
    const projectRoot = await resolveEffectiveProjectRoot(context?.projectRoot, context?.runId)
    const runId = context?.runId
    const threadId = context?.threadId
    try {
    const { isSafeDesignSystemId, readDesignSystem } = await import('../../subdesign/designSystem.ts')
    const id = String(input.id || '').trim()
    if (id !== 'project' && !isSafeDesignSystemId(id)) {
      return { ok: false, output: '不安全的 design system id。' }
    }
    const system = await readDesignSystem(id, projectRoot)
    if (!system) return { ok: false, output: `讀不到 design system：${id}` }
    return { ok: true, output: system.content.slice(0, 20_000), data: system }
    } catch (e) {
      return { ok: false, output: e instanceof Error ? e.message : String(e) }
    }
  },
})

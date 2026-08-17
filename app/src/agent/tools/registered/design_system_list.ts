/**
 * Self-registering tool module: design_system_list
 * Hermes-style import-time register(). I/O lives here (no central switch).
 */
import { register } from '../toolRegistry.ts'
import { resolveEffectiveProjectRoot } from '../runContext.ts'
import type { ToolExecutionContext } from '../toolIoHelpers.ts'

register({
  name: "design_system_list",
  toolset: "subdesign-workflow",
  description: "List project DESIGN.md and SubDesign design systems.",
  keywords: ["design system list","design systems","design.md","brand rules","tokens"],
  schemaParams: {"type":"object","properties":{}} as Record<string, unknown>,
  owningCapability: "subdesign-workflow",
  handler: async (args, ctx) => {
    const input = args
    const context = ctx as ToolExecutionContext | undefined
    const api = window.subagents?.tools
    const projectRoot = await resolveEffectiveProjectRoot(context?.projectRoot, context?.runId)
    const runId = context?.runId
    const threadId = context?.threadId
    try {
    const { scanDesignSystems } = await import('../../subdesign/designSystem.ts')
    const systems = await scanDesignSystems(projectRoot)
    const { useSubDesignStore } = await import('../../../store/subDesignStore.ts')
    useSubDesignStore.getState().setSystems(systems)
    return {
      ok: true,
      output: systems.length
        ? systems.map((system) => `${system.id}: ${system.title} · ${system.colors.join(', ') || 'no swatches'}`).join('\n')
        : '尚未找到 DESIGN.md 或 .subagents/subdesign/design-systems/*。',
      data: systems,
    }
    } catch (e) {
      return { ok: false, output: e instanceof Error ? e.message : String(e) }
    }
  },
})

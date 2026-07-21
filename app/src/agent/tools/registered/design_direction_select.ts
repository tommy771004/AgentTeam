/**
 * Self-registering tool module: design_direction_select
 * Hermes-style import-time register(). I/O lives here (no central switch).
 */
import { register } from '../toolRegistry.ts'
import { resolveEffectiveProjectRoot } from '../runContext.ts'
import type { ToolExecutionContext } from '../toolIoHelpers.ts'

register({
  name: "design_direction_select",
  toolset: "subdesign-workflow",
  description: "Record the user-selected SubDesign direction and unlock Build stage.",
  keywords: ["design direction","select direction","direction selected","choose direction","design choice"],
  schemaParams: {"type":"object","properties":{"briefId":{"type":"string"},"directionId":{"type":"string"},"title":{"type":"string","description":"Required only when creating a direction card inline"},"summary":{"type":"string"},"rationale":{"type":"string"},"risk":{"type":"string"}},"required":["directionId"]} as Record<string, unknown>,
  owningCapability: "subdesign-workflow",
  handler: async (args, ctx) => {
    const input = args
    const context = ctx as ToolExecutionContext | undefined
    const api = window.subagents?.tools
    const projectRoot = await resolveEffectiveProjectRoot(context?.projectRoot, context?.runId)
    const runId = context?.runId
    const threadId = context?.threadId
    try {
    const { useSubDesignStore } = await import('../../../store/subDesignStore')
    const briefId = String(input.briefId || '').trim()
    const linked = briefId
      ? useSubDesignStore.getState().findById(briefId)
      : threadId
        ? useSubDesignStore.getState().findByThreadId(threadId)
        : null
    if (!linked) return { ok: false, output: '找不到與目前 thread 關聯的 SubDesign brief。' }
    const result = useSubDesignStore.getState().selectDirection(linked.id, String(input.directionId || ''), {
      title: input.title ? String(input.title) : undefined,
      summary: input.summary ? String(input.summary) : undefined,
      rationale: input.rationale ? String(input.rationale) : undefined,
      risk: input.risk ? String(input.risk) : undefined,
    }, projectRoot)
    if (!result.ok) return { ok: false, output: result.error, data: linked }
    return {
      ok: true,
      output: `Direction「${result.brief.selectedDirectionId}」已選定；Build stage 已解鎖。`,
      data: result.brief,
    }
    } catch (e) {
      return { ok: false, output: e instanceof Error ? e.message : String(e) }
    }
  },
})

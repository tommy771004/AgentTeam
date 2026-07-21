/**
 * Self-registering tool module: design_brief_update
 * Hermes-style import-time register(). I/O lives here (no central switch).
 */
import { register } from '../toolRegistry.ts'
import { resolveEffectiveProjectRoot } from '../runContext.ts'
import type { ToolExecutionContext } from '../toolIoHelpers.ts'

register({
  name: "design_brief_update",
  toolset: "subdesign-workflow",
  description: "Update the linked SubDesign brief metadata, direction cards, or stage.",
  keywords: ["subdesign","design brief","design brief update","audience","constraints","acceptance criteria","direction cards"],
  schemaParams: {"type":"object","properties":{"briefId":{"type":"string","description":"Linked SubDesign brief id (optional in a linked thread)"},"objective":{"type":"string"},"audience":{"type":"string"},"platform":{"type":"string","enum":["responsive","web-desktop","mobile-ios","desktop-app"]},"fidelity":{"type":"string","enum":["wireframe","high-fidelity"]},"designSystemId":{"type":"string"},"constraints":{"type":"array","items":{"type":"string"}},"acceptanceCriteria":{"type":"array","items":{"type":"string"}},"directions":{"type":"array","maxItems":3,"items":{"type":"object","properties":{"id":{"type":"string"},"title":{"type":"string"},"summary":{"type":"string"},"rationale":{"type":"string"},"risk":{"type":"string"}},"required":["title","summary"]}},"stage":{"type":"string","enum":["brief","direction","build","critique","deliver"]}}} as Record<string, unknown>,
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
    const patch: Record<string, unknown> = {}
    for (const key of [
      'objective',
      'audience',
      'platform',
      'fidelity',
      'designSystemId',
      'constraints',
      'acceptanceCriteria',
      'directions',
      'references',
    ]) {
      if (Object.prototype.hasOwnProperty.call(input, key)) patch[key] = input[key]
    }
    const updated = useSubDesignStore.getState().updateBrief(linked.id, patch, projectRoot)
    if (!updated) return { ok: false, output: 'brief 更新失敗。' }
    let finalBrief = updated
    if (input.stage) {
      const stageResult = useSubDesignStore.getState().setStage(linked.id, String(input.stage) as never, projectRoot)
      if (!stageResult.ok) return { ok: false, output: stageResult.error, data: updated }
      finalBrief = stageResult.brief
    }
    return {
      ok: true,
      output: `SubDesign brief 已更新：stage=${finalBrief.stage} · direction=${finalBrief.selectedDirectionId || '未選定'}`,
      data: finalBrief,
    }
    } catch (e) {
      return { ok: false, output: e instanceof Error ? e.message : String(e) }
    }
  },
})

/**
 * Self-registering tool module: design_gate_contrast
 * Critique verification gate（ADR-0048）：對 artifact 執行 state-aware WCAG
 * 對比量測，產生 attested gate evidence。Gate 沒跑，critique 不得宣稱分數。
 */
import { register } from '../toolRegistry.ts'
import { resolveEffectiveProjectRoot } from '../runContext.ts'
import type { ToolExecutionContext } from '../toolIoHelpers.ts'

register({
  name: "design_gate_contrast",
  toolset: "subdesign-workflow",
  description: "Run the state-aware WCAG contrast verification gate against the registered artifact and create attested gate evidence.",
  keywords: ["contrast gate","wcag contrast","accessibility gate","verification gate","對比度檢查"],
  schemaParams: {"type":"object","properties":{"artifactId":{"type":"string","description":"Registered SubDesign artifact id"}},"required":["artifactId"]} as Record<string, unknown>,
  owningCapability: "subdesign-workflow",
  handler: async (args, ctx) => {
    const input = args
    const context = ctx as ToolExecutionContext | undefined
    const api = window.subagents?.subdesign
    const projectRoot = await resolveEffectiveProjectRoot(context?.projectRoot, context?.runId)
    try {
      const { useSubDesignArtifactStore } = await import('../../../store/subDesignArtifactStore.ts')
      const artifactId = String(input.artifactId || '').trim()
      const artifact = useSubDesignArtifactStore.getState().findById(artifactId)
      if (!artifact) return { ok: false, output: `找不到 artifact：${artifactId}` }
      if (!api?.contrastGate) return { ok: false, output: 'contrast gate 需要 Electron desktop。' }
      const result = await api.contrastGate({ artifact, projectRoot })
      if (!result.ok || !result.evidence) return { ok: false, output: result.error || 'contrast gate 執行失敗。', data: result }
      const evidence = result.evidence as Record<string, unknown>
      const passed = evidence.passed === true
      return {
        ok: true,
        output: `${String(evidence.summary || '')}\n請把這筆 attested gate evidence 原封不動併入 design_critique 的 evidence（kind=gate、gateId=contrast、passed=${passed}、sha256 與 path 不可改）。`,
        data: { ...result, evidence },
      }
    } catch (e) {
      return { ok: false, output: e instanceof Error ? e.message : String(e) }
    }
  },
})

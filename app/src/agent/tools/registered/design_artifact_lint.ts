/**
 * Self-registering tool module: design_artifact_lint
 * Hermes-style import-time register(). I/O lives here (no central switch).
 */
import { register } from '../toolRegistry.ts'
import { resolveEffectiveProjectRoot } from '../runContext.ts'
import type { ToolExecutionContext } from '../toolIoHelpers.ts'

register({
  name: "design_artifact_lint",
  toolset: "subdesign-workflow",
  description: "Run deterministic semantic lint against the registered artifact and create attested lint evidence.",
  keywords: ["artifact lint","semantic lint","accessibility lint","evidence lint","語意檢查"],
  schemaParams: {"type":"object","properties":{"artifactId":{"type":"string","description":"Registered SubDesign artifact id"}},"required":["artifactId"]} as Record<string, unknown>,
  owningCapability: "subdesign-workflow",
  handler: async (args, ctx) => {
    const input = args
    const context = ctx as ToolExecutionContext | undefined
    const api = window.subagents?.tools
    const projectRoot = await resolveEffectiveProjectRoot(context?.projectRoot, context?.runId)
    const runId = context?.runId
    const threadId = context?.threadId
    try {
    const { useSubDesignArtifactStore } = await import('../../../store/subDesignArtifactStore')
    const artifactId = String(input.artifactId || '').trim()
    const artifact = useSubDesignArtifactStore.getState().findById(artifactId)
    if (!artifact) return { ok: false, output: `找不到 artifact：${artifactId}` }
    const lint = window.subagents?.subdesign?.lintEvidence
    if (!lint) return { ok: false, output: 'artifact semantic lint 需要 Electron desktop。' }
    const result = await lint({ artifact, projectRoot })
    if (!result.ok || !result.evidence) return { ok: false, output: result.error || 'artifact semantic lint 失敗。', data: result }
    const evidence = result.evidence as Record<string, unknown>
    return { ok: true, output: `已產生 lint evidence：${String(evidence.path || '')}`, data: { ...result, evidence } }
    } catch (e) {
      return { ok: false, output: e instanceof Error ? e.message : String(e) }
    }
  },
})

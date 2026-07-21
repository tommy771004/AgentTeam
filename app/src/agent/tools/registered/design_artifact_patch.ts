/**
 * Self-registering tool module: design_artifact_patch
 * Hermes-style import-time register(). I/O lives here (no central switch).
 */
import { register } from '../toolRegistry.ts'
import { resolveEffectiveProjectRoot } from '../runContext.ts'
import type { ToolExecutionContext } from '../toolIoHelpers.ts'

register({
  name: "design_artifact_patch",
  toolset: "subdesign-workflow",
  description: "Apply a bounded in-place text patch to an already registered SubDesign artifact file.",
  keywords: ["artifact patch","tweak artifact","edit artifact","in place","原地調整","微調"],
  schemaParams: {"type":"object","properties":{"artifactId":{"type":"string","description":"Registered SubDesign artifact id"},"operations":{"type":"array","maxItems":12,"description":"Exact bounded replacements. Paths must already belong to the artifact.","items":{"type":"object","properties":{"path":{"type":"string","description":"Existing artifact entry or supporting file"},"find":{"type":"string","description":"Exact text to replace"},"replace":{"type":"string","description":"Replacement text"},"expectedMatches":{"type":"integer","minimum":1,"maximum":12,"default":1}},"required":["path","find","replace"]}}},"required":["artifactId","operations"]} as Record<string, unknown>,
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
    const { useSubDesignStore } = await import('../../../store/subDesignStore')
    const artifactId = String(input.artifactId || '').trim()
    const artifact = useSubDesignArtifactStore.getState().findById(artifactId)
    if (!artifact) return { ok: false, output: `找不到 artifact：${artifactId}` }
    const patchApi = window.subagents?.subdesign?.patchArtifact
    if (!patchApi) return { ok: false, output: 'artifact patch 需要 Electron workspace API。' }
    const operations = Array.isArray(input.operations) ? input.operations.slice(0, 12) : []
    if (!operations.length) return { ok: false, output: 'operations 必須至少包含一個 exact replacement。' }
    const result = await patchApi({ artifact, operations, projectRoot })
    if (!result.ok || !result.artifact) return { ok: false, output: result.error || 'artifact patch 失敗。', data: result }
    const updated = useSubDesignArtifactStore.getState().register(result.artifact, {
      briefId: artifact.briefId,
      designSystemId: artifact.designSystemId,
    }, projectRoot)
    if (!updated.ok) return { ok: false, output: `patch revision invalid：${updated.errors.join('；')}` }
    const linkedBrief = useSubDesignStore.getState().findById(artifact.briefId)
    if (linkedBrief && linkedBrief.stage !== 'critique') useSubDesignStore.getState().setStage(linkedBrief.id, 'critique', projectRoot)
    return {
      ok: true,
      output: `Artifact「${artifact.title}」已原地調整（revision ${updated.artifact.revision}）→ ${(result.paths || []).join(', ')}`,
      data: { artifact: updated.artifact, paths: result.paths || [], operationCount: result.operationCount || operations.length },
    }
    } catch (e) {
      return { ok: false, output: e instanceof Error ? e.message : String(e) }
    }
  },
})

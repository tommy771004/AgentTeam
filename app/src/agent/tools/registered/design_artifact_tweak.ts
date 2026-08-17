/**
 * Self-registering tool module: design_artifact_tweak
 * Hermes-style import-time register(). I/O lives here (no central switch).
 */
import { register } from '../toolRegistry.ts'
import { resolveEffectiveProjectRoot } from '../runContext.ts'
import type { ToolExecutionContext } from '../toolIoHelpers.ts'

register({
  name: "design_artifact_tweak",
  toolset: "subdesign-workflow",
  description: "Apply one declared structured live-control tweak to an already registered artifact.",
  keywords: ["artifact tweak","structured tweak","live tweak","parameter","color control","即時調參"],
  schemaParams: {"type":"object","properties":{"artifactId":{"type":"string","description":"Registered SubDesign artifact id"},"tweakId":{"type":"string","description":"Declared structured tweak id"},"value":{"type":"string","description":"New value; validated against the tweak kind and bounds"}},"required":["artifactId","tweakId","value"]} as Record<string, unknown>,
  owningCapability: "subdesign-workflow",
  handler: async (args, ctx) => {
    const input = args
    const context = ctx as ToolExecutionContext | undefined
    const api = window.subagents?.tools
    const projectRoot = await resolveEffectiveProjectRoot(context?.projectRoot, context?.runId)
    const runId = context?.runId
    const threadId = context?.threadId
    try {
    const { useSubDesignArtifactStore } = await import('../../../store/subDesignArtifactStore.ts')
    const { useSubDesignStore } = await import('../../../store/subDesignStore.ts')
    const artifactId = String(input.artifactId || '').trim()
    const artifact = useSubDesignArtifactStore.getState().findById(artifactId)
    if (!artifact) return { ok: false, output: `找不到 artifact：${artifactId}` }
    const applyTweak = window.subagents?.subdesign?.applyTweak
    if (!applyTweak) return { ok: false, output: 'structured artifact tweak 需要 Electron workspace API。' }
    const result = await applyTweak({ artifact, tweakId: String(input.tweakId || ''), value: String(input.value ?? ''), projectRoot })
    if (!result.ok || !result.artifact) return { ok: false, output: result.error || 'structured tweak 失敗。', data: result }
    const updated = useSubDesignArtifactStore.getState().register(result.artifact, { briefId: artifact.briefId, designSystemId: artifact.designSystemId }, projectRoot)
    if (!updated.ok) return { ok: false, output: `tweak revision invalid：${updated.errors.join('；')}` }
    const brief = useSubDesignStore.getState().findById(artifact.briefId)
    if (brief && brief.stage !== 'critique') useSubDesignStore.getState().setStage(brief.id, 'critique', projectRoot)
    return { ok: true, output: `Artifact「${artifact.title}」已套用 structured tweak（revision ${updated.artifact.revision}）。`, data: { artifact: updated.artifact, paths: result.paths || [], operationCount: result.operationCount || 1 } }
    } catch (e) {
      return { ok: false, output: e instanceof Error ? e.message : String(e) }
    }
  },
})

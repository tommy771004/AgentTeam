/**
 * Self-registering tool module: design_artifact_export
 * Hermes-style import-time register(). I/O lives here (no central switch).
 */
import { register } from '../toolRegistry.ts'
import { resolveEffectiveProjectRoot } from '../runContext.ts'
import type { ToolExecutionContext } from '../toolIoHelpers.ts'

register({
  name: "design_artifact_export",
  toolset: "subdesign-workflow",
  description: "Export a validated SubDesign artifact as HTML, PDF, PPTX, MP4, or ZIP after user approval.",
  keywords: ["export artifact","export design","download prototype","pdf","pptx","mp4","zip","deliver artifact"],
  schemaParams: {"type":"object","properties":{"artifactId":{"type":"string","description":"Registered SubDesign artifact id"},"format":{"type":"string","enum":["html","pdf","zip","pptx","mp4"]},"briefId":{"type":"string"}},"required":["artifactId","format"]} as Record<string, unknown>,
  owningCapability: "subdesign-workflow",
  handler: async (args, ctx) => {
    const input = args
    const context = ctx as ToolExecutionContext | undefined
    const api = window.subagents?.tools
    const projectRoot = await resolveEffectiveProjectRoot(context?.projectRoot, context?.runId)
    const runId = context?.runId
    const threadId = context?.threadId
    try {
    const { critiqueAllowsDeliver } = await import('../../subdesign/critique.ts')
    const { useSubDesignArtifactStore } = await import('../../../store/subDesignArtifactStore.ts')
    const { useSubDesignCritiqueStore } = await import('../../../store/subDesignCritiqueStore.ts')
    const artifactId = String(input.artifactId || '').trim()
    const format = String(input.format || '').trim() as 'html' | 'zip' | 'pdf' | 'pptx' | 'mp4'
    if (!artifactId || !['html', 'zip', 'pdf', 'pptx', 'mp4'].includes(format)) {
      return { ok: false, output: 'artifactId / format 不合法。' }
    }
    const artifact = useSubDesignArtifactStore.getState().findById(artifactId)
    if (!artifact) return { ok: false, output: `找不到 artifact：${artifactId}` }
    if (!artifact.exports.includes(format)) return { ok: false, output: `artifact 不支援 ${format} export。` }
    const critique = useSubDesignCritiqueStore.getState().latestForArtifact(artifact.id, artifact.revision)
    if (!critique || !critiqueAllowsDeliver(critique)) {
      return { ok: false, output: 'Artifact 尚未通過 critique；請先修正 blocker / needs-revision findings。' }
    }
    const verifyEvidence = window.subagents?.subdesign?.verifyEvidence
    if (verifyEvidence) {
      const evidenceCheck = await verifyEvidence({ artifact, evidence: critique.evidence, projectRoot })
      if (!evidenceCheck.ok) return { ok: false, output: `Evidence 未通過 main process 驗證：${evidenceCheck.errors?.join('；') || '請重新 capture screenshot / DOM / lint evidence。'}` }
    }
    const exportApi = window.subagents?.subdesign
    if (!exportApi?.exportArtifact) return { ok: false, output: 'artifact export 需要 Electron desktop。' }
    const result = await exportApi.exportArtifact({
      artifact,
      critique,
      format,
      projectRoot,
      suggestedName: artifact.title,
    })
    if (!result.ok) {
      return {
        ok: false,
        output: result.cancelled ? '使用者取消 export。' : result.error || 'artifact export 失敗。',
        data: result,
      }
    }
    const { useSubDesignExportStore } = await import('../../../store/subDesignExportStore.ts')
    const record = useSubDesignExportStore.getState().record({
      artifactId: artifact.id,
      revision: result.revision || artifact.revision,
      format,
      path: result.path || '',
      bytes: result.bytes || 0,
      sha256: result.sha256 || '',
      projectRoot: projectRoot || undefined,
    })
    return {
      ok: true,
      output: `Artifact 已 export：${format} · revision ${record.revision} · ${record.path} · sha256 ${record.sha256}`,
      data: record,
    }
    } catch (e) {
      return { ok: false, output: e instanceof Error ? e.message : String(e) }
    }
  },
})

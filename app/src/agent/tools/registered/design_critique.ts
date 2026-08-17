/**
 * Self-registering tool module: design_critique
 * Hermes-style import-time register(). I/O lives here (no central switch).
 */
import { register } from '../toolRegistry.ts'
import { resolveEffectiveProjectRoot } from '../runContext.ts'
import type { ToolExecutionContext } from '../toolIoHelpers.ts'

register({
  name: "design_critique",
  toolset: "subdesign-workflow",
  description: "Record a structured read-only critique for a SubDesign artifact.",
  keywords: ["design critique","critique artifact","accessibility review","brand conformance","brief coverage","verdict"],
  schemaParams: {"type":"object","properties":{"critique":{"type":"object","properties":{"artifactId":{"type":"string"},"briefId":{"type":"string"},"briefCoverage":{"type":"integer","minimum":0,"maximum":100},"brandConformance":{"type":"integer","minimum":0,"maximum":100},"accessibility":{"type":"integer","minimum":0,"maximum":100},"implementationReadiness":{"type":"integer","minimum":0,"maximum":100},"evidence":{"type":"array","maxItems":30,"description":"Required evidence for delivery: screenshot, dom, and lint entries.","items":{"type":"object","properties":{"kind":{"type":"string","enum":["screenshot","dom","lint","build","manual","template-attribution","design-system","asset-license"]},"summary":{"type":"string"},"path":{"type":"string"},"capturedAt":{"type":"string"}},"required":["kind","summary"]}},"findings":{"type":"array","maxItems":40,"items":{"type":"object","properties":{"severity":{"type":"string","enum":["blocker","warning","note"]},"message":{"type":"string"},"path":{"type":"string"}},"required":["severity","message"]}},"verdict":{"type":"string","enum":["pass","needs-revision"]}},"required":["artifactId","briefCoverage","brandConformance","accessibility","implementationReadiness","evidence","findings","verdict"]}},"required":["critique"]} as Record<string, unknown>,
  owningCapability: "subdesign-workflow",
  handler: async (args, ctx) => {
    const input = args
    const context = ctx as ToolExecutionContext | undefined
    const api = window.subagents?.tools
    const projectRoot = await resolveEffectiveProjectRoot(context?.projectRoot, context?.runId)
    const runId = context?.runId
    const threadId = context?.threadId
    try {
    const { useSettingsStore } = await import('../../../store/settingsStore.ts')
    const { critiqueAllowsDeliver } = await import('../../subdesign/critique.ts')
    const { useSubDesignArtifactStore } = await import('../../../store/subDesignArtifactStore.ts')
    const { useSubDesignCritiqueStore } = await import('../../../store/subDesignCritiqueStore.ts')
    const { useSubDesignCritiqueSessionStore } = await import('../../../store/subDesignCritiqueSessionStore.ts')
    const { useSubDesignStore } = await import('../../../store/subDesignStore.ts')
    const rawCritique = input.critique && typeof input.critique === 'object'
      ? { ...(input.critique as Record<string, unknown>) }
      : null
    if (!rawCritique) return { ok: false, output: 'critique 必須是 object。' }
    const artifactId = String(rawCritique.artifactId || '').trim()
    const artifact = useSubDesignArtifactStore.getState().findById(artifactId)
    if (!artifact) return { ok: false, output: `找不到 artifact：${artifactId}` }
    const linked = threadId ? useSubDesignStore.getState().findByThreadId(threadId) : null
    const briefId = String(rawCritique.briefId || linked?.id || artifact.briefId).trim()
    if (linked && briefId !== linked.id) return { ok: false, output: 'critique briefId 與目前 thread 不一致。' }
    rawCritique.briefId = briefId
    const verifyEvidence = window.subagents?.subdesign?.verifyEvidence
    if (verifyEvidence) {
      const evidenceCheck = await verifyEvidence({ artifact, evidence: rawCritique.evidence, projectRoot })
      if (!evidenceCheck.ok) {
        const findings = Array.isArray(rawCritique.findings) ? [...rawCritique.findings] : []
        findings.push({
          severity: 'blocker',
          message: `Evidence 未通過 main process 驗證：${evidenceCheck.errors?.join('；') || '檔案不存在、路徑不被允許或已過期。'}`,
          path: '.subagents/subdesign/critiques',
        })
        rawCritique.findings = findings
        rawCritique.verdict = 'needs-revision'
      }
    }
    const theaterStore = useSubDesignCritiqueSessionStore.getState()
    const theaterSession = theaterStore.current
    const isTheaterFinal = theaterSession?.status === 'running' && theaterSession.artifactId === artifactId
    if (isTheaterFinal && !theaterStore.claimFinalCritique(artifactId)) {
      return { ok: false, output: 'Critique Theater 尚未完成兩輪六個 panelist notes，或 final design_critique 已經被另一個 call 鎖定。' }
    }
    const result = useSubDesignCritiqueStore.getState().record(rawCritique, { briefId }, projectRoot)
    if (!result.ok) {
      if (isTheaterFinal) useSubDesignCritiqueSessionStore.getState().releaseFinalCritique(artifactId)
      return { ok: false, output: `critique invalid：${result.errors.join('；')}` }
    }
    const nextStage = critiqueAllowsDeliver(result.critique) ? 'deliver' : 'critique'
    const brief = useSubDesignStore.getState().findById(briefId)
    const stageResult = brief ? useSubDesignStore.getState().setStage(brief.id, nextStage, projectRoot) : null
    if (result.critique.verdict === 'pass' && brief) {
      const { learningLoop } = await import('../../hermes/learning.ts')
      learningLoop.onSubDesignPass({
        projectRoot,
        surface: brief.surface,
        platform: brief.platform,
        designSystemId: brief.designSystemId,
        templateId: brief.templateId,
        selectedDirectionId: brief.selectedDirectionId,
        memoryEnabled: useSettingsStore.getState().settings.memoryEnabled,
        memoryWriteEnabled: useSettingsStore.getState().settings.memoryWriteEnabled,
      })
    }
    return {
      ok: true,
      output: `Critique ${result.critique.verdict}（revision ${result.critique.revision}） · stage=${stageResult?.ok ? stageResult.brief.stage : nextStage}`,
      data: result.critique,
    }
    } catch (e) {
      return { ok: false, output: e instanceof Error ? e.message : String(e) }
    }
  },
})

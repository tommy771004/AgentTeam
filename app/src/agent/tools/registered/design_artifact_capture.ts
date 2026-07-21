/**
 * Self-registering tool module: design_artifact_capture
 * Hermes-style import-time register(). I/O lives here (no central switch).
 */
import { register } from '../toolRegistry.ts'
import { resolveEffectiveProjectRoot } from '../runContext.ts'
import type { ToolExecutionContext } from '../toolIoHelpers.ts'

register({
  name: "design_artifact_capture",
  toolset: "subdesign-workflow",
  description: "Capture a sandboxed screenshot or DOM snapshot for a registered SubDesign artifact.",
  keywords: ["artifact screenshot","capture artifact","DOM evidence","screenshot evidence","截圖","證據"],
  schemaParams: {"type":"object","properties":{"artifactId":{"type":"string","description":"Registered SubDesign artifact id"},"kind":{"type":"string","enum":["screenshot","dom"]},"viewport":{"type":"object","properties":{"width":{"type":"integer","minimum":320,"maximum":2400,"default":1440},"height":{"type":"integer","minimum":240,"maximum":1800,"default":900}}}},"required":["artifactId","kind"]} as Record<string, unknown>,
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
    const kind = input.kind === 'dom' ? 'dom' : input.kind === 'screenshot' ? 'screenshot' : ''
    const artifact = useSubDesignArtifactStore.getState().findById(artifactId)
    if (!artifact) return { ok: false, output: `找不到 artifact：${artifactId}` }
    if (!kind) return { ok: false, output: 'capture kind 必須是 screenshot 或 dom。' }
    const capture = window.subagents?.subdesign?.captureEvidence
    if (!capture) return { ok: false, output: 'artifact evidence capture 需要 Electron desktop。' }
    const rawViewport = input.viewport && typeof input.viewport === 'object' ? input.viewport as Record<string, unknown> : {}
    const result = await capture({
      artifact,
      kind,
      viewport: {
        width: Math.max(320, Math.min(2400, Math.floor(Number(rawViewport.width) || 1440))),
        height: Math.max(240, Math.min(1800, Math.floor(Number(rawViewport.height) || 900))),
      },
      projectRoot,
    })
    if (!result.ok || !result.path) return { ok: false, output: result.error || 'artifact evidence capture 失敗。', data: result }
    const evidence = {
      kind,
      summary: kind === 'screenshot' ? 'Electron sandbox capture of the registered artifact.' : 'Electron sandbox DOM snapshot of the registered artifact.',
      path: result.path,
      capturedAt: result.capturedAt || new Date().toISOString(),
      evidenceId: result.evidenceId,
      sha256: result.sha256,
      source: result.source,
      artifactId: result.artifactId,
      revision: result.revision,
    }
    return { ok: true, output: `已產生 ${kind} evidence：${result.path}`, data: { ...result, evidence } }
    } catch (e) {
      return { ok: false, output: e instanceof Error ? e.message : String(e) }
    }
  },
})

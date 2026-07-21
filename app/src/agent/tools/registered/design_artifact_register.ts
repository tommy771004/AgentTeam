/**
 * Self-registering tool module: design_artifact_register
 * Hermes-style import-time register(). I/O lives here (no central switch).
 */
import { register } from '../toolRegistry.ts'
import { resolveEffectiveProjectRoot } from '../runContext.ts'
import type { ToolExecutionContext } from '../toolIoHelpers.ts'

register({
  name: "design_artifact_register",
  toolset: "subdesign-workflow",
  description: "Register a validated project-relative SubDesign artifact manifest for preview and revision tracking.",
  keywords: ["artifact manifest","register artifact","preview artifact","design output","revision"],
  schemaParams: {"type":"object","properties":{"manifest":{"type":"object","description":"Artifact manifest. entry and supportingFiles are project-relative only.","properties":{"id":{"type":"string"},"briefId":{"type":"string"},"kind":{"type":"string","enum":["html","deck","react-component","markdown-document","svg","design-system"]},"title":{"type":"string"},"entry":{"type":"string"},"renderer":{"type":"string","enum":["html","deck-html","markdown","svg","code","design-system"]},"exports":{"type":"array","items":{"type":"string","enum":["html","pdf","zip","pptx","mp4","jsx","md","svg","txt"]}},"supportingFiles":{"type":"array","items":{"type":"string"}},"tweaks":{"type":"array","maxItems":32,"description":"Structured live controls. replaceTemplate must contain literal {{value}}.","items":{"type":"object","properties":{"id":{"type":"string"},"label":{"type":"string"},"kind":{"type":"string","enum":["color","text","number","select","boolean"]},"path":{"type":"string"},"find":{"type":"string"},"replaceTemplate":{"type":"string"},"value":{"type":"string"},"defaultValue":{"type":"string"},"min":{"type":"number"},"max":{"type":"number"},"step":{"type":"number"},"options":{"type":"array","items":{"type":"string"}}},"required":["id","label","kind","path","find","replaceTemplate"]}},"designSystemId":{"type":"string"},"status":{"type":"string","enum":["streaming","complete","error"]},"revision":{"type":"integer"}},"required":["id","kind","title","entry","renderer"]},"briefId":{"type":"string","description":"Optional when the thread is linked to a brief."}},"required":["manifest"]} as Record<string, unknown>,
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
    const { useSubDesignArtifactStore } = await import('../../../store/subDesignArtifactStore')
    const linked = threadId ? useSubDesignStore.getState().findByThreadId(threadId) : null
    const rawManifest = input.manifest && typeof input.manifest === 'object'
      ? { ...(input.manifest as Record<string, unknown>) }
      : null
    if (!rawManifest) return { ok: false, output: 'manifest 必須是 object。' }
    const briefId = String(input.briefId || rawManifest.briefId || linked?.id || '').trim()
    if (!briefId) return { ok: false, output: '找不到 SubDesign brief，不能登記 artifact。' }
    if (linked && briefId !== linked.id) {
      return { ok: false, output: 'artifact briefId 與目前 thread 不一致。' }
    }
    rawManifest.briefId = briefId
    if (!rawManifest.designSystemId && linked?.designSystemId) rawManifest.designSystemId = linked.designSystemId
    const result = useSubDesignArtifactStore.getState().register(rawManifest, {
      briefId,
      designSystemId: linked?.designSystemId,
    }, projectRoot)
    if (!result.ok) return { ok: false, output: `artifact manifest invalid：${result.errors.join('；')}` }
    return {
      ok: true,
      output: `Artifact「${result.artifact.title}」已登記（revision ${result.artifact.revision}）→ ${result.artifact.entry}`,
      data: result.artifact,
    }
    } catch (e) {
      return { ok: false, output: e instanceof Error ? e.message : String(e) }
    }
  },
})

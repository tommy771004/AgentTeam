/**
 * Self-registering tool module: design_critique_note
 * Hermes-style import-time register(). I/O lives here (no central switch).
 */
import { register } from '../toolRegistry.ts'
import { resolveEffectiveProjectRoot } from '../runContext.ts'
import type { ToolExecutionContext } from '../toolIoHelpers.ts'

register({
  name: "design_critique_note",
  toolset: "subdesign-workflow",
  description: "Record one panelist-focused critique note (visual/brand, accessibility, or implementation readiness) during a Critique Theater round.",
  keywords: ["critique panelist","critique round","panelist note","visual review","accessibility review","implementation readiness","cross-check"],
  schemaParams: {"type":"object","properties":{"artifactId":{"type":"string","description":"Registered SubDesign artifact id"},"panelistId":{"type":"string","enum":["visual","accessibility","implementation"],"description":"Which panelist focus this note represents"},"round":{"type":"integer","enum":[1,2],"description":"1 = independent review, 2 = cross-check of round-1 blockers"},"score":{"type":"integer","minimum":0,"maximum":100,"description":"This panelist's focused 0-100 score for this round"},"summary":{"type":"string","description":"One or two sentence assessment specific to this panelist focus; must differ in reasoning from the other panelists, not restate the same text"},"findings":{"type":"array","maxItems":20,"items":{"type":"object","properties":{"severity":{"type":"string","enum":["blocker","warning","note"]},"message":{"type":"string"},"path":{"type":"string"}},"required":["severity","message"]}},"evidence":{"type":"array","maxItems":10,"description":"Evidence this panelist relied on (screenshot/dom/lint); round 2 or the final design_critique call may reuse the same entries.","items":{"type":"object","properties":{"kind":{"type":"string","enum":["screenshot","dom","lint","build","manual","template-attribution","asset-license","gate"]},"summary":{"type":"string"},"path":{"type":"string"},"capturedAt":{"type":"string"}},"required":["kind","summary"]}}},"required":["artifactId","panelistId","round","score","summary"]} as Record<string, unknown>,
  owningCapability: "subdesign-workflow",
  handler: async (args, ctx) => {
    const input = args
    const context = ctx as ToolExecutionContext | undefined
    const api = window.subagents?.tools
    const projectRoot = await resolveEffectiveProjectRoot(context?.projectRoot, context?.runId)
    const runId = context?.runId
    const threadId = context?.threadId
    try {
    const { useSubDesignCritiqueSessionStore } = await import('../../../store/subDesignCritiqueSessionStore.ts')
    const artifactId = String(input.artifactId || '').trim()
    const panelistId = input.panelistId
    if (!['visual', 'accessibility', 'implementation'].includes(String(panelistId))) {
      return { ok: false, output: 'panelistId 必須是 visual、accessibility 或 implementation。' }
    }
    const round = Number(input.round) === 2 ? 2 : Number(input.round) === 1 ? 1 : 0
    if (!round) return { ok: false, output: 'round 必須是 1 或 2。' }
    const recorded = useSubDesignCritiqueSessionStore.getState().recordPanelistNote(artifactId, {
      round,
      panelistId: panelistId as 'visual' | 'accessibility' | 'implementation',
      score: input.score,
      summary: input.summary,
      findings: input.findings,
      evidence: input.evidence,
    })
    if (!recorded) return { ok: false, output: '沒有進行中的 Critique Theater session 符合這個 artifactId，或 summary 為空。' }
    return { ok: true, output: `已記錄 ${panelistId} panelist round ${round} 的獨立審查結果。` }
    } catch (e) {
      return { ok: false, output: e instanceof Error ? e.message : String(e) }
    }
  },
})

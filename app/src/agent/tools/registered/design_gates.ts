/**
 * Self-registering tool modules: design_gate_* batch（console-error /
 * build-success / responsive-overflow / token-consistency）。
 * 每個 gate 都是 deterministic verification gate（ADR-0048）：產出 attested
 * gate evidence，critique 分數必須引用它們才能 pass。
 */
import { register } from '../toolRegistry.ts'
import { resolveEffectiveProjectRoot } from '../runContext.ts'
import type { ToolExecutionContext } from '../toolIoHelpers.ts'

type GateSpec = {
  toolName: string
  apiName: 'consoleErrorGate' | 'buildSuccessGate' | 'responsiveOverflowGate' | 'tokenConsistencyGate'
  description: string
  keywords: string[]
}

const GATES: GateSpec[] = [
  {
    toolName: 'design_gate_console_error',
    apiName: 'consoleErrorGate',
    description: 'Load the artifact and collect console errors during render as attested gate evidence.',
    keywords: ["console errors","runtime errors","verification gate","執行期錯誤"],
  },
  {
    toolName: 'design_gate_build_success',
    apiName: 'buildSuccessGate',
    description: 'Verify the artifact entry builds/loads with complete structure and produce attested gate evidence.',
    keywords: ["build success","structure gate","建構驗證"],
  },
  {
    toolName: 'design_gate_responsive_overflow',
    apiName: 'responsiveOverflowGate',
    description: 'Render the artifact at narrow viewports and detect horizontal overflow, producing attested gate evidence.',
    keywords: ["responsive overflow","horizontal scroll","responsive gate","響應式檢查"],
  },
  {
    toolName: 'design_gate_token_consistency',
    apiName: 'tokenConsistencyGate',
    description: 'Compare colors used in the artifact against the project DTCG palette when present, producing attested gate evidence.',
    keywords: ["token consistency","design tokens","palette gate","色彩一致性"],
  },
]

for (const gate of GATES) {
  register({
    name: gate.toolName,
    toolset: "subdesign-workflow",
    description: gate.description,
    keywords: gate.keywords,
    schemaParams: { type: 'object', properties: { artifactId: { type: 'string', description: 'Registered SubDesign artifact id' } }, required: ['artifactId'] } as Record<string, unknown>,
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
        const gateApi = api?.[gate.apiName]
        if (!gateApi) return { ok: false, output: `${gate.apiName} 需要 Electron desktop。` }
        const result = await gateApi({ artifact, projectRoot })
        if (!result.ok || !result.evidence) return { ok: false, output: String(result.error || `${gate.apiName} 執行失敗。`), data: result }
        const evidence = result.evidence as Record<string, unknown>
        const passed = evidence.passed === true
        return {
          ok: true,
          output: `${String(evidence.summary || '')}\n請把這筆 attested gate evidence 原封不動併入 design_critique 的 evidence（kind=gate、gateId=${String(evidence.gateId)}、passed=${passed}、sha256 與 path 不可改）。`,
          data: { ...result, evidence },
        }
      } catch (e) {
        return { ok: false, output: e instanceof Error ? e.message : String(e) }
      }
    },
  })
}

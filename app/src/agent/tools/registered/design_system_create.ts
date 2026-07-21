/**
 * Self-registering tool module: design_system_create
 * Hermes-style import-time register(). I/O lives here (no central switch).
 */
import { register } from '../toolRegistry.ts'
import { resolveEffectiveProjectRoot } from '../runContext.ts'
import type { ToolExecutionContext } from '../toolIoHelpers.ts'

register({
  name: "design_system_create",
  toolset: "subdesign-workflow",
  description: "Create a versioned SubDesign DESIGN.md under the project workspace.",
  keywords: ["create design system","new design system","write design.md","brand contract"],
  schemaParams: {"type":"object","properties":{"id":{"type":"string","description":"Safe folder id, e.g. editorial-light"},"title":{"type":"string"},"category":{"type":"string"},"content":{"type":"string","description":"Complete DESIGN.md content; omit to use the starter contract"}},"required":["id","title"]} as Record<string, unknown>,
  owningCapability: "subdesign-workflow",
  handler: async (args, ctx) => {
    const input = args
    const context = ctx as ToolExecutionContext | undefined
    const api = window.subagents?.tools
    const projectRoot = await resolveEffectiveProjectRoot(context?.projectRoot, context?.runId)
    const runId = context?.runId
    const threadId = context?.threadId
    try {
    const { defaultDesignSystemMarkdown, designSystemPath, isSafeDesignSystemId, DESIGN_SYSTEM_ROOT } = await import('../../subdesign/designSystem.ts')
    const id = String(input.id || '').trim()
    const title = String(input.title || '').trim()
    if (!projectRoot) return { ok: false, output: '請先選擇 project root，才能建立 design system。' }
    if (!isSafeDesignSystemId(id) || !title) return { ok: false, output: 'id / title 不合法。' }
    if (!api?.workspaceMkdir || !api.workspaceWrite) return { ok: false, output: 'design system 寫入需要 Electron workspace API。' }
    const dir = await api.workspaceMkdir(`${DESIGN_SYSTEM_ROOT}/${id}`, projectRoot)
    if (!dir.ok && !/exist/i.test(dir.error || '')) return { ok: false, output: dir.error || '建立資料夾失敗。' }
    const content = String(input.content || '').trim() || defaultDesignSystemMarkdown(title, String(input.category || 'custom'))
    const result = await api.workspaceWrite(designSystemPath(id), content, projectRoot)
    if (!result.ok) return { ok: false, output: result.error || '寫入 DESIGN.md 失敗。' }
    return { ok: true, output: `已建立 design system ${id} → ${result.path}`, data: { id, path: result.path } }
    } catch (e) {
      return { ok: false, output: e instanceof Error ? e.message : String(e) }
    }
  },
})

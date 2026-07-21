/**
 * Self-registering tool module: design_system_update
 * Hermes-style import-time register(). I/O lives here (no central switch).
 */
import { register } from '../toolRegistry.ts'
import { resolveEffectiveProjectRoot } from '../runContext.ts'
import type { ToolExecutionContext } from '../toolIoHelpers.ts'

register({
  name: "design_system_update",
  toolset: "subdesign-workflow",
  description: "Update a versioned SubDesign DESIGN.md under the project workspace.",
  keywords: ["update design system","update design.md","edit brand rules","write tokens"],
  schemaParams: {"type":"object","properties":{"id":{"type":"string"},"content":{"type":"string","description":"Complete DESIGN.md content"},"title":{"type":"string","description":"Used only when content is omitted"}},"required":["id","content"]} as Record<string, unknown>,
  owningCapability: "subdesign-workflow",
  handler: async (args, ctx) => {
    const input = args
    const context = ctx as ToolExecutionContext | undefined
    const api = window.subagents?.tools
    const projectRoot = await resolveEffectiveProjectRoot(context?.projectRoot, context?.runId)
    const runId = context?.runId
    const threadId = context?.threadId
    try {
    const { designSystemPath, isSafeDesignSystemId } = await import('../../subdesign/designSystem.ts')
    const id = String(input.id || '').trim()
    const content = String(input.content || '').trim()
    if (!projectRoot) return { ok: false, output: '請先選擇 project root，才能更新 design system。' }
    if (!isSafeDesignSystemId(id) || !content) return { ok: false, output: 'id / content 不合法。' }
    if (!api?.workspaceWrite) return { ok: false, output: 'design system 寫入需要 Electron workspace API。' }
    const result = await api.workspaceWrite(designSystemPath(id), content, projectRoot)
    if (!result.ok) return { ok: false, output: result.error || '更新 DESIGN.md 失敗。' }
    return { ok: true, output: `已更新 design system ${id} → ${result.path}`, data: { id, path: result.path } }
    } catch (e) {
      return { ok: false, output: e instanceof Error ? e.message : String(e) }
    }
  },
})

/**
 * Self-registering tool module: update_plan
 * Hermes-style import-time register(). I/O lives here (no central switch).
 */
import { register } from '../toolRegistry.ts'
import { resolveEffectiveProjectRoot } from '../runContext.ts'
import type { ToolExecutionContext } from '../toolIoHelpers.ts'

register({
  name: "update_plan",
  toolset: "planning",
  description: "Update the current task plan with ordered items and statuses. Use for multi-step work.",
  keywords: ["update plan","task list","todo list","execution plan","plan steps"],
  schemaParams: {"type":"object","properties":{"todos":{"type":"array","description":"Complete ordered task list snapshot. Replace the previous plan.","items":{"type":"object","properties":{"id":{"type":"string","description":"Stable item id (optional)"},"text":{"type":"string","description":"Actionable task description"},"status":{"type":"string","enum":["pending","active","done","failed"]}},"required":["text"]}}},"required":["todos"]} as Record<string, unknown>,
  owningCapability: "planning",
  handler: async (args, ctx) => {
    const input = args
    const context = ctx as ToolExecutionContext | undefined
    const api = window.subagents?.tools
    const projectRoot = await resolveEffectiveProjectRoot(context?.projectRoot, context?.runId)
    const runId = context?.runId
    const threadId = context?.threadId
    try {
    const raw = Array.isArray(input.todos)
      ? input.todos
      : Array.isArray(input.items)
        ? input.items
        : []
    const todos = raw
      .map((item, index) => {
        if (typeof item === 'string') {
          return { id: `plan_${index + 1}`, text: item, status: 'pending' }
        }
        if (!item || typeof item !== 'object') return null
        const value = item as Record<string, unknown>
        const text = String(value.text ?? value.title ?? value.task ?? value.step ?? '').trim()
        if (!text) return null
        const status = String(value.status ?? '').toLowerCase()
        return {
          id: String(value.id || `plan_${index + 1}`),
          text: text.slice(0, 200),
          status:
            status.includes('fail') || status.includes('error')
              ? 'failed'
              : status.includes('done') || status.includes('complete')
                ? 'done'
                : status.includes('active') || status.includes('progress')
                  ? 'active'
                  : 'pending',
        }
      })
      .filter((item): item is { id: string; text: string; status: string } => Boolean(item))
      .slice(0, 40)
    if (!todos.length) return { ok: false, output: 'update_plan 需要至少一個有效的 todos 項目' }
    try {
      const { useRunActivityStore } = await import('../../../store/runActivityStore')
      useRunActivityStore.getState().setTasks(todos, runId)
      useRunActivityStore.getState().push({
        kind: 'status',
        runId,
        title: '任務清單更新',
        detail: `${todos.length} 項 · ${todos.filter((item) => item.status === 'done').length} 項完成`,
      })
      useRunActivityStore.getState().setStatus(`任務清單已更新 · ${todos.length} 項`, runId)
    } catch {
      /* UI store is optional in browser / pure execution contexts */
    }
    const output = todos
      .map((item, index) => `${index + 1}. [${item.status}] ${item.text}`)
      .join('\n')
    let subDesignStage: string | undefined
    try {
      const { stageFromPlan } = await import('../../subdesign/brief')
      const { useSubDesignStore } = await import('../../../store/subDesignStore')
      const linked = threadId ? useSubDesignStore.getState().findByThreadId(threadId) : null
      const inferred = stageFromPlan(todos)
      if (linked && inferred && (inferred !== 'build' || linked.selectedDirectionId)) {
        const stageResult = useSubDesignStore.getState().setStage(linked.id, inferred, projectRoot)
        if (stageResult.ok) subDesignStage = stageResult.brief.stage
      }
    } catch {
      /* SubDesign metadata is optional for normal task plans. */
    }
    return {
      ok: true,
      output: `任務清單已更新（${todos.length} 項）${subDesignStage ? ` · SubDesign=${subDesignStage}` : ''}\n${output}`,
      data: { todos, subDesignStage },
    }
    } catch (e) {
      return { ok: false, output: e instanceof Error ? e.message : String(e) }
    }
  },
})

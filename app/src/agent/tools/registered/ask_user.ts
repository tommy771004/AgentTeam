/**
 * Self-registering tool module: ask_user
 * Hermes-style import-time register(). I/O lives here (no central switch).
 */
import { register } from '../toolRegistry.ts'
import { resolveEffectiveProjectRoot } from '../runContext.ts'
import type { ToolExecutionContext } from '../toolIoHelpers.ts'

register({
  name: "ask_user",
  toolset: "interaction",
  description: "Ask the user a structured question with optional choices before continuing.",
  keywords: ["ask user","need clarification","clarify","choose","preference","question"],
  schemaParams: {"type":"object","properties":{"question":{"type":"string","description":"Question to show to the user"},"reason":{"type":"string","description":"Why the agent needs this answer"},"options":{"type":"array","items":{"type":"object","properties":{"label":{"type":"string"},"description":{"type":"string"},"value":{"type":"string"}},"required":["label"]}},"multiSelect":{"type":"boolean","default":false},"allowFreeform":{"type":"boolean","default":true},"timeoutMs":{"type":"integer","description":"Question timeout in milliseconds"}},"required":["question"]} as Record<string, unknown>,
  owningCapability: "interaction",
  handler: async (args, ctx) => {
    const input = args
    const context = ctx as ToolExecutionContext | undefined
    const api = window.subagents?.tools
    const projectRoot = await resolveEffectiveProjectRoot(context?.projectRoot, context?.runId)
    const runId = context?.runId
    const threadId = context?.threadId
    try {
    const question = String(input.question || '').trim()
    if (!question) return { ok: false, output: 'ask_user 需要 question' }
    const rawOptions = Array.isArray(input.options) ? input.options : []
    const options = rawOptions
      .map((option) => {
        if (typeof option === 'string') return { label: option }
        if (!option || typeof option !== 'object') return null
        const value = option as Record<string, unknown>
        const label = String(value.label || value.title || '').trim()
        if (!label) return null
        return {
          label,
          description: value.description ? String(value.description) : undefined,
          value: value.value ? String(value.value) : undefined,
        }
      })
      .filter((option): option is { label: string; description?: string; value?: string } => Boolean(option))
      .slice(0, 12)
    const { useQuestionAskStore } = await import('../../../store/questionAskStore.ts')
    const answer = await useQuestionAskStore.getState().requestQuestion({
      question,
      options,
      multiSelect: input.multiSelect === true,
      allowFreeform: input.allowFreeform !== false,
      reason: input.reason ? String(input.reason) : undefined,
      timeoutMs: Number(input.timeoutMs) || undefined,
    })
    if (!answer) return { ok: false, output: '使用者取消或逾時，未取得回答' }
    const output = [
      answer.answers.length ? `選擇：${answer.answers.join('、')}` : '',
      answer.freeform ? `補充：${answer.freeform}` : '',
    ]
      .filter(Boolean)
      .join('\n')
    return { ok: true, output: output || '使用者已回答（無文字內容）', data: answer }
    } catch (e) {
      return { ok: false, output: e instanceof Error ? e.message : String(e) }
    }
  },
})

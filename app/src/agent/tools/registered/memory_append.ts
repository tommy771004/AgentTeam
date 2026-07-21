/**
 * Self-registering tool module: memory_append
 * Hermes-style import-time register(). I/O lives here (no central switch).
 */
import { register } from '../toolRegistry.ts'
import { resolveEffectiveProjectRoot } from '../runContext.ts'
import type { ToolExecutionContext } from '../toolIoHelpers.ts'

register({
  name: "memory_append",
  toolset: "memory",
  description: "Append a durable memory entry (Hermes-style)",
  keywords: ["remember","prefer","lesson","note","save memory"],
  schemaParams: {"type":"object","properties":{"text":{"type":"string","description":"Durable memory text to append"},"tags":{"type":"array","items":{"type":"string"}}},"required":["text"]} as Record<string, unknown>,
  owningCapability: "memory",
  handler: async (args, ctx) => {
    const input = args
    const context = ctx as ToolExecutionContext | undefined
    const api = window.subagents?.tools
    const projectRoot = await resolveEffectiveProjectRoot(context?.projectRoot, context?.runId)
    const runId = context?.runId
    const threadId = context?.threadId
    try {
    const { memoryStore } = await import('../../hermes/memory.ts')
    const { useSettingsStore } = await import('../../../store/settingsStore.ts')
    const s = useSettingsStore.getState().settings
    if (s.memoryEnabled === false || s.memoryWriteEnabled === false) {
      return { ok: false, output: '記憶寫入已在設定中關閉（Memory / Write）' }
    }
    const text = String(input.text || '').trim()
    if (!text) return { ok: false, output: 'text is required' }
    const tags = Array.isArray(input.tags) ? (input.tags as string[]).map(String) : undefined
    const entry = memoryStore.appendMemory(text, tags)
    return { ok: true, output: `已寫入記憶 ${entry.id}: ${entry.text.slice(0, 200)}`, data: entry }
    } catch (e) {
      return { ok: false, output: e instanceof Error ? e.message : String(e) }
    }
  },
})

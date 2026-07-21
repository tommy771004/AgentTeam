/**
 * Self-registering tool module: memory_get
 * Hermes-style import-time register(). I/O lives here (no central switch).
 */
import { register } from '../toolRegistry.ts'
import { resolveEffectiveProjectRoot } from '../runContext.ts'
import type { ToolExecutionContext } from '../toolIoHelpers.ts'
import { memory } from '../toolIoHelpers.ts'

register({
  name: "memory_get",
  toolset: "memory",
  description: "Read a key from session memory",
  keywords: ["recall","memory","retrieve","context"],
  schemaParams: {"type":"object","properties":{"key":{"type":"string"}},"required":["key"]} as Record<string, unknown>,
  owningCapability: "memory",
  handler: async (args, ctx) => {
    const input = args
    const context = ctx as ToolExecutionContext | undefined
    const api = window.subagents?.tools
    const projectRoot = await resolveEffectiveProjectRoot(context?.projectRoot, context?.runId)
    const runId = context?.runId
    const threadId = context?.threadId
    try {
    const { useSettingsStore } = await import('../../../store/settingsStore.ts')
    if (useSettingsStore.getState().settings.memoryEnabled === false) {
      return { ok: false, output: '記憶已在設定中關閉' }
    }
    const key = String(input.key || 'default')
    let value = memory.get(key)
    if (value == null && api?.memoryGet) {
      value = (await api.memoryGet(key)) ?? undefined
    }
    return {
      ok: value != null,
      output: value != null ? String(value) : `memory[${key}] is empty`,
    }
    } catch (e) {
      return { ok: false, output: e instanceof Error ? e.message : String(e) }
    }
  },
})

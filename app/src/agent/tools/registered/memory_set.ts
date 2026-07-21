/**
 * Self-registering tool module: memory_set
 * Hermes-style import-time register(). I/O lives here (no central switch).
 */
import { register } from '../toolRegistry.ts'
import { resolveEffectiveProjectRoot } from '../runContext.ts'
import type { ToolExecutionContext } from '../toolIoHelpers.ts'
import { memory } from '../toolIoHelpers.ts'

register({
  name: "memory_set",
  toolset: "memory",
  description: "Store a key/value in session memory",
  keywords: ["remember","store","memory","cache"],
  schemaParams: {"type":"object","properties":{"key":{"type":"string"},"value":{"type":"string"}},"required":["key","value"]} as Record<string, unknown>,
  owningCapability: "memory",
  handler: async (args, ctx) => {
    const input = args
    const context = ctx as ToolExecutionContext | undefined
    const api = window.subagents?.tools
    const projectRoot = await resolveEffectiveProjectRoot(context?.projectRoot, context?.runId)
    const runId = context?.runId
    const threadId = context?.threadId
    try {
    const key = String(input.key || 'default')
    const value = String(input.value || '')
    memory.set(key, value)
    if (api?.memorySet) await api.memorySet(key, value)
    return { ok: true, output: `memory[${key}] = ${value.slice(0, 200)}` }
    } catch (e) {
      return { ok: false, output: e instanceof Error ? e.message : String(e) }
    }
  },
})

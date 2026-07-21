/**
 * OpenAI-compatible function-calling tool schemas.
 * Parameter records are derived from toolDefinitions (single source).
 */

import type { ToolName } from './registry'
import { TOOL_CATALOG } from './registry'
import { toolParameters } from './toolDefinitions.ts'

export interface OpenAiToolDef {
  type: 'function'
  function: {
    name: string
    description: string
    parameters: Record<string, unknown>
  }
}

/** Derived parameter schema view — same keys as ToolName. */
export const PARAMS: Record<ToolName, Record<string, unknown>> = toolParameters()

export function buildOpenAiTools(opts?: {
  webSearchEnabled?: boolean
  only?: ToolName[]
}): OpenAiToolDef[] {
  const catalog = TOOL_CATALOG.filter((t) => {
    if (opts?.webSearchEnabled === false && t.name === 'web_search') return false
    if (opts?.only && !opts.only.includes(t.name)) return false
    return true
  })

  return catalog.map((t) => ({
    type: 'function' as const,
    function: {
      name: t.name,
      description: t.description,
      parameters: PARAMS[t.name],
    },
  }))
}

export function isToolName(name: string): name is ToolName {
  return TOOL_CATALOG.some((t) => t.name === name)
}

/**
 * Agent tool catalog — deterministic routing by step keywords.
 * Actual I/O goes through Electron IPC when available.
 *
 * ToolName + catalog rows are derived from toolDefinitions (single source).
 */

import {
  TOOL_DEFINITIONS,
  toolCatalogEntries,
  type ToolName,
} from './toolDefinitions.ts'

export type { ToolName }
export { TOOL_DEFINITIONS }

export interface ToolDef {
  name: ToolName
  description: string
  keywords: string[]
}

/** Derived catalog view — same shape as the former hand-maintained array. */
export const TOOL_CATALOG: ToolDef[] = toolCatalogEntries()

/**
 * Compatibility declarations retained for plain-browser simulation only.
 * In Electron, Pi Host projects its own live catalog and these names must not
 * participate in renderer routing or validation authority.
 */
const PI_HOST_OWNED_COMPAT_TOOLS = new Set<ToolName>([
  'workspace_read',
  'workspace_list',
  'workspace_grep',
  'workspace_glob',
  'workspace_write',
  'bash',
])

/** Pick tools relevant to a step description + objective. */
export function selectToolsForStep(
  description: string,
  objective: string,
  action: string,
  opts?: { webSearchEnabled?: boolean },
): ToolName[] {
  const hay = `${description} ${objective} ${action}`.toLowerCase()
  const picks: ToolName[] = []
  const electronPiHostOwnsTools = typeof window !== 'undefined' &&
    typeof window.subagents?.platform === 'function' &&
    typeof window.subagents?.piHost?.sessions?.list === 'function'

  for (const tool of TOOL_CATALOG) {
    // Electron/Pi Host is the canonical tool owner. Plain-browser development
    // may use the renderer compatibility catalog when no Host exists.
    if (electronPiHostOwnsTools && PI_HOST_OWNED_COMPAT_TOOLS.has(tool.name)) continue
    if (tool.name === 'web_search' && opts?.webSearchEnabled === false) continue
    if (tool.keywords.some((k) => hay.includes(k))) {
      picks.push(tool.name)
    }
  }

  // Always give datetime for time-based-ish wording
  if (/\b(every|daily|schedule|cron|08:00)\b/i.test(hay) && !picks.includes('datetime_now')) {
    picks.unshift('datetime_now')
  }

  // Cap to avoid noisy steps
  const unique = [...new Set(picks)]
  if (unique.length === 0) {
    // default lightweight tools
    return ['datetime_now']
  }
  return unique.slice(0, 3)
}

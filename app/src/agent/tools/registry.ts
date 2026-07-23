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
    // Electron/Pi Host is the canonical Bash owner. The legacy renderer loop
    // remains available only for plain-browser development fallback.
    if (electronPiHostOwnsTools && tool.name === 'bash') continue
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

export function buildToolInput(
  tool: ToolName,
  objective: string,
  stepDescription: string,
  priorOutputs: string[],
): Record<string, unknown> {
  const query = extractQuery(objective, stepDescription)

  switch (tool) {
    case 'web_search':
      return { query, limit: 5 }
    case 'http_fetch': {
      const url = extractUrl(`${objective} ${stepDescription} ${priorOutputs.join(' ')}`)
      return { url: url || 'https://example.com', maxChars: 4000 }
    }
    case 'workspace_list':
      return { path: '.' }
    case 'workspace_read':
      return { path: guessFilename(objective, 'input') }
    case 'workspace_diff':
      return { paths: [] }
    case 'workspace_write':
      return {
        path: guessFilename(objective, 'report'),
        content: priorOutputs.slice(-1)[0] || `# ${objective}\n\n(pending synthesis)\n`,
      }
    case 'workspace_download':
      return { url: extractUrl(`${objective} ${stepDescription}`) || '', path: guessFilename(objective, 'input') }
    case 'workspace_mkdir':
      return { path: 'outputs' }
    case 'workspace_move':
      return { from: '', to: '' }
    case 'workspace_delete':
      return { path: '' }
    case 'table_parse':
      return { text: priorOutputs.slice(-1)[0] || objective, delimiter: 'auto' }
    case 'bash':
      return {
        command:
          typeof navigator !== 'undefined' && /win/i.test(navigator.platform)
            ? 'cd && dir'
            : 'pwd && ls -la',
        timeoutMs: 30_000,
      }
    case 'datetime_now':
      return { timezone: Intl.DateTimeFormat().resolvedOptions().timeZone }
    case 'memory_set':
      return { key: 'last_objective', value: objective }
    case 'memory_get':
      return { key: 'last_objective' }
    case 'memory_append':
      return { text: priorOutputs.slice(-1)[0]?.slice(0, 400) || objective.slice(0, 200) }
    case 'memory_search':
      return { query: extractQuery(objective, stepDescription) }
    case 'skill_list':
      return {}
    case 'skill_load': {
      const match = skillsHintName(objective, stepDescription)
      return { name: match }
    }
    case 'skill_save':
      return {
        name: `skill-${Date.now().toString(36)}`,
        description: objective.slice(0, 60),
        body: priorOutputs.slice(-1)[0] || `# Skill\n\n${objective}`,
      }
    case 'mcp_list_tools':
      return {}
    case 'mcp_call':
      return {
        serverId: '',
        toolName: '',
        arguments: {},
      }
    case 'delegate_task':
      return {
        goal: stepDescription || objective,
        context: priorOutputs.slice(-1)[0]?.slice(0, 500) || '',
        role: 'leaf',
        background: false,
        notify_on_complete: true,
      }
    case 'delegate_status':
      return {}
    case 'monitor':
      return { action: 'list' }
    case 'message_send':
      return {
        channel: 'telegram',
        chatId: '',
        text: priorOutputs.slice(-1)[0]?.slice(0, 500) || objective.slice(0, 200),
      }
    case 'json_extract_lite':
      return { text: priorOutputs.slice(-1)[0] || objective, fields: ['title', 'items', 'summary'] }
    case 'update_plan':
      return { todos: [{ text: stepDescription || objective, status: 'active' }] }
    case 'ask_user':
      return {
        question: stepDescription || objective,
        options: [],
        allowFreeform: true,
      }
    default:
      return {}
  }
}

function extractQuery(objective: string, step: string): string {
  // Prefer shorter step-focused query
  const base = step.length < 80 ? `${step} ${objective}` : objective
  return base.replace(/[^\w\s\-.:]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 160)
}

function extractUrl(text: string): string | null {
  const m = text.match(/https?:\/\/[^\s)"']+/)
  return m ? m[0] : null
}

function guessFilename(objective: string, kind: 'report' | 'input'): string {
  const slug = objective
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_|_$/g, '')
    .slice(0, 40)
  return kind === 'report' ? `reports/${slug || 'output'}.md` : `inputs/${slug || 'notes'}.md`
}

function skillsHintName(objective: string, step: string): string {
  const hay = `${objective} ${step}`.toLowerCase()
  if (/export|credential|sensitive|dump/.test(hay)) return 'safe-export'
  if (/search|research|price|compare|find/.test(hay)) return 'web-research'
  return 'web-research'
}

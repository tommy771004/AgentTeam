/**
 * OpenCode-compatible config shapes (subset we implement)
 * @see https://opencode.ai/docs/config
 * @see https://opencode.ai/docs/agents
 */

import type { PermissionAction, PermissionPolicy } from '../types'

/** allow | ask | deny, or pattern map for bash-like keys */
export type PermissionRule =
  | PermissionAction
  | Record<string, PermissionAction>

export type OpenCodePermissionBlock = {
  read?: PermissionRule
  edit?: PermissionRule
  bash?: PermissionRule
  web?: PermissionRule
  webfetch?: PermissionRule
  websearch?: PermissionRule
  memory?: PermissionRule
  skill?: PermissionRule
  mcp?: PermissionRule
  task?: PermissionRule
  delegate?: PermissionRule
  glob?: PermissionRule
  grep?: PermissionRule
  list?: PermissionRule
  /** wildcard / tool name patterns */
  [key: string]: PermissionRule | undefined
}

export type OpenCodeAgentConfig = {
  description?: string
  mode?: 'primary' | 'subagent' | 'all'
  model?: string
  prompt?: string
  temperature?: number
  steps?: number
  maxSteps?: number
  disable?: boolean
  hidden?: boolean
  color?: string
  permission?: OpenCodePermissionBlock
  tools?: Record<string, boolean>
}

export type OpenCodeCommandConfig = {
  template: string
  description?: string
  agent?: string
  model?: string
}

export type OpenCodeMergedConfig = {
  model?: string
  small_model?: string
  default_agent?: string
  permission?: OpenCodePermissionBlock
  agent?: Record<string, OpenCodeAgentConfig>
  command?: Record<string, OpenCodeCommandConfig>
  mcp?: Record<string, unknown>
  instructions?: string[]
  compaction?: {
    auto?: boolean
    prune?: boolean
    reserved?: number
  }
  /** Paths that contributed (later overrides earlier) */
  sources: string[]
  /** Loaded agent markdown definitions */
  agentsFromMarkdown: OpenCodeAgentFileDef[]
  /** Loaded command markdown */
  commandsFromMarkdown: OpenCodeCommandFileDef[]
}

export type OpenCodeAgentFileDef = {
  id: string
  name: string
  path: string
  mode?: string
  description?: string
  model?: string
  temperature?: number
  steps?: number
  body: string
  permission?: OpenCodePermissionBlock
  hidden?: boolean
  color?: string
  source: 'global' | 'project' | 'config'
}

export type OpenCodeCommandFileDef = {
  id: string
  name: string
  path: string
  description?: string
  template: string
  agent?: string
  model?: string
  source: 'global' | 'project' | 'config'
}

/** Normalize OpenCode permission block → our PermissionPolicy + bash patterns */
export function toPermissionPolicy(
  block?: OpenCodePermissionBlock | null,
): PermissionPolicy {
  if (!block) return {}
  const out: PermissionPolicy = {}
  const mapKey = (k: string): keyof PermissionPolicy | null => {
    if (k === 'webfetch' || k === 'websearch') return 'web'
    if (
      k === 'read' ||
      k === 'edit' ||
      k === 'web' ||
      k === 'memory' ||
      k === 'skill' ||
      k === 'mcp' ||
      k === 'task' ||
      k === 'delegate'
    ) {
      return k
    }
    if (k === 'bash' || k === 'glob' || k === 'grep' || k === 'list') return 'edit'
    return null
  }
  for (const [k, v] of Object.entries(block)) {
    if (v == null) continue
    const pk = mapKey(k)
    if (!pk) continue
    if (typeof v === 'string' && (v === 'allow' || v === 'ask' || v === 'deny')) {
      out[pk] = v
    } else if (typeof v === 'object') {
      // pattern map: if any deny → deny for coarse policy; prefer ask if mixed
      const vals = Object.values(v)
      if (vals.includes('deny') && !vals.includes('allow') && !vals.includes('ask')) {
        out[pk] = 'deny'
      } else if (vals.includes('ask')) {
        out[pk] = 'ask'
      } else if (vals.includes('allow')) {
        out[pk] = 'allow'
      }
    }
  }
  return out
}

/**
 * Resolve bash (or similar) permission with glob patterns.
 * Last matching rule wins (OpenCode semantics).
 */
export function resolvePatternPermission(
  rule: PermissionRule | undefined,
  command: string,
  fallback: PermissionAction = 'allow',
): PermissionAction {
  if (rule == null) return fallback
  if (typeof rule === 'string') {
    if (rule === 'allow' || rule === 'ask' || rule === 'deny') return rule
    return fallback
  }
  let result: PermissionAction = fallback
  // Iterate in insertion order; last match wins
  for (const [pattern, action] of Object.entries(rule)) {
    if (action !== 'allow' && action !== 'ask' && action !== 'deny') continue
    if (matchGlob(pattern, command)) result = action
  }
  return result
}

/** Simple glob: * matches any chars; case-sensitive */
export function matchGlob(pattern: string, text: string): boolean {
  if (pattern === '*') return true
  // Escape regex specials except *
  const reBody = pattern
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*/g, '.*')
  try {
    return new RegExp(`^${reBody}$`).test(text) || new RegExp(reBody).test(text)
  } catch {
    return text.includes(pattern.replace(/\*/g, ''))
  }
}

export function extractBashPermission(
  block?: OpenCodePermissionBlock | null,
): PermissionRule | undefined {
  return block?.bash
}

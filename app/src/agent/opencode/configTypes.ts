/**
 * OpenCode-compatible config shapes (subset we implement)
 * @see https://opencode.ai/docs/config
 * @see https://opencode.ai/docs/agents
 */

import type {
  PermissionAction,
  PermissionPolicy,
  PermissionProjection,
  PermissionRuleValue,
} from '../types'

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
  external_directory?: PermissionRule
  lsp?: PermissionRule
  todowrite?: PermissionRule
  question?: PermissionRule
  doom_loop?: PermissionRule
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
  /** npm plugin references from opencode.json; never auto-installed here. */
  plugin?: string[]
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
    if (k === 'bash') return 'edit'
    if (k === 'glob' || k === 'grep' || k === 'list') return 'read'
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

const UNSUPPORTED_PERMISSION_KEYS = new Set(['external_directory', 'lsp', 'question', 'doom_loop'])

/** Preserve every valid OpenCode rule for exact tool/MCP evaluation. */
export function projectOpenCodePermissions(
  block?: OpenCodePermissionBlock | null,
): PermissionProjection {
  const rules: Record<string, PermissionRuleValue> = {}
  const unsupported: string[] = []
  for (const [key, value] of Object.entries(block || {})) {
    if (value == null) continue
    const validAction =
      typeof value === 'string' && (value === 'allow' || value === 'ask' || value === 'deny')
    const validPatternMap =
      typeof value === 'object' &&
      Object.values(value).every((x) => x === 'allow' || x === 'ask' || x === 'deny')
    if (!validAction && !validPatternMap) {
      unsupported.push(`${key}:invalid-rule`)
      continue
    }
    rules[key] = value as PermissionRuleValue
    if (UNSUPPORTED_PERMISSION_KEYS.has(key)) unsupported.push(key)
  }
  return { rules, unsupported: [...new Set(unsupported)] }
}

/** Merge parent/child projections conservatively: deny > ask > allow. */
export function mergePermissionProjectionsRestrictive(
  ...projections: Array<PermissionProjection | undefined>
): PermissionProjection {
  const rules: Record<string, PermissionRuleValue> = {}
  const unsupported = new Set<string>()
  for (const projection of projections) {
    if (!projection) continue
    for (const item of projection.unsupported) unsupported.add(item)
    for (const [key, value] of Object.entries(projection.rules)) {
      const previous = rules[key]
      if (previous == null) {
        rules[key] = value
        continue
      }
      if (typeof previous === 'string' && typeof value === 'string') {
        rules[key] = mostRestrictiveAction(previous, value)
      } else if (typeof previous === 'object' && typeof value === 'object') {
        const merged: Record<string, PermissionAction> = { ...previous }
        for (const [pattern, action] of Object.entries(value)) {
          merged[pattern] = merged[pattern]
            ? mostRestrictiveAction(merged[pattern], action)
            : action
        }
        rules[key] = merged
      } else {
        // A scalar rule is global; retain it when restrictive, otherwise keep
        // the fine-grained map so a deny/ask pattern cannot be widened away.
        if (typeof previous === 'string') {
          rules[key] = previous === 'allow' ? value : previous
        } else {
          rules[key] = value === 'allow' ? previous : value
        }
      }
    }
  }
  return { rules, unsupported: [...unsupported] }
}

function mostRestrictiveAction(a: PermissionAction, b: PermissionAction): PermissionAction {
  const rank: Record<PermissionAction, number> = { allow: 0, ask: 1, deny: 2 }
  return rank[a] >= rank[b] ? a : b
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

/**
 * Unified agent registry: builtin Build/Plan + scanned OpenCode agents
 * Runtime resolution of model / permission / prompt / steps
 */

import type { PermissionPolicy, RuntimeOverrides } from '../types'
import {
  PRIMARY_AGENTS,
  SUBAGENTS,
  type AgentModeDef,
  type SubagentDef,
} from './agents'
import {
  deniedToolsFromPolicy,
  type PermissionAction,
} from './permissions'
import {
  extractBashPermission,
  resolvePatternPermission,
  toPermissionPolicy,
  type OpenCodeAgentFileDef,
  type OpenCodeMergedConfig,
  type OpenCodePermissionBlock,
  type PermissionRule,
} from './configTypes'
import { conversationRuntimeOverrides, type SpeedMode, type ThinkingDepth } from '../thinking'

export type RegistryAgent = {
  id: string
  label: string
  description: string
  kind: 'primary' | 'subagent'
  model?: string
  systemHint: string
  permission: PermissionPolicy
  /** Raw OpenCode permission (for bash patterns) */
  permissionBlock?: OpenCodePermissionBlock
  bashPermission?: PermissionRule
  temperature?: number
  steps?: number
  hidden?: boolean
  color?: string
  source: 'builtin' | 'global' | 'project' | 'config'
  path?: string
}

let hydrated: OpenCodeMergedConfig | null = null
let registryCache: RegistryAgent[] = []

export function setHydratedOpenCodeConfig(cfg: OpenCodeMergedConfig | null) {
  hydrated = cfg
  registryCache = buildRegistry(cfg)
}

export function getHydratedOpenCodeConfig(): OpenCodeMergedConfig | null {
  return hydrated
}

function fromBuiltinPrimary(p: AgentModeDef): RegistryAgent {
  return {
    id: p.id,
    label: p.label,
    description: p.description,
    kind: 'primary',
    systemHint: p.systemHint,
    permission: p.permission,
    color: p.color,
    source: 'builtin',
  }
}

function fromBuiltinSub(s: SubagentDef): RegistryAgent {
  return {
    id: s.id,
    label: s.label,
    description: s.description,
    kind: 'subagent',
    systemHint: s.systemHint,
    permission: s.permission,
    source: 'builtin',
  }
}

function fromFileDef(a: OpenCodeAgentFileDef): RegistryAgent {
  const mode = (a.mode || 'all').toLowerCase()
  const kind: 'primary' | 'subagent' =
    mode === 'primary' ? 'primary' : mode === 'subagent' ? 'subagent' : 'subagent'
  const pol = toPermissionPolicy(a.permission)
  // merge with sensible defaults by kind
  const base =
    kind === 'primary'
      ? PRIMARY_AGENTS[0].permission
      : SUBAGENTS.find((x) => x.id === 'explore')?.permission || {}
  return {
    id: a.id,
    label: a.name || a.id,
    description: a.description || a.body.slice(0, 120),
    kind,
    model: a.model,
    systemHint: a.body || a.description || `Agent ${a.id}`,
    permission: { ...base, ...pol },
    permissionBlock: a.permission,
    bashPermission: extractBashPermission(a.permission),
    temperature: a.temperature,
    steps: a.steps,
    hidden: a.hidden,
    color: a.color,
    source: a.source,
    path: a.path,
  }
}

function buildRegistry(cfg: OpenCodeMergedConfig | null): RegistryAgent[] {
  const list: RegistryAgent[] = [
    ...PRIMARY_AGENTS.map(fromBuiltinPrimary),
    ...SUBAGENTS.map(fromBuiltinSub),
  ]
  const byId = new Map(list.map((a) => [a.id, a]))

  // JSON agent: override or add
  if (cfg?.agent) {
    for (const [id, ac] of Object.entries(cfg.agent)) {
      if (ac.disable) {
        byId.delete(id)
        continue
      }
      const existing = byId.get(id)
      const pol = toPermissionPolicy(ac.permission)
      const mode = (ac.mode || existing?.kind || 'all') as string
      const kind: 'primary' | 'subagent' =
        mode === 'primary' || id === 'build' || id === 'plan'
          ? 'primary'
          : mode === 'subagent'
            ? 'subagent'
            : existing?.kind || 'subagent'
      const prompt =
        typeof ac.prompt === 'string' && !ac.prompt.startsWith('{file:')
          ? ac.prompt
          : existing?.systemHint || ac.description || id
      byId.set(id, {
        id,
        label: existing?.label || id,
        description: ac.description || existing?.description || id,
        kind,
        model: ac.model || existing?.model,
        systemHint: prompt,
        permission: { ...(existing?.permission || {}), ...pol },
        permissionBlock: {
          ...(existing?.permissionBlock || {}),
          ...(ac.permission || {}),
          ...(cfg.permission || {}),
        },
        bashPermission:
          extractBashPermission(ac.permission) ||
          extractBashPermission(cfg.permission) ||
          existing?.bashPermission,
        temperature: ac.temperature ?? existing?.temperature,
        steps: ac.steps ?? ac.maxSteps ?? existing?.steps,
        hidden: ac.hidden,
        color: ac.color || existing?.color,
        source: 'config',
        path: `opencode.json#agent.${id}`,
      })
    }
  }

  // Markdown agents
  for (const a of cfg?.agentsFromMarkdown || []) {
    const reg = fromFileDef(a)
    // merge global permission defaults
    if (cfg?.permission) {
      reg.permission = { ...toPermissionPolicy(cfg.permission), ...reg.permission }
      reg.bashPermission =
        reg.bashPermission || extractBashPermission(cfg.permission)
      reg.permissionBlock = { ...cfg.permission, ...reg.permissionBlock }
    }
    byId.set(a.id, reg)
  }

  return [...byId.values()]
}

export function listRegistryAgents(opts?: {
  kind?: 'primary' | 'subagent'
  includeHidden?: boolean
}): RegistryAgent[] {
  const all = registryCache.length ? registryCache : buildRegistry(hydrated)
  return all.filter((a) => {
    if (opts?.kind && a.kind !== opts.kind) return false
    if (!opts?.includeHidden && a.hidden) return false
    return true
  })
}

export function getRegistryAgent(id: string | undefined | null): RegistryAgent | undefined {
  if (!id) return undefined
  const low = id.toLowerCase().replace(/^@/, '')
  const all = listRegistryAgents({ includeHidden: true })
  return (
    all.find((a) => a.id === low || a.label.toLowerCase() === low) ||
    all.find((a) => low === 'gen' && a.id === 'general') ||
    all.find((a) => low === 'exp' && a.id === 'explore')
  )
}

export function resolveBashAction(
  agentId: string | undefined,
  command: string,
  fallback: PermissionAction = 'ask',
): PermissionAction {
  const agent = getRegistryAgent(agentId)
  const rule =
    agent?.bashPermission ||
    extractBashPermission(hydrated?.permission) ||
    extractBashPermission(agent?.permissionBlock)
  // Also check coarse permission.edit/bash via policy
  if (!rule) {
    const pol = agent?.permission?.edit
    if (pol === 'deny') return 'deny'
    if (pol === 'ask') return 'ask'
    return fallback
  }
  return resolvePatternPermission(rule, command.trim(), fallback)
}

/**
 * Build runtime overrides from selected primary agent + optional @subagent
 */
export function resolveAgentRuntime(opts: {
  agentId?: string
  subagentId?: string
  model?: string
  depth?: ThinkingDepth
  speed?: SpeedMode
  extra?: Partial<RuntimeOverrides>
}): RuntimeOverrides & {
  resolvedAgentId: string
  agentModel?: string
  maxToolRounds?: number
  temperature?: number
} {
  const primaryId =
    opts.agentId ||
    hydrated?.default_agent ||
    'build'
  const primary = getRegistryAgent(primaryId) || getRegistryAgent('build')!
  const sub = opts.subagentId ? getRegistryAgent(opts.subagentId) : undefined

  const active = sub || primary
  const permission: PermissionPolicy = {
    ...primary.permission,
    ...(sub?.permission || {}),
  }
  const denied = deniedToolsFromPolicy(permission)
  const model =
    opts.model?.trim() ||
    sub?.model ||
    primary.model ||
    hydrated?.model ||
    undefined

  const hints = [primary.systemHint, sub?.systemHint].filter(Boolean)
  const base = conversationRuntimeOverrides({
    model,
    depth: opts.depth,
    speed: opts.speed,
    extra: {
      agentMode: primary.id === 'plan' ? 'plan' : 'build',
      subagentId: sub?.id as RuntimeOverrides['subagentId'],
      permissionPolicy: permission,
      blockedTools: denied,
      extraSystemContext: hints.join('\n\n'),
      maxToolRounds: sub?.steps || primary.steps,
      ...opts.extra,
    },
  })

  base.extraSystemContext = [base.extraSystemContext, hints.join('\n\n')]
    .filter(Boolean)
    .join('\n\n')
  base.permissionPolicy = permission
  base.blockedTools = [...new Set([...(base.blockedTools || []), ...denied])]
  if (model) base.model = model

  return {
    ...base,
    resolvedAgentId: active.id,
    agentModel: model,
    maxToolRounds: base.maxToolRounds,
    temperature: sub?.temperature ?? primary.temperature,
  }
}

/** Parse @mentions against full registry (not just builtin) */
export function parseRegistryMentions(text: string): {
  subagents: string[]
  cleaned: string
} {
  const found: string[] = []
  let cleaned = text
  const subs = listRegistryAgents({ kind: 'subagent' })
  for (const s of subs) {
    const tokens = [`@${s.id}`, s.id === 'general' ? '@gen' : '', s.id === 'explore' ? '@exp' : ''].filter(
      Boolean,
    )
    for (const t of tokens) {
      const re = new RegExp(`(?:^|\\s)${t.replace('@', '@?')}\\b`, 'gi')
      if (re.test(cleaned)) {
        if (!found.includes(s.id)) found.push(s.id)
        cleaned = cleaned.replace(re, ' ')
      }
    }
  }
  return { subagents: found, cleaned: cleaned.replace(/\s+/g, ' ').trim() }
}

export function getSmallModel(): string | undefined {
  return hydrated?.small_model
}

export function getCompactionConfig() {
  return hydrated?.compaction || { auto: true, prune: false, reserved: 8000 }
}

/** Compatibility alias used across the app */
export function openCodeRuntimeOverrides(opts: {
  agentMode?: string
  model?: string
  depth?: ThinkingDepth
  speed?: SpeedMode
  subagent?: string
  extra?: Partial<RuntimeOverrides>
}): RuntimeOverrides {
  return resolveAgentRuntime({
    agentId: opts.agentMode || 'build',
    subagentId: opts.subagent,
    model: opts.model,
    depth: opts.depth,
    speed: opts.speed,
    extra: opts.extra,
  })
}

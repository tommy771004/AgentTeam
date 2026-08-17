/**
 * Load & merge OpenCode-style config (renderer-side pure helpers + IPC hydrate).
 * Precedence (later overrides): remote(skip) → global → project → .opencode dirs
 */

import type {
  OpenCodeAgentConfig,
  OpenCodeAgentFileDef,
  OpenCodeCommandConfig,
  OpenCodeCommandFileDef,
  OpenCodeMergedConfig,
  OpenCodePermissionBlock,
} from './configTypes.ts'

function deepMergeAgents(
  a: Record<string, OpenCodeAgentConfig> = {},
  b: Record<string, OpenCodeAgentConfig> = {},
): Record<string, OpenCodeAgentConfig> {
  const out = { ...a }
  for (const [k, v] of Object.entries(b)) {
    out[k] = { ...(out[k] || {}), ...v, permission: { ...(out[k]?.permission || {}), ...(v.permission || {}) } }
  }
  return out
}

/** Strip // and /* comments from JSONC */
export function stripJsonc(text: string): string {
  let s = text.replace(/\/\*[\s\S]*?\*\//g, '')
  s = s.replace(/^\s*\/\/.*$/gm, '')
  return s
}

export function parseOpenCodeJson(text: string): Record<string, unknown> {
  try {
    return JSON.parse(stripJsonc(text)) as Record<string, unknown>
  } catch {
    return {}
  }
}

export function mergeOpenCodeConfigs(
  layers: Array<{ path: string; data: Record<string, unknown> }>,
): OpenCodeMergedConfig {
  const sources: string[] = []
  let model: string | undefined
  let small_model: string | undefined
  let default_agent: string | undefined
  let permission: OpenCodePermissionBlock = {}
  let agent: Record<string, OpenCodeAgentConfig> = {}
  let command: Record<string, OpenCodeCommandConfig> = {}
  let mcp: Record<string, unknown> = {}
  let plugin: string[] = []
  let instructions: string[] = []
  let compaction: OpenCodeMergedConfig['compaction']

  for (const layer of layers) {
    if (!layer.data || !Object.keys(layer.data).length) continue
    sources.push(layer.path)
    const d = layer.data
    if (typeof d.model === 'string') model = d.model
    if (typeof d.small_model === 'string') small_model = d.small_model
    if (typeof d.default_agent === 'string') default_agent = d.default_agent
    if (d.permission && typeof d.permission === 'object') {
      permission = { ...permission, ...(d.permission as OpenCodePermissionBlock) }
    }
    if (d.agent && typeof d.agent === 'object') {
      agent = deepMergeAgents(agent, d.agent as Record<string, OpenCodeAgentConfig>)
    }
    if (d.command && typeof d.command === 'object') {
      command = { ...command, ...(d.command as Record<string, OpenCodeCommandConfig>) }
    }
    if (d.mcp && typeof d.mcp === 'object') {
      mcp = { ...mcp, ...(d.mcp as Record<string, unknown>) }
    }
    if (Array.isArray(d.plugin)) {
      plugin = [...plugin, ...d.plugin.map(String).filter(Boolean)]
    }
    if (Array.isArray(d.instructions)) {
      instructions = [...instructions, ...(d.instructions as string[])]
    }
    if (d.compaction && typeof d.compaction === 'object') {
      compaction = { ...compaction, ...(d.compaction as OpenCodeMergedConfig['compaction']) }
    }
  }

  return {
    model,
    small_model,
    default_agent,
    permission,
    agent,
    command,
    mcp,
    plugin: [...new Set(plugin)],
    instructions,
    compaction,
    sources,
    agentsFromMarkdown: [],
    commandsFromMarkdown: [],
  }
}

export type HydratedOpenCodeBundle = OpenCodeMergedConfig & {
  loadedAt: string
  projectRoot?: string
}

/** Apply JSON agent entries into markdown-like defs for registry */
export function agentsFromConfigJson(
  agent: Record<string, OpenCodeAgentConfig> | undefined,
): OpenCodeAgentFileDef[] {
  if (!agent) return []
  const out: OpenCodeAgentFileDef[] = []
  for (const [id, cfg] of Object.entries(agent)) {
    if (cfg.disable) continue
    out.push({
      id,
      name: id,
      path: `opencode.json#agent.${id}`,
      mode: cfg.mode || 'all',
      description: cfg.description,
      model: cfg.model,
      temperature: cfg.temperature,
      steps: cfg.steps ?? cfg.maxSteps,
      body: typeof cfg.prompt === 'string' && !cfg.prompt.startsWith('{file:')
        ? cfg.prompt
        : cfg.description || '',
      permission: cfg.permission,
      hidden: cfg.hidden,
      color: cfg.color,
      source: 'config',
    })
  }
  return out
}

export function commandsFromConfigJson(
  command: Record<string, OpenCodeCommandConfig> | undefined,
): OpenCodeCommandFileDef[] {
  if (!command) return []
  return Object.entries(command).map(([id, cfg]) => ({
    id,
    name: id,
    path: `opencode.json#command.${id}`,
    description: cfg.description,
    template: cfg.template,
    agent: cfg.agent,
    model: cfg.model,
    source: 'config' as const,
  }))
}

/** Expand $ARGUMENTS in command templates */
export function expandCommandTemplate(template: string, args: string): string {
  return template.replace(/\$ARGUMENTS/g, args).replace(/\$\{ARGUMENTS\}/g, args)
}

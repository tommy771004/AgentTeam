/** Safe declarative custom-tool helpers. No plugin-provided JavaScript is executed. */

import type { CustomToolDefinition, LlmSettings } from '../types.ts'
import { pluginRegistry } from '../hermes/plugins.ts'
import { compileToolPackage, validateToolPackage } from './toolPackage.ts'
import type { OpenAiToolDef } from './schemas.ts'

const NAME = /^[A-Za-z][A-Za-z0-9_-]{0,63}$/

export type ResolvedCustomTool = CustomToolDefinition & { ownerId: string }

export function customToolsForSettings(settings: LlmSettings): ResolvedCustomTool[] {
  const byName = new Map<string, ResolvedCustomTool>()
  const add = (raw: CustomToolDefinition, ownerId: string) => {
    const name = raw?.name?.trim()
    if (!name || !NAME.test(name) || !raw.description?.trim()) return
    if (raw.kind === 'http_template' && !/^(https?:\/\/|{{)/i.test(raw.template?.url || '')) return
    if (raw.kind === 'bash_template' && !raw.template?.command?.trim()) return
    // Settings intentionally win over plugins so a user can disable/replace an edge tool.
    if (!byName.has(name)) byName.set(name, { ...raw, name, ownerId: raw.ownerId || ownerId })
  }
  for (const tool of settings.customTools || []) add(tool, tool.ownerId || 'settings')
  for (const plugin of pluginRegistry.list()) {
    if (!plugin.enabled) continue
    for (const tool of plugin.customTools || []) add(tool, plugin.id)
    // Governed tool packages: validate and compile; unapproved privileged
    // tools are withheld (read-only surface until user re-approves fingerprint)
    if (plugin.toolPackage) {
      const v = validateToolPackage(plugin.toolPackage)
      if (v.ok && v.manifest) {
        const compiled = compileToolPackage(v.manifest, plugin.id, plugin.packageReview)
        for (const tool of compiled.tools) add(tool, plugin.id)
      }
    }
  }
  return [...byName.values()]
}

/** Packages awaiting privilege review（供 Settings/市集 UI）. */
export function listPendingToolPackages(): Array<{
  pluginId: string
  packageId: string
  version: string
  fingerprint: string
  withheld: string[]
}> {
  const out: Array<{
    pluginId: string
    packageId: string
    version: string
    fingerprint: string
    withheld: string[]
  }> = []
  for (const plugin of pluginRegistry.list()) {
    if (!plugin.enabled || !plugin.toolPackage) continue
    const v = validateToolPackage(plugin.toolPackage)
    if (!v.ok || !v.manifest) continue
    const compiled = compileToolPackage(v.manifest, plugin.id, plugin.packageReview)
    if (compiled.needsReview && compiled.withheld.length) {
      out.push({
        pluginId: plugin.id,
        packageId: v.manifest.id,
        version: v.manifest.version,
        fingerprint: compiled.fingerprint,
        withheld: compiled.withheld,
      })
    }
  }
  return out
}

/**
 * Keyword pick custom tools for heuristic path (non-FC).
 * Scores against tool name/description/owner + CONNECTOR-style tokens in objective.
 */
export function selectCustomToolsForStep(
  stepDescription: string,
  objective: string,
  settings: LlmSettings,
  opts?: { max?: number; blockedTools?: string[] },
): ResolvedCustomTool[] {
  const max = opts?.max ?? 4
  const blocked = new Set(opts?.blockedTools || [])
  const hay = `${objective}\n${stepDescription}`.toLowerCase()
  const scored: Array<{ tool: ResolvedCustomTool; score: number }> = []
  for (const tool of customToolsForSettings(settings)) {
    if (blocked.has(tool.name)) continue
    const bag = `${tool.name} ${tool.description} ${tool.ownerId}`.toLowerCase()
    let score = 0
    for (const w of bag.split(/[\s:_\-/|]+/)) {
      if (w.length < 3) continue
      if (hay.includes(w)) score += w.length > 6 ? 3 : 1
    }
    // Boost well-known product tokens
    for (const token of [
      'github',
      'notion',
      'linear',
      'figma',
      'dropbox',
      'clickup',
      'asana',
      'calendar',
      'sheet',
      'postgres',
      'brave',
      'homeassistant',
      'home assistant',
      'hass',
      'ha_',
      '智能家居',
      '智慧家庭',
    ]) {
      if (hay.includes(token) && bag.includes(token.replace(/\s/g, ''))) score += 4
      if (hay.includes(token) && bag.includes(token)) score += 4
    }
    if (score > 0) scored.push({ tool, score })
  }
  scored.sort((a, b) => b.score - a.score)
  return scored.slice(0, max).map((s) => s.tool)
}

/** Best-effort args for heuristic custom-tool runs */
export function buildCustomToolInput(
  tool: ResolvedCustomTool,
  objective: string,
  stepDescription: string,
): Record<string, unknown> {
  const hay = `${objective}\n${stepDescription}`
  const out: Record<string, unknown> = {}
  const repo = hay.match(/\b([\w.-]+)\/([\w.-]+)\b/)
  const url = hay.match(/https?:\/\/[^\s)\]"'<>]+/i)
  const uuid = hay.match(
    /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/i,
  )
  for (const [name, p] of Object.entries(tool.params || {})) {
    if (name === 'owner' && repo) out.owner = repo[1]
    else if (name === 'repo' && repo) out.repo = repo[2]
    else if ((name === 'url' || name === 'page_url') && url) out[name] = url[0]
    else if ((name === 'page_id' || name === 'file_key') && uuid) out[name] = uuid[0]
    else if (name === 'query' || name === 'q') {
      out[name] = stepDescription.slice(0, 240) || objective.slice(0, 240)
    } else if (name === 'state') out.state = 'open'
    else if (name === 'calendarId') out.calendarId = 'primary'
    else if (name === 'timeMin') out.timeMin = new Date().toISOString()
    else if (name === 'path') out.path = ''
    else if (name === 'range') out.range = 'Sheet1!A1:D20'
    else if (name === 'base_url') {
      const m = hay.match(/https?:\/\/[\w.-]+(?::\d+)?/i)
      out.base_url = m?.[0] || 'http://homeassistant.local:8123'
    } else if (name === 'entity_id') {
      const m = hay.match(
        /\b(?:light|switch|climate|sensor|binary_sensor|media_player|cover|lock|scene|script|fan|input_boolean)\.[\w.]+\b/i,
      )
      out.entity_id = m?.[0] || ''
    } else if (name === 'domain') {
      if (/關燈|關.*燈|turn.?off.*light|light.?off/i.test(hay)) out.domain = 'light'
      else if (/開燈|開.*燈|turn.?on.*light|light.?on/i.test(hay)) out.domain = 'light'
      else if (/插座|switch/i.test(hay)) out.domain = 'switch'
      else if (/空調|冷氣|climate/i.test(hay)) out.domain = 'climate'
      else if (/場景|scene/i.test(hay)) out.domain = 'scene'
      else if (p.required) out.domain = ''
    } else if (name === 'service') {
      if (/關|off|關閉/i.test(hay) && !/開關/.test(hay)) out.service = 'turn_off'
      else if (/開|on|開啟/i.test(hay)) out.service = 'turn_on'
      else if (/toggle|切換/i.test(hay)) out.service = 'toggle'
      else if (p.required) out.service = ''
    } else if (p.required) out[name] = ''
  }
  return out
}

export function customToolDefs(tools: ResolvedCustomTool[]): OpenAiToolDef[] {
  return tools.map((tool) => {
    const properties: Record<string, unknown> = {}
    const required: string[] = []
    for (const [name, p] of Object.entries(tool.params || {})) {
      if (!NAME.test(name)) continue
      properties[name] = { type: p.type || 'string', description: p.description || name }
      if (p.required) required.push(name)
    }
    return {
      type: 'function',
      function: {
        name: tool.name,
        description: `[Custom:${tool.ownerId}] ${tool.description}`,
        parameters: { type: 'object', properties, ...(required.length ? { required } : {}) },
      },
    }
  })
}
